// ملازم الطلاب: صاحب البوت يرفع PDF (أكثر من ملزمة للفصل)، واللي اشترى الفصل (محاضرات أو امتحانات) تطلعله.
// الطالب يكتب فوك الصفحات وكتابته تنحفظ إله بس. ملف الـ PDF ما يوصل للطالب أبد: كل صفحة تطلع صورة عليها اسمه ورقمه،
// وتنفتح بس من تلگرام الموبايل وعلى جهازه، وتنقفل وقت الامتحان
import { bookToc } from "./noteToc.ts";
import { pdfjsLib } from "./pdfjs.ts";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { boughtCourse, guardianOf, logActivity } from "./access.ts";
import { find, insert, one, put, remove, type Row } from "./db.ts";
import { isAdmin, student } from "./data.ts";
import { checkDevice, checkPhone } from "./deviceLock.ts";
import { LOCK_TEXT, examInProgress } from "./examLock.ts";
import { files } from "./files.ts";
import { addVideo, autoMarks, bookMarksAdmin, deleteMark, deleteVideo, explainerClip, marksFor, pasteSolutions, saveMark, sendMark, videoList } from "./noteMarks.ts";
import { chapterLabel, firstRoundOnly } from "./orderRules.ts";
import { labelChapters } from "./scheduleRules.ts";
import { stamp } from "./util.ts";
import { authed, ensure, need } from "./webApi.ts";
import { homeToken, verifyHomeToken } from "./webAuth.ts";

// حد طلبات Cloud Run حوالي 32 ميگا
const PDF_MAX = 30 * 1024 * 1024;
const INK_MAX = 400_000;
const PAGE_WIDTH = 1400;
const OLD_LINK = "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد";

/** الفصول اللي اكتمل شراءها، محاضرات أو امتحانات: بيع المكتبة فوراً، والتوصيل بعد ما الطالب يقرا كود الوصل. غيرها ما يفتح شي */
export async function ownedChapters(uid: number): Promise<string[]> {
  const st = await student(uid);
  if (!st) return [];
  const out = new Set<string>();
  for (const r of await find("exam_access", { user_id: uid })) for (const c of labelChapters(String(r.chapter))) out.add(c);
  const orders = await find("orders", { user_id: uid }, { where: (o) => (o.printed === 1 || o.printed === 3) && String(o.created) >= String(st.created) });
  for (const o of orders) {
    if (o.printed === 1 && !(await one("order_codes", { order_id: o.id }))?.used_at) continue;
    for (const it of JSON.parse(o.items || "[]") as Row[]) {
    if (!firstRoundOnly(it.name)) continue;
    const label = chapterLabel(it.name)?.replace("الاول", "الأول");
    if (label) for (const c of labelChapters(label)) out.add(c);
    }
  }
  return [...out];
}
const byOrder = (a: Row, b: Row) => (a.ord ?? a.id) - (b.ord ?? b.id) || a.id - b.id;
/** ملازم الطالب حسب فصوله ومنهجه. صاحب البوت يشوف كلها حتى يجرب */
export async function myBooks(uid: number): Promise<Row[]> {
  const all = (await find("note_books")).sort(byOrder);
  if (await isAdmin(uid)) return all;
  const chapters = new Set(await ownedChapters(uid));
  if (!chapters.size) return [];
  const lang = (await student(uid))?.curr === "إنجليزي" ? "en" : "ar";
  return all.filter((b) => chapters.has(b.chapter) && (b.lang === "all" || b.lang === lang));
}
export const hasBooks = async (uid: number) => (await myBooks(uid)).length > 0;

