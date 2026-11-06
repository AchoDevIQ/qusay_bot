// السيطرة: صاحب البوت يحط سيطرة ورا أي امتحان يختاره. السيطرة تشمل امتحانات الفصل من بعد السيطرة اللي قبلها
// لحد هذا الامتحان، وإلها أقل مجموع وعدد غيابات يوقف. إذا ما عبرها الطالب تنوقف عليه الامتحانات،
// والمحاضرات هم إذا مشتريها، ويوصله هو وولي أمره رسالة صاحب البوت يكتبها. يرجع بس إذا فكه صاحب البوت
import { ADMIN_IDS } from "./config.ts";
import { find, insert, kvGet, kvSet, put, update, type Row } from "./db.ts";
import { boughtLectures, guardianOf, logActivity } from "./access.ts";
import { isStaff, student } from "./data.ts";
import { closeFinished } from "./examRoom.ts";
import { schedSettings } from "./schedApi.ts";
import { itemState } from "./scheduleRules.ts";
import { createHash, randomUUID } from "node:crypto";
import { files } from "./files.ts";
import { send, upload } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { ApiError, authed, intOf, need } from "./webApi.ts";

/** نتيجة اللي عبر: من درجة لدرجة (من مجموع هاي السيطرة) إلها رسالة وشخصية */
export type Band = { id: string; from: number; to: number; text: string; images?: string[]; image?: string | null };
/** صور النتيجة (الحفظ القديم كان صورة وحدة) */
const picsOf = (b: Band) => [...new Set([...(b.images ?? []), ...(b.image ? [b.image] : [])])];
export type Rule = { min: number; absent: number; bands?: Band[] };
/** طريقتين: «marks» كل سيطرة إلها شرطها ونتائجها بالدرجات، «percent» نسبة وحدة لكل السيطرات */
export type Mode = "marks" | "percent";
type Pct = { min: number; absent: number; bands: Band[] };
type Cfg = { rules: Record<string, Rule>; student: string; guardian: string; stopImage: string | null; mode: Mode; pct: Pct };
type Seg = Rule & { exam: number; chapter: string; title: string; from: string; ids: number[] };
const KEY = "checkpoints_v2";
const PER_EXAM = 100;
const MAX_TEXT = 2000;
export const TAGS = ["{الاسم}", "{الموقوف}", "{السبب}", "{الفصل}", "{العدد}", "{الدرجة}", "{الكلي}", "{المطلوب}", "{الغياب}"];
export const BAND_TAGS = ["{الاسم}", "{الفصل}", "{العدد}", "{الدرجة}", "{الكلي}", "{النسبة}"];
const IMG = /^checkpoints\/[\w-]+\.(png|jpg|webp)$/;
export const cpImageUrl = (ref: string | null) => (ref && IMG.test(ref) ? `/api/cpimg?ref=${encodeURIComponent(ref)}` : "");
const LOW = "عدم تحقيق الدرجة المطلوبة للعبور";
const ABSENT = "كثرة الغيابات";

export const DEFAULT_STUDENT = "⛔ توقفت عليك {الموقوف}\n\nالسبب: {السبب}\n\nسيطرة {الفصل}، آخر {العدد} امتحانات:\nمجموعك {الدرجة} من {الكلي}، والمطلوب {المطلوب}\nغياباتك: {الغياب}\n\nحتى ترجع لازم يحضر ولي أمرك ويا قصي العميري.";
export const DEFAULT_GUARDIAN = "⛔ توقفت {الموقوف} على الطالب {الاسم}\n\nالسبب: {السبب}\n\nسيطرة {الفصل}، آخر {العدد} امتحانات:\nمجموعه {الدرجة} من {الكلي}، والمطلوب {المطلوب}\nغياباته: {الغياب}\n\nحتى يرجع لازم تحضر ويا قصي العميري.";

