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
/** الذكاء اللي يصحح (طلب الأستاذ 2026-11-23: «إذا أكو شي يعلي الجودة قلي، حتى لو أغلى»):
 *  haiku الأرخص (الأصل)، sonnet أدق بقراءة الخط والرسم وتطبيق قواعده (تقريباً 20 مرة أغلى)، opus الأدق (تقريباً 40 مرة) */
export type QgModel = "haiku" | "sonnet" | "opus";
export const QG_MODELS: Record<QgModel, { id: string; p: { in: number; cw: number; cr: number; out: number } }> = {
  haiku: { id: MODEL, p: { in: 0.1, cw: 0.125, cr: 0.01, out: 0.5 } },
  sonnet: { id: "claude-sonnet-5-5", p: { in: 2, cw: 2.5, cr: 0.1, out: 10 } },
  opus: { id: "claude-opus-5-5", p: { in: 4, cw: 5, cr: 0.2, out: 20 } },
};
/** live: المواضيع اللي يصححها صدگ. batch: بالدفعة (أرخص بالنص، والدرجة تتأخر، وهي الأصل من 2026-11-21).
 *  cap: أكثر شي يصرف باليوم بالدولار. carry: الزايد عن الحد يتأجل لباچر وما يروح للمصححين (الأصل).
 *  unsure: الورقة اللي يشك بيها: «send» يصححها ويبعث درجتها ويكتب السبب بالسجل (الأصل، طلب الأستاذ 2026-11-21)، «graders» ترجع للمصححين */
/** obj: الاعتراض على أوراقه، «qusay» يراجعه هو أول، «person» يروح لـ objTo (مساعد عنده صلاحية الاعتراضات، 0 = صاحب البوت) */
export type QgSettings = { live: number[]; model: QgModel; effort: QgEffort; batch: boolean; cap: number; carry: boolean; unsure: "send" | "graders"; marks: boolean; style: string; obj: "qusay" | "person"; objTo: number; wait: boolean };
/** مكان على صور جواب الطالب: p رقم الصورة (من 1)، x من اليسار و y من فوك، من 0 لـ 1000 من عرضها وطولها */
export type QgPt = { p: number; x: number; y: number };
/** at: وين مكتوبة الخطوة على ورقة الطالب، حتى تنرسم عليها ✓ أو ✗ حمرة مثل قلم المدرس (بس إذا «🖍 العلامات» شغالة) */
/** hw: رقم عبارة من «✍️ خط إيدي» تقول نفس الملاحظة، فتنرسم بخط الأستاذ نفسه بدل الخط */
/** w: شنو كاتب الطالب بهاي الخطوة (ينعرض بالتفصيل مثل مؤمل) */
export type QgStep = { text: string; points: number; awarded: number; note: string; w?: string; at?: QgPt; hw?: number };
export type QgQuestion = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: QgStep[]; at?: QgPt; hw?: number };
/** m: الذكاء اللي جاوب (من جوابه نفسه)، حتى السعر ينحسب صح */
export type QgTokens = { in: number; cw: number; cr: number; out: number; m?: string };
/** نتيجة ورقة: trial تجربة مخفية على ورقة صححها مصحح (human درجته)، live ورقة صححها صدگ (لو رجعها للمصححين إذا ما متأكد) */
export type QgResult = { at: string; kind: "trial" | "live"; total: number; sure: boolean; qs: QgQuestion[]; usd: number; tokens: QgTokens; batch: boolean; human?: number | null; sent?: boolean; pages?: string[] };
/** «🖍 جرب العلامات»: تصحيح ثاني لورقة بالعلامات على الورقة، ينحفظ لحاله وما يغير درجتها ولا يوصل شي للطالب */
export type QgMarksDemo = { at: string; total: number; qs: QgQuestion[]; pages: string[]; usd: number };
/** شي كتبه الأستاذ بقلم الآيباد بصفحة «✍️ خط إيدي»: خطوطه (s: كل خط x,y,x,y...) بمربع w×h */
/** c لون الكتابة، wd سمكها 1 رفيع 2 وسط 3 ثخين (القديمة بدونهم: أحمر ووسط) */
export type InkShape = { w: number; h: number; s: number[][]; c?: string; wd?: 1 | 2 | 3 };
export const INK_COLOR_LIST = ["#d40000", "#1d4ed8", "#15803d", "#111111", "#7e22ce", "#ea580c"];
/** tick ✓، cross ✗، praise مدح (أحسنت، ممتاز…)، note ملاحظة (نسيت تعوض…). text: شنو مكتوب بيها */
/** ask: «؟» بخطه، بآخر الحل الناقص (طلبه 2026-11-22) */
export type InkKind = "tick" | "cross" | "praise" | "note" | "ask";
export type InkItem = InkShape & { id: number; kind: InkKind; text: string };
/** علامة وحدة تنرسم على صورة الورقة: ✓ ✗ نص درجة، أو درجة السؤال بدائرة.
 *  sym: ✓ أو ✗ بخط الأستاذ، word: مدحه بخطه، hand: ملاحظته بخطه (إذا كاتبها بـ «✍️ خط إيدي») */
/** rot وsc: ميلان (درجات) وحجم خط الإيد، يتغيرون شوية بكل علامة حتى ما تبين نسخة وحدة (طلب الأستاذ 2026-11-22) */
/** big: ✓ وحدة كبيرة على السؤال الصح كله. q / i: السؤال ورقم خطوته (i = -1 للسؤال كله)، حتى الأستاذ يدوس عليها ويصلحها */
export type PaperMark = { x: number; y: number; kind: "ok" | "half" | "bad" | "score" | "good" | "miss"; text: string; big?: boolean; box?: { y0: number; y1: number }; col?: string; q?: number; i?: number; note?: string; sym?: InkShape; word?: InkShape; hand?: InkShape; rot?: number; sc?: number };
export type QgLog = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap" | "obj" | "wait"; item?: number; name?: string; exam?: string; total?: number; usd?: number; note?: string };

const SET = "qg_settings", ON = "qg_on", LOG = "qg_log", TRIAL = "qg_trial", BATCHES = "qg_batches", NOW = "qg_now", MK_Q = "qg_mk_q";
const resKey = (id: number) => `qg_res_${id}`;
const mkKey = (id: number) => `qg_mk_${id}`;
const tryKey = (id: number) => `qg_try_${id}`;
const capNoteKey = (day: string) => `qg_cap_note_${day}`;
export const DEFAULT_CAP = 2;
/** أطول «✍️ طريقتك بالكتابة» */
export const STYLE_MAX = 60000;   // شرحه بالفويس لكل موضوع مفتوح، يحچي براحته (طلبه 2026-11-22)
const MAX_TRIES = 3;
const LIVE_PER_TICK = 20, TRIAL_PER_TICK = 6, LOG_MAX = 3000;
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
  const s = await readJson<Partial<QgSettings> & { v?: number }>(SET, {});
  const cap = Number(s.cap);
  // الإعدادات القديمة (قبل v 2) كانت «هسه» بالأصل: تصير بالدفعة، طلب الأستاذ 2026-11-21
  const v2 = Number(s.v) >= 2;
  return { live: Array.isArray(s.live) ? s.live.map(Number).filter(Number.isInteger) : [], model: s.model === "sonnet" || s.model === "opus" ? s.model : "haiku", effort: s.effort === "low" ? "low" : "medium", batch: v2 ? !!s.batch : true, cap: cap > 0 ? Math.min(cap, 100) : DEFAULT_CAP, carry: v2 && s.carry !== undefined ? !!s.carry : true, unsure: s.unsure === "graders" ? "graders" : "send", marks: s.marks === true, style: typeof s.style === "string" ? s.style.slice(0, STYLE_MAX) : "", obj: s.obj === "qusay" ? "qusay" : "person", objTo: Number(s.objTo) > 0 ? Number(s.objTo) : 0, wait: s.wait !== false };
}
export async function saveQgSettings(p: Partial<QgSettings>) {
  const s = { ...await qgSettings(), ...p, v: 2 };
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
const priceOf = (m?: string) => (m?.includes("opus") ? QG_MODELS.opus.p : m?.includes("sonnet") ? QG_MODELS.sonnet.p : PRICE);
export const usdOf = (t: QgTokens, batch: boolean) => { const P = priceOf(t.m); return ((t.in * P.in + t.cw * P.cw + t.cr * P.cr + t.out * P.out) / 1_000_000) * (batch ? 0.5 : 1); };
const modelId = async () => QG_MODELS[(await qgSettings()).model].id;

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
  // بالبث: الجواب الطويل (حد 32 ألف) ما ينقطع بمهلة الطلب، والـ SDK ما يرفضه
  create: (req) => sdk().messages.stream(req).finalMessage(),
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
/** طلب للذكاء من مكان ثاني (حل الأسئلة العلمية، lib/qaAi.ts): نفس المفتاح، والفحوصات تبدله بواحد وهمي */
export const qgCreate = (req: Req) => apiImpl.create(req);
export const qgKeyReady = () => keyReady();

// ---------- مادة النموذج: الأسئلة والخطوات (نفسها لكل أوراقه، فتنحفظ بالكاش)
/** خطوة بيها رسم: رسم الدوال، القطوع، شكل مسألة المعدلات («Drawing»، «Sketch of the ellipse»، «الرسم») */
export const DRAW_STEP = /\b(graph of|sketch|drawing|draw)\b|الرسم|ارسم|رسم الدالة|رسم القطع|رسم المنحني/i;
export const hasDrawStep = (r: Rubric | null) => !!r && [r.steps, ...r.alts].some((st) => st.some((s) => DRAW_STEP.test(s.text)));
const DRAW_PDF_MAX = 15 * 1024 * 1024;
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
  const full = await Promise.all(qs.map((q) => rubricFull(q.id)));
  qs.forEach((q, k) => {
    if (full[k]) return;
    if ((JSON.parse(q.a_files || "[]") as string[]).some(isImage)) return;
    miss.push(q.n);
  });
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
  // سؤال بيه خطوة رسم («[8] Graph of the function»، «[7] الرسم»): الخطوات ما توصف شكل الرسم، فيروح وياها PDF حله
  // حتى يقارن رسم الطالب برسمه هو (طلب الأستاذ 2026-11-22). بالكاش، فكلفته على أول ورقة بس
  const drawPdf = !needPdf && qs.some((q) => !q.model.length && hasDrawStep(q.rubric));
  if (!(needPdf || drawPdf) || !v?.answer_pdf) return { qs, pdf: null };
  const pdf = await readRef(String(v.answer_pdf));
  // للرسم بس: PDF كبير أو مو PDF ما يوگف التصحيح، يصحح بدونه مثل قبل
  if (drawPdf && (!pdf || mediaOf(pdf) !== "application/pdf" || pdf.length > DRAW_PDF_MAX)) return { qs, pdf: null };
  return { qs, pdf };
}

