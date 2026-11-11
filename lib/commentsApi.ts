// تعليقات الدرجات ومكتبة الملصقات: صاحب البوت يحدد لكل مدى درجات مقولات وملصقات،
// ولمن تنصحح الورقة توصل للطالب مقولة عشوائية من مدى درجته، ما تتكرر عليه لحد ما تخلص مقولات مداه
import path from "node:path";
import { randomUUID } from "node:crypto";
import { find, insert, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { DEFAULT_COMMENTS } from "./defaultComments.ts";
import { files } from "./files.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { AR_FONTS, EN_FONTS, fontChoice, setFontChoice } from "./imgFonts.ts";

const PERM = "owner";
const MAX_STICKER = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const range = (lo: unknown, hi: unknown) => {
  const a = Number(lo), b = Number(hi);
  need(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= 100 && a <= b, "المدى لازم يكون من 0 إلى 100، والأول أصغر أو يساوي الثاني");
  return { lo: a, hi: b };
};

async function seed() {
  if (await kvGet("comments_seeded")) return;
  if (!(await find("grade_comments", {})).length) for (const [lo, hi, text] of DEFAULT_COMMENTS) await insert("grade_comments", { lo, hi, text, sticker_id: null, created: stamp() });
  await kvSet("comments_seeded", "1");
}
const byRange = (a: Row, b: Row) => a.lo - b.lo || a.hi - b.hi || a.id - b.id;
async function pageData() {
  return {
    comments: (await find("grade_comments", {})).sort(byRange).map((c) => ({ id: c.id, lo: c.lo, hi: c.hi, text: c.text, sticker: c.sticker_id ?? 0 })),
    stickers: (await find("stickers", {})).sort(byRange).map((s) => ({ id: s.id, name: s.name, lo: s.lo, hi: s.hi })),
    // ✍️ خط الصور: صاحب البوت يختاره، وكل الصور تتغير وياه
    fonts: { ...await fontChoice(), ar_list: AR_FONTS.map((f) => ({ id: f.id, name: f.name })), en_list: EN_FONTS.map((f) => ({ id: f.id, name: f.name })) },
  };
}

export async function commentsAction(body: Row) {
  await authed(body?.initData, PERM);
  await seed();
  const a = String(body.action ?? "");
  let notice = "";
  const stickerOf = async (raw: unknown) => {
    const id = Number(raw) || 0;
    if (id) need(await one("stickers", { id }), "الملصق غير موجود");
    return id || null;
  };
  if (a === "add" || a === "save") {
    const text = String(body.text ?? "").trim();
    need(text, "اكتب المقولة");
    need(text.length <= 600, "المقولة طويلة هواية");
    const row = { ...range(body.lo, body.hi), text, sticker_id: await stickerOf(body.sticker) };
    if (a === "add") { await insert("grade_comments", { ...row, created: stamp() }); notice = "✅ انضافت المقولة"; }
    else { need(await one("grade_comments", { id: Number(body.id) }), "المقولة غير موجودة"); await update("grade_comments", { id: Number(body.id) }, row); notice = "✅ انحفظت"; }
  } else if (a === "del") {
    await remove("grade_comments", { id: Number(body.id) });
    await remove("comment_sent", { comment_id: Number(body.id) });
    notice = "🗑 انمسحت المقولة";
  } else if (a === "saveSticker") {
    need(await one("stickers", { id: Number(body.id) }), "الملصق غير موجود");
    const name = String(body.name ?? "").trim().slice(0, 60);
    need(name, "اكتب اسم الملصق");
    await update("stickers", { id: Number(body.id) }, { name, ...range(body.lo, body.hi) });
    notice = "✅ انحفظ الملصق";
  } else if (a === "delSticker") {
    const id = Number(body.id);
    await remove("stickers", { id });
    for (const c of await find("grade_comments", { sticker_id: id })) await update("grade_comments", { id: c.id }, { sticker_id: null });
    notice = "🗑 انمسح الملصق";
  } else if (a === "fonts") {
    await setFontChoice({ ar: String(body.ar ?? ""), en: String(body.en ?? "") });
    notice = "✅ انحفظ الخط: كل الصور الجاية تطلع بيه";
  } else if (a === "fontPreview") {
    // بطاقة درجة تجريبية بالخط المختار (قبل الحفظ)، حتى يشوفه صاحب البوت
    const { gradeCardSample } = await import("./documents.ts");
    const png = await gradeCardSample({ ar: String(body.ar ?? ""), en: String(body.en ?? "") });
    need(png, "ما گدرت أرسم البطاقة هسه، جرب بعد شوية");
    return { ...await pageData(), preview: `data:image/png;base64,${png!.toString("base64")}`, notice: "" };
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}

export async function stickerUpload(form: FormData) {
  await authed(form.get("initData"), PERM);
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0, "اختار صورة");
  need((f as Blob).size <= MAX_STICKER, "الصورة كبيرة، أكثر شي 6 ميگا");
  const ext = path.extname((f as File).name || "").toLowerCase() || ".png";
  need(TYPES[ext], "الصورة لازم تكون PNG أو JPG أو GIF أو WEBP");
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  need(name, "اكتب اسم الملصق");
  const r = range(form.get("lo"), form.get("hi"));
  const file = `stickers/${randomUUID()}${ext}`;
  await files().write(file, Buffer.from(await (f as Blob).arrayBuffer()), TYPES[ext]);
  await insert("stickers", { name, file, ...r, created: stamp() });
  return { ...await pageData(), notice: "✅ انضاف الملصق" };
}

/** صورة الملصق: مو سرية، تطلع بالصفحات وبرسائل الطلاب */
export async function stickerFile(id: unknown) {
  const s = await one("stickers", { id: Number(id) });
  need(s, "الملصق غير موجود", 404);
  const body = await files().read(s!.file);
  need(body, "الملصق غير موجود", 404);
  return { body: body!, type: TYPES[path.extname(s!.file)] ?? "image/png", name: path.basename(s!.file) };
}

/** مقولة لدرجة هذا الطالب: عشوائية، وما تتكرر عليه لحد ما يشوف كل مقولات مداه */
export async function pickComment(uid: number, total: number, record = true) {
  await seed();
  const fit = (await find("grade_comments", {})).filter((c) => c.lo <= total && total <= c.hi);
  if (!fit.length) return null;
  const seen = new Set((await find("comment_sent", { user_id: uid })).map((s) => s.comment_id));
  let fresh = fit.filter((c) => !seen.has(c.id));
  if (!fresh.length) { for (const c of fit) await remove("comment_sent", { user_id: uid, comment_id: c.id }); fresh = fit; }
  const c = fresh[Math.floor(Math.random() * fresh.length)];
  if (record) await put("comment_sent", { user_id: uid, comment_id: c.id, at: stamp() });
  // إذا المقولة بدون ملصق، ياخذ ملصق عشوائي من مدى الدرجة إذا موجود
  const stickers = (await find("stickers", {})).filter((s) => s.lo <= total && total <= s.hi);
  const sticker = c.sticker_id ? await one("stickers", { id: c.sticker_id }) : stickers[Math.floor(Math.random() * stickers.length)] ?? null;
  return { id: c.id as number, text: c.text as string, sticker: sticker as Row | null };
}
