// الملازم والجواب الآلي على الأسئلة العلمية:
// صاحب البوت يرفع ملازم الـ PDF (لكل فصل ومنهج: الملزمة، الاثرائيات، الوزاريات). البوت يقرا نص كل صفحة،
// ويلگى عناوين المحاضرات («القطع المكافئ المحاضرة 3» / «lecture 3 parabola») فيعرف كل صفحة لأي محاضرة.
// الطالب يصور السؤال من الملزمة، وClaude يگول بس وين السؤال (الملزمة والصفحة). الرد للطالب قالب ثابت يكتبه صاحب البوت.
// إذا ماكو مفتاح، أو الجواب الآلي طافي، أو ما لگاه، السؤال يروح للأستاذ مثل قبل
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { kvGet, kvSet, type Row } from "./db.ts";
import { files } from "./files.ts";
import { esc } from "./util.ts";
import { authed, need } from "./webApi.ts";

export type Lecture = { from: number; to: number; topic: string; lecture: number };
export type Booklet = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; pages: number; lectures: Lecture[]; created: string; pdf?: boolean };
const KEY = "booklets";
const CFG = "booklet_cfg";
const PDF_MAX = 40 * 1024 * 1024;
const PAGE_TEXT = 1400;
export const KIND_LABEL: Record<Booklet["kind"], string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };
export const MODEL = "claude-opus-5-5";
export const DEFAULT_REPLY = "📘 <b>هاك حل سؤالك</b> 👆\n\nإذا بعدك ما فهمت، دوس الزر جوة ويوصل سؤالك للأستاذ.";
export const REPLY_TAGS: string[] = [];

