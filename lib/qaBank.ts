// الأسئلة العلمية من ملازم الأستاذ (Word): الطالب يختار الفصل والموضوع والمحاضرة ويسأل.
// ١. يدور بالمحاضرة اللي اختارها. ٢. إذا ما لگاه، يدور بالموضوع بس (مو بالفصل كله). ٣. إذا ما لگاه، نظام الذكاء يحله على طريقة الأستاذ.
// الجواب يوصل للطالب كتابة (صفحة بيها الرياضيات مكتوبة مثل الكتاب)، مو صورة من الملزمة، حتى يبقى رخيص
import { createHash, randomUUID } from "node:crypto";
import { AI_SOURCES, fixKey, fixedFor, indexAnswer, lessonsCtx } from "./qaReview.ts";
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { files } from "./files.ts";
import { aiLinked, isImage, readRef, rubricOf, solutionPdf, svc } from "./aiGrade.ts";
import { docxLines } from "./docxText.ts";
import { verifyHomeToken } from "./webAuth.ts";
import { isAdmin } from "./data.ts";
import { authed, need } from "./webApi.ts";
import { myBooks } from "./notes.ts";
import { marksFor } from "./noteMarks.ts";
import { bookFind, bookRows, rasidFind, rasidIndex, topicPages, type BookHit, type RasidHit } from "./rasidQa.ts";
import { bookToc } from "./noteToc.ts";
import { lectureNo } from "./noteSpot.ts";
import { addSpend } from "./aiSpend.ts";

export type QaKind = "main" | "extra" | "exams";
export const QA_KIND: Record<QaKind, string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };
type Lecture = { topic: string; lecture: number; text: string };
/** tid: موضوع البوت اللي ينربط بيه موضوع الملزمة (الأسماء تختلف: «ديموافر» = «الصيغة القطبية وديموافر»). null يعني ما ينربط */
export type QaBook = { id: string; chapter: number; lang: "ar" | "en"; kind: QaKind; name: string; topics: { topic: string; lectures: number[]; tid?: number | null }[]; chars: number; created: string };
/** free: من fromBook، اللي انطى حل الملزمة نفسه بلا ذكاء (نفس السؤال بالضبط)
 *  stepBtn: زر «🤔 ما فهمت خطوة» بصفحة الحل (طافي من البداية). teacherBtn: زر «❓ بعدني ما فهمت» يوصل السؤال للأستاذ (شغال من البداية)
 *  explained: كم خطوة انشرحت */
/** model: الذكاء اللي يحل (⚡ haiku الأصل، 🎯 sonnet، 🏆 opus). الحل صار بجهتنا مو بخدمة مؤمل (2026-11-23) */
export type QaCfg = { on: boolean; direct: boolean; asked: number; fromBook: number; solved: number; cached?: number; free?: number; inTok: number; outTok: number; stepBtn?: boolean; teacherBtn?: boolean; explained?: number; model?: "haiku" | "sonnet" | "opus"; delayH?: number };
const BOOKS = "qa_books", CFG = "qa_cfg";
const DEF: QaCfg = { on: false, direct: true, asked: 0, fromBook: 0, solved: 0, inTok: 0, outTok: 0 };
// Haiku 5.5: 0.10$ داخل و0.50$ طالع لكل مليون توكن
const PRICE_IN = 0.1, PRICE_OUT = 0.5;
const LECTURE_MAX = 80_000, TOPIC_MAX = 200_000;

const readJson = async <T>(k: string, def: T): Promise<T> => { try { return { ...def, ...JSON.parse((await kvGet(k)) ?? "null") } as T; } catch { return def; } };
export const qaCfg = () => readJson<QaCfg>(CFG, DEF);
const saveCfg = (c: QaCfg) => kvSet(CFG, JSON.stringify(c));
export async function qaBooks(): Promise<QaBook[]> { try { const j = JSON.parse((await kvGet(BOOKS)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } }
const saveBooks = (l: QaBook[]) => kvSet(BOOKS, JSON.stringify(l));

/** الملزمة تتقسم على عناوين «اسم الموضوع المحاضرة 3» (أو «... Lecture 3» بالإنگليزي) */
/** عنوان محاضرة بأي شكل كتبه الأستاذ: «رسم الدوال المحاضرة 1»، «الاساسيات (1) lecturer»، «Lecture 3 الربط»،
 *  «De Movier’s [ lecturer 2]»، «فصل المتغيرات المحاضره 1 الثنائية (اثرائيات)». سطر قصير بيه كلمة المحاضرة ورقم واحد */
const LEC_WORD = /(المحاضر[ةه]|lecturer|lecture)/i;
export function lectureHead(raw: string): { topic: string; lecture: number } | null {
  const l = raw.replace(/\s+/g, " ").trim();
  if (l.length > 110 || !LEC_WORD.test(l) || /[=→⇒]/.test(l)) return null;
  const plain = l.replace(/\$\\omega\$/g, "ω").replace(/\^\{,\}/g, "'");
  if (/\$/.test(plain)) return null;
  // الفصل الثالث عربي: «المحاضرة الأولى : المعدلات الزمنية» (رقمها بالكلمة والموضوع بعد النقطتين)
  const ord = plain.match(/^المحاضر[ةه]\s+([؀-ۿ]+)\s*[:：]\s*(.+)$/);
  if (ord) {
    const n = lectureNo(ord[1]), topic = ord[2].replace(/\s+/g, " ").trim();
    return n >= 1 && n <= 60 && topic.length >= 2 && topic.length <= 70 && !/\d/.test(topic) ? { topic, lecture: n } : null;
  }
  const nums = plain.match(/\d{1,3}/g);
  if (!nums || nums.length !== 1 || Number(nums[0]) < 1 || Number(nums[0]) > 60) return null;
  const topic = plain.replace(LEC_WORD, " ").replace(/\d{1,3}/, " ")
    .replace(/الثنائي[ةه]/g, " ").replace(/\(?\s*(اثرائيات|وزاريات)\s*\)?/g, " ").replace(/واجبات/g, " ")
    .replace(/[()[\]{}:：\-–—]/g, " ").replace(/\s+/g, " ").replace(/^[\s&,.]+|[\s&,.]+$/g, "").trim();
  if (topic.length < 2 || topic.length > 70 || topic.split(" ").length > 9) return null;
  return { topic, lecture: Number(nums[0]) };
}
export function splitLectures(lines: string[]): Lecture[] {
  const out: Lecture[] = [];
  let cur: Lecture | null = null;
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ").trim();
    const h = lectureHead(l);
    if (h) {
      const { topic, lecture } = h;
      cur = out.find((x) => x.topic === topic && x.lecture === lecture) ?? null;
      if (!cur) { cur = { topic, lecture, text: "" }; out.push(cur); }
      continue;
    }
    if (cur) cur.text += (cur.text ? "\n" : "") + l;
  }
  return out.filter((x) => x.text.trim());
}

/** اسم الموضوع للمقارنة: بدون تشكيل وهمزات وتاء مربوطة و«ال»، حتى «القطع الناقص والزائد» = «قطع ناقص و زائد» */
export function norm(s: string) {
  return s.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/گ/g, "ك").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/&/g, " و ")
    .toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/^(و|ال|وال)(?=\S{3,})/, "")).filter((w) => w && w !== "و" && !/^\d+$/.test(w));
}
/** هل موضوع الملزمة هو نفس الموضوع اللي اختاره الطالب */
export function sameTopic(picked: string, book: string) {
  const a = norm(picked), b = new Set(norm(book));
  if (!a.length || !b.size) return false;
  const hit = a.filter((w) => b.has(w)).length;
  return hit / a.length >= 0.6 && hit / b.size >= 0.5;
}