const SYSTEM = `You are a careful, fair grader of Iraqi high-school (6th preparatory) mathematics exams, grading on behalf of the teacher, Qusay.
Students write by hand, in Arabic or English; photos may be rotated, dim or slightly blurred.

For every question you get the teacher's marking scheme: numbered steps with points (sometimes alternative methods, each worth the full mark), or, when no steps exist, the teacher's model solution.
Grade the student's answer question by question:
- Award each step its points only when the student's own work clearly shows that step done correctly. A correct final answer with no supporting work earns only the steps it actually shows.
- Any mathematically valid method earns full credit. Pick the method (1 = main, 2+ = alternatives) that fits the student's work best and grade against its steps.
- ONE MISTAKE IS PENALIZED ONCE (the teacher's firm rule): take points only in the step where the mistake first happens. A later step that is done correctly but uses a wrong value carried from that earlier mistake gets its FULL points and an EMPTY note; never take points or write a note again for the same mistake. Example: the student finds $y=-\\frac{1}{2}$ instead of $y=-\\frac{1}{\\sqrt{2}}$ (that step loses its points, with a note), then writes the final root with that same $-\\frac{1}{2}$: the final root step is full, with no note. Take points in a later step only for a NEW mistake made in that step itself.
- Every awarded value is a WHOLE number (0, 1, 2, ...). Never give fractions such as 2.5 or 8.5.
- Ignore crossed-out work. Do not reward work that is only copied from the question.
- A step is earned by its CONTENT, in any order or equivalent form. Example: the symmetry test may check the origin first and the y-axis second, or write f(-x) on another line; if the test and its conclusion are there, the step is full.
- A table of values may use ANY x values: if the y values are right for the x values the student chose, and there are enough points, the table step is full. Never require the teacher's own x values.
- A step's conclusion must be right: e.g. writing "symmetric about the origin" for a function that is not, loses the symmetry step even if f(-x) was computed.
- A result that comes from the line before in ONE direct, routine operation needs no written working. Example: from $f'(x)=3x^{2}$ the student writes $f''(x)=6x$ straight away: that is full. The lines in the marking scheme are the teacher's own working; the student does not have to copy each of them. Never take points, and never write a note, asking the student to "write the steps" (خطوات) of something they did correctly. Take points only for a needed result that is missing or wrong.
- Never award more than a step's points, never more than the question's maximum.
- If a question has no answer anywhere in the student's pages, set answered=false and score 0.

DRAWINGS (graphs of functions, parabola / ellipse / hyperbola sketches, the figure of a word problem): a step that asks for a drawing is graded by looking at the student's drawing itself, compared with the teacher's drawing in the model solution (when given) and with the values found in the earlier steps. Check the main features: the axes; the special points the curve must pass through (intercepts, critical / turning points, inflection points, table points, vertices, foci, centre) placed at about the right places; the asymptotes; and the right shape (where it rises and falls, concave up or down, symmetry, which way it opens). Hand drawings are rough: never take points for neatness or exact scale. Full drawing points when the main features are right, part of them when only some are right, 0 when there is no drawing or it does not match. A drawing step is never earned by written work alone: no drawing means 0 for that step. If you cannot see the drawing clearly in the photo, set sure=false.

Set sure=false for a question when you cannot read the handwriting, part of the answer is cut off or missing from the photo, the work matches no method and you cannot judge it, or you hesitate between two marks. Being unsure is fine: a human grader will then check the paper. Do not guess.

For each step, "w" is what the STUDENT wrote for that step, copied from the photo: math as LaTeX between $ signs, the student's own Arabic or English words kept. Every line the student wrote (every new equation or result) is its own line: separate lines with " ; " exactly like the marking scheme does, never join two equations with a comma. Copy the student's own values exactly, even wrong ones; never correct them and never copy the marking scheme. If the student did not write that step, "w" is "".
Write "reason" and each step "note" in short, simple Arabic (Iraqi style), for the teacher and the student: what the student did right or wrong. Keep them brief.
"reason" names EVERY part of the question that lost points, all of them, briefly (e.g. "ناقص إشارة المشتقة الأولى والثانية والجدول والرسم"), so the student knows everything that is missing and does not object to a correct mark.
HOW A NOTE MUST READ (the teacher's own rules):
- Name the exact thing the student should have done, taken from the teacher's steps / model solution for THIS question. Example: the model solution multiplies by the conjugate, so the note is "المفروض تضرب بالمرافق"; the angle is in the fourth quadrant, so "الزاوية بالربع الرابع مو الأول". Never a vague or general phrase such as "المفروض تحسب جبرياً" or "راجع الحل".
- Iraqi words only: "مو" (never "مش"), "هيچ", "هسه", "المفروض". No Egyptian, Levantine or formal wording.
- Use the words of the Iraqi math book: "الأس" (never "القوة"), "المقياس", "السعة", "المرافق", "الجذر".
- The marking scheme may be written in English; never translate its terms yourself. Use ONLY these Iraqi book terms (Qusay's own words): local maximum point = "نقطة نهاية عظمى محلية" (never "قصوى"); local minimum point = "نقطة نهاية صغرى محلية" (never "دنيا"); inflection point = "نقطة انقلاب"; critical point = "نقطة حرجة"; asymptote = "المحاذي" (vertical = "المحاذي العمودي", horizontal = "المحاذي الأفقي"); domain = "أوسع مجال"; intercepts = "نقاط التقاطع مع المحورين"; symmetry = "التناظر" (about the y-axis = "حول محور الصادات", about the origin = "حول نقطة الأصل"); increasing / decreasing = "تزايد / تناقص"; concave up / down = "تقعر / تحدب"; sign line = "خط الاختبار"; table = "الجدول"; graph = "الرسم". If Qusay's topic rules use a word for something, use his word.
- Any value you write in a note (a point, a root, a result) is copied exactly from the marking scheme / model solution of THIS question and version, in the same form: if the scheme says $(\\pm1,\\frac{3}{2})$, write exactly that, never an unsimplified form like $\\frac{6}{4}$ and never a value of another function.
- Math symbols always as LaTeX, never spelled out in letters: $\\theta$ (never "ثيتا" or "theta"), $\\cos\\theta$ (never "كوساين بصفة theta"), $2^{\\frac{3}{4}}$.
- Never say how many points were taken off or given.
- Be decisive. A step is either right (full points, empty note) or you say exactly what is wrong. Never write vague words such as "تأكد"، "قريب"، "يحتاج تدقيق"، "راجع"، "مو واضح بشكل كافي". If the photo truly does not let you judge, give the student the benefit and set sure=false.
- Words the teacher never uses: "دالة زوجية" / "دالة فردية". Say "متناظرة حول محور الصادات" or "متناظرة حول نقطة الأصل".
Write every piece of math inside the Arabic text as LaTeX between $ signs, the way an Iraqi math book prints it: fractions as $\\frac{a}{b}$ (never a/b), pi as $\\pi$ (never the word pi), roots as $\\sqrt{x}$, powers as $x^{2}$. Example: "عوّض $x=\\frac{\\pi}{2}$ صح".`;

