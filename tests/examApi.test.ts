// أمان صفحة إدارة الامتحانات: توقيع تليجرام، الصلاحية، الملفات السرية، والرفع
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-api-"));
const CONTENT = path.join(tmp, "content");
const TOKEN = "123:secret-token";
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: CONTENT,
  CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"),
});
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { ApiError, examAction, examFile, examUpload } = await import("../lib/examApi.ts");
const { fileToken, verifyFileToken, verifyInitData } = await import("../lib/webAuth.ts");
const { loadCatalog } = await import("../lib/examBank.ts");
const { initDb } = await import("../lib/db.ts");
const { all, get, run } = await import("../lib/sqliteDriver.ts");
const { POST } = await import("../app/api/exams/route.ts");
const { GET } = await import("../app/api/exams/file/route.ts");

const sign = (uid: number, when = Math.floor(Date.now() / 1000), token = TOKEN) => {
  const p = new URLSearchParams({ auth_date: String(when), user: JSON.stringify({ id: uid }), query_id: "q" });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
};
const denied = (fn: () => Promise<unknown>, status: number) => assert.rejects(fn, (e: any) => e instanceof ApiError && e.status === status);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const png = () => new Blob([PNG], { type: "image/png" });

await initDb();
fs.mkdirSync(path.join(CONTENT, "ch1", "e1", "A"), { recursive: true });
fs.writeFileSync(path.join(CONTENT, "ch1", "e1", "A", "q1.png"), PNG);
fs.writeFileSync(path.join(tmp, "secret.png"), PNG);
fs.writeFileSync(path.join(CONTENT, "ch1", "note.txt"), "x");
await loadCatalog({ chapter: "الفصل الأول", slug: "ch1", exams: [{ ord: 1, title: "قبل x & y", info: "المحاضرة (1 & 2)", minutes: 60, versions: [
  { model: "A", ok: true, issues: [], has_en: true, questions: [{ n: 1, max: 20, q: "q1.png", a: [] }, { n: 2, max: 20, q: "q1.png", a: [] }] },
] }] });

test("توقيع تليجرام: الصحيح ينقبل، والمزور والقديم والمعدل ينرفض", () => {
  assert.equal(verifyInitData(sign(1)), 1);
  assert.equal(verifyInitData(sign(1, Math.floor(Date.now() / 1000), "999:other")), null);        // توكن ثاني
  assert.equal(verifyInitData(sign(1).replace("%22id%22%3A1", "%22id%22%3A7")), null);             // غير رقم الحساب
  assert.equal(verifyInitData(sign(1, Math.floor(Date.now() / 1000) - 90000)), null);              // أقدم من يوم
  for (const bad of ["", "x=1", null, undefined, 5]) assert.equal(verifyInitData(bad), null);
});

test("بدون توقيع أو صلاحية ممنوع، وصلاحية الامتحانات تفتح", async () => {
  await denied(async () => await examAction({ action: "list" }), 401);
  await denied(async () => await examAction({ action: "list", initData: "user=%7B%22id%22%3A1%7D" }), 401);
  await denied(async () => await examAction({ action: "list", initData: sign(2) }), 403);                            // طالب
  await run("INSERT INTO staff(user_id, name, perms) VALUES(5, 'مساعد', 'orders')");
  await denied(async () => await examAction({ action: "list", initData: sign(5) }), 403);                            // مساعد بدون الصلاحية
  await denied(async () => await examAction({ action: "delExam", id: 1, initData: sign(5) }), 403);
  assert.ok(await get("SELECT 1 FROM bank_exams WHERE id=1"));
  await run("UPDATE staff SET perms='orders,exams' WHERE user_id=5");
  assert.equal((await examAction({ action: "list", initData: sign(5) })).chapters[0].exams.length, 1);
  await run("UPDATE staff SET perms='orders' WHERE user_id=5");
});