// ---------- ربط مواضيع الملزمة بمواضيع البوت
const STOP = new Set(["of", "the", "and", "a", "an", "on", "in", "to", "ما", "على", "في", "من", "لو", "او"]);
// كلمات الأستاذ اللي تختلف عن أسماء البوت
const SYN: Record<string, string[]> = { movier: ["moivre"], ارجاند: ["اركاند"], دائريه: ["ساين", "كوساين"], trigonometric: ["sine", "cosine"], graph: ["sketching", "curve"] };
const words = (s: string) => norm(s).map((w) => w.replace(/^ال/, "")).filter((w) => w && !STOP.has(w));
const like = (a: string, b: string) => {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 3) return false;
  let k = 0;
  while (k < m && a[k] === b[k]) k++;
  return k >= Math.max(3, Math.ceil(0.75 * m));
};
/** كم كلمة من اسم موضوع البوت موجودة باسم موضوع الملزمة، ونسبتها */
export function topicScore(book: string, bot: string): [number, number] {
  const bw = words(book).flatMap((w) => [w, ...(SYN[w] ?? [])]);
  const tw = words(bot);
  const hits = tw.filter((t) => bw.some((b) => like(b, t))).length;
  return [hits, tw.length ? hits / tw.length : 0];
}
/** أقرب موضوع بالبوت (بالعربي أو الإنگليزي) لاسم موضوع الملزمة، من نفس الفصل. null إذا ولا كلمة تشبه */
export function bestTopic(book: string, cands: { id: number; ar: string; en: string }[]): number | null {
  let best: { id: number; s: [number, number] } | null = null;
  for (const c of cands) {
    for (const name of [c.ar, c.en]) {
      const s = topicScore(book, name ?? "");
      if (s[0] && (!best || s[0] > best.s[0] || (s[0] === best.s[0] && s[1] > best.s[1]))) best = { id: c.id, s };
    }
  }
  return best?.id ?? null;
}
/** مواضيع البوت بفصل رقمه n (رقم الفصل = ترتيبه) */
export async function chapterTopics(n: number) {
  const ch = new Set((await find("chapters")).filter((c) => Number(c.ord) === n).map((c) => Number(c.id)));
  return (await find("topics")).filter((t) => ch.has(Number(t.chapter_id))).map((t) => ({ id: Number(t.id), ar: String(t.ar ?? ""), en: String(t.en ?? "") }));
}

const cache = new Map<string, Lecture[]>();
async function lecturesOf(b: QaBook): Promise<Lecture[]> {
  if (cache.has(b.id)) return cache.get(b.id)!;
  const raw = await files().read(`qa/${b.id}.json`);
  const list: Lecture[] = raw ? JSON.parse(raw.toString("utf8")) : [];
  cache.set(b.id, list);
  return list;
}

/** فيه ملازم لهذا الفصل، أو أسئلة امتحانات انقرت؟ (والذكاء مربوط) */
export async function qaReady(chapter: number) {
  if (!qaAiOn() || !(await qaCfg()).on) return false;
  if ((await qaBooks()).some((b) => b.chapter === chapter)) return true;
  // الراصد أو دفتر المحاضرات بملازمي
  if ((await find("note_books")).some((b) => chapterNum(b.chapter) === chapter)) return true;
  return (await examState()).done > 0;
}
/** رقم الفصل من اسمه بالملازم («الفصل الثالث» = 3) */
export const chapterNum = (label: unknown) => ORD.findIndex((w) => norm(String(label ?? "")).join(" ").includes(norm(w)[0])) + 1;
/** «📝 الراصد» مال فصل الطالب بملازمي: بس إذا الطالب مشترك بالفصل (محاضرات أو امتحانات) */
async function rasidsOf(uid: number | undefined, chapter: number) {
  if (!uid) return [];
  return (await myBooks(uid)).filter((b) => chapterNum(b.chapter) === chapter);
}

// ---------- أسئلة الامتحانات وحلولها: تنقرا مرة وحدة كتابة، وتنحفظ ويا موضوعها، والطالب يدور بيها ويا الملزمة
type ExamQa = { qid: number; exam: string; model: string; n: number; question: string; solution: string };
type ExamQueue = { q: number[]; tries: Record<string, number>; failed: string[]; done: number; total: number };
const EXAM_Q = "qa_exam_queue", EXAM_PER_TICK = 6, EXAM_TRIES = 2;
const examTopicKey = (tid: number) => `qa_exam_t_${tid}`;
const examDoneKey = (qid: number) => `qa_exam_done_${qid}`;
const readExamQ = () => readJson<ExamQueue>(EXAM_Q, { q: [], tries: {}, failed: [], done: 0, total: 0 });
export async function examState() {
  const s = await readExamQ();
  return { left: s.q.length, done: s.done, total: s.total, failed: s.failed };
}
export async function examQas(tid: number): Promise<ExamQa[]> {
  try { const j = JSON.parse((await kvGet(examTopicKey(tid))) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; }
}
/** رقم الفصل للامتحان: من رمزه (ch3) أو من اسم فصله */
const ORD = ["الاول", "الثاني", "الثالث", "الرابع", "الخامس"];
function examChapter(e: Row): number {
  const m = /(\d+)/.exec(String(e.slug ?? ""));
  if (m) return Number(m[1]);
  const i = ORD.findIndex((w) => norm(String(e.chapter ?? "")).join(" ").includes(norm(w)[0]));
  return i + 1;
}
/** موضوع البوت لكل امتحان (نفس الربط مال الملازم) */
async function examTopic(examId: number): Promise<number | null> {
  const e = await one("bank_exams", { id: examId });
  if (!e) return null;
  const n = examChapter(e);
  return n ? bestTopic(String(e.title ?? ""), await chapterTopics(n)) : null;
}
/** «📝 اقرا أسئلة الامتحانات»: كل سؤال إله صورة وبعده ما انقرا يدخل بالدور */
export async function queueExams() {
  const todo: number[] = [];
  for (const q of await find("bank_questions")) {
    if (!q.q_file || !isImage(String(q.q_file))) continue;
    if (await kvGet(examDoneKey(q.id))) continue;
    todo.push(Number(q.id));
  }
  const s = await readExamQ();
  const list = [...new Set([...s.q, ...todo])];
  await kvSet(EXAM_Q, JSON.stringify({ ...s, q: list, failed: [], total: s.done + list.length }));
  return list.length;
}
/** يقرا سؤال امتحان وحله كتابة. الحل من خطوات التصحيح المحفوظة إذا موجودة، وإلا من صورة الحل أو PDF النموذج */
async function readExamQuestion(qid: number): Promise<{ tid: number | null; row: ExamQa; usage: any[] }> {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const v = await one("bank_versions", { id: q.version_id });
  const e = v && await one("bank_exams", { id: v.exam_id });
  if (!v || !e) throw new Error("الامتحان غير موجود");
  const qImg = await readRef(String(q.q_file));
  if (!qImg) throw new Error("صورة السؤال مفقودة");
  const body: Row = { question_images: [qImg.toString("base64")] };
  const steps = await rubricOf(qid);
  if (steps) body.solution_text = steps.map((s) => s.text).join("\n").slice(0, 20_000);
  else {
    const sol = (await Promise.all((JSON.parse(q.a_files || "[]") as string[]).filter(isImage).map(readRef))).filter((b): b is Buffer => !!b);
    if (sol.length) body.solution_images = sol.map((b) => b.toString("base64"));
    else {
      const pdf = await solutionPdf(q.version_id);
      if (pdf) { body.pdf = pdf.toString("base64"); body.n = Number(q.n); }
    }
  }
  const r = await svc("/bot/extract", body, 180_000);
  const row: ExamQa = { qid, exam: String(e.title ?? ""), model: String(v.model ?? ""), n: Number(q.n), question: String(r.question ?? "").trim(), solution: String(r.solution ?? "").trim() };
  if (!row.question) throw new Error("ما انقرا السؤال");
  return { tid: await examTopic(Number(e.id)), row, usage: r.usage ?? [] };
}
/** دكة المؤقت: كم سؤال من الدور، ثلاثة بنفس الوقت. اللي يفشل مرتين يطلع من الدور وينكتب */
export async function examQueueTick(limit = EXAM_PER_TICK) {
  if (!aiLinked()) return { off: true };
  const s = await readExamQ();
  if (!s.q.length) return { left: 0 };
  const batch = s.q.slice(0, limit), queue = [...batch];
  const got: { tid: number | null; row: ExamQa; usage: any[] }[] = [];
  const bad: number[] = [];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try { got.push(await readExamQuestion(id)); } catch (e) { console.error("qa exam", id, e); bad.push(id); }
    }
  }));
  // الحفظ واحد واحد حتى ما يضيع سؤال من نفس الموضوع
  const cfg = await qaCfg();
  for (const g of got) {
    if (g.tid) {
      const list = (await examQas(g.tid)).filter((x) => x.qid !== g.row.qid);
      list.push(g.row);
      await kvSet(examTopicKey(g.tid), JSON.stringify(list));
    }
    await kvSet(examDoneKey(g.row.qid), g.tid ? String(g.tid) : "none");
    for (const u of g.usage) { cfg.inTok += Number(u.input) || 0; cfg.outTok += Number(u.output) || 0; }
  }
  await saveCfg(cfg);
  await addSpend("qa", usdOf(got.flatMap((g) => g.usage)));
  const now = await readExamQ();
  const tries = { ...now.tries }, failed = [...now.failed];
  const drop = new Set(got.map((g) => g.row.qid));
  for (const id of bad) {
    tries[id] = (tries[id] ?? 0) + 1;
    if (tries[id] >= EXAM_TRIES) {
      drop.add(id); delete tries[id];
      const q = await one("bank_questions", { id }), v = q && await one("bank_versions", { id: q.version_id }), e = v && await one("bank_exams", { id: v.exam_id });
      failed.push(q ? `${e?.title ?? ""} ${v?.model ?? ""} س${q.n}` : `سؤال ${id}`);
    }
  }
  const left = now.q.filter((id) => !drop.has(id) && !bad.includes(id)).concat(bad.filter((id) => !drop.has(id)));
  await kvSet(EXAM_Q, JSON.stringify({ q: left, tries, failed: failed.slice(-50), done: now.done + got.length, total: now.total }));
  return { done: got.length, failed: bad.length, left: left.length };
}

