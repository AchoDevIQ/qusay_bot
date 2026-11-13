// نظام التصحيح AI: يصحح الأوراق وحده بخوارزمية Math-Grading (مجلد grading-ai، خدمة Python لحالها).
// صاحب البوت يختار المواضيع اللي يصححها، وكل سؤال يحتاج «خطوات الحل ودرجة كل خطوة».
// الورقة اللي هو مو متأكد منها تروح للمصحح اللي صاحب البوت اختاره لفصلها، بدون ما توصل للطالب.
// الورقة اللي ما يگدر عليها (سؤال بدون خطوات، جواب ملف كامل، الخدمة عطلانة) تبقى للمصححين مثل قبل.
import { createHash } from "node:crypto";
import { find, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { AI_GRADER, staffIds } from "./data.ts";
import { files } from "./files.ts";
import { api, send } from "./telegram.ts";
import { ADMIN_IDS, TOKEN } from "./config.ts";
import { stamp } from "./util.ts";
import { dailyCap, dayOf, engineTag, overCap, spentOn } from "./aiGuard.ts";

export type RubricStep = { text: string; points: number };
/** خطوات السؤال: الطريقة الأولى، وطرق الحل الثانية إذا الأستاذ حل السؤال بأكثر من طريقة. كل طريقة مجموعها درجة السؤال كاملة */
export type Rubric = { steps: RubricStep[]; alts: RubricStep[][] };
export type Usage = { model: string; calls: number; input: number; output: number };
export type Price = { in: number; out: number };
/** المواضيع اللي يصححها، ولكل فصل المصحح اللي توصله الأوراق اللي مو متأكد منها */
/** calib: أول كم ورقة بكل نموذج (A، B، C...) يصححها الأستاذ (أو مساعد عنده صلاحية 🎓) قبل ما يبدي، ونظام التصحيح يتعلم منها */
/** students: طلاب يختارهم صاحب البوت، نظام التصحيح يصحح كل أوراقهم بأي موضوع خطواته جاهزة، حتى لو الموضوع مو مأشر */
export type AiSettings = { exams: number[]; unsure: Record<string, number>; calib: number; students: number[] };
/** سطر بسجل نظام التصحيح: ورقة صححها، أو ورقة حولها لمصحح، أو خطوات طلعها من صورة حل */
export type LogRow = { at: string; kind: "sent" | "unsure" | "rubric" | "try" | "failed" | "objection" | "calib"; note?: string; item?: number; sid?: number; name?: string; exam?: string; total?: number; to?: number | null; q?: number; usage: Usage[] };

const rubricKey = (qid: number) => `ai_rubric_q_${qid}`;
const resultKey = (itemId: number) => `ai_result_${itemId}`;
const triesKey = (itemId: number) => `ai_try_${itemId}`;
const errKey = (itemId: number) => `ai_err_${itemId}`;
// أول أوراق الموضوع: الأستاذ يصححها بإيده، ونظام التصحيح يصححها بالسر حتى نقارن ويتعلم من درجات الأستاذ
// بكل نموذج لحاله، لأن أسئلة كل نموذج غير، والتعلم يصير على نفس السؤال
const calibKey = (versionId: number) => `ai_calib_v_${versionId}`;
const shadowKey = (itemId: number) => `ai_shadow_${itemId}`;
const shadowTryKey = (itemId: number) => `ai_shadow_try_${itemId}`;
// 🔬 المقارنة: مصحح Math-Grading يشوف الصور، بالسر. ما تنحفظ درجة وما يوصل شي للطالب
const photoKey = (itemId: number) => `ai_photo_${itemId}`;
const photoTryKey = (itemId: number) => `ai_photo_try_${itemId}`;
export const CALIB_PERM = "aicalib";
export const CALIB_DEFAULT = 5;
export async function calibList(versionId: number): Promise<number[]> {
  const j = await readJson<number[]>(calibKey(versionId), []);
  return Array.isArray(j) ? j.map(Number) : [];
}
export async function shadowOf(itemId: number): Promise<AiQuestion[] | null> {
  const j = await readJson<AiQuestion[] | null>(shadowKey(itemId), null);
  return Array.isArray(j) ? j : null;
}
// الأسئلة اللي حوّلها للمصحح: الباقي صححه هو، والمصحح يصحح بس هذني وياخذ أجره على قدها
const partialKey = (itemId: number) => `ai_partial_${itemId}`;
export async function aiPartialOf(itemId: number): Promise<number[] | null> {
  const j = await readJson<number[] | null>(partialKey(itemId), null);
  return Array.isArray(j) && j.length ? j.map(Number) : null;
}
/** حصة المصحح من الورقة: كل الورقة 1، وإذا حوّله أسئلة بس، عددها ÷ عدد أسئلة الورقة */
export async function graderShare(it: Row): Promise<number> {
  const part = await aiPartialOf(it.id);
  if (!part) return 1;
  const total = (await find("bank_questions", { version_id: it.version_id })).length;
  return total ? Math.min(1, part.length / total) : 1;
}
const ON_KEY = "ai_grade_on", SET_KEY = "ai_settings", LOG_KEY = "ai_log", PRICE_KEY = "ai_prices";
// مشكلة تقنية (الخدمة ما ردت) تنعاد بالدكة الجاية، لحد 3 مرات
const MAX_TRIES = 3;
/** حدود خدمة التصحيح (bot_api.py): النص الأطول ينرفض بخطأ */
const OBJECTION_MAX = 2000;
// كم ورقة بالدكة، كلها سوا (مو وحدة ورا وحدة)، وكل أسئلة الورقة سوا. 1000 طالب يخلصون بحدود ساعة.
// الحد الحقيقي: كم طلب بالدقيقة تسمح شركة الذكاء الاصطناعي لحسابنا، وكم نسخة من خدمة التصحيح (10)
const PER_TICK = 20;
const LOG_MAX = 5000;
/** أسعار الموديلات بالدولار لكل مليون توكن (داخل / طالع). صاحب البوت يگدر يغيرها من الصفحة */
export const DEFAULT_PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5": { in: 1.25, out: 10 },
};

const svcUrl = () => (process.env.GRADING_AI_URL ?? "").trim().replace(/\/+$/, "");
const svcKey = () => (process.env.GRADING_AI_KEY ?? "").trim();
/** الخدمة مربوطة: رابطها ومفتاحها بأسرار السيرفر */
export const aiLinked = () => !!svcUrl() && !!svcKey();
// شغال دائماً من البداية، إلا إذا صاحب البوت وگفه بإيده
export const aiOn = async () => (await kvGet(ON_KEY)) !== "0";
export const setAiOn = (on: boolean) => kvSet(ON_KEY, on ? "1" : "0");

const readJson = async <T>(k: string, def: T): Promise<T> => { try { return JSON.parse((await kvGet(k)) ?? "null") ?? def; } catch { return def; } };
export async function aiSettings(): Promise<AiSettings> {
  const s = await readJson<Partial<AiSettings>>(SET_KEY, {});
  const calib = Number(s.calib);
  return { exams: Array.isArray(s.exams) ? s.exams.map(Number) : [], unsure: s.unsure && typeof s.unsure === "object" ? s.unsure : {}, calib: Number.isInteger(calib) && calib >= 0 ? calib : CALIB_DEFAULT, students: Array.isArray(s.students) ? s.students.map(Number) : [] };
}
/** يضيف طالب لقائمة الذكاء أو يشيله */
export async function setAiStudent(uid: number, on: boolean) {
  const s = await aiSettings();
  s.students = on ? [...new Set([...s.students, uid])] : s.students.filter((x) => x !== uid);
  await kvSet(SET_KEY, JSON.stringify(s));
}
/** الطلاب المرشحين: عندهم 3 أوراق مصححة أو أكثر ومعدلهم 85 أو أكثر (أوراقهم نظيفة وقريبة من الحل، فالذكاء يصححها بدقة).
 *  ما يتحولون إلا لمن صاحب البوت يدوس الزر */
