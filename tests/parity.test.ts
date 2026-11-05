// الفحص المقارن: كل سيناريو ينعاد على نسخة TypeScript، ولازم يطلع نفس اللي سواه بوت بايثون القديم
// (نفس رسائل تليجرام بالترتيب، نفس صفوف قاعدة البيانات، ونفس ملفات HTML للوصولات والقوائم).
// التسجيلات بـ tests/parity/golden/ من tests/parity/record.py
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join("tests", "parity");

// اللي يتغير من تشغيل لتشغيل (الوقت، الرموز العشوائية)
function scrub(s: string) {
  return s
    .replace(/\d{4}-\d\d-\d\d[ _]\d\d[:-]\d\d/g, "<TIME>")
    .replace(/\d{4}-\d\d-\d\d/g, "<DAY>")
    .replace(/🕐 \d\d:\d\d/g, "🕐 <HM>")
    .replace(/\(\d\d:\d\d · /g, "(<HM> · ")
    .replace(/<td>\d\d:\d\d<\/td>/g, "<td><HM></td>")
    // نفس الرابط: بايثون ما يرمز / وجافاسكربت يرمزها %2F، وتليجرام يفهم الاثنين
    .replace(/share\/url\?url=https%3A(?:\/\/|%2F%2F)t\.me(?:\/|%2F)/g, "share/url?url=https%3A//t.me/")
    // طلب من صاحب البوت: رسالة الموافقة المتكررة تشرح ليش تتكرر
    .replace("\n\n👇 لتأكيد موافقتك على هذا الشرط، اضغط مرة أخرى.", "")
    // وكذلك صياغة رسالة إلغاء الطلب
    .replace(/↩️ إذا غيرت رأيك،[\s\S]*ما يمكن إلغاؤه\.|↩️ <b>طلبك رقم #\d+<\/b>[\s\S]*تم تجهيز الطلب\./, "<CANCEL_NOTE>")
    .replace(/a:done:\d+/g, "a:done:<BATCH>")
    // رمز الدعوة صار 8 أرقام عمداً (كان 6 بالبوت القديم)، حتى ما ينخمن
    // تغييرات مقصودة عن البوت القديم: شكل ملف الطلبات، اسم البائع، وتفصيل الصلاحيات
    .replace(/html\{-webkit-print-color-adjust[\s\S]*?(<\/style>)/, "$1")
    .replace('<section class="page ar">\n<div class=currbar>منهج عربي</div>', "<section class=page>")
    .replace(/🏪 (البائع: )?<b>(استلام من )?[^<]*<\/b>/g, "🏪 <SELLER>")
    .replace(/وصل شرائك من [^<]*/, "وصل شرائك من مكتب QMath")
    .replace("🖨 طلبات التوصيل والطباعة", "🖨 الطلبات والطباعة").replace(/🛒 المنتجات والأسعار$/, "🛒 المنتجات والأسعار والتوصيل").replace(/🎓 الطلاب$/, "🎓 الطلاب والمراكز")
    .replace("✅ تم — خلصت هذا السؤال", "✅ خلصت — أخفِ السؤال")
    .replace(/lib_\d{6,8}/g, "lib_<CODE>")
    .replace(/<code>\d{6,8}<\/code>/g, "<code><CODE></code>");
}
// صفحات المتجر انتقلت عمداً: /index + /reg.html + /pos.html صارت /store و/store/reg و/store/pos
const PAGE: Record<string, string> = { "": "store", "/store": "store", "/reg.html": "reg", "/store/reg": "reg", "/pos.html": "pos", "/store/pos": "pos" };
function normal(v: any): any {
  if (typeof v === "string") {
    const u = /^https:\/\/x\.test([^?]*)\?v=\d+&d=(.*)$/.exec(v);
    if (u) return { page: PAGE[u[1]] ?? u[1], d: normal(JSON.parse(Buffer.from(u[2], "base64url").toString("utf8"))) };
    return scrub(v);
  }
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normal(x)]));
  return v;
}
// ميزات جديدة ما موجودة بالبوت القديم: جداول الامتحانات وزر لوحة التحكم
const NEW_TABLES = ["schedules", "place_slots", "place_dates", "exam_answers", "question_marks", "paper_ink", "grade_comments", "stickers", "comment_sent", "sched_items", "activity", "guardians", "company_settlements", "student_pass", "pass_requests","bank_exams", "bank_versions", "bank_questions", "bank_edits", "exam_access", "order_codes"];
function dropNewButtons(e: any) {
  const kb = e.p?.reply_markup?.inline_keyboard;
  if (kb) e.p.reply_markup.inline_keyboard = kb.filter((row: any[]) => !row.some((b) => /^(a:ex|a:asstudent$|a:sfp:\d+:(exams|schedule|exception|grade|sales|company|fees|online|centers)$)/.test(b.callback_data ?? "") || /\/store\/(exams|products|fees)/.test(b.web_app?.url ?? "")));
  return e;
}
// قائمة لوحة التحكم صارت صفحة وحدة، فأزرارها ما تنقارن بالبوت القديم
function dropMenuButtons(e: any) {
  if (e.p?.text === "<b>⚙️ لوحة التحكم</b>") delete e.p.reply_markup;
  return e;
}
function normalDb(db: Record<string, any[]>) {
  const out: Record<string, any[]> = {};
  for (const [t, rows] of Object.entries(db)) {
    if (NEW_TABLES.includes(t)) continue;
    out[t] = rows.map((r) => {
      const x = { ...r };
      if (t === "products") { delete x.hidden; delete x.ask; }   // الإخفاء من المتجر وحق السؤال ميزات جديدة
      if (t === "students" || t === "centers") delete x.gender;   // بنين وبنات ميزة جديدة
      if (t === "orders") { delete x.printed_by; delete x.printed_at; }
      if (t === "orders" && x.items) x.items = JSON.parse(x.items);
      if (t === "sessions" && x.data) x.data = JSON.parse(x.data);
      return normal(x);
    });
  }
  // kv: المفاتيح اللي بيها وقت أو رمز، وقيم JSON
  // invfail_: عداد المحاولات الغلط، إضافة أمنية ما موجودة بالبوت القديم
  out.kv = out.kv.filter((r) => !/_stamp$|^invfail_|^asstudent_|^seeded$|^last_two_done$|^grade_errors_|^comments_seeded$/.test(r.k)).map((r) => {
    let v = r.v;
    if (/^(q_hours|online_only)$/.test(r.k)) v = JSON.parse(v);
    if (/^libinv_/.test(r.k)) v = String(v).split(":")[0];
    return { k: String(r.k).replace(/^batch_\d+/, "batch_<ID>").replace(/^libinv_\d+/, "libinv_<CODE>"), v };
  }).sort((a, b) => (a.k < b.k ? -1 : 1));
  return out;
}
const scrubFiles = (f: Record<string, string>) =>
  // السطور الفارغة بالـ HTML ما تأثر على الرسم (الوصل القديم بيه سطر فارغ داخل التنسيق)
  Object.fromEntries(Object.entries(f).map(([k, v]) => [scrub(k), scrub(v).replace(/\n{2,}/g, "\n")]));

