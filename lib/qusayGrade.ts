// «تصحيح قصي»: مصحح ذكاء اصطناعي ثاني ورخيص، بناه الأستاذ ويا Claude (طلبه 2026-11-21).
// بصفحته لحاله ومفاتيحه لحالها (qg_). ما يلمس «نظام التصحيح AI» مال مؤمل (lib/aiGrade.ts و grading-ai/):
// بس يقرا منه خطوات الحل اللي كتبها الأستاذ، وما ياخذ ولا ورقة من مواضيعه أو طلابه.
//
// شلون يصحح: طلب واحد لـ Claude Haiku 5.5 للورقة كلها (كل الأسئلة وكل الصور سوا). أول جزء من الطلب
// (التعليمات وخطوات كل سؤال ودرجتها) نفسه لكل أوراق النموذج، فينحفظ عند الذكاء (كاش) وبالورقة الثانية يندفع عشره.
// الورقة اللي يشك بيها (خط ما ينقرا، صورة ناقصة، طريقة غريبة) ما ينطيها درجة: ترجع للمصححين.
// «🌙 بالدفعة»: الأوراق تروح سوا للذكاء وترجع خلال ساعة تقريباً (أكثر شي يوم)، وكلفتها النص.
import Anthropic from "@anthropic-ai/sdk";
import { find, kvGet, kvSet, one, put, remove, tx, update, type Row } from "./db.ts";
import { AI_GRADER, QUSAY_GRADER } from "./data.ts";
import { aiSettings, isImage, readRef, rubricFull, type Rubric } from "./aiGrade.ts";
import { MODEL, hasKey } from "./booklets.ts";
import { addSpend } from "./aiSpend.ts";
import { answerOnlyOf, SKIP } from "./answerOnly.ts";
import { ADMIN_IDS } from "./config.ts";
import { send } from "./telegram.ts";
import { stamp } from "./util.ts";

export const QG_PERM = "qusay";
/** low: يفكر أقل وأرخص. medium: يفكر أكثر وأدق (الأصل) */
export type QgEffort = "low" | "medium";
/** live: المواضيع اللي يصححها صدگ. batch: بالدفعة (أرخص بالنص، والدرجة تتأخر). cap: أكثر شي يصرف باليوم بالدولار */
export type QgSettings = { live: number[]; effort: QgEffort; batch: boolean; cap: number };
export type QgStep = { text: string; points: number; awarded: number; note: string };
export type QgQuestion = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: QgStep[] };
export type QgTokens = { in: number; cw: number; cr: number; out: number };
/** نتيجة ورقة: trial تجربة مخفية على ورقة صححها مصحح (human درجته)، live ورقة صححها صدگ (لو رجعها للمصححين إذا ما متأكد) */
export type QgResult = { at: string; kind: "trial" | "live"; total: number; sure: boolean; qs: QgQuestion[]; usd: number; tokens: QgTokens; batch: boolean; human?: number | null; sent?: boolean };
export type QgLog = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap"; item?: number; name?: string; exam?: string; total?: number; usd?: number; note?: string };

const SET = "qg_settings", ON = "qg_on", LOG = "qg_log", TRIAL = "qg_trial", BATCHES = "qg_batches";
const resKey = (id: number) => `qg_res_${id}`;
const tryKey = (id: number) => `qg_try_${id}`;
const capNoteKey = (day: string) => `qg_cap_note_${day}`;
export const DEFAULT_CAP = 2;
const MAX_TRIES = 3;
const LIVE_PER_TICK = 10, TRIAL_PER_TICK = 6, LOG_MAX = 3000;
/** أكبر صورة يقبلها الذكاء، وأكبر PDF */
const IMG_MAX = 5 * 1024 * 1024, PDF_MAX = 30 * 1024 * 1024;
/** الدفعة اللي ما رجعت خلال 25 ساعة: أوراقها ترجع للمصححين */
const BATCH_STALE_MS = 25 * 3600_000;
/** أسعار Haiku 5.5 بالدولار لكل مليون توكن: داخل، كتابة الكاش (1.25)، قراية الكاش (0.1)، طالع */
const PRICE = { in: 0.1, cw: 0.125, cr: 0.01, out: 0.5 };
/** الدولار بالدينار، نفس صفحة نظام التصحيح AI */
export const IQD = 1600;