/** «🖍 العلامات على الورقة»: نفس التصحيح، ويا مكان كل خطوة على صور الطالب حتى نرسم عليها مثل قلم المدرس الأحمر */
const MARKS_TEXT = `

READING THE HANDWRITING: read every number and symbol carefully; zoom in mentally on unclear digits. Similar digits (3 and 8, 1 and 7, 4 and 9, 0 and 6, 5 and 6) are easy to confuse. When a digit is unclear, decide it from the student's own work around it: the line before and the line after, and what the student does with that value next. If the student's next steps use a value consistently, that is what they wrote. Never take points off for a value you only misread; if you truly cannot tell, keep the student's benefit and set sure=false.

TEACHER'S VOICE: the student must feel that his teacher Qusay marked the paper by hand. Write every "note" and "reason" the way an Iraqi math teacher writes a quick comment in red pen on a paper: very short (a few words, at most one short sentence), spoken Iraqi Arabic, talking to the student ("عندك", "سويت", "المفروض"). Say what is wrong and what it should be, e.g. "المفروض $\\frac{23\\pi}{12}$" or "الإشارة غلط" or "نسيت تعوض". Leave a correct step's note empty. Never use formal words like "الصواب" or "الإجابة الصحيحة هي", never describe yourself, never mention a model, an AI, a system, a marking scheme or "steps", and never explain how you graded.

PEN MARKS: the student's images are numbered [Image 1], [Image 2], ... The teacher draws a red tick or cross beside each step on the student's own image, so also give boxes, measured on each image from 0 to 1000 (x from the left edge, y from the top edge; x1,y1 = top-left corner, x2,y2 = bottom-right corner):
- "papers": for every image, p = the image number and the box of the sheet of paper itself. Photos often show a table, a hand, a screen or a dark border around the paper: the box is the white sheet only.
- The teacher puts a tick on every right step and a cross on every step that lost points. So give a box for EVERY step the student wrote: p = the image number where that step is written, and a TIGHT box around exactly the handwriting of that step (usually one line). Do not include neighbouring lines.
- If a step is not written anywhere, give p=0 and a box of zeros.
- For each question: p = the image where its answer ENDS, and a box around the student's whole answer to that question on that image (the teacher writes a final remark just after it). If the question was not answered, zeros.
Be precise: each box must sit on that step's own ink.`;
const BOX = { p: { type: "integer" }, x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" } } as const;
const BOX_KEYS = ["p", "x1", "y1", "x2", "y2"];
/** نفس الشكل، وإذا العلامات شغالة: مربع الورقة بكل صورة، ومربع كتابة كل خطوة */
function schemaOf(marks: boolean) {
  if (!marks) return SCHEMA;
  const q = SCHEMA.properties.questions.items;
  const st = q.properties.steps.items;
  return {
    ...SCHEMA, required: [...SCHEMA.required, "papers"],
    properties: {
      papers: { type: "array", items: { type: "object", properties: BOX, required: BOX_KEYS, additionalProperties: false } },
      questions: { ...SCHEMA.properties.questions, items: {
        ...q, required: [...q.required, ...BOX_KEYS, "hw"], properties: { ...q.properties, ...BOX, hw: { type: "integer" }, steps: { ...q.properties.steps, items: { ...st, required: [...st.required, ...BOX_KEYS, "hw"], properties: { ...st.properties, ...BOX, hw: { type: "integer" } } } } },
      } },
    },
  };
}
/** «✍️ طريقتك بالكتابة»: أمثلة يكتبها الأستاذ من ملاحظاته، حتى الذكاء يكتب مثله */
const styleText = (style: string) => (style.trim() ? `

HOW QUSAY WRITES HIS COMMENTS (copy his wording and tone exactly; these are his own words):
${style.trim()}
Praise words in these examples (ممتاز، أحسنت، عاشت إيدك and the like) are ONLY for a question the student answered with FULL marks. Never put praise in the note of a step that lost points, nor in the reason of a question that did not get full marks.` : "");
/** «✍️ عبارات هذا الموضوع»: عبارات الأستاذ الخاصة بموضوع واحد، تنضاف فوك العامة (طلبه 2026-11-21) */
const exStyleKey = (examId: number) => `qg_style_ex_${examId}`;
export const examStyle = async (examId: number) => String((await kvGet(exStyleKey(examId))) ?? "");
export const setExamStyle = (examId: number, text: string) => kvSet(exStyleKey(examId), text.slice(0, STYLE_MAX));
// ---------- «✏️ صلّح وعلّمه» (طلب الأستاذ 2026-11-23): يصلح درجة خطوة بإيده ويكتب ليش، وجوابه يصير قاعدة بهذا الموضوع
// يمشي عليها بكل ورقة جاية. محفوظة لحالها (مو بملف الـ Word، حتى رفع ملف جديد ما يمسحها)
export type QgLesson = { id: number; at: string; item: number; q: number; step: string; from: number; to: number; max: number; why: string };
const learnKey = (examId: number) => `qg_learn_${examId}`;
export const lessonsOf = async (examId: number) => { const l = await readJson<QgLesson[]>(learnKey(examId), []); return Array.isArray(l) ? l : []; };
const lessonsText = (l: QgLesson[]) => (l.length ? `

WHAT QUSAY TAUGHT YOU BY CORRECTING YOUR GRADING (these have the same force as his rules above: whenever the same situation comes up, on any paper and any version, grade it his way):
${l.map((x) => `- Question ${x.q}, step «${x.step.slice(0, 160)}»: you gave ${x.from} of ${x.max}; Qusay corrected it to ${x.to} of ${x.max}. His reason: ${x.why}`).join("\n")}` : "");
/** قواعد الموضوع كلها: ملفه، وبعدها اللي علمه من تصحيحاته */
export const topicRules = async (examId: number) => {
  const { examplesOf, examplesText } = await import("./inkHarvest.ts");
  return topicText(await examStyle(examId)) + lessonsText(await lessonsOf(examId)) + examplesText(await examplesOf(examId));
};
/** التصحيح اللي ينعرض: «🖍 جرب العلامات» الأحدث، وإلا التصحيح نفسه */
export async function shownResult(id: number) {
  const r = await qgResultOf(id);
  const demo = await qgMarksOf(id);
  const fresh = r && demo && (!r.pages?.length || String(demo.at) >= String(r.at)) ? demo : null;
  return { r, demo, fresh };
}
export async function teach(id: number, qn: number, stepIdx: number, mark: number, why: string) {
  const it = await one("sched_items", { id });
  if (!it) throw new Error("الورقة غير موجودة");
  const { r, fresh } = await shownResult(id);
  if (!r) throw new Error("«تصحيح قصي» بعده ما صحح هاي الورقة");
  const src = fresh ?? r;
  const q = src.qs.find((x) => x.n === qn);
  const st = q?.steps[stepIdx];
  if (!q || !st) throw new Error("الخطوة غير موجودة");
  const to = Math.round(Number(mark));
  if (!(to >= 0 && to <= st.points)) throw new Error(`الدرجة من 0 لحد ${st.points}`);
  const w = String(why ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (w.length < 4) throw new Error("اكتب ليش، حتى يتعلم");
  const exam = Number(it.exam_id);
  const list = await lessonsOf(exam);
  list.push({ id: Math.max(0, ...list.map((x) => x.id)) + 1, at: stamp(), item: id, q: qn, step: st.text, from: st.awarded, to, max: st.points, why: w });
  await kvSet(learnKey(exam), JSON.stringify(list.slice(-200)));
  // الورقة نفسها تتصلح بالعرض
  const fixIn = (res: { qs: QgQuestion[]; total: number }) => {
    const rq = res.qs.find((x) => x.n === qn), rs = rq?.steps[stepIdx];
    if (!rq || !rs) return null;
    rs.awarded = to;
    if (to >= rs.points) rs.note = "";
    rq.score = rq.steps.reduce((t, x) => t + x.awarded, 0);
    res.total = res.qs.reduce((t, x) => t + x.score, 0);
    return rq.score;
  };
  fixIn(src);
  await kvSet(fresh ? mkKey(id) : resKey(id), JSON.stringify(src));
  // الطالب الحقيقي اللي وصلته درجته: درجته الرسمية تتغير هم (طلبه 2026-11-23: «إذا أنا لگيت غلط، تتغير»)
  let official: { q: number; mark: number } | null = null;
  if (r.sent && Number(it.user_id) > 0) {
    const mark = fresh ? fixIn(r) : q.score;
    if (fresh) await kvSet(resKey(id), JSON.stringify(r));
    if (mark !== null) official = { q: qn, mark };
  }
  return { official, n: list.length };
}
// ---------- «🗑 شيل هاي العلامة» (طلبه 2026-11-23): العلامة اللي مكانها غلط تنشال من الورقة، والدرجة تبقى
const hideKey = (id: number) => `qg_hide_${id}`;
export const hiddenMarks = async (id: number) => { const l = await readJson<string[]>(hideKey(id), []); return Array.isArray(l) ? l.map(String) : []; };
export async function hideMark(id: number, key: string) {
  if (!/^\d+:-?\d+:(ok|half|bad|good|miss)$/.test(key)) throw new Error("العلامة مو مفهومة");
  await kvSet(hideKey(id), JSON.stringify([...new Set([...await hiddenMarks(id), key])]));
}
export const markKey = (m: PaperMark) => `${m.q}:${m.i ?? -1}:${m.kind}`;
export const dropHidden = <T extends { marks: PaperMark[] }>(pages: T[], hidden: string[]) => (hidden.length ? pages.map((p) => ({ ...p, marks: p.marks.filter((m) => !hidden.includes(markKey(m))) })) : pages);
export async function forgetLesson(examId: number, lessonId: number) {
  await kvSet(learnKey(examId), JSON.stringify((await lessonsOf(examId)).filter((x) => x.id !== lessonId)));
}
// ---------- «✍️ خط إيدي»: الأستاذ يكتب بقلم الآيباد ✓ و✗ والمدح والملاحظات، وتنرسم على ورقة الطالب بخطه هو (طلبه 2026-11-21)
// عام لكل المواضيع، وخاص لكل موضوع (ينضاف فوك العام). ما يصرف فلوس: الرسم بالسيرفر، والملاحظات بس أسماؤها تروح للذكاء
const inkKey = (exam = 0) => (exam ? `qg_ink_ex_${exam}` : "qg_ink");
export const INK_KINDS: InkKind[] = ["tick", "cross", "praise", "note", "ask"];
export const INK_MAX = 80;
export const inkList = (exam = 0) => readJson<InkItem[]>(inkKey(exam), []);
/** كل خط إيده اللي ينفع لموضوع: العام والخاص */
export const inkFor = async (exam: number) => [...await inkList(), ...(exam ? await inkList(exam) : [])];
/** يفحص اللي إجا من الصفحة ويحفظه: خطوط بأرقام، بحدود المربع، ومو كبيرة */
export async function addInk(exam: number, raw: any): Promise<InkItem> {
  const kind = String(raw?.kind) as InkKind;
  if (!INK_KINDS.includes(kind)) throw new Error("اختار شنو تكتب");
  const text = kind === "tick" ? "✓" : kind === "cross" ? "✗" : kind === "ask" ? "؟" : String(raw?.text ?? "").replace(/\s+/g, " ").trim().slice(0, kind === "note" ? 200 : 60);
  if (!text) throw new Error("اكتب شنو مكتوب بالعبارة");
  const w = Math.round(Number(raw?.w)), h = Math.round(Number(raw?.h));
  if (!(w >= 100 && w <= 1500 && h >= 100 && h <= 1500)) throw new Error("مربع الكتابة غلط");
  const s: number[][] = [];
  let pts = 0;
  for (const st of Array.isArray(raw?.s) ? raw.s.slice(0, 200) : []) {
    if (!Array.isArray(st) || st.length < 2) continue;
    const a: number[] = [];
    for (let i = 0; i + 1 < st.length && i < 4000; i += 2) {
      const x = Number(st[i]), y = Number(st[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      a.push(Math.round(Math.min(w, Math.max(0, x))), Math.round(Math.min(h, Math.max(0, y))));
    }
    if (a.length) { s.push(a); pts += a.length; }
  }
  if (!s.length) throw new Error("ما كتبت شي");
  if (pts > 60000) throw new Error("الكتابة كبيرة هواية، امسح واكتبها أصغر");
  const list = await inkList(exam);
  if (list.length >= INK_MAX) throw new Error(`وصلت ${INK_MAX} عبارة، امسح وحدة أول`);
  const c = INK_COLOR_LIST.includes(String(raw?.c)) ? String(raw.c) : INK_COLOR_LIST[0];
  const wd = ([1, 2, 3] as const).find((x) => x === Number(raw?.wd)) ?? 2;
  const item: InkItem = { id: Math.max(Date.now(), ...list.map((x) => x.id + 1)), kind, text, w, h, s, c, wd };
  await kvSet(inkKey(exam), JSON.stringify([...list, item]));
  return item;
}
export async function removeInk(exam: number, id: number) {
  const list = await inkList(exam);
  await kvSet(inkKey(exam), JSON.stringify(list.filter((x) => x.id !== id)));
}
/** ملاحظاته المكتوبة بخطه تروح للذكاء بأسمائها بس، حتى إذا ملاحظة تطلع نفس وحدة منها يختار رقمها */
const handText = (ink: InkItem[]) => {
  const notes = ink.filter((x) => x.kind === "note");
  return notes.length ? `

QUSAY'S HANDWRITTEN NOTES: Qusay wrote these notes by hand; the student sees his real handwriting when you pick one.
${notes.map((x) => `${x.id}: ${x.text}`).join("\n")}
For every step and question, set "hw" to the number of the one note above that says what you want to say (same meaning), and then write that same note in "note"/"reason". If none fits, hw=0 and write your own short note.` : "";
};

const topicText = (t: string) => (t.trim() ? `

QUSAY'S WORDS AND RULES FOR THIS TOPIC (he wrote them in a Word/PDF file or dictated them by voice; if dictated, speech recognition may have changed some words: read them by their mathematical meaning).
These rules OVERRIDE your own judgment and every general rule above. Grade the same way on every paper:
- Before you award ANY step, find every one of his rules below that is about that step (domain, intercepts, symmetry, the sign line, asymptotes, the graph, the points, ...) and apply it literally to what this student wrote or drew.
- When he says a thing must be written (for example the law of symmetry $f(-x)=f(x)$, not only the words), a student who did not write it does NOT get that step's full points, even if the conclusion is right.
- When he says to take off a number of points for something, take off exactly that, and write exactly his sentence to the student.
- When he says something is fine, give the full points for it.
- Judge a drawing by what is really in the photo: an asymptote counts as drawn only if you can see it (a dotted or thick line, as he says); never say it is missing when you can see it, and never say "أحسنت" for a graph that breaks one of his rules.
${t.trim()}` : "");

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
          steps: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, w: { type: "string" }, awarded: { type: "number" }, note: { type: "string" } }, required: ["i", "w", "awarded", "note"], additionalProperties: false } },
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
async function buildRequest(it: Row, mat: VMat, effort: QgEffort, marks = false, style = ""): Promise<{ req: Req; unanswered: Set<number>; pages: string[] }> {
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  if (!answers.length) throw new Error("ماكو صور جواب بالورقة");
  // حرف النسخة (A، B…): شرح الأستاذ بعبارات الموضوع ممكن يخص نسخة («بالنسخة B السؤال 3 …»)
  const ver = String((await one("bank_versions", { id: it.version_id }))?.model ?? "");
  const head: Anthropic.ContentBlockParam[] = [{ type: "text", text: `MARKING SCHEME (the same for every student of this exam version)${ver ? `. This paper is exam version ${ver} (النسخة ${ver}): when the teacher's notes talk about a version, apply what he says about version ${ver}` : ""}:` }];
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
  if (mat.pdf) head.push({ type: "text", text: mat.qs.some((q) => !q.rubric && !q.model.length) ? "\nTeacher's model solution PDF:" : "\nTeacher's model solution PDF (for the drawing steps: it shows what each correct drawing looks like; the points still follow the steps above):" }, block(mat.pdf, "PDF الحل"));
  // نقطة الكاش: كل اللي فوك نفسه لكل أوراق النموذج
  const last = head[head.length - 1] as Anthropic.TextBlockParam;
  last.cache_control = { type: "ephemeral" };

  // كل الملاحظات بالعربي، حتى لطالب المنهج الإنجليزي (طلبه 2026-11-23: «لا يكتب ولا كلمة بالإنجليزي»)
  const en = String((await one("students", { user_id: it.user_id }))?.curr ?? "") === "إنجليزي";
  const body: Anthropic.ContentBlockParam[] = [{ type: "text", text: (en ? "This student studies the English curriculum and may write in English. Still write every note and reason in Iraqi Arabic only, with the Iraqi Arabic book's terms; never write English words." + String.fromCharCode(10) : "") + "STUDENT'S ANSWER PAGES:" }];
  const whole = answers.filter((a) => !a.q);
  const unanswered = new Set<number>();
  // صور الطالب بالترتيب: «🖍 العلامات» يرجع رقم الصورة اللي بيها كل خطوة
  const pages: string[] = [];
  const addPage = (ref: string, b: Buffer, what: string) => {
    pages.push(ref);
    if (marks) body.push({ type: "text", text: `[Image ${pages.length}]` });
    body.push(block(b, what));
  };
  for (const q of mat.qs) {
    const mine = answers.filter((a) => Number(a.q) === q.n);
    if (!mine.length) { if (!whole.length) unanswered.add(q.n); continue; }
    body.push({ type: "text", text: `\nStudent's answer to question ${q.n}:` });
    for (const a of mine) {
      const b = await readRef(String(a.file));
      if (!b) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
      addPage(String(a.file), b, `جواب سؤال ${q.n}`);
    }
  }
  if (whole.length) {
    body.push({ type: "text", text: "\nStudent's pages for the whole paper (answers to any question may be anywhere here):" });
    for (const a of whole) {
      const b = await readRef(String(a.file));
      if (!b) throw new Error("صفحة من الورقة مفقودة");
      addPage(String(a.file), b, "صفحة الورقة");
    }
  }
  const asked = mat.qs.filter((q) => !unanswered.has(q.n)).map((q) => q.n);
  body.push({ type: "text", text: `\nGrade questions ${asked.join(", ")}. Return one entry per question, with one step entry per step of the method you chose (i = step number).` });
  const req: Req = {
    // ويا العلامات يكتب أكثر (مربع كل سطر)، و12 ألف چانت تنقطع (2026-11-21). ينحسب بس اللي يكتبه فعلاً
    model: await modelId(), max_tokens: 32000,
    system: [{ type: "text", text: SYSTEM + (marks ? MARKS_TEXT + styleText(style) + await topicRules(Number(it.exam_id)) + handText(await inkFor(Number(it.exam_id))) : ""), cache_control: { type: "ephemeral" } }],
    output_config: { effort, format: { type: "json_schema", schema: schemaOf(marks) as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [...head, ...body] }],
  };
  return { req, unanswered, pages };
}

/** مكان من جواب الذكاء: رقم صورة موجودة، وx وy بين 0 و1000. غيره (0 يعني ما مكتوب) ما ينرسم */
type Box = { x1: number; y1: number; x2: number; y2: number };
const c1000 = (v: unknown) => Math.min(1000, Math.max(0, Math.round(Number(v) || 0)));
function boxOf(s: any): Box | null {
  if (s?.x1 === undefined) return null;
  const [x1, x2] = [c1000(s.x1), c1000(s.x2)].sort((a, b) => a - b), [y1, y2] = [c1000(s.y1), c1000(s.y2)].sort((a, b) => a - b);
  return x2 - x1 >= 5 && y2 - y1 >= 5 ? { x1, y1, x2, y2 } : null;
}
/** مربع الورقة بكل صورة (بدون الطاولة أو الشاشة اللي حواليها) */
export function papersOf(j: any): Map<number, Box> {
  const m = new Map<number, Box>();
  for (const x of Array.isArray(j?.papers) ? j.papers : []) { const b = boxOf(x); if (b && b.x2 - b.x1 > 200 && b.y2 - b.y1 > 200) m.set(Math.round(Number(x.p)), b); }
  return m;
}
/** وين تنرسم علامة الخطوة: بعد آخر سطرها مباشرة، بنص ارتفاعه، وجوة الورقة دائماً. إذا ما يساع يمينه، يسار السطر */
export function ptOf(s: any, pages: number, papers: Map<number, Box> = new Map(), end = false): QgPt | undefined {
  const p = Math.round(Number(s?.p));
  if (!(p >= 1 && p <= pages)) return undefined;
  const paper = papers.get(p) ?? { x1: 0, y1: 0, x2: 1000, y2: 1000 };
  const inX = (v: number) => Math.min(paper.x2 - 35, Math.max(paper.x1 + 35, v)), inY = (v: number) => Math.min(paper.y2 - 25, Math.max(paper.y1 + 25, v));
  const b = boxOf(s);
  if (!b) return s?.x === undefined ? undefined : { p, x: inX(c1000(s.x)), y: inY(c1000(s.y)) };
  const right = b.x2 + 40;
  // end: آخر الجواب كله (ملاحظة المدرس الأخيرة يم آخر سطر)
  return { p, x: Math.round(inX(right <= paper.x2 - 35 ? right : b.x1 - 40)), y: Math.round(inY(end ? Math.max(b.y1 + 10, b.y2 - 25) : (b.y1 + b.y2) / 2)) };
}
const shortNote = (t: string) => (t.length > 90 ? t.slice(0, 88).replace(/\s+\S*$/, "") + "…" : t);
// ---------- خطوات الحل بلغة الطالب (طلب الأستاذ 2026-11-23): خطواته مكتوبة بالإنجليزي لو بالعربي، والطالب يشوفها بلغة منهجه.
// الترجمة مرة وحدة لكل خطوة وتنحفظ، والرياضيات تبقى مثل ما هي
const hasAr = (t: string) => /[؀-ۿ]/.test(t);
const wordsEn = (t: string) => (t.replace(/\b(sin|cos|tan|sec|csc|cot|ln|log|lim|dx|dy|R)\b/g, "").match(/[A-Za-z]{3,}/g) ?? []).length;
const needsTr = (lang: "ar" | "en", t: string) => (lang === "ar" ? !hasAr(t) && wordsEn(t) >= 1 : hasAr(t));
const trKey = (lang: string, t: string) => `qg_tr_${lang}_${[...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}_${t.length}`;
const TRANS = (lang: "ar" | "en") => `You translate the steps of a math marking scheme (Iraqi 6th preparatory, chapter on curve sketching and calculus) into ${lang === "ar" ? "Arabic, exactly as the Iraqi Arabic math book writes it" : "English, exactly as the Iraqi English-curriculum math book writes it"}.
Keep every formula, symbol, number, arrow (→), semicolon (;) and set notation exactly as written; translate only the words.
${lang === "ar" ? "Use these book terms: local maximum point = نقطة نهاية عظمى محلية; local minimum point = نقطة نهاية صغرى محلية; inflection point = نقطة انقلاب; critical point = نقطة حرجة; vertical asymptote = المحاذي العمودي; horizontal asymptote = المحاذي الأفقي; domain = أوسع مجال; intercepts = نقاط التقاطع مع المحورين; symmetric about the y-axis = متناظرة حول محور الصادات; about the origin = حول نقطة الأصل; increasing / decreasing = تزايد / تناقص; concave up / concave down = تقعر / تحدب; sign line / sign of f' = خط الاختبار; table = الجدول; graph = الرسم; denominator = المقام." : "Use the English book's terms (local maximum point, inflection point, vertical asymptote, domain, concave up / down, ...)."}
Return {"items": [...]} with one translated string per input step, in the same order.`;
export async function stepsIn(lang: "ar" | "en", texts: string[]): Promise<string[]> {
  const out = [...texts];
  const miss: number[] = [];
  await Promise.all(texts.map(async (t, k) => {
    if (!needsTr(lang, t)) return;
    const c = await kvGet(trKey(lang, t));
    if (c) out[k] = c; else miss.push(k);
  }));
  if (!miss.length) return out;
  try {
    const msg = await apiImpl.create({ model: MODEL, max_tokens: 8000, system: TRANS(lang), output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false } } },
      messages: [{ role: "user", content: JSON.stringify(miss.map((k) => texts[k])) }] } as Req);
    const u = msg.usage;
    await addSpend("qusay", usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model }, false));
    const items = (JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as { items?: unknown[] }).items ?? [];
    if (items.length === miss.length) await Promise.all(miss.map(async (k, j) => { const v = String(items[j] ?? "").trim(); if (v) { out[k] = v; await kvSet(trKey(lang, texts[k]), v); } }));
  } catch (e) { console.error("steps translate", e); }
  return out;
}

