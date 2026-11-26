// 🤖 مراجعة تصحيح الذكاء: «بعد ما أراجعها» تحجز الورقة، التعديل قبل الموافقة بصمت، الموافقة توصلها، والمدة توصلها وحدها
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-airev-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const sent: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  sent.push({ method: String(url).split("/").pop()!, p: JSON.parse(init?.body ?? "{}") });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { initDb, find, insert, one, put } = await import("../lib/db.ts");
await initDb();
const R = await import("../lib/aiReview.ts");
const { finishByAi } = await import("../lib/gradeApi.ts");
const { AI_GRADER } = await import("../lib/data.ts");
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  params.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update("1:test").digest()).update(check).digest("hex"));
  return params.toString();
};
const act = (action: string, x: object = {}) => R.aiReviewAction({ initData: sign(1), action, ...x }) as Promise<any>;

test("🤖 «بعد ما أراجعها»: تنحجز، أعدلها بصمت، الموافقة توصلها، والمدة توصل الباقي وحدها", async () => {
  const e = await insert("bank_exams", { slug: "r", chapter: "الفصل الأول", ord: 1, title: "امتحان المراجعة", info: "", minutes: 60, pos: 1 });
  const v = await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
  for (const [n, m] of [[1, 40], [2, 60]]) await insert("bank_questions", { version_id: v, n, max_mark: m, q_file: `t/q${n}.png` });
  const paper = async (uid: number) => {
    await put("students", { user_id: uid, name: `طالب ${uid} علي حسن`, curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
    const id = await insert("sched_items", { user_id: uid, exam_id: e, at: "2026-11-20 16:00", status: "done", version_id: v, grader_id: AI_GRADER, started_at: "x", submitted_at: "x" });
    await insert("exam_answers", { item_id: id, q: 1, file: "student_answers/x.jpg", created: "x" });
    await put("question_marks", { item_id: id, q: 1, mark: 30 });
    await put("question_marks", { item_id: id, q: 2, mark: 50 });
    return id;
  };
  const a = await paper(71), b = await paper(72);
  // الأصل «مباشرة»: توصل
  const c = await paper(73);
  assert.equal(await R.aiFinish(finishByAi, AI_GRADER, c), "✅ انحفظت الدرجة 80 من 100");
  // «بعد ما أراجعها»: تنحجز وما توصل
  await act("cfg", { mode: "before", hours: 24 });
  sent.length = 0;
  assert.equal(await R.aiFinish(finishByAi, AI_GRADER, a), "held");
  assert.ok(!(await one("sched_items", { id: a }))!.graded_at, "ما وصلت للطالب");
  assert.ok(!sent.some((x) => String(x.p.chat_id) === "71"), "الطالب ما وصله شي");
  await R.aiFinish(finishByAi, AI_GRADER, b);
  assert.ok(sent.some((x) => String(x.p.chat_id) === "1" && /خلص مجموعة/.test(String(x.p.text ?? ""))), "صاحب البوت انبلغ: المجموعة جاهزة");
  // المجموعة: الورقتين المحجوزتين ويا اللي وصلت
  const list = await act("list");
  const g = list.groups.find((x: any) => x.exam === e);
  assert.equal(g.count, 3); assert.equal(g.held, 2);
  const open = await act("group", { key: g.key });
  assert.equal(open.papers.length, 3);
  assert.ok(open.papers.find((p: any) => p.id === a).held);
  // تعديل المحجوزة: بصمت
  sent.length = 0;
  const s = await act("save", { item: a, marks: { 2: 60 } });
  assert.equal(s.saved.total, 90);
  assert.ok(!sent.some((x) => String(x.p.chat_id) === "71"));
  await assert.rejects(act("save", { item: a, marks: { 2: 70 } }), /بين 0 و60/);
  // تعديل الواصلة: بصمت هم (طلبه 2026-11-27)، والمجموعة تگول بيها تعديل ينتظر
  await act("save", { item: c, marks: { 1: 40 } });
  assert.ok(!sent.some((x) => String(x.p.chat_id) === "73"));
  assert.equal((await act("group", { key: g.key })).group.pending, 1);
  // «📤 دز للطلاب»: المحجوزة توصل (بالدرجة بعد التعديل)، والواصلة يوصلها «تعديل درجة»
  sent.length = 0;
  const appr = await act("approve", { key: g.key });
  assert.match(appr.notice, /2 درجة و1 تعديل درجة/);
  assert.ok(sent.some((x) => String(x.p.chat_id) === "73" && /تعديل درجة/.test(String(x.p.text ?? x.p.caption ?? ""))));
  assert.equal((await act("group", { key: g.key })).group.pending, 0);
  assert.equal(Number((await one("sched_items", { id: a }))!.total), 90);
  assert.ok((await one("sched_items", { id: b }))!.graded_at);
  // المدة: ورقة ثانية تنحجز، وبعد 24 ساعة توصل وحدها
  const d = await paper(74);
  await R.aiFinish(finishByAi, AI_GRADER, d);
  assert.equal(await R.releaseTick("2000-01-01 00:00"), 0, "بعده وقتها");
  assert.equal(await R.releaseTick("2099-01-01 00:00"), 1, "خلصت المدة");
  assert.ok((await one("sched_items", { id: d }))!.graded_at);
  // رجوع لـ«مباشرة»: المحجوزة توصل هسه
  const f = await paper(75);
  await R.aiFinish(finishByAi, AI_GRADER, f);
  await act("cfg", { mode: "after", hours: 24 });
  assert.ok((await one("sched_items", { id: f }))!.graded_at);
  assert.equal(Object.keys(await R.heldMap()).length, 0);
  // بلا صلاحية: ممنوع
  await assert.rejects(R.aiReviewAction({ initData: sign(99), action: "list" }));
  assert.ok((await find("sched_items", { exam_id: e })).every((x) => x.graded_at));
});

test("✏️ تعديل التصحيح على الورقة: تبديل علامة، شيلها، إضافة علامته، والرجوع", async () => {
  const qg = await import("../lib/qusayGrade.ts");
  const pages = [{ ref: "p1.jpg", marks: [{ x: 100, y: 200, kind: "bad" as const, text: "", q: 1, i: 0, note: "غلط" }, { x: 300, y: 400, kind: "ok" as const, text: "", q: 1, i: 1 }] }];
  await qg.fixMark(900, "1:0:bad", "ok", "صح، بس رتبها");
  await qg.addMark(900, "p1.jpg", 500, 600, "half", "نص");
  let out = qg.applyEdits(pages, await qg.markEdits(900));
  assert.equal(out[0].marks[0].kind, "ok"); assert.equal(out[0].marks[0].note, "صح، بس رتبها"); assert.equal(out[0].marks[0].fixed, "1:0:bad");
  assert.equal(out[0].marks.length, 3); assert.equal(out[0].marks[2].kind, "half"); assert.equal(out[0].marks[2].added, 0);
  await qg.hideMark(900, "1:1:ok");
  out = qg.applyEdits(qg.dropHidden(pages, await qg.hiddenMarks(900)), await qg.markEdits(900));
  assert.equal(out[0].marks.length, 2, "انشالت وحدة");
  await qg.dropAdded(900, 0);
  assert.equal(qg.applyEdits(pages, await qg.markEdits(900))[0].marks.length, 2);
  await assert.rejects(qg.addMark(900, "p1.jpg", 5000, 1, "ok", ""), /مكان العلامة/);
  await qg.resetMarks(900);
  assert.deepEqual(qg.applyEdits(pages, await qg.markEdits(900)), pages);
  assert.deepEqual(await qg.hiddenMarks(900), []);
});