const sorted = (db: Record<string, any[]>) => Object.fromEntries(Object.entries(db).map(([t, rows]) => [t, rows.map((r) => JSON.stringify(Object.entries(r).sort())).sort()]));
for (const driver of ["sqlite", "firestore"]) for (const file of fs.readdirSync(DIR).filter((f) => /^phase.*\.json$/.test(f)).sort()) {
  const golden = JSON.parse(fs.readFileSync(path.join(DIR, "golden", file), "utf8"));
  for (const sc of JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"))) {
    test(`${driver} ${file}: ${sc.name}`, () => {
      const r = spawnSync(process.execPath, [path.join(DIR, "run.ts"), file, sc.name], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, PARITY_DRIVER: driver } });
      assert.equal(r.status, 0, r.stderr);
      const ts = JSON.parse(r.stdout), py = golden[sc.name];
      // طلب من صاحب البوت: صورة نجاح الطلب تطلع لوحدها، لأن نفس الكلام مكتوب داخلها
      const photoOnly = (e: any) => { if (e.m === "sendPhoto" && /تم استلام طلبك/.test(e.p.caption ?? "")) { delete e.p.caption; delete e.p.parse_mode; } return e; };
      const dropPhotoMode = (e: any) => { if (e.m === "sendPhoto" && !e.p.caption) delete e.p.parse_mode; return e; };
      const a = normal(ts.trace.map(dropNewButtons).map(dropPhotoMode).map(dropMenuButtons)), b = normal(py.trace.map(photoOnly).map(dropMenuButtons));
      for (let i = 0; i < Math.max(a.length, b.length); i++) assert.deepEqual(a[i], b[i], `الرسالة رقم ${i}`);
      if (driver === "firestore") assert.deepEqual(sorted(normalDb(ts.db)), sorted(normalDb(py.db)));
      else assert.deepEqual(normalDb(ts.db), normalDb(py.db));
      assert.deepEqual(scrubFiles(ts.files), scrubFiles(py.files));
    });
  }
}