/** الملاحظة للطالب: بألفاظ الأستاذ، وبلا كلام الذكاء لنفسه («ملاحظة: الدرجة تقديرية»، «ضعيف التأكد») ولا بقايا JSON */
export const cleanNote = (t: string) => bookWords(String(t ?? "")
  .replace(/\s*(ملاحظة|ملاحظه)\s*:.*$/s, "").replace(/\s*(ضعيف التأكد|الدرجة تقديرية|الدرجة تحتاج مراجعة)[^.،]*[.،]?/g, "")
  .replace(/[}\]\[{]+[,.]?\s*$/g, "").replace(/\s+/g, " ").trim());
/** الملاحظة وخطه يتطابقن بالكلام، بلا فراغات ولا $ ولا فوارز */
export const normNote = (t: string) => String(t ?? "").replace(/[\s$،,.:]/g, "");
/** كتابة الطالب بالتفصيل: كل خطوة جديدة بسطر (طلبه 2026-11-24: «فارزة هي خطوة جديدة المفروض بسطر جديد»).
 *  الفارزة اللي برة الأقواس بين معادلتين تصير سطر جديد («;»)، والفارزة جوة (1,6) تبقى */
export function wLines(w: string) {
  const t = String(w ?? "").replace(/\$/g, "").trim();
  if (!t) return "";
  const out: string[] = [];
  let cur = "", depth = 0, bar = false;
  for (const ch of t) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === "|") bar = !bar;
    if ((ch === "," || ch === "،" || ch === ";") && depth === 0 && !bar) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  // قطعة بلا «=» وبلا كلام (مثل «y» لحالها) ترجع ويا اللي قبلها
  const lines: string[] = [];
  for (const p of out.map((x) => x.trim()).filter(Boolean)) {
    if (lines.length && !/[=<>≠≤≥]|[؀-ۿ]|\\(?:Rightarrow|to)/.test(p)) lines[lines.length - 1] += ", " + p;
    else lines.push(p);
  }
  return lines.join(" ; ");
}
/** ألفاظ الأستاذ بس (طلبه 2026-11-23: «أنا ما كاتب قصوى، انت شلون كاتب قصوى؟»): الكلمات اللي مو من كتابه تتبدل */
export const bookWords = (t: string) => String(t ?? "")
  .replace(/نقطة\s+(?:قصوى|عليا)/g, "نقطة نهاية عظمى").replace(/(نهاية|قيمة)\s+(?:قصوى|عليا)/g, "$1 عظمى")
  .replace(/نقطة\s+(?:دنيا|الدنيا)/g, "نقطة نهاية صغرى").replace(/(نهاية|قيمة)\s+(?:دنيا|الدنيا)/g, "$1 صغرى");
/** علامات الورقة اللي تنرسم لكل صورة: ✓ للخطوة الصح، ✗ للغلط، ونص الدرجة للناقصة، ودرجة السؤال بدائرة.
 *  only: سؤال واحد. extra: صور السؤال حتى لو ماكو عليها علامة (تطلع بدون رسم) */
const PAPER_RED = "#d40000";
export function marksByPage(qs: QgQuestion[], pages: string[], only?: number, extra: string[] = [], ink: InkItem[] = []): { ref: string; marks: PaperMark[] }[] {
  const by = new Map<number, PaperMark[]>();
  // العلامة كلها جوة الصورة، ما تطلع برة الورقة ولا على حافتها (طلب الأستاذ 2026-11-21)
  const inside = (v: number, lo: number) => Math.min(1000 - lo, Math.max(lo, v));
  // خط إيد الأستاذ: كل علامة تاخذ وحدة من اللي كاتبها، وتتبدل بالدور (المدح بالورقة الوحدة ما ينعاد نفسه ورا بعض).
  // وكل علامة تميل وتكبر وتصغر شوية، و«ممتاز» يتزحزح عن مكانه، حتى ما تبين نسخة وحدة ملزوگة (طلبه 2026-11-22).
  // الرقم ثابت لنفس الورقة: كل ما تنفتح تطلع نفس الشكل
  // لون واحد للورقة كلها (طلبه 2026-11-24: «كل الورقة تصحح للطالب يكون نفس اللون»): اللون اللي كاتب بيه أكثر شي، وإلا الأحمر.
  // كل خطه بهاي الورقة يتلون بيه، والعلامات المطبوعة (✓ ✗ والرقعة) هم
  const counts = new Map<string, number>();
  for (const x of ink) counts.set(x.c || PAPER_RED, (counts.get(x.c || PAPER_RED) ?? 0) + 1);
  const col = [...counts].sort((a, b) => b[1] - a[1] || Number(b[0] === PAPER_RED) - Number(a[0] === PAPER_RED))[0]?.[0] ?? PAPER_RED;
  const shape = (x: InkItem): InkShape => ({ w: x.w, h: x.h, s: x.s, c: col, ...(x.wd ? { wd: x.wd } : {}) });
  const pool = (k: InkKind) => ink.filter((x) => x.kind === k);
  const base = [...pages.join("|")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = (n: number) => { const v = Math.sin((base % 100000) * 0.731 + n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const turn = new Map<InkKind, number>();
  const pick = (k: InkKind) => { const l = pool(k); if (!l.length) return undefined; const i = turn.get(k) ?? base % l.length; turn.set(k, i + 1); return shape(l[i % l.length]); };
  const handOf = (id?: number) => { const x = id ? ink.find((i) => i.id === id && i.kind === "note") : undefined; return x ? shape(x) : undefined; };
  let count = 0;
  const fullQ = (q: QgQuestion) => q.answered && ((q.max > 0 && q.score >= q.max) || (q.steps.length > 0 && q.steps.every((s) => s.points <= 0 || s.awarded >= s.points)));
  const add = (pt: QgPt | undefined, m: Omit<PaperMark, "x" | "y">) => {
    if (!pt) return;
    if (m.note && !m.hand) { const same = ink.find((x) => x.kind === "note" && normNote(x.text) === normNote(m.note!)); if (same) m = { ...m, hand: shape(same) }; }
    const n = ++count * 3;
    const good = m.kind === "good";
    // «ممتاز» يتزحزح لحد 35 يمين ويسار و25 فوك وجوة، والباقي يبقى بمكان خطوته
    let x = inside(pt.x + (good ? Math.round((rnd(n) - 0.5) * 70) : 0), 70), y = inside(pt.y + (good ? Math.round((rnd(n + 1) - 0.5) * 50) : 0), 60);
    // علامتين فوك بعض (طلبه 2026-11-23): الجديدة تتزحزح لليسار لو لليمين لحد ما يصير بيناتهم مكان
    const near = by.get(pt.p) ?? [];
    const clash = (v: number) => near.some((o) => Math.abs(o.x - v) < 55 && Math.abs(o.y - y) < 40);
    for (const dir of x > 500 ? [-1, 1] : [1, -1]) {
      let v = x;
      for (let k = 0; k < 6 && clash(v); k++) v = inside(v + dir * 30, 70);
      if (!clash(v)) { x = v; break; }
    }
    // «الحل ناقص» الكبيرة كلمة بس، بلا «؟»
    // «الحل ناقص» الكبيرة كلمة بس بلا «؟»، والمدح كلمة بس بلا ✓
    const sym = (m.big && m.kind === "miss") || good ? undefined : pick(m.kind === "bad" ? "cross" : m.kind === "miss" ? "ask" : "tick");
    const word = good ? (m.word ?? pick("praise")) : undefined;
    const rot = Math.round((rnd(n + 2) - 0.5) * (good ? 18 : 12)), sc = Math.round((0.88 + rnd(n + 3) * 0.24) * 100) / 100;
    by.set(pt.p, [...(by.get(pt.p) ?? []), { x, y, ...m, ...(col !== PAPER_RED ? { col } : {}), ...(sym ? { sym } : {}), ...(word ? { word } : {}), ...(sym || word ? { rot, sc } : {}) }]);
  };
  // الطالب اللي جاب 100: «ممتاز» بخطه على أول سؤال بس (طلبه 2026-11-24). من مدحه اللي كاتب بيه «ممتاز»، وإلا أي مدح كاتبه، وإلا بالرقعة
  const done = qs.filter((q) => q.answered);
  const perfect = done.length > 0 && done.every(fullQ) && done.reduce((t, q) => t + q.score, 0) >= 100;
  const firstQ = perfect ? Math.min(...done.map((q) => q.n)) : -1;
  const praiseInk = (() => { const l = pool("praise").filter((x) => /ممتاز/.test(x.text)); const all = l.length ? l : pool("praise"); return all.length ? shape(all[base % all.length]) : undefined; })();
  for (const q of qs) {
    if (only !== undefined && q.n !== only) continue;
    if (!q.answered) continue;
    // العلامة بس على الخطوة الغلط ويا ملاحظتها، وبدون أرقام على الورقة. الخطوة الصح ما ياخذ ✓ (طلبه 2026-11-23: الصحات الكثيرة
    // تلخبط الطالب، ✓ على سطر غلط يحسبها صح). السؤال الصح كله: ✓ وحدة كبيرة بنصه، ويمها المدح إذا هو أول سؤال كامل
    // خطوة درجتها صفر (0 من 0) ما تنحسب ناقصة، والسؤال اللي أخذ درجته كاملة ✓ كبيرة بس (مؤمل انطى 20 من 20 وطلع «الحل ناقص»، 2026-11-24)
    const full = (s: QgStep) => s.points <= 0 || s.awarded >= s.points;
    const allRight = (q.max > 0 && q.score >= q.max) || (q.steps.length ? q.steps.every(full) : false);
    const placed = q.steps.filter((s) => s.at);
    const mid = placed.length ? { p: placed[Math.floor(placed.length / 2)].at!.p, x: Math.round(placed.reduce((t, s) => t + s.at!.x, 0) / placed.length), y: Math.round(placed.reduce((t, s) => t + s.at!.y, 0) / placed.length) } : undefined;
    const praiseAt = allRight ? mid ?? q.at : undefined;
    let drawn = 0;
    const unplaced: QgStep[] = [];
    // الخطوة اللي الطالب ما كتبها: من كتابته (w) إذا انقرت، وبالتصحيح القديم الخطوة اللي ما إلها مكان.
    // خطوتين ناقصات أو أكثر: «الحل ناقص» كبيرة وحدة بخطه، مو «ما كتبتها» على كل وحدة (طلبه 2026-11-24)
    const hasW = q.steps.some((s) => s.w !== undefined);
    const notWritten = (s: QgStep) => s.awarded <= 0 && (hasW ? !s.w : !s.at);
    const many = q.steps.filter((s) => !full(s) && notWritten(s)).length >= 2;
    for (const [i, s] of q.steps.entries()) {
      if (full(s)) continue;
      if (many && notWritten(s)) continue;
      if (hasW && notWritten(s)) { if (s.note) unplaced.push(s); continue; }
      const hand = handOf(s.hw);
      if (s.at) { add(s.at, { kind: "bad", text: "", q: q.n, i, ...(s.note ? { note: shortNote(s.note) } : {}), ...(hand ? { hand } : {}) }); drawn++; }
      else if (s.note) unplaced.push(s);
    }
    // ماكو مدح ولا ذم على الورقة (طلبه 2026-11-23: المقولة توصله لحالها مع الدرجة): ✓ كبيرة بس
    // ✓ الكبيرة على عرض الصفحة كلها، من الزاوية اليسرى جوة للزاوية اليمنى فوك، على طول شغل السؤال بهاي الصفحة (طلبه 2026-11-24)
    if (allRight) {
      const ys = placed.filter((s) => s.at!.p === praiseAt?.p).map((s) => s.at!.y);
      let y0 = ys.length ? Math.max(0, Math.min(...ys) - 70) : 50, y1 = ys.length ? Math.min(1000, Math.max(...ys) + 30) : 950;
      if (y1 - y0 < 300) { const c = (y0 + y1) / 2; y0 = Math.max(0, c - 150); y1 = Math.min(1000, y0 + 300); y0 = Math.max(0, y1 - 300); }
      add(praiseAt, { kind: "ok", text: "", big: true, box: { y0: Math.round(y0), y1: Math.round(y1) }, q: q.n, i: -1 });
      // «ممتاز» فوك يسار الصح الكبيرة (الصح تصعد لليمين)
      if (q.n === firstQ && praiseAt) add({ p: praiseAt.p, x: 270, y: Math.round(y0) + 60 }, { kind: "good", text: "ممتاز", q: q.n, i: -2, ...(praiseInk ? { word: praiseInk } : {}) });
      continue;
    }
    if (many) {
      // خطه: «الحل ناقص» اللي كتبها بمربع «؟ الحل ناقص» (كتبها كلمة، 3 مرات)، لو ملاحظة بنفس الكلام
      const note = ink.find((x) => x.kind === "note" && /الحل\s*ناقص/.test(x.text));
      const word = note ? shape(note) : pick("ask");
      const end = q.at ? { p: q.at.p, x: 500, y: Math.min(1000, q.at.y + 70) } : placed.length ? { ...placed[placed.length - 1].at!, x: 500 } : undefined;
      add(end, { kind: "miss", big: true, text: "", q: q.n, i: -1, note: "الحل ناقص", ...(word ? { hand: word } : {}) });
    }
    // الخطوات اللي ما كتبها الطالب (ما إلها مكان): «؟» تحت آخر جوابه (مو ✗ على سطر صح، طلبه 2026-11-22)، ويمها شنو ناقص
    if (unplaced.length || (!drawn && !many)) {
      const note = unplaced.length ? unplaced.map((s) => s.note).join("، ") : q.reason;
      // ملاحظة وحدة مكتوبة بخطه تنرسم بخطه، وأكثر من وحدة تنكتب بالخط
      const hand = unplaced.length === 1 ? handOf(unplaced[0].hw) : unplaced.length ? undefined : handOf(q.hw);
      const end = q.at ? { ...q.at, y: Math.min(1000, q.at.y + 45) } : undefined;
      add(end, { kind: unplaced.length ? "miss" : "bad", text: "", q: q.n, i: unplaced.length === 1 ? q.steps.indexOf(unplaced[0]) : -1, ...(note ? { note: shortNote(note) } : {}), ...(hand ? { hand } : {}) });
    }
  }
  const out: { ref: string; marks: PaperMark[] }[] = [];
  pages.forEach((ref, i) => { const m = by.get(i + 1); if (m || extra.includes(ref)) out.push({ ref, marks: m ?? [] }); });
  for (const ref of extra) if (!pages.includes(ref)) out.push({ ref, marks: [] });
  return out;
}

// ---------- الاعتراض (طلب الأستاذ 2026-11-22): إذا اختار «🧠 تصحيح قصي يراجعه»، يعيد السؤال المعترض عليه بس،
// ويقرا كلام الطالب. يقبل إذا الدرجة صارت أعلى، وإلا يرفض ويكتب ليش. الدرجة ما تنزل بالاعتراض أبداً
const OBJ_TEXT = `

OBJECTION REVIEW: you graded this student's paper before. The student now objects to the mark of ONE question and writes why. Re-check that question honestly against the marking scheme, looking again at the student's own work.
- If the student is right (a step was missed, misread, or a valid other method was not credited), give the corrected mark: a WHOLE number, higher than the old mark, never more than the maximum. accept=true.
- If the student is not right, keep the old mark: accept=false, mark = the old mark.
- Never lower the mark.
- "reason": one or two short sentences to the student, in the teacher's voice (spoken Iraqi Arabic, math as LaTeX between $ signs): what was corrected, or exactly why the mark stays. Never mention an AI, a model, a system or a marking scheme.`;
const OBJ_SCHEMA = { type: "object", properties: { accept: { type: "boolean" }, mark: { type: "integer" }, reason: { type: "string" } }, required: ["accept", "mark", "reason"], additionalProperties: false } as const;
export async function qusayJudgeObjection(it: Row, n: number, text: string, oldMark: number): Promise<{ accept: boolean; mark: number; reason: string; usd: number }> {
  const mat = await material(Number(it.version_id));
  const q = mat.qs.find((x) => x.n === n);
  if (!q) throw new Error("السؤال غير موجود بالنموذج");
  const s = await qgSettings();
  const content: Anthropic.ContentBlockParam[] = [];
  const ver = String((await one("bank_versions", { id: it.version_id }))?.model ?? "");
  let t = `MARKING SCHEME of question ${n}${ver ? ` (exam version ${ver}, النسخة ${ver})` : ""} — maximum ${q.max} points`;
  if (q.qText) t += `\nQuestion text: ${q.qText}`;
  if (q.rubric) {
    t += `\nMethod 1 steps:\n${stepsText(q.rubric.steps)}`;
    q.rubric.alts.forEach((a, k) => { t += `\nMethod ${k + 2} steps:\n${stepsText(a)}`; });
  } else t += q.model.length ? "\nNo steps written: use the teacher's model solution image(s) below." : "\nNo steps written: use this question's part of the teacher's model solution PDF.";
  content.push({ type: "text", text: t });
  if (q.qImg) content.push(block(q.qImg, `صورة السؤال ${n}`));
  for (const m of q.model) content.push(block(m, `حل السؤال ${n}`));
  if (mat.pdf && (!q.rubric && !q.model.length || hasDrawStep(q.rubric))) content.push({ type: "text", text: "Teacher's model solution PDF:" }, block(mat.pdf, "PDF الحل"));
  const prev = (await qgResultOf(it.id))?.qs.find((x) => x.n === n);
  if (prev?.steps.length) content.push({ type: "text", text: `\nYOUR EARLIER GRADING of question ${n}: ${oldMark} / ${q.max}\n${prev.steps.map((st, i) => `  ${i + 1}. [${st.awarded} of ${st.points}] ${st.text}${st.note ? ` — note: ${st.note}` : ""}`).join("\n")}` });
  else content.push({ type: "text", text: `\nEarlier mark of question ${n}: ${oldMark} / ${q.max}` });
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  const mine = answers.filter((a) => Number(a.q) === n), pages = mine.length ? mine : answers.filter((a) => !a.q);
  content.push({ type: "text", text: mine.length ? `\nStudent's answer to question ${n}:` : "\nStudent's pages for the whole paper (find question " + n + "):" });
  for (const a of pages) { const b = await readRef(String(a.file)); if (b) content.push(block(b, `جواب سؤال ${n}`)); }
  content.push({ type: "text", text: `\nTHE STUDENT'S OBJECTION:\n${text.slice(0, 1500)}` });
  const req: Req = {
    model: await modelId(), max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM + OBJ_TEXT + styleText(s.style) + await topicRules(Number(it.exam_id)) }],
    output_config: { effort: s.effort, format: { type: "json_schema", schema: OBJ_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content }],
  };
  const msg = await apiImpl.create(req);
  const u = msg.usage;
  const usd = usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model }, false);
  await addSpend("qusay", usd);
  let j: any = {};
  try { j = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { throw new Error("جواب الذكاء مو مفهوم"); }
  const mark = Math.min(q.max, Math.max(0, whole(Number(j.mark) || 0)));
  const accept = !!j.accept && mark > oldMark;
  const reason = bookWords(String(j.reason ?? "")).slice(0, 500);
  // الطالب يشوف الدرجة الجديدة بتفصيل ورقته، ويا سبب القبول
  if (accept) {
    const res = await qgResultOf(it.id);
    const rq = res?.qs.find((x) => x.n === n);
    if (res && rq) { rq.score = mark; rq.reason = reason || rq.reason; res.total = res.qs.reduce((x, y) => x + y.score, 0); await kvSet(resKey(it.id), JSON.stringify(res)); }
  }
  await addLog({ at: stamp(), kind: "obj", item: it.id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), total: accept ? mark : oldMark, usd, note: `✋ اعتراض السؤال ${n}: ${accept ? `انقبل ${oldMark} ← ${mark}` : `انرفض، بقت ${oldMark}`}${reason ? ` · ${reason.slice(0, 120)}` : ""}` });
  return { accept, mark: accept ? mark : oldMark, reason, usd };
}

