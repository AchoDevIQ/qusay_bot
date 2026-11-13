// أزرار داخل الملزمة: يم كل سؤال «🎬 فيديو حل السؤال» (فيديو الأستاذ من قناته) و«▶️ فيديو توضيح السؤال» (الفيديو المتحرك).
// الفيديو يشتغل جوّا الملزمة (فيديو الحل من يوتيوب، والتوضيحي من البوت)، والرابط ما يطلعله أبد. فيديو حل من منشور بالقناة يوصل بالبوت محمي.
// الأزرار تنحط وحدها: كل سطر يبدي بـ «س1» أو «Q1» أو «مثال» زر، والفيديوهات التوضيحية تدور سؤالها بكلماته.
// صاحب البوت يعدل كل زر (الرابط، الفيديو، الصفحة والمكان) ويحذف الفيديو اللي ما يعجبه.
import { pdfjsLib } from "./pdfjs.ts";
import { randomUUID } from "node:crypto";
import { find, insert, one, remove, update, type Row } from "./db.ts";
import { files } from "./files.ts";
import { api, upload } from "./telegram.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const VIDEO_MAX = 30 * 1024 * 1024;

/** كل فيديو توضيحي وكلمات سؤاله بالملزمة العربية والإنجليزية (أول سطر يطابق) */
const CATALOG: { name: string; ar: RegExp; en: RegExp }[] = [
  { name: "الخزان المتسرب", ar: /خزان.{0,6}شكل متوازي/, en: /Polyhedron tank/i },
  { name: "متوازي مستطيلات حجمه 640", ar: /القاعدة بمعدل ?\(0\.4\)/, en: /rate of 0\.4 ?cm\/s find the rate of change of height/i },
  { name: "متوازي مستطيلات حجمه 48", ar: /قاعدته ?بمعدل ?\(0\.5\)|يزداد طول ?ضلع ?قاعدته/, en: /rate of 0\.5 ?cm\/s find the rate of change of height/i },
  { name: "متوازي مستطيلات يتمدد بالحرارة", ar: /يتمدد بالحرارة/, en: /parallel ?piped whose base is square/i },
  { name: "أبعاد قطعة المعدن", ar: /قطعه من المعدن/, en: /piece ?of ?metal in the shape/i },
  { name: "المستطيل والدائرة", ar: /مستطيل مساحته ?30/, en: /rectangle ?whose area 30/i },
  { name: "نقط الدائرة وزاري 1", ar: /اكي تنتم ?4x=4|الدائرة ?4x=4/, en: /circle x² ?\+ ?y² ?- ?4x ?= ?4/i },
  { name: "نقط الدائرة وزاري 2", ar: /مجموعه النقاط/, en: /circle ?\(x- ?3\)/i },
  { name: "نقط المنحني اثرائي 1", ar: /يساوي ضعف معدل تغي/, en: /is twice the/i },
  { name: "نقطة تتحرك على المنحني", ar: /تتحرك نقطه (?:عىل|على) ?المنح/, en: /point moving on the curve ?y/i },
  { name: "جسم يتحرك على المنحني", ar: /جسم يتحرك (?:عىل|على) ?المنح/, en: /body is moving on the curve X/i },
  { name: "السلم والزاوية", ar: /س ?1 ?[:/]? ?(?:سلم )?يستند طرفه الاسفل/, en: /Q ?1 ?\/ ?A ladder leans/i },
  { name: "سلم طوله 13 متر", ar: /سلم طوله ?13m/, en: /ladder with 13 ?m length/i },
  { name: "القطار والشجرة", ar: /قطار ذو عربة/, en: /train with one/i },
  { name: "السيارة والإشارة المرورية", ar: /اجتازت اشارة مرورية/, en: /red traffic light/i },
  { name: "الصقر والأرنب", ar: /وقف صقر/, en: /falcon standing/i },
  { name: "سيارتان شرق وشمال", ar: /سيارتان السياره/, en: /Two cars were moving/i },
  { name: "الفنار وظل السفينة", ar: /فنار ميناء/, en: /light ?house of a Port/i },
  { name: "المصباح والشخص ثلاث مطاليب", ar: /مصباح (?:عىل|على) إرتفاع ?10m/, en: /pole of length \(10 ?m\)/i },
  { name: "راس الرجل والمصباح", ar: /عمود طوله ?\(8\)/, en: /pole of length 8 ?m/i },
  { name: "المرشح والحنفية", ar: /مرشح (?:عىل|على) شكل مخروط دائري قائم قاعدته افقية/, en: /Q ?29 ?\/ ?A conical filter/i },
  { name: "مرشح زاويته الرأسية 60", ar: /مرشح وراسه اىل االسفل|مرشح ?مخروطي محوره شاقولي/, en: /conical filter whose axis is vertical/i },
  { name: "كومة الرمال", ar: /رمال تنهال/, en: /Sand heaped on the ground/i },
  { name: "مخروط قاعدته تتمدد", ar: /كانت قاعدته الدائرية/, en: /if its circular ba/i },
  { name: "رمل يتساقط من منحدر", ar: /يتساقط رمل من منحدر/, en: /Sand is falling from a cleft/i },
  { name: "مخروط محيط قاعدته يتغير", ar: /كان محيط قاعدته/, en: /If ?the ?Perimeter ?of its/i },
  { name: "كرة مغطاة بالجليد", ar: /كرة صلده قطرها/, en: /solid sphere whose diameter/i },
  { name: "بالون نسبة الحجم إلى القطر", ar: /كانت النسبة بي بالون كروي|يتسرب منه الغاز فإذا كانت النسبة/, en: /which has a hole/i },
  { name: "أسطوانة حجمها ثابت", ar: /أسطوانة دائرية قائمة يزداد ارتفاعها/, en: /circular cylinder its height increases/i },
  { name: "أسطوانة يصب فيها ماء", ar: /أسطوانة دائرية قائمة يصب فيها ماء/, en: /cylinder in which water is poured/i },
  { name: "صفيحة المثلث", ar: /صفيحه على شكل مثلث/, en: /sheet in a shape of isosceles/i },
  { name: "غاز يندفع داخل البالون", ar: /يندفع غاز داخل بالون/, en: /gas is filled into a spherical balloon/i },
  { name: "مكعب الثلج", ar: /ينصهر مكعب من الثلج/, en: /An ice cube melts/i },
  { name: "السلم المنزلق", ar: /سلم طوله\s*\(?\s*10/, en: /ladder with 10 ?m/i },
  { name: "طريقان متعامدان", ar: /طريقان متعامدان/, en: /Two perpendicular roads/i },
  { name: "البالون المتصاعد", ar: /يتصاعد بالون/, en: /balloon \(?mounting/i },
  { name: "العمود وظل الرجل", ar: /عمود طوله\s*\(?\s*7\.2/, en: /pole of length 7\.2/i },
  { name: "حادلة التبليط", ar: /حادلة تبليط/, en: /paving ?truck/i },
  { name: "المرشح المخروطي", ar: /مرشح مخروط/, en: /conical filter/i },
  { name: "كومة الرمل", ar: /رمل ناعم/, en: /Sand is leaking/i },
  { name: "مكعب مغطى بالجليد", ar: /مكعب صلد/, en: /solid cube/i },
  { name: "بالون يتسرب منه الغاز", ar: /س\s*3\s*[/:]?\s*بالون كروي مملوء بالغاز/, en: /Q\s*3\s*\/\s*A spherical balloon filled with gas/i },
  { name: "أرض يحدها نهر", ar: /يحدها نهر/, en: /bounded by a river/i },
  { name: "التقريب بالمماس", ar: /جد تقريبا/, en: /Find approximation/i },
  { name: "مبرهنة رول", ar: /تعينها/, en: /defined by Rolle/i },
  { name: "مبرهنة القيمة المتوسطة", ar: /برهن\s*ان\s*ال?دالة.{0,30}1,7\]/, en: /Prove that the function f\(x\)\s*=\s*x/i },
  { name: "سلك يصير دائرة ومربع", ar: /سلك طوله ?60 ?cm/, en: /A wire of length 60 ?cm/i },
  // رسم الدوال: سطور الحل بالملزمة (ما تبدي بـ «س»، فالزر ينحط على السطر نفسه)
  { name: "رسم الدوال وزاري 1", ar: /^1\) ?f\(x\) ?= ?\( ?x ?- ?1 ?\)$/, en: /^1\) ?f\(x\) ?= ?\( ?x ?- ?1 ?\)$/ },
  { name: "رسم الدوال وزاري 2", ar: /^2 ?\/ ?f\(x\) ?= ?x ?\+ ?3x$/, en: /^2 ?\/ ?f\(x\) ?= ?x ?\+ ?3x$/ },
  { name: "رسم الدوال وزاري 3", ar: /^3 ?\/ ?f\(x\) ?= ?6x ?[–-] ?2x$/, en: /^3 ?\/ ?f\(x\) ?= ?6x ?[–-] ?2x$/ },
  { name: "رسم الدوال وزاري 4", ar: /^4 ?\/ ?f\(x\) ?= ?x ?[–-] ?3x$/, en: /^4 ?\/ ?f\(x\) ?= ?x ?[–-] ?3x$/ },
  { name: "رسم الدوال وزاري المحاضرة6 1", ar: /^1 ?\/ ?f\(x\) ?=$/, en: /^1 ?\/ ?f\(x\) ?=$/ },
];
const Q_AR = /^\s*(س\s*\d+\s*[:/：-]?|مثال\s*\d*)/;
const Q_EN = /^\s*(Q\s*\d+\s*[/:.-]|Example\s*\d*)/i;