const readJson = async <T>(k: string, def: T): Promise<T> => { try { return JSON.parse((await kvGet(k)) ?? "null") ?? def; } catch { return def; } };
// طافي من البداية: ما يصرف فلس إلا لمن الأستاذ يشغله
export const qgOn = async () => (await kvGet(ON)) === "1";
export const setQgOn = (on: boolean) => kvSet(ON, on ? "1" : "0");
export async function qgSettings(): Promise<QgSettings> {
  const s = await readJson<Partial<QgSettings>>(SET, {});
  const cap = Number(s.cap);
  return { live: Array.isArray(s.live) ? s.live.map(Number).filter(Number.isInteger) : [], effort: s.effort === "low" ? "low" : "medium", batch: !!s.batch, cap: cap > 0 ? Math.min(cap, 100) : DEFAULT_CAP };
}
export async function saveQgSettings(p: Partial<QgSettings>) {
  const s = { ...await qgSettings(), ...p };
  await kvSet(SET, JSON.stringify(s));
  return await qgSettings();
}
export const qgResultOf = (id: number) => readJson<QgResult | null>(resKey(id), null);
export const qgLog = () => readJson<QgLog[]>(LOG, []);
async function addLog(row: QgLog) {
  const l = await qgLog();
  l.push(row);
  await kvSet(LOG, JSON.stringify(l.slice(-LOG_MAX)));
}
/** صرفية اليوم (أو الشهر) من السجل */
export const spentFrom = (log: QgLog[], prefix: string) => log.filter((r) => r.at.startsWith(prefix)).reduce((t, r) => t + (r.usd ?? 0), 0);
export const usdOf = (t: QgTokens, batch: boolean) => ((t.in * PRICE.in + t.cw * PRICE.cw + t.cr * PRICE.cr + t.out * PRICE.out) / 1_000_000) * (batch ? 0.5 : 1);

// ---------- الكلام ويا الذكاء (الفحوصات تبدله بواحد وهمي)
type Req = Anthropic.MessageCreateParamsNonStreaming;
export type QgBatchOut = { ended: boolean; results: { id: string; msg: Anthropic.Message | null; err?: string }[] };
export type QgApi = {
  create: (req: Req) => Promise<Anthropic.Message>;
  batchCreate: (reqs: { custom_id: string; params: Req }[]) => Promise<string>;
  batchGet: (id: string) => Promise<QgBatchOut>;
};
let client: Anthropic | null = null;
const sdk = () => (client ??= new Anthropic());
const realApi: QgApi = {
  create: (req) => sdk().messages.create(req),
  batchCreate: async (requests) => (await sdk().messages.batches.create({ requests })).id,
  batchGet: async (id) => {
    const b = await sdk().messages.batches.retrieve(id);
    if (b.processing_status !== "ended") return { ended: false, results: [] };
    const results: QgBatchOut["results"] = [];
    for await (const r of await sdk().messages.batches.results(id)) {
      results.push(r.result.type === "succeeded" ? { id: r.custom_id, msg: r.result.message } : { id: r.custom_id, msg: null, err: r.result.type });
    }
    return { ended: true, results };
  },
};
let apiImpl: QgApi = realApi;
export const setQgApi = (a: QgApi | null) => { apiImpl = a ?? realApi; };
const keyReady = () => hasKey() || apiImpl !== realApi;

