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
const { get, initDb, run } = await import("../lib/db.ts");
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
  await examAction({ action: "mark", id: 1, value: 15, initData: init });
  assert.equal((await get("SELECT max_mark FROM bank_questions WHERE id=1"))!.max_mark, 15);
  await denied(async () => await examAction({ action: "mark", id: 1, value: "12.5", initData: init }), 400);
  await denied(async () => await examAction({ action: "mark", id: 1, value: "1; DROP TABLE exams", initData: init }), 400);
  await denied(async () => await examAction({ action: "minutes", id: 1, value: 1, initData: init }), 400);
  await denied(async () => await examAction({ action: "nothing", initData: init }), 400);
  const r = await examAction({ action: "addExam", slug: "ch1", title: "جديد <b>", minutes: 90, initData: init });
  assert.equal(r.chapters[0].exams.length, 2);
  const e = r.chapters[0].exams[1];
  await examAction({ action: "addVersion", id: e.id, initData: init });
  const v = (await get("SELECT * FROM bank_versions WHERE exam_id=?", e.id))!;
  assert.deepEqual([v.model, v.ok, v.kind], ["A", 0, "mandatory"]);
  await examAction({ action: "addVersion", id: e.id, kind: "optional", initData: init });
  assert.equal((await get("SELECT kind FROM bank_versions WHERE exam_id=? AND model='B'", e.id))!.kind, "optional");   // إضافة للاختياري
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

test("الرفع: يفحص نوع الملف من محتواه، وبالصلاحية بس", async () => {
  const form = (o: Record<string, any>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x); return f; };
  await assert.rejects(examUpload(form({ initData: sign(2), action: "replaceQ", id: 1, file: png() })), (e: any) => e.status === 403);
  await assert.rejects(examUpload(form({ initData: sign(1), action: "replaceQ", id: 1, file: new Blob(["<script>alert(1)</script>"]) })), /صورة/);
  await assert.rejects(examUpload(form({ initData: sign(1), action: "pdfAr", id: 1, file: png() })), /PDF/);
  await assert.rejects(examUpload(form({ initData: sign(1), action: "addQuestion", id: 1, mark: 20, q: png() })), /صورة الجواب/);
  await examUpload(form({ initData: sign(1), action: "replaceQ", id: 1, file: png() }));
  const q = (await get("SELECT * FROM bank_questions WHERE id=1"))!;
  assert.match(q.q_file, /^uploads\/[\w-]+\.png$/);
  assert.equal(q.edited, 1);
  await examUpload(form({ initData: sign(1), action: "addQuestion", id: 1, mark: 30, q: png(), a: [png(), png()] }));
  const n = (await get("SELECT * FROM bank_questions WHERE version_id=1 ORDER BY n DESC LIMIT 1"))!;
  assert.deepEqual([n.n, n.max_mark, JSON.parse(n.a_files).length], [3, 30, 2]);
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