export async function loadCfg(): Promise<Cfg> {
  let saved: Partial<Cfg> = {};
  try { saved = JSON.parse(await kvGet(KEY) ?? "{}"); } catch { /* إعدادات خربانة */ }
  return { rules: saved.rules ?? {}, student: saved.student || DEFAULT_STUDENT, guardian: saved.guardian || DEFAULT_GUARDIAN, stopImage: saved.stopImage ?? null,
    mode: saved.mode === "percent" ? "percent" : "marks",
    pct: { min: Number(saved.pct?.min ?? 50), absent: Number(saved.pct?.absent ?? 0), bands: Array.isArray(saved.pct?.bands) ? saved.pct!.bands : [] } };
}
const saveCfg = (c: Cfg) => kvSet(KEY, JSON.stringify(c));

/** امتحانات كل فصل بترتيب الكتاب، بدون اللي كل نسخها اختيارية لأنها ما تدخل الجدول */
export async function bookExams() {
  const versions = await find("bank_versions");
  const exams = (await find("bank_exams"))
    .filter((e) => { const vs = versions.filter((v) => v.exam_id === e.id); return !vs.length || vs.some((v) => v.kind === "mandatory"); })
    .sort((x, y) => (Number(x.pos ?? 0) * 1000 + Number(x.ord ?? 0)) - (Number(y.pos ?? 0) * 1000 + Number(y.ord ?? 0)));
  const chapters = new Map<string, Row[]>();
  for (const e of exams) { const ch = String(e.chapter ?? ""); if (ch) chapters.set(ch, [...chapters.get(ch) ?? [], e]); }
  return chapters;
}
/** كل سيطرة تشمل امتحانات فصلها من بعد السيطرة اللي قبلها لحدها */
function segmentsOf(chapters: Map<string, Row[]>, cfg: Cfg): Seg[] {
  const rules = cfg.rules;
  const out: Seg[] = [];
  for (const [chapter, list] of chapters) {
    let from = 0;
    list.forEach((e, i) => {
      const r = rules[String(e.id)];
      if (!r) return;
      const n = i + 1 - from;
      out.push({ exam: e.id, chapter, title: String(e.title ?? ""), from: String(list[from].title ?? ""), ids: list.slice(from, i + 1).map((x) => x.id as number), ...(cfg.mode === "percent"
        // بالنسبة: نفس النسبة لكل السيطرات، تنحسب من مجموع كل وحدة
        ? { min: Math.ceil((cfg.pct.min * n * PER_EXAM) / 100), absent: Math.min(cfg.pct.absent, n) }
        : { min: Math.min(r.min, n * PER_EXAM), absent: Math.min(r.absent, n) }) });
      from = i + 1;
    });
  }
  return out;
}

/** الإيقاف الحالي إذا موجود */
export const activeStop = async (uid: number) => (await find("student_stops", { user_id: uid }, { order: ["-id"] })).find((s) => !s.lifted) ?? null;
/** للتطبيق بعدين: المحاضرات موقوفة على هذا الطالب؟ */
export const lecturesStopped = async (uid: number) => !!(await activeStop(uid))?.lectures;
const whatOf = (s: Row) => (s.lectures ? "الامتحانات والمحاضرات" : "الامتحانات");