export async function aiStudentsState(nameOf: (uid: number) => Promise<string>, minAvg = 85, minPapers = 3) {
  const s = await aiSettings();
  const by = new Map<number, number[]>();
  for (const it of await find("sched_items", { status: "done" })) {
    if (!it.graded_at || it.user_id <= 0 || it.total === null || it.total === undefined) continue;
    by.set(it.user_id, [...(by.get(it.user_id) ?? []), Number(it.total)]);
  }
  const row = async (uid: number) => {
    const t = by.get(uid) ?? [];
    return { id: uid, name: await nameOf(uid), papers: t.length, avg: t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : null };
  };
  const chosen = await Promise.all(s.students.map(row));
  const cands = [];
  for (const [uid, t] of by) {
    if (s.students.includes(uid) || t.length < minPapers) continue;
    const r = await row(uid);
    if ((r.avg ?? 0) >= minAvg) cands.push(r);
  }
  cands.sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.papers - a.papers);
  return { minAvg, minPapers, chosen, candidates: cands.slice(0, 50) };
}
export async function setCalib(n: number) {
  const s = await aiSettings();
  s.calib = Math.max(0, Math.min(50, Math.round(n)));
  await kvSet(SET_KEY, JSON.stringify(s));
}
/** مواضيع فصل وحد: اللي يصححها، ومنو توصله أوراقه اللي مو متأكد منها */
export async function setChapterScope(slug: string, examIds: number[], grader: number) {
  const s = await aiSettings();
  const inChapter = new Set((await find("bank_exams", { slug })).map((e) => e.id as number));
  const pick = examIds.map(Number).filter((id) => inChapter.has(id));
  s.exams = [...s.exams.filter((id) => !inChapter.has(id)), ...pick];
  if (grader) s.unsure[slug] = grader; else delete s.unsure[slug];
  await kvSet(SET_KEY, JSON.stringify(s));
}
export async function prices(): Promise<Record<string, Price>> {
  return { ...DEFAULT_PRICES, ...await readJson<Record<string, Price>>(PRICE_KEY, {}) };
}
export async function setPrice(model: string, p: Price) {
  const all = await readJson<Record<string, Price>>(PRICE_KEY, {});
  all[model] = { in: Math.max(0, Number(p.in) || 0), out: Math.max(0, Number(p.out) || 0) };
  await kvSet(PRICE_KEY, JSON.stringify(all));
}
/** كلفة سطر بالدولار. موديل بدون سعر ينحسب صفر، والصفحة تنبه عليه */
export const costOf = (usage: Usage[], p: Record<string, Price>) =>
  usage.reduce((t, u) => t + ((p[u.model]?.in ?? 0) * u.input + (p[u.model]?.out ?? 0) * u.output) / 1e6, 0);
export const aiLog = () => readJson<LogRow[]>(LOG_KEY, []);
async function addLog(row: LogRow) {
  const all = await aiLog();
  all.push(row);
  await kvSet(LOG_KEY, JSON.stringify(all.slice(-LOG_MAX)));
}
const sumUsage = (lists: Usage[][]): Usage[] => {
  const out = new Map<string, Usage>();
  for (const u of lists.flat()) {
    const r = out.get(u.model) ?? { model: u.model, calls: 0, input: 0, output: 0 };
    r.calls += Number(u.calls) || 0; r.input += Number(u.input) || 0; r.output += Number(u.output) || 0;
    out.set(u.model, r);
  }
  return [...out.values()];
};

/** خطوات السؤال المحفوظة بكل طرق حلها، أو null إذا ما إله خطوات */
export async function rubricFull(qid: number): Promise<Rubric | null> {
  const j = await readJson<{ steps?: RubricStep[]; alts?: RubricStep[][] } | null>(rubricKey(qid), null);
  if (!Array.isArray(j?.steps) || !j!.steps.length) return null;
  return { steps: j!.steps, alts: (Array.isArray(j!.alts) ? j!.alts : []).filter((a) => Array.isArray(a) && a.length) };
}
/** خطوات الطريقة الأولى (اللي تنعرض وتنعد «خطوات السؤال») */
export async function rubricOf(qid: number): Promise<RubricStep[] | null> {
  return (await rubricFull(qid))?.steps ?? null;
}
/** خطوات الطريقة اللي انصحح بيها الجواب: 1 الأولى، 2 فما فوق من الطرق الثانية. رقم ما موجود يرجع للأولى */
export const methodSteps = (r: Rubric, method = 1): RubricStep[] => r.alts[method - 2] ?? r.steps;
export const METHOD_NAME = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة"];
const methodName = (k: number) => METHOD_NAME[k - 1] ?? String(k);
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const cleanSteps = (raw: unknown): RubricStep[] => (Array.isArray(raw) ? raw : [])
  .map((s: any) => ({ text: String(s?.text ?? "").trim().slice(0, 2000), points: Number(s?.points) })).filter((s) => s.text);
/** يحفظ خطوات السؤال. alts: طرق الحل الثانية؛ إذا ما انرسلت تبقى المحفوظة مثل ما هي (تعديل الطريقة الأولى ما يمسحها) */
export async function saveRubric(qid: number, raw: unknown, by: number, altsRaw?: unknown) {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const steps = cleanSteps(raw);
  if (!steps.length) throw new Error("اكتب خطوة وحدة على الأقل");
  const alts = altsRaw === undefined ? (await rubricFull(qid))?.alts ?? [] : (Array.isArray(altsRaw) ? altsRaw : []).map(cleanSteps).filter((a) => a.length).slice(0, METHOD_NAME.length - 1);
  // كل طريقة لحالها لازم تساوي درجة السؤال: الطالب يحل بطريقة وحدة وياخذ بيها الدرجة كاملة
  for (const [k, way] of [steps, ...alts].entries()) {
    const where = alts.length ? ` بالطريقة ${methodName(k + 1)}` : "";
    if (way.some((s) => !Number.isFinite(s.points) || s.points < 0)) throw new Error(`درجة الخطوة لازم رقم${where}`);
    const sum = way.reduce((t, s) => t + s.points, 0);
    if (!near(sum, Number(q.max_mark))) throw new Error(`مجموع الخطوات${where} ${sum} ولازم يساوي درجة السؤال ${q.max_mark}`);
  }
  // فحص الخطوات بالجبر قبل الحفظ (AI_RUBRIC_CHECK=1): خطوة غلط تغلّط كل أوراق السؤال.
  // الخدمة ترجع بس الأخطاء المؤكدة (قيمة ما تحقق المعادلة اللي قبلها)، وإذا ما ردت نحفظ بدون فحص
  if (process.env.AI_RUBRIC_CHECK === "1" && aiLinked()) {
    for (const [k, way] of [steps, ...alts].entries()) {
      const errors = await rubricErrors(Number(q.max_mark), way);
      if (errors.length) throw new Error((k ? `الطريقة ${methodName(k + 1)}: ` : "") + errors.join(" | "));
    }
  }
  await kvSet(rubricKey(qid), JSON.stringify({ steps, ...(alts.length ? { alts } : {}), at: new Date().toISOString(), by }));
  return steps;
}
/** أخطاء الخطوات المؤكدة من خدمة التصحيح (/bot/rubric/check)، كل وحدة بسطر يقراه الأستاذ. فارغة إذا سليمة أو الخدمة ما ردت */
export async function rubricErrors(max: number, steps: RubricStep[]): Promise<string[]> {
  try {
    const r = await svc("/bot/rubric/check", { max_points: max, steps: steps.map((s) => ({ text: s.text, points: s.points })) }, 30_000);
    return (Array.isArray(r?.issues) ? r.issues : []).filter((i: any) => i?.severity === "error")
      .map((i: any) => (Number(i.step) > 0 ? `الخطوة ${i.step}: ` : "") + String(i.message ?? ""));
  } catch { return []; }
}
export const clearRubric = (qid: number) => kvSet(rubricKey(qid), "null");