// ---------- «🪄 رتّب كلامي» (2026-11-22): الفويس ينكتب بغلطات («سرك Respect» بدل «متناظرة حول محور الصادات»)، فيرتبه
// قواعد واضحة مرقمة بكلامه، والأستاذ يقراها ويصلحها قبل الحفظ. ما يضيف قواعد من عنده
const TIDY = `A math teacher (Iraqi 6th preparatory) dictated by voice how he grades one exam topic. Speech recognition wrote it with many wrong words (English words, broken Arabic, numbers in the wrong place).
Rewrite it as clear, numbered grading rules in simple Iraqi Arabic, one rule per line, keeping EVERY rule and example he gave and his own phrases for notes to students (the words he says he writes to the student, like «عيوني ترى القانون ما كاتبه»).
- Fix the speech-recognition mistakes by their mathematical meaning (e.g. «سرك Respect واي X» → متناظرة حول محور الصادات; «إكس تربيع» → x²; «خط الاختبار» stays خط الاختبار; «فجوة» = a gap/hole left at the zero of the sign line).
- He will read and correct your text on an iPad, so write math the simple way people type it on a phone, never LaTeX: no $ signs and no backslashes. Powers with ² ³ (x², x³) or ^ (x^4), fractions with / and brackets (3/x², 6x/(x²+3)²), roots √(x+1), and the symbols ≠ ± θ π. Example: «y = 3/x²: أوسع مجال R عدا x = 0، لازم يكتب x² ≠ 0».
- If he says something about one exam version, start that rule with «بالنسخة B:».
- Do not add rules he did not say. Do not drop any. If a part cannot be understood at all, keep it at the end under «ما فهمته:» so he can fix it.
Return only the rules.`;
/** كتابة بالذكاء المختار بـ ⚙️ (🔎 حلول الذكاء: يعيد كتابة حل على تصليح الأستاذ). kind: وين تنحسب الصرفية */
export async function aiWrite(system: string, user: string, kind: "qa" | "qusay" = "qa"): Promise<string> {
  const msg = await apiImpl.create({ model: await modelId(), max_tokens: 16000, system, output_config: { effort: "medium" }, messages: [{ role: "user", content: user }] } as Req);
  const u = msg.usage;
  await addSpend(kind, usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model }, false));
  if (msg.stop_reason === "max_tokens") throw new Error("الحل طويل كلش وانگطع");
  const out = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!out) throw new Error("ما گدرت أكتبه، جرب مرة ثانية");
  return out;
}
export async function tidyNotes(text: string): Promise<{ text: string; usd: number }> {
  const raw = text.trim().slice(0, STYLE_MAX);
  if (!raw) throw new Error("ماكو كلام حتى أرتبه");
  const msg = await apiImpl.create({ model: MODEL, max_tokens: 16000, system: TIDY, output_config: { effort: "low" }, messages: [{ role: "user", content: raw }] } as Req);
  const u = msg.usage;
  const usd = usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model }, false);
  await addSpend("qusay", usd);
  if (msg.stop_reason === "max_tokens") throw new Error("الكلام طويل كلش، رتبه على دفعتين");
  const out = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!out) throw new Error("ما گدرت أرتبه، جرب مرة ثانية");
  return { text: out.slice(0, STYLE_MAX), usd };
}

// ---------- «📄 ارفع ملف» (2026-11-22): PDF لو صورة لشرحه المكتوب، ينقرا حرف بحرف بدون تغيير. الـ Word ببلاش (notesFile.ts)
const SCAN = `This file is a math teacher's own written grading rules for one exam topic (Iraqi 6th preparatory, Arabic).
Copy its text EXACTLY as written, word for word, in reading order. Do not fix, rephrase, summarize, reorder, add or drop anything; keep his numbering and bullets.
Each paragraph, bullet or table row on its own line. Skip page numbers and repeated page headers.
Write every equation the simple way people type it on a phone, never LaTeX: no $ signs and no backslashes. Powers with ² ³ (x², x³) or ^ (x^4), fractions with / and brackets (3/x², 6x/(x²+3)²), roots √(x+1), primes f''(x), and the symbols ≠ ± ≤ ≥ ∞ θ π →.
If a word or symbol cannot be read, write [؟] in its place.
Return only the text.`;
export async function readNotesScan(kind: "pdf" | "image", name: string, b64: string): Promise<{ text: string; usd: number }> {
  const media = kind === "pdf" ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
  const block = kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: media, data: b64 } }
    : { type: "image", source: { type: "base64", media_type: media, data: b64 } };
  const msg = await apiImpl.create({ model: MODEL, max_tokens: 16000, system: SCAN, output_config: { effort: "low" }, messages: [{ role: "user", content: [block, { type: "text", text: "انقل كلامه مثل ما هو." }] }] } as Req);
  const u = msg.usage;
  const usd = usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model }, false);
  await addSpend("qusay", usd);
  if (msg.stop_reason === "max_tokens") throw new Error("الملف طويل كلش، قسمه لملفين");
  const out = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!out) throw new Error("ما گدرت أقرا الملف، جرب مرة ثانية");
  return { text: out.slice(0, STYLE_MAX), usd };
}

