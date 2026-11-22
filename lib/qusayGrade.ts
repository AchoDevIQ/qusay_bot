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
/** live: المواضيع اللي يصححها صدگ. batch: بالدفعة (أرخص بالنص، والدرجة تتأخر، وهي الأصل من 2026-11-21).
 *  cap: أكثر شي يصرف باليوم بالدولار. carry: الزايد عن الحد يتأجل لباچر وما يروح للمصححين (الأصل).
 *  unsure: الورقة اللي يشك بيها: «send» يصححها ويبعث درجتها ويكتب السبب بالسجل (الأصل، طلب الأستاذ 2026-11-21)، «graders» ترجع للمصححين */
export type QgSettings = { live: number[]; effort: QgEffort; batch: boolean; cap: number; carry: boolean; unsure: "send" | "graders"; marks: boolean; style: string };
/** مكان على صور جواب الطالب: p رقم الصورة (من 1)، x من اليسار و y من فوك، من 0 لـ 1000 من عرضها وطولها */
export type QgPt = { p: number; x: number; y: number };
/** at: وين مكتوبة الخطوة على ورقة الطالب، حتى تنرسم عليها ✓ أو ✗ حمرة مثل قلم المدرس (بس إذا «🖍 العلامات» شغالة) */
/** hw: رقم عبارة من «✍️ خط إيدي» تقول نفس الملاحظة، فتنرسم بخط الأستاذ نفسه بدل الخط */
export type QgStep = { text: string; points: number; awarded: number; note: string; at?: QgPt; hw?: number };
export type QgQuestion = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: QgStep[]; at?: QgPt; hw?: number };
export type QgTokens = { in: number; cw: number; cr: number; out: number };
/** نتيجة ورقة: trial تجربة مخفية على ورقة صححها مصحح (human درجته)، live ورقة صححها صدگ (لو رجعها للمصححين إذا ما متأكد) */
export type QgResult = { at: string; kind: "trial" | "live"; total: number; sure: boolean; qs: QgQuestion[]; usd: number; tokens: QgTokens; batch: boolean; human?: number | null; sent?: boolean; pages?: string[] };
/** «🖍 جرب العلامات»: تصحيح ثاني لورقة بالعلامات على الورقة، ينحفظ لحاله وما يغير درجتها ولا يوصل شي للطالب */
export type QgMarksDemo = { at: string; total: number; qs: QgQuestion[]; pages: string[]; usd: number };
/** شي كتبه الأستاذ بقلم الآيباد بصفحة «✍️ خط إيدي»: خطوطه (s: كل خط x,y,x,y...) بمربع w×h */
export type InkShape = { w: number; h: number; s: number[][] };
/** tick ✓، cross ✗، praise مدح (أحسنت، ممتاز…)، note ملاحظة (نسيت تعوض…). text: شنو مكتوب بيها */
export type InkKind = "tick" | "cross" | "praise" | "note";
export type InkItem = InkShape & { id: number; kind: InkKind; text: string };
/** علامة وحدة تنرسم على صورة الورقة: ✓ ✗ نص درجة، أو درجة السؤال بدائرة.
 *  sym: ✓ أو ✗ بخط الأستاذ، word: مدحه بخطه، hand: ملاحظته بخطه (إذا كاتبها بـ «✍️ خط إيدي») */
export type PaperMark = { x: number; y: number; kind: "ok" | "half" | "bad" | "score" | "good"; text: string; note?: string; sym?: InkShape; word?: InkShape; hand?: InkShape };
export type QgLog = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap"; item?: number; name?: string; exam?: string; total?: number; usd?: number; note?: string };