// «خطوات الفصل كله»: المواضيع المأشرة تدخل بالدور، والمؤقت كل دقيقة يطلّع ويحفظ خطوات كم سؤال
// (الفصل ممكن بيه مية سؤال، فما يخلص بطلب واحد)
// re: أسئلة إلها خطوات بس جوابها النموذجي تبدل، فتنطلع خطواتها من جديد وتنحفظ فوك القديمة (القديمة تبقى بـ ai_rubric_prev_q_)
type DraftQueue = { q: number[]; tries: Record<string, number>; failed: string[]; re?: number[] };
const QUEUE = "ai_draft_queue", DRAFT_PER_TICK = 8, DRAFT_TRIES = 2;
const readQueue = () => readJson<DraftQueue>(QUEUE, { q: [], tries: {}, failed: [] });
async function needsDraft(examIds: number[]) {
  const todo: Row[] = [];
  let noSol = 0;
  for (const id of examIds) for (const v of await find("bank_versions", { exam_id: id })) for (const q of await find("bank_questions", { version_id: v.id }, { order: ["n"] })) {
    if (await rubricOf(q.id)) continue;
    if (!await hasSolution(q)) { noSol++; continue; }
    todo.push(q);
  }
  return { todo, noSol };
}
export async function queueDrafts(examIds: number[]) {
  const { todo, noSol } = await needsDraft(examIds);
  const st = await readQueue();
  const q = [...new Set([...st.q, ...todo.map((x) => x.id as number)])];
  await kvSet(QUEUE, JSON.stringify({ ...st, q, failed: [] }));
  return { added: todo.length, left: q.length, noSol };
}
/** الجواب النموذجي تبدل: خطوات هالأسئلة تنعاد من الجواب الجديد بدكات المؤقت */
export async function queueRedraft(ids: number[]) {
  const st = await readQueue();
  await kvSet(QUEUE, JSON.stringify({ ...st, q: [...new Set([...st.q, ...ids])], re: [...new Set([...(st.re ?? []), ...ids])] }));
}
export async function draftQueueState() {
  const st = await readQueue();
  return { left: st.q.length, failed: st.failed };
}
async function qLabel(qid: number) {
  const q = await one("bank_questions", { id: qid });
  const v = q && await one("bank_versions", { id: q.version_id });
  const e = v && await one("bank_exams", { id: v.exam_id });
  return q ? `${e?.title ?? ""} ${v?.model ?? ""} س${q.n}` : `سؤال ${qid}`;
}
/** دكة المؤقت: كم سؤال من الدور، أربعة بنفس الوقت. اللي يفشل مرتين يطلع من الدور وينكتب */
export async function draftQueueTick(by: number, limit = DRAFT_PER_TICK) {
  if (!aiLinked()) return { off: true };
  const st = await readQueue();
  if (!st.q.length) return { left: 0 };
  const batch = st.q.slice(0, limit);
  const ok: number[] = [], bad: number[] = [];
  const queue = [...batch], redo = new Set(st.re ?? []);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const old = await rubricFull(id);
        if (!old || redo.has(id)) {
          const d = await draftRubric(id);
          if (old) await kvSet(`ai_rubric_prev_q_${id}`, JSON.stringify(old));
          await saveRubric(id, d.steps, by, d.alts);
        }
        ok.push(id);
      }
      catch { bad.push(id); }
    }
  }));
  const now = await readQueue();
  const failed = [...now.failed];
  const tries = { ...now.tries };
  const drop = new Set(ok);
  for (const id of bad) {
    tries[id] = (tries[id] ?? 0) + 1;
    if (tries[id] >= DRAFT_TRIES) { drop.add(id); failed.push(await qLabel(id)); delete tries[id]; }
  }
  // اللي فشل مرة يرجع لآخر الدور
  const left = now.q.filter((id) => !drop.has(id) && !bad.includes(id)).concat(bad.filter((id) => !drop.has(id)));
  await kvSet(QUEUE, JSON.stringify({ q: left, tries, failed: failed.slice(-50), re: (now.re ?? []).filter((id) => left.includes(id)) }));
  return { done: ok.length, failed: bad.length, left: left.length };
}

/** «طلّع واحفظ خطوات كل أسئلة الموضوع»: كل سؤال بكل نماذج الامتحان إله صورة حل وما إله خطوات،
 *  تنطلع خطواته بدرجاتها المكتوبة على الحل وتنحفظ مباشرة. أربعة أسئلة بنفس الوقت */
export async function draftExam(examId: number, by: number) {
  const versions = await find("bank_versions", { exam_id: examId });
  const todo: Row[] = [];
  let noSol = 0;
  for (const v of versions) for (const q of await find("bank_questions", { version_id: v.id }, { order: ["n"] })) {
    if (await rubricOf(q.id)) continue;
    if (!await hasSolution(q)) { noSol++; continue; }
    todo.push(q);
  }
  const failed: string[] = [];
  let done = 0;
  const model = new Map(versions.map((v) => [v.id, v.model]));
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let q = queue.shift(); q; q = queue.shift()) {
      try { const d = await draftRubric(q.id); await saveRubric(q.id, d.steps, by, d.alts); done++; }
      catch { failed.push(`${model.get(q.version_id) ?? ""} س${q.n}`); }
    }
  }));
  return { done, failed, noSol };
}