/** read: الكتابة قراية الصورة (ممكن بيها غلط)، والصورة هي الأصل */
export type QaAsk = { text?: string; image?: Buffer; read?: boolean };
/** rasid: الحل صفحة «📘 الحل النموذجي» من الراصد اللي بملازمي (book رقم الملزمة، page رقم الصفحة) */
/** notebook: الحل صفحات «دفتر المحاضرات» بملازمي من بداية السؤال (y مكانه بأول صفحة)، ويا زر فيديوهاته (mark) */
/** teacher: حل صلّحه الأستاذ لنفس السؤال قبل (🔎 حلول الذكاء)، يوصل ببلاش. asked: نص السؤال (بعد قراءة الصورة)، fk: بصمته */
export type QaResult = { source: "lecture" | "topic" | "ai" | "rasid" | "notebook" | "teacher"; solution: string; asked?: string; fk?: string; rasid?: { book: number } & RasidHit; notebook?: { book: number; where: string } & BookHit };
type Part = { kind: QaKind | "tests"; l: Lecture };
const joinCtx = (list: Part[], max: number) => {
  let s = "";
  for (const { kind, l } of list) {
    const part = kind === "tests" ? `### أسئلة الامتحانات — ${l.topic}\n${l.text}\n\n` : `### ${QA_KIND[kind]} — ${l.topic} المحاضرة ${l.lecture}\n${l.text}\n\n`;
    if (s.length + part.length > max) break;
    s += part;
  }
  return s;
};
// ---------- الذكاء اللي يحل: بجهتنا (lib/qaAi.ts) بالذكاء المختار. الفحوصات القديمة تگدر ترجعه لخدمة مؤمل الوهمية بـ setQaService
type QaService = (route: "/bot/qa" | "/bot/extract", body: Row) => Promise<Row>;
const ours: QaService = async (route, body) => {
  const { qgCreate } = await import("./qusayGrade.ts");
  const { qaAsk, qaRead } = await import("./qaAi.ts");
  const m = QA_MODELS[(await qaCfg()).model ?? "haiku"];
  if (route === "/bot/extract") return await qaRead(qgCreate, m, String((body.question_images as string[])[0] ?? ""), String(body.topic ?? ""));
  return await qaAsk(qgCreate, m, body as Parameters<typeof qaAsk>[2]);
};
let qaService: QaService = ours;
export const setQaService = (f: QaService | null) => { qaService = f ?? ours; };
const QA_MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
/** الذكاء جاهز يحل: مفتاحه بالسيرفر (أو الفحوصات بدلته) */
export const qaAiOn = () => qaService !== ours || !!process.env.ANTHROPIC_API_KEY;
async function call(mode: "find" | "solve" | "explain", context: string, q: QaAsk, lang: "ar" | "en", shown = "") {
  const r = await qaService("/bot/qa", { mode, context, question: (q.text ?? "").slice(0, 4000), image: q.image?.toString("base64"), lang, ...(shown ? { shown } : {}), ...(q.read ? { read: true } : {}) });
  // ألفاظ الأستاذ بس، حتى لو الذكاء كتب غيرها
  if (lang === "ar" && r.solution) { const { bookWords } = await import("./qusayGrade.ts"); r.solution = bookWords(String(r.solution)); }
  await addUsage(r.usage ?? []);
  return { found: !!r.found, solution: String(r.solution ?? "").trim() };
}

/** جواب سؤال الطالب: من المحاضرة، أو من الموضوع، أو حل على طريقة الأستاذ. null إذا ماكو ملازم لهذا الموضوع */
/** tid: موضوع البوت اللي اختاره الطالب. مواضيع الملزمة المربوطة بيه بس تدخل */
/** uid: الطالب اللي سأل، حتى الراصد مال فصله يدخل بالبحث */
/** أجزاء الملازم المربوطة بموضوع البوت هذا (منهج الطالب أول)، وأسئلة امتحاناته */
async function partsFor(chapter: number, tid: number, lang: "ar" | "en") {
  const t = await one("topics", { id: tid });
  const names = [String(t?.ar ?? ""), String(t?.en ?? "")].filter(Boolean);
  const linked = (b: QaBook, name: string) => {
    const e = b.topics.find((x) => x.topic === name);
    return e && e.tid !== undefined ? e.tid === tid : names.some((n) => sameTopic(n, name));
  };
  // موضوع الملزمة مربوط بهذا الموضوع، أو (ملزمة قديمة بلا ربط) اسمه يشبهه
  const all = (await qaBooks()).filter((b) => b.chapter === chapter);
  const pick = async (books: QaBook[]) => {
    const out: Part[] = [];
    for (const b of books) for (const l of await lecturesOf(b)) if (linked(b, l.topic)) out.push({ kind: b.kind, l });
    return out;
  };
  let mine = await pick(all.filter((b) => b.lang === lang));
  if (!mine.length) mine = await pick(all.filter((b) => b.lang !== lang));
  for (const x of await examQas(tid)) mine.push({ kind: "tests", l: { topic: `${x.exam} نموذج ${x.model} سؤال ${x.n}`, lecture: 0, text: `السؤال: ${x.question}\nالحل:\n${x.solution}` } });
  return mine;
}