const SET = "qg_settings", ON = "qg_on", LOG = "qg_log", TRIAL = "qg_trial", BATCHES = "qg_batches", NOW = "qg_now", MK_Q = "qg_mk_q";
const resKey = (id: number) => `qg_res_${id}`;
const mkKey = (id: number) => `qg_mk_${id}`;
const tryKey = (id: number) => `qg_try_${id}`;
const capNoteKey = (day: string) => `qg_cap_note_${day}`;
export const DEFAULT_CAP = 2;
/** أطول «✍️ طريقتك بالكتابة» */
export const STYLE_MAX = 3000;
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
  const s = await readJson<Partial<QgSettings> & { v?: number }>(SET, {});
  const cap = Number(s.cap);
  // الإعدادات القديمة (قبل v 2) كانت «هسه» بالأصل: تصير بالدفعة، طلب الأستاذ 2026-11-21
  const v2 = Number(s.v) >= 2;
  return { live: Array.isArray(s.live) ? s.live.map(Number).filter(Number.isInteger) : [], effort: s.effort === "low" ? "low" : "medium", batch: v2 ? !!s.batch : true, cap: cap > 0 ? Math.min(cap, 100) : DEFAULT_CAP, carry: v2 && s.carry !== undefined ? !!s.carry : true, unsure: s.unsure === "graders" ? "graders" : "send", marks: s.marks === true, style: typeof s.style === "string" ? s.style.slice(0, STYLE_MAX) : "" };
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
- Follow-through: when a step is done correctly but uses a wrong value carried from the student's own earlier mistake, award half of that step's points.
- Ignore crossed-out work. Do not reward work that is only copied from the question.
- Never award more than a step's points, never more than the question's maximum.
- If a question has no answer anywhere in the student's pages, set answered=false and score 0.

DRAWINGS (graphs of functions, parabola / ellipse / hyperbola sketches, the figure of a word problem): a step that asks for a drawing is graded by looking at the student's drawing itself, compared with the teacher's drawing in the model solution (when given) and with the values found in the earlier steps. Check the main features: the axes; the special points the curve must pass through (intercepts, critical / turning points, inflection points, table points, vertices, foci, centre) placed at about the right places; the asymptotes; and the right shape (where it rises and falls, concave up or down, symmetry, which way it opens). Hand drawings are rough: never take points for neatness or exact scale. Full drawing points when the main features are right, part of them when only some are right, 0 when there is no drawing or it does not match. A drawing step is never earned by written work alone: no drawing means 0 for that step. If you cannot see the drawing clearly in the photo, set sure=false.

Set sure=false for a question when you cannot read the handwriting, part of the answer is cut off or missing from the photo, the work matches no method and you cannot judge it, or you hesitate between two marks. Being unsure is fine: a human grader will then check the paper. Do not guess.

Write "reason" and each step "note" in short, simple Arabic (Iraqi style), for the teacher and the student: what the student did right or wrong. Keep them brief.
Write every piece of math inside the Arabic text as LaTeX between $ signs, the way an Iraqi math book prints it: fractions as $\\frac{a}{b}$ (never a/b), pi as $\\pi$ (never the word pi), roots as $\\sqrt{x}$, powers as $x^{2}$. Example: "عوّض $x=\\frac{\\pi}{2}$ صح".`;

/** «🖍 العلامات على الورقة»: نفس التصحيح، ويا مكان كل خطوة على صور الطالب حتى نرسم عليها مثل قلم المدرس الأحمر */
const MARKS_TEXT = `

READING THE HANDWRITING: read every number and symbol carefully; zoom in mentally on unclear digits. Similar digits (3 and 8, 1 and 7, 4 and 9, 0 and 6, 5 and 6) are easy to confuse. When a digit is unclear, decide it from the student's own work around it: the line before and the line after, and what the student does with that value next. If the student's next steps use a value consistently, that is what they wrote. Never take points off for a value you only misread; if you truly cannot tell, keep the student's benefit and set sure=false.

TEACHER'S VOICE: the student must feel that his teacher Qusay marked the paper by hand. Write every "note" and "reason" the way an Iraqi math teacher writes a quick comment in red pen on a paper: very short (a few words, at most one short sentence), spoken Iraqi Arabic, talking to the student ("عندك", "سويت", "المفروض"). Say what is wrong and what it should be, e.g. "المفروض $\\frac{23\\pi}{12}$" or "الإشارة غلط" or "نسيت تعوض". Leave a correct step's note empty. Never use formal words like "الصواب" or "الإجابة الصحيحة هي", never describe yourself, never mention a model, an AI, a system, a marking scheme or "steps", and never explain how you graded.