test("التعديلات تنحفظ بأسم صاحبها، والقيم الغلط ترفض", async () => {
  const init = sign(1);
  await examAction({ action: "kind", id: 1, initData: init });
  assert.equal((await get("SELECT kind FROM bank_versions WHERE id=1"))!.kind, "optional");
  await examAction({ action: "minutes", id: 1, value: "75", initData: init });
  assert.equal((await get("SELECT minutes FROM bank_exams WHERE id=1"))!.minutes, 75);
  await examAction({ action: "marks", id: 1, marks: [60, 40], initData: init });
  assert.equal((await get("SELECT max_mark FROM bank_questions WHERE id=1"))!.max_mark, 60);
  await denied(async () => await examAction({ action: "marks", id: 1, marks: [12, 88.5], initData: init }), 400);
  await denied(async () => await examAction({ action: "marks", id: 1, marks: ["1; DROP TABLE exams", 99], initData: init }), 400);
  await denied(async () => await examAction({ action: "minutes", id: 1, value: 1, initData: init }), 400);
  await denied(async () => await examAction({ action: "nothing", initData: init }), 400);
  const r = await examAction({ action: "addExam", slug: "ch1", title: "جديد <b>", minutes: 90, initData: init });
  assert.equal(r.chapters[0].exams.length, 2);
  const e = r.chapters[0].exams[1];
  await examAction({ action: "addVersion", id: e.id, initData: init });
  const v = (await get("SELECT * FROM bank_versions WHERE exam_id=?", e.id))!;
  assert.deepEqual([v.model, v.ok, v.kind], ["A", 0, "mandatory"]);
  await denied(async () => await examAction({ action: "addVersion", id: e.id, initData: init }), 400);   // النسخة الناقصة تمنع اللي بعدها
  const e2 = (await examAction({ action: "addExam", slug: "ch1", title: "ثاني", minutes: 90, initData: init })).chapters[0].exams.at(-1);
  await examAction({ action: "addVersion", id: e2.id, kind: "optional", initData: init });
  assert.equal((await get("SELECT kind FROM bank_versions WHERE exam_id=? AND model='A'", e2.id))!.kind, "optional");   // إضافة للاختياري
  await denied(async () => await examAction({ action: "ok", id: v.id, initData: init }), 400);                       // بدون أسئلة ما تصير جاهزة
  assert.ok((await get("SELECT COUNT(*) n FROM bank_edits"))!.n >= 5);
  assert.ok((await get("SELECT user_id FROM bank_edits LIMIT 1"))!.user_id === 1);
});

test("وقت كل الامتحانات يغير اللي على العام، واللي إله وقت خاص يبقى", async () => {
  const init = sign(1);
  await examAction({ action: "minutes", id: 1, value: 75, initData: init });
  const special = (await examAction({ action: "addExam", slug: "ch1", title: "خاص", minutes: 95, initData: init })).chapters[0].exams.at(-1);
  await denied(async () => await examAction({ action: "minutesAll", value: 80, initData: sign(5) }), 403);
  await denied(async () => await examAction({ action: "minutesAll", value: 1, initData: init }), 400);
  assert.equal((await examAction({ action: "list", initData: init })).generalMinutes, 75);
  assert.equal((await examAction({ action: "minutesAll", value: 80, initData: init })).generalMinutes, 80);
  assert.equal((await get("SELECT minutes FROM bank_exams WHERE id=1"))!.minutes, 80);
  assert.equal((await get("SELECT minutes FROM bank_exams WHERE id=?", special.id))!.minutes, 95);
  await examAction({ action: "minutesAll", value: 70, initData: init });
  assert.equal((await get("SELECT minutes FROM bank_exams WHERE id=1"))!.minutes, 70);                     // يتبع العام كل مرة
});

test("الدرجات: مرة وحدة لكل نسخ الامتحان، وما تنحفظ إلا إذا المجموع 100", async () => {
  const init = sign(1);
  const e = (await examAction({ action: "addExam", slug: "ch1", title: "درجات", minutes: 60, initData: init })).chapters[0].exams.at(-1);
  await run("INSERT INTO bank_versions(exam_id, model, ok) VALUES(?,?,1), (?,?,1), (?,?,1)", e.id, "A", e.id, "B", e.id, "C");
  const vs = await all("SELECT id, model FROM bank_versions WHERE exam_id=? ORDER BY model", e.id);
  for (const v of vs) {
    const count = v.model === "C" ? 3 : 2;
    for (let n = 1; n <= count; n++) await run("INSERT INTO bank_questions(version_id, n, max_mark) VALUES(?,?,?)", v.id, n, 50);
  }
  await denied(async () => await examAction({ action: "marks", id: e.id, marks: [12, 50], initData: init }), 400);
  assert.equal((await all("SELECT 1 FROM bank_questions q JOIN bank_versions v ON v.id=q.version_id WHERE v.exam_id=? AND max_mark=12", e.id)).length, 0);
  await denied(async () => await examAction({ action: "marks", id: e.id, marks: [0, 100], initData: init }), 400);
  await examAction({ action: "marks", id: e.id, marks: [30, 70], initData: init });
  const marks = async (m: string) => (await all("SELECT max_mark FROM bank_questions q JOIN bank_versions v ON v.id=q.version_id WHERE v.exam_id=? AND v.model=? ORDER BY n", e.id, m)).map((r) => r.max_mark);
  assert.deepEqual(await marks("A"), [30, 70]);
  assert.deepEqual(await marks("B"), [30, 70]);
  assert.deepEqual(await marks("C"), [50, 50, 50]);      // عدد أسئلة مختلف
});