export async function qaAnswer(q: QaAsk, chapter: number, tid: number, lecture: number, lang: "ar" | "en", uid?: number): Promise<QaResult | null> {
  const meta = { text: "", fk: "" };
  const r = await qaAnswerCore(q, chapter, tid, lecture, lang, uid, meta);
  return r ? { ...r, ...(meta.text ? { asked: meta.text } : {}), ...(meta.fk ? { fk: meta.fk } : {}) } : r;
}
async function qaAnswerCore(q: QaAsk, chapter: number, tid: number, lecture: number, lang: "ar" | "en", uid: number | undefined, meta: { text: string; fk: string }): Promise<QaResult | null> {
  const t = await one("topics", { id: tid });
  const names = [String(t?.ar ?? ""), String(t?.en ?? "")].filter(Boolean);
  // ملازم منهج الطالب أول (إذا الموضوع ما بيها، المنهج الثاني، والحل ينكتب بلغة الطالب)، وأسئلة الامتحانات مال الموضوع
  const mine = await partsFor(chapter, tid, lang);
  const all = (await qaBooks()).filter((b) => b.chapter === chapter);
  const rasids = await rasidsOf(uid, chapter);
  if (!mine.length && !rasids.length) return null;
  const cfg = await qaCfg(); cfg.asked++; await saveCfg(cfg);
  // ١. صورة السؤال تنقرا كتابة مرة وحدة (طلب صغير)، ونفس الصورة ما تنقرا مرتين
  let text = (q.text ?? "").trim();
  let readErr: unknown = null;
  if (q.image) {
    const ik = `qa_img2_${sha(q.image)}`;
    let read = (await kvGet(ik)) ?? "";
    if (!read) {
      try {
        const r = await qaService("/bot/extract", { question_images: [q.image.toString("base64")], topic: names[0] ?? "" });
        await addUsage(r.usage);
        read = String(r.question ?? "").trim();
        if (read) await kvSet(ik, read);
      } catch (e) { console.error("qa read", e); readErr = e; }
    }
    text = [read, text].filter(Boolean).join("\n");
  }
  // ✏️ نفس السؤال صلّح حله الأستاذ قبل (🔎 حلول الذكاء): حله يوصل ببلاش، قبل أي بحث أو ذكاء
  if (text) {
    meta.text = text;
    meta.fk = fixKey(tid, lang, text);
    const fixed = await fixedFor(meta.fk);
    if (fixed) { const c = await qaCfg(); c.free = (c.free ?? 0) + 1; await saveCfg(c); return { source: "teacher", solution: fixed }; }
  }
  // ما انقرت الصورة: الطريقة القديمة على المحاضرة بس (مو الموضوع كله)
  if (!text && !mine.length) { if (readErr) throw readErr; return null; }
  if (!text) {
    const lec = lecture ? mine.filter((x) => x.l.lecture === lecture) : mine;
    const r = await call("find", joinCtx(lec, LECTURE_MAX), q, lang);
    if (r.found && r.solution) return done("lecture", r.solution);
    const s = await call("solve", (await lessonsCtx(tid)) + joinCtx(lec, LECTURE_MAX), q, lang);
    return s.solution ? done("ai", s.solution) : null;
  }
  // ٢. نفس السؤال انسأل قبل بنفس الموضوع وبنفس اللغة: الجواب المحفوظ يرجع بلا كلفة
  // المفتاح نص السؤال كامل (نفس الأرقام ممكن طلب ثاني: «جد» غير «اثبت»)، والملازم الحالية: إذا تبدلت ملزمة ينحل من جديد
  const ck = `qa_cache_${sha(`${tid}|${lang}|${all.map((b) => b.id).sort().join(",")}|${rasids.map((b) => b.file).sort().join(",")}|${text.replace(/\s+/g, " ").toLowerCase()}`)}`;
  try {
    const hit = JSON.parse((await kvGet(ck)) ?? "null");
    // صفحة الراصد المحفوظة: بس للطالب اللي الراصد بملازمه
    const ref = hit?.rasid ?? hit?.notebook;
    const okRasid = !ref || rasids.some((b) => b.id === ref.book);
    if ((hit?.solution || ref) && okRasid) { const c = await qaCfg(); c.cached = (c.cached ?? 0) + 1; await saveCfg(c); return { source: hit.source, solution: hit.solution ?? "", ...(hit.rasid ? { rasid: hit.rasid } : {}), ...(hit.notebook ? { notebook: hit.notebook } : {}) }; }
  } catch { /* نكمل */ }
  const save = async (r: QaResult) => { await kvSet(ck, JSON.stringify(r)); return r; };
  // ٢.٥ نفس سؤال بالراصد: «📘 الحل النموذجي» مال صفحته نفسها، ببلاش
  const topicSet = new Set(names.flatMap((n) => norm(n).map(stem)));
  const sameT = (x: string) => names.some((n) => sameTopic(n, x)) || bestTopic(x, [{ id: tid, ar: names[0] ?? "", en: names[1] ?? "" }]) === tid;
  const free = async () => { const c = await qaCfg(); c.free = (c.free ?? 0) + 1; await saveCfg(c); };
  for (const b of rasids.filter((x) => x.kind === "rasid")) {
    let h: RasidHit | null = null;
    try { h = rasidFind(text, await rasidIndex(b), sameT, qWords(text, topicSet)); } catch (e) { console.error("qa rasid", e); }
    if (h) { await free(); return save({ ...await done("rasid", ""), rasid: { book: Number(b.id), ...h } }); }
  }
  // ٢.٦ نفس سؤال بـ«دفتر المحاضرات» بملازمي: صفحاته نفسها من بداية السؤال، ويا فيديوهاته، ببلاش
  for (const b of rasids.filter((x) => x.kind !== "rasid")) {
    let h: BookHit | null = null;
    let where = "";
    try {
      const toc = await bookToc(b);
      const inTopic = topicPages(toc, Number(b.pages), sameT) ?? (() => true);
      const marks = (await find("note_marks", { book_id: b.id })).map((m) => ({ id: Number(m.id), page: Number(m.page), y: Number(m.y), label: m.label }));
      h = bookFind(text, await bookRows(b), marks, inTopic, qWords(text, topicSet));
      // وين: الموضوع والمحاضرة من فهرس الدفتر
      if (h) {
        const t = [...toc].filter((x) => x.p <= h!.page).sort((x, y) => y.p - x.p)[0];
        const l = [...(t?.items ?? [])].filter((x) => x.p <= h!.page).sort((x, y) => y.p - x.p)[0];
        where = [t?.t, l?.t].filter(Boolean).join(" · ");
      }
    } catch (e) { console.error("qa notebook", e); }
    if (h) { await free(); return save({ ...await done("notebook", ""), notebook: { book: Number(b.id), where, ...h } }); }
  }
  if (!mine.length) return null;
  // ٣. نفس سؤال الملزمة بالضبط (نفس الرياضيات ونفس الطلب، وسؤال واحد بس يطابق): حل الأستاذ نفسه ببلاش، بلا ذكاء
  const ex = exactMatch(text, mine, [...names, ...new Set(mine.map((x) => x.l.topic))]);
  if (ex) {
    const c = await qaCfg(); c.free = (c.free ?? 0) + 1; await saveCfg(c);
    return save(await done(ex.lecture === lecture && lecture ? "lecture" : "topic", ex.solution));
  }
  // ٤. البوت نفسه يدور بالملزمة (ببلاش) على أقرب الأسئلة، ويدز للذكاء هذني بس، مو المحاضرة والموضوع كله
  const blocks = splitBlocks(mine);
  const ranked = blocks.map((b) => ({ b, s: blockScore(text, b, lecture) })).sort((x, y) => y.s - x.s);
  const top = ranked.slice(0, TOP_BLOCKS).filter((x) => x.s > 0);
  // الصورة تروح ويا الكتابة المقروة، حتى إذا القراية غلطت برقم يلگاه بالملزمة من الصورة نفسها
  const ask: QaAsk = q.image ? { text, image: q.image, read: true } : { text };
  const close = top.length && top[0].s >= CLOSE;
  if (close) {
    const r = await call("find", blocksCtx(top.map((x) => x.b)), ask, lang);
    if (r.found && r.solution) return save(await done(top[0].b.lecture === lecture && lecture ? "lecture" : "topic", r.solution));
  } else if (lecture) {
    // السؤال ما بيه أرقام تكفي للبحث: نشوف المحاضرة اللي اختارها بس
    const lec = mine.filter((x) => x.l.lecture === lecture);
    if (lec.length) {
      const r = await call("find", joinCtx(lec, LECTURE_MAX), ask, lang);
      if (r.found && r.solution) return save(await done("lecture", r.solution));
    }
  }
  // ٥. ما موجود: يحله على طريقة الأستاذ، والأمثلة أقرب أسئلة محلولة (أو محاضرته إذا ماكو قريب)
  const examples = top.length ? blocksCtx(top.map((x) => x.b)) : joinCtx(lecture ? mine.filter((x) => x.l.lecture === lecture) : mine, LECTURE_MAX);
  const s = await call("solve", (await lessonsCtx(tid)) + (examples || joinCtx(mine, LECTURE_MAX)), ask, lang);
  return s.solution ? save(await done("ai", s.solution)) : null;
}