async function studentUid(token: unknown, pf: unknown) {
  await ensure();
  const uid = verifyHomeToken(token);
  need(uid !== null, OLD_LINK, 401);
  await checkPhone(uid!, pf);
  need(!await examInProgress(uid!), LOCK_TEXT, 423);
  if (!await isAdmin(uid!)) need(!await boughtCourse(uid!) || await guardianOf(uid!), "اربط ولي أمرك أول، من القائمة الرئيسية", 403);
  return uid!;
}
async function myBook(uid: number, id: unknown) {
  const b = (await myBooks(uid)).find((x) => x.id === Number(id));
  need(b, "هذي الملزمة مو ضمن فصولك", 403);
  return b!;
}
const pageOf = (b: Row, raw: unknown) => {
  const n = Number(raw);
  need(Number.isInteger(n) && n >= 1 && n <= b.pages, "الصفحة غير موجودة");
  return n;
};

// ---------- الطالب
export async function noteAction(body: Row) {
  const uid = await studentUid(body?.token, body?.pf);
  await checkDevice(uid, body.device);
  const a = String(body.action ?? "");
  if (a === "list") {
    const books = await myBooks(uid);
    const marks = new Map((await find("note_bookmarks", { user_id: uid })).map((m) => [m.book_id as number, m.page as number]));
    return { books: books.map((b) => ({ id: b.id, title: b.title, chapter: b.chapter, pages: b.pages, kind: b.kind ?? "book", saved: marks.get(b.id) ?? 0 })) };
  }
  const b = await myBook(uid, body.book);
  // 📑 المواضيع: الموضوع، وبعده المحاضرة (أو السؤال بالراصد)، ويا رقم صفحتها
  if (a === "toc") return { toc: await bookToc(b) };
  // 🔖 الصفحة اللي وصلها: يحفظها من يطلع، ومن يرجع يدوس عليها ويروح لها
  if (a === "bookmark") {
    const page = pageOf(b, body.page);
    await put("note_bookmarks", { user_id: uid, book_id: b.id, page, at: new Date().toISOString() });
    return { saved: page };
  }
  if (a === "open") { await logActivity(uid, `📘 فتح ملزمة ${b.title}`); return { ok: true, marks: await marksFor(b.id) }; }
  if (a === "marks") return { marks: await marksFor(b.id) };
  // الفيديو ما اشتغل عند الطالب: رمز الخطأ ينكتب بسجل السيرفر حتى نعرف السبب
  if (a === "videoError") { console.warn("note video failed:", JSON.stringify({ uid, book: b.id, kind: String(body.kind ?? "").slice(0, 10), code: String(body.code ?? "").slice(0, 80), pf: String(body.pf ?? "").slice(0, 20) })); return { ok: true }; }
  if (a === "play") {
    limitPlays(uid);
    const r = await sendMark(uid, b.id, body.mark, body.kind);
    await logActivity(uid, `${body.kind === "solution" ? "🎬 فيديو حل" : "▶️ فيديو توضيح"} من ملزمة ${b.title}`);
    return r;
  }
  const page = pageOf(b, body.page);
  const key = { user_id: uid, book_id: b.id, page };
  if (a === "ink") return { ink: (await one("note_ink", key))?.ink ?? "" };
  need(a === "save", "أمر غير معروف");
  const ink = String(body.ink ?? "");
  need(ink.length <= INK_MAX, "الكتابة بهاي الصفحة صارت هواية. امسح شوية منها", 413);
  let items: unknown = null, notes: unknown = [];
  try { const d = JSON.parse(ink); items = d.items; notes = d.notes ?? []; } catch { /* يترفض جوة */ }
  need(Array.isArray(items), "الكتابة ما انحفظت، حاول مرة ثانية");
  // 📝 الملاحظات اللاصقة تنحفظ ويا الكتابة بنفس الصفحة
  need(Array.isArray(notes) && notes.length <= 30 && (notes as Row[]).every((x) => x && typeof x.t === "string" && x.t.length <= 300 && Number(x.x) >= 0 && Number(x.x) <= 1 && Number(x.y) >= 0 && Number(x.y) <= 1 && (x.s === undefined || (Array.isArray(x.s) && x.s.length <= 150 && (x.s as Row[]).every((k) => k && Array.isArray(k.p) && k.p.length <= 4000 && (k.c === undefined || String(k.c).length <= 20)))) && String(x.c ?? "").length <= 10 && String(x.b ?? "").length <= 10), "الملاحظات بهاي الصفحة هواية. امسح شوية منها", 413);
  if ((items as unknown[]).length || (notes as unknown[]).length) await put("note_ink", { ...key, ink });
  else await remove("note_ink", key);
  return { ok: true };
}

