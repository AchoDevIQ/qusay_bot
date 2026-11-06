// السيطرة: لكل فصل صاحب البوت يحدد «ورا كل كم امتحان» وأقل مجموع وأكثر غيابات. كل ما يكمل الطالب هذا العدد
// من امتحانات الفصل الإجبارية (انصححت أو غاب عنها) تنحسب سيطرة. إذا ما عبرها تنوقف عليه الامتحانات،
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

export type Rule = { on: boolean; every: number; min: number; absent: number };
type Cfg = { rules: Record<string, Rule>; student: string; guardian: string };
const KEY = "checkpoints";
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
  const rules = Object.entries(cfg.rules).filter(([, r]) => r.on && r.every > 0 && (r.min > 0 || r.absent > 0));
  if (!rules.length || await activeStop(uid)) return;
  const st = await student(uid);
  if (!st) return;
  const s = await schedSettings();
  await closeFinished(uid, s);
  const inPerson = st.exam === "حضوري";
  const chapterOf = new Map((await find("bank_exams")).map((e) => [e.id, String(e.chapter ?? "")]));
  // الامتحانات اللي فاتت وهو موقوف ما تنحسب عليه
  const stops = (await find("student_stops", { user_id: uid })).map((x) => [String(x.created), String(x.lifted ?? "9")]);
  const items = (await find("sched_items", { user_id: uid }, { order: ["at"] }))
    .filter((i) => i.kind !== "optional" && !stops.some(([a, b]) => String(i.at) >= a && String(i.at) <= b));
  const done = new Set((await find("checkpoint_done", { user_id: uid })).map((d) => `${d.chapter}|${d.block}`));
  const now = stamp();
  for (const [chapter, r] of rules) {
    const list = items.filter((i) => chapterOf.get(i.exam_id) === chapter);
    for (let b = 1; b * r.every <= list.length; b++) {
      if (done.has(`${chapter}|${b}`)) continue;
      const res = list.slice((b - 1) * r.every, b * r.every).map((i) => {
        if (i.graded_at) return { mark: Number(i.total) || 0, absent: 0 };
        const missed = i.status === "missed" || (!inPerson && i.status === "waiting" && itemState("waiting", i.at, s.window, now) === "missed");
        return missed ? { mark: 0, absent: 1 } : null;
      });
      if (res.some((x) => x === null)) break;   // باقي امتحان ما انصحح أو ما صار وقته
      const score = res.reduce((n, x) => n + x!.mark, 0), absent = res.reduce((n, x) => n + x!.absent, 0);
      const low = r.min > 0 && score < r.min, many = r.absent > 0 && absent >= r.absent;
      await put("checkpoint_done", { user_id: uid, chapter, block: b, passed: low || many ? 0 : 1, score, absent, created: now });
      if (!low && !many) { await logActivity(uid, `🚦 عبر سيطرة ${chapter} رقم ${b}: ${score} من ${r.every * PER_EXAM}، غياب ${absent}`); continue; }
      await stopStudent(uid, st, cfg, { chapter, block: b, every: r.every, score, need: r.min, absent, reason: [low && LOW, many && ABSENT].filter(Boolean).join(" و") });
      return;
    }
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
  if (!Object.values((await loadCfg()).rules).some((r) => r.on)) return 0;
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
  const exams = await find("bank_exams");
  const order = new Map<string, number>();
  for (const e of exams) { const ch = String(e.chapter ?? ""); if (ch) order.set(ch, Math.min(order.get(ch) ?? 1e9, Number(e.pos ?? 0) * 1000 + Number(e.ord ?? 0))); }
  const chapters = [...order.keys()].sort((a, b) => order.get(a)! - order.get(b)!).map((ch) => ({
    chapter: ch, exams: exams.filter((e) => e.chapter === ch).length, ...(cfg.rules[ch] ?? { on: false, every: 8, min: 400, absent: 3 }),
  }));
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
  if (a === "saveRule") {
    const chapter = String(body.chapter ?? "");
    need((await find("bank_exams", { chapter })).length, "الفصل غير موجود");
    const every = intOf(body.every, 1, 60, "اكتب عدد الامتحانات من 1 إلى 60");
    const rule: Rule = { on: !!body.on, every, min: intOf(body.min, 0, every * PER_EXAM, `اكتب أقل مجموع من 0 إلى ${every * PER_EXAM}`), absent: intOf(body.absent, 0, every, `اكتب عدد الغيابات من 0 إلى ${every}`) };
    need(!rule.on || rule.min > 0 || rule.absent > 0, "حط أقل مجموع أو عدد غيابات، حتى السيطرة يكون إلها شرط");
    const cfg = await loadCfg();
    cfg.rules[chapter] = rule;
    await saveCfg(cfg);
    notice = rule.on ? `✅ انحفظت سيطرة ${chapter}` : `⏸ انطفت سيطرة ${chapter}`;
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
