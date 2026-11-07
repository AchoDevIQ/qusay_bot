// الملازم والجواب الآلي على الأسئلة العلمية:
// صاحب البوت يرفع ملازم الـ PDF (لكل فصل ومنهج: الملزمة، الاثرائيات، الوزاريات). البوت يقرا نص كل صفحة،
// ويلگى عناوين المحاضرات («القطع المكافئ المحاضرة 3» / «lecture 3 parabola») فيعرف كل صفحة لأي محاضرة.
// الطالب يصور السؤال من الملزمة، وClaude يگول بس وين السؤال (الملزمة والصفحة). الرد للطالب قالب ثابت يكتبه صاحب البوت.
// إذا ماكو مفتاح، أو الجواب الآلي طافي، أو ما لگاه، السؤال يروح للأستاذ مثل قبل
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { kvGet, kvSet, type Row } from "./db.ts";
import { files } from "./files.ts";
import { esc } from "./util.ts";
import { authed, need } from "./webApi.ts";

export type Lecture = { from: number; to: number; topic: string; lecture: number };
export type Booklet = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; pages: number; lectures: Lecture[]; created: string };
const KEY = "booklets";
const CFG = "booklet_cfg";
const PDF_MAX = 40 * 1024 * 1024;
const PAGE_TEXT = 1400;
export const KIND_LABEL: Record<Booklet["kind"], string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };
export const MODEL = "claude-opus-5-5";
export const DEFAULT_REPLY = "📖 <b>سؤالك موجود بالملزمة ومشروح</b>\n\n📘 {الموضوع} · المحاضرة {المحاضرة}\n📄 {الملف} صفحة {الصفحة}\n\nارجع للمحاضرة وشوف شرحه. إذا بعدك ما فهمت، دوس الزر جوة ويوصل سؤالك للأستاذ.";
export const REPLY_TAGS = ["{الموضوع}", "{المحاضرة}", "{الملف}", "{الصفحة}", "{الفصل}"];

type Cfg = { on: boolean; reply: string; used: number; matched: number; inTok: number; cacheTok: number; outTok: number };
export async function bookletCfg(): Promise<Cfg> {
  let j: Partial<Cfg> = {};
  try { j = JSON.parse(await kvGet(CFG) ?? "{}"); } catch { /* خربانة */ }
  return { on: !!j.on, reply: j.reply || DEFAULT_REPLY, used: j.used ?? 0, matched: j.matched ?? 0, inTok: j.inTok ?? 0, cacheTok: j.cacheTok ?? 0, outTok: j.outTok ?? 0 };
}
const saveCfg = (c: Cfg) => kvSet(CFG, JSON.stringify(c));
export async function booklets(): Promise<Booklet[]> { try { return JSON.parse(await kvGet(KEY) ?? "[]"); } catch { return []; } }
const saveBooklets = (l: Booklet[]) => kvSet(KEY, JSON.stringify(l));
/** المفتاح موجود بالسيرفر؟ (ما نطلعه أبد، بس نعرف إذا محطوط) */
export const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || "").trim();