// ---------- مادة النموذج: الأسئلة والخطوات (نفسها لكل أوراقه، فتنحفظ بالكاش)
type QMat = { n: number; max: number; rubric: Rubric | null; qText: string; qImg: Buffer | null; model: Buffer[] };
type VMat = { qs: QMat[]; pdf: Buffer | null };
const mediaOf = (b: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf" | null => {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 4).toString("latin1") === "\x89PNG") return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  return null;
};
/** صورة أو PDF كقطعة بالطلب. ملف مو مفهوم أو كبير يرمي خطأ مفهوم */
function block(b: Buffer, what: string): Anthropic.ContentBlockParam {
  const t = mediaOf(b);
  if (!t) throw new Error(`${what}: الملف مو صورة ولا PDF`);
  if (t === "application/pdf") {
    if (b.length > PDF_MAX) throw new Error(`${what}: الـ PDF أكبر من 30 ميگا`);
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.toString("base64") } };
  }
  if (b.length > IMG_MAX) throw new Error(`${what}: الصورة أكبر من 5 ميگا`);
  return { type: "image", source: { type: "base64", media_type: t, data: b.toString("base64") } };
}
/** ليش هذا النموذج ما يتصحح: سؤال بلا خطوات ولا حل نموذجي. null يعني جاهز */
export async function versionWhyNot(versionId: number): Promise<string | null> {
  const qs = await find("bank_questions", { version_id: versionId }, { order: ["n"] });
  if (!qs.length) return "النموذج ما بيه أسئلة";
  const v = await one("bank_versions", { id: versionId });
  if (v?.answer_pdf) return null;
  const miss: number[] = [];
  for (const q of qs) {
    if (await rubricFull(q.id)) continue;
    if ((JSON.parse(q.a_files || "[]") as string[]).some(isImage)) continue;
    miss.push(q.n);
  }
  return miss.length ? `الأسئلة ${miss.join("، ")} ما إلها خطوات ولا صورة حل` : null;
}
async function material(versionId: number): Promise<VMat> {
  const why = await versionWhyNot(versionId);
  if (why) throw new Error(why);
  const v = await one("bank_versions", { id: versionId });
  const qs: QMat[] = [];
  for (const q of await find("bank_questions", { version_id: versionId }, { order: ["n"] })) {
    const rubric = await rubricFull(q.id);
    const qText = String(q.q_text ?? "").trim();
    // صورة السؤال بس إذا ماكو نصه
    const qImg = !qText && q.q_file && isImage(String(q.q_file)) ? await readRef(String(q.q_file)) : null;
    // صور الحل النموذجي بس إذا ماكو خطوات
    const model = rubric ? [] : (await Promise.all((JSON.parse(q.a_files || "[]") as string[]).filter(isImage).map(readRef))).filter((b): b is Buffer => !!b);
    qs.push({ n: Number(q.n), max: Number(q.max_mark) || 0, rubric, qText, qImg, model });
  }
  const needPdf = qs.some((q) => !q.rubric && !q.model.length);
  return { qs, pdf: needPdf && v?.answer_pdf ? await readRef(String(v.answer_pdf)) : null };
}

