// واجهة صفحة إدارة الامتحانات: كل طلب لازم صاحبه يكون عنده صلاحية الامتحانات
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CONTENT_DIR, TOKEN } from "./config.ts";
import { find, initDb, insert, kvGet, kvSet, maxOf, one, remove, tx, update, type Row } from "./db.ts";
import { can } from "./data.ts";
import { EXAM_PERM, deleteVersion, logEdit } from "./examBank.ts";
import { files } from "./files.ts";
import { api } from "./telegram.ts";
import { fileToken, verifyFileToken, verifyInitData } from "./webAuth.ts";

let ready = false;
const ensure = async () => { if (!ready) { await initDb(); ready = true; } };
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const need = (cond: unknown, message: string, status = 400) => { if (!cond) throw new ApiError(status, message); };
const intOf = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  need(Number.isInteger(n) && n >= min && n <= max, label);
  return n;
};
async function authed(initData: unknown) {
  await ensure();
  const uid = verifyInitData(initData);
  need(uid !== null, "افتح الصفحة من داخل البوت", 401);
  need(await can(uid!, EXAM_PERM), "ما عندك صلاحية", 403);
  return uid!;
}

const generalMinutes = async () => Number(await kvGet("exam_minutes")) || 75;

export async function examList(uid: number) {
  const exams = await find("bank_exams", {}, { order: ["slug", "ord"] });
  const stored = new Set((await Promise.all([...new Set(exams.map((e) => e.slug as string))].map((s) => files().list(`${s}/`)))).flat());
  const versions = await find("bank_versions", {}, { order: ["model"] });
  const questions = await find("bank_questions", {}, { order: ["n"] });
  const qBy = new Map<number, Row[]>(), vBy = new Map<number, Row[]>();
  for (const q of questions) qBy.set(q.version_id, [...(qBy.get(q.version_id) ?? []), q]);
  for (const v of versions) vBy.set(v.exam_id, [...(vBy.get(v.exam_id) ?? []), v]);
  const chapters: Row[] = [];
  for (const e of exams) {
    let c = chapters.find((x) => x.slug === e.slug);
    if (!c) { c = { slug: e.slug, chapter: e.chapter, exams: [] }; chapters.push(c); }
    const dir = `${e.slug}/e${e.ord}`;
    c.exams.push({
      id: e.id, ord: e.ord, title: e.title, info: e.info, minutes: e.minutes,
      versions: (vBy.get(e.id) ?? []).map((v) => {
        const pdf = (lang: "ar" | "en") => v["pdf_" + lang] || (lang === "ar" || v.has_en ? `${dir}/${v.model}/student_${lang}.pdf` : null);
        // صور الصفحات تنعرض داخل الصفحة. إذا انرفع PDF بديل، ينفتح الملف نفسه
        const pages = (lang: "ar" | "en") => {
          if (v["pdf_" + lang]) return [];
          const out: string[] = [];
          for (let i = 1; stored.has(`${dir}/${v.model}/student_${lang}_${i}.png`); i++) out.push(`${dir}/${v.model}/student_${lang}_${i}.png`);
          return out;
        };
        return {
          id: v.id, model: v.model, kind: v.kind, ok: !!v.ok, issues: JSON.parse(v.issues || "[]"), manual: !!v.manual,
          pdfAr: v.manual && !v.pdf_ar ? null : pdf("ar"), pdfEn: v.manual && !v.pdf_en ? null : pdf("en"),
          pagesAr: pages("ar"), pagesEn: pages("en"),
          questions: (qBy.get(v.id) ?? []).map((q) => ({ id: q.id, n: q.n, max: q.max_mark, q: q.q_file, a: JSON.parse(q.a_files || "[]"), edited: !!q.edited })),
        };
      }),
    });
  }
  return { chapters, generalMinutes: await generalMinutes(), fileToken: fileToken(uid) };
}