// ---------- قراية الـ PDF
/** نص كل صفحة بالترتيب: السطور من فوك لجوة، وبكل سطر من اليمين لليسار */
export async function pdfPages(buf: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[];
    const lines = new Map<number, { str: string; x: number }[]>();
    for (const t of items) { if (!t.str?.trim()) continue; const y = Math.round(t.transform[5] / 4) * 4; lines.set(y, [...lines.get(y) ?? [], { str: t.str, x: t.transform[4] }]); }
    out.push([...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.sort((a, b) => b.x - a.x).map((t) => t.str).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  return out;
}
// «المحاضرة 3» و«المحاضه 3» و«المحاض ه 3» (Word أحياناً يفصل الحرف الأخير)
const LEC_AR = /المحاض\s*(?:ر\s*)?[ةه]?\s*[(（]?\s*(\d{1,2})\s*[)）]?/;
// «lecture 3» و«(3) lecture» و«) 3 ( lecture» و«1 Parabola lecture»
const LEC_EN = /lecturer?[\s()（）]*(\d{1,2})|(\d{1,2})[\s()（）]*lecturer?|^[\s()（）]*(\d{1,2})[\s()（）]+[a-z &]+lecturer?/i;
/** عناوين المحاضرات: أول سطور الصفحة اللي بيها «المحاضرة N» أو «lecture N». كل عنوان يبدي محاضرة لحد اللي بعده */
export function findLectures(pages: string[]): Lecture[] {
  const heads: { page: number; topic: string; lecture: number }[] = [];
  pages.forEach((text, i) => {
    for (const line of text.split("\n").slice(0, 4)) {
      // «في هذه المحاضرة لا توجد...» مو عنوان
      if (/توجد|واجبات|اسئل/.test(line)) continue;
      const m = LEC_AR.exec(line) ?? LEC_EN.exec(line);
      if (!m) continue;
      const n = Number(m[1] ?? m[2] ?? m[3]);
      const topic = line.replace(m[0], " ").replace(/[()（）]+/g, " ").replace(/\s+/g, " ").replace(/^[\s&]+|[\s&]+$/g, "").trim();
      heads.push({ page: i + 1, topic: topic || "محاضرة", lecture: n });
      break;
    }
  });
  return heads.map((h, i) => ({ from: h.page, to: (heads[i + 1]?.page ?? pages.length + 1) - 1, topic: h.topic, lecture: h.lecture }));
}
export const lectureOf = (b: Booklet, page: number) => b.lectures.find((l) => page >= l.from && page <= l.to) ?? null;

// ---------- المطابقة ويا Claude
let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());
/** الفهرس اللي ينطي لـ Claude: كل صفحة برقمها ومحاضرتها ونصها. ثابت لكل فصل ومنهج، فيتخزن (cache) ويرخص */
async function indexText(list: Booklet[]) {
  const parts: string[] = [];
  for (const b of list) {
    const raw = await files().read(`booklets/${b.id}.json`);
    if (!raw) continue;
    const pages: string[] = JSON.parse(raw.toString("utf8"));
    parts.push(`### ملف ${b.id}: ${KIND_LABEL[b.kind]} الفصل ${b.chapter} (${b.lang === "ar" ? "عربي" : "إنجليزي"})`);
    pages.forEach((t, i) => { const l = lectureOf(b, i + 1); parts.push(`[${b.id}|${i + 1}]${l ? ` (${l.topic} - محاضرة ${l.lecture})` : ""}\n${t.slice(0, PAGE_TEXT)}`); });
  }
  return parts.join("\n\n");
}
const SYSTEM = `أنت تساعد مدرس رياضيات. عندك نص صفحات ملازمه (مستخرج من PDF، والعربي بيه حروف مفككة وترتيب مخربط أحياناً، بس الأرقام والمعادلات واضحة).
الطالب يرسل صورة سؤال من الملزمة. شغلتك بس: تلگى هذا السؤال بالصفحات، وترجع رقم الملف والصفحة.
- قارن المعادلات والأرقام والكلمات المهمة، مو شكل الكتابة.
- إذا السؤال موجود بأكثر من مكان، اختار الملزمة (مو الاثرائيات ولا الوزاريات) إذا موجود بيها.
- إذا مو متأكد إنه نفس السؤال، أو الصورة مو سؤال من الملزمة، رجع found=false.
- لا تحل السؤال ولا تكتب شرح.`;
const SCHEMA = {
  type: "object",
  properties: { found: { type: "boolean" }, booklet: { type: "string" }, page: { type: "integer" }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
  required: ["found", "booklet", "page", "confidence"],
  additionalProperties: false,
} as const;

export type Match = { booklet: Booklet; page: number; lecture: Lecture | null };
/** يلگى سؤال الصورة بملازم هذا الفصل ومنهج الطالب. null إذا ما لگاه أو الجواب الآلي طافي أو صار خطأ */
export async function matchQuestion(image: Buffer, mediaType: "image/jpeg" | "image/png", chapter: number, lang: "ar" | "en"): Promise<Match | null> {
  const cfg = await bookletCfg();
  if (!cfg.on || !hasKey()) return null;
  const all = await booklets();
  let list = all.filter((b) => b.chapter === chapter && b.lang === lang);
  if (!list.length) list = all.filter((b) => b.chapter === chapter);
  if (!list.length) return null;
  try {
    const res = await api().beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: await indexText(list), cache_control: { type: "ephemeral", ttl: "1h" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
        { type: "text", text: "وين هذا السؤال بالملزمة؟" },
      ] }],
    });
    // نسجل الاستعمال حتى صاحب البوت يشوف الكلفة الحقيقية
    const u = res.usage;
    cfg.used++; cfg.inTok += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); cfg.cacheTok += u.cache_read_input_tokens ?? 0; cfg.outTok += u.output_tokens ?? 0;
    if (res.stop_reason === "refusal") { await saveCfg(cfg); return null; }
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const j = JSON.parse(text) as { found: boolean; booklet: string; page: number; confidence: string };
    const b = list.find((x) => x.id === j.booklet);
    const ok = j.found && j.confidence !== "low" && b && j.page >= 1 && j.page <= b.pages;
    if (ok) cfg.matched++;
    await saveCfg(cfg);
    return ok ? { booklet: b!, page: j.page, lecture: lectureOf(b!, j.page) } : null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error("Claude:", e.status, e.message);
    else console.error(e);
    return null;
  }
}