PEN MARKS: the student's images are numbered [Image 1], [Image 2], ... The teacher draws a red tick or cross beside each step on the student's own image, so also give boxes, measured on each image from 0 to 1000 (x from the left edge, y from the top edge; x1,y1 = top-left corner, x2,y2 = bottom-right corner):
- "papers": for every image, p = the image number and the box of the sheet of paper itself. Photos often show a table, a hand, a screen or a dark border around the paper: the box is the white sheet only.
- The teacher marks only what lost points. So give a box ONLY for a step that did not get its full points: p = the image number where that step is written, and a TIGHT box around exactly the handwriting of that step (usually one line). Do not include neighbouring lines.
- A step that got its full points: p=0 and a box of zeros. Exception: when the WHOLE question got full marks, give the box of its LAST written step only (the teacher writes "well done" there).
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
// ---------- «✍️ خط إيدي»: الأستاذ يكتب بقلم الآيباد ✓ و✗ والمدح والملاحظات، وتنرسم على ورقة الطالب بخطه هو (طلبه 2026-11-21)
// عام لكل المواضيع، وخاص لكل موضوع (ينضاف فوك العام). ما يصرف فلوس: الرسم بالسيرفر، والملاحظات بس أسماؤها تروح للذكاء
const inkKey = (exam = 0) => (exam ? `qg_ink_ex_${exam}` : "qg_ink");
export const INK_KINDS: InkKind[] = ["tick", "cross", "praise", "note"];
export const INK_MAX = 80;
export const inkList = (exam = 0) => readJson<InkItem[]>(inkKey(exam), []);
/** كل خط إيده اللي ينفع لموضوع: العام والخاص */
export const inkFor = async (exam: number) => [...await inkList(), ...(exam ? await inkList(exam) : [])];
/** يفحص اللي إجا من الصفحة ويحفظه: خطوط بأرقام، بحدود المربع، ومو كبيرة */
export async function addInk(exam: number, raw: any): Promise<InkItem> {
  const kind = String(raw?.kind) as InkKind;
  if (!INK_KINDS.includes(kind)) throw new Error("اختار شنو تكتب");
  const text = kind === "tick" ? "✓" : kind === "cross" ? "✗" : String(raw?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) throw new Error("اكتب شنو مكتوب بالعبارة");
  const w = Math.round(Number(raw?.w)), h = Math.round(Number(raw?.h));
  if (!(w >= 100 && w <= 1500 && h >= 100 && h <= 1500)) throw new Error("مربع الكتابة غلط");
  const s: number[][] = [];
  let pts = 0;
  for (const st of Array.isArray(raw?.s) ? raw.s.slice(0, 150) : []) {
    if (!Array.isArray(st) || st.length < 2) continue;
    const a: number[] = [];
    for (let i = 0; i + 1 < st.length && i < 1600; i += 2) {
      const x = Number(st[i]), y = Number(st[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      a.push(Math.round(Math.min(w, Math.max(0, x))), Math.round(Math.min(h, Math.max(0, y))));
    }
    if (a.length) { s.push(a); pts += a.length; }
  }
  if (!s.length) throw new Error("ما كتبت شي");
  if (pts > 30000) throw new Error("الكتابة كبيرة هواية، امسح واكتبها أصغر");
  const list = await inkList(exam);
  if (list.length >= INK_MAX) throw new Error(`وصلت ${INK_MAX} عبارة، امسح وحدة أول`);
  const item: InkItem = { id: Math.max(Date.now(), ...list.map((x) => x.id + 1)), kind, text, w, h, s };
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

QUSAY'S WORDS FOR THIS TOPIC (use these words and phrases when they fit):
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
async function buildRequest(it: Row, mat: VMat, effort: QgEffort, marks = false, style = ""): Promise<{ req: Req; unanswered: Set<number>; pages: string[] }> {
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
  if (mat.pdf) head.push({ type: "text", text: mat.qs.some((q) => !q.rubric && !q.model.length) ? "\nTeacher's model solution PDF:" : "\nTeacher's model solution PDF (for the drawing steps: it shows what each correct drawing looks like; the points still follow the steps above):" }, block(mat.pdf, "PDF الحل"));
  // نقطة الكاش: كل اللي فوك نفسه لكل أوراق النموذج
  const last = head[head.length - 1] as Anthropic.TextBlockParam;
  last.cache_control = { type: "ephemeral" };

  const body: Anthropic.ContentBlockParam[] = [{ type: "text", text: "STUDENT'S ANSWER PAGES:" }];
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
    model: MODEL, max_tokens: 32000,
    system: [{ type: "text", text: SYSTEM + (marks ? MARKS_TEXT + styleText(style) + topicText(await examStyle(Number(it.exam_id))) + handText(await inkFor(Number(it.exam_id))) : ""), cache_control: { type: "ephemeral" } }],
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
/** علامات الورقة اللي تنرسم لكل صورة: ✓ للخطوة الصح، ✗ للغلط، ونص الدرجة للناقصة، ودرجة السؤال بدائرة.
 *  only: سؤال واحد. extra: صور السؤال حتى لو ماكو عليها علامة (تطلع بدون رسم) */
export function marksByPage(qs: QgQuestion[], pages: string[], only?: number, extra: string[] = [], ink: InkItem[] = []): { ref: string; marks: PaperMark[] }[] {
  const by = new Map<number, PaperMark[]>();
  // العلامة كلها جوة الصورة، ما تطلع برة الورقة ولا على حافتها (طلب الأستاذ 2026-11-21)
  const inside = (v: number, lo: number) => Math.min(1000 - lo, Math.max(lo, v));
  // خط إيد الأستاذ: كل علامة تاخذ وحدة من اللي كاتبها (نفس العلامة نفس الشكل كل مرة، والعلامات تختلف عن بعض)
  const shape = (x: InkItem): InkShape => ({ w: x.w, h: x.h, s: x.s });
  const pool = (k: InkKind) => ink.filter((x) => x.kind === k);
  const pick = (l: InkItem[], seed: number) => (l.length ? shape(l[seed % l.length]) : undefined);
  const handOf = (id?: number) => { const x = id ? ink.find((i) => i.id === id && i.kind === "note") : undefined; return x ? shape(x) : undefined; };
  const add = (pt: QgPt | undefined, m: Omit<PaperMark, "x" | "y">) => {
    if (!pt) return;
    const x = inside(pt.x, 50), y = inside(pt.y, 35), seed = Math.round(x * 7 + y * 13);
    const sym = pick(pool(m.kind === "bad" ? "cross" : "tick"), seed);
    const word = m.kind === "good" ? pick(pool("praise"), seed) : undefined;
    by.set(pt.p, [...(by.get(pt.p) ?? []), { x, y, ...m, ...(sym ? { sym } : {}), ...(word ? { word } : {}) }]);
  };
  for (const q of qs) {
    if (only !== undefined && q.n !== only) continue;
    if (!q.answered) continue;
    // درجة السؤال ما تنكتب على الورقة: مكتوبة بزر السؤال فوك. والصح ما ينرسم: بس الغلط والناقص،
    // والسؤال الصح كله ✓ وحدة و«أحسنت» بآخره، حتى يحس انصححت (طلب الأستاذ 2026-11-21)
    const full = (s: QgStep) => s.awarded >= s.points && s.points > 0;
    if (q.steps.length ? q.steps.every(full) : q.score >= q.max) {
      add(q.at ?? [...q.steps].reverse().find((s) => s.at)?.at, { kind: "good", text: "أحسنت" });
      continue;
    }
    let drawn = 0;
    const unplaced: QgStep[] = [];
    for (const s of q.steps) {
      if (full(s)) continue;
      const kind = s.awarded > 0 ? "half" : "bad";
      const hand = handOf(s.hw);
      if (s.at) { add(s.at, { kind, text: kind === "half" ? String(s.awarded) : "", ...(s.note ? { note: shortNote(s.note) } : {}), ...(hand ? { hand } : {}) }); drawn++; }
      else if (s.note) unplaced.push(s);
    }
    // الخطوات اللي ما كتبها الطالب (ما إلها مكان): ✗ وملاحظتها بآخر جوابه، مثل «ناقص» المدرس. وإذا ماكو ولا علامة، سبب السؤال
    if (unplaced.length || !drawn) {
      const note = unplaced.length ? unplaced.map((s) => s.note).join("، ") : q.reason;
      // ملاحظة وحدة مكتوبة بخطه تنرسم بخطه، وأكثر من وحدة تنكتب بالخط
      const hand = unplaced.length === 1 ? handOf(unplaced[0].hw) : unplaced.length ? undefined : handOf(q.hw);
      add(q.at, { kind: "bad", text: "", ...(note ? { note: shortNote(note) } : {}), ...(hand ? { hand } : {}) });
    }
  }
  const out: { ref: string; marks: PaperMark[] }[] = [];
  pages.forEach((ref, i) => { const m = by.get(i + 1); if (m || extra.includes(ref)) out.push({ ref, marks: m ?? [] }); });
  for (const ref of extra) if (!pages.includes(ref)) out.push({ ref, marks: [] });
  return out;
}

const half = (x: number) => Math.round(x * 2) / 2;
/** يقرا جواب الذكاء ويرتبه: الدرجة من الخطوات (مو من رقمه)، وما تعدي حدها */
/** الذكاء جاوب بس جوابه ما ينفع: الطلب انحسب فلوسه، فلازم تنحسب بالصرفية */
export class PaidError extends Error { usd = 0; tokens: QgTokens; constructor(m: string, tokens: QgTokens) { super(m); this.tokens = tokens; } }
const priced = (e: unknown, batch: boolean) => { if (e instanceof PaidError) e.usd = usdOf(e.tokens, batch); return e; };
/** صرفية طلب خرب بس انحسب: تنضاف للصرفية وترجع حتى تنكتب بالسجل */
async function chargeFailed(e: unknown) { if (e instanceof PaidError && e.usd > 0) { await addSpend("qusay", e.usd); return e.usd; } return undefined; }
export function readAnswer(msg: Anthropic.Message, mat: VMat, unanswered: Set<number>, answerOnly: boolean, pages = 0): { qs: QgQuestion[]; tokens: QgTokens } {
  const u = msg.usage;
  const tokens = { in: u.input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0 };
  if (msg.stop_reason === "refusal") throw new PaidError("الذكاء رفض يصحح الورقة", tokens);
  if (msg.stop_reason === "max_tokens") throw new PaidError("جواب الذكاء طويل وانگطع", tokens);
  let j: { questions?: any[] } = {};
  try { j = JSON.parse(msg.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { throw new PaidError("جواب الذكاء مو مفهوم", tokens); }
  const got = new Map((Array.isArray(j.questions) ? j.questions : []).map((q) => [Number(q?.n), q]));
  const papers = papersOf(j);
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
      const at = ptOf(s, pages, papers);
      const hw = Math.round(Number(s?.hw) || 0);
      return { text: p.text, points: p.points, awarded: Math.min(p.points, Math.max(0, half(Number(s?.awarded) || 0))), note: String(s?.note ?? "").slice(0, 300), ...(at ? { at } : {}), ...(hw > 0 ? { hw } : {}) };
    }) : [];
    let score = plan ? steps.reduce((t, s) => t + s.awarded, 0) : Number(a.score) || 0;
    score = answered ? Math.min(m.max, Math.max(0, half(score))) : 0;
    const at = ptOf(a, pages, papers, true);
    const hw = Math.round(Number(a.hw) || 0);
    return { n: m.n, max: m.max, score, answered, sure: a.sure !== false, reason: String(a.reason ?? "").slice(0, 500), method: plan ? method : 1, steps, ...(at ? { at } : {}), ...(hw > 0 ? { hw } : {}) };
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
export async function trialCandidates(examId: number, fresh = false): Promise<Row[]> {
  const queued = new Set(await trialQueue());
  const out: Row[] = [];
  const when = (it: Row) => String((fresh ? it.submitted_at : it.graded_at) ?? "");
  for (const it of (await find("sched_items", { exam_id: examId, status: "done" })).sort((a, b) => when(b).localeCompare(when(a)))) {
    if (!it.version_id || queued.has(it.id) || it.grader_id === QUSAY_GRADER) continue;
    if (fresh ? !!it.graded_at : !it.graded_at || !it.grader_id || it.grader_id === AI_GRADER) continue;
    if (await qgResultOf(it.id)) continue;
    out.push(it);
  }
  return out;
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

/** ورقة تجربة تنتظر «تصحيح قصي»: طالب تجربة، محجوزة إله، ما مصححة، وما تجربت 3 مرات */
async function testPaperFor(it: Row) {
  if (it.user_id >= 0 || it.grader_id !== QUSAY_GRADER || it.graded_at || !it.version_id) return false;
  return await tries(it.id) < MAX_TRIES && !await qgResultOf(it.id) && !await versionWhyNot(it.version_id);
}
/** دكة المؤقت (كل دقيقة): يصحح أوراق مواضيعه، ويكمل التجربة، ويستلم الدفعات اللي رجعت */
export async function qusayTick(finish: (uid: number, itemId: number) => Promise<unknown>) {
  if (!await qgOn()) return { off: true };
  if (!keyReady()) return { noKey: true };
  const s = await qgSettings();
  const received = (await batches()).length ? await pollBatches(finish, s.effort, s.marks, s.style) : 0;
  if (await overCap(s)) return { cap: true, ...(received ? { received } : {}) };
  const marked = await runMarksDemos(s);
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
