// نظام التصحيح AI: يصحح الأوراق وحده بخوارزمية Math-Grading (مجلد grading-ai، خدمة Python لحالها).
// صاحب البوت يختار المواضيع اللي يصححها، وكل سؤال يحتاج «خطوات الحل ودرجة كل خطوة».
// الورقة اللي هو مو متأكد منها تروح للمصحح اللي صاحب البوت اختاره لفصلها، بدون ما توصل للطالب.
// الورقة اللي ما يگدر عليها (سؤال بدون خطوات، جواب ملف كامل، الخدمة عطلانة) تبقى للمصححين مثل قبل.
import { find, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { AI_GRADER } from "./data.ts";
import { files } from "./files.ts";
import { api, send } from "./telegram.ts";
import { ADMIN_IDS, TOKEN } from "./config.ts";
import { stamp } from "./util.ts";

export type RubricStep = { text: string; points: number };
export type Usage = { model: string; calls: number; input: number; output: number };
export type Price = { in: number; out: number };
/** المواضيع اللي يصححها، ولكل فصل المصحح اللي توصله الأوراق اللي مو متأكد منها */
export type AiSettings = { exams: number[]; unsure: Record<string, number> };
/** سطر بسجل نظام التصحيح: ورقة صححها، أو ورقة حولها لمصحح، أو خطوات طلعها من صورة حل */
export type LogRow = { at: string; kind: "sent" | "unsure" | "rubric" | "try" | "failed" | "objection"; note?: string; item?: number; sid?: number; name?: string; exam?: string; total?: number; to?: number | null; q?: number; usage: Usage[] };

const rubricKey = (qid: number) => `ai_rubric_q_${qid}`;
const resultKey = (itemId: number) => `ai_result_${itemId}`;
const triesKey = (itemId: number) => `ai_try_${itemId}`;
const errKey = (itemId: number) => `ai_err_${itemId}`;
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
const PER_TICK = 3;
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
  return { exams: Array.isArray(s.exams) ? s.exams.map(Number) : [], unsure: s.unsure && typeof s.unsure === "object" ? s.unsure : {} };
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

export async function rubricOf(qid: number): Promise<RubricStep[] | null> {
  const j = await readJson<{ steps?: RubricStep[] } | null>(rubricKey(qid), null);
  return Array.isArray(j?.steps) && j!.steps.length ? j!.steps : null;
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
export async function saveRubric(qid: number, raw: unknown, by: number) {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const steps: RubricStep[] = (Array.isArray(raw) ? raw : []).map((s: any) => ({ text: String(s?.text ?? "").trim().slice(0, 2000), points: Number(s?.points) }))
    .filter((s) => s.text);
  if (!steps.length) throw new Error("اكتب خطوة وحدة على الأقل");
  if (steps.some((s) => !Number.isFinite(s.points) || s.points < 0)) throw new Error("درجة الخطوة لازم رقم");
  const sum = steps.reduce((t, s) => t + s.points, 0);
  if (!near(sum, Number(q.max_mark))) throw new Error(`مجموع الخطوات ${sum} ولازم يساوي درجة السؤال ${q.max_mark}`);
  await kvSet(rubricKey(qid), JSON.stringify({ steps, at: new Date().toISOString(), by }));
  return steps;
}
export const clearRubric = (qid: number) => kvSet(rubricKey(qid), "null");

// «خطوات الفصل كله»: المواضيع المأشرة تدخل بالدور، والمؤقت كل دقيقة يطلّع ويحفظ خطوات كم سؤال
// (الفصل ممكن بيه مية سؤال، فما يخلص بطلب واحد)
type DraftQueue = { q: number[]; tries: Record<string, number>; failed: string[] };
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
  await kvSet(QUEUE, JSON.stringify({ q, tries: st.tries, failed: [] }));
  return { added: todo.length, left: q.length, noSol };
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
  const queue = [...batch];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try { if (!await rubricOf(id)) await saveRubric(id, await draftRubric(id), by); ok.push(id); }
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
  await kvSet(QUEUE, JSON.stringify({ q: left, tries, failed: failed.slice(-50) }));
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
      try { await saveRubric(q.id, await draftRubric(q.id), by); done++; }
      catch { failed.push(`${model.get(q.version_id) ?? ""} س${q.n}`); }
    }
  }));
  return { done, failed, noSol };
}