export type Cfg = { on: boolean; reply: string; used: number; matched: number; inTok: number; cacheTok: number; outTok: number };
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
// «المحاضرة الأولى : الاشتقاق»، «المحاضرة الحادية عشر»
const LEC_WORD = /المحاضر[ةه]\s+(ال[^\s:：]+(?:\s+عشر[ةه]?)?)/;
// مكتوبة بعد التوحيد: أ←ا، ة←ه، ى←ي، وبدون «ال»
const ORD = ["اولي", "ثانيه", "ثالثه", "رابعه", "خامسه", "سادسه", "سابعه", "ثامنه", "تاسعه", "عاشره"];
/** «الأولى» = 1 … «العاشرة» = 10، و«الحادية عشر» = 11 … «العشرون» = 20. غير هذا 0 */
function ordinal(raw: string) {
  const s = raw.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/^ال/, "").trim();
  if (/^عشرو?ن/.test(s)) return 20;
  const [first, teen] = s.split(/\s+/);
  const base = first === "حاديه" ? 1 : ORD.indexOf(first) + 1;
  if (!base) return 0;
  return teen && /^عشر/.test(teen) ? 10 + base : base;
}
/** عناوين المحاضرات: أول سطور الصفحة اللي بيها «المحاضرة N» أو «lecture N». كل عنوان يبدي محاضرة لحد اللي بعده */
export function findLectures(pages: string[]): Lecture[] {
  const heads: { page: number; topic: string; lecture: number }[] = [];
  pages.forEach((text, i) => {
    for (const line of text.split("\n").slice(0, 4)) {
      // «في هذه المحاضرة لا توجد...» مو عنوان
      if (/توجد|واجبات|اسئل/.test(line)) continue;
      const w = LEC_WORD.exec(line);
      const m = w && ordinal(w[1]) ? w : LEC_AR.exec(line) ?? LEC_EN.exec(line);
      if (!m) continue;
      const n = m === w ? ordinal(w![1]) : Number(m[1] ?? m[2] ?? m[3]);
      const topic = line.replace(m[0], " ").replace(/[()（）:：]+/g, " ").replace(/\s+/g, " ").replace(/^[\s&]+|[\s&]+$/g, "").trim();
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
const SYSTEM = `أنت تساعد مدرس رياضيات. عندك نص صفحات ملازمه، وبيها أسئلة هو حلها وشرحها.
الطالب يرسل سؤال (صورة أو كتابة، من الكتاب أو امتحان أو أي مكان). شغلتك بس: تشوف إذا نفس هذا السؤال محلول بالملازم.
- قارن المعادلات والأرقام والمطلوب. لازم يكون نفس السؤال، مو سؤال يشبهه.
- رجع الملف وأول صفحة يبدي بيها السؤال وحله، وآخر صفحة يخلص بيها الحل (نفس الصفحة إذا ما يكمل).
- إذا السؤال محلول بأكثر من مكان، اختار المكان اللي بيه أوضح حل.
- إذا مو موجود، أو مو متأكد، رجع found=false.
- لا تحل السؤال ولا تكتب شرح.`;
const SCHEMA = {
  type: "object",
  properties: { found: { type: "boolean" }, booklet: { type: "string" }, page: { type: "integer" }, page_end: { type: "integer" }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
  required: ["found", "booklet", "page", "page_end", "confidence"],
  additionalProperties: false,
} as const;
const CROP = {
  type: "object",
  properties: { top: { type: "number" }, bottom: { type: "number" }, found: { type: "boolean" } },
  required: ["top", "bottom", "found"],
  additionalProperties: false,
} as const;

export type Ask = { image?: Buffer; text?: string };
export type Match = { booklet: Booklet; from: number; to: number };
type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
const track = (cfg: Cfg, u: Usage) => { cfg.inTok += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); cfg.cacheTok += u.cache_read_input_tokens ?? 0; cfg.outTok += u.output_tokens ?? 0; };
/** سؤال الطالب كمحتوى لـ Claude: صورته وكتابته */
const askContent = (q: Ask) => [
  ...(q.image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: q.image.toString("base64") } }] : []),
  ...(q.text ? [{ type: "text" as const, text: `سؤال الطالب: ${q.text.slice(0, 2000)}` }] : []),
];
/** طلب لـ Claude يرجع JSON بالشكل المطلوب */
async function ask(cfg: Cfg, system: Anthropic.Beta.BetaTextBlockParam[], content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>) {
  const res = await api().beta.messages.create({
    model: MODEL, max_tokens: 2000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", system,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  track(cfg, res.usage);
  if (res.stop_reason === "refusal") return null;
  return JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
}

/** وين حل هذا السؤال بالملازم (الملف والصفحات). null إذا ما لگاه */
async function findAnswer(cfg: Cfg, q: Ask, chapter: number, lang: "ar" | "en"): Promise<Match | null> {
  const all = (await booklets()).filter((b) => b.pdf);
  let list = all.filter((b) => b.chapter === chapter && b.lang === lang);
  if (!list.length) list = all.filter((b) => b.chapter === chapter);
  if (!list.length) return null;
  const j = await ask(cfg, [{ type: "text", text: SYSTEM }, { type: "text", text: await indexText(list), cache_control: { type: "ephemeral", ttl: "1h" } }],
    [...askContent(q), { type: "text", text: "هذا السؤال محلول بالملازم؟ وين؟" }], SCHEMA);
  if (!j?.found || j.confidence === "low") return null;
  const b = list.find((x) => x.id === j.booklet);
  if (!b || j.page < 1 || j.page > b.pages) return null;
  const to = Math.min(b.pages, Math.max(j.page, Number(j.page_end) || j.page), j.page + 1);
  return { booklet: b, from: j.page, to };
}

// ---------- صور الصفحات والإطار
/** صورة صفحة من PDF الملزمة (تنحفظ أول مرة، وبعدها جاهزة) */
async function pageImage(b: Booklet, n: number): Promise<Buffer | null> {
  const ref = `booklets/${b.id}/p${n}.jpg`;
  const cached = await files().read(ref);
  if (cached) return cached;
  const pdf = await files().read(`booklets/${b.id}.pdf`);
  if (!pdf) return null;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
  if (n > doc.numPages) return null;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1100 / page.getViewport({ scale: 1 }).width });
  const factory = (doc as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: { encode: (f: string, q: number) => Promise<Buffer> }; context: unknown } } }).canvasFactory;
  const cc = factory.create(viewport.width, viewport.height);
  await page.render({ canvas: cc.canvas as never, canvasContext: cc.context as never, viewport }).promise;
  const jpg = Buffer.from(await cc.canvas.encode("jpeg", 82));
  await files().write(ref, jpg, "image/jpeg");
  return jpg;
}
/** Claude يشوف صفحة الحل ويگول وين يبدي السؤال ووين يخلص حله (من فوك 0 لجوة 1) */
async function cropOf(cfg: Cfg, q: Ask, pages: Buffer[]) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [...askContent(q)];
  pages.forEach((p, i) => content.push({ type: "text", text: `صفحة ${i + 1} من ${pages.length}:` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.toString("base64") } }));
  content.push({ type: "text", text: pages.length > 1
    ? "الحل يبدي بالصفحة الأولى ويكمل بالثانية. top: وين يبدي السؤال بالصفحة الأولى، bottom: وين يخلص الحل بالصفحة الثانية. كنسبة من طول الصفحة (0 فوك، 1 جوة). خلي هامش صغير."
    : "top: وين يبدي هذا السؤال بالصفحة، bottom: وين يخلص حله. كنسبة من طول الصفحة (0 فوك، 1 جوة). خلي هامش صغير، ولا تاخذ أسئلة ثانية." });
  const j = await ask(cfg, [{ type: "text", text: "تقص من صفحة ملزمة رياضيات بس سؤال الطالب وحله، حتى يوصله بصورة." }], content, CROP);
  if (!j?.found) return null;
  const top = Math.min(1, Math.max(0, Number(j.top))), bottom = Math.min(1, Math.max(0, Number(j.bottom)));
  if (pages.length === 1 && bottom - top < 0.04) return null;
  return { top, bottom };
}
let fontsReady = false;
/** الصورة اللي توصل للطالب: رأس فوك (الشعار و«حل سؤالك»)، وجواه السؤال وحله من الملزمة بإطار */
export async function framed(parts: Buffer[], top: number, bottom: number, title = "حل سؤالك") {
  const { createCanvas, loadImage, GlobalFonts } = await import("@napi-rs/canvas");
  if (!fontsReady) {
    for (const f of ["NotoSansArabic-Bold.ttf", "NotoSansArabic-Regular.ttf"]) { const p = path.join(process.cwd(), "assets", "fonts", f); if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, "QArabic"); }
    fontsReady = true;
  }
  const imgs = await Promise.all(parts.map((p) => loadImage(p)));
  const W = 1100, PAD = 28, HEAD = 120;
  // القطع: الصفحة الأولى من top، والأخيرة لحد bottom، واللي بينهن كاملة
  const pieces = imgs.map((im, i) => {
    const y0 = i === 0 ? Math.floor(top * im.height) : 0;
    const y1 = i === imgs.length - 1 ? Math.ceil(bottom * im.height) : im.height;
    return { im, y0, h: Math.max(1, y1 - y0) };
  });
  const scale = (W - PAD * 2) / imgs[0].width;
  const bodyH = pieces.reduce((s, p) => s + p.h * scale, 0);
  const c = createCanvas(W, Math.round(HEAD + bodyH + PAD * 2));
  const g = c.getContext("2d");
  g.fillStyle = "#0f1a2e"; g.fillRect(0, 0, W, c.height);
  // الرأس
  const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, "#f7c548"); grad.addColorStop(1, "#d79b1e");
  g.fillStyle = grad; g.fillRect(0, 0, W, HEAD);
  const logoPath = path.join(process.cwd(), "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    // الشعار ذهبي، فيصير فوك دائرة غامقة حتى يبين
    const logo = await loadImage(fs.readFileSync(logoPath)); const r = 48, cx = PAD + r, cy = HEAD / 2, lh = 72;
    g.fillStyle = "#0f1a2e"; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    const lw = (logo.width * lh) / logo.height; g.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
  }
  g.fillStyle = "#0f1a2e"; g.font = "bold 46px QArabic"; g.textAlign = "right"; g.textBaseline = "middle"; g.direction = "rtl";
  g.fillText(title, W - PAD, HEAD / 2);
  // الجواب بإطار أبيض
  g.fillStyle = "#ffffff"; g.fillRect(PAD - 6, HEAD + PAD - 6, W - PAD * 2 + 12, bodyH + 12);
  let y = HEAD + PAD;
  for (const p of pieces) { g.drawImage(p.im, 0, p.y0, p.im.width, p.h, PAD, y, W - PAD * 2, p.h * scale); y += p.h * scale; }
  g.strokeStyle = "#f7c548"; g.lineWidth = 4; g.strokeRect(PAD - 6, HEAD + PAD - 6, W - PAD * 2 + 12, bodyH + 12);
  return Buffer.from(await c.encode("jpeg", 85));
}

