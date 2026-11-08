// الأسئلة العلمية من ملازم الأستاذ (Word): الطالب يختار الفصل والموضوع والمحاضرة ويسأل.
// ١. يدور بالمحاضرة اللي اختارها. ٢. إذا ما لگاه، يدور بالموضوع بس (مو بالفصل كله). ٣. إذا ما لگاه، نظام الذكاء يحله على طريقة الأستاذ.
// الجواب يوصل للطالب كتابة (صفحة بيها الرياضيات مكتوبة مثل الكتاب)، مو صورة من الملزمة، حتى يبقى رخيص
import { randomUUID } from "node:crypto";
import { kvGet, kvSet, type Row } from "./db.ts";
import { files } from "./files.ts";
import { aiLinked, svc } from "./aiGrade.ts";
import { docxLines } from "./docxText.ts";
import { verifyHomeToken } from "./webAuth.ts";
import { isAdmin } from "./data.ts";
import { authed, need } from "./webApi.ts";

export type QaKind = "main" | "extra" | "exams";
export const QA_KIND: Record<QaKind, string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };
type Lecture = { topic: string; lecture: number; text: string };
export type QaBook = { id: string; chapter: number; lang: "ar" | "en"; kind: QaKind; name: string; topics: { topic: string; lectures: number[] }[]; chars: number; created: string };
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
export function splitLectures(lines: string[]): Lecture[] {
  const out: Lecture[] = [];
  let cur: Lecture | null = null;
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ").trim();
    const m = /^(.{2,90}?)\s*(?:المحاضرة|المحاضره|Lecture)\s*(\d{1,2})\s*$/i.exec(l);
    if (m && !/\$/.test(l)) {
      const topic = m[1].replace(/^واجبات\s+/, "").trim();
      const lecture = Number(m[2]);
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
  return s.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/&/g, " و ")
    .toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/^(و|ال|وال)(?=\S{3,})/, "")).filter((w) => w && w !== "و" && !/^\d+$/.test(w));
}
/** هل موضوع الملزمة هو نفس الموضوع اللي اختاره الطالب */
export function sameTopic(picked: string, book: string) {
  const a = norm(picked), b = new Set(norm(book));
  if (!a.length || !b.size) return false;
  const hit = a.filter((w) => b.has(w)).length;
  return hit / a.length >= 0.6 && hit / b.size >= 0.5;
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
async function call(mode: "find" | "solve", context: string, q: QaAsk) {
  const r = await svc("/bot/qa", { mode, context, question: q.text ?? "", image: q.image?.toString("base64") }, 180_000);
  const cfg = await qaCfg();
  for (const u of r.usage ?? []) { cfg.inTok += Number(u.input) || 0; cfg.outTok += Number(u.output) || 0; }
  await saveCfg(cfg);
  return { found: !!r.found, solution: String(r.solution ?? "").trim() };
}

/** جواب سؤال الطالب: من المحاضرة، أو من الموضوع، أو حل على طريقة الأستاذ. null إذا ماكو ملازم لهذا الموضوع */
export async function qaAnswer(q: QaAsk, chapter: number, topicName: string, lecture: number, lang: "ar" | "en"): Promise<QaResult | null> {
  const all = (await qaBooks()).filter((b) => b.chapter === chapter);
  const books = all.some((b) => b.lang === lang) ? all.filter((b) => b.lang === lang) : all;
  const mine: { kind: QaKind; l: Lecture }[] = [];
  for (const b of books) for (const l of await lecturesOf(b)) if (sameTopic(topicName, l.topic)) mine.push({ kind: b.kind, l });
  if (!mine.length) return null;
  const cfg = await qaCfg(); cfg.asked++; await saveCfg(cfg);
  const inLecture = lecture ? mine.filter((x) => x.l.lecture === lecture) : [];
  if (inLecture.length) {
    const r = await call("find", joinCtx(inLecture, LECTURE_MAX), q);
    if (r.found && r.solution) return done("lecture", r.solution);
  }
  const rest = mine.filter((x) => !inLecture.includes(x));
  if (rest.length || !inLecture.length) {
    const r = await call("find", joinCtx(rest.length ? rest : mine, TOPIC_MAX), q);
    if (r.found && r.solution) return done("topic", r.solution);
  }
  const s = await call("solve", joinCtx([...inLecture, ...rest], TOPIC_MAX), q);
  return s.solution ? done("ai", s.solution) : null;
}
async function done(source: QaResult["source"], solution: string): Promise<QaResult> {
  const cfg = await qaCfg();
  if (source === "ai") cfg.solved++; else cfg.fromBook++;
  await saveCfg(cfg);
  return { source, solution };
}

// ---------- الجواب المحفوظ للطالب (صفحة الحل)
export async function saveAnswer(uid: number, question: string, r: QaResult, where: string) {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  await kvSet(`qa_ans_${id}`, JSON.stringify({ uid, question: question.slice(0, 2000), where, source: r.source, solution: r.solution, at: new Date().toISOString() }));
  return id;
}
export async function answerView(body: Row) {
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "الرابط قديم. افتح الحل من رسالة البوت", 401);
  const id = String(body.id ?? "");
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const a = JSON.parse((await kvGet(`qa_ans_${id}`)) ?? "null");
  need(a && (a.uid === uid || await isAdmin(uid!)), "الحل غير موجود", 404);
  return { question: a.question, where: a.where, source: a.source, solution: a.solution };
}

// ---------- صفحة صاحب البوت
async function pageData() {
  const cfg = await qaCfg();
  const cost = Math.round(((cfg.inTok * PRICE_IN + cfg.outTok * PRICE_OUT) / 1_000_000) * 1000) / 1000;
  const list = (await qaBooks()).sort((a, b) => a.chapter - b.chapter || a.lang.localeCompare(b.lang) || a.kind.localeCompare(b.kind));
  return { qa: { on: cfg.on, direct: cfg.direct, linked: aiLinked(), asked: cfg.asked, fromBook: cfg.fromBook, solved: cfg.solved, cost, books: list } };
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
    need(lectures.length, "ما لگيت عناوين محاضرات بالملف. لازم كل محاضرة تبدي بعنوان مثل «رسم الدوال المحاضرة 1»");
    const id = randomUUID().slice(0, 8);
    await files().write(`qa/${id}.json`, Buffer.from(JSON.stringify(lectures)), "application/json");
    const topics: QaBook["topics"] = [];
    for (const l of lectures) { const t = topics.find((x) => x.topic === l.topic); if (t) t.lectures.push(l.lecture); else topics.push({ topic: l.topic, lectures: [l.lecture] }); }
    const list = (await qaBooks()).filter((b) => !(b.chapter === chapter && b.lang === lang && b.kind === kind));
    list.push({ id, chapter, lang, kind: kind!, name: String((f as File).name ?? "").slice(0, 80), topics, chars: lectures.reduce((t, l) => t + l.text.length, 0), created: new Date().toISOString().slice(0, 16).replace("T", " ") });
    await saveBooks(list);
    notice = `✅ انرفعت: ${topics.length} موضوع، ${lectures.length} محاضرة`;
  } else if (a === "delete") {
    const list = await qaBooks();
    need(list.some((b) => b.id === body.id), "الملف غير موجود");
    await saveBooks(list.filter((b) => b.id !== body.id));
    notice = "🗑 انحذف";
  } else if (a === "settings") {
    const cfg = await qaCfg();
    if (body.on !== undefined) cfg.on = body.on === true || body.on === "1";
    if (body.direct !== undefined) cfg.direct = body.direct === true || body.direct === "1";
    await saveCfg(cfg);
    notice = "✅ انحفظ";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