/** رسالة الطالب من القالب: الكلام ثابت يكتبه صاحب البوت، والمكان من الفهرس */
export function replyText(template: string, m: Match) {
  const v: Record<string, string> = {
    "الموضوع": m.lecture?.topic ?? "", "المحاضرة": String(m.lecture?.lecture ?? "—"), "الملف": `${KIND_LABEL[m.booklet.kind]} الفصل ${m.booklet.chapter}`,
    "الصفحة": String(m.page), "الفصل": String(m.booklet.chapter),
  };
  // بالقالب يصير الخط العريض <b> بس، والكلمات اللي تتبدل تنكتب مثل ما هي
  return esc(template).replace(/&lt;(\/?b)&gt;/g, "<$1>").replace(/\{([^{}]+)\}/g, (all, k) => (k in v ? esc(v[k]) : all));
}

// ---------- صفحة صاحب البوت
async function pageData() {
  const cfg = await bookletCfg();
  // سعر Claude Opus 5.5: الإدخال 4$ والإخراج 20$ للمليون، والمخزن (cache) 0.20$
  const cost = (cfg.inTok * 4 + cfg.outTok * 20 + cfg.cacheTok * 0.2) / 1_000_000;
  const list = (await booklets()).sort((a, b) => a.chapter - b.chapter || a.lang.localeCompare(b.lang) || a.kind.localeCompare(b.kind));
  return { list, on: cfg.on, key: hasKey(), reply: cfg.reply, tags: REPLY_TAGS, used: cfg.used, matched: cfg.matched, cost: Math.round(cost * 100) / 100, model: MODEL, notice: "" };
}
export async function bookletAction(raw: Row | FormData) {
  const body: Row = raw instanceof FormData ? Object.fromEntries([...raw.entries()]) : raw;
  await authed(body.initData, "owner");
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "upload") {
    const f = body.file;
    need(f instanceof Blob && f.size > 0, "اختار ملف PDF");
    need((f as Blob).size <= PDF_MAX, "الملف كبير، أكثر شي 40 ميگا");
    const buf = Buffer.from(await (f as Blob).arrayBuffer());
    need(buf.subarray(0, 4).toString() === "%PDF", "لازم ملف PDF");
    const chapter = Number(body.chapter);
    need(Number.isInteger(chapter) && chapter >= 1 && chapter <= 9, "اختار الفصل");
    const lang = body.lang === "en" ? "en" : "ar";
    const kind = (["main", "extra", "exams"] as const).find((k) => k === body.kind);
    need(kind, "اختار نوع الملف");
    const pages = await pdfPages(buf);
    need(pages.some((p) => p.length > 20), "ما گدرت أقرا كتابة من هذا الملف. لازم PDF مطلع من Word، مو صور");
    const id = randomUUID().slice(0, 8);
    await files().write(`booklets/${id}.pdf`, buf, "application/pdf");
    await files().write(`booklets/${id}.json`, Buffer.from(JSON.stringify(pages)), "application/json");
    const list = (await booklets()).filter((b) => !(b.chapter === chapter && b.lang === lang && b.kind === kind));
    const b: Booklet = { id, chapter, lang, kind: kind!, name: String(body.name ?? "").slice(0, 80) || `${KIND_LABEL[kind!]} الفصل ${chapter}`, pages: pages.length, lectures: findLectures(pages), created: new Date().toISOString().slice(0, 16).replace("T", " ") };
    await saveBooklets([...list, b]);
    notice = `✅ انرفع: ${pages.length} صفحة، ${b.lectures.length} محاضرة`;
  } else if (a === "bundle") {
    // ملف وحد بيه كل الملازم (نصها مقري من Word صفحة صفحة): ينرفع مرة وحدة ويحل محل اللي قبله لنفس الفصل والمنهج والنوع
    const f = body.file;
    need(f instanceof Blob && f.size > 0, "اختار ملف الملازم");
    need((f as Blob).size <= PDF_MAX, "الملف كبير");
    let j: { booklets?: Row[] } = {};
    try { j = JSON.parse(Buffer.from(await (f as Blob).arrayBuffer()).toString("utf8")); } catch { need(false, "هذا مو ملف الملازم"); }
    const items = Array.isArray(j.booklets) ? j.booklets : [];
    need(items.length, "ماكو ملازم بالملف");
    let list = await booklets();
    for (const it of items) {
      const chapter = Number(it.chapter), lang = it.lang === "en" ? "en" : "ar";
      const kind = (["main", "extra", "exams"] as const).find((k) => k === it.kind);
      const pages = Array.isArray(it.pages) ? (it.pages as unknown[]).map((p) => String(p ?? "").slice(0, 6000)) : [];
      if (!kind || !Number.isInteger(chapter) || chapter < 1 || chapter > 9 || !pages.length) continue;
      const id = randomUUID().slice(0, 8);
      await files().write(`booklets/${id}.json`, Buffer.from(JSON.stringify(pages)), "application/json");
      list = list.filter((b) => !(b.chapter === chapter && b.lang === lang && b.kind === kind));
      list.push({ id, chapter, lang, kind, name: String(it.name ?? "").slice(0, 80) || `${KIND_LABEL[kind]} الفصل ${chapter}`, pages: pages.length, lectures: findLectures(pages), created: new Date().toISOString().slice(0, 16).replace("T", " ") });
    }
    await saveBooklets(list);
    notice = `✅ انرفعت ${items.length} ملزمة`;
  } else if (a === "delete") {
    const list = await booklets();
    need(list.some((b) => b.id === body.id), "الملف غير موجود");
    await saveBooklets(list.filter((b) => b.id !== body.id));
    notice = "🗑 انحذف";
  } else if (a === "topics") {
    // صاحب البوت يصلح أسماء المواضيع (العربي من الـ PDF يطلع حروفه مفككة)
    const list = await booklets();
    const b = list.find((x) => x.id === body.id);
    need(b, "الملف غير موجود");
    const names = Array.isArray(body.topics) ? (body.topics as unknown[]).map((x) => String(x ?? "").trim().slice(0, 60)) : [];
    b!.lectures = b!.lectures.map((l, i) => ({ ...l, topic: names[i] || l.topic }));
    await saveBooklets(list);
    notice = "✅ انحفظت أسماء المواضيع";
  } else if (a === "settings") {
    const cfg = await bookletCfg();
    if (body.on !== undefined) cfg.on = body.on === true || body.on === "1";
    if (body.reply !== undefined) { const r = String(body.reply).trim().slice(0, 1500); need(r, "اكتب نص الرد"); cfg.reply = r; }
    if (body.reset === "1" || body.reset === true) cfg.reply = DEFAULT_REPLY;
    await saveCfg(cfg);
    notice = "✅ انحفظ";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