/** صورة الصفحة بدون العلامة: تنرسم من الـ PDF أول مرة، وبعدها جاهزة */
// الراصد: إله ملف ثاني بنفس عدد الصفحات، كل صفحة بيه الحل النموذجي لسؤال صفحته
async function cleanPage(b: Row, n: number, sol = false): Promise<Buffer | null> {
  const ref = `notes/${b.file}/${sol ? "s" : "p"}${n}.jpg`;
  const cached = await files().read(ref);
  if (cached) return cached;
  const pdf = await files().read(`notes/${b.file}${sol ? ".sol" : ""}.pdf`);
  if (!pdf) return null;
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  if (n > doc.numPages) return null;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: PAGE_WIDTH / page.getViewport({ scale: 1 }).width });
  const factory = (doc as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: { encode: (f: string, q: number) => Promise<Buffer> }; context: unknown } } }).canvasFactory;
  const cc = factory.create(viewport.width, viewport.height);
  await page.render({ canvas: cc.canvas as never, canvasContext: cc.context as never, viewport }).promise;
  const jpg = Buffer.from(await cc.canvas.encode("jpeg", 82));
  await task.destroy();
  await files().write(ref, jpg, "image/jpeg");
  return jpg;
}
let fontReady = false;
/** اسم الطالب ورقمه يتطبعون بالصورة نفسها: إذا تسربت صورة، تبين من ياهو الطالب */
export async function watermark(jpg: Buffer, name: string, uid: number, header?: "ar" | "en") {
  const { createCanvas, loadImage, GlobalFonts } = await import("@napi-rs/canvas");
  if (!fontReady) {
    const p = path.join(process.cwd(), "assets", "fonts", "NotoSansArabic-Bold.ttf");
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, "QArabic");
    fontReady = true;
  }
  const im = await loadImage(jpg);
  const c = createCanvas(im.width, im.height);
  const g = c.getContext("2d");
  g.drawImage(im, 0, 0);
  const size = Math.round(im.width / 34);
  g.font = `bold ${size}px QArabic`;
  g.textAlign = "center"; g.textBaseline = "middle";
  const text = `${name}  ${uid}`;
  // شفاف كلش وبثلث أماكن بس (فوك، النص، جوه)، حتى ما يخرب شكل الملزمة، وبعده يبين إذا أحد صوّر الصفحة
  g.fillStyle = "rgba(30,60,120,.06)";
  for (const [fx, fy] of [[0.3, 0.2], [0.5, 0.52], [0.7, 0.84]]) {
    g.save();
    g.translate(im.width * fx, im.height * fy);
    g.rotate(-Math.PI / 6);
    g.fillText(text, 0, 0);
    g.restore();
  }
  // صفحة الراصد: اسم الطالب ورقمه بالزاوية الفاضية من الهدر (يسار الهدر العربي، يمين الإنجليزي)
  if (header) {
    g.fillStyle = "#ffffff"; g.textBaseline = "middle"; g.textAlign = header === "ar" ? "left" : "right";
    const x = header === "ar" ? im.width * 0.04 : im.width * 0.96;
    // الهدر رفيع (5% من الصفحة): الاسم بسطر، والرقم تحته
    g.font = `bold ${Math.round(im.width / 52)}px QArabic`;
    g.fillText(name, x, im.height * 0.018);
    g.font = `bold ${Math.round(im.width / 66)}px QArabic`;
    g.fillStyle = "#ffb26b";
    g.fillText(`#${uid}`, x, im.height * 0.038);
  }
  return Buffer.from(await c.encode("jpeg", 82));
}
// حد للصفحات بالدقيقة، حتى ما أحد يسحب الملزمة كلها أو يشغل السيرفر عن غيره
// الملزمة تنسحب مثل الـ PDF وتحمل الصفحة اللي قدامه وثنتين قبلها وثنتين بعدها، فالحد أوسع شوية
const PAGE_LIMIT = 120;
const pageHits = new Map<number, number[]>();
function limitPages(uid: number, now = Date.now()) {
  if (pageHits.size > 10_000) pageHits.clear();
  const hits = (pageHits.get(uid) ?? []).filter((t) => now - t < 60_000);
  need(hits.length < PAGE_LIMIT, "قلبت هواية صفحات، انتظر دقيقة", 429);
  pageHits.set(uid, [...hits, now]);
}
// الفيديوهات: حد بالدقيقة حتى ما أحد يكرر الدوس
const playHits = new Map<number, number[]>();
function limitPlays(uid: number, now = Date.now()) {
  if (playHits.size > 10_000) playHits.clear();
  const hits = (playHits.get(uid) ?? []).filter((t) => now - t < 60_000);
  need(hits.length < 10, "دزيت هواية فيديوهات، انتظر دقيقة", 429);
  playHits.set(uid, [...hits, now]);
}
export async function notePage(token: unknown, book: unknown, rawPage: unknown, pf: unknown, device?: unknown, sol?: unknown) {
  const uid = await studentUid(token, pf);
  await checkDevice(uid, device);
  limitPages(uid);
  const b = await myBook(uid, book);
  const rasid = b.kind === "rasid";
  need(!sol || rasid, "هاي الملزمة ما بيها حل نموذجي", 404);
  const jpg = await cleanPage(b, pageOf(b, rawPage), !!sol);
  need(jpg, "الصفحة غير موجودة", 404);
  return await watermark(jpg!, String((await student(uid))?.name ?? ""), uid, rasid && !sol ? (b.lang === "en" ? "en" : "ar") : undefined);
}