const fill = (text: string, v: Record<string, string | number>) => esc(text).replace(/\{([^{}]+)\}/g, (m, k) => (k in v ? esc(String(v[k])) : m));
const plain = (text: string, v: Record<string, string | number>) => text.replace(/\{([^{}]+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
export const bandOf = (bands: Band[] | undefined, score: number) => (bands ?? []).find((b) => score >= b.from && score <= b.to) ?? null;
/** صورة الشخصية بالبوت (إذا موجودة) */
async function sendPicture(chat: number, ref: string | null) {
  if (!ref || !IMG.test(ref)) return;
  const buf = await files().read(ref);
  if (!buf) return;
  const ext = ref.split(".").pop()!;
  try { await upload("sendPhoto", { chat_id: String(chat) }, "photo", buf, `c.${ext}`, ext === "jpg" ? "image/jpeg" : `image/${ext}`); } catch (e) { console.error(e); }
}
/** صورة ما وصلت للطالب قبل، وإذا كلهن وصلن: وحدة غير آخر وحدة إذا أكو */
async function freshPicture(uid: number, band: Band) {
  const pics = picsOf(band);
  if (!pics.length) return null;
  const past = (await find("checkpoint_done", { user_id: uid })).filter((r) => r.image).sort((a, b) => String(a.created).localeCompare(String(b.created))).map((r) => r.image as string);
  const fresh = pics.filter((p) => !past.includes(p));
  const pool = fresh.length ? fresh : pics.length > 1 ? pics.filter((p) => p !== past[past.length - 1]) : pics;
  return pool[Math.floor(Math.random() * pool.length)];
}
/** اللي عبر: رسالة الدرجة اللي جابها وشخصيتها للطالب، وولي أمره الكتابة بس */
async function rewardStudent(uid: number, st: Row, band: Band | null, pic: string | null, v: Record<string, string | number>) {
  if (!band) return;
  const text = fill(band.text, { "الاسم": st.name ?? "", ...v });
  await sendPicture(uid, pic);
  try { await send(uid, text); } catch (e) { console.error(e); }
  const g = (await guardianOf(uid))?.guardian_id;
  if (g) try { await send(g, text); } catch (e) { console.error(e); }
}

/** يحسب السيطرات اللي كملت للطالب، ويوقفه إذا ما عبر وحدة منها */
export async function runCheckpoints(uid: number) {
  if (uid <= 0) return;
  const cfg = await loadCfg();
  if (!Object.keys(cfg.rules).length || await activeStop(uid)) return;
  const st = await student(uid);
  if (!st) return;
  const segs = segmentsOf(await bookExams(), cfg);
  const s = await schedSettings();
  await closeFinished(uid, s);
  const stops = (await find("student_stops", { user_id: uid })).map((x) => [String(x.created), String(x.lifted ?? "9")]);
  const now = stamp();
  const isMissed = (i: Row) => i.status === "missed" || (i.status === "waiting" && itemState("waiting", i.at, s.window, now) === "missed");
  // الامتحان اللي إله أكثر من محاولة (إعادة): تنحسب أول درجة. الغياب ينمسح إذا اجت درجة بعده
  const tries = new Map<number, Row[]>();
  for (const i of await find("sched_items", { user_id: uid }, { order: ["at"] })) if (i.kind !== "optional") tries.set(i.exam_id as number, [...tries.get(i.exam_id as number) ?? [], i]);
  const byExam = new Map([...tries].map(([e, list]) => [e, list.find((i) => i.graded_at) ?? list.find((i) => !isMissed(i)) ?? list[0]]));
  const done = new Set((await find("checkpoint_done", { user_id: uid })).map((d) => `${d.chapter}|${d.block}`));
  for (const g of segs) {
    if (done.has(`${g.chapter}|${g.exam}`)) continue;
    const its = g.ids.map((id) => byExam.get(id));
    if (its.some((i) => !i)) continue;   // فصل ما مشتريه، أو امتحان لسه ما انحط بجدوله
    const res = its.map((i) => {
      if (i!.graded_at) return { mark: Number(i!.total) || 0, absent: 0 };
      // ما بيه أجوبة = غياب، إلكتروني أو حضوري
      return isMissed(i!) ? { mark: 0, absent: 1 } : null;
    });
    if (res.some((x) => x === null)) continue;   // باقي امتحان ما انصحح أو ما صار وقته
    // امتحانات فاتته وهو موقوف: هذي السيطرة ما تنحسب عليه
    if (its.some((i) => stops.some(([a, b]) => String(i!.at) >= a && String(i!.at) <= b))) {
      await put("checkpoint_done", { user_id: uid, chapter: g.chapter, block: g.exam, passed: 2, score: null, absent: null, created: now });
      continue;
    }
    const score = res.reduce((n, x) => n + x!.mark, 0), absent = res.reduce((n, x) => n + x!.absent, 0);
    const n = g.ids.length;
    const low = g.min > 0 && score < g.min, many = g.absent > 0 && absent >= g.absent;
    const pctScore = Math.round((score * 100) / (n * PER_EXAM));
    const band = low || many ? null : cfg.mode === "percent" ? bandOf(cfg.pct.bands, pctScore) : bandOf(cfg.rules[String(g.exam)]?.bands, score);
    const pic = band ? await freshPicture(uid, band) : null;
    await put("checkpoint_done", { user_id: uid, chapter: g.chapter, block: g.exam, passed: low || many ? 0 : 1, score, absent, created: now, band: band?.id ?? null, image: pic, seen: null });
    if (!low && !many) {
      await logActivity(uid, `🚦 عبر سيطرة ${g.chapter} بعد ${g.title}: ${score} من ${n * PER_EXAM}، غياب ${absent}`);
      await rewardStudent(uid, st, band, pic, { "الفصل": g.chapter, "العدد": n, "الدرجة": score, "الكلي": n * PER_EXAM, "النسبة": `${pctScore}%` });
      continue;
    }
    await stopStudent(uid, st, cfg, { chapter: g.chapter, block: g.exam, every: n, score, need: g.min, absent, reason: [low && LOW, many && ABSENT].filter(Boolean).join(" و") });
    return;
  }
}

async function stopStudent(uid: number, st: Row, cfg: Cfg, x: { chapter: string; block: number; every: number; score: number; need: number; absent: number; reason: string }) {
  const lectures = await boughtLectures(uid) ? 1 : 0;
  const row = { user_id: uid, chapter: x.chapter, block: x.block, score: x.score, max: x.every * PER_EXAM, need: x.need, absent: x.absent, reason: x.reason, lectures, created: stamp(), lifted: null, lifted_by: null };
  await insert("student_stops", row);
  const what = whatOf(row);
  await logActivity(uid, `⛔ توقفت عليه ${what}: ${x.reason} (سيطرة ${x.chapter}، ${x.score} من ${row.max}، غياب ${x.absent})`);
  const v = { "الاسم": st.name ?? "", "الموقوف": what, "السبب": x.reason, "الفصل": x.chapter, "العدد": x.every, "الدرجة": x.score, "الكلي": row.max, "المطلوب": x.need, "الغياب": x.absent };
  const safe = async (chat: number, text: string) => { try { await send(chat, text); } catch (e) { console.error(e); } };
  await sendPicture(uid, cfg.stopImage);
  await safe(uid, fill(cfg.student, v));
  const g = await guardianOf(uid);
  if (g) await safe(g.guardian_id, fill(cfg.guardian, v));   // ولي الأمر: الكتابة بس، بدون صورة
  for (const a of ADMIN_IDS) await safe(a, `⛔ <b>توقف طالب بالسيطرة</b>\nالطالب: ${esc(st.name ?? "")}\nتوقفت عليه: ${what}\nالسبب: ${esc(x.reason)}\n${esc(x.chapter)}: ${x.score} من ${row.max}، غياب ${x.absent}\nتفكه من صفحة السيطرة أو صفحة الطالب.`);
}

/** آخر سيطرة عبرها وبعده ما شافها: تطلع بصفحة امتحاناته تومض ويا شخصيتها */
export async function checkpointCard(uid: number) {
  const r = (await find("checkpoint_done", { user_id: uid })).filter((x) => x.passed === 1 && x.band && !x.seen).sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
  if (!r) return null;
  const cfg = await loadCfg();
  const band = [...cfg.rules[String(r.block)]?.bands ?? [], ...cfg.pct.bands].find((b) => b.id === r.band);
  if (!band) return null;
  const n = Math.max(1, segmentsOf(await bookExams(), cfg).find((g) => g.chapter === r.chapter && g.exam === r.block)?.ids.length ?? 1);
  const st = await student(uid);
  return { key: `${r.chapter}|${r.block}`, image: cpImageUrl(r.image ?? null), text: plain(band.text, { "الاسم": st?.name ?? "", "الفصل": r.chapter, "العدد": n, "الدرجة": r.score, "الكلي": n * PER_EXAM, "النسبة": `${Math.round((Number(r.score) * 100) / (n * PER_EXAM))}%` }) };
}
export async function seeCheckpoint(uid: number, key: unknown) {
  const [chapter, block] = String(key ?? "").split("|");
  await update("checkpoint_done", { user_id: uid, chapter, block: Number(block) }, { seen: stamp() });
}

/** صفحات امتحانات الطالب: إذا موقوف ما يدخل */
export async function checkStopped(uid: number) {
  if (await isStaff(uid) || !await student(uid)) return;
  await runCheckpoints(uid);
  const s = await activeStop(uid);
  if (s) throw new ApiError(423, `⛔ توقفت عليك ${whatOf(s)} بسبب ${s.reason}. حتى ترجع تواصل ويا قصي العميري.`, { stop: { image: cpImageUrl((await loadCfg()).stopImage) } });
}

export async function liftStop(uid: number, by: number) {
  const s = await activeStop(uid);
  need(s, "هذا الطالب مو موقوف");
  await update("student_stops", { id: s!.id }, { lifted: stamp(), lifted_by: by });
  await logActivity(uid, `✅ الإدارة فكت الإيقاف ورجعت ${whatOf(s!)}`);
  try { await send(uid, `✅ رجعت ${whatOf(s!)}. بالتوفيق.`); } catch (e) { console.error(e); }
}

/** للمؤقت: يحسب السيطرات لكل طالب عنده امتحانات */
export async function sweepCheckpoints(force = false) {
  if (!Object.keys((await loadCfg()).rules).length) return 0;
  const last = Number(await kvGet("checkpoints_sweep")) || 0;
  if (!force && Date.now() - last < 30 * 60 * 1000) return 0;
  await kvSet("checkpoints_sweep", String(Date.now()));
  const ids = [...new Set((await find("sched_items")).map((i) => i.user_id as number).filter((u) => u > 0))];
  for (const id of ids) { try { await runCheckpoints(id); } catch (e) { console.error(e); } }
  return ids.length;
}

export const stopView = (s: Row | null) => (s ? { at: String(s.created), reason: String(s.reason), what: whatOf(s), chapter: String(s.chapter), score: s.score, max: s.max, absent: s.absent } : null);

const bandsView = (l: Band[]) => [...l].sort((a, b) => b.from - a.from).map((b) => ({ id: b.id, from: b.from, to: b.to, text: b.text, pics: picsOf(b).map((ref) => ({ ref, url: cpImageUrl(ref) })) }));
async function pageData() {
  const cfg = await loadCfg();
  const chapters = [];
  for (const [chapter, list] of await bookExams()) {
    let from = 0;
    chapters.push({
      chapter, exams: list.map((e, i) => {
        const r = cfg.rules[String(e.id)];
        const row = { id: e.id as number, title: String(e.title ?? ""), since: i + 1 - from, from: String(list[from].title ?? ""),
          cp: r ? { min: r.min, absent: r.absent, bands: bandsView(r.bands ?? []) } : null };
        if (r) from = i + 1;
        return row;
      }),
    });
  }
  const stopped = [];
  for (const s of (await find("student_stops", {}, { order: ["-id"] })).filter((x) => !x.lifted)) {
    stopped.push({ id: s.user_id, name: (await student(s.user_id))?.name ?? String(s.user_id), ...stopView(s)! });
  }
  return {
    chapters, student: cfg.student, guardian: cfg.guardian, tags: TAGS, bandTags: BAND_TAGS, stopped, notice: "",
    stopUrl: cpImageUrl(cfg.stopImage), mode: cfg.mode,
    pct: { min: cfg.pct.min, absent: cfg.pct.absent, bands: bandsView(cfg.pct.bands) },
  };
}

const textOf = (raw: unknown) => {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  need(t, "اكتب نص الرسالة");
  need(t.length <= MAX_TEXT, "الرسالة طويلة هواية، خليها أقصر");
  return t;
};

const IMG_MAX = 5 * 1024 * 1024;
/** صورة شخصية مرفوعة: PNG أو JPG أو WEBP */
async function savePicture(f: unknown) {
  need(f instanceof Blob && f.size > 0, "اختار صورة");
  need((f as Blob).size <= IMG_MAX, "الصورة لازم أصغر من 5 ميگا");
  const buf = Buffer.from(await (f as Blob).arrayBuffer());
  const ext = buf[0] === 0x89 && buf[1] === 0x50 ? "png" : buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : buf.subarray(8, 12).toString() === "WEBP" ? "webp" : "";
  need(ext, "الصورة لازم PNG أو JPG أو WEBP");
  // اسمها من محتواها: نفس الصورة بأكثر من سيطرة تبقى نفسها، حتى ما توصل للطالب مرتين
  const ref = `checkpoints/${createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${ext}`;
  await files().write(ref, buf, ext === "jpg" ? "image/jpeg" : `image/${ext}`);
  return ref;
}

export async function checkpointsAction(raw: Row | FormData) {
  const body: Row = raw instanceof FormData ? Object.fromEntries([...raw.entries()]) : raw;
  const files = raw instanceof FormData ? raw.getAll("file") : [];
  const uid = await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "saveBand" || a === "delBand") {
    // النتيجة تخص سيطرة وحدة (درجاتها من مجموعها)، أو «pct» لكل السيطرات بالنسبة
    const cfg = await loadCfg();
    const global = body.exam === "pct";
    const rule = global ? cfg.pct : cfg.rules[String(body.exam)];
    need(rule, "أنشئ السيطرة أول");
    const max = global ? 100 : (await pageData()).chapters.flatMap((c) => c.exams).find((x) => x.id === Number(body.exam))!.since * PER_EXAM;
    const bands = rule.bands ?? [];
    const unit = global ? "%" : "";
    if (a === "delBand") {
      need(bands.some((b) => b.id === String(body.id)), "غير موجودة");
      rule.bands = bands.filter((b) => b.id !== String(body.id));
      notice = "🗑 انحذفت";
    } else {
      const from = intOf(body.from, 0, max, `«من» من 0 إلى ${max}${unit}`), to = intOf(body.to, 0, max, `«إلى» من 0 إلى ${max}${unit}`);
      need(from <= to, "«من» لازم أصغر من «إلى»");
      const text = textOf(body.text);
      const id = String(body.id ?? "") || randomUUID().slice(0, 8);
      const clash = bands.find((b) => b.id !== id && from <= b.to && to >= b.from);
      need(!clash, clash ? `تتداخل ويا ${clash.from}${unit} إلى ${clash.to}${unit}` : "");
      // الصور: الموجودة ناقص اللي انشالت، وفوكها الجديدة
      const old = bands.find((b) => b.id === id);
      const drop = new Set(String(body.drop ?? "").split(",").filter(Boolean));
      const images = (old ? picsOf(old) : []).filter((p) => !drop.has(p));
      for (const f of files) if (f instanceof Blob && f.size > 0) images.push(await savePicture(f));
      need(images.length <= 20, "أكثر شي 20 صورة لكل نتيجة");
      rule.bands = [...bands.filter((b) => b.id !== id), { id, from, to, text, images }];
      notice = global ? `✅ انحفظت ${from}% إلى ${to}%` : `✅ انحفظت ${from} إلى ${to} من ${max}`;
    }
    await saveCfg(cfg);
  } else if (a === "saveMode") {
    const cfg = await loadCfg();
    cfg.mode = body.mode === "percent" ? "percent" : "marks";
    await saveCfg(cfg);
    notice = cfg.mode === "percent" ? "✅ صارت السيطرة بالنسبة لكل السيطرات" : "✅ صارت السيطرة بالدرجات لكل سيطرة";
  } else if (a === "savePct") {
    const cfg = await loadCfg();
    const min = intOf(body.min, 0, 100, "النسبة من 0 إلى 100"), absent = intOf(body.absent, 0, 50, "الغيابات من 0 إلى 50");
    need(min > 0 || absent > 0, "حط نسبة أو عدد غيابات، حتى السيطرة يكون إلها شرط");
    cfg.pct = { ...cfg.pct, min, absent };
    await saveCfg(cfg);
    notice = `✅ انحفظت: أقل نسبة ${min}%${absent ? `، ويوقف إذا غاب ${absent}` : ""}`;
  } else if (a === "stopImage") {
    const cfg = await loadCfg();
    cfg.stopImage = body.dropImage === "1" ? null : await savePicture(body.file);
    await saveCfg(cfg);
    notice = cfg.stopImage ? "✅ انحفظت شخصية الإيقاف" : "🗑 انشالت شخصية الإيقاف";
  } else if (a === "saveCp" || a === "delCp") {
    const id = Number(body.exam);
    const ch = (await pageData()).chapters.find((c) => c.exams.some((e) => e.id === id));
    need(ch, "الامتحان غير موجود");
    const e = ch!.exams.find((x) => x.id === id)!;
    const cfg = await loadCfg();
    if (a === "delCp") {
      need(cfg.rules[String(id)], "ماكو سيطرة هنا");
      delete cfg.rules[String(id)];
      notice = `🗑 انحذفت السيطرة بعد ${e.title}`;
    } else {
      const n = e.since;
      const old = cfg.rules[String(id)];
      // بالنسبة: الشرط واحد لكل السيطرات، فالسيطرة تنحط بس بمكانها
      const rule: Rule = cfg.mode === "percent" && body.min === undefined ? { min: old?.min ?? 0, absent: old?.absent ?? 0 }
        : { min: intOf(body.min, 0, n * PER_EXAM, `اكتب أقل مجموع من 0 إلى ${n * PER_EXAM}`), absent: intOf(body.absent, 0, n, `اكتب عدد الغيابات من 0 إلى ${n}`) };
      need(cfg.mode === "percent" || rule.min > 0 || rule.absent > 0, "حط أقل مجموع أو عدد غيابات، حتى السيطرة يكون إلها شرط");
      cfg.rules[String(id)] = { ...rule, bands: cfg.rules[String(id)]?.bands ?? [] };
      notice = `✅ انحفظت السيطرة بعد ${e.title}`;
    }
    await saveCfg(cfg);
  } else if (a === "saveTexts") {
    const cfg = await loadCfg();
    cfg.student = textOf(body.student);
    cfg.guardian = textOf(body.guardian);
    await saveCfg(cfg);
    notice = "✅ انحفظت الرسائل";
  } else if (a === "resetTexts") {
    const cfg = await loadCfg();
    cfg.student = DEFAULT_STUDENT; cfg.guardian = DEFAULT_GUARDIAN;
    await saveCfg(cfg);
    notice = "↩️ رجعت الرسائل للأصلية";
  } else if (a === "lift") {
    await liftStop(Number(body.id), uid);
    notice = "✅ انفك الإيقاف، ووصل الطالب خبر";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}

export const stoppedCount = async () => (await find("student_stops", {})).filter((s) => !s.lifted).length;