/** درجات صحيحة بس، بدون نص (طلب الأستاذ 2026-11-22: «8.5» تبين للطالب إنها مو منه). النص يروح لصالح الطالب */
const whole = (x: number) => Math.floor(x + 0.5 + 1e-9);
/** يقرا جواب الذكاء ويرتبه: الدرجة من الخطوات (مو من رقمه)، وما تعدي حدها */
/** الذكاء جاوب بس جوابه ما ينفع: الطلب انحسب فلوسه، فلازم تنحسب بالصرفية */
export class PaidError extends Error { usd = 0; tokens: QgTokens; constructor(m: string, tokens: QgTokens) { super(m); this.tokens = tokens; } }
const priced = (e: unknown, batch: boolean) => { if (e instanceof PaidError) e.usd = usdOf(e.tokens, batch); return e; };
/** صرفية طلب خرب بس انحسب: تنضاف للصرفية وترجع حتى تنكتب بالسجل */
async function chargeFailed(e: unknown) { if (e instanceof PaidError && e.usd > 0) { await addSpend("qusay", e.usd); return e.usd; } return undefined; }
export function readAnswer(msg: Anthropic.Message, mat: VMat, unanswered: Set<number>, answerOnly: boolean, pages = 0): { qs: QgQuestion[]; tokens: QgTokens } {
  const u = msg.usage;
  const tokens = { in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: msg.model };
  if (msg.stop_reason === "refusal") throw new PaidError("الذكاء رفض يصحح الورقة", tokens);
  if (msg.stop_reason === "max_tokens") throw new PaidError("جواب الذكاء طويل وانگطع", tokens);
  let j: { questions?: any[] } = {};
  try { j = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { throw new PaidError("جواب الذكاء مو مفهوم", tokens); }
  const got = new Map((Array.isArray(j.questions) ? j.questions : []).map((q) => [Number(q?.n), q]));
  const papers = papersOf(j);
  const qs = mat.qs.map((m): QgQuestion => {
    if (unanswered.has(m.n)) return { n: m.n, max: m.max, score: 0, answered: false, sure: true, reason: "ما جاوب", method: 1, steps: [] };
    const a = got.get(m.n);
    // سؤال جاوبه الطالب والذكاء ما رجع درجته: ما ينحسب صفر أبد (طالب تجربة 31: 24 بدل 81)، الورقة تتعاد
    if (!a) throw new PaidError(`جواب الذكاء ناقص (السؤال ${m.n} ما رجعت درجته)`, tokens);
    const answered = a.answered !== false;
    const method = Math.max(1, Math.round(Number(a.method) || 1));
    const plan = m.rubric ? (m.rubric.alts[method - 2] ?? m.rubric.steps) : null;
    const byI = new Map((Array.isArray(a.steps) ? a.steps : []).map((s: any) => [Number(s?.i), s]));
    const steps: QgStep[] = plan ? plan.map((p, k) => {
      const s: any = byI.get(k + 1);
      const at = ptOf(s, pages, papers);
      const hw = Math.round(Number(s?.hw) || 0);
      const awarded = Math.min(p.points, Math.max(0, whole(Number(s?.awarded) || 0)));
      // خطوة درجتها كاملة ما ينكتب عليها غلط (طالب تجربة 30: «الأس لازم -5» وهو كاتب -5 وانطاه 20 من 20)
      const w = String(s?.w ?? "").trim().slice(0, 400);
      return { text: p.text, points: p.points, awarded, note: awarded >= p.points ? "" : cleanNote(String(s?.note ?? "")).slice(0, 300), ...(w ? { w } : {}), ...(at ? { at } : {}), ...(hw > 0 && awarded < p.points ? { hw } : {}) };
    }) : [];
    // الذكاء رجّع درجة السؤال بس بدون خطوات (طالب تجربة 9: «ممتاز عاشت الأيادي» وصفر): الكامل ينحسب كامل، والباقي يتعاد
    if (plan && answered && !plan.some((_, k) => byI.has(k + 1))) {
      if ((Number(a.score) || 0) >= m.max) for (const st of steps) st.awarded = st.points;
      else throw new PaidError(`جواب الذكاء ناقص (السؤال ${m.n} بلا خطوات)`, tokens);
    }
    let score = plan ? steps.reduce((t, s) => t + s.awarded, 0) : Number(a.score) || 0;
    score = answered ? Math.min(m.max, Math.max(0, whole(score))) : 0;
    const at = ptOf(a, pages, papers, true);
    const hw = Math.round(Number(a.hw) || 0);
    return { n: m.n, max: m.max, score, answered, sure: a.sure !== false, reason: cleanNote(String(a.reason ?? "")).slice(0, 500), method: plan ? method : 1, steps, ...(at ? { at } : {}), ...(hw > 0 ? { hw } : {}) };
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
/** معدل كلفة الورقة من آخر الأوراق، حتى نحسب حساب الدفعات اللي بعدها ما رجعت */
async function avgUsd() {
  const paid = (await qgLog()).filter((r) => r.usd).slice(-50);
  return paid.length ? paid.reduce((t, r) => t + Number(r.usd), 0) / paid.length : 0.003;
}
/** صرفية اليوم ويا تقدير الدفعات اللي بالطريق (كلفتها تنحسب من ترجع، فبدونها يعبر الحد) */
async function spentWithPending() {
  const jobs = (await batches()).reduce((t, b) => t + b.jobs.length, 0);
  return await todayUsd() + (jobs ? jobs * await avgUsd() / 2 : 0);
}
async function overCap(s: QgSettings) {
  const spent = await spentWithPending();
  if (spent < s.cap) return false;
  const day = stamp().slice(0, 10);
  if (!await kvGet(capNoteKey(day))) {
    await kvSet(capNoteKey(day), "1");
    await addLog({ at: stamp(), kind: "cap", note: `وصل حد اليوم ${s.cap} دولار` });
    for (const id of ADMIN_IDS) await send(id, `👤 <b>لصاحب البوت بس</b>\n🧠 «تصحيح قصي» وصل حد اليوم (${s.cap} دولار، تقريباً ${Math.round(s.cap * IQD)} دينار) فوگف لباچر. ${s.carry ? "الأوراق الباقية تنتظر وتتصحح باچر، وما تروح للمصححين." : "الأوراق الباقية رجعت للمصححين."}\nتگدر تكبر الحد من صفحته.`).catch(() => undefined);
  }
  return true;
}
/** يختار الأوراق اللي ياخذها: مواضيعه المأشرة بس، ومو من مواضيع أو طلاب نظام التصحيح AI مال مؤمل */
async function liveTaker() {
  const s = await qgSettings();
  // وصل الحد: إذا «الزايد لباچر» الأوراق تبقى محجوبة عن المصححين وتنتظره، وإلا ترجعلهم
  const active = keyReady() && await qgOn() && s.live.length > 0 && (s.carry || !(await spentWithPending() >= s.cap));
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
type Prepared = { job: Job; req: Req; mat: VMat; unanswered: Set<number>; answerOnly: boolean; pages: string[]; marks: boolean };
async function prepare(jobs: Job[], effort: QgEffort, onFail: (j: Job, e: unknown) => Promise<void>, marks = false, style = ""): Promise<Prepared[]> {
  const mats = new Map<number, VMat>();
  const out: Prepared[] = [];
  for (const job of jobs) {
    try {
      const vid = Number(job.it.version_id);
      if (!mats.has(vid)) mats.set(vid, await material(vid));
      const mat = mats.get(vid)!;
      const { req, unanswered, pages } = await buildRequest(job.it, mat, effort, marks, style);
      out.push({ job, req, mat, unanswered, answerOnly: answerOnlyOf(await one("bank_exams", { id: job.it.exam_id })) > 0, pages, marks });
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
  const usd = await chargeFailed(e);
  await addLog({ at: stamp(), kind: "failed", item: it.id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), usd, note: `${job.kind === "trial" ? "🧪 تجربة: " : ""}${errText(e)}` });
  if (job.kind === "live") await release(it.id);
}
/** الذكاء رجع جواب الورقة: التجربة تنحفظ بس، والحقيقية تنطي الدرجة أو ترجع للمصححين */
async function settle(p: Prepared, msg: Anthropic.Message, batch: boolean, finish: (uid: number, itemId: number) => Promise<unknown>) {
  const { it, kind } = p.job;
  let read: ReturnType<typeof readAnswer>;
  try { read = readAnswer(msg, p.mat, p.unanswered, p.answerOnly, p.marks ? p.pages.length : 0); } catch (e) { throw priced(e, batch); }
  const { qs, tokens } = read;
  const usd = usdOf(tokens, batch);
  await addSpend("qusay", usd);
  const total = qs.reduce((t, q) => t + q.score, 0);
  const sure = qs.every((q) => q.sure);
  const name = await nameOfRow(it), exam = await examTitle(it.exam_id);
  const res: QgResult = { at: stamp(), kind, total, sure, qs, usd, tokens, batch, ...(p.marks ? { pages: p.pages } : {}) };
  if (kind === "trial") {
    res.human = it.graded_at ? Number(it.total ?? 0) : null;
    await kvSet(resKey(it.id), JSON.stringify(res));
    await addLog({ at: stamp(), kind: "trial", item: it.id, name, exam, total, usd, note: `${res.human === null ? "ورقة جديدة، بعدها عند المصححين" : `المصحح ${res.human}`}${sure ? "" : " · ⚠️ ما متأكد"}` });
    return;
  }
  const now = await one("sched_items", { id: it.id });
  if (!now || now.graded_at || now.grader_id !== QUSAY_GRADER) return;
  const why = qs.filter((q) => !q.sure).map((q) => `س${q.n}: ${q.reason || "ما متأكد"}`).join(" | ").slice(0, 300);
  // ما متأكد: يرجعها للمصححين بس إذا صاحب البوت اختار هيچ، وورقة طالب التجربة ما ترجع أبداً
  if (!sure && it.user_id >= 0 && (await qgSettings()).unsure === "graders") {
    await kvSet(resKey(it.id), JSON.stringify(res));
    await release(it.id);
    await addLog({ at: stamp(), kind: "unsure", item: it.id, name, exam, total, usd, note: why });
    return;
  }
  // ⏸ بيها عبارات بعده ما كاتبها بخطه: الورقة تنتظره، ويوصله تنبيه يكتبها لو يدزها بالرقعة (طلبه 2026-11-24)
  if (res.pages?.length && (await qgSettings()).wait) {
    const ph = await phrasesOf(res, Number(it.exam_id));
    if (ph.length) {
      await kvSet(resKey(it.id), JSON.stringify(res));
      const l = await waits();
      if (!l.some((w) => w.id === it.id)) await kvSet(WAIT, JSON.stringify([...l, { id: it.id, exam: Number(it.exam_id), at: stamp(), answerOnly: p.answerOnly }]));
      await addLog({ at: stamp(), kind: "wait", item: it.id, name, exam, total, usd, note: `⏸ تنتظر خطك: ${ph.length} عبارة${sure ? "" : ` · ⚠️ ما متأكد: ${why}`}` });
      await waitNotice(Number(it.exam_id), false).catch((e) => console.error("ink wait notice", e));
      return;
    }
  }
  await sendResult(it.id, res, p.answerOnly, finish);
  await addLog({ at: stamp(), kind: "sent", item: it.id, name, exam, total, usd, ...(sure ? {} : { note: `⚠️ ما متأكد، وصححها: ${why}` }) });
}
/** يحفظ درجات الأسئلة ويبعث بطاقة الدرجة باسم «تصحيح قصي». إذا خربت ترجع الورقة مثل ما چانت */
async function sendResult(id: number, res: QgResult, answerOnly: boolean, finish: (uid: number, itemId: number) => Promise<unknown>) {
  for (const q of res.qs) await put("question_marks", { item_id: id, q: q.n, mark: !q.answered && answerOnly ? SKIP : q.score });
  res.sent = true;
  await kvSet(resKey(id), JSON.stringify(res));
  try {
    await finish(QUSAY_GRADER, id);
  } catch (e) {
    res.sent = false;
    await kvSet(resKey(id), JSON.stringify({ ...res, kind: "live", sure: false }));
    await release(id);
    throw e;
  }
}
// ---------- ⏸ الورقة تنتظر خطه (طلب الأستاذ 2026-11-24): «تصحيح قصي» يصححها، وإذا بيها ملاحظات بعده ما كاتبها بخطه
// ما تنبعث. يوصله تنبيه بالعبارات (الأكثر تكرار أول) وزرين: «✍️ راح أكتبها» لو «📤 دزها بالرقعة». الورقة تنتظر لحد ما يدوس،
// وكل 3 ساعات يوصله تذكير. من يكتب كل عبارات ورقة، تنبعث وحدها بخطه
const WAIT = "qg_inkwait", WAIT_NOTE = "qg_inkwait_note";
type Wait = { id: number; exam: number; at: string; answerOnly: boolean };
const waits = () => readJson<Wait[]>(WAIT, []);
const NOTE_GAP = 30 * 60_000, REMIND = 3 * 3600_000;
/** العبارات اللي تنرسم على الورقة بالخط المطبوع (بعده ما كاتبها بخطه) */
export async function phrasesOf(res: QgResult, exam: number): Promise<string[]> {
  if (!res.pages?.length) return [];
  const ink = await inkFor(exam);
  const out = new Set<string>();
  for (const pg of marksByPage(res.qs, res.pages, undefined, [], ink)) for (const m of pg.marks) if (m.note && !m.hand) out.add(m.note);
  return [...out];
}
/** الأوراق اللي تنتظر خطه، لكل موضوع: كم ورقة، والعبارات من الأكثر تكرار */
export async function inkWaitList() {
  const by = new Map<number, { papers: number; ph: Map<string, number> }>();
  for (const w of await waits()) {
    const r = await qgResultOf(w.id);
    if (!r || r.sent) continue;
    const g = by.get(w.exam) ?? { papers: 0, ph: new Map<string, number>() };
    g.papers++;
    for (const t of await phrasesOf(r, w.exam)) g.ph.set(t, (g.ph.get(t) ?? 0) + 1);
    by.set(w.exam, g);
  }
  return await Promise.all([...by].map(async ([exam, g]) => ({ exam, title: await examTitle(exam), papers: g.papers, phrases: [...g.ph].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n })) })));
}
/** يبعث أوراق موضوع: ruqaa كلها (العبارات الناقصة بالرقعة)، وإلا بس اللي صارت كل عباراتها بخطه */
export async function releaseWaits(exam: number, ruqaa: boolean, finish: (uid: number, itemId: number) => Promise<unknown>) {
  const mine = (await waits()).filter((w) => w.exam === exam);
  const done = new Set<number>();
  let sent = 0;
  for (const w of mine) {
    const r = await qgResultOf(w.id);
    const it = await one("sched_items", { id: w.id });
    if (!r || !it || it.graded_at || r.sent || it.grader_id !== QUSAY_GRADER) { done.add(w.id); continue; }
    if (!ruqaa && (await phrasesOf(r, exam)).length) continue;
    done.add(w.id);
    try {
      await sendResult(w.id, r, w.answerOnly, finish);
      sent++;
      await addLog({ at: stamp(), kind: "sent", item: w.id, name: await nameOfRow(it), exam: await examTitle(exam), total: r.total, note: ruqaa ? "📤 انبعثت، والعبارات الناقصة بالرقعة" : "✍️ انبعثت بخطك" });
    } catch (e) { console.error("ink wait send", w.id, e); }
  }
  await kvSet(WAIT, JSON.stringify((await waits()).filter((w) => !done.has(w.id))));
  return sent;
}
/** تنبيه لصاحب البوت (واللي عنده صلاحية تصحيح قصي): أول مرة، وكل 3 ساعات تذكير لحد ما يدوس */
async function waitNotice(exam: number, remind: boolean) {
  const last = await readJson<Record<string, number>>(WAIT_NOTE, {});
  if (Date.now() - (last[exam] ?? 0) < (remind ? REMIND : NOTE_GAP)) return;
  const g = (await inkWaitList()).find((x) => x.exam === exam);
  if (!g || !g.phrases.length) return;
  last[exam] = Date.now();
  await kvSet(WAIT_NOTE, JSON.stringify(last));
  const { staffIds } = await import("./data.ts");
  const { adminPageLink } = await import("./keyboards.ts");
  const { esc, plainMath } = await import("./util.ts");
  const top = g.phrases.slice(0, 6).map((p) => `• ${esc(plainMath(p.t))}${p.n > 1 ? ` (${p.n} مرات)` : ""}`).join("\n");
  const more = g.phrases.length > 6 ? `\n• و${g.phrases.length - 6} غيرها` : "";
  const text = `${remind ? "⏰ <b>تذكير</b>\n" : ""}✍️ <b>${g.papers} ${g.papers > 1 ? "أوراق" : "ورقة"} «${esc(g.title)}» تنتظر خطك</b>
صححها تصحيح قصي، بس بيها ${g.phrases.length} عبارة بعدك ما كاتبها بخط إيدك:
${top}${more}

تكتبها هسه، لو تنبعث للطلاب بخط الرقعة؟ الأوراق تنتظرك لحد ما تختار.`;
  for (const a of await staffIds("qusay")) {
    await send(a, text, { kb: [[{ text: "✍️ راح أكتبها", web_app: { url: `${adminPageLink("qusay", a)}&ink=${exam}` } }], [{ text: "📤 دزها بالرقعة", callback_data: `qiw:${exam}` }]] });
  }
}
/** تذكير كل 3 ساعات بكل موضوع بيه أوراق تنتظر */
async function waitReminders() {
  for (const exam of new Set((await waits()).map((w) => w.exam))) await waitNotice(exam, true).catch((e) => console.error("ink wait remind", e));
}

/** «✅ ابعث درجته»: ورقة رجعها للمصححين لأنه ما متأكد، صاحب البوت يبعث درجته المحفوظة بدون ما يصرف مرة ثانية */
export async function sendSaved(id: number, finish: (uid: number, itemId: number) => Promise<unknown>) {
  const r = await qgResultOf(id);
  if (!r || r.kind !== "live" || r.sent) throw new Error("ماكو درجة محفوظة تنبعث لهاي الورقة");
  const it = await one("sched_items", { id });
  if (!it || it.graded_at) throw new Error("هاي الورقة انصححت");
  if (it.grader_id !== QUSAY_GRADER) {
    if (it.grader_id) throw new Error("هاي الورقة ماخذها مصحح هسه");
    const got = await tx(async () => { const cur = await one("sched_items", { id }); if (!cur || cur.graded_at || cur.grader_id) return false; await update("sched_items", { id }, { grader_id: QUSAY_GRADER }); return true; });
    if (!got) throw new Error("مصحح سبقك عليها");
  }
  await sendResult(id, r, answerOnlyOf(await one("bank_exams", { id: it.exam_id })) > 0, finish);
  await addLog({ at: stamp(), kind: "sent", item: id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), total: r.total, note: "✅ إنت بعثت درجته" });
}

// ---------- 🧪 التجربة المخفية: يصحح بالسر ويطلع النتيجة لصاحب البوت بس، ولا شي يتغير ولا يوصل للطالب.
// على أوراق صححها مصحح (نقارن فوراً)، لو على أوراق جديدة ما مصححة (طلب الأستاذ 2026-11-21): تبقى عند المصححين
// مثل ما هي، ومن يصححها مصحح تطلع درجته جنب درجة «تصحيح قصي» وحدها
export async function trialQueue(): Promise<number[]> { const q = await readJson<number[]>(TRIAL, []); return Array.isArray(q) ? q.map(Number) : []; }
/** درجة المصحح البشري على الورقة هسه، إذا صححها */
export const humanMark = (it: Row) => (it.graded_at && it.grader_id && it.grader_id !== QUSAY_GRADER ? Number(it.total ?? 0) : null);
/** أوراق هذا الموضوع وبعدها ما تجربت: fresh = الجديدة اللي سلمها الطالب وما صححها أحد (آخرها أول)، وإلا اللي صححها مصحح بشري */
/** قراءات كثيرة سوة (مو وحدة ورا وحدة): الصفحة چانت تاخذ دقايق تحمل (طلبه 2026-11-23) */
export async function pmap<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}
/** أوراق الموضوع اللي تگدر تتجرب، من الأوراق ونتائجها اللي انقرت سوة */
export function pickCandidates(items: Row[], tried: (id: number) => boolean, queued: Set<number>, examId: number, fresh = false): Row[] {
  const when = (it: Row) => String((fresh ? it.submitted_at : it.graded_at) ?? "");
  return items.filter((it) => it.exam_id === examId && it.status === "done").sort((a, b) => when(b).localeCompare(when(a))).filter((it) => {
    if (!it.version_id || queued.has(it.id) || it.grader_id === QUSAY_GRADER) return false;
    if (fresh ? !!it.graded_at : !it.graded_at || !it.grader_id || it.grader_id === AI_GRADER) return false;
    return !tried(it.id);
  });
}
export async function trialCandidates(examId: number, fresh = false): Promise<Row[]> {
  const queued = new Set(await trialQueue());
  const items = await find("sched_items", { exam_id: examId, status: "done" });
  const has = new Set((await pmap(items, 40, async (it) => ((await qgResultOf(it.id)) ? it.id : 0))).filter(Boolean));
  return pickCandidates(items, (id) => has.has(id), queued, examId, fresh);
}
/** أوراق التجربة اللي صاحب البوت اختار تتصحح «⚡ هسه» حتى لو الإعداد بالدفعة */
const nowList = async () => { const l = await readJson<number[]>(NOW, []); return Array.isArray(l) ? l.map(Number) : []; };
export async function markNow(ids: number[]) { if (ids.length) await kvSet(NOW, JSON.stringify([...new Set([...await nowList(), ...ids])])); }
export async function queueTrial(examId: number, n: number, fresh = false, now = false) {
  const want = Math.max(1, Math.min(50, Math.round(n) || 0));
  const cand = [];
  const ready = new Map<number, boolean>();
  for (const it of await trialCandidates(examId, fresh)) {
    if (cand.length >= want) break;
    if (!ready.has(it.version_id)) ready.set(it.version_id, !await versionWhyNot(it.version_id));
    if (ready.get(it.version_id)) cand.push(it.id as number);
  }
  await kvSet(TRIAL, JSON.stringify([...await trialQueue(), ...cand]));
  if (now) await markNow(cand);
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
async function pollBatches(finish: (uid: number, itemId: number) => Promise<unknown>, effort: QgEffort, marks = false, style = "") {
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
      const [p] = await prepare([job], effort, failed, marks, style);
      if (!p) continue;
      try { await settle(p, r.msg, true, finish); done++; } catch (e) { await failed(job, e); }
    }
  }
  await kvSet(BATCHES, JSON.stringify(keep));
  return done;
}