/** الأوامر اللي ما بيها ملفات. يرجع القائمة المحدثة */
export async function examAction(body: Row) {
  const uid = await authed(body?.initData);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  if (a === "list") return await examList(uid);
  if (a === "kind") {
    const v = await one("bank_versions", { id });
    need(v, "النسخة غير موجودة");
    const next = v!.kind === "mandatory" ? "optional" : "mandatory";
    await update("bank_versions", { id }, { kind: next });
    await logEdit(uid, `نسخة ${id}: ${next}`);
  } else if (a === "ok") {
    const v = await one("bank_versions", { id });
    need(v, "النسخة غير موجودة");
    need(v!.ok || await one("bank_questions", { version_id: id }), "ضيف سؤال واحد على الأقل");
    await update("bank_versions", { id }, { ok: v!.ok ? 0 : 1, issues: v!.ok ? JSON.stringify(["موقوفة من الإدارة"]) : "[]" });
    await logEdit(uid, `نسخة ${id}: ${v!.ok ? "إيقاف" : "جاهزة"}`);
  } else if (a === "minutes") {
    const n = intOf(body.value, 5, 600, "الوقت لازم يكون بالدقائق، من 5 إلى 600");
    need(await one("bank_exams", { id }), "الامتحان غير موجود");
    await update("bank_exams", { id }, { minutes: n });
    await logEdit(uid, `امتحان ${id}: الوقت ${n} دقيقة`);
  } else if (a === "minutesAll") {
    // الامتحان اللي إله وقت خاص يبقى على وقته
    const n = intOf(body.value, 5, 600, "الوقت لازم يكون بالدقائق، من 5 إلى 600");
    await tx(async () => {
      await update("bank_exams", { minutes: await generalMinutes() }, { minutes: n });
      await kvSet("exam_minutes", String(n));
    });
    await logEdit(uid, `الوقت العام للامتحانات ${n} دقيقة`);
  } else if (a === "mark") {
    const n = intOf(body.value, 0, 100, "الدرجة لازم رقم كامل من 0 إلى 100");
    need(await one("bank_questions", { id }), "السؤال غير موجود");
    await update("bank_questions", { id }, { max_mark: n, edited: 1 });
    await logEdit(uid, `سؤال ${id}: الدرجة ${n}`);
  } else if (a === "addExam") {
    const title = String(body.title ?? "").trim().slice(0, 80);
    need(title, "اكتب عنوان الامتحان");
    const n = intOf(body.minutes, 5, 600, "الوقت لازم يكون بالدقائق، من 5 إلى 600");
    const c = await one("bank_exams", { slug: String(body.slug ?? "") });
    need(c, "الفصل غير موجود");
    const ord = maxOf(await find("bank_exams", { slug: String(body.slug) }), "ord") + 1;
    await insert("bank_exams", { slug: String(body.slug), chapter: c!.chapter, ord, title, info: "", minutes: n, manual: 1 });
    await logEdit(uid, `امتحان جديد: ${title}`);
  } else if (a === "addVersion") {
    need(await one("bank_exams", { id }), "الامتحان غير موجود");
    const models = (await find("bank_versions", { exam_id: id })).map((v) => v.model as string);
    const model = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").find((x) => !models.includes(x));
    need(model, "ماكو حرف باقي");
    const kind = body.kind === "optional" ? "optional" : "mandatory";
    await insert("bank_versions", { exam_id: id, model: model!, kind, ok: 0, issues: JSON.stringify(["لسه تنضاف أسئلتها"]), manual: 1 });
    await logEdit(uid, `امتحان ${id}: نسخة جديدة ${model} (${kind})`);
  } else if (a === "delQuestion") {
    const q = await one("bank_questions", { id });
    need(q, "السؤال غير موجود");
    await tx(async () => {
      await remove("bank_questions", { id });
      await update("bank_questions", { version_id: q!.version_id }, (r) => ({ n: r.n - 1 }), { where: (r) => r.n > q!.n });
    });
    await logEdit(uid, `نسخة ${q!.version_id}: حذف س ${q!.n}`);
  } else if (a === "delVersion") {
    need(await one("bank_versions", { id }), "النسخة غير موجودة");
    await tx(async () => await deleteVersion(id));
    await logEdit(uid, `حذف نسخة ${id}`);
  } else if (a === "delExam") {
    const e = await one("bank_exams", { id });
    need(e, "الامتحان غير موجود");
    await tx(async () => {
      for (const v of await find("bank_versions", { exam_id: id })) await deleteVersion(v.id);
      await remove("bank_exams", { id });
    });
    await logEdit(uid, `حذف امتحان ${e!.title}`);
  } else throw new ApiError(400, "أمر غير معروف");
  return await examList(uid);
}

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };

