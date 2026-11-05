// التصحيح، ورفع الفصول من الصفحة، والامتحان الاختياري، ومفتاح المؤقت
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-grade-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { gradeAction } = await import("../lib/gradeApi.ts");
const { uploadAction, uploadFile } = await import("../lib/uploadApi.ts");
const { myExamAction, schedAdminAction } = await import("../lib/schedApi.ts");
const { notifyStarted } = await import("../lib/examRoom.ts");
const { schedSettings } = await import("../lib/schedApi.ts");
const { adminHomeAction } = await import("../lib/adminHomeApi.ts");
const { homeToken, cronKey } = await import("../lib/webAuth.ts");
const { initDb, find, insert, one, put, update } = await import("../lib/db.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const g = (uid: number, action: string, x: object = {}) => gradeAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const exam = async (kind = "mandatory") => {
  const e = await insert("bank_exams", { slug: "t", chapter: "فصل التجربة", ord: Math.floor(Math.random() * 1e6), title: "امتحان " + kind, info: "", minutes: 60, pos: 1 });
  const v = await insert("bank_versions", { exam_id: e, model: "A", kind, ok: 1 });
  for (const [n, m] of [[1, 40], [2, 60]]) await insert("bank_questions", { version_id: v, n, max_mark: m, q_file: `t/q${n}.png` });
  return { e, v };
};
const paper = async (uid: number, e: number, v: number) => {
  const id = await insert("sched_items", { user_id: uid, exam_id: e, at: "2026-01-01 10:00", status: "done", version_id: v, started_at: "2026-01-01 10:00", submitted_at: "2026-01-01 10:30" });
  await insert("exam_answers", { item_id: id, q: 1, file: "student_answers/x.jpg", created: "x" });
  return id;
};