/** الجواب الآلي يشتغل؟ (شغال، والمفتاح موجود، وأكو ملازم بـ PDF لهذا الفصل) */
export async function autoReady(chapter: number) {
  if (!hasKey() || !(await bookletCfg()).on) return false;
  return (await booklets()).some((b) => b.pdf && b.chapter === chapter);
}
/** سؤال الطالب: إذا حله موجود بالملازم، صورة الحل بإطار. null إذا الجواب الآلي طافي أو ما لگاه أو صار خطأ */
export async function answerFromBooklets(q: Ask, chapter: number, lang: "ar" | "en"): Promise<{ image: Buffer; match: Match } | null> {
  const cfg = await bookletCfg();
  if (!cfg.on || !hasKey() || (!q.image && !q.text?.trim())) return null;
  cfg.used++;
  try {
    const m = await findAnswer(cfg, q, chapter, lang);
    if (!m) return null;
    const pages: Buffer[] = [];
    for (let n = m.from; n <= m.to; n++) { const p = await pageImage(m.booklet, n); if (p) pages.push(p); }
    if (!pages.length) return null;
    const crop = await cropOf(cfg, q, pages);
    if (!crop) return null;
    cfg.matched++;
    return { image: await framed(pages, crop.top, crop.bottom), match: m };
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error("Claude:", e.status, e.message);
    else console.error(e);
    return null;
  } finally { await saveCfg(cfg); }
}