/** اسم الفيديو من اسم ملفه: «السلم_المنزلق_English_عربي.mp4» ← السلم المنزلق، إنجليزي */
export function videoName(fname: string) {
  const base = fname.replace(/\.[a-z0-9]+$/i, "");
  const lang = /English|انجليزي|إنجليزي|_en$/i.test(base) ? "en" : "ar";
  const name = base.replace(/_?(English|عربي|انجليزي|إنجليزي|ar|en)(?=_|$)/gi, "").replace(/_+/g, " ").trim();
  return { name: name || base, lang };
}

/** رابط منشور القناة: t.me/c/123/45 (خاصة)، أو t.me/name/45 (عامة) */
export function parseLink(raw: string): { chat: string; msg: number } | null {
  const s = raw.trim();
  let m = /^(?:https?:\/\/)?t\.me\/c\/(\d+)\/(?:\d+\/)?(\d+)(?:[/?#].*)?$/i.exec(s);
  if (m) return { chat: `-100${m[1]}`, msg: Number(m[2]) };
  m = /^(?:https?:\/\/)?t\.me\/([a-z][\w]{3,})\/(\d+)(?:[/?#].*)?$/i.exec(s);
  if (m && m[1].toLowerCase() !== "c") return { chat: `@${m[1]}`, msg: Number(m[2]) };
  return null;
}

/** رقم فيديو اليوتيوب: youtu.be/ID، youtube.com/watch?v=ID، shorts، embed، live */
export function parseYouTube(raw: string): string | null {
  const s = raw.trim();
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})(?:[?&#/].*)?$/i.exec(s);
  return m ? m[1] : null;
}

/** سطور كل صفحة ومكانها من فوك (0 فوك، 1 جوه) */
async function pageLines(pdf: Buffer) {
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const out: { page: number; y: number; text: string }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const h = p.getViewport({ scale: 1 }).height;
    const rows: { y: number; text: string }[] = [];
    for (const it of (await p.getTextContent()).items as { str?: string; transform?: number[] }[]) {
      if (!it.str || !it.transform) continue;
      const y = it.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (row) row.text += it.str; else rows.push({ y, text: it.str });
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) out.push({ page: n, y: Math.max(0, Math.min(1, 1 - r.y / h - 0.012)), text: r.text.replace(/\s+/g, " ").trim() });
  }
  await task.destroy();
  return out;
}

/** يحط الأزرار وحدها. الأزرار اللي عدلها صاحب البوت تبقى، والتلقائية تنعاد. يرجع عدد الأزرار والفيديوهات اللي انربطت */
export async function autoMarks(book: Row) {
  const pdf = await files().read(`notes/${book.file}.pdf`);
  need(pdf, "ملف الملزمة مو موجود");
  const lines = await pageLines(pdf!);
  const en = book.lang === "en";
  await remove("note_marks", { book_id: book.id, auto: 1 });
  const kept = await find("note_marks", { book_id: book.id });
  const near = (list: Row[], page: number, y: number, d: number) => list.find((m) => m.page === page && Math.abs(Number(m.y) - y) < d);
  const made: Row[] = [];
  for (const l of lines) {
    if (!(en ? Q_EN : Q_AR).test(l.text) || near(kept, l.page, l.y, 0.03) || near(made, l.page, l.y, 0.03)) continue;
    made.push({ book_id: book.id, page: l.page, y: l.y, label: l.text.slice(0, 60), video_id: null, solution: null, auto: 1 });
  }
  // الفيديوهات التوضيحية بلغة الملزمة: كل واحد على سؤاله (الزر اللي فوكه بنفس الصفحة، أو زر جديد)
  const videos = (await find("note_videos", { lang: en ? "en" : "ar" }));
  let linked = 0;
  for (const c of CATALOG) {
    const v = videos.find((x) => x.name === c.name);
    if (!v || [...kept, ...made].some((m) => m.video_id === v.id)) continue;
    const l = lines.find((x) => (en ? c.en : c.ar).test(x.text));
    if (!l) continue;
    const mark = [...made].filter((m) => m.page === l.page && Number(m.y) <= l.y + 0.03 && l.y - Number(m.y) < 0.12).sort((a, b) => Number(b.y) - Number(a.y))[0];
    if (mark) mark.video_id = v.id;
    else made.push({ book_id: book.id, page: l.page, y: l.y, label: l.text.slice(0, 60), video_id: v.id, solution: null, auto: 1 });
    linked++;
  }
  for (const m of made) await insert("note_marks", m);
  return { marks: made.length, linked };
}

const pub = (m: Row) => ({ id: m.id as number, page: m.page as number, y: Number(m.y), video: !!m.video_id, solution: !!m.solution });
/** أزرار الملزمة للطالب: مكانها وشنو بيها، بلا روابط */
export async function marksFor(bookId: number) {
  return (await find("note_marks", { book_id: bookId })).filter((m) => m.video_id || m.solution).sort((a, b) => a.page - b.page || Number(a.y) - Number(b.y)).map(pub);
}

/** زر الفيديو: فيديو الحل من يوتيوب يرجع رقمه، والفيديو التوضيحي يرجع clip، والاثنين يشتغلن جوّا الملزمة.
 *  فيديو الحل من منشور بالقناة يوصل بالبوت محمي */
export async function sendMark(uid: number, bookId: number, markId: unknown, kind: unknown): Promise<{ notice: string; yt?: string; clip?: true }> {
  const m = await one("note_marks", { id: Number(markId), book_id: bookId });
  need(m, "هذا الزر مو موجود");
  if (kind === "solution") {
    const yt = parseYouTube(String(m!.solution ?? ""));
    if (yt) return { notice: "🎬 فيديو حل السؤال", yt };
    return { notice: await sendSolution(uid, String(m!.solution ?? "")) };
  }
  if (kind === "chat") return { notice: await sendExplainer(uid, m!) };
  need(m!.video_id && await one("note_videos", { id: m!.video_id }), "الفيديو التوضيحي مو موجود لهذا السؤال");
  return { notice: "▶️ فيديو توضيح السؤال", clip: true };
}
/** احتياط: إذا الفيديو التوضيحي ما اشتغل جوّا الملزمة، يوصله بالمحادثة محمي */
async function sendExplainer(uid: number, m: Row) {
  const v = m.video_id && await one("note_videos", { id: m.video_id });
  need(v, "الفيديو التوضيحي مو موجود لهذا السؤال");
  const caption = `▶️ فيديو توضيح السؤال: ${v!.name}`;
  // أول مرة يرتفع لتلگرام، وبعدها نستعمل رقمه
  if (v!.tg) {
    const r = await api("sendVideo", { chat_id: uid, video: v!.tg, caption, protect_content: true });
    if (r) return "▶️ وصلك فيديو توضيح السؤال بالمحادثة";
  }
  const buf = await files().read(`explainers/${v!.file}.mp4`);
  need(buf, "ملف الفيديو مو موجود");
  const r = await upload("sendVideo", { chat_id: String(uid), caption, protect_content: "true", supports_streaming: "true" }, "video", buf!, `${v!.file}.mp4`, "video/mp4");
  need(r, "ما وصل الفيديو، جرب مرة ثانية", 502);
  const id = r?.video?.file_id;
  if (id) await update("note_videos", { id: v!.id }, { tg: id });
  return "▶️ وصلك فيديو توضيح السؤال بالمحادثة";
}
// آخر الفيديوهات اللي انقرت تبقى بالذاكرة، لأن المتصفح يطلب الفيديو قطع قطع
const clipCache = new Map<string, Buffer>();
/** ملف الفيديو التوضيحي لزر بالملزمة */
export async function explainerClip(bookId: number, markId: unknown) {
  const m = await one("note_marks", { id: Number(markId), book_id: bookId });
  const v = m?.video_id && await one("note_videos", { id: m.video_id });
  need(v, "الفيديو التوضيحي مو موجود لهذا السؤال", 404);
  const key = String(v!.file);
  let buf = clipCache.get(key);
  if (!buf) {
    buf = (await files().read(`explainers/${key}.mp4`)) ?? undefined;
    need(buf, "ملف الفيديو مو موجود", 404);
    clipCache.set(key, buf!);
    while (clipCache.size > 6) clipCache.delete(clipCache.keys().next().value!);
  }
  return buf!;
}
async function sendSolution(uid: number, link: string) {
  const l = parseLink(link);
  need(l, "فيديو الحل بعده ما انضاف لهذا السؤال");
  const r = await api("copyMessage", { chat_id: uid, from_chat_id: l!.chat, message_id: l!.msg, protect_content: true });
  need(r, "ما گدرت أوصل فيديو الحل. بلغ الأستاذ", 502);
  return "🎬 وصلك فيديو حل السؤال بالمحادثة";
}
// ---------- صاحب البوت
export async function videoList() {
  return (await find("note_videos")).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.lang).localeCompare(String(b.lang))).map((v) => ({ id: v.id as number, name: v.name as string, lang: v.lang as string, size: v.size as number }));
}
export async function addVideo(f: Blob & { name?: string }) {
  need(f.size > 0, "اختار فيديو");
  need(f.size <= VIDEO_MAX, "الفيديو كبير، أكثر شي 30 ميگا");
  const buf = Buffer.from(await f.arrayBuffer());
  need(buf.subarray(4, 8).toString() === "ftyp", "لازم فيديو mp4");
  const { name, lang } = videoName(String(f.name ?? "فيديو"));
  const file = randomUUID().slice(0, 12);
  await files().write(`explainers/${file}.mp4`, buf, "video/mp4");
  // نفس الاسم واللغة: الجديد يبدل القديم، والأزرار تبقى عليه
  const old = await one("note_videos", { name, lang });
  if (old) { await update("note_videos", { id: old.id }, { file, tg: null, size: buf.length, created: stamp() }); return `🔁 انبدل «${name}»`; }
  await insert("note_videos", { name, lang, file, tg: null, size: buf.length, created: stamp() });
  return `✅ انرفع «${name}» (${lang === "en" ? "إنجليزي" : "عربي"})`;
}
/** يحذف الفيديو التوضيحي، ويختفي زره من الملازم (زر الحل يبقى) */
export async function deleteVideo(id: number) {
  const v = await one("note_videos", { id });
  need(v, "الفيديو مو موجود");
  for (const m of await find("note_marks", { video_id: id })) await update("note_marks", { id: m.id }, { video_id: null, auto: 0 });
  await remove("note_videos", { id });
  return `🗑 انحذف «${v!.name}»`;
}
export async function bookMarksAdmin(bookId: number) {
  return (await find("note_marks", { book_id: bookId })).sort((a, b) => a.page - b.page || Number(a.y) - Number(b.y))
    .map((m) => ({ id: m.id as number, page: m.page as number, y: Number(m.y), label: String(m.label ?? ""), video: (m.video_id as number) ?? null, solution: String(m.solution ?? "") }));
}
export async function saveMark(book: Row, body: Row) {
  const page = Number(body.page), y = Number(body.y);
  need(Number.isInteger(page) && page >= 1 && page <= book.pages, "رقم الصفحة غلط");
  need(y >= 0 && y <= 1, "المكان غلط");
  const solution = String(body.solution ?? "").trim();
  need(!solution || parseLink(solution) || parseYouTube(solution), "رابط الحل لازم يكون رابط يوتيوب، أو رابط منشور بالقناة مثل https://t.me/c/123456/78");
  const video = body.video ? Number(body.video) : null;
  if (video) need(await one("note_videos", { id: video }), "الفيديو مو موجود");
  const row = { book_id: book.id, page, y, label: String(body.label ?? "").slice(0, 80), video_id: video, solution: solution || null, auto: 0 };
  if (body.id) {
    need(await one("note_marks", { id: Number(body.id), book_id: book.id }), "الزر مو موجود");
    await update("note_marks", { id: Number(body.id) }, row);
  } else await insert("note_marks", row);
}
/** روابط حل كثيرة مرة وحدة. كل سطر: «ص22 · 0.196 · اسم السؤال · الرابط».
 *  الرابط يروح للزر اللي بنفس الصفحة وأقرب مكان، وإذا ماكو زر هناك ينضاف زر جديد */
export async function pasteSolutions(book: Row, text: string) {
  const marks = await find("note_marks", { book_id: book.id });
  let linked = 0, added = 0;
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    const m = /^ص\s*(\d+)\s*·\s*([01](?:\.\d+)?)\s*·\s*(.*?)\s*·\s*(\S+)$/.exec(s);
    const page = m ? Number(m[1]) : 0, y = m ? Number(m[2]) : -1, link = m?.[4] ?? "";
    if (!m || page < 1 || page > book.pages || y > 1 || !(parseYouTube(link) || parseLink(link))) { bad.push(s.slice(0, 40)); continue; }
    const near = marks.filter((x) => x.page === page && Math.abs(Number(x.y) - y) < 0.03).sort((a, b) => Math.abs(Number(a.y) - y) - Math.abs(Number(b.y) - y))[0];
    if (near) { await update("note_marks", { id: near.id }, { solution: link, auto: 0 }); near.solution = link; }
    else {
      const row: Row = { book_id: book.id, page, y, label: m[3].slice(0, 80), video_id: null, solution: link, auto: 0 };
      row.id = await insert("note_marks", row);
      marks.push(row);
      added++;
    }
    linked++;
  }
  need(linked || bad.length, "الصق الروابط أول");
  return { linked, added, bad };
}
export async function deleteMark(book: Row, id: number) {
  need(await one("note_marks", { id, book_id: book.id }), "الزر مو موجود");
  await remove("note_marks", { id });
}