// ---------- البحث بالملزمة بدون ذكاء: الملزمة تتقسم أسئلة (س1، مثال، Q1...)، وكل سؤال إله درجة قرب من سؤال الطالب
const TOP_BLOCKS = 6, CLOSE = 0.35, BLOCK_MAX = 2500;
const sha = (x: string | Buffer) => createHash("sha256").update(x).digest("hex").slice(0, 40);
const HEAD = /^\s*(س\s*\d+|سؤال\s*\d*|مثال|مثل|واجب|تمرين|Q\s*\d+|Ex(ample)?\b|Question\b)/i;
type Block = { kind: Part["kind"]; topic: string; lecture: number; text: string; head: string };
function splitBlocks(parts: Part[]): Block[] {
  const out: Block[] = [];
  for (const p of parts) {
    if (p.kind === "tests") { out.push({ kind: p.kind, topic: p.l.topic, lecture: 0, text: p.l.text.slice(0, BLOCK_MAX * 2), head: p.l.text.slice(0, 600) }); continue; }
    let cur: string[] = [];
    const flush = () => { const t = cur.join("\n").trim(); if (t) out.push({ kind: p.kind, topic: p.l.topic, lecture: p.l.lecture, text: t.slice(0, BLOCK_MAX), head: t.slice(0, 600) }); cur = []; };
    for (const line of p.l.text.split("\n")) { if (HEAD.test(line) && cur.length) flush(); cur.push(line); }
    flush();
  }
  return out;
}
/** الرياضيات بالسؤال بس، بشكل واحد: أرقام ومتغيرات وعمليات، بدون كلام ومسافات وأقواس LaTeX */
export function mathKey(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/²/g, "^2").replace(/³/g, "^3").replace(/√/g, "sqrt")
    .replace(/\\(left|right|cdot|times)/g, "").replace(/\\frac/g, "frac").replace(/\\sqrt/g, "sqrt")
    .toLowerCase().replace(/\b(?!sqrt|frac|sin|cos|tan|log)[a-z]{3,}\b/g, "").replace(/[^0-9a-z+\-*/^=().,]/g, "");
}
const grams = (s: string) => { const g = new Set<string>(); for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3)); return g; };
/** كم من رياضيات سؤال الطالب موجودة ببداية هذا السؤال (0 لـ 1). المحاضرة اللي اختارها تاخذ زيادة صغيرة */
export function blockScore(question: string, b: { head: string; lecture: number }, lecture = 0) {
  const a = grams(mathKey(question));
  if (!a.size) return 0;
  const h = grams(mathKey(b.head));
  let hit = 0;
  for (const x of a) if (h.has(x)) hit++;
  if (!hit) return 0;
  return hit / a.size + (lecture && b.lecture === lecture ? 0.05 : 0);
}
// ---------- الجواب المجاني: سؤال الطالب سؤال محلول بالملزمة. الملزمة تتقسم أسئلة (كل سؤال يبدي بـ «جد/ارسم/اثبت…»،
// أو فرع «1/ …» تحت «جد كل مما يأتي»)، وحل كل سؤال الأسطر اللي بعده لحد السؤال اللي بعده.
// يطابق إذا: نفس الرياضيات، ونفس الطلب (جد غير ارسم غير اثبت)، والكلمة اللي گبل الأرقام نفسها («بؤرته (3,0)» غير «رأسه (3,0)»)
const AR = /[؀-ۿ]/;
const FN = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "lim", "sqrt", "frac", "pi", "theta", "omega", "infty"]);
const FILL = new Set(["اذا", "علمت", "علم", "علما", "ان", "الذي", "التي", "هي", "هو", "في", "من", "على", "كل", "مما", "ياتي", "الي", "الى", "انه", "عندما", "حيث", "ذي", "ذات", "تكون", "يكون", "كان", "لها", "له", "عن", "بان", "the", "of", "an", "is", "are", "if", "that", "whose", "which", "knowing", "given", "its", "and", "at", "in", "with", "for", "to", "by", "from", "be", "it", "this", "has", "have", "then", "following", "each"]);
const VERB: Record<string, string> = { جد: "find", اوجد: "find", احسب: "find", find: "find", calculate: "find", evaluate: "find", determine: "find", ارسم: "sketch", sketch: "sketch", draw: "sketch", اثبت: "prove", برهن: "prove", بين: "prove", prove: "prove", show: "prove", verify: "prove", تحقق: "prove", حل: "solve", solve: "solve", اكتب: "write", ضع: "write", write: "write", put: "write", express: "write" };
const isWord = (t: string) => /^[A-Za-z']{3,}[.,:;?!]*$/.test(t) && !FN.has(t.replace(/[^A-Za-z]/g, "").toLowerCase());
const stem = (w: string) => w.replace(/^(لل|بال|فال|كال)(?=\S{3,})/, "");
/** كلمات السؤال بدون رياضيات وبدون كلمات الموضوع («القطع المكافئ»، «ق.م») والكلمات الفاضية */
function qWords(s: string, topic: Set<string>) {
  const plain = s.replace(/\$[^$]*\$/g, " ").split(/\s+/).flatMap((t) => t.split(/([؀-ۿ]+)/)).filter((t) => AR.test(t) || isWord(t)).join(" ");
  return norm(plain).map(stem).filter((w) => w.length >= 3 && !FILL.has(w) && !topic.has(w));
}
/** الطلب: أول فعل بأول 4 كلمات (جد، ارسم، اثبت…). "" إذا ماكو */
function verbOf(s: string) {
  const w = norm(s.replace(/^\s*(مثال|example|ex|س|سؤال|q|question)?\s*\d*\s*[:/：)\-]*\s*/i, "").replace(/^(باستخدام التعريف|(by )?using the definition)[.,]?\s*/i, "")).slice(0, 4);
  for (const x of w) if (VERB[x]) return VERB[x];
  return "";
}
/** الرياضيات بشكل واحد للمقارنة: \frac{1}{8} = 1/8، √3 = \sqrt{3}، ² = ^{2}، المسافات والأقواس الزايدة تنشال */
export function exactKey(m: string) {
  let s = m.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[–—−]/g, "-").replace(/×|\\times|\\cdot/g, "*").replace(/÷/g, "/")
    .replace(/²/g, "^{2}").replace(/³/g, "^{3}").replace(/\\(left|right|quad|,|;|!)/g, "").replace(/\$/g, "");
  for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)").replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/√/g, "sqrt").replace(/\\/g, "").replace(/[{}\s]/g, "").toLowerCase();
  for (let i = 0; i < 3; i++) s = s.replace(/\(([a-z0-9.]+)\)(?=[/^])/g, "$1").replace(/(?<=[/]|sqrt)\(([a-z0-9.]+)\)/g, "$1");
  return s.replace(/([=(,])\+/g, "$1").replace(/^\+/, "").replace(/[.,:;…]+$/, "");
}
/** قطع الرياضيات بالسؤال بالترتيب، وكل قطعة ويا الكلمة اللي گبلها («بؤرته (0,5)») */
export function mathPieces(s: string, topic: Set<string> = new Set()) {
  const out: { key: string; before: string }[] = [];
  let run: string[] = [], last = "";
  const flush = () => { const m = exactKey(run.join("")); run = []; if (/\d/.test(m) || /[a-z]=/.test(m)) out.push({ key: m, before: last }); };
  for (const t of s.match(/\$[^$]*\$|[^\s$]+/g) ?? []) {
    if (t.startsWith("$")) { run.push(t); continue; }
    for (const part of t.split(/([؀-ۿ][؀-ۿ.]*)/).filter(Boolean)) {
      if (AR.test(part) || isWord(part)) { if (run.length) flush(); const w = qWords(part, topic).at(-1); if (w) last = w; }
      else if (/[0-9A-Za-z=^_\\(){}]/.test(part)) run.push(part);
      else if (run.length && /^[+\-*/=,()–—−×]+$/.test(part)) run.push(part);
      else if (run.length) flush();
    }
  }
  if (run.length) flush();
  return out;
}
const VERB_LINE = /^\s*(?:(?:مثال|example|ex)\s*\d*\s*[:/：.)\-]?\s*)?(?:(?:باستخدام التعريف|(?:by )?using the definition)[.,]?\s*)?(جد|اوجد|أوجد|ارسم|اثبت|أثبت|برهن|بين|حل|اكتب|ضع|احسب|find|prove|show|sketch|draw|solve|write|calculate|evaluate|determine)(?![\p{L}])/iu;
const NUM_Q = /^\s*(?:س|سؤال|Q|question)\s*\d+\s*[:/：.)\-]/i;
const ITEM = /^\s*\(?(\d{1,2})\s*(?:[/)]\s+|[/)](?=\s*[(\[$A-Za-z؀-ۿ]))/;
const HW = /^\s*\S{0,3}\s*(واجب|homework)/i;
const SOL_END = /^\s*(شرح|ملاحظ|نلاحظ|استنتاج|قاعد|تعريف|في هذه المحاضر|لا\s?توجد واجبات|note|rule|definition|remember)/i;
export type BookQ = { q: string; verb: string; text: string; lecture: number; sol: string[]; stack?: string[] };
/** أسئلة المحاضرة المحلولة: السؤال، طلبه، وأسطر حله. الواجبات (بلا حل) ما تدخل */
export function bookQuestions(text: string, lecture = 0): BookQ[] {
  const out: BookQ[] = [];
  let cur: BookQ | null = null, group: BookQ[] = [], header = "", hw = false, item = 0, first = "";
  const close = () => {
    const c = cur as BookQ | null;
    if (c?.sol.length) for (const g of group) out.push({ ...g, sol: first ? [first, ...c.sol] : c.sol, stack: group.length > 1 ? group.map((x) => x.text) : undefined });
    cur = null; group = []; first = "";
  };
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (HW.test(l)) { close(); hw = true; header = ""; continue; }
    if (hw) continue;
    if (VERB_LINE.test(l) || NUM_Q.test(l)) {
      const q: BookQ = { q: l, verb: verbOf(l), text: l, lecture, sol: [] };
      if (!mathPieces(l).length ||/:\s*$|مما ي[اأ]تي|التالي|الآتي|الاتي|following/i.test(l) && !ITEM.test(l)) { close(); header = l; item = 0; continue; }
      // سؤالين ورا بعض وبعدين حلهم: الحل لثنينهم
      if (cur && !cur.sol.length) { group.push(q); cur = q; cur.sol = []; continue; }
      close(); header = ""; cur = q; group = [q]; continue;
    }
    const it = ITEM.exec(l);
    // فرع جديد: رقمه اللي بعد الفرع اللي گبله، ويبدي برياضيات (خطوة الحل «1) بما إن…» مو فرع)
    const rest = it ? l.slice(it[0].length) : "";
    if (it && header && Number(it[1]) === item + 1 && !AR.test(rest.trim()[0] ?? "") && /\d|=/.test(rest)) {
      item++;
      if (/\s\(?\d{1,2}\s*[/)]\s/.test(rest)) { close(); continue; }   // فروع كثيرة بسطر واحد (واجب، بلا حل)
      close();
      // سؤال الفرع: رياضياته لحد أول كلمة أو سهم، والطلب من العنوان
      const pre = /^[^؀-ۿ→⇒]*/.exec(rest)![0].split(/\s+/);
      const cut = pre.findIndex(isWord);
      const m = (cut < 0 ? pre : pre.slice(0, cut)).join(" ").trim();
      // السطر بيه بس السؤال (واجب بلا حل): ينحسب حل بس إذا بعده أسطر
      const q: BookQ = { q: `${header} ${m}`, verb: verbOf(header), text: `${header}\n${l}`, lecture, sol: [] };
      cur = q; group = [q];
      if (rest.trim().length > m.length + 2) q.sol.push(rest); else first = rest;
      continue;
    }
    if (SOL_END.test(l)) { close(); header = ""; continue; }
    if (cur) cur.sol.push(l);
  }
  close();
  return out.filter((x) => x.sol.length <= 80);
}
type Hit = { lecture: number; solution: string; words: string[] };
/** سؤال الطالب نفس سؤال محلول بالملزمة؟ يرجع حله (منظف) أو null. إذا أكثر من سؤال يطابق بحلول مختلفة وماكو واحد أقرب: null */
export function exactMatch(question: string, parts: { kind: string; l: { lecture: number; text: string; topic: string } }[], topicNames: string[]): { lecture: number; solution: string } | null {
  const topic = new Set(topicNames.flatMap((n) => norm(n).map(stem)));
  const sq = mathPieces(question, topic);
  if (!sq.length) return null;
  const sv = verbOf(question), sw = qWords(question, topic);
  const has = (list: string[], w: string) => list.some((x) => like(x, w));
  const hits: Hit[] = [];
  for (const p of parts) {
    const qs: BookQ[] = p.kind === "tests"
      ? (() => { const m = /^السؤال: ([\s\S]*?)\nالحل:\n([\s\S]*)$/.exec(p.l.text); return m ? [{ q: m[1], verb: verbOf(m[1]), text: m[1], lecture: 0, sol: m[2].split("\n") }] : []; })()
      : bookQuestions(p.l.text, p.l.lecture);
    for (const b of qs) {
      const bq = mathPieces(b.q, topic);
      if (bq.length !== sq.length || bq.some((x, i) => x.key !== sq[i].key)) continue;
      if (sv && b.verb && sv !== b.verb) continue;
      const bw = qWords(b.q, topic);
      // الكلمة اللي گبل كل رقم: لازم تكون بالسؤال الثاني هم
      if (bq.some((x, i) => (x.before && sw.length && !has(sw, x.before)) || (sq[i].before && !has(bw, sq[i].before)))) continue;
      // الطالب طلب شي ما بسؤال الملزمة («ثم ارسم»)
      if (sw.some((w) => VERB[w] && !has(bw, w))) continue;
      const head = b.stack ? [p.kind === "tests" ? "" : "📌 هذا السؤال بالملزمة وياه سؤال ثاني، وحلهم ورا بعض:", ...b.stack.map((x) => `❓ ${x}`)] : [];
      hits.push({ lecture: b.lecture, solution: cleanSolution([...head, ...b.sol].filter(Boolean)), words: bw });
    }
  }
  const sols = [...new Map(hits.map((h) => [h.solution, h])).values()];
  if (sols.length === 1) return sols[0];
  if (!sols.length) return null;
  // أكثر من حل: الأقرب بالكلام، إذا واحد بس أقرب من الباقي
  const score = (h: Hit) => { const a = sw.filter((w) => has(h.words, w)).length, b = h.words.filter((w) => has(sw, w)).length; return (a + b) / Math.max(1, sw.length + h.words.length); };
  const ranked = sols.map((h) => ({ h, s: score(h) })).sort((x, y) => y.s - x.s);
  return ranked[0].s > ranked[1].s + 0.05 ? ranked[0].h : null;
}