test("ترتيب الامتحانات بالسهم: مكان الملفات ما يتغير", async () => {
  const init = sign(1);
  const order = async () => (await examAction({ action: "list", initData: init })).chapters[0].exams.map((e: any) => e.id);
  const before = await order();
  const last = before.at(-1), prev = before.at(-2);
  const ordBefore = (await get("SELECT ord FROM bank_exams WHERE id=?", last))!.ord;
  await examAction({ action: "moveExam", id: last, dir: "up", initData: init });
  const after = await order();
  assert.deepEqual([after.at(-2), after.at(-1)], [last, prev]);
  assert.equal((await get("SELECT ord FROM bank_exams WHERE id=?", last))!.ord, ordBefore);
  await examAction({ action: "moveExam", id: last, dir: "down", initData: init });
  assert.deepEqual(await order(), before);
  await examAction({ action: "moveExam", id: last, dir: "down", initData: init });       // الأخير يبقى مكانه
  assert.deepEqual(await order(), before);
  await denied(async () => await examAction({ action: "moveExam", id: last, dir: "up", initData: sign(5) }), 403);
  const fresh = (await examAction({ action: "addExam", slug: "ch1", title: "بالآخر", minutes: 60, initData: init })).chapters[0].exams.at(-1);
  assert.equal((await order()).at(-1), fresh.id);
});

test("النسخة الجديدة: صور نسخة الطالب، وPDF للجواب، وما تصير جاهزة وهي ناقصة", async () => {
  const init = sign(1);
  const form = (o: Record<string, any>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x); return f; };
  const e = (await examAction({ action: "addExam", slug: "ch1", title: "نسخة كاملة", minutes: 60, initData: init })).chapters[0].exams.at(-1);
  await examAction({ action: "addVersion", id: e.id, initData: init });
  const v = (await get("SELECT id FROM bank_versions WHERE exam_id=?", e.id))!.id as number;
  await assert.rejects(examUpload(form({ initData: init, action: "pagesAr", id: v, file: new Blob(["%PDF-1.7 x"]) })), /صورة/);
  await assert.rejects(examUpload(form({ initData: init, action: "answerPdf", id: v, file: png() })), /PDF/);
  await examUpload(form({ initData: init, action: "addQuestion", id: v, mark: 50, q: png() }));
  await denied(async () => await examAction({ action: "ok", id: v, initData: init }), 400);                  // المجموع مو 100
  await examUpload(form({ initData: init, action: "addQuestion", id: v, mark: 50, q: png() }));
  await denied(async () => await examAction({ action: "ok", id: v, initData: init }), 400);                  // ماكو جواب نموذجي
  const r = await examUpload(form({ initData: init, action: "answerPdf", id: v, file: new Blob(["%PDF-1.7 x"]) }));
  assert.equal(r.chapters[0].exams.at(-1).versions[0].answerPdf.endsWith(".pdf"), true);
  await denied(async () => await examAction({ action: "ok", id: v, initData: init }), 400);                  // ماكو صور نسخة الطالب
  const up = await examUpload(form({ initData: init, action: "pagesAr", id: v, file: [png(), png()] }));
  assert.equal(up.chapters[0].exams.at(-1).versions[0].pagesAr.length, 2);
  await examAction({ action: "ok", id: v, initData: init });
  assert.equal((await get("SELECT ok FROM bank_versions WHERE id=?", v))!.ok, 1);
  await examAction({ action: "addVersion", id: e.id, initData: init });                                       // هسه تنضاف اللي بعدها
  assert.equal((await get("SELECT COUNT(*) n FROM bank_versions WHERE exam_id=?", e.id))!.n, 2);
});