// ---------- «⚖️ قارن» (طلب الأستاذ 2026-11-23): نفس الأوراق يصححها نظام مؤمل وتصحيح قصي، كل واحد بالسر، وتنقارن بدرجة
// الأستاذ (لو المصحح) اللي صححها بإيده. ولا شي يتغير بالورقة ولا يوصل للطالب
/** full / pages: التصحيح كامل حتى ينعرض جنب بعض (مؤمل: خطوة خطوة، قصي: العلامات على الورقة) */
export type QgCmpSide = { at: string; total: number; qs: { n: number; score: number; max: number; reason: string }[]; usd: number; full?: unknown[]; pages?: string[] };
export type QgCmp = { exam: number; queued: string; mu?: QgCmpSide; qg?: QgCmpSide; muErr?: string; qgErr?: string; tries?: number };
const CMP_Q = "qg_cmp_q";
const cmpKey = (id: number) => `qg_cmp_${id}`;
export const cmpOf = (id: number) => readJson<QgCmp | null>(cmpKey(id), null);
const cmpQueue = async () => { const l = await readJson<number[]>(CMP_Q, []); return Array.isArray(l) ? l.map(Number) : []; };
/** المصحح البشري اللي صحح الورقة (مو مؤمل ولا قصي): درجته هي المرجع */
export const refGrader = (it: Row) => !!it.graded_at && !!it.grader_id && it.grader_id !== QUSAY_GRADER && it.grader_id !== AI_GRADER;
/** أوراق الموضوع اللي تنقارن: اللي صححها إنسان أول (حتى نعرف منو أقرب)، بعدها أوراق طلاب التجربة */
export async function queueCompare(examId: number, n: number) {
  const want = Math.max(1, Math.min(30, Math.round(n) || 0));
  const queued = new Set(await cmpQueue());
  // الأحدث أول
  const all = (await find("sched_items", { exam_id: examId, status: "done" })).filter((it) => it.version_id && !queued.has(it.id)).sort((a, b) => b.id - a.id);
  const ready = new Map<number, boolean>();
  const pick: number[] = [];
  const order = [...all.filter(refGrader), ...all.filter((it) => !refGrader(it) && it.user_id < 0)];
  for (const it of order) {
    if (pick.length >= want) break;
    if (await cmpOf(it.id)) continue;
    if (!ready.has(it.version_id)) ready.set(it.version_id, !await versionWhyNot(it.version_id));
    if (!ready.get(it.version_id)) continue;
    if (!(await find("exam_answers", { item_id: it.id })).length) continue;
    pick.push(it.id);
    await kvSet(cmpKey(it.id), JSON.stringify({ exam: examId, queued: stamp() } satisfies QgCmp));
  }
  if (pick.length) await kvSet(CMP_Q, JSON.stringify([...queued, ...pick]));
  return pick.length;
}
/** نتائج المقارنة لموضوع: كل ورقة ويا درجة المرجع ومؤمل وقصي */
export async function compareRows(examId: number, nameOf: (it: Row) => Promise<string>) {
  const out = [];
  const waiting = new Set(await cmpQueue());
  for (const it of await find("sched_items", { exam_id: examId, status: "done" })) {
    const c = await cmpOf(it.id);
    if (!c) continue;
    const ref = refGrader(it) ? new Map((await find("question_marks", { item_id: it.id })).map((m) => [Number(m.q), Number(m.mark)])) : null;
    out.push({ id: it.id, name: await nameOf(it), waiting: waiting.has(it.id), ref: ref ? { total: Number(it.total ?? 0), qs: Object.fromEntries(ref) } : null, mu: c.mu ?? null, qg: c.qg ?? null, muErr: c.muErr ?? "", qgErr: c.qgErr ?? "" });
  }
  return out.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.id - a.id);
}
/** يعيد الاثنين على نفس الأوراق (حتى ينحفظ التصحيح كامل للعرض جنب بعض) */
export async function redoCompare(examId: number) {
  const ids: number[] = [];
  for (const it of await find("sched_items", { exam_id: examId })) {
    const c = await cmpOf(it.id);
    if (!c) continue;
    await kvSet(cmpKey(it.id), JSON.stringify({ exam: c.exam, queued: stamp() } satisfies QgCmp));
    ids.push(it.id);
  }
  const q = await cmpQueue();
  await kvSet(CMP_Q, JSON.stringify([...q, ...ids.filter((x) => !q.includes(x))]));
  return ids.length;
}
/** «⚖️ الأوراق جنب بعض»: كل ورقة ويا صفحاتها ورسم الأستاذ عليها، وتصحيح مؤمل خطوة خطوة، وعلامات قصي على الورقة */
export async function compareSide(examId: number, nameOf: (it: Row) => Promise<string>) {
  const out = [];
  for (const it of (await find("sched_items", { exam_id: examId, status: "done" })).sort((a, b) => Number(refGrader(b)) - Number(refGrader(a)) || b.id - a.id)) {
    const c = await cmpOf(it.id);
    if (!c) continue;
    const answers = await find("exam_answers", { item_id: it.id }, { order: ["q", "id"] });
    const inks = new Map((await find("paper_ink", { item_id: it.id })).map((r) => [Number(r.page), String(r.ink ?? "")]));
    const marks = refGrader(it) ? Object.fromEntries((await find("question_marks", { item_id: it.id })).map((m) => [String(m.q), Number(m.mark)])) : null;
    const qgFull = (c.qg?.full ?? []) as QgQuestion[];
    const ink = qgFull.length ? await inkFor(Number(it.exam_id)) : [];
    out.push({
      id: it.id, name: await nameOf(it),
      ref: refGrader(it) ? { total: Number(it.total ?? 0), qs: marks } : null,
      pages: answers.map((a, i) => ({ ref: String(a.file), q: Number(a.q) || 0, ink: inks.get(i) ?? "" })),
      mu: c.mu ? { total: c.mu.total, usd: c.mu.usd, qs: c.mu.full ?? c.mu.qs } : null,
      qg: c.qg ? { total: c.qg.total, usd: c.qg.usd, qs: c.qg.qs, marked: qgFull.length && c.qg.pages ? dropHidden(marksByPage(qgFull, c.qg.pages, undefined, [], ink), []) : [] } : null,
      muErr: c.muErr ?? "", qgErr: c.qgErr ?? "",
    });
  }
  return out;
}
/** «🔁 أعد قصي بس»: نتيجة مؤمل تبقى، وقصي يعيد نفس الأوراق (بعد ما تغير إعداداته لو قواعده) */
export async function redoQusayCompare(examId: number) {
  const ids: number[] = [];
  for (const it of await find("sched_items", { exam_id: examId })) {
    const c = await cmpOf(it.id);
    if (!c) continue;
    delete c.qg; delete c.qgErr; c.tries = 0;
    await kvSet(cmpKey(it.id), JSON.stringify(c));
    ids.push(it.id);
  }
  const q = await cmpQueue();
  await kvSet(CMP_Q, JSON.stringify([...q, ...ids.filter((x) => !q.includes(x))]));
  return ids.length;
}
export async function clearCompare(examId: number) {
  const mine = new Set<number>();
  for (const it of await find("sched_items", { exam_id: examId })) { if (await cmpOf(it.id)) { mine.add(it.id); await kvSet(cmpKey(it.id), "null"); } }
  await kvSet(CMP_Q, JSON.stringify((await cmpQueue()).filter((x) => !mine.has(x))));
  return mine.size;
}
/** دكة المقارنة: ورقتين بكل دقيقة، كل وحدة بالاثنين */
async function compareTick(s: QgSettings) {
  const ids = (await cmpQueue()).slice(0, 2);
  if (!ids.length) return 0;
  const { gradeHidden, prices, costOf } = await import("./aiGrade.ts");
  let n = 0;
  for (const id of ids) {
    const c = await cmpOf(id);
    const it = await one("sched_items", { id });
    if (!c || !it) { await kvSet(CMP_Q, JSON.stringify((await cmpQueue()).filter((x) => x !== id))); continue; }
    c.tries = (c.tries ?? 0) + 1;
    if (!c.mu) {
      try {
        const res = await gradeHidden(it);
        const p = await prices();
        c.mu = { at: stamp(), total: res.reduce((t, q) => t + q.score, 0), qs: res.map((q) => ({ n: q.n, score: q.score, max: q.max, reason: String(q.reason ?? "").slice(0, 300) })), usd: res.reduce((t, q) => t + costOf(q.usage ?? [], p), 0),
          full: res.map((q) => ({ n: q.n, score: q.score, max: q.max, note: String(q.note ?? q.reason ?? "").slice(0, 400), steps: (q.steps ?? []).map((st) => ({ e: String(st.expected ?? "").slice(0, 300), s: String(st.student_tex || st.student || "").slice(0, 300), a: st.awarded, p: st.possible, r: String(st.reason_ar || st.reason || "").slice(0, 300) })) })) };
        delete c.muErr;
      } catch (e) { c.muErr = errText(e); }
    }
    if (!c.qg) {
      let err = "";
      // نفس التصحيح الحقيقي بالضبط: قواعده بالـ Word وتصليحاته وخطه وأمثلته (قبل چانت المقارنة تمشي بدونها، 2026-11-23)
      const [pp] = await prepare([{ it, kind: "trial" }], s.effort, async (_j, e) => { err = errText(e); }, true, s.style);
      if (pp) {
        try {
          const { qs, tokens } = readAnswer(await apiImpl.create(pp.req), pp.mat, pp.unanswered, pp.answerOnly, pp.pages.length);
          const usd = usdOf(tokens, false);
          await addSpend("qusay", usd);
          c.qg = { at: stamp(), total: qs.reduce((t, q) => t + q.score, 0), qs: qs.map((q) => ({ n: q.n, score: q.score, max: q.max, reason: q.reason.slice(0, 300) })), usd, full: qs, pages: pp.pages };
          delete c.qgErr;
        } catch (e) { await chargeFailed(priced(e, false)); c.qgErr = errText(e); }
      } else c.qgErr = err || "ما گدر يجهز الورقة";
    }
    await kvSet(cmpKey(id), JSON.stringify(c));
    if ((c.mu && c.qg) || (c.tries ?? 0) >= MAX_TRIES) await kvSet(CMP_Q, JSON.stringify((await cmpQueue()).filter((x) => x !== id)));
    n++;
  }
  return n;
}