/** الفيديو التوضيحي يشتغل جوّا الملزمة: نفس شروط الصفحة (رابطه، جهازه، فصوله) */
export async function noteVideo(token: unknown, book: unknown, mark: unknown, pf: unknown, device?: unknown) {
  const uid = await studentUid(token, pf);
  await checkDevice(uid, device);
  const b = await myBook(uid, book);
  return await explainerClip(b.id, mark);
}

// ---------- صاحب البوت
async function adminData(uid: number, notice = "") {
  const seen = new Set<string>();
  const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  for (const e of exams) if (e.chapter) seen.add(String(e.chapter));
  const books = (await find("note_books")).sort(byOrder);
  for (const b of books) seen.add(String(b.chapter));
  return { chapters: [...seen], books: books.map((b) => ({ id: b.id, title: b.title, chapter: b.chapter, lang: b.lang, pages: b.pages, kind: b.kind ?? "book", created: b.created })), videos: await videoList(), link: `/store/notes?t=${encodeURIComponent(homeToken(uid))}`, notice };
}
export async function noteAdmin(raw: Row | FormData) {
  const body: Row = raw instanceof FormData ? Object.fromEntries([...raw.entries()]) : raw;
  const uid = await authed(body.initData, "owner");
  const a = String(body.action ?? "");
  if (a === "list") return await adminData(uid);
  if (a === "upload") {
    const f = body.file;
    need(f instanceof Blob && f.size > 0, "اختار ملف PDF");
    need((f as Blob).size <= PDF_MAX, "الملف كبير، أكثر شي 30 ميگا");
    const title = String(body.title ?? "").trim().slice(0, 80);
    need(title, "اكتب اسم الملزمة");
    const chapter = String(body.chapter ?? "");
    need(chapter.startsWith("الفصل"), "اختار الفصل");
    const lang = ["ar", "en", "all"].includes(String(body.lang)) ? String(body.lang) : "all";
    const buf = Buffer.from(await (f as Blob).arrayBuffer());
    need(buf.subarray(0, 4).toString() === "%PDF", "لازم ملف PDF");
    // إذا ما انقرا الملف، السبب يطلع بالشاشة بدل «صار خطأ»
    let pages = 0;
    try {
      const pdfjs = await pdfjsLib();
      const task = pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 });
      pages = (await task.promise).numPages;
      await task.destroy();
    } catch (e) { console.error("note upload:", e); need(false, `ما گدرت أقرا ملف الـ PDF (${String((e as Error)?.message ?? e).slice(0, 160)}). صور هاي الرسالة ودزها`); }
    // 📝 الراصد: ويا ملف الصفحات ملف الحلول النموذجية، بنفس عدد الصفحات (حل كل صفحة بنفس رقمها)
    const kind = body.kind === "rasid" ? "rasid" : "book";
    let sol: Buffer | null = null;
    if (kind === "rasid") {
      const s = body.sol;
      need(s instanceof Blob && s.size > 0, "اختار ملف الحلول النموذجية PDF");
      need((s as Blob).size <= PDF_MAX, "ملف الحلول كبير، أكثر شي 30 ميگا");
      sol = Buffer.from(await (s as Blob).arrayBuffer());
      need(sol.subarray(0, 4).toString() === "%PDF", "ملف الحلول لازم PDF");
      let solPages = 0;
      try { const pdfjs = await pdfjsLib(); const task = pdfjs.getDocument({ data: new Uint8Array(sol), verbosity: 0 }); solPages = (await task.promise).numPages; await task.destroy(); }
      catch (e) { need(false, `ما گدرت أقرا ملف الحلول (${String((e as Error)?.message ?? e).slice(0, 160)})`); }
      need(solPages === pages, `ملف الحلول بيه ${solPages} صفحة وملف الراصد ${pages}. لازم نفس العدد`);
    }
    const file = randomUUID().slice(0, 12);
    await files().write(`notes/${file}.pdf`, buf, "application/pdf");
    if (sol) await files().write(`notes/${file}.sol.pdf`, sol, "application/pdf");
    await insert("note_books", { title, chapter, lang, file, pages, kind, created: stamp() });
    return await adminData(uid, `✅ انرفع${kind === "rasid" ? " الراصد" : "ت"} «${title}»: ${pages} صفحة`);
  }
  if (a === "videoUpload") {
    need(body.file instanceof Blob, "اختار فيديو");
    return await adminData(uid, await addVideo(body.file as Blob & { name?: string }));
  }
  if (a === "videoDelete") return await adminData(uid, await deleteVideo(Number(body.id)));
  if (["marks", "autoMarks", "markSave", "markDelete", "solutionsPaste"].includes(a)) {
    const book = await one("note_books", { id: Number(body.book) });
    need(book, "الملزمة غير موجودة");
    let notice = "";
    if (a === "autoMarks") { const r = await autoMarks(book!); notice = `✅ انحطت ${r.marks} زر على الأسئلة، وانربط ${r.linked} فيديو توضيحي`; }
    if (a === "markSave") { await saveMark(book!, body); notice = "💾 انحفظ"; }
    if (a === "markDelete") { await deleteMark(book!, Number(body.id)); notice = "🗑 انحذف الزر"; }
    if (a === "solutionsPaste") { const r = await pasteSolutions(book!, String(body.text ?? "")); notice = `✅ انربط ${r.linked} سؤال بفيديو حله${r.added ? `، وانضاف ${r.added} زر جديد` : ""}${r.bad.length ? `. ⚠️ ${r.bad.length} سطر ما انفهم: ${r.bad.slice(0, 3).join(" | ")}` : ""}`; }
    return { ...await adminData(uid, notice), marks: await bookMarksAdmin(book!.id), book: book!.id };
  }
  need(a === "delete", "أمر غير معروف");
  const id = Number(body.id);
  need(await one("note_books", { id }), "الملزمة غير موجودة");
  await remove("note_ink", { book_id: id });
  await remove("note_marks", { book_id: id });
  await remove("note_bookmarks", { book_id: id });
  await remove("note_books", { id });
  return await adminData(uid, "🗑 انحذفت");
}