// ---------- تنظيف حل الملزمة حتى ينكتب زين بصفحة الحل
/** الكلام العربي اللي انكتب داخل معادلة Word ينگلب ترتيبه («م.ق ال معادلة»): يطلع برا المعادلة ويرجع ترتيبه */
const flipAr = (s: string) => s.trim().split(/\s+/).reverse().map((w) => (w.includes(".") ? [...w].reverse().join("") : w)).join(" ");
const MATHY = /[\^_\\]|[A-Za-z0-9)]\s*=|=\s*[-+A-Za-z0-9(]/;
/** مصفوفة Word (جدول الإشارات «- + / c s»، أو ± فوك بعض) تصير شي ينرسم: \overset، أو \pm */
function matrixTex(body: string) {
  const rows = body.split(/\\\\/).map((r) => r.split("&").map((c) => c.trim()).filter(Boolean));
  if (rows.every((r) => r.length === 1) && rows.length === 2 && rows.every((r) => /^[+-]$/.test(r[0]))) return rows[0][0] === "-" ? "\\mp " : "\\pm ";
  const line = rows.map((r) => r.join("\\;"));
  // بدون «;»: صفحة الحل تقسم السطر عليها
  const rows2 = rows.map((r) => r.join("\\quad "));
  return rows2.length === 2 ? `\\overset{${rows2[0]}}{${rows2[1]}}` : rows2.join(",\\quad ");
}
export function cleanLine(line: string): string {
  // الحرف العربي الصغير تحت أو فوك (C_{ز}، a_{ن}) يبقى بالمعادلة كتابة: ينحفظ على جنب لحد الآخر
  const keep: string[] = [];
  line = line.replace(/[​-‏⁠﻿]/g, "").replace(/\^\{\s*\}|_\{\s*\}/g, "").replace(/\\;/g, "\\,")
    .replace(/\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}/g, (_, b: string) => matrixTex(b))
    .replace(/([_^])\s*\{\s*([؀-ۿ][؀-ۿ\s.]*?)\s*\}/g, (_, op: string, a: string) => { keep.push(a.trim()); return `${op}{\\text{@${keep.length - 1}@}}`; });
  const out = cleanBody(line);
  // سطر كله رياضيات بس بيه حرف عربي صغير: ينحط كله بين $ $ (صفحة الحل تكتب السطر العربي نص)
  const wrap = keep.length && !out.includes("$") && !AR.test(out) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(out.replace(/\\[a-z]+/gi, ""));
  return (wrap ? `$${out.replace(/→/g, "\\to ")}$` : out).replace(/@(\d+)@/g, (_, k: string) => keep[Number(k)]);
}
const EN_PHRASE = /(?:^|[^\\A-Za-z])[A-Za-z]{3,}(?:[\s,.]+[A-Za-z]{2,})+/;
const EN_SPLIT = /((?:(?<![\\A-Za-z])[A-Za-z]{3,}(?![{(])[\s,.]*){2,})/;
function cleanBody(line: string): string {
  // ١. داخل $ $: الكلام العربي يطلع برا
  let s = line.replace(/\$([^$]*)\$/g, (_, m: string) => {
    // كلام إنگليزي انكتب داخل المعادلة («$squaring both sides$»): يطلع برا كلام
    if (!AR.test(m) && EN_PHRASE.test(m)) return m.split(EN_SPLIT).filter((x) => x.trim()).map((x) => (EN_PHRASE.test(x) ? ` ${x.trim()} ` : ` $${x.trim()}$ `)).join("");
    if (!AR.test(m)) return `$${m.replace(/[–—−]/g, "-")}$`;
    return m.split(/([؀-ۿ][؀-ۿ\s.،]*)/).filter((x) => x.trim()).map((x) => (AR.test(x) ? ` ${flipAr(x)} ` : ` $${x.trim()}$ `)).join("").replace(/\s+/g, " ").trim();
  }).replace(/\s+/g, " ").trim();
  const words = AR.test(s) || /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s.replace(/\$[^$]*\$/g, " "));
  // ٢. سطر كله رياضيات: ينكتب معادلة وحده (بدون $)
  if (!words) return s.replace(/\$/g, " ").replace(/\s+/g, " ").trim();
  // ٣. رياضيات بنص الكلام بدون $ (x^{2}=8y): تنحط بين $ $ حتى تنكتب مثل الكتاب
  return s.split(/(\$[^$]*\$)/).map((seg) => {
    if (seg.startsWith("$")) return seg;
    // «بدلy^{2}قيمته»: الكلام والرياضيات لاصگين، ينفصلون
    const toks = seg.replace(/([؀-ۿ])(?=[A-Za-z0-9\\(])/g, "$1 ").replace(/([A-Za-z0-9})])(?=[؀-ۿ])/g, "$1 ").split(/(\s+)/);
    const out: string[] = [];
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const m = run.join("").trim();
      out.push(MATHY.test(m) ? ` $${m.replace(/→/g, "\\to ").replace(/[–—−]/g, "-")}$ ` : run.join(""));
      run = [];
    };
    for (const t of toks) {
      const math = /^\s+$/.test(t) ? run.length > 0 : !AR.test(t) && !isWord(t) && /[0-9A-Za-z=^_\\(){}+\-→]/.test(t);
      if (math) run.push(t); else { flush(); out.push(t); }
    }
    flush();
    return out.join("");
  }).join("").replace(/\$\s*\$/g, " ").replace(/\s+/g, " ").trim();   // «$a$ $b$» ورا بعض: معادلة وحدة
}
/** الحل كله: الجدول يصير نقاط، وأسماء الرسم (أسطر قصيرة كثيرة ورا بعض) تنجمع بسطر واحد */
export function cleanSolution(lines: string[]): string {
  const out: string[] = [];
  // اسم على الرسم: سطر قصير مو خطوة حل (ما بيه أس ولا كسر) ومو عنوان الجدول
  const short = (l: string) => l.length <= 14 && !/[؀-ۿ]{4,}\s+[؀-ۿ]{3,}/.test(l) && !/[\^_\\]/.test(l) && !/^(الجدول|table)/i.test(l);
  const cell = (l: string) => /^[\s$\\a-z{}0-9+\-–−.,()]*\d[\s$\\a-z{}0-9+\-–−.,()]*$/i.test(l) && l.length <= 16;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || /^[.…،,_\s-]+$/.test(l)) continue;   // نقاط، وسطور فارغة «_ _ _» للكتابة
    if (/^(الجدول|table)\s*:?$/i.test(l)) {
      const cells: string[] = [];
      while (i + 1 < lines.length && cell(lines[i + 1].trim())) cells.push(lines[++i].trim().replace(/\$/g, "").replace(/\s+/g, ""));
      if (cells.length >= 2 && cells.length % 2 === 0) {
        // جدول Word بالعربي ينقرا من اليمين: y بعدين x
        const rtl = lines.some((x) => AR.test(x));
        const pts = [];
        for (let k = 0; k < cells.length; k += 2) pts.push(rtl ? `(${cells[k + 1]},${cells[k]})` : `(${cells[k]},${cells[k + 1]})`);
        out.push(`${rtl ? "النقاط من الجدول" : "Table points"}: $${pts.join("\\quad ")}$`);
      } else if (cells.length) out.push(`${l}: ${cells.join("  ·  ")}`);
      continue;
    }
    // أسطر قصيرة كثيرة ورا بعض (أسماء الرسم): سطر واحد
    let j = i;
    while (j < lines.length && short(lines[j].trim())) j++;
    if (j - i >= 4) { out.push(lines.slice(i, j).map((x) => cleanLine(x.trim())).filter(Boolean).map((x) => (AR.test(x) || x.includes("$") ? x : `$${x}$`)).join("  ·  ")); i = j - 1; continue; }
    out.push(cleanLine(l));
  }
  return out.filter(Boolean).join("\n");
}
function blocksCtx(list: Block[]) {
  return list.map((b) => b.kind === "tests" ? `### أسئلة الامتحانات — ${b.topic}\n${b.text}` : `### ${QA_KIND[b.kind as QaKind]} — ${b.topic} المحاضرة ${b.lecture}\n${b.text}`).join("\n\n");
}
async function addUsage(usage: any[] = []) {
  const cfg = await qaCfg();
  for (const u of usage) { cfg.inTok += Number(u.input) || 0; cfg.outTok += Number(u.output) || 0; }
  await saveCfg(cfg);
  await addSpend("qa", usdOf(usage));
}
/** كلفة طلب بالدولار (نفس حساب الكارت: التوكنات الداخلة والطالعة) */
// كل طلب بسعر الذكاء اللي جاوب (Haiku / Sonnet / Opus)، ويا الكاش
const PRICES: Record<string, { in: number; out: number; cw: number; cr: number }> = { haiku: { in: 0.1, out: 0.5, cw: 0.125, cr: 0.01 }, sonnet: { in: 2, out: 10, cw: 2.5, cr: 0.1 }, opus: { in: 4, out: 20, cw: 5, cr: 0.2 } };
const priceOf = (m: unknown) => PRICES[String(m ?? "").includes("opus") ? "opus" : String(m ?? "").includes("sonnet") ? "sonnet" : "haiku"];
const usdOf = (usage: any[] = []) => usage.reduce((t, u) => { const p = priceOf(u.model); return t + ((Number(u.input) || 0) * p.in + (Number(u.output) || 0) * p.out + (Number(u.cw) || 0) * p.cw + (Number(u.cr) || 0) * p.cr) / 1_000_000; }, 0);
/** كل صرفية الأسئلة العلمية من البداية (بالدولار) */
export const qaSpentAll = async () => { const c = await qaCfg(); return (c.inTok * PRICE_IN + c.outTok * PRICE_OUT) / 1_000_000; };
async function done(source: QaResult["source"], solution: string): Promise<QaResult> {
  const cfg = await qaCfg();
  if (source === "ai") cfg.solved++; else cfg.fromBook++;
  await saveCfg(cfg);
  return { source, solution };
}