const SYSTEM = `You are a careful, fair grader of Iraqi high-school (6th preparatory) mathematics exams, grading on behalf of the teacher, Qusay.
Students write by hand, in Arabic or English; photos may be rotated, dim or slightly blurred.

For every question you get the teacher's marking scheme: numbered steps with points (sometimes alternative methods, each worth the full mark), or, when no steps exist, the teacher's model solution.
Grade the student's answer question by question:
- Award each step its points only when the student's own work clearly shows that step done correctly. A correct final answer with no supporting work earns only the steps it actually shows.
- Any mathematically valid method earns full credit. Pick the method (1 = main, 2+ = alternatives) that fits the student's work best and grade against its steps.
- Follow-through: when a step is done correctly but uses a wrong value carried from the student's own earlier mistake, award half of that step's points.
- Ignore crossed-out work. Do not reward work that is only copied from the question.
- Never award more than a step's points, never more than the question's maximum.
- If a question has no answer anywhere in the student's pages, set answered=false and score 0.

Set sure=false for a question when you cannot read the handwriting, part of the answer is cut off or missing from the photo, the work matches no method and you cannot judge it, or you hesitate between two marks. Being unsure is fine: a human grader will then check the paper. Do not guess.

Write "reason" and each step "note" in short, simple Arabic (Iraqi style), for the teacher: what the student did right or wrong. Keep them brief.`;

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          answered: { type: "boolean" },
          method: { type: "integer" },
          steps: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, awarded: { type: "number" }, note: { type: "string" } }, required: ["i", "awarded", "note"], additionalProperties: false } },
          score: { type: "number" },
          sure: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["n", "answered", "method", "steps", "score", "sure", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const stepsText = (steps: { text: string; points: number }[]) => steps.map((s, i) => `  ${i + 1}. [${s.points} points] ${s.text}`).join("\n");
/** يبني طلب الورقة: مادة النموذج أول (بالكاش)، وبعدها صور الطالب */
async function buildRequest(it: Row, mat: VMat, effort: QgEffort): Promise<{ req: Req; unanswered: Set<number> }> {
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  if (!answers.length) throw new Error("ماكو صور جواب بالورقة");
  const head: Anthropic.ContentBlockParam[] = [{ type: "text", text: "MARKING SCHEME (the same for every student of this exam version):" }];
  for (const q of mat.qs) {
    let t = `\n=== Question ${q.n} — maximum ${q.max} points ===`;
    if (q.qText) t += `\nQuestion text: ${q.qText}`;
    if (q.rubric) {
      t += `\nMethod 1 steps:\n${stepsText(q.rubric.steps)}`;
      q.rubric.alts.forEach((a, k) => { t += `\nMethod ${k + 2} steps:\n${stepsText(a)}`; });
    } else t += q.model.length ? "\nNo steps written: grade against the teacher's model solution image(s) below, fairly by parts." : "\nNo steps written: grade against this question's part of the teacher's model solution PDF.";
    head.push({ type: "text", text: t });
    if (q.qImg) head.push(block(q.qImg, `صورة السؤال ${q.n}`));
    for (const m of q.model) head.push(block(m, `حل السؤال ${q.n}`));
  }
  if (mat.pdf) head.push({ type: "text", text: "\nTeacher's model solution PDF:" }, block(mat.pdf, "PDF الحل"));
  // نقطة الكاش: كل اللي فوك نفسه لكل أوراق النموذج
  const last = head[head.length - 1] as Anthropic.TextBlockParam;
  last.cache_control = { type: "ephemeral" };

  const body: Anthropic.ContentBlockParam[] = [{ type: "text", text: "STUDENT'S ANSWER PAGES:" }];
  const whole = answers.filter((a) => !a.q);
  const unanswered = new Set<number>();
  for (const q of mat.qs) {
    const mine = answers.filter((a) => Number(a.q) === q.n);
    if (!mine.length) { if (!whole.length) unanswered.add(q.n); continue; }
    body.push({ type: "text", text: `\nStudent's answer to question ${q.n}:` });
    for (const a of mine) {
      const b = await readRef(String(a.file));
      if (!b) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
      body.push(block(b, `جواب سؤال ${q.n}`));
    }
  }
  if (whole.length) {
    body.push({ type: "text", text: "\nStudent's pages for the whole paper (answers to any question may be anywhere here):" });
    for (const a of whole) {
      const b = await readRef(String(a.file));
      if (!b) throw new Error("صفحة من الورقة مفقودة");
      body.push(block(b, "صفحة الورقة"));
    }
  }
  const asked = mat.qs.filter((q) => !unanswered.has(q.n)).map((q) => q.n);
  body.push({ type: "text", text: `\nGrade questions ${asked.join(", ")}. Return one entry per question, with one step entry per step of the method you chose (i = step number).` });
  const req: Req = {
    model: MODEL, max_tokens: 12000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [...head, ...body] }],
  };
  return { req, unanswered };
}