// ---------- رفع الملفات
const MAX_UPLOAD = 15 * 1024 * 1024;
/** نوع الملف من محتواه، مو من اسمه */
function sniff(b: Buffer) {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}
async function saveUpload(f: unknown, kinds: string[]) {
  need(f instanceof Blob && f.size > 0, "اختار الملف");
  const blob = f as Blob;
  need(blob.size <= MAX_UPLOAD, "الملف أكبر من 15 ميگا");
  const buf = Buffer.from(await blob.arrayBuffer());
  const ext = sniff(buf);
  need(ext && kinds.includes(ext), kinds.includes("pdf") ? "لازم ملف PDF" : "لازم صورة PNG أو JPG");
  const ref = `uploads/${randomUUID()}.${ext}`;
  await files().write(ref, buf, TYPES[`.${ext}`]);
  return ref;
}
const IMAGES = ["png", "jpg"];
export async function examUpload(form: FormData) {
  const uid = await authed(form.get("initData"));
  const a = String(form.get("action") ?? "");
  const id = Number(form.get("id"));
  if (a === "addQuestion") {
    need(await one("bank_versions", { id }), "النسخة غير موجودة");
    const mark = intOf(form.get("mark"), 1, 100, "الدرجة لازم رقم كامل من 1 إلى 100");
    const answers = form.getAll("a");
    need(answers.length, "ضيف صورة الجواب");
    const q = await saveUpload(form.get("q"), IMAGES);
    const saved: string[] = [];
    for (const x of answers) saved.push(await saveUpload(x, IMAGES));
    const n = maxOf(await find("bank_questions", { version_id: id }), "n") + 1;
    await insert("bank_questions", { version_id: id, n, max_mark: mark, q_file: q, a_files: JSON.stringify(saved), edited: 1 });
    await logEdit(uid, `نسخة ${id}: سؤال جديد ${n}`);
  } else if (a === "replaceQ") {
    need(await one("bank_questions", { id }), "السؤال غير موجود");
    await update("bank_questions", { id }, { q_file: await saveUpload(form.get("file"), IMAGES), edited: 1 });
    await logEdit(uid, `سؤال ${id}: صورة جديدة`);
  } else if (a === "replaceA") {
    need(await one("bank_questions", { id }), "السؤال غير موجود");
    const files = form.getAll("file");
    need(files.length, "اختار صور الجواب");
    const saved: string[] = [];
    for (const x of files) saved.push(await saveUpload(x, IMAGES));
    await update("bank_questions", { id }, { a_files: JSON.stringify(saved), edited: 1 });
    await logEdit(uid, `سؤال ${id}: جواب جديد`);
  } else if (a === "pdfAr" || a === "pdfEn") {
    need(await one("bank_versions", { id }), "النسخة غير موجودة");
    await update("bank_versions", { id }, { [a === "pdfAr" ? "pdf_ar" : "pdf_en"]: await saveUpload(form.get("file"), ["pdf"]) });
    await logEdit(uid, `نسخة ${id}: رفع نسخة الطالب ${a}`);
  } else throw new ApiError(400, "أمر غير معروف");
  return await examList(uid);
}

// ---------- قراءة الملفات
/** يرجع محتوى ملف من المحتوى السري، بس لصاحب الصلاحية، وبس من داخل مجلد المحتوى */
export async function examFile(token: unknown, ref: unknown) {
  await ensure();
  const uid = verifyFileToken(token);
  need(uid !== null, "الرابط انتهى", 401);
  need(await can(uid!, EXAM_PERM), "ما عندك صلاحية", 403);
  need(typeof ref === "string" && ref, "ملف غير معروف");
  const r = ref as string;
  if (r.startsWith("tg:") || /^[\w-]{20,}$/.test(r)) {
    const info: any = await api("getFile", { file_id: r.replace(/^tg:/, "") });
    need(info?.file_path, "الملف غير موجود", 404);
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    need(res.ok, "الملف غير موجود", 404);
    const ext = path.extname(info.file_path).toLowerCase();
    return { body: Buffer.from(await res.arrayBuffer()), type: TYPES[ext] ?? "application/octet-stream" };
  }
  const root = path.resolve(CONTENT_DIR);
  const full = path.resolve(root, r);
  need(full.startsWith(root + path.sep), "ملف غير معروف", 403);
  const type = TYPES[path.extname(full).toLowerCase()];
  need(type, "ملف غير معروف", 403);
  const body = await files().read(path.relative(root, full).replace(/\\/g, "/"));
  need(body, "الملف غير موجود", 404);
  return { body: body!, type };
}
