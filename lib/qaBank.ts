// الأسئلة العلمية من ملازم الأستاذ (Word): الطالب يختار الفصل والموضوع والمحاضرة ويسأل.
// ١. يدور بالمحاضرة اللي اختارها. ٢. إذا ما لگاه، يدور بالموضوع بس (مو بالفصل كله). ٣. إذا ما لگاه، نظام الذكاء يحله على طريقة الأستاذ.
// الجواب يوصل للطالب كتابة (صفحة بيها الرياضيات مكتوبة مثل الكتاب)، مو صورة من الملزمة، حتى يبقى رخيص
import { randomUUID } from "node:crypto";
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { files } from "./files.ts";
import { aiLinked, svc } from "./aiGrade.ts";
import { docxLines } from "./docxText.ts";
import { verifyHomeToken } from "./webAuth.ts";
import { isAdmin } from "./data.ts";
import { authed, need } from "./webApi.ts";

export type QaKind = "main" | "extra" | "exams";
export const QA_KIND: Record<QaKind, string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };
type Lecture = { topic: string; lecture: number; text: string };
/** tid: موضوع البوت اللي ينربط بيه موضوع الملزمة (الأسماء تختلف: «ديموافر» = «الصيغة القطبية وديموافر»). null يعني ما ينربط */
export type QaBook = { id: string; chapter: number; lang: "ar" | "en"; kind: QaKind; name: string; topics: { topic: string; lectures: number[]; tid?: number | null }[]; chars: number; created: string };
export type QaCfg = { on: boolean; direct: boolean; asked: number; fromBook: number; solved: number; inTok: number; outTok: number };
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

/** فيه ملازم لهذا الفصل؟ (والذكاء مربوط) */
export async function qaReady(chapter: number) {
  return aiLinked() && (await qaCfg()).on && (await qaBooks()).some((b) => b.chapter === chapter);
}

export type QaAsk = { text?: string; image?: Buffer };
export type QaResult = { source: "lecture" | "topic" | "ai"; solution: string };
const joinCtx = (list: { kind: QaKind; l: Lecture }[], max: number) => {
  let s = "";
  for (const { kind, l } of list) {
    const part = `### ${QA_KIND[kind]} — ${l.topic} المحاضرة ${l.lecture}\n${l.text}\n\n`;
    if (s.length + part.length > max) break;
    s += part;
  }
  return s;
};
async function call(mode: "find" | "solve", context: string, q: QaAsk, lang: "ar" | "en") {
  const r = await svc("/bot/qa", { mode, context, question: q.text ?? "", image: q.image?.toString("base64"), lang }, 180_000);
  const cfg = await qaCfg();
  for (const u of r.usage ?? []) { cfg.inTok += Number(u.input) || 0; cfg.outTok += Number(u.output) || 0; }
  await saveCfg(cfg);
  return { found: !!r.found, solution: String(r.solution ?? "").trim() };
}

/** جواب سؤال الطالب: من المحاضرة، أو من الموضوع، أو حل على طريقة الأستاذ. null إذا ماكو ملازم لهذا الموضوع */
/** tid: موضوع البوت اللي اختاره الطالب. مواضيع الملزمة المربوطة بيه بس تدخل */
export async function qaAnswer(q: QaAsk, chapter: number, tid: number, lecture: number, lang: "ar" | "en"): Promise<QaResult | null> {
  const t = await one("topics", { id: tid });
  const names = [String(t?.ar ?? ""), String(t?.en ?? "")].filter(Boolean);
  // موضوع الملزمة مربوط بهذا الموضوع، أو (ملزمة قديمة بلا ربط) اسمه يشبهه
  const linked = (b: QaBook, name: string) => {
    const e = b.topics.find((x) => x.topic === name);
    return e && e.tid !== undefined ? e.tid === tid : names.some((n) => sameTopic(n, name));
  };
  const all = (await qaBooks()).filter((b) => b.chapter === chapter);
  // ملازم منهج الطالب أول. إذا الموضوع ما بيها، ملازم المنهج الثاني، والحل ينكتب بلغة الطالب
  const pick = async (books: QaBook[]) => {
    const out: { kind: QaKind; l: Lecture }[] = [];
    for (const b of books) for (const l of await lecturesOf(b)) if (linked(b, l.topic)) out.push({ kind: b.kind, l });
    return out;
  };
  let mine = await pick(all.filter((b) => b.lang === lang));
  if (!mine.length) mine = await pick(all.filter((b) => b.lang !== lang));
  if (!mine.length) return null;
  const cfg = await qaCfg(); cfg.asked++; await saveCfg(cfg);
  const inLecture = lecture ? mine.filter((x) => x.l.lecture === lecture) : [];
  if (inLecture.length) {
    const r = await call("find", joinCtx(inLecture, LECTURE_MAX), q, lang);
    if (r.found && r.solution) return done("lecture", r.solution);
  }
  const rest = mine.filter((x) => !inLecture.includes(x));
  if (rest.length || !inLecture.length) {
    const r = await call("find", joinCtx(rest.length ? rest : mine, TOPIC_MAX), q, lang);
    if (r.found && r.solution) return done("topic", r.solution);
  }
  const s = await call("solve", joinCtx([...inLecture, ...rest], TOPIC_MAX), q, lang);
  return s.solution ? done("ai", s.solution) : null;
}
async function done(source: QaResult["source"], solution: string): Promise<QaResult> {
  const cfg = await qaCfg();
  if (source === "ai") cfg.solved++; else cfg.fromBook++;
  await saveCfg(cfg);
  return { source, solution };
}

// ---------- الجواب المحفوظ للطالب (صفحة الحل)
export async function saveAnswer(uid: number, question: string, r: QaResult, where: string, lang: "ar" | "en" = "ar") {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  await kvSet(`qa_ans_${id}`, JSON.stringify({ uid, question: question.slice(0, 2000), where, source: r.source, solution: r.solution, lang, at: new Date().toISOString() }));
  return id;
}
export async function answerView(body: Row) {
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "الرابط قديم. افتح الحل من رسالة البوت", 401);
  const id = String(body.id ?? "");
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const a = JSON.parse((await kvGet(`qa_ans_${id}`)) ?? "null");
  need(a && (a.uid === uid || await isAdmin(uid!)), "الحل غير موجود", 404);
  return { question: a.question, where: a.where, source: a.source, solution: a.solution, lang: a.lang === "en" ? "en" : "ar" };
}

// ---------- صفحة صاحب البوت
async function pageData() {
  const cfg = await qaCfg();
  const cost = Math.round(((cfg.inTok * PRICE_IN + cfg.outTok * PRICE_OUT) / 1_000_000) * 1000) / 1000;
  const list = (await qaBooks()).sort((a, b) => a.chapter - b.chapter || a.lang.localeCompare(b.lang) || a.kind.localeCompare(b.kind));
  const botTopics: Record<number, { id: number; ar: string }[]> = {};
  for (const n of new Set(list.map((b) => b.chapter))) botTopics[n] = (await chapterTopics(n)).map((t) => ({ id: t.id, ar: t.ar }));
  return { qa: { on: cfg.on, direct: cfg.direct, linked: aiLinked(), asked: cfg.asked, fromBook: cfg.fromBook, solved: cfg.solved, cost, books: list, botTopics } };
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
    await saveCfg(cfg);
    notice = "✅ انحفظ";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