/** صورة من مخزن الملفات، أو من تليجرام إذا انرفعت بالمحادثة */
export async function readRef(ref: string): Promise<Buffer | null> {
  if (ref.startsWith("tg:")) {
    const info: any = await api("getFile", { file_id: ref.slice(3) });
    if (!info?.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  return await files().read(ref);
}
export const isImage = (ref: string) => ref.startsWith("tg:") || /\.(jpe?g|png|webp)$/i.test(ref);
/** PDF الحل النموذجي مال النموذج (إذا الحل مرفوع ملف وحد مو صورة لكل سؤال) */
export async function solutionPdf(versionId: number): Promise<Buffer | null> {
  const v = await one("bank_versions", { id: versionId });
  return v?.answer_pdf ? await readRef(String(v.answer_pdf)) : null;
}
/** السؤال إله حل نموذجي: صورة إله، أو PDF النموذج */
async function hasSolution(q: Row) {
  if ((JSON.parse(q.a_files || "[]") as string[]).some(isImage)) return true;
  return !!(await one("bank_versions", { id: q.version_id }))?.answer_pdf;
}

// خدمة التصحيح على Cloud Run خاصة: تقبل بس حساب البوت بـ Google. على السيرفر ناخذ رمز الدخول من Google نفسه
// (خادم المعلومات الداخلي)، ونحفظه لحد قبل ما ينتهي بشوية. برة Google (الفحوصات) ماكو رمز، والمفتاح يكفي
let idCache: { aud: string; token: string; until: number } | null = null;
async function googleIdToken(aud: string): Promise<string | null> {
  if (!process.env.K_SERVICE) return null;
  if (idCache && idCache.aud === aud && Date.now() < idCache.until) return idCache.token;
  try {
    const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(aud)}`,
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const token = (await r.text()).trim();
    idCache = { aud, token, until: Date.now() + 45 * 60_000 };
    return token;
  } catch { return null; }
}

export async function svc(route: string, body: object, ms = 120_000): Promise<any> {
  if (!aiLinked()) throw new Error("نظام التصحيح AI مو مربوط");
  const token = await googleIdToken(svcUrl());
  const res = await fetch(svcUrl() + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Key": svcKey(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`خدمة التصحيح ردت ${res.status}`);
  return await res.json();
}

/** يطلع خطوات من صور حل المدرس، وصاحب البوت يعدلها قبل الحفظ.
 *  إذا الحل بيه أكثر من طريقة كاملة («الطريقة الثانية»)، كل طريقة ترجع لحالها بدرجتها الكاملة */
export async function draftRubric(qid: number): Promise<Rubric> {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const refs: string[] = JSON.parse(q.a_files || "[]");
  const imgs = (await Promise.all(refs.filter(isImage).map(readRef))).filter((b): b is Buffer => !!b);
  let body: object;
  if (imgs.length) body = { max_points: Number(q.max_mark), images: imgs.map((b) => b.toString("base64")) };
  else {
    // الحل النموذجي مرفوع PDF للنموذج كله: الخدمة تلگى السؤال بداخله من علامة «س1، س2...»
    const pdf = await solutionPdf(q.version_id);
    if (!pdf) throw new Error("هذا السؤال ما بيه صورة حل ولا PDF حل للنموذج");
    body = { max_points: Number(q.max_mark), pdf: pdf.toString("base64"), question: Number(q.n) };
  }
  const r = await svc("/bot/rubric", body, 180_000);
  await addLog({ at: stamp(), kind: "rubric", q: qid, usage: sumUsage([r.usage ?? []]) });
  const way = (list: unknown): RubricStep[] => (Array.isArray(list) ? list : []).map((s: any) => ({ text: String(s?.text ?? ""), points: Number(s?.points) || 0 }));
  return { steps: way(r.steps), alts: (Array.isArray(r.alternatives) ? r.alternatives : []).map(way).filter((a: RubricStep[]) => a.length) };
}

export type AiQuestion = { n: number; score: number; max: number; review: boolean; reason: string; note?: string; lines: string[]; steps: { status: string; awarded: number; possible: number; reason: string; reason_ar?: string; reason_en?: string; expected: string; student: string; student_tex?: string; analysis_failed?: boolean; student_message?: string }[]; usage?: Usage[]; photo?: PhotoFlag[];
  /** طريقة الحل اللي انحسبت بيها الدرجة إذا مو الأولى (2 = الطريقة الثانية بالحل النموذجي) */
  method?: number };
/** صورة معتمة أو مهزوزة بجواب سؤال: رقم الصورة بالسؤال (من 1) وشنو بيها. ما توگف التصحيح، بس الأستاذ يتبلغ */
export type PhotoFlag = { page: number; problem: "dark" | "blurred" };
export const PHOTO_PERM = "aiphoto";
const PHOTO_WORD: Record<PhotoFlag["problem"], string> = { dark: "معتمة جداً", blurred: "مهزوزة" };
/** من رد خدمة التصحيح (photo_quality: سطر لكل صورة بالترتيب) للصور اللي بيها مشكلة بس */
export function photoFlags(raw: unknown): PhotoFlag[] {
  return (Array.isArray(raw) ? raw : []).flatMap((q: any, i): PhotoFlag[] => (q?.problem === "dark" || q?.problem === "blurred" ? [{ page: i + 1, problem: q.problem }] : []));
}
/** نص تنبيه الأستاذ: أي سؤال وأي صورة. فارغ إذا كل الصور واضحة */
export function photoAlert(name: string, exam: string, res: AiQuestion[]): string {
  const lines = res.flatMap((q) => (q.photo ?? []).map((f) => `• س${q.n}، الصورة ${f.page}: ${PHOTO_WORD[f.problem]}`));
  if (!lines.length) return "";
  return `👤 <b>تنبيه إداري، ما يوصل للطالب</b>\n📷 <b>صورة مو واضحة بورقة عند نظام التصحيح AI</b>\nالطالب: <b>${name}</b>\nالامتحان: ${exam}\n${lines.join("\n")}\n\nالورقة ما توگفت: انصححت مثل باقي الأوراق. إذا تريد تتأكد من درجتها افتح 🎓 الطلاب ← الطالب ← 📝 أوراقه.`;
}
export async function aiResultOf(itemId: number): Promise<AiQuestion[] | null> {
  const j = await readJson<AiQuestion[] | null>(resultKey(itemId), null);
  return Array.isArray(j) ? j : null;
}

/** يصحح ورقة وحدة: يرجع درجة كل سؤال، أو يرمي خطأ إذا ما يگدر */
async function gradePaper(it: Row, withExamples = true, photo = false): Promise<AiQuestion[]> {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  if (!qs.length) throw new Error("ماكو أسئلة");
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  if (answers.some((a) => !a.q)) throw new Error("الجواب ملف كامل");
  if (answers.some((a) => !isImage(a.file))) throw new Error("الجواب مو صورة");
  // ورقة بلا ولا صورة جواب: مو «ما جاوب»، الصور بعدها ما وصلت
  if (!answers.length) throw new Error("ماكو صور جواب بالورقة");
  return await Promise.all(qs.map(async (q): Promise<AiQuestion> => {
    const rubric = await rubricFull(q.id);
    if (!rubric) throw new Error(`سؤال ${q.n} بدون خطوات`);
    const max = Number(q.max_mark);
    const mine = answers.filter((a) => a.q === q.n);
    // ما جاوب: صفر بدون ما نسأل الخدمة
    if (!mine.length) return { n: q.n, score: 0, max, review: false, reason: "ما جاوب", lines: [], steps: [], usage: [] };
    const imgs = await Promise.all(mine.map((a) => readRef(a.file)));
    if (imgs.some((b) => !b)) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
    if (photo) return await gradePhoto(q, rubric.steps, imgs as Buffer[]);
    return await gradeBest(q, rubric, imgs as Buffer[], withExamples ? await examplesFor(it.exam_id, it.version_id, q.n) : []);
  }));
}
type Example = { student: string; ai: number; teacher: number };
/** أمثلة من أول أوراق الموضوع اللي صححها الأستاذ بإيده: شنو قرا نظام التصحيح، شگد كان يعطي، وشگد عطى الأستاذ.
 *  اللي اختلف بيها أول، لأن منها يتعلم */
export async function examplesFor(_examId: number, versionId: number, n: number): Promise<Example[]> {
  const out: Example[] = [];
  for (const id of await calibList(versionId)) {
    const it = await one("sched_items", { id });
    if (!it?.graded_at) continue;
    const ai = (await shadowOf(id))?.find((x) => x.n === n);
    const mark = await one("question_marks", { item_id: id, q: n });
    // «⏭ ترك» (-1) مو درجة يتعلم منها
    if (!ai || !mark || Number(mark.mark) < 0 || !ai.lines?.length) continue;
    out.push({ student: ai.lines.join(" ; ").slice(0, 400), ai: ai.score, teacher: Number(mark.mark) || 0 });
  }
  return out.sort((a, b) => Math.abs(b.teacher - b.ai) - Math.abs(a.teacher - a.ai)).slice(0, 6);
}
// نفس الصور ونفس الخطوات = نفس النتيجة: تنحفظ أول مرة، والمرة الثانية ترجع المحفوظة بدون تصحيح جديد ولا كلفة
const ENGINE = "rubric-4";
// نسخة محرك التصحيح ترجعها الخدمة من /health (تتغير لحالها كل ما يتغير كود التصحيح)، وتدخل بمفتاح الحفظ:
// محرك جديد ما يرجّع درجات محفوظة من محرك قديم، وما واحد يحتاج يتذكر يغيّر الاسم بإيده
let engineSeen: { at: number; version: string } | null = null;
const ENGINE_TTL_MS = 10 * 60_000;
async function engineVersion(): Promise<string> {
  if (engineSeen && Date.now() - engineSeen.at < ENGINE_TTL_MS) return engineSeen.version;
  let version = "";
  try {
    const token = await googleIdToken(svcUrl());
    const res = await fetch(svcUrl() + "/health", { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10_000) });
    if (res.ok) version = String((await res.json())?.engine_version ?? "");
  } catch { /* الخدمة ما ردت: نبقى على الاسم الثابت */ }
  engineSeen = { at: Date.now(), version };
  return version;
}
const cacheKey = (steps: RubricStep[], imgs: Buffer[], version = "") => {
  const h = createHash("sha256").update(engineTag(ENGINE, version)).update(JSON.stringify(steps));
  for (const b of imgs) h.update(b);
  return `ai_cache_${h.digest("hex").slice(0, 40)}`;
};
/** يرسل جواب سؤال واحد (صوره) للخدمة ويا خطوات حله */
async function gradeQuestion(q: Row, steps: RubricStep[], imgs: Buffer[], examples: Example[] = []): Promise<AiQuestion> {
  const max = Number(q.max_mark);
  const useCache = process.env.AI_CACHE !== "0";
  const key = cacheKey(steps, imgs, useCache ? await engineVersion() : "");
  if (useCache) {
    const hit = await readJson<AiQuestion | null>(key, null);
    if (hit && typeof hit.score === "number") return { ...hit, n: q.n, usage: [] };
  }
  const r = await svc("/bot/grade", {
    max_points: max,
    steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
    images: imgs.map((b) => b.toString("base64")),
    examples,
  // نصبر لحد 4 دقايق قبل ما نعيدها بالدكة الجاية
  }, 230_000);
  const score = Math.max(0, Math.min(max, Math.round(Number(r.score) || 0)));
  const res: AiQuestion = { n: q.n, score, max, review: !!r.requires_review, reason: String(r.review_reason ?? ""), note: String(r.note ?? ""), lines: r.student_lines ?? [], steps: r.steps ?? [], usage: r.usage ?? [] };
  const photo = photoFlags(r.photo_quality);
  if (photo.length) res.photo = photo;
  // ما نحفظ نتيجة ما متأكد منها: المرة الجاية تنصحح من جديد
  if (useCache && !res.review) await kvSet(key, JSON.stringify({ ...res, usage: [] }));
  return res;
}
/** الطالب يحل بطريقة وحدة من طرق الحل النموذجي: يتصحح بالطريقة الأولى، وإذا ما أخذ الدرجة كاملة وللسؤال طرق ثانية
 *  يتصحح بيها هم، وتنحسب له أعلى درجة. method يگول بأي طريقة انحسبت (حتى الاعتراض وعرض الحل يمشون عليها) */
async function gradeBest(q: Row, rubric: Rubric, imgs: Buffer[], examples: Example[] = []): Promise<AiQuestion> {
  let best = await gradeQuestion(q, rubric.steps, imgs, examples);
  const usage = [...(best.usage ?? [])];
  for (const [i, way] of rubric.alts.entries()) {
    if (best.score >= best.max) break;
    const r = await gradeQuestion(q, way, imgs, examples);
    usage.push(...(r.usage ?? []));
    // نفس الدرجة: المتأكد منها أولى من اللي مو متأكد منها
    if (r.score > best.score || (r.score === best.score && best.review && !r.review)) best = { ...r, method: i + 2 };
  }
  return { ...best, usage };
}
/** 🔬 نفس السؤال بمصحح Math-Grading وهو يشوف الصور، للمقارنة بس */
async function gradePhoto(q: Row, steps: RubricStep[], imgs: Buffer[]): Promise<AiQuestion> {
  const max = Number(q.max_mark);
  const r = await svc("/bot/grade", {
    max_points: max, engine: "photo", feedback: false,
    steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
    images: imgs.map((b) => b.toString("base64")),
  }, 230_000);
  return { n: q.n, score: Math.max(0, Math.min(max, Math.round(Number(r.score) || 0))), max, review: !!r.requires_review, reason: String(r.review_reason ?? ""), lines: r.student_lines ?? [], steps: r.steps ?? [], usage: r.usage ?? [] };
}
/** «🧪 جرّب على جواب حقيقي»: صاحب البوت يرفع صور جواب سؤال، ونظام التصحيح يصححها ويرجع النتيجة بس.
 *  ما تنحفظ درجة لأحد وما توصل رسالة لأحد، بس الكلفة تنحسب بالسجل */
export async function tryGrade(qid: number, imgs: Buffer[]): Promise<AiQuestion> {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const rubric = await rubricFull(q.id);
  if (!rubric) throw new Error("احفظ خطوات حل هذا السؤال أول");
  if (!imgs.length) throw new Error("اختار صورة الجواب");
  const v = await one("bank_versions", { id: q.version_id });
  const res = await gradeBest(q, rubric, imgs, v ? await examplesFor(v.exam_id, q.version_id, q.n) : []);
  await addLog({ at: stamp(), kind: "try", q: qid, usage: sumUsage([res.usage ?? []]) });
  return { ...res, usage: undefined };
}

/** ليش نظام التصحيح ما ياخذ أوراق هذا النموذج: طافي، أو الموضوع مو مأشر، أو باقي خطوات. null يعني ياخذها */
export async function aiWhyNot(examId: number, versionId: number): Promise<string | null> {
  if (!aiLinked()) return "خدمة التصحيح مو مربوطة بالسيرفر";
  if (!await aiOn()) return "نظام التصحيح AI طافي. شغّله من صفحته (▶️ شغل نظام التصحيح AI)";
  if (!(await aiSettings()).exams.includes(examId)) return "هذا الموضوع مو مأشر بمربع «المواضيع اللي يصححها نظام التصحيح AI». أشّره ودوس حفظ";
  const qs = await find("bank_questions", { version_id: versionId }, { order: ["n"] });
  const missing: number[] = [];
  for (const q of qs) if (!await rubricOf(q.id)) missing.push(q.n);
  if (!qs.length) return "هذا النموذج ما بيه أسئلة";
  if (missing.length) return `باقي خطوات الأسئلة ${missing.join("، ")} بهذا النموذج`;
  return null;
}
/** أسئلة الورقة اللي صححها نظام التصحيح AI (اعتراضها يراجعه هو، مو المصحح) */
export async function aiQuestions(it: Row): Promise<Set<number>> {
  const qs = (await find("bank_questions", { version_id: it.version_id })).map((q) => q.n as number);
  if (it.grader_id === AI_GRADER) return new Set(qs);
  const part = await aiPartialOf(it.id);
  return new Set(part ? qs.filter((n) => !part.includes(n)) : []);
}
/** نظام التصحيح AI يراجع اعتراض الطالب على سؤال صححه: يقبل ويعطي الدرجة الجديدة، لو يرفض ويگول ليش */
export async function aiJudgeObjection(it: Row, qn: number, text: string, oldMark: number) {
  const q = await one("bank_questions", { version_id: it.version_id, n: qn });
  if (!q) throw new Error("السؤال غير موجود");
  const rubric = await rubricFull(q.id);
  if (!rubric) throw new Error(`سؤال ${qn} بدون خطوات`);
  const imgs = (await Promise.all((await find("exam_answers", { item_id: it.id, q: qn }, { order: ["id"] })).map((a) => readRef(a.file)))).filter((b): b is Buffer => !!b);
  if (!imgs.length) throw new Error("ماكو صورة جواب لهذا السؤال");
  const old = (await aiResultOf(it.id))?.find((x) => x.n === qn);
  // الاعتراض ينحكم على نفس طريقة الحل اللي انحسبت بيها الدرجة
  const steps = methodSteps(rubric, old?.method);
  const r = await svc("/bot/objection", {
    max_points: Number(q.max_mark), old_score: oldMark, objection: text.slice(0, OBJECTION_MAX) || "الطالب يشوف درجته مو صحيحة",
    steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
    old_steps: old ? JSON.stringify(old.steps.map((s) => ({ status: s.status, awarded: s.awarded, possible: s.possible, reason: s.reason_ar || s.reason, expected: s.expected }))) : "",
    images: imgs.map((b) => b.toString("base64")),
  });
  await addLog({ at: stamp(), kind: "objection", item: it.id, sid: it.user_id, note: r.accept ? `قبل اعتراض س${qn}` : `رفض اعتراض س${qn}`, usage: sumUsage([r.usage ?? []]) });
  const mark = Math.max(0, Math.min(Number(q.max_mark), Math.round(Number(r.new_score) || 0)));
  return { accept: !!r.accept && mark !== oldMark, mark, reason: String(r.reason ?? "") };
}

/** «🔁 خلي يعيد تصحيحها»: الورقة اللي حوّلها أو فشل بيها ترجع لدوره من جديد (إذا بعدها ما انصححت) */
export async function aiRetry(itemId: number) {
  const it = await one("sched_items", { id: itemId });
  if (!it || it.graded_at) throw new Error("الورقة انصححت، ما ترجع");
  await kvSet(triesKey(itemId), "0");
  await kvSet(errKey(itemId), "");
  await kvSet(resultKey(itemId), "null");
  await kvSet(partialKey(itemId), "[]");
  await remove("question_marks", { item_id: itemId });
  await update("sched_items", { id: itemId }, { grader_id: null });
}
/** أوراق المواضيع المأشرة اللي بعدها ما انصححت، ووين واقفة كل وحدة */
export async function aiPending(nameOf: (it: Row) => Promise<string>, staffName: (id: number) => Promise<string>) {
  const s = await aiSettings();
  const scope = new Set(s.exams), picked = new Set(s.students);
  const items = (await find("sched_items", { status: "done" })).filter((it) => !it.graded_at && (scope.has(it.exam_id) || picked.has(it.user_id))).slice(0, 40);
  const titles = new Map((await find("bank_exams")).map((e) => [e.id, e.title]));
  const why = new Map<number, string | null>();
  const calib = await aiCalibIds(items);
  return await Promise.all(items.map(async (it) => {
    let state: string;
    if (calib.has(it.id) && !it.grader_id) state = "🎓 من أول أوراق الموضوع: تنتظر تصحيحك إنت (أو مساعد عنده صلاحية 🎓)";
    else if (it.grader_id === AI_GRADER) state = "🤖 يصححها هسه";
    else if (it.grader_id) state = `✍️ بيد ${await staffName(it.grader_id)}`;
    else if ((Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES) state = `❌ ما گدر يصححها، فرجعت للمصححين${(await kvGet(errKey(it.id))) ? `: ${await kvGet(errKey(it.id))}` : ""}`;
    else {
      if (!why.has(it.version_id)) why.set(it.version_id, await aiWhyNot(it.exam_id, it.version_id));
      state = why.get(it.version_id) ? `⏸ ${why.get(it.version_id)}` : "⏳ بالدور، ياخذها خلال دقيقة";
    }
    const retry = (Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES || (!!it.grader_id && it.grader_id !== AI_GRADER);
    return { id: it.id as number, name: await nameOf(it), exam: titles.get(it.exam_id) ?? "", state, retry };
  }));
}

/** الورقة بموضوع يصححه نظام التصحيح، وكل أسئلتها إلها خطوات، وبعده ما خلص محاولاته */
async function makeTaker() {
  const active = aiLinked() && await aiOn();
  const s = await aiSettings();
  const scope = new Set(s.exams), picked = new Set(s.students);
  const verReady = new Map<number, boolean>();
  const calib = new Map<number, number[]>();
  return async (it: Row) => {
    if (!active || !(scope.has(it.exam_id) || picked.has(it.user_id)) || it.graded_at || it.grader_id || !it.version_id) return false;
    if ((Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES) return false;
    if (!verReady.has(it.version_id)) {
      const qs = await find("bank_questions", { version_id: it.version_id });
      let ok = qs.length > 0;
      for (const q of qs) if (ok && !await rubricOf(q.id)) ok = false;
      verReady.set(it.version_id, ok);
    }
    if (!verReady.get(it.version_id)) return false;
    // أول أوراق الموضوع (مو أوراق التجربة) تبقى للأستاذ: يصححها بإيده، ونظام التصحيح يتعلم منها.
    // الطالب اللي اختاره صاحب البوت للذكاء ما تنحجز أوراقه
    if (s.calib > 0 && it.user_id > 0 && scope.has(it.exam_id) && !picked.has(it.user_id)) {
      if (!calib.has(it.version_id)) calib.set(it.version_id, await calibList(it.version_id));
      const list = calib.get(it.version_id)!;
      if (list.includes(it.id)) return false;
      if (list.length < s.calib) { list.push(it.id); await kvSet(calibKey(it.version_id), JSON.stringify(list)); return false; }
    }
    return true;
  };
}
/** أوراق «أول الأوراق» اللي بعدها ما انصححت: تطلع بس لصاحب البوت وللمساعد اللي عنده صلاحية 🎓 */
export async function aiCalibIds(papers: Row[]): Promise<Set<number>> {
  const s = await aiSettings();
  const out = new Set<number>();
  if (!aiLinked() || !await aiOn() || s.calib <= 0) return out;
  const lists = new Map<number, Set<number>>();
  for (const p of papers) {
    if (p.graded_at || !s.exams.includes(p.exam_id)) continue;
    if (!p.version_id) continue;
    if (!lists.has(p.version_id)) lists.set(p.version_id, new Set(await calibList(p.version_id)));
    if (lists.get(p.version_id)!.has(p.id)) out.add(p.id);
  }
  return out;
}
type CalibPaper = { name: string; teacher: number | null; ai: number | null };
/** صفحة صاحب البوت: لكل موضوع مأشر وكل نموذج بيه، كم ورقة صحح هو، ودرجته جنب درجة نظام التصحيح */
export async function calibState(nameOf: (it: Row) => Promise<string>) {
  const s = await aiSettings();
  const titles = new Map((await find("bank_exams")).map((e) => [e.id as number, String(e.title ?? "")]));
  const out: { exam: number; title: string; done: number; of: number; versions: { model: string; done: number; of: number; papers: CalibPaper[] }[] }[] = [];
  for (const examId of s.exams) {
    const versions = [];
    for (const v of await find("bank_versions", { exam_id: examId }, { order: ["model"] })) {
      const papers: CalibPaper[] = [];
      let done = 0;
      for (const id of await calibList(v.id)) {
        const it = await one("sched_items", { id });
        if (!it) continue;
        if (it.graded_at) done++;
        const sh = await shadowOf(id);
        papers.push({ name: await nameOf(it), teacher: it.graded_at ? Number(it.total ?? 0) : null, ai: sh ? sh.reduce((t, q) => t + q.score, 0) : null });
      }
      versions.push({ model: String(v.model ?? ""), done, of: s.calib, papers });
    }
    out.push({ exam: examId, title: titles.get(examId) ?? "", done: versions.reduce((t, v) => t + v.done, 0), of: s.calib * versions.length, versions });
  }
  return out;
}
/** نظام التصحيح يصحح أول الأوراق بالسر (ما تنحفظ درجة، وما يوصل شي للطالب)، حتى نقارنه بالأستاذ */
async function shadowTick(limit: number) {
  const s = await aiSettings();
  let n = 0;
  const vids = (await find("bank_versions")).filter((v) => s.exams.includes(v.exam_id)).map((v) => v.id as number);
  for (const vid of vids) {
    for (const id of await calibList(vid)) {
      if (n >= limit) return n;
      if (await shadowOf(id)) continue;
      const tries = Number(await kvGet(shadowTryKey(id))) || 0;
      if (tries >= MAX_TRIES) continue;
      const it = await one("sched_items", { id });
      if (!it || it.status !== "done") continue;
      n++;
      await kvSet(shadowTryKey(id), String(tries + 1));
      try {
        const res = await gradePaper(it, false);
        await kvSet(shadowKey(id), JSON.stringify(res));
        await addLog({ at: stamp(), kind: "calib", item: id, sid: it.user_id, exam: (await one("bank_exams", { id: it.exam_id }))?.title ?? "", total: res.reduce((t, q) => t + q.score, 0), usage: sumUsage(res.map((q) => q.usage ?? [])) });
      } catch (e) { console.error("ai shadow", id, e); }
    }
  }
  return n;
}
/** الأوراق اللي تدخل المقارنة: أول أوراق كل نموذج، وأوراق طلاب التجربة، بالمواضيع المأشرة */
async function compareItems(): Promise<Row[]> {
  const s = await aiSettings();
  const seen = new Map<number, Row>();
  for (const v of await find("bank_versions")) {
    if (!s.exams.includes(v.exam_id)) continue;
    for (const id of await calibList(v.id)) { const it = await one("sched_items", { id }); if (it) seen.set(id, it); }
  }
  for (const it of await find("sched_items", { status: "done" })) if (it.user_id < 0 && s.exams.includes(it.exam_id)) seen.set(it.id, it);
  return [...seen.values()].filter((it) => it.status === "done" && it.version_id).sort((a, b) => b.id - a.id);
}
/** 🔬 يصحح الأوراق بالسر بالمصحح الثاني. يشتغل بس إذا ماكو أوراق حقيقية تنتظر بهذي الدكة */
async function photoTick(limit: number) {
  // AI_COMPARE=0 يطفي المقارنة السرية: المصحح الثاني يكلف أكثر من التصحيح الحقيقي، وبعد ما تنقاس الدقة ما إلها حاجة
  if (process.env.AI_COMPARE === "0") return 0;
  const todo: Row[] = [];
  for (const it of await compareItems()) {
    if (todo.length >= limit) break;
    if (await readJson<AiQuestion[] | null>(photoKey(it.id), null)) continue;
    const tries = Number(await kvGet(photoTryKey(it.id))) || 0;
    if (tries >= MAX_TRIES) continue;
    await kvSet(photoTryKey(it.id), String(tries + 1));
    todo.push(it);
  }
  await Promise.all(todo.map(async (it) => {
    try {
      const res = await gradePaper(it, false, true);
      await kvSet(photoKey(it.id), JSON.stringify(res));
      await addLog({ at: stamp(), kind: "calib", note: "🔬 المقارنة", item: it.id, sid: it.user_id, exam: (await one("bank_exams", { id: it.exam_id }))?.title ?? "", total: res.reduce((t, q) => t + q.score, 0), usage: sumUsage(res.map((q) => q.usage ?? [])) });
    } catch (e) { console.error("ai photo", it.id, e); }
  }));
  return todo.length;
}
const totalOf = (r: AiQuestion[] | null) => (r ? r.reduce((t, q) => t + q.score, 0) : null);
/** 🔬 صفحة صاحب البوت: درجة الأستاذ ودرجة كل مصحح وكلفته، ومعدل بُعد كل مصحح عن الأستاذ */
export async function compareState(nameOf: (it: Row) => Promise<string>, prices: Record<string, Price>) {
  const titles = new Map((await find("bank_exams")).map((e) => [e.id as number, String(e.title ?? "")]));
  const models = new Map((await find("bank_versions")).map((v) => [v.id as number, String(v.model ?? "")]));
  const rows: { id: number; name: string; exam: string; model: string; teacher: number | null; current: number | null; photo: number | null; currentIqd: number | null; photoIqd: number | null }[] = [];
  for (const it of (await compareItems()).slice(0, 40)) {
    const cur = await shadowOf(it.id) ?? await aiResultOf(it.id);
    const photo = await readJson<AiQuestion[] | null>(photoKey(it.id), null);
    const paid = (r: AiQuestion[] | null) => (r ? Math.round(costOf(r.flatMap((q) => q.usage ?? []), prices) * 1600) : null);
    rows.push({ id: it.id as number, name: await nameOf(it), exam: titles.get(it.exam_id) ?? "", model: models.get(it.version_id) ?? "",
      teacher: it.graded_at && it.grader_id !== AI_GRADER ? Number(it.total ?? 0) : null, current: totalOf(cur), photo: totalOf(photo), currentIqd: paid(cur), photoIqd: paid(photo) });
  }
  const gap = (k: "current" | "photo") => {
    const both = rows.filter((r) => r.teacher !== null && r[k] !== null);
    return both.length ? Math.round((both.reduce((t, r) => t + Math.abs(r[k]! - r.teacher!), 0) / both.length) * 10) / 10 : null;
  };
  return { rows, compared: rows.filter((r) => r.teacher !== null && r.current !== null && r.photo !== null).length, currentGap: gap("current"), photoGap: gap("photo") };
}
/** أوراق ينتظرها نظام التصحيح: ما تطلع للمصححين لحد ما يجربها، حتى ما ياخذها مصحح قبله */
export async function aiHeld(papers: Row[]): Promise<Set<number>> {
  const take = await makeTaker();
  const out = new Set<number>();
  for (const p of papers) if (await take(p)) out.add(p.id);
  return out;
}

async function forward(it: Row, res: AiQuestion[], usage: Usage[], nameOf: (it: Row) => Promise<string>) {
  const e = await one("bank_exams", { id: it.exam_id });
  const to = e ? (await aiSettings()).unsure[e.slug] ?? 0 : 0;
  // ما ينحسب كمحاولة فاشلة، بس ما يرجع ياخذها
  await kvSet(triesKey(it.id), String(MAX_TRIES));
  // الأسئلة الواثق منها تنحفظ درجتها، والمصحح يصحح بس اللي ما متأكد منها
  const unsureQs = res.filter((q) => q.review).map((q) => q.n);
  for (const q of res) if (!q.review) await put("question_marks", { item_id: it.id, q: q.n, mark: q.score });
  await kvSet(partialKey(it.id), JSON.stringify(unsureQs.length < res.length ? unsureQs : []));
  await update("sched_items", { id: it.id }, { grader_id: to || null });
  const name = await nameOf(it);
  const why = res.filter((q) => q.review).map((q) => `• س${q.n}: ${q.reason || "ما متأكد"}`).join("\n");
  const text = `👤 <b>لصاحب البوت بس، ما توصل للطالب</b>\n🤖 <b>نظام التصحيح AI حوّل ورقة</b>\nصحح باقي الأسئلة، وهذني ما متأكد منها، فلازم تنصحح بالإيد (بس هذني):\nالطالب: <b>${name}</b>\nالامتحان: ${e?.title ?? ""}\n${why}\n\nافتح لوحة التحكم ← ✍️ التصحيح.`;
  // ما محدد مصحح لهذا الفصل: الخبر يوصل لصاحب البوت، حتى الورقة ما تضيع بالقائمة بدون ما أحد يدري
  for (const id of to ? [to] : ADMIN_IDS) await send(id, text);
  await addLog({ at: stamp(), kind: "unsure", item: it.id, sid: it.user_id, name, exam: e?.title ?? "", to: to || null, usage });
}

/** دكة المؤقت: ياخذ كم ورقة ويصححها. الواثق منها توصل للطالب، واللي مو متأكد منها تروح لمصحح */
/** الحد اليومي لكلفة نظام التصحيح (AI_DAILY_USD_CAP بالدولار). من يوصله يوگف لباچر، والأوراق تبقى تنتظر، وصاحب البوت يتبلغ مرة باليوم */
async function overDailyCap(): Promise<boolean> {
  const cap = dailyCap(process.env.AI_DAILY_USD_CAP);
  if (cap === null) return false;
  const day = dayOf(stamp());
  const spent = spentOn(day, await aiLog(), await prices());
  if (!overCap(spent, cap)) return false;
  const noteKey = `ai_cap_note_${day}`;
  if (!await kvGet(noteKey)) {
    await kvSet(noteKey, "1");
    const text = "👤 <b>لصاحب البوت بس</b>\n⚠️ نظام التصحيح AI وصل الحد اليومي للكلفة (" + cap + " دولار) فوگف لباچر. الأوراق تبقى تنتظر.\nكلفة اليوم: " + spent.toFixed(2) + " دولار";
    for (const id of ADMIN_IDS) await send(id, text);
  }
  return true;
}
export async function aiGradeTick(finish: (uid: number, itemId: number) => Promise<unknown>, nameOf: (it: Row) => Promise<string>, limit = PER_TICK) {
  if (!aiLinked() || !await aiOn()) return { off: true };
  if (await overDailyCap()) return { capped: true };
  const take = await makeTaker();
  const picked: Row[] = [];
  for (const it of await find("sched_items", { status: "done" }, { order: ["id"] })) {
    if (picked.length >= limit) break;
    if (!await take(it)) continue;
    await update("sched_items", { id: it.id }, { grader_id: AI_GRADER });
    // مصحح أخذها بنفس اللحظة: نتركها إله
    if ((await one("sched_items", { id: it.id }))?.grader_id !== AI_GRADER) continue;
    picked.push(it);
  }
  const shadow = await shadowTick(Math.max(2, limit - picked.length));
  let graded = 0, unsure = 0, failed = 0;
  await Promise.all(picked.map(async (it) => {
    try {
      const res = await gradePaper(it);
      const usage = sumUsage(res.map((q) => q.usage ?? []));
      await kvSet(resultKey(it.id), JSON.stringify(res));
      // صورة معتمة أو مهزوزة ما توگف الورقة: تنصحح عادي، والأستاذ (واللي عنده صلاحية 📷) يتبلغ بالسؤال ورقم الصورة
      const alert = photoAlert(await nameOf(it), (await one("bank_exams", { id: it.exam_id }))?.title ?? "", res);
      if (alert) for (const id of await staffIds(PHOTO_PERM)) await send(id, alert).catch((e) => console.error("ai photo alert", it.id, e));
      if (res.some((q) => q.review)) { await forward(it, res, usage, nameOf); unsure++; return; }
      for (const q of res) await put("question_marks", { item_id: it.id, q: q.n, mark: q.score });
      await finish(AI_GRADER, it.id);
      await addLog({ at: stamp(), kind: "sent", item: it.id, sid: it.user_id, name: await nameOf(it), exam: (await one("bank_exams", { id: it.exam_id }))?.title ?? "", total: res.reduce((t, q) => t + q.score, 0), usage });
      graded++;
    } catch (e) {
      console.error("ai grade", it.id, e);
      failed++;
      const note = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      await kvSet(errKey(it.id), note);
      await addLog({ at: stamp(), kind: "failed", item: it.id, sid: it.user_id, name: await nameOf(it), exam: (await one("bank_exams", { id: it.exam_id }))?.title ?? "", note, usage: [] });
      const tries = (Number(await kvGet(triesKey(it.id))) || 0) + 1;
      await kvSet(triesKey(it.id), String(tries));
      // آخر محاولة فشلت: الورقة ترجع للمصححين، وصاحب البوت يدري
      if (tries >= MAX_TRIES) for (const id of ADMIN_IDS) await send(id, `👤 <b>لصاحب البوت بس، ما توصل للطالب</b>\n⚠️ نظام التصحيح AI ما گدر يصحح ورقة <b>${await nameOf(it)}</b> (${MAX_TRIES} مرات)، فرجعت للمصححين.\nالسبب: ${note}`);
      const now = await one("sched_items", { id: it.id });
      if (now && !now.graded_at && now.grader_id === AI_GRADER) {
        await update("sched_items", { id: it.id }, { grader_id: null });
        await remove("question_marks", { item_id: it.id });
      }
    }
  }));
  // المقارنة ما تأخر التصحيح الحقيقي
  const compared = picked.length ? 0 : await photoTick(2);
  return { graded, unsure, failed, ...(shadow ? { shadow } : {}), ...(compared ? { compared } : {}) };
}