/** صورة من مخزن الملفات، أو من تليجرام إذا انرفعت بالمحادثة */
async function readRef(ref: string): Promise<Buffer | null> {
  if (ref.startsWith("tg:")) {
    const info: any = await api("getFile", { file_id: ref.slice(3) });
    if (!info?.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  return await files().read(ref);
}
const isImage = (ref: string) => ref.startsWith("tg:") || /\.(jpe?g|png|webp)$/i.test(ref);
/** PDF الحل النموذجي مال النموذج (إذا الحل مرفوع ملف وحد مو صورة لكل سؤال) */
async function solutionPdf(versionId: number): Promise<Buffer | null> {
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

async function svc(route: string, body: object, ms = 120_000): Promise<any> {
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

/** يطلع خطوات من صور حل المدرس، وصاحب البوت يعدلها قبل الحفظ */
export async function draftRubric(qid: number): Promise<RubricStep[]> {
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
  return (r.steps ?? []).map((s: any) => ({ text: String(s.text ?? ""), points: Number(s.points) || 0 }));
}

export type AiQuestion = { n: number; score: number; max: number; review: boolean; reason: string; note?: string; lines: string[]; steps: { status: string; awarded: number; possible: number; reason: string; reason_ar?: string; expected: string; student: string; student_tex?: string }[]; usage?: Usage[] };
export async function aiResultOf(itemId: number): Promise<AiQuestion[] | null> {
  const j = await readJson<AiQuestion[] | null>(resultKey(itemId), null);
  return Array.isArray(j) ? j : null;
}

/** يصحح ورقة وحدة: يرجع درجة كل سؤال، أو يرمي خطأ إذا ما يگدر */
async function gradePaper(it: Row): Promise<AiQuestion[]> {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  if (!qs.length) throw new Error("ماكو أسئلة");
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  if (answers.some((a) => !a.q)) throw new Error("الجواب ملف كامل");
  if (answers.some((a) => !isImage(a.file))) throw new Error("الجواب مو صورة");
  // ورقة بلا ولا صورة جواب: مو «ما جاوب»، الصور بعدها ما وصلت
  if (!answers.length) throw new Error("ماكو صور جواب بالورقة");
  return await Promise.all(qs.map(async (q): Promise<AiQuestion> => {
    const steps = await rubricOf(q.id);
    if (!steps) throw new Error(`سؤال ${q.n} بدون خطوات`);
    const max = Number(q.max_mark);
    const mine = answers.filter((a) => a.q === q.n);
    // ما جاوب: صفر بدون ما نسأل الخدمة
    if (!mine.length) return { n: q.n, score: 0, max, review: false, reason: "ما جاوب", lines: [], steps: [], usage: [] };
    const imgs = await Promise.all(mine.map((a) => readRef(a.file)));
    if (imgs.some((b) => !b)) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
    return await gradeQuestion(q, steps, imgs as Buffer[]);
  }));
}
/** يرسل جواب سؤال واحد (صوره) للخدمة ويا خطوات حله */
async function gradeQuestion(q: Row, steps: RubricStep[], imgs: Buffer[]): Promise<AiQuestion> {
  const max = Number(q.max_mark);
  const r = await svc("/bot/grade", {
    max_points: max,
    steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
    images: imgs.map((b) => b.toString("base64")),
  });
  const score = Math.max(0, Math.min(max, Math.round(Number(r.score) || 0)));
  return { n: q.n, score, max, review: !!r.requires_review, reason: String(r.review_reason ?? ""), note: String(r.note ?? ""), lines: r.student_lines ?? [], steps: r.steps ?? [], usage: r.usage ?? [] };
}
/** «🧪 جرّب على جواب حقيقي»: صاحب البوت يرفع صور جواب سؤال، ونظام التصحيح يصححها ويرجع النتيجة بس.
 *  ما تنحفظ درجة لأحد وما توصل رسالة لأحد، بس الكلفة تنحسب بالسجل */
export async function tryGrade(qid: number, imgs: Buffer[]): Promise<AiQuestion> {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const steps = await rubricOf(q.id);
  if (!steps) throw new Error("احفظ خطوات حل هذا السؤال أول");
  if (!imgs.length) throw new Error("اختار صورة الجواب");
  const res = await gradeQuestion(q, steps, imgs);
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
  const steps = await rubricOf(q.id);
  if (!steps) throw new Error(`سؤال ${qn} بدون خطوات`);
  const imgs = (await Promise.all((await find("exam_answers", { item_id: it.id, q: qn }, { order: ["id"] })).map((a) => readRef(a.file)))).filter((b): b is Buffer => !!b);
  if (!imgs.length) throw new Error("ماكو صورة جواب لهذا السؤال");
  const old = (await aiResultOf(it.id))?.find((x) => x.n === qn);
  const r = await svc("/bot/objection", {
    max_points: Number(q.max_mark), old_score: oldMark, objection: text || "الطالب يشوف درجته مو صحيحة",
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
  const scope = new Set(s.exams);
  const items = (await find("sched_items", { status: "done" })).filter((it) => !it.graded_at && scope.has(it.exam_id)).slice(0, 40);
  const titles = new Map((await find("bank_exams")).map((e) => [e.id, e.title]));
  const why = new Map<number, string | null>();
  return await Promise.all(items.map(async (it) => {
    let state: string;
    if (it.grader_id === AI_GRADER) state = "🤖 يصححها هسه";
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
  const scope = new Set(s.exams);
  const verReady = new Map<number, boolean>();
  return async (it: Row) => {
    if (!active || !scope.has(it.exam_id) || it.graded_at || it.grader_id || !it.version_id) return false;
    if ((Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES) return false;
    if (!verReady.has(it.version_id)) {
      const qs = await find("bank_questions", { version_id: it.version_id });
      let ok = qs.length > 0;
      for (const q of qs) if (ok && !await rubricOf(q.id)) ok = false;
      verReady.set(it.version_id, ok);
    }
    return verReady.get(it.version_id)!;
  };
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
export async function aiGradeTick(finish: (uid: number, itemId: number) => Promise<unknown>, nameOf: (it: Row) => Promise<string>, limit = PER_TICK) {
  if (!aiLinked() || !await aiOn()) return { off: true };
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
  let graded = 0, unsure = 0, failed = 0;
  await Promise.all(picked.map(async (it) => {
    try {
      const res = await gradePaper(it);
      const usage = sumUsage(res.map((q) => q.usage ?? []));
      await kvSet(resultKey(it.id), JSON.stringify(res));
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
  return { graded, unsure, failed };
}