// ---------- الجواب المحفوظ للطالب (صفحة الحل)
export async function saveAnswer(uid: number, question: string, r: QaResult, where: string, lang: "ar" | "en" = "ar", ctx: { chapter?: number; tid?: number; lecture?: number; photo?: string; page?: boolean; img?: string } = {}) {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  await kvSet(`qa_ans_${id}`, JSON.stringify({ uid, question: question.slice(0, 2000), where, source: r.source, solution: r.solution, ...(r.asked ? { asked: r.asked.slice(0, 4000) } : {}), ...(r.fk ? { fk: r.fk } : {}), ...(r.rasid ? { rasid: r.rasid } : {}), ...(r.notebook ? { notebook: r.notebook } : {}), lang, ...ctx, at: new Date().toISOString() }));
  // 🔎 حلول الذكاء: كل حل كتبه الذكاء ينضاف لقائمة الأستاذ حتى يشوفه ويصلحه
  if (AI_SOURCES.includes(r.source)) await indexAnswer({ id, at: new Date().toISOString().slice(0, 16).replace("T", " "), uid, tid: Number(ctx.tid) || 0, source: r.source, q: (r.asked || question).slice(0, 160) });
  return id;
}
/** «🤔 ما فهمت خطوة»: كم مرة على نفس الحل، وكم مرة باليوم للطالب (حتى الكلفة تبقى صغيرة) */
export const EXPLAIN_PER_ANSWER = 5, EXPLAIN_PER_DAY = 20;
type Explained = { ask: string; text: string; at: string };
const canExplain = (a: Row, cfg: QaCfg) => !!cfg.stepBtn && qaAiOn() && ["lecture", "topic", "ai", "teacher"].includes(a.source) && !!String(a.solution ?? "").trim();
/** الطالب ما فهم نقطة بالحل اللي شافه: الذكاء يشرحها على طريقة الأستاذ، من شرحه بالملزمة */
export async function qaExplain(body: Row) {
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "الرابط قديم. افتح الحل من رسالة البوت", 401);
  const id = String(body.id ?? "");
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const key = `qa_ans_${id}`;
  const a = JSON.parse((await kvGet(key)) ?? "null");
  need(a && a.uid === uid, "الحل غير موجود", 404);
  const en = a.lang === "en";
  const cfg = await qaCfg();
  need(canExplain(a, cfg), en ? "This button is off" : "هذا الزر طافي");
  const ask = String(body.ask ?? "").replace(/\s+/g, " ").trim();
  need(ask.length >= 3, en ? "Write what you did not understand" : "اكتب شنو ما فهمت");
  need(ask.length <= 500, en ? "Too long: write it shorter" : "طويل هواية، اكتبه أقصر");
  const ex: Explained[] = Array.isArray(a.ex) ? a.ex : [];
  need(ex.length < EXPLAIN_PER_ANSWER, en ? "You asked about this solution enough times. If it is still not clear, send it to the teacher" : "سألت هواية على هذا الحل. إذا بعدك ما فهمت، وصّله للأستاذ");
  const dayKey = `qa_ex_day_${uid}_${new Date().toISOString().slice(0, 10)}`;
  const today = Number(await kvGet(dayKey)) || 0;
  need(today < EXPLAIN_PER_DAY, en ? "That is enough for today, try again tomorrow" : "خلصت أسئلة اليوم، ارجع باچر");
  // شرح الأستاذ من ملزمته: المحاضرة اللي انحل منها السؤال أول، بعدها الموضوع
  let context = "";
  if (a.chapter && a.tid) {
    const parts = await partsFor(Number(a.chapter), Number(a.tid), en ? "en" : "ar");
    const lec = a.lecture ? parts.filter((x) => x.l.lecture === Number(a.lecture)) : [];
    context = joinCtx([...lec, ...parts.filter((x) => !lec.includes(x))], LECTURE_MAX);
  }
  const shown = `${a.question ? `السؤال: ${a.question}\n\n` : ""}الحل:\n${a.solution}`;
  let text = "";
  try { text = (await call("explain", context || "(لا توجد ملزمة لهذا الموضوع)", { text: ask }, en ? "en" : "ar", shown)).solution; }
  catch (e) { console.error("qa explain", e); need(false, en ? "Could not explain it now, try again later" : "ما گدرت أشرحها هسه، حاول بعد شوية"); }
  need(text, en ? "Could not explain it now, try again later" : "ما گدرت أشرحها هسه، حاول بعد شوية");
  await kvSet(dayKey, String(today + 1));
  const next = [...ex, { ask, text, at: new Date().toISOString() }];
  await kvSet(key, JSON.stringify({ ...a, ex: next }));
  const c = await qaCfg(); c.explained = (c.explained ?? 0) + 1; await saveCfg(c);
  return { ex: next, left: EXPLAIN_PER_ANSWER - next.length };
}
/** «❓ بعدني ما فهمت، وصّل سؤالي للأستاذ» من صفحة الحل (سؤال انسأل من الصفحة): يروح للأستاذ بالمجموعة، مرة وحدة */
export async function answerToTeacher(body: Row) {
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "الرابط قديم", 401);
  const id = String(body.id ?? "");
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const key = `qa_ans_${id}`;
  const a = JSON.parse((await kvGet(key)) ?? "null");
  need(a && a.uid === uid && a.page, "الحل غير موجود", 404);
  need((await qaCfg()).teacherBtn !== false, "هذا الزر مطفي");
  if (a.sentTo) return { sentTo: a.sentTo };
  const img = a.img ? await files().read(String(a.img)) : null;
  const { toTeacher } = await import("./questions.ts");
  const qid = await toTeacher(uid!, Number(a.tid) || 0, Number(a.lecture) || 0, String(a.question || a.asked || ""), img);
  await kvSet(key, JSON.stringify({ ...a, sentTo: qid }));
  return { sentTo: qid };
}
export async function answerView(body: Row) {
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "الرابط قديم. افتح الحل من رسالة البوت", 401);
  const id = String(body.id ?? "");
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const a = JSON.parse((await kvGet(`qa_ans_${id}`)) ?? "null");
  need(a && (a.uid === uid || await isAdmin(uid!)), "الحل غير موجود", 404);
  // الراصد: رقم الصفحة، وأزرار فيديو الحل والتوضيح اللي على صفحتها (الصورة والفيديو ينفتحن بنفس شروط ملازمي)
  const rasid = a.rasid ? { ...a.rasid, marks: (await marksFor(Number(a.rasid.book))).filter((m) => m.page === Number(a.rasid.page)) } : undefined;
  // الدفتر: صفحاته، وأزرار فيديو هذا السؤال بس
  const notebook = a.notebook ? { ...a.notebook, marks: a.notebook.mark ? (await marksFor(Number(a.notebook.book))).filter((m) => m.id === Number(a.notebook.mark)) : [] } : undefined;
  const cfg = await qaCfg();
  const ex: Explained[] = Array.isArray(a.ex) ? a.ex : [];
  return {
    question: a.question, where: a.where, source: a.source, solution: a.solution, lang: a.lang === "en" ? "en" : "ar", ...(rasid ? { rasid } : {}), ...(notebook ? { notebook } : {}),
    ex, explain: canExplain(a, cfg) && a.uid === uid ? EXPLAIN_PER_ANSWER - ex.length : 0, teacher: cfg.teacherBtn !== false,
    // سأل من الصفحة: «❓ بعدني ما فهمت» زر بالصفحة نفسها، مو بالبوت
    page: !!a.page && a.uid === uid, sentTo: a.sentTo ?? 0,
  };
}