// ---------- «🖍 تصحيح مؤمل على الورقة» (طلب الأستاذ 2026-11-24): نظام مؤمل يصحح ويرجع الخطوات بدون أماكن، فطلب صغير بجهتنا
// يلگى مكان كل خطوة بصفحات الطالب، والعلامات تنرسم بنفس رسم «تصحيح قصي» (الغلط بس، والسؤال الكامل ✓ كبيرة)
const MU_Q = "mu_mk_q";
const muKey = (id: number) => `mu_mk_${id}`;
/** ملاحظات مؤمل عربي بس: الإنگليزي ما يطلع للطالب أبداً */
const arOnly = (t: string) => (/[؀-ۿ]/.test(t) ? t : "");
const muArabic = (d: { qs: QgQuestion[]; pages: string[] } | null) => d && { ...d, qs: d.qs.map((q) => ({ ...q, reason: arOnly(q.reason), steps: q.steps.map((s) => ({ ...s, note: arOnly(s.note) })) })) };
export const muMarksOf = async (id: number) => muArabic(await readJson<{ qs: QgQuestion[]; pages: string[] } | null>(muKey(id), null));
const LOCATE = `These are photos of a student's math exam answers (Iraqi 6th grade). Each photo is preceded by its label [Image k].
For every listed step, find where on the photos the student wrote that step (or where it should have been) and return its position:
p = the image number, x and y = position on that image from 0 to 1000 (x left to right, y top to bottom), at the END of the line where the step is written.
For each question also return "at": the position just after the end of the student's whole answer to that question.
If a step is not written at all, return p = 0 for it.
Return {"questions":[{"n":..,"at":{"p":..,"x":..,"y":..},"steps":[{"i":..,"p":..,"x":..,"y":..}]}]}.`;
const LOC_SCHEMA = { type: "object", properties: { questions: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, at: { type: "object", properties: { p: { type: "integer" }, x: { type: "number" }, y: { type: "number" } }, required: ["p", "x", "y"], additionalProperties: false }, steps: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, p: { type: "integer" }, x: { type: "number" }, y: { type: "number" } }, required: ["i", "p", "x", "y"], additionalProperties: false } } }, required: ["n", "at", "steps"], additionalProperties: false } } }, required: ["questions"], additionalProperties: false };
export async function muMarksFor(itemId: number) {
  const it = await one("sched_items", { id: itemId });
  if (!it) return null;
  const { aiResultOf } = await import("./aiGrade.ts");
  const res = await aiResultOf(itemId);
  if (!res?.length) return null;
  const answers = await find("exam_answers", { item_id: itemId }, { order: ["q", "id"] });
  const pages: string[] = [];
  const content: Anthropic.ContentBlockParam[] = [];
  for (const a of answers) {
    const b = await readRef(String(a.file));
    if (!b || !isImage(String(a.file))) continue;
    pages.push(String(a.file));
    content.push({ type: "text", text: `[Image ${pages.length}]${a.q ? ` (answer to question ${a.q})` : ""}` }, block(b, `صفحة ${pages.length}`));
  }
  if (!pages.length) return null;
  content.push({ type: "text", text: "STEPS TO LOCATE:\n" + res.map((q) => `Question ${q.n}:\n` + q.steps.map((st, i) => `  ${i + 1}. ${String(st.expected ?? "").slice(0, 200)}`).join("\n")).join("\n") + "\n\n" + LOCATE });
  const m = await apiImpl.create({ model: await modelId(), max_tokens: 8000, output_config: { effort: "low", format: { type: "json_schema", schema: LOC_SCHEMA } }, messages: [{ role: "user", content }] } as Req);
  const u = m.usage;
  await addSpend("qusay", usdOf({ in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0, m: m.model }, false));
  let j: { questions?: any[] } = {};
  try { j = JSON.parse(m.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { j = {}; }
  const got = new Map((j.questions ?? []).map((q) => [Number(q.n), q]));
  const pt = (o: any) => (o && Number(o.p) >= 1 && Number(o.p) <= pages.length ? { p: Number(o.p), x: Math.min(1000, Math.max(0, Number(o.x) || 0)), y: Math.min(1000, Math.max(0, Number(o.y) || 0)) } : undefined);
  const qs: QgQuestion[] = res.map((q) => {
    const g = got.get(q.n);
    const at = pt(g?.at);
    const byI = new Map((g?.steps ?? []).map((s: any) => [Number(s.i), s]));
    return {
      n: q.n, max: q.max, score: q.score, answered: q.steps.length > 0, sure: !q.review, reason: arOnly(cleanNote(String(q.note ?? q.reason ?? ""))), method: q.method ?? 1,
      steps: q.steps.map((st, i) => { const a = pt(byI.get(i + 1)); return { text: String(st.expected ?? ""), points: st.possible, awarded: st.awarded, note: arOnly(cleanNote(String(st.reason_ar || st.reason || ""))).slice(0, 200), ...(a ? { at: a } : {}) }; }),
      ...(at ? { at } : {}),
    };
  });
  await kvSet(muKey(itemId), JSON.stringify({ qs, pages }));
  return { qs, pages };
}
/** دكة: ورقتين بكل دقيقة */
async function muMarksTick() {
  const q = await readJson<number[]>(MU_Q, []);
  const ids = (Array.isArray(q) ? q : []).slice(0, 2);
  for (const id of ids) {
    try { await muMarksFor(id); } catch (e) { console.error("mu marks", id, e); }
    const now = await readJson<number[]>(MU_Q, []);
    await kvSet(MU_Q, JSON.stringify((Array.isArray(now) ? now : []).filter((x) => x !== id)));
  }
  return ids.length;
}

/** ورقة تجربة تنتظر «تصحيح قصي»: طالب تجربة، محجوزة إله، ما مصححة، وما تجربت 3 مرات */
async function testPaperFor(it: Row) {
  if (it.user_id >= 0 || it.grader_id !== QUSAY_GRADER || it.graded_at || !it.version_id) return false;
  return await tries(it.id) < MAX_TRIES && !await qgResultOf(it.id) && !await versionWhyNot(it.version_id);
}
/** دكة المؤقت (كل دقيقة): يصحح أوراق مواضيعه، ويكمل التجربة، ويستلم الدفعات اللي رجعت */
export async function qusayTick(finish: (uid: number, itemId: number) => Promise<unknown>) {
  // 🖋 خط الأستاذ من الأوراق اللي صححها بإيده: يمشي حتى لو تصحيح قصي طافي (رخيص، Haiku)
  if (keyReady()) { const { harvestTick } = await import("./inkHarvest.ts"); await harvestTick(qgCreate, await modelId()).catch((e) => console.error("harvest", e)); }
  // 🖍 تصحيح مؤمل على الورقة: يمشي حتى لو تصحيح قصي طافي
  if (keyReady()) await muMarksTick().catch((e) => console.error("mu marks", e));
  // ⏸ أوراق تنتظر خطه: تذكير كل 3 ساعات (حتى لو تصحيح قصي طافي)
  await waitReminders().catch((e) => console.error("ink wait", e));
  if (!await qgOn()) return { off: true };
  if (!keyReady()) return { noKey: true };
  const s = await qgSettings();
  const received = (await batches()).length ? await pollBatches(finish, s.effort, s.marks, s.style) : 0;
  if (await overCap(s)) return { cap: true, ...(received ? { received } : {}) };
  const marked = await runMarksDemos(s);
  await compareTick(s);
  const jobs: Job[] = [];
  const take = await liveTaker();
  for (const it of await find("sched_items", { status: "done" }, { order: ["id"] })) {
    if (jobs.length >= LIVE_PER_TICK) break;
    // ورقة طالب تجربة رفعها صاحب البوت وختار «🧠 تصحيح قصي»: محجوزة إله من الرفع، ويصححها طبيعي مثل الحقيقية (أي موضوع)
    if (await testPaperFor(it)) { jobs.push({ it, kind: "live" }); continue; }
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
  if (!jobs.length) return { idle: true, ...(received ? { received } : {}), ...(marked ? { marked } : {}) };
  const ready = await prepare(jobs, s.effort, failed, s.marks, s.style);
  // اللي اختارهن «⚡ هسه» يتصححن هسه، والباقي حسب الإعداد
  const fast = new Set(await nowList());
  const later = s.batch ? ready.filter((p) => !fast.has(p.job.it.id)) : [];
  const nowJobs = ready.filter((p) => !later.includes(p));
  if (fast.size) { const done = new Set(jobs.map((j) => j.it.id as number)); await kvSet(NOW, JSON.stringify([...fast].filter((id) => !done.has(id)))); }
  let batched = 0;
  if (later.length) {
    try {
      const id = await apiImpl.batchCreate(later.map((p) => ({ custom_id: `qg_${p.job.it.id}`, params: p.req })));
      await kvSet(BATCHES, JSON.stringify([...await batches(), { id, at: Date.now(), jobs: later.map((p) => ({ item: p.job.it.id as number, kind: p.job.kind })) }]));
      batched = later.length;
    } catch (e) { for (const p of later) await failed(p.job, e); if (!nowJobs.length) return { failed: later.length }; }
  }
  if (!nowJobs.length) return { batched, ...(received ? { received } : {}) };
  let graded = 0, bad = 0;
  await Promise.all(nowJobs.map(async (p) => {
    try { await settle(p, await apiImpl.create(p.req), false, finish); graded++; } catch (e) { bad++; await failed(p.job, e); }
  }));
  return { graded, ...(batched ? { batched } : {}), ...(bad ? { failed: bad } : {}), ...(received ? { received } : {}) };
}

/** الورقة رجعت للمصححين لأن ما متأكد، أو خربت: يعيد يجربها */
export async function qgRetry(id: number) {
  const r = await qgResultOf(id);
  if (r?.sent) throw new Error("هاي الورقة صححها وانطى درجتها");
  await kvSet(resKey(id), "null");
  await kvSet(tryKey(id), "0");
  // ورقة طالب التجربة: ترجع محجوزة إله حتى يعيدها هو، مو تبقى عند المصححين
  const it = await one("sched_items", { id });
  if (it && it.user_id < 0 && !it.graded_at && !it.grader_id) await update("sched_items", { id }, { grader_id: QUSAY_GRADER });
}

// ---------- 🖍 تجربة العلامات على الورقة (طلب الأستاذ 2026-11-21): يعيد تصحيح ورقة صححها «تصحيح قصي» بالعلامات الحمرة،
// ⚡ هسه، وينحفظ لحاله: درجة الورقة الأصلية ما تتغير، ولا شي يوصل للطالب الحقيقي (طالب التجربة يشوفها بورقته)
export const qgMarksOf = (id: number) => readJson<QgMarksDemo | null>(mkKey(id), null);
const marksQueue = async () => { const l = await readJson<number[]>(MK_Q, []); return Array.isArray(l) ? l.map(Number) : []; };
export const marksWaiting = async (id: number) => (await marksQueue()).includes(id);
export async function queueMarks(id: number) {
  const it = await one("sched_items", { id });
  if (!it?.version_id) throw new Error("ماكو هيچ ورقة");
  if (!await qgResultOf(id)) throw new Error("«تصحيح قصي» بعده ما صحح هاي الورقة");
  if (!(await find("exam_answers", { item_id: id })).length) throw new Error("ماكو صور جواب بالورقة");
  await kvSet(MK_Q, JSON.stringify([...new Set([...await marksQueue(), id])]));
}
async function runMarksDemos(s: QgSettings) {
  const ids = (await marksQueue()).slice(0, 3);
  if (!ids.length) return 0;
  await kvSet(MK_Q, JSON.stringify((await marksQueue()).filter((x) => !ids.includes(x))));
  let n = 0;
  for (const id of ids) {
    const it = await one("sched_items", { id });
    if (!it) continue;
    const fail = async (_j: Job, e: unknown) => { const usd = await chargeFailed(priced(e, false)); await addLog({ at: stamp(), kind: "failed", item: id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), usd, note: `🖍 العلامات: ${errText(e)}` }); };
    const [p] = await prepare([{ it, kind: "trial" }], s.effort, fail, true, s.style);
    if (!p) continue;
    try {
      const { qs, tokens } = readAnswer(await apiImpl.create(p.req), p.mat, p.unanswered, p.answerOnly, p.pages.length);
      const usd = usdOf(tokens, false);
      await addSpend("qusay", usd);
      const total = qs.reduce((t, q) => t + q.score, 0);
      await kvSet(mkKey(id), JSON.stringify({ at: stamp(), total, qs, pages: p.pages, usd } satisfies QgMarksDemo));
      const placed = qs.reduce((t, q) => t + q.steps.filter((s) => s.at).length, 0), all = qs.reduce((t, q) => t + q.steps.length, 0);
      await addLog({ at: stamp(), kind: "trial", item: id, name: await nameOfRow(it), exam: await examTitle(it.exam_id), total, usd, note: `🖍 تجربة العلامات على الورقة: ${placed} من ${all} خطوة انرسمت. شوفها من 👁` });
      n++;
    } catch (e) { await fail({ it, kind: "trial" }, e); }
  }
  return n;
}