test("التصحيح: الصلاحية، أول مصحح ياخذ الورقة، الدرجة بحدودها، والمجموع يوصل للطالب وولي أمره", async () => {
  await put("staff", { user_id: 20, name: "مصحح", perms: "grade" });
  await put("staff", { user_id: 21, name: "ثاني", perms: "grade" });
  await put("staff", { user_id: 22, name: "بدون", perms: "orders" });
  await put("students", { user_id: 50, name: "علي حسن محمد كاظم", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
  await put("guardians", { guardian_id: 51, student_id: 50, created: "x" });
  await assert.rejects(g(22, "list"), (x: any) => x.status === 403);
  const { e, v } = await exam();
  const id = await paper(50, e, v);
  const tiles = (await adminHomeAction({ action: "list", initData: sign(20) })).groups.flatMap((t: any) => t.tiles);
  assert.match(tiles.find((t: any) => t.page === "grade").note, /1 ورقة/);
  const opened = await g(20, "open", { id });
  assert.equal(opened.paper.questions.length, 2);
  assert.deepEqual(opened.paper.questions[0].answers, ["student_answers/x.jpg"]);
  await assert.rejects(g(21, "open", { id }), /مصحح ثاني/);
  assert.equal((await g(21, "list")).waiting.length, 0);        // اختفت من الباقين
  await assert.rejects(g(21, "mark", { id, q: 1, mark: 5 }), /مصحح ثاني/);
  await assert.rejects(g(20, "mark", { id, q: 1, mark: 41 }), /من 0 إلى 40/);
  await assert.rejects(g(20, "mark", { id, q: 1, mark: 1.5 }), /رقم كامل/);
  await g(20, "mark", { id, q: 1, mark: 30 });
  await assert.rejects(g(20, "finish", { id }), /باقي درجة/);
  await g(20, "mark", { id, q: 2, mark: 45 });
  calls.length = 0;
  const done = await g(20, "finish", { id });
  assert.match(done.notice, /75 من 100/);
  assert.ok(calls.some((c) => c.p.chat_id === 50 && /75/.test(c.p.text)));
  assert.ok(calls.some((c) => c.p.chat_id === 51 && /75/.test(c.p.text)));
  assert.equal((await one("sched_items", { id }))!.total, 75);
  await assert.rejects(g(20, "mark", { id, q: 1, mark: 1 }), /مخلصة/);
  assert.equal(done.done[0].id, id);
  const rel = await paper(50, e, v);
  await g(20, "open", { id: rel });
  await g(20, "mark", { id: rel, q: 1, mark: 1 });
  await g(20, "release", { id: rel });
  assert.equal((await find("question_marks", { item_id: rel })).length, 0);
  assert.equal((await g(21, "list")).waiting.length, 1);
});

test("أوراق التجربة: لصاحب البوت بس، وما توصل رسالة، وتنمسح", async () => {
  await assert.rejects(g(20, "makeTests"), (x: any) => x.status === 403);
  const withPdf = await exam();
  await update("bank_versions", { id: withPdf.v }, { answer_pdf: "answers/t/e1/A.pdf" });
  const made = await g(1, "makeTests");
  const pdfPaper = made.waiting.find((p: any) => p.test && p.title === "امتحان mandatory" && p.model === "A" && p.id);
  const views = await Promise.all(made.waiting.filter((p: any) => p.test).map((p: any) => g(1, "open", { id: p.id })));
  assert.ok(pdfPaper && views.some((v: any) => v.paper.whole[0] === "answers/t/e1/A.pdf"));   // ورقة الطالب = ملف الحلول
  for (const v of views) await g(1, "release", { id: v.paper.id });
  assert.ok(made.hasTests);
  const t = made.waiting.find((p: any) => p.test);
  await g(1, "open", { id: t.id });
  const qs = (await g(1, "open", { id: t.id })).paper.questions;
  for (const q of qs) await g(1, "mark", { id: t.id, q: q.n, mark: q.max });
  calls.length = 0;
  await g(1, "finish", { id: t.id });
  assert.equal(calls.length, 0);
  const gone = await g(1, "deleteTests");
  assert.equal(gone.hasTests, false);
  assert.equal((await find("sched_items", {}, { where: (i) => i.user_id < 0 })).length, 0);
});

const up = async (uid: number, ref: string, body = "x") => {
  const f = new FormData();
  f.set("initData", sign(uid)); f.set("path", ref); f.set("file", new Blob([body]), "f");
  return await uploadFile(f);
};
test("رفع فصل من الصفحة: صاحب البوت بس، مسارات محددة، ويدخل على دفعات ويربط الحلول", async () => {
  await assert.rejects(up(20, "ch7/catalog.json"), (x: any) => x.status === 403);
  await assert.rejects(up(1, "../secret.json"), /مسار/);
  await assert.rejects(up(1, "ch7/../../x.png"), /مسار/);
  await assert.rejects(up(1, "ch7/a.exe"), /مسار/);
  const exams = [1, 2, 3, 4].map((ord) => ({ ord, title: `ع${ord}`, info: "", minutes: 75, versions: [{ model: "A", ok: true, issues: [], has_en: true, questions: [{ n: 1, max: 100, q: "q1.png", a: [] }] }, { model: "B", kind: "optional", ok: true, issues: [], has_en: true, questions: [{ n: 1, max: 100, q: "q1.png", a: [] }] }] }));
  await up(1, "ch7/catalog.json", JSON.stringify({ chapter: "الفصل السابع", slug: "ch7", exams }));
  await up(1, "answers/ch7/e2/A.pdf", "pdf");
  const u = (action: string, x: object = {}) => uploadAction({ initData: sign(1), action, slug: "ch7", ...x }) as Promise<any>;
  assert.ok((await u("have")).names.includes("ch7/catalog.json"));
  const s = await u("start");
  assert.equal(s.total, 4);
  const a = await u("part", { from: 0 });
  assert.equal(a.done, 3);
  assert.equal((await find("bank_exams", { slug: "ch7" })).length, 3);   // الدفعة ما تمسح شي
  assert.equal((await u("part", { from: a.done })).done, 4);
  const rows = await find("bank_exams", { slug: "ch7" });
  assert.equal(rows.length, 4);
  const e2 = rows.find((r) => r.ord === 2)!;
  const vs = await find("bank_versions", { exam_id: e2.id }, { order: ["model"] });
  assert.equal(vs[0].answer_pdf, "answers/ch7/e2/A.pdf");
  assert.equal(vs[1].kind, "optional");
});

test("الاختياري: مرة وحدة بوقته، ما يأثر على الجدول، وينسد من الإعدادات", async () => {
  const { e } = await exam();
  await update("bank_exams", { id: e }, { chapter: "فصل الاختياري" });
  await insert("bank_versions", { exam_id: e, model: "O", kind: "optional", ok: 1 });
  const o = (await find("bank_versions", { exam_id: e, model: "O" }))[0];
  await insert("bank_questions", { version_id: o.id, n: 1, max_mark: 100, q_file: "t/q.png" });
  await put("students", { user_id: 60, name: "علي حسن محمد كاظم", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
  const act = (action: string, x: object = {}) => myExamAction({ token: homeToken(60), action, ...x }) as Promise<any>;
  assert.equal((await act("info")).optional.length, 0);               // ما اشترى
  await put("exam_access", { user_id: 60, chapter: "فصل الاختياري", order_id: 1, created: "1" });
  const info = await act("info");
  assert.deepEqual(info.optional.map((x: any) => x.exam), [e]);
  const before = info.remaining;
  const r = await act("openOptional", { exam: e });
  assert.equal(r.room.questions.length, 1);
  assert.equal(r.remaining, before);                                  // الإجباري باقي بالجدول
  assert.equal(r.optional.length, 0);
  await assert.rejects(act("openOptional", { exam: e }), /مو متاح/);
  const it = (await find("sched_items", { user_id: 60, kind: "optional" }))[0];
  assert.equal(it.version_id, o.id);
  await schedAdminAction({ action: "save", initData: sign(1), window: 15, extra: 15, perDay: 2, gap: 30, holidayStart: "", holidayDays: 0, excluded: "", blockedHours: [], optionalOpen: false });
  await put("students", { user_id: 61, name: "علي حسن محمد كاظم", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
  await put("exam_access", { user_id: 61, chapter: "فصل الاختياري", order_id: 1, created: "1" });
  const closed = await myExamAction({ token: homeToken(61), action: "info" }) as any;
  assert.equal(closed.optional.length, 0);
  await assert.rejects(myExamAction({ token: homeToken(61), action: "openOptional", exam: e }), /مسدودة/);
  await schedAdminAction({ action: "save", initData: sign(1), window: 15, extra: 15, perDay: 2, gap: 30, holidayStart: "", holidayDays: 0, excluded: "", blockedHours: [], optionalOpen: true });
});

test("رابط المؤقت: بالمفتاح بس، وصاحب البوت بس يشوفه", async () => {
  const s = await schedSettings();
  await assert.rejects(notifyStarted("bad", s), (x: any) => x.status === 401);
  const r = await notifyStarted(cronKey(), s);
  assert.equal(typeof r.sent, "number");
  const page: any = await schedAdminAction({ action: "list", initData: sign(1) });
  assert.ok(page.cronUrl.endsWith(cronKey()));
  await put("staff", { user_id: 23, name: "إعداد", perms: "schedule" });
  const staffPage: any = await schedAdminAction({ action: "list", initData: sign(23) });
  assert.equal(staffPage.cronUrl, "");
});