// ---------- صفحة صاحب البوت
async function pageData() {
  const cfg = await qaCfg();
  const cost = Math.round(((cfg.inTok * PRICE_IN + cfg.outTok * PRICE_OUT) / 1_000_000) * 1000) / 1000;
  const list = (await qaBooks()).sort((a, b) => a.chapter - b.chapter || a.lang.localeCompare(b.lang) || a.kind.localeCompare(b.kind));
  const botTopics: Record<number, { id: number; ar: string }[]> = {};
  for (const n of new Set(list.map((b) => b.chapter))) botTopics[n] = (await chapterTopics(n)).map((t) => ({ id: t.id, ar: t.ar }));
  return { exams: await examState(), qa: { on: cfg.on, direct: cfg.direct, stepBtn: !!cfg.stepBtn, teacherBtn: cfg.teacherBtn !== false, explained: cfg.explained ?? 0, model: cfg.model ?? "haiku", delayH: cfg.delayH ?? 0, linked: qaAiOn(), asked: cfg.asked, fromBook: cfg.fromBook, free: cfg.free ?? 0, solved: cfg.solved, cost, books: list, botTopics } };
}
const DOCX_MAX = 60 * 1024 * 1024;
export async function qaAction(raw: Row | FormData) {
  const body: Row = raw instanceof FormData ? Object.fromEntries([...raw.entries()]) : raw;
  const uid = await authed(body.initData, "owner");
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "upload") {
    const f = body.file;
    need(f instanceof Blob && f.size > 0, "اختار ملف Word");
    need((f as Blob).size <= DOCX_MAX, "الملف كبير هواية");
    const chapter = Number(body.chapter);
    need(Number.isInteger(chapter) && chapter >= 1 && chapter <= 9, "اختار الفصل");
    const lang = body.lang === "en" ? "en" : "ar";
    const kind = (["main", "extra", "exams"] as const).find((k) => k === body.kind);
    need(kind, "اختار نوع الملف");
    const buf = Buffer.from(await (f as Blob).arrayBuffer());
    need(buf.subarray(0, 2).toString() === "PK", "لازم ملف Word (docx)");
    const lectures = splitLectures(docxLines(buf));
    need(lectures.length, "ما لگيت عناوين محاضرات بالملف. لازم كل محاضرة تبدي بعنوان مثل «رسم الدوال المحاضرة 1» أو «Parabola lecture 1»");
    const id = randomUUID().slice(0, 8);
    await files().write(`qa/${id}.json`, Buffer.from(JSON.stringify(lectures)), "application/json");
    const topics: QaBook["topics"] = [];
    const cands = await chapterTopics(chapter);
    for (const l of lectures) { const t = topics.find((x) => x.topic === l.topic); if (t) t.lectures.push(l.lecture); else topics.push({ topic: l.topic, lectures: [l.lecture], tid: bestTopic(l.topic, cands) }); }
    const list = (await qaBooks()).filter((b) => !(b.chapter === chapter && b.lang === lang && b.kind === kind));
    list.push({ id, chapter, lang, kind: kind!, name: String((f as File).name ?? "").slice(0, 80), topics, chars: lectures.reduce((t, l) => t + l.text.length, 0), created: new Date().toISOString().slice(0, 16).replace("T", " ") });
    await saveBooks(list);
    const loose = topics.filter((t) => t.tid === null).length;
    notice = `✅ انرفعت: ${topics.length} موضوع، ${lectures.length} محاضرة${loose ? ` · ⚠️ ${loose} موضوع ما انربط بموضوع بالبوت، شوفه تحت` : ""}`;
  } else if (a === "delete") {
    const list = await qaBooks();
    need(list.some((b) => b.id === body.id), "الملف غير موجود");
    await saveBooks(list.filter((b) => b.id !== body.id));
    notice = "🗑 انحذف";
  } else if (a === "exams") {
    const n = await queueExams();
    notice = n ? `⏳ انحطت ${n} سؤال امتحان بالدور. كل دقيقة يقرا ${EXAM_PER_TICK}، وتگدر تسكر الصفحة` : "كل أسئلة الامتحانات انقرت";
  } else if (a === "map") {
    // صاحب البوت يصلّح الربط: موضوع الملزمة هذا يروح لموضوع البوت هذا (أو لا شي)
    const list = await qaBooks();
    const b = list.find((x) => x.id === body.id);
    need(b, "الملف غير موجود");
    const e = b!.topics.find((x) => x.topic === body.topic);
    need(e, "الموضوع غير موجود");
    const tid = Number(body.tid) || null;
    need(tid === null || (await chapterTopics(b!.chapter)).some((c) => c.id === tid), "الموضوع مو من هذا الفصل");
    e!.tid = tid;
    await saveBooks(list);
    notice = "✅ انحفظ الربط";
  } else if (a === "settings") {
    const cfg = await qaCfg();
    if (body.on !== undefined) cfg.on = body.on === true || body.on === "1";
    if (body.direct !== undefined) cfg.direct = body.direct === true || body.direct === "1";
    if (body.stepBtn !== undefined) cfg.stepBtn = body.stepBtn === true || body.stepBtn === "1";
    if (body.model === "haiku" || body.model === "sonnet" || body.model === "opus") cfg.model = body.model;
    if (body.teacherBtn !== undefined) cfg.teacherBtn = body.teacherBtn === true || body.teacherBtn === "1";
    // ⏱ الجواب يوصل للطالب مباشرة لو بعد ساعات (طلبه 2026-11-24: حتى ما يحس إنه ذكاء)
    if (body.delayH !== undefined) { const h = Number(body.delayH); need(Number.isFinite(h) && h >= 0 && h <= 72, "الساعات من 0 لـ 72"); cfg.delayH = Math.round(h * 2) / 2; }
    await saveCfg(cfg);
    notice = "✅ انحفظ";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
