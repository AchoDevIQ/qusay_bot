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
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { authed, intOf, need } from "./webApi.ts";

export type Rule = { min: number; absent: number };
type Cfg = { rules: Record<string, Rule>; student: string; guardian: string };
type Seg = Rule & { exam: number; chapter: string; title: string; from: string; ids: number[] };
const KEY = "checkpoints_v2";
const PER_EXAM = 100;
const MAX_TEXT = 2000;
export const TAGS = ["{الاسم}", "{الموقوف}", "{السبب}", "{الفصل}", "{العدد}", "{الدرجة}", "{الكلي}", "{المطلوب}", "{الغياب}"];
const LOW = "عدم تحقيق الدرجة المطلوبة للعبور";
const ABSENT = "كثرة الغيابات";

export const DEFAULT_STUDENT = "⛔ توقفت عليك {الموقوف}\n\nالسبب: {السبب}\n\nسيطرة {الفصل}، آخر {العدد} امتحانات:\nمجموعك {الدرجة} من {الكلي}، والمطلوب {المطلوب}\nغياباتك: {الغياب}\n\nحتى ترجع لازم يحضر ولي أمرك ويا قصي العميري.";
export const DEFAULT_GUARDIAN = "⛔ توقفت {الموقوف} على الطالب {الاسم}\n\nالسبب: {السبب}\n\nسيطرة {الفصل}، آخر {العدد} امتحانات:\nمجموعه {الدرجة} من {الكلي}، والمطلوب {المطلوب}\nغياباته: {الغياب}\n\nحتى يرجع لازم تحضر ويا قصي العميري.";

export async function loadCfg(): Promise<Cfg> {
  let saved: Partial<Cfg> = {};
  try { saved = JSON.parse(await kvGet(KEY) ?? "{}"); } catch { /* إعدادات خربانة */ }
  return { rules: saved.rules ?? {}, student: saved.student || DEFAULT_STUDENT, guardian: saved.guardian || DEFAULT_GUARDIAN };
}
const saveCfg = (c: Cfg) => kvSet(KEY, JSON.stringify(c));

