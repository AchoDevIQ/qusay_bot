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
export const CATALOG: { name: string; ar: RegExp; en: RegExp }[] = [
  { name: "الخزان المتسرب", ar: /خزان.{0,6}شكل متوازي/, en: /Polyhedron tank/i },
  { name: "متوازي مستطيلات حجمه 640", ar: /القاعدة بمعدل ?\(0\.4\)/, en: /increases at a rate of 0\.4 ?cm\/s/i },
  { name: "متوازي مستطيلات حجمه 48", ar: /قاعدته ?بمعدل ?\(0\.5\)|يزداد طول ?ضلع ?قاعدته/, en: /increases at a rate of 0\.5 ?cm\/s/i },
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
  { name: "المرشح والحنفية", ar: /مرشح (?:عىل|على) شكل مخروط دائري قائم قاعدته افقية/, en: /Q ?29 ?\/ ?A conical filter|A conical filter whose base is horizontal/i },
  { name: "مرشح زاويته الرأسية 60", ar: /مرشح وراسه اىل االسفل|مرشح ?مخروطي محوره شاقولي/, en: /conical filter whose axis is vertical/i },
  { name: "كومة الرمال", ar: /رمال تنهال/, en: /Sand heaped on the ground/i },
  { name: "مخروط قاعدته تتمدد", ar: /كانت قاعدته الدائرية/, en: /if its circular ba|equals 60°\.?\s*if its(?:\s|$)/i },
  { name: "رمل يتساقط من منحدر", ar: /يتساقط رمل من منحدر/, en: /Sand is falling from a cleft/i },
  { name: "مخروط محيط قاعدته يتغير", ar: /كان محيط قاعدته/, en: /If ?the ?Perimeter ?of its|equals 60°\.?\s*If the(?:\s|$)/i },
  { name: "كرة مغطاة بالجليد", ar: /كرة صلده قطرها/, en: /solid sphere whose diameter/i },
  { name: "بالون نسبة الحجم إلى القطر", ar: /كانت النسبة بي بالون كروي|يتسرب منه الغاز فإذا كانت النسبة/, en: /which has a hole/i },
  { name: "أسطوانة حجمها ثابت", ar: /أسطوانة دائرية قائمة يزداد ارتفاعها/, en: /circular cylinder its height increases/i },
  { name: "أسطوانة يصب فيها ماء", ar: /أسطوانة دائرية قائمة يصب فيها ماء/, en: /cylinder in which water is poured/i },
  { name: "صفيحة المثلث", ar: /صفيحه على شكل مثلث/, en: /sheet in a shape of isosceles/i },
  { name: "غاز يندفع داخل البالون", ar: /يندفع غاز داخل بالون/, en: /gas is filled into a spherical balloon/i },
  { name: "مكعب الثلج", ar: /ينصهر مكعب من الثلج/, en: /An ice cube melts/i },
  { name: "مستطيل المعدن وقطره", ar: /مستطيل من المعدن ينقص طوله/, en: /rectangle of metal decreases/i },
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
  { name: "رسم الدوال وزاري 1", ar: /^1\) ?f\(x\) ?= ?\( ?x ?- ?1 ?\)$/, en: /^1\)\s*f\(x\)\s*=\s*\(\s*x2?\s*-\s*1\s*\)2?$/ },
  { name: "رسم الدوال وزاري 2", ar: /^2 ?\/ ?f\(x\) ?= ?x ?\+ ?3x$/, en: /^2\s*\/\s*f\(x\)\s*=\s*x3?\s*\+\s*3x2?$/ },
  { name: "رسم الدوال وزاري 3", ar: /^3 ?\/ ?f\(x\) ?= ?6x ?[–-] ?2x$/, en: /^3\s*\/\s*f\(x\)\s*=\s*6x\s*[–-]\s*2x3?$/ },
  { name: "رسم الدوال وزاري 4", ar: /^4 ?\/ ?f\(x\) ?= ?x ?[–-] ?3x$/, en: /^4\s*\/\s*f\(x\)\s*=\s*x3?\s*[–-]\s*3x$/ },
  { name: "رسم الدوال وزاري المحاضرة6 1", ar: /^1 ?\/ ?f\(x\) ?=$/, en: /^1\s*\/\s*f\(x\)\s*=(?:\s*1\s*\/\s*f\(x\)\s*=)?$/ },
  // رسم الدوال، الواجب (أسئلة الكتاب): 1–8 كثيرة حدود، 9–15 كسرية
  ...[
    { n: 1, re: /^1 ?\/ ?f\(x\) ?= ?x$/ },
    { n: 2, re: /^2 ?\/ ?f\(x\) ?= ?10 ?- ?3x ?- ?x$/ },
    { n: 3, re: /^3 ?\/ ?f\(x\) ?= ?\( ?1 ?- ?x ?\) ?\+ ?1$/ },
    { n: 4, re: /^4 ?\/ ?f\(x\) ?= ?2x ?- ?x$/ },
    { n: 5, re: /^5 ?\/ ?f\(x\) ?= ?6x ?- ?x$/ },
    { n: 6, re: /^6 ?\/ ?f\(x\) ?= ?x ?\+ ?4x ?\+ ?3$/ },
    { n: 7, re: /^7 ?\/ ?f\(x\) ?= ?x ?- ?3x ?\+ ?4$/ },
    { n: 8, re: /^8 ?\/ ?f\(x\) ?= ?\( ?x ?\+ ?2 ?\) ?\( ?x ?- ?1 ?\)$/ },
    { n: 9, re: /^9 ?\/ ?f\(x\) ?=$/ },
    { n: 10, re: /^10 ?\/ ?f\(x\) ?=$/ },
    { n: 11, re: /^11 ?\/ ?f\(x\) ?=$/ },
    { n: 12, re: /^12 ?\/ ?yx ?= ?1/ },
    { n: 13, re: /^13 ?\/ ?f\(x\) ?=$/ },
    { n: 14, re: /^14 ?\/ ?f\(x\) ?=$/ },
    { n: 15, re: /^15 ?\/ ?f\(x\) ?=$/ },
  ].map(({ n, re }) => ({ name: `رسم الدوال واجب ${n}`, ar: re, en: re })),
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