test("الرفع: يفحص نوع الملف من محتواه، وبالصلاحية بس", async () => {
  const form = (o: Record<string, any>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x); return f; };
  await assert.rejects(examUpload(form({ initData: sign(2), action: "replaceQ", id: 1, file: png() })), (e: any) => e.status === 403);
  await assert.rejects(examUpload(form({ initData: sign(1), action: "replaceQ", id: 1, file: new Blob(["<script>alert(1)</script>"]) })), /صورة/);
  await assert.rejects(examUpload(form({ initData: sign(1), action: "pdfAr", id: 1, file: png() })), /PDF/);
  
  await examUpload(form({ initData: sign(1), action: "replaceQ", id: 1, file: png() }));
  const q = (await get("SELECT * FROM bank_questions WHERE id=1"))!;
  assert.match(q.q_file, /^uploads\/[\w-]+\.png$/);
  assert.equal(q.edited, 1);
  await examUpload(form({ initData: sign(1), action: "addQuestion", id: 1, mark: 30, q: png() }));
  const n = (await get("SELECT * FROM bank_questions WHERE version_id=1 ORDER BY n DESC LIMIT 1"))!;
  assert.deepEqual([n.n, n.max_mark], [3, 30]);
  await examUpload(form({ initData: sign(1), action: "pdfAr", id: 1, file: new Blob(["%PDF-1.7 x"]) }));
  assert.match((await get("SELECT pdf_ar FROM bank_versions WHERE id=1"))!.pdf_ar, /^uploads\/.*\.pdf$/);
});

test("الملفات السرية: بالرمز والصلاحية بس، وما يطلع خارج مجلد المحتوى", async () => {
  const t = fileToken(1);
  assert.equal(verifyFileToken(t), 1);
  assert.equal(verifyFileToken(t.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), null);
  assert.equal(verifyFileToken(fileToken(1, Date.now() / 1000 - 7200)), null);                     // انتهى
  const ok = await examFile(t, "ch1/e1/A/q1.png");
  assert.equal(ok.type, "image/png");
  await assert.rejects(examFile("x", "ch1/e1/A/q1.png"), (e: any) => e.status === 401);
  await assert.rejects(examFile(fileToken(2), "ch1/e1/A/q1.png"), (e: any) => e.status === 403);   // طالب عنده رمز
  for (const evil of ["../secret.png", "..\\secret.png", "ch1/../../secret.png", path.join(tmp, "secret.png")]) {
    await assert.rejects(examFile(t, evil), (e: any) => e.status === 403, evil);
  }
  await assert.rejects(examFile(t, "ch1/note.txt"), (e: any) => e.status === 403);                 // نوع غير مسموح
  await assert.rejects(examFile(t, "ch1/none.png"), (e: any) => e.status === 404);
});

test("الروابط الفعلية للصفحة: المنع والنجاح", async () => {
  const post = async (b: any) => await POST(new Request("http://x/api/exams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
  assert.equal((await post({ action: "list" })).status, 401);
  assert.equal((await post({ action: "list", initData: sign(2) })).status, 403);
  const r = await post({ action: "list", initData: sign(1) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.ok(j.fileToken && j.chapters.length);
  assert.equal((await GET(new Request("http://x/api/exams/file?ref=ch1/e1/A/q1.png"))).status, 401);
  const f = await GET(new Request(`http://x/api/exams/file?ref=ch1/e1/A/q1.png&t=${encodeURIComponent(j.fileToken)}`));
  assert.equal(f.status, 200);
  assert.equal(f.headers.get("x-content-type-options"), "nosniff");
  assert.match(f.headers.get("cache-control")!, /no-store/);
});

test("ملفات الجواب الكاملة: تنربط بنسختها، والمرفوع من اللوحة يبقى، وتنفتح بالصفحة", async () => {
  const { linkAnswerFiles } = await import("../lib/answerFiles.ts");
  const dir = fs.mkdtempSync(path.join(tmp, "answers-"));
  fs.mkdirSync(path.join(dir, "1"));
  fs.writeFileSync(path.join(dir, "1", "A 1.pdf"), "%PDF-1.7 full");
  await run("INSERT INTO bank_versions(exam_id, model, ok, answer_pdf) VALUES(1, 'K', 1, 'uploads/mine.pdf'), (1, 'L', 1, NULL)");
  await run("UPDATE bank_versions SET answer_pdf=NULL WHERE exam_id=1 AND model='A'");
  const r = await linkAnswerFiles(dir, "ch1");
  assert.deepEqual([r.sent, r.kept, r.missing.includes("1 L")], [1, 1, true]);
  const ref = (await get("SELECT answer_pdf FROM bank_versions WHERE exam_id=1 AND model='A'"))!.answer_pdf;
  assert.equal(ref, "answers/ch1/e1/A.pdf");
  assert.equal((await get("SELECT answer_pdf FROM bank_versions WHERE exam_id=1 AND model='K'"))!.answer_pdf, "uploads/mine.pdf");
  const f = await examFile(fileToken(1), ref);
  assert.equal(f.type, "application/pdf");
  await run("DELETE FROM bank_versions WHERE exam_id=1 AND model IN ('K','L')");
  assert.deepEqual((await linkAnswerFiles(dir, "ch1")).sent, 0);                // الإعادة ما ترفع مرة ثانية
});