/** امتحانات كل فصل بترتيب الكتاب، بدون اللي كل نسخها اختيارية لأنها ما تدخل الجدول */
async function bookExams() {
  const versions = await find("bank_versions");
  const exams = (await find("bank_exams"))
    .filter((e) => { const vs = versions.filter((v) => v.exam_id === e.id); return !vs.length || vs.some((v) => v.kind === "mandatory"); })
    .sort((x, y) => (Number(x.pos ?? 0) * 1000 + Number(x.ord ?? 0)) - (Number(y.pos ?? 0) * 1000 + Number(y.ord ?? 0)));
  const chapters = new Map<string, Row[]>();
  for (const e of exams) { const ch = String(e.chapter ?? ""); if (ch) chapters.set(ch, [...chapters.get(ch) ?? [], e]); }
  return chapters;
}
/** كل سيطرة تشمل امتحانات فصلها من بعد السيطرة اللي قبلها لحدها */
function segmentsOf(chapters: Map<string, Row[]>, rules: Record<string, Rule>): Seg[] {
  const out: Seg[] = [];
  for (const [chapter, list] of chapters) {
    let from = 0;
    list.forEach((e, i) => {
      const r = rules[String(e.id)];
      if (!r) return;
      const n = i + 1 - from;
      out.push({ exam: e.id, chapter, title: String(e.title ?? ""), from: String(list[from].title ?? ""), ids: list.slice(from, i + 1).map((x) => x.id as number), min: Math.min(r.min, n * PER_EXAM), absent: Math.min(r.absent, n) });
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

/** يحسب السيطرات اللي كملت للطالب، ويوقفه إذا ما عبر وحدة منها */
export async function runCheckpoints(uid: number) {
  if (uid <= 0) return;
  const cfg = await loadCfg();
  if (!Object.keys(cfg.rules).length || await activeStop(uid)) return;
  const st = await student(uid);
  if (!st) return;
  const segs = segmentsOf(await bookExams(), cfg.rules);
  const s = await schedSettings();
  await closeFinished(uid, s);
  const stops = (await find("student_stops", { user_id: uid })).map((x) => [String(x.created), String(x.lifted ?? "9")]);
  const byExam = new Map((await find("sched_items", { user_id: uid })).filter((i) => i.kind !== "optional").map((i) => [i.exam_id as number, i]));
  const done = new Set((await find("checkpoint_done", { user_id: uid })).map((d) => `${d.chapter}|${d.block}`));
  const now = stamp();
  for (const g of segs) {
    if (done.has(`${g.chapter}|${g.exam}`)) continue;
    const its = g.ids.map((id) => byExam.get(id));
    if (its.some((i) => !i)) continue;   // فصل ما مشتريه، أو امتحان لسه ما انحط بجدوله
    const res = its.map((i) => {
      if (i!.graded_at) return { mark: Number(i!.total) || 0, absent: 0 };
      // ما بيه أجوبة = غياب، إلكتروني أو حضوري
      const missed = i!.status === "missed" || (i!.status === "waiting" && itemState("waiting", i!.at, s.window, now) === "missed");
      return missed ? { mark: 0, absent: 1 } : null;
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
    await put("checkpoint_done", { user_id: uid, chapter: g.chapter, block: g.exam, passed: low || many ? 0 : 1, score, absent, created: now });
    if (!low && !many) { await logActivity(uid, `🚦 عبر سيطرة ${g.chapter} بعد ${g.title}: ${score} من ${n * PER_EXAM}، غياب ${absent}`); continue; }
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
  await safe(uid, fill(cfg.student, v));
  const g = await guardianOf(uid);
  if (g) await safe(g.guardian_id, fill(cfg.guardian, v));
  for (const a of ADMIN_IDS) await safe(a, `⛔ <b>توقف طالب بالسيطرة</b>\nالطالب: ${esc(st.name ?? "")}\nتوقفت عليه: ${what}\nالسبب: ${esc(x.reason)}\n${esc(x.chapter)}: ${x.score} من ${row.max}، غياب ${x.absent}\nتفكه من صفحة السيطرة أو صفحة الطالب.`);
}

/** صفحات امتحانات الطالب: إذا موقوف ما يدخل */
export async function checkStopped(uid: number) {
  if (await isStaff(uid) || !await student(uid)) return;
  await runCheckpoints(uid);
  const s = await activeStop(uid);
  need(!s, s ? `⛔ توقفت عليك ${whatOf(s)} بسبب ${s.reason}. حتى ترجع تواصل ويا قصي العميري.` : "", 423);
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

async function pageData() {
  const cfg = await loadCfg();
  const chapters = [];
  for (const [chapter, list] of await bookExams()) {
    let from = 0;
    chapters.push({
      chapter, exams: list.map((e, i) => {
        const r = cfg.rules[String(e.id)];
        const row = { id: e.id as number, title: String(e.title ?? ""), since: i + 1 - from, from: String(list[from].title ?? ""), cp: r ?? null };
        if (r) from = i + 1;
        return row;
      }),
    });
  }
  const stopped = [];
  for (const s of (await find("student_stops", {}, { order: ["-id"] })).filter((x) => !x.lifted)) {
    stopped.push({ id: s.user_id, name: (await student(s.user_id))?.name ?? String(s.user_id), ...stopView(s)! });
  }
  return { chapters, student: cfg.student, guardian: cfg.guardian, tags: TAGS, stopped, notice: "" };
}

const textOf = (raw: unknown) => {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  need(t, "اكتب نص الرسالة");
  need(t.length <= MAX_TEXT, "الرسالة طويلة هواية، خليها أقصر");
  return t;
};

export async function checkpointsAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "saveCp" || a === "delCp") {
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
      const rule: Rule = { min: intOf(body.min, 0, n * PER_EXAM, `اكتب أقل مجموع من 0 إلى ${n * PER_EXAM}`), absent: intOf(body.absent, 0, n, `اكتب عدد الغيابات من 0 إلى ${n}`) };
      need(rule.min > 0 || rule.absent > 0, "حط أقل مجموع أو عدد غيابات، حتى السيطرة يكون إلها شرط");
      cfg.rules[String(id)] = rule;
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