const half = (x: number) => Math.round(x * 2) / 2;
/** يقرا جواب الذكاء ويرتبه: الدرجة من الخطوات (مو من رقمه)، وما تعدي حدها */
export function readAnswer(msg: Anthropic.Message, mat: VMat, unanswered: Set<number>, answerOnly: boolean): { qs: QgQuestion[]; tokens: QgTokens } {
  const u = msg.usage;
  const tokens = { in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0 };
  if (msg.stop_reason === "refusal") throw new Error("الذكاء رفض يصحح الورقة");
  if (msg.stop_reason === "max_tokens") throw new Error("جواب الذكاء طويل وانگطع");
  let j: { questions?: any[] } = {};
  try { j = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { throw new Error("جواب الذكاء مو مفهوم"); }
  const got = new Map((Array.isArray(j.questions) ? j.questions : []).map((q) => [Number(q?.n), q]));
  const qs = mat.qs.map((m): QgQuestion => {
    if (unanswered.has(m.n)) return { n: m.n, max: m.max, score: 0, answered: false, sure: true, reason: "ما جاوب", method: 1, steps: [] };
    const a = got.get(m.n);
    if (!a) return { n: m.n, max: m.max, score: 0, answered: true, sure: false, reason: "الذكاء ما رجع درجة هذا السؤال", method: 1, steps: [] };
    const answered = a.answered !== false;
    const method = Math.max(1, Math.round(Number(a.method) || 1));
    const plan = m.rubric ? (m.rubric.alts[method - 2] ?? m.rubric.steps) : null;
    const byI = new Map((Array.isArray(a.steps) ? a.steps : []).map((s: any) => [Number(s?.i), s]));
    const steps: QgStep[] = plan ? plan.map((p, k) => {
      const s: any = byI.get(k + 1);
      return { text: p.text, points: p.points, awarded: Math.min(p.points, Math.max(0, half(Number(s?.awarded) || 0))), note: String(s?.note ?? "").slice(0, 300) };
    }) : [];
    let score = plan ? steps.reduce((t, s) => t + s.awarded, 0) : Number(a.score) || 0;
    score = answered ? Math.min(m.max, Math.max(0, half(score))) : 0;
    return { n: m.n, max: m.max, score, answered, sure: a.sure !== false, reason: String(a.reason ?? "").slice(0, 500), method: plan ? method : 1, steps };
  });
  // «أجب عن K»: السؤال اللي ما جاوبه ما يحتاج تأكيد
  if (answerOnly) for (const q of qs) if (!q.answered) q.sure = true;
  return { qs, tokens };
}

// ---------- الأوراق
const nameOfRow = async (it: Row) => (await one("students", { user_id: it.user_id }))?.name ?? (it.user_id < 0 ? `طالب تجربة ${-it.user_id}` : "طالب");
const examTitle = async (id: number) => String((await one("bank_exams", { id }))?.title ?? "");
const tries = async (id: number) => Number(await kvGet(tryKey(id))) || 0;
const todayUsd = async () => spentFrom(await qgLog(), stamp().slice(0, 10));
async function overCap(s: QgSettings) {
  const spent = await todayUsd();
  if (spent < s.cap) return false;
  const day = stamp().slice(0, 10);
  if (!await kvGet(capNoteKey(day))) {
    await kvSet(capNoteKey(day), "1");
    await addLog({ at: stamp(), kind: "cap", note: `وصل حد اليوم ${s.cap} دولار` });
    for (const id of ADMIN_IDS) await send(id, `👤 <b>لصاحب البوت بس</b>\n🧠 «تصحيح قصي» وصل حد اليوم (${s.cap} دولار، تقريباً ${Math.round(s.cap * IQD)} دينار) فوگف لباچر. الأوراق رجعت للمصححين.\nتگدر تكبر الحد من صفحته.`).catch(() => undefined);
  }
  return true;
}
/** يختار الأوراق اللي ياخذها: مواضيعه المأشرة بس، ومو من مواضيع أو طلاب نظام التصحيح AI مال مؤمل */
async function liveTaker() {
  const s = await qgSettings();
  const active = keyReady() && await qgOn() && s.live.length > 0 && !(await todayUsd() >= s.cap);
  const mu = await aiSettings();
  const live = new Set(s.live), muExams = new Set(mu.exams), muStudents = new Set(mu.students);
  const ready = new Map<number, boolean>();
  return async (it: Row) => {
    if (!active || it.status !== "done" || it.graded_at || it.grader_id || !it.version_id || !live.has(it.exam_id)) return false;
    if (muExams.has(it.exam_id) || muStudents.has(it.user_id)) return false;
    if (await tries(it.id) >= MAX_TRIES || await qgResultOf(it.id)) return false;
    if (!ready.has(it.version_id)) ready.set(it.version_id, !await versionWhyNot(it.version_id));
    return ready.get(it.version_id)!;
  };
}
/** أوراق ينتظرها «تصحيح قصي»: ما تطلع للمصححين لحد ما يجربها (دقيقة تقريباً) */
export async function qusayHeld(papers: Row[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (!await qgOn()) return out;
  const take = await liveTaker();
  for (const p of papers) if (await take(p)) out.add(p.id);
  return out;
}
/** يحجز الورقة إله بمعاملة وحدة: إذا مصحح سبقه يتركها */
async function claim(id: number) {
  return await tx(async () => {
    const cur = await one("sched_items", { id });
    if (!cur || cur.graded_at || cur.grader_id) return false;
    await update("sched_items", { id }, { grader_id: QUSAY_GRADER });
    return true;
  });
}
async function release(id: number) {
  const now = await one("sched_items", { id });
  if (now && !now.graded_at && now.grader_id === QUSAY_GRADER) {
    await update("sched_items", { id }, { grader_id: null });
    await remove("question_marks", { item_id: id });
  }
}
type Job = { it: Row; kind: "trial" | "live" };
type Prepared = { job: Job; req: Req; mat: VMat; unanswered: Set<number>; answerOnly: boolean };
async function prepare(jobs: Job[], effort: QgEffort, onFail: (j: Job, e: unknown) => Promise<void>): Promise<Prepared[]> {
  const mats = new Map<number, VMat>();
  const out: Prepared[] = [];
  for (const job of jobs) {
    try {
      const vid = Number(job.it.version_id);
      if (!mats.has(vid)) mats.set(vid, await material(vid));
      const mat = mats.get(vid)!;
      const { req, unanswered } = await buildRequest(job.it, mat, effort);
      out.push({ job, req, mat, unanswered, answerOnly: answerOnlyOf(await one("bank_exams", { id: job.it.exam_id })) > 0 });
    } catch (e) { await onFail(job, e); }
  }
  return out;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
async function failed(job: Job, e: unknown) {
  const { it } = job;
  console.error("qusay grade", it.id, e);
  const n = await tries(it.id) + 1;
  await kvSet(tryKey(it.id), String(n));
  await addLog({ at: stamp(), kind: "failed", item: it.id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), note: `${job.kind === "trial" ? "🧪 تجربة: " : ""}${errText(e)}` });
  if (job.kind === "live") await release(it.id);
}
/** الذكاء رجع جواب الورقة: التجربة تنحفظ بس، والحقيقية تنطي الدرجة أو ترجع للمصححين */
async function settle(p: Prepared, msg: Anthropic.Message, batch: boolean, finish: (uid: number, itemId: number) => Promise<unknown>) {
  const { it, kind } = p.job;
  const { qs, tokens } = readAnswer(msg, p.mat, p.unanswered, p.answerOnly);
  const usd = usdOf(tokens, batch);
  await addSpend("qusay", usd);
  const total = qs.reduce((t, q) => t + q.score, 0);
  const sure = qs.every((q) => q.sure);
  const name = await nameOfRow(it), exam = await examTitle(it.exam_id);
  const res: QgResult = { at: stamp(), kind, total, sure, qs, usd, tokens, batch };
  if (kind === "trial") {
    res.human = it.graded_at ? Number(it.total ?? 0) : null;
    await kvSet(resKey(it.id), JSON.stringify(res));
    await addLog({ at: stamp(), kind: "trial", item: it.id, name, exam, total, usd, note: `المصحح ${res.human ?? "—"}${sure ? "" : " · ⚠️ ما متأكد"}` });
    return;
  }
  const now = await one("sched_items", { id: it.id });
  if (!now || now.graded_at || now.grader_id !== QUSAY_GRADER) return;
  if (!sure) {
    await kvSet(resKey(it.id), JSON.stringify(res));
    await release(it.id);
    await addLog({ at: stamp(), kind: "unsure", item: it.id, name, exam, total, usd, note: qs.filter((q) => !q.sure).map((q) => `س${q.n}: ${q.reason || "ما متأكد"}`).join(" | ").slice(0, 300) });
    return;
  }
  for (const q of qs) await put("question_marks", { item_id: it.id, q: q.n, mark: !q.answered && p.answerOnly ? SKIP : q.score });
  res.sent = true;
  await kvSet(resKey(it.id), JSON.stringify(res));
  try {
    await finish(QUSAY_GRADER, it.id);
  } catch (e) {
    res.sent = false;
    await kvSet(resKey(it.id), JSON.stringify({ ...res, kind: "live", sure: false }));
    await release(it.id);
    throw e;
  }
  await addLog({ at: stamp(), kind: "sent", item: it.id, name, exam, total, usd });
}

// ---------- 🧪 التجربة المخفية: أوراق صححها مصحح، يصححها «تصحيح قصي» بالسر ونقارن
export async function trialQueue(): Promise<number[]> { const q = await readJson<number[]>(TRIAL, []); return Array.isArray(q) ? q.map(Number) : []; }
/** أوراق صححها مصحح بشري بهذا الموضوع (آخرها أول)، وما تجربت قبل */
export async function trialCandidates(examId: number): Promise<Row[]> {
  const queued = new Set(await trialQueue());
  const out: Row[] = [];
  for (const it of (await find("sched_items", { exam_id: examId, status: "done" })).sort((a, b) => String(b.graded_at ?? "").localeCompare(String(a.graded_at ?? "")))) {
    if (!it.graded_at || !it.grader_id || it.grader_id === AI_GRADER || it.grader_id === QUSAY_GRADER || !it.version_id || queued.has(it.id)) continue;
    if (await qgResultOf(it.id)) continue;
    out.push(it);
  }
  return out;
}
export async function queueTrial(examId: number, n: number) {
  const want = Math.max(1, Math.min(50, Math.round(n) || 0));
  const cand = [];
  const ready = new Map<number, boolean>();
  for (const it of await trialCandidates(examId)) {
    if (cand.length >= want) break;
    if (!ready.has(it.version_id)) ready.set(it.version_id, !await versionWhyNot(it.version_id));
    if (ready.get(it.version_id)) cand.push(it.id as number);
  }
  await kvSet(TRIAL, JSON.stringify([...await trialQueue(), ...cand]));
  return cand.length;
}
export const clearTrialQueue = () => kvSet(TRIAL, "[]");
/** يمسح نتيجة تجربة حتى يعيدها (مثلاً بعد ما تعدل الخطوات) */
export async function forgetTrial(examId: number) {
  let n = 0;
  for (const it of await find("sched_items", { exam_id: examId })) {
    const r = await qgResultOf(it.id);
    if (r?.kind === "trial") { await kvSet(resKey(it.id), "null"); await kvSet(tryKey(it.id), "0"); n++; }
  }
  return n;
}

// ---------- 🌙 الدفعات
type BatchRow = { id: string; at: number; jobs: { item: number; kind: "trial" | "live" }[] };
const batches = () => readJson<BatchRow[]>(BATCHES, []);
export const pendingBatches = async () => (await batches()).length;
async function pollBatches(finish: (uid: number, itemId: number) => Promise<unknown>, effort: QgEffort) {
  const list = await batches();
  const keep: BatchRow[] = [];
  let done = 0;
  for (const b of list) {
    let out: QgBatchOut;
    try { out = await apiImpl.batchGet(b.id); } catch (e) { console.error("qusay batch get", b.id, e); keep.push(b); continue; }
    if (!out.ended) {
      if (Date.now() - b.at < BATCH_STALE_MS) { keep.push(b); continue; }
      for (const j of b.jobs) { const it = await one("sched_items", { id: j.item }); if (it) await failed({ it, kind: j.kind }, new Error("الدفعة ما رجعت خلال يوم")); }
      continue;
    }
    const got = new Map(out.results.map((r) => [r.id, r]));
    for (const j of b.jobs) {
      const it = await one("sched_items", { id: j.item });
      if (!it) continue;
      const job: Job = { it, kind: j.kind };
      const r = got.get(`qg_${j.item}`);
      if (!r?.msg) { await failed(job, new Error(`الدفعة: ${r?.err ?? "ماكو جواب"}`)); continue; }
      // نعيد بناء المادة (بدون إرسال) حتى نعرف الخطوات والأسئلة اللي ما جاوبها
      const [p] = await prepare([job], effort, failed);
      if (!p) continue;
      try { await settle(p, r.msg, true, finish); done++; } catch (e) { await failed(job, e); }
    }
  }
  await kvSet(BATCHES, JSON.stringify(keep));
  return done;
}

/** دكة المؤقت (كل دقيقة): يصحح أوراق مواضيعه، ويكمل التجربة، ويستلم الدفعات اللي رجعت */
export async function qusayTick(finish: (uid: number, itemId: number) => Promise<unknown>) {
  if (!await qgOn()) return { off: true };
  if (!keyReady()) return { noKey: true };
  const s = await qgSettings();
  const received = (await batches()).length ? await pollBatches(finish, s.effort) : 0;
  if (await overCap(s)) return { cap: true, ...(received ? { received } : {}) };
  const jobs: Job[] = [];
  const take = await liveTaker();
  for (const it of await find("sched_items", { status: "done" }, { order: ["id"] })) {
    if (jobs.length >= LIVE_PER_TICK) break;
    if (!await take(it) || !await claim(it.id)) continue;
    jobs.push({ it: (await one("sched_items", { id: it.id }))!, kind: "live" });
  }
  const queue = await trialQueue();
  const trialIds = queue.slice(0, TRIAL_PER_TICK);
  await kvSet(TRIAL, JSON.stringify(queue.slice(TRIAL_PER_TICK)));
  for (const id of trialIds) {
    const it = await one("sched_items", { id });
    if (it && await tries(id) < MAX_TRIES && !await qgResultOf(id)) jobs.push({ it, kind: "trial" });
  }
  if (!jobs.length) return { idle: true, ...(received ? { received } : {}) };
  const ready = await prepare(jobs, s.effort, failed);
  if (s.batch && ready.length) {
    try {
      const id = await apiImpl.batchCreate(ready.map((p) => ({ custom_id: `qg_${p.job.it.id}`, params: p.req })));
      await kvSet(BATCHES, JSON.stringify([...await batches(), { id, at: Date.now(), jobs: ready.map((p) => ({ item: p.job.it.id as number, kind: p.job.kind })) }]));
      return { batched: ready.length, ...(received ? { received } : {}) };
    } catch (e) { for (const p of ready) await failed(p.job, e); return { failed: ready.length }; }
  }
  let graded = 0, bad = 0;
  await Promise.all(ready.map(async (p) => {
    try { await settle(p, await apiImpl.create(p.req), false, finish); graded++; } catch (e) { bad++; await failed(p.job, e); }
  }));
  return { graded, ...(bad ? { failed: bad } : {}), ...(received ? { received } : {}) };
}

/** الورقة رجعت للمصححين لأن ما متأكد، أو خربت: يعيد يجربها */
export async function qgRetry(id: number) {
  const r = await qgResultOf(id);
  if (r?.sent) throw new Error("هاي الورقة صححها وانطى درجتها");
  await kvSet(resKey(id), "null");
  await kvSet(tryKey(id), "0");
}