// ---------- الملزمة تبدلت بنسخة جديدة وصفحاتها تحركت: كل سطر بالقديمة نلگاه بالجديدة، فالأزرار وكتابة الطلاب تمشي وياه
type Line = { page: number; y: number; text: string };
const lineKey = (t: string) => t.replace(/\s+/g, "");
/** لكل سطر بالملزمة القديمة: رقمه بالجديدة (أو -1 إذا انشال). السطور اللي ما تتكرر بالملفين هي المراسي،
 *  وبين كل مرساتين نطابق نفس الكلام بنفس الترتيب */
export function alignLines(oldL: Line[], newL: Line[]): number[] {
  const count = (l: Line[]) => { const m = new Map<string, number[]>(); l.forEach((x, i) => { const k = lineKey(x.text); if (k) m.set(k, [...(m.get(k) ?? []), i]); }); return m; };
  const a = count(oldL), b = count(newL);
  const pairs: [number, number][] = [];
  for (const [k, is] of a) { const js = b.get(k); if (is.length === 1 && js?.length === 1) pairs.push([is[0], js[0]]); }
  pairs.sort((x, y) => x[0] - y[0]);
  // أطول تسلسل يمشي بنفس الترتيب بالملفين (سطر انقلب مكانه ما يصير مرساة)
  const tails: number[] = [], prev: number[] = new Array(pairs.length).fill(-1);
  pairs.forEach(([, j], i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    if (lo) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const anchors: [number, number][] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) anchors.unshift(pairs[i]);
  const out = new Array(oldL.length).fill(-1);
  const bounds: [number, number][] = [[-1, -1], ...anchors, [oldL.length, newL.length]];
  for (let s = 0; s + 1 < bounds.length; s++) {
    const [i0, j0] = bounds[s], [i1, j1] = bounds[s + 1];
    if (i0 >= 0) out[i0] = j0;
    // بين المرساتين: نفس الكلام بالترتيب
    let j = j0 + 1;
    for (let i = i0 + 1; i < i1; i++) {
      const k = lineKey(oldL[i].text);
      for (let t = j; t < j1; t++) if (lineKey(newL[t].text) === k) { out[i] = t; j = t + 1; break; }
    }
  }
  return out;
}
/** الصفحة القديمة ← الصفحة الجديدة: وين راحت أغلب سطورها. صفحة بلا سطور تمشي ويا اللي قبلها */
export function pageMap(oldL: Line[], newL: Line[], oldPages: number, newPages: number, idx = alignLines(oldL, newL)): Map<number, number> {
  const votes = new Map<number, Map<number, number>>();
  oldL.forEach((l, i) => { if (idx[i] < 0) return; const v = votes.get(l.page) ?? new Map(); const p = newL[idx[i]].page; v.set(p, (v.get(p) ?? 0) + 1); votes.set(l.page, v); });
  const map = new Map<number, number>();
  let last = 0, lastOld = 0;
  for (let p = 1; p <= oldPages; p++) {
    const v = votes.get(p);
    const best = v ? [...v].sort((x, y) => y[1] - x[1])[0][0] : Math.min(newPages, Math.max(1, last + (p - lastOld)));
    map.set(p, best);
    if (v) { last = best; lastOld = p; }
  }
  return map;
}
/** الأزرار تمشي ويا سؤالها للنسخة الجديدة، والتلقائية تنعاد عليها. يرجع خريطة الصفحات حتى كتابة الطلاب تمشي هم */
export async function relocateMarks(book: Row, oldPdf: Buffer, newPdf: Buffer, newPages: number) {
  const [oldL, newL] = [await pageLines(oldPdf), await pageLines(newPdf)];
  const idx = alignLines(oldL, newL);
  const map = pageMap(oldL, newL, Number(book.pages) || 0, newPages, idx);
  const marks = await find("note_marks", { book_id: book.id });
  let moved = 0, lost = 0;
  for (const m of marks) {
    // السطر اللي الزر عليه بالقديمة (أقرب سطر بنفس الصفحة)، ووينه بالجديدة
    let best = -1;
    oldL.forEach((l, i) => { if (l.page === m.page && (best < 0 || Math.abs(l.y - Number(m.y)) < Math.abs(oldL[best].y - Number(m.y)))) best = i; });
    const j = best >= 0 ? idx[best] : -1;
    const to = j >= 0 ? { page: newL[j].page, y: Math.max(0, Math.min(1, newL[j].y + Number(m.y) - oldL[best].y)) } : { page: map.get(m.page) ?? Math.min(m.page, newPages), y: m.y };
    if (j < 0) lost++;
    if (to.page !== m.page || Math.abs(Number(to.y) - Number(m.y)) > 0.001) { await update("note_marks", { id: m.id }, to); moved++; }
  }
  // كان بيها أزرار: التلقائية تنعاد على الجديدة، فالأسئلة الجديدة تاخذ أزرار هم
  const autoBefore = marks.filter((m) => m.auto === 1).length;
  const auto = marks.length ? await autoMarks({ ...book, pages: newPages }, newL) : null;
  return { map, moved, lost, added: Math.max(0, (auto?.marks ?? 0) - autoBefore) };
}

/** ملزمة مركّبة: كل صفحة سؤال، ويّاها ملف حل نموذجي */
export const isComposed = (b: Row) => b.kind === "rasid" || !!b.sol;
/** يحط الأزرار وحدها. الأزرار اللي عدلها صاحب البوت تبقى، والتلقائية تنعاد. يرجع عدد الأزرار والفيديوهات اللي انربطت */
export async function autoMarks(book: Row, given?: Line[]) {
  // الملازم المركّبة (سؤال بكل صفحة: الوزاريات، الإثرائيات، الراصد) بيها كتابة مخفية من الصفحة الأصلية،
  // فالتدوير يحط أزرار بمكان غلط. أزرارها تنحط بلصق الملف الجاهز
  if (isComposed(book)) return { marks: 0, linked: 0, composed: true };
  let lines = given;
  if (!lines) {
    const pdf = await files().read(`notes/${book.file}.pdf`);
    need(pdf, "ملف الملزمة مو موجود");
    lines = await pageLines(pdf!);
  }
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

/** اسم السؤال القصير من سطره: «س1 / خزان...» ← س1، «Q 3 / ...» ← Q3، «مثال 2» ← مثال 2 (للشريط تحت الشاشة) */
export function questionTag(label: unknown) {
  const t = String(label ?? "").trim();
  let m = /^س\s*(\d+)/.exec(t);
  if (m) return `س${m[1]}`;
  m = /^Q\s*(\d+)/i.exec(t);
  if (m) return `Q${m[1]}`;
  m = /^(مثال|Example)\s*(\d*)/i.exec(t);
  if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
  return "";
}
const pub = (m: Row) => ({ id: m.id as number, page: m.page as number, y: Number(m.y), video: !!m.video_id, solution: !!m.solution, q: questionTag(m.label) });
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
  const s = await syncLinked();
  return `✅ انرفع «${name}» (${lang === "en" ? "إنجليزي" : "عربي"})${s.videosAdded ? `، وانحط على ${s.videosAdded} زر لنفس السؤال بالملازم` : ""}`;
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
  const all = await find("note_marks");
  const books = new Map((await find("note_books")).map((b) => [b.id as number, b]));
  const place = (m: Row) => ({ id: m.id as number, book: m.book_id as number, title: String(books.get(m.book_id)?.title ?? ""), page: m.page as number, label: String(m.label ?? "") });
  const marks = all.filter((m) => m.book_id === bookId).sort((a, b) => a.page - b.page || Number(a.y) - Number(b.y))
    .map((m) => ({ id: m.id as number, page: m.page as number, y: Number(m.y), label: String(m.label ?? ""), video: (m.video_id as number) ?? null, solution: String(m.solution ?? ""),
      linked: m.link ? all.filter((o) => o.link === m.link && o.id !== m.id).map(place) : [] }));
  // أزرار الملازم الثانية: منها يختار السؤال نفسه حتى يربطه
  const others = all.filter((m) => m.book_id !== bookId && books.has(m.book_id)).sort((a, b) => a.book_id - b.book_id || a.page - b.page || Number(a.y) - Number(b.y)).map(place);
  return { marks, others };
}

// ---------- نفس السؤال بأكثر من ملزمة (دفتر المحاضرات، الراصد، الإنجليزي): أزرارها بنفس رقم الربط link.
// تبدّل فيديو الحل أو الفيديو التوضيحي بوحدة، ينبدل بكل الأزرار المربوطة بيها

/** الفيديو التوضيحي بلغة الملزمة الثانية: نفس اسمه بلغتها (إذا مرفوع) */
function variant(videos: Row[], v: Row | undefined, lang: string) {
  if (!v) return undefined;
  return v.lang === lang ? v : videos.find((x) => x.name === v.name && x.lang === lang);
}
/** الزر تغيّر: رابط الحل وفيديو التوضيح يروحون لكل الأزرار المربوطة بيه. يرجع عدد الأزرار اللي تحدثت */
async function spread(m: Row, before: { solution?: unknown; video_id?: unknown }) {
  if (!m.link) return 0;
  const others = (await find("note_marks", { link: m.link })).filter((o) => o.id !== m.id);
  if (!others.length) return 0;
  const lang = new Map((await find("note_books")).map((b) => [b.id, b.lang === "en" ? "en" : "ar"]));
  const videos = await find("note_videos");
  const byId = (id: unknown) => videos.find((v) => v.id === id);
  const solChanged = (m.solution ?? null) !== (before.solution ?? null);
  const vidChanged = (m.video_id ?? null) !== (before.video_id ?? null);
  let n = 0;
  for (const o of others) {
    const patch: Row = {};
    if (solChanged && (o.solution ?? null) !== (m.solution ?? null)) patch.solution = m.solution ?? null;
    if (vidChanged) {
      if (m.video_id) {
        const pick = variant(videos, byId(m.video_id), lang.get(o.book_id) ?? "ar");
        if (pick && pick.id !== o.video_id) patch.video_id = pick.id;
      } else if (o.video_id && byId(o.video_id)?.name === byId(before.video_id)?.name) patch.video_id = null;
    }
    if (!Object.keys(patch).length) continue;
    await update("note_marks", { id: o.id }, { ...patch, auto: 0 });
    n++;
  }
  return n;
}
/** يربط الزر بنفس السؤال بملزمة ثانية: اللي ناقصه ياخذه من المربوطين، واللي بيه يروح إلهم */
async function linkTo(m: Row, otherId: number) {
  const other = await one("note_marks", { id: otherId });
  need(other, "السؤال اللي تربطه بيه مو موجود");
  need(other!.book_id !== m.book_id, "اربطه بسؤال بملزمة ثانية، مو بنفس الملزمة");
  const key = other!.link ?? m.link ?? other!.id;
  if (m.link && m.link !== key) for (const x of await find("note_marks", { link: m.link })) await update("note_marks", { id: x.id }, { link: key });
  await update("note_marks", { id: other!.id }, { link: key, auto: 0 });
  await update("note_marks", { id: m.id }, { link: key, auto: 0 });
  const group = (await find("note_marks", { link: key })).filter((x) => x.id !== m.id);
  const book = await one("note_books", { id: m.book_id });
  const lang = book?.lang === "en" ? "en" : "ar";
  const videos = await find("note_videos");
  const fill: Row = {};
  if (!m.solution) { const s = group.find((x) => x.solution)?.solution; if (s) fill.solution = s; }
  if (!m.video_id) {
    for (const x of group) { const v = variant(videos, videos.find((y) => y.id === x.video_id), lang); if (v) { fill.video_id = v.id; break; } }
  }
  if (Object.keys(fill).length) await update("note_marks", { id: m.id }, fill);
  const now = (await one("note_marks", { id: m.id }))!;
  return await spread(now, {});
}

/** نفس السؤال بكل الملازم (طلب الأستاذ 2026-11-24: «وين ما تلگى فيديو السؤال، بكل مكان لازم تخليه»): كل زرين مربوطين
 *  (نفس رقم link)، اللي ناقصه فيديو الحل لو فيديو التوضيح ياخذه من المربوطين، والتوضيح بلغة ملزمته (نفس الاسم).
 *  other: فيديو توضيح ما إله نسخة بلغة الملزمة (يحتاج الأستاذ يرفع نسخته) */
export async function syncLinked() {
  // التوضيح بلغة ثانية (ما چان إله نسخة بلغة الملزمة): من تنرفع نسخته بلغتها، تنبدل وحدها (حتى بالأزرار مو المربوطة)
  const all = await find("note_marks");
  const bookLang = new Map((await find("note_books")).map((b) => [b.id, b.lang === "en" ? "en" : "ar"]));
  const vids = await find("note_videos");
  let swapped = 0;
  for (const m of all.filter((x) => x.video_id)) {
    const v = vids.find((x) => x.id === m.video_id);
    const lang = bookLang.get(m.book_id) ?? "ar";
    if (!v || v.lang === lang) continue;
    const own = vids.find((x) => x.name === v.name && x.lang === lang);
    if (own) { await update("note_marks", { id: m.id }, { video_id: own.id }); m.video_id = own.id; swapped++; }
  }
  const marks = all.filter((m) => m.link != null);
  const books = new Map((await find("note_books")).map((b) => [b.id, b.lang === "en" ? "en" : "ar"]));
  const videos = await find("note_videos");
  const groups = new Map<unknown, Row[]>();
  for (const m of marks) groups.set(m.link, [...(groups.get(m.link) ?? []), m]);
  let videosAdded = 0, solutionsAdded = 0;
  const other = new Set<string>();
  for (const g of groups.values()) {
    const sol = g.find((m) => m.solution)?.solution;
    const names = [...new Set(g.map((m) => videos.find((v) => v.id === m.video_id)?.name).filter(Boolean))] as string[];
    for (const m of g) {
      const patch: Row = {};
      if (!m.solution && sol) { patch.solution = sol; solutionsAdded++; }
      if (!m.video_id && names.length) {
        const lang = books.get(m.book_id) ?? "ar";
        // بلغة الملزمة، وإذا ما إله نسخة بلغتها ينحط مثل ما هو: أغلب التوضيحات عربي وإنگليزي بنفس الفيديو (طلب الأستاذ
        // 2026-11-24). ومن تنرفع نسخة بلغتها تنبدل وحدها (فوك)
        const v = names.map((n) => videos.find((x) => x.name === n && x.lang === lang)).find(Boolean);
        const any = v ?? names.map((n) => videos.find((x) => x.name === n)).find(Boolean);
        if (any) { patch.video_id = any.id; videosAdded++; }
        if (!v) other.add(names[0]);
      }
      if (Object.keys(patch).length) await update("note_marks", { id: m.id }, patch);
    }
  }
  return { videosAdded: videosAdded + swapped, solutionsAdded, other: [...other] };
}

/** يحفظ الزر. يرجع عدد الأزرار المربوطة بيه بالملازم الثانية اللي تحدثت وياه */
export async function saveMark(book: Row, body: Row) {
  const page = Number(body.page), y = Number(body.y);
  need(Number.isInteger(page) && page >= 1 && page <= book.pages, "رقم الصفحة غلط");
  need(y >= 0 && y <= 1, "المكان غلط");
  const solution = String(body.solution ?? "").trim();
  need(!solution || parseLink(solution) || parseYouTube(solution), "رابط الحل لازم يكون رابط يوتيوب، أو رابط منشور بالقناة مثل https://t.me/c/123456/78");
  const video = body.video ? Number(body.video) : null;
  if (video) need(await one("note_videos", { id: video }), "الفيديو مو موجود");
  const row = { book_id: book.id, page, y, label: String(body.label ?? "").slice(0, 80), video_id: video, solution: solution || null, auto: 0 };
  let id = Number(body.id) || 0;
  const before = id ? await one("note_marks", { id, book_id: book.id }) : null;
  if (id) {
    need(before, "الزر مو موجود");
    await update("note_marks", { id }, row);
  } else id = Number(await insert("note_marks", row));
  const m = (await one("note_marks", { id }))!;
  // body.link: رقم زر بملزمة ثانية يربطه بيه، و0 يفك الربط
  if (body.link !== undefined && body.link !== null && body.link !== "") {
    const want = Number(body.link) || 0;
    if (want) return await linkTo(m, want);
    if (m.link) await update("note_marks", { id }, { link: null });
    return 0;
  }
  return before ? await spread(m, before) : 0;
}
/** نفس فيديو الحل (يوتيوب أو منشور القناة) يعني نفس السؤال */
export function solutionKey(link: unknown) {
  const s = String(link ?? "");
  const yt = parseYouTube(s);
  if (yt) return `yt:${yt}`;
  const l = parseLink(s);
  return l ? `tg:${l.chat}/${l.msg}` : "";
}
/** كل الأزرار بكل الملازم (عربي وإنجليزي، الدفتر والوزاريات والإثرائيات والراصد) اللي بيها نفس فيديو الحل تنربط ببعض،
 *  فمن يتبدل فيديو واحد منها يتبدل بالكل. يرجع عدد الأزرار اللي انربطت */
async function joinSameSolution(keys: Set<string>) {
  if (!keys.size) return 0;
  const all = await find("note_marks");
  let n = 0;
  for (const k of keys) {
    const same = all.filter((m) => m.solution && solutionKey(m.solution) === k);
    if (same.length < 2) continue;
    const groups = new Set(same.map((m) => m.link).filter((x) => x != null));
    const key = [...groups][0] ?? same[0].id;
    // المجاميع القديمة (مثل الراصد ويا الدفتر) تمشي كلها ويا المجموعة
    for (const m of all) {
      if (!(same.includes(m) || (m.link != null && groups.has(m.link))) || m.link === key) continue;
      await update("note_marks", { id: m.id }, { link: key });
      m.link = key;
      n++;
    }
  }
  return n;
}
/** روابط حل كثيرة مرة وحدة. كل سطر: «ص22 · 0.196 · اسم السؤال · الرابط»، أو «ص22 · 0.196 · اسم السؤال · ▶️ اسم الفيديو التوضيحي».
 *  يروح للزر اللي بنفس الصفحة وأقرب مكان، وإذا ماكو زر هناك ينضاف زر جديد. الأزرار اللي بيها نفس فيديو الحل بكل الملازم تنربط ببعض */
export async function pasteSolutions(book: Row, text: string) {
  const marks = await find("note_marks", { book_id: book.id });
  const videos = await find("note_videos", { lang: book.lang === "en" ? "en" : "ar" });
  let linked = 0, explained = 0, added = 0, spreadTo = 0;
  const bad: string[] = [], missing = new Set<string>(), keys = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    const parts = s.split(/\s*·\s*/);
    const pm = /^ص\s*(\d+)$/.exec(parts[0] ?? "");
    const page = pm ? Number(pm[1]) : 0, y = /^[01](?:\.\d+)?$/.test(parts[1] ?? "") ? Number(parts[1]) : -1;
    const target = parts.length >= 4 ? parts[parts.length - 1] : "", label = parts.slice(2, -1).join(" · ");
    const vm = /^▶️?\s*(.+)$/u.exec(target);
    const video = vm && !parseYouTube(target) && !parseLink(target) ? videos.find((v) => v.name === vm[1].trim()) : undefined;
    if (vm && !parseYouTube(target) && !parseLink(target) && !video) { missing.add(vm[1].trim()); continue; }
    if (!pm || page > book.pages || y < 0 || y > 1 || !(video || parseYouTube(target) || parseLink(target))) { bad.push(s.slice(0, 40)); continue; }
    const patch: Row = video ? { video_id: video.id } : { solution: target };
    // قريب كلش (أقل من 1.5% من الصفحة): نفس الزر. الأسئلة القصيرة ورا بعض بينها ربع سطر بس
    const near = marks.filter((x) => x.page === page && Math.abs(Number(x.y) - y) < 0.015).sort((a, b) => Math.abs(Number(a.y) - y) - Math.abs(Number(b.y) - y))[0];
    if (near) {
      const before = { solution: near.solution, video_id: near.video_id };
      await update("note_marks", { id: near.id }, { ...patch, auto: 0 });
      Object.assign(near, patch);
      spreadTo += await spread(near, before);
    } else {
      const row: Row = { book_id: book.id, page, y, label: label.slice(0, 80), video_id: null, solution: null, auto: 0, ...patch };
      row.id = await insert("note_marks", row);
      marks.push(row);
      added++;
    }
    if (video) explained++;
    else { linked++; keys.add(solutionKey(target)); }
  }
  need(linked || explained || bad.length || missing.size, "الصق الروابط أول");
  const joined = await joinSameSolution(keys);
  return { linked, explained, added, bad, spread: spreadTo, joined, missing: [...missing] };
}
export async function deleteMark(book: Row, id: number) {
  need(await one("note_marks", { id, book_id: book.id }), "الزر مو موجود");
  await remove("note_marks", { id });
}