/** الكلام اللي ويا صورة الحل: يكتبه صاحب البوت، والخط العريض <b> بس */
export const replyText = (template: string) => esc(template).replace(/&lt;(\/?b)&gt;/g, "<$1>");

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
    // PDF اسمه «2-ar-main.pdf» (يطلعه البرنامج من Word): ينضاف للملزمة اللي نصها مرفوع، حتى صور الحل تطلع منه
    const key = /^(\d)-(ar|en)-(main|extra|exams)\.pdf$/i.exec(String((f as File).name ?? "").trim());
    if (key) {
      const list = await booklets();
      const b = list.find((x) => x.chapter === Number(key[1]) && x.lang === key[2].toLowerCase() && x.kind === key[3].toLowerCase());
      need(b, `ارفع ملف «الملازم.json» أول، بعدين ملفات الـ PDF`);
      // رقم جديد للملزمة حتى صور الصفحات القديمة ما تنستعمل
      const id = randomUUID().slice(0, 8);
      const text = await files().read(`booklets/${b!.id}.json`);
      if (text) await files().write(`booklets/${id}.json`, text, "application/json");
      await files().write(`booklets/${id}.pdf`, buf, "application/pdf");
      Object.assign(b!, { id, pdf: true });
      await saveBooklets(list);
      return { ...await pageData(), notice: `✅ انرفع PDF ${KIND_LABEL[b!.kind]} الفصل ${b!.chapter} (${b!.lang === "ar" ? "عربي" : "إنجليزي"})` };
    }
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
    const b: Booklet = { id, chapter, lang, kind: kind!, name: String(body.name ?? "").slice(0, 80) || `${KIND_LABEL[kind!]} الفصل ${chapter}`, pages: pages.length, lectures: findLectures(pages), created: new Date().toISOString().slice(0, 16).replace("T", " "), pdf: true };
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
