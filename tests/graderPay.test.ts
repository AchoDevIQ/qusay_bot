// تنظيم التصحيح: الامتحانات مجمعة، فصول كل مصحح، السجل، وتعويض المصحح
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-ob-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method: String(url).split("/").pop()!, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { gradeAction, gradeUpload } = await import("../lib/gradeApi.ts");
const { objectionInfo, submitObjection } = await import("../lib/objections.ts");
const { examFile } = await import("../lib/examApi.ts");
const { initDb, find, insert, one, put, update } = await import("../lib/db.ts");
const { homeToken, fileToken } = await import("../lib/webAuth.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const g = (uid: number, action: string, x: object = {}) => gradeAction({ initData: sign(uid), action, ...x }) as Promise<any>;
void find; void one; void objectionInfo; void submitObjection; void examFile; void homeToken; void fileToken; void gradeUpload;

const e1 = await insert("bank_exams", { slug: "ch1", chapter: "الفصل الأول", ord: 1, title: "الثوابت", info: "", minutes: 60, pos: 1 });
const e2 = await insert("bank_exams", { slug: "ch2", chapter: "الفصل الثاني", ord: 1, title: "القطع المكافئ", info: "", minutes: 60, pos: 2 });
const v1 = await insert("bank_versions", { exam_id: e1, model: "A", kind: "mandatory", ok: 1 });
const v2 = await insert("bank_versions", { exam_id: e2, model: "A", kind: "mandatory", ok: 1 });
await insert("bank_questions", { version_id: v1, n: 1, max_mark: 100, q_file: "t/q1.png" });
await insert("bank_questions", { version_id: v2, n: 1, max_mark: 100, q_file: "t/q1.png" });
await put("staff", { user_id: 30, name: "مصحح", perms: "grade" });
const paper = (uid: number, v: number, ex: number, kind: string | null = null) => insert("sched_items", { user_id: uid, exam_id: ex, at: "x", status: "done", version_id: v, submitted_at: "x", kind });
const a1 = await paper(70, v1, e1), a2 = await paper(71, v1, e1), b1 = await paper(72, v2, e2, "optional");

test("الأوراق تطلع مجمعة حسب الامتحان، والمصحح يشوف بس فصوله", async () => {
  const all = await g(30, "list");
  assert.deepEqual(all.groups.map((x: any) => [x.title, x.count]), [["الثوابت", 2], ["القطع المكافئ", 1]]);
  await g(1, "setRate", { grader: 30, mandatory: 200, optional: 150, deduct: 50, chapters: ["الفصل الثاني"] });
  const mine = await g(30, "list");
  assert.deepEqual(mine.groups.map((x: any) => x.title), ["القطع المكافئ"]);
  assert.deepEqual(mine.waiting.map((x: any) => x.id), [b1]);
  await assert.rejects(g(30, "open", { id: a1 }), /مو من مواضيعك/);
  await assert.rejects(g(30, "setRate", { grader: 30, mandatory: 1 }), (x: any) => x.status === 403);
  await assert.rejects(g(1, "setRate", { grader: 30, mandatory: -5 }), /رقم كامل/);
  // كل الفصول = بدون تقييد
  await g(1, "setRate", { grader: 30, mandatory: 200, optional: 150, deduct: 50, chapters: ["الفصل الأول", "الفصل الثاني"] });
  assert.equal((await g(30, "list")).groups.length, 2);
});

test("الرصيد: أجر كل ورقة ناقص الاعتراضات المقبولة، والتسوية تصفره وتنحفظ", async () => {
  for (const id of [a1, a2, b1]) { await g(30, "open", { id }); await g(30, "mark", { id, q: 1, mark: 60 }); await g(30, "finish", { id }); }
  await insert("objections", { item_id: a1, user_id: 70, q: 1, text: "x", status: "accepted", old_mark: 60, new_mark: 70, created: "x" });
  const pay = (await g(1, "pay")).pay;
  const c = pay.graders.find((x: any) => x.id === 30);
  assert.deepEqual([c.mand, c.opt, c.obj, c.amount], [2, 1, 1, 2 * 200 + 150 - 50]);
  assert.deepEqual((await g(30, "pay")).pay.graders.map((x: any) => x.id), [30]);
  await assert.rejects(g(30, "settle", { grader: 30 }), (x: any) => x.status === 403);
  const r = await g(1, "settle", { grader: 30 });
  assert.match(r.notice, /500 دينار/);
  const after = r.pay.graders.find((x: any) => x.id === 30);
  assert.deepEqual([after.amount, after.archive.length, after.archive[0].amount], [0, 1, 500]);
  await assert.rejects(g(1, "settle", { grader: 30 }), /ماكو شي ينحاسب/);
});

test("سجل التصحيح: المصحح أوراقه، وصاحب البوت الكل، ويا حالة الاعتراض", async () => {
  const h = (await g(30, "history")).history;
  assert.equal(h.count, 3);
  assert.equal(h.rows.find((x: any) => x.id === a1).objOk, 1);
  await put("staff", { user_id: 31, name: "ثاني", perms: "grade" });
  assert.equal((await g(31, "history")).history.count, 0);
  assert.equal((await g(1, "history")).history.count, 3);
});

test("صفحة المساعدين: اللي إله على التصحيح يطلع جنب اسمه، والدفع يصفره ويوصله خبر", async () => {
  const { staffAction } = await import("../lib/staffApi.ts");
  const c = await insert("sched_items", { user_id: 73, exam_id: e2, at: "x", status: "done", version_id: v2, submitted_at: "x" });
  await g(30, "open", { id: c }); await g(30, "mark", { id: c, q: 1, mark: 80 }); await g(30, "finish", { id: c });
  const page = await staffAction({ initData: sign(1), action: "list" }) as any;
  const me = page.staff.find((x: any) => x.id === 30);
  assert.equal(me.grade.amount, 200);
  assert.ok(page.staff.find((x: any) => x.id === 31).grade, "اللي عنده التصحيح عنده محفظة");
  await staffAction({ initData: sign(1), action: "gradeRate", id: 30, mandatory: 300, optional: 150, deduct: 50, chapters: ["الفصل الثاني"] });
  calls.length = 0;
  const r = await staffAction({ initData: sign(1), action: "gradePay", id: 30 }) as any;
  assert.match(r.notice, /300 دينار/);
  assert.equal(r.staff.find((x: any) => x.id === 30).grade.amount, 0);
  assert.ok(calls.some((x) => x.p.chat_id === 30 && /دفعلك 300 دينار/.test(x.p.text)));
  await assert.rejects(staffAction({ initData: sign(30), action: "gradePay", id: 30 }), (x: any) => x.status === 403);
});

test("المواضيع: صاحب البوت يشيل موضوع من المصحح داخل فصله، فما تطلعله أوراقه", async () => {
  const e3 = await insert("bank_exams", { slug: "ch2", chapter: "الفصل الثاني", ord: 2, title: "القطع الناقص", info: "", minutes: 60, pos: 2 });
  const v3 = await insert("bank_versions", { exam_id: e3, model: "A", kind: "mandatory", ok: 1 });
  await insert("bank_questions", { version_id: v3, n: 1, max_mark: 100, q_file: "t/q1.png" });
  const p1 = await paper(80, v2, e2), p2 = await paper(81, v3, e3);
  await g(1, "setRate", { grader: 30, mandatory: 200, optional: 150, deduct: 50, chapters: ["الفصل الثاني"], off: [e3] });
  const mine = await g(30, "list");
  assert.deepEqual(mine.groups.map((x: any) => x.title), ["القطع المكافئ"]);
  assert.ok(mine.waiting.some((x: any) => x.id === p1));
  await assert.rejects(g(30, "open", { id: p2 }), /مو من مواضيعك/);
  await assert.rejects(g(1, "setRate", { grader: 30, off: [99999] }), /موضوع غير معروف/);
  assert.deepEqual((await g(1, "pay")).pay.graders.find((x: any) => x.id === 30).off, [e3]);
  // صاحب البوت يشوف كل شي
  assert.ok((await g(1, "list")).groups.some((x: any) => x.title === "القطع الناقص"));
});

test("الدفع بدون خصم: الاعتراضات تنحسب بس ما تنخصم، وتنحفظ إنها بدون خصم", async () => {
  await put("staff", { user_id: 33, name: "مصحح ثالث", perms: "grade" });
  await g(1, "setRate", { grader: 33, mandatory: 200, optional: 150, deduct: 50, chapters: [] });
  const p = await paper(76, v1, e1);
  await g(33, "open", { id: p }); await g(33, "mark", { id: p, q: 1, mark: 60 }); await g(33, "finish", { id: p });
  await insert("objections", { item_id: p, user_id: 76, q: 1, text: "x", status: "accepted", old_mark: 60, new_mark: 70, created: "x" });
  calls.length = 0;
  const r = await g(1, "settle", { grader: 33, forgive: true });
  assert.match(r.notice, /200 دينار، بدون خصم/);
  assert.match(calls.find((c) => c.p.chat_id === 33)!.p.text, /1 اعتراض انقبل وما انخصم/);
  const a = r.pay.graders.find((x: any) => x.id === 33).archive[0];
  assert.deepEqual([a.amount, a.obj, a.forgiven], [200, 1, true]);
});

test("المصحح يوصله خبر من تجي أوراق من فصوله، ومرة وحدة لحد ما تجي أوراق جديدة", async () => {
  const { notifyGraders } = await import("../lib/graderPay.ts");
  await put("staff", { user_id: 34, name: "مصحح رابع", perms: "grade" });
  await g(1, "setRate", { grader: 34, mandatory: 1, optional: 1, deduct: 0, chapters: ["الفصل الثاني"] });
  await insert("sched_items", { user_id: 77, exam_id: e2, at: "x", status: "done", version_id: v2, submitted_at: "2026-11-06 10:00" });
  calls.length = 0;
  await notifyGraders();
  const mine = calls.filter((c) => c.p.chat_id === 34);
  assert.equal(mine.length, 1);
  assert.match(mine[0].p.text, /وصلتك أوراق للتصحيح[\s\S]*عندك هسه <b>\d+<\/b> ورقة تنتظر/);
  calls.length = 0;
  await notifyGraders();
  assert.equal(calls.filter((c) => c.p.chat_id === 34).length, 0);
});

test("أماكن المصحح: الجدول العام بالمركز والوقت، والخاص بخيار، ولوحته مقسمة عام وخاص", async () => {
  const area = await insert("areas", { gov: "بغداد", name: "البنوك", active: 1 });
  const c1 = await insert("centers", { area_id: area, name: "معهد البنوك", active: 1 });
  await put("place_slots", { center_id: c1, slots: JSON.stringify([{ d: 5, t: "11:00" }, { d: 5, t: "14:00" }]) });
  await put("staff", { user_id: 35, name: "مصحح البنوك", perms: "grade" });
  // سبت 2026-11-07: الساعة 11 و2، وطالب خاص
  for (const [uid, at] of [[90, "2026-11-07 11:00"], [91, "2026-11-07 14:00"]] as const) {
    await put("schedules", { user_id: uid, mode: "general", center_id: c1, created: "x" });
    await insert("sched_items", { user_id: uid, exam_id: e1, at, status: "done", version_id: v1, submitted_at: "x" });
  }
  await put("schedules", { user_id: 92, mode: "private", created: "x" });
  await insert("sched_items", { user_id: 92, exam_id: e1, at: "2026-11-08 18:00", status: "done", version_id: v1, submitted_at: "x" });
  const names = async () => new Set((await g(35, "list")).waiting.map((p: any) => p.id));
  const ids = new Map<number, number>();
  for (const u of [90, 91, 92]) ids.set(u, (await find("sched_items", { user_id: u }))[0].id);
  const tree = (await g(1, "pay")).pay.places;
  assert.deepEqual(tree.find((a: any) => a.id === area).centers[0].slots, [{ d: 5, t: "11:00" }, { d: 5, t: "14:00" }]);
  await assert.rejects(g(1, "setRate", { grader: 35, mandatory: 1, optional: 1, deduct: 0, chapters: [], places: { all: false, keys: ["c999"], private: true } }), /مكان أو وقت غير معروف/);
  // بس البنوك الساعة 11، وبدون الخاص
  await g(1, "setRate", { grader: 35, mandatory: 1, optional: 1, deduct: 0, chapters: [], places: { all: false, keys: [`c${c1}|5|11:00`], private: false } });
  let got = await names();
  assert.deepEqual([got.has(ids.get(90)), got.has(ids.get(91)), got.has(ids.get(92))], [true, false, false]);
  // كل أوقات المركز ويا الخاص. الفصول والمواضيع تبقى مثل ما هي إذا ما انبعثت
  await g(1, "setRate", { grader: 35, mandatory: 1, optional: 1, deduct: 0, chapters: [], places: { all: false, keys: [`c${c1}`], private: true } });
  got = await names();
  assert.deepEqual([got.has(ids.get(90)), got.has(ids.get(91)), got.has(ids.get(92))], [true, true, true]);
  const list = await g(35, "list");
  const mineGroups = list.groups.filter((x: any) => x.exam === e1);
  assert.ok(mineGroups.some((x: any) => x.general) && mineGroups.some((x: any) => !x.general));
  // تعديل الأجور من صفحة التصحيح ما يمسح الأماكن
  await g(1, "setRate", { grader: 35, mandatory: 5, optional: 1, deduct: 0, chapters: [] });
  assert.deepEqual((await g(1, "pay")).pay.graders.find((x: any) => x.id === 35).places, { all: false, keys: [`c${c1}`], private: true });
});

test("صفحة المساعدين: جنب المصحح كم ورقة صحح اليوم وشوكت آخر ورقة", async () => {
  const { staffAction, ago } = await import("../lib/staffApi.ts");
  assert.equal(ago("2026-11-06 10:00", "2026-11-06 11:05"), "قبل 1 ساعة");
  assert.equal(ago("2026-11-06 11:00", "2026-11-06 11:05"), "قبل 5 دقيقة");
  assert.equal(ago("2026-11-06 11:05", "2026-11-06 11:05"), "هسه");
  assert.equal(ago("2026-11-04 11:05", "2026-11-06 11:05"), "قبل 2 يوم");
  const page = await staffAction({ initData: sign(1), action: "list" }) as any;
  const g = page.staff.find((s: any) => s.id === 30);
  assert.ok(g.work);
  assert.equal(typeof g.work.today, "number");
});

test("الاعتراض ينحسب على الورقة: أكثر من سؤال انقبل بنفس الورقة يبقى اعتراض واحد على المصحح", async () => {
  const { balanceOf } = await import("../lib/graderPay.ts");
  const { todayStr } = await import("../lib/util.ts");
  const before = await balanceOf(30);
  const p = await paper(76, v2, e2);
  await put("students", { user_id: 76, name: "معترض", exam: "إلكتروني", created: "x" });
  await update("sched_items", { id: p }, { grader_id: 30, graded_at: `${todayStr()} 10:00`, total: 50 });
  for (const q of [1, 2, 3]) await insert("objections", { item_id: p, user_id: 76, q, text: "x", status: "accepted", old_mark: 1, new_mark: 2, created: "x" });
  const after = await balanceOf(30);
  assert.equal(after.obj, before.obj + 1);
});

test("سجل التصحيح يوم يوم: أوراق اليوم أول، وأيام الشهر فوك، والمصحح يشوف المبلغ المستحق إله", async () => {
  const { todayStr } = await import("../lib/util.ts");
  const h = (await g(30, "history")).history;
  assert.equal(h.day, todayStr());
  assert.equal(h.days[0].d, todayStr());
  assert.equal(typeof h.due, "number");
  assert.ok(h.rows.every((r: any) => String(r.graded).startsWith(todayStr())));
  const owner = (await g(1, "history", { day: todayStr() })).history;
  assert.equal(owner.due, null);
  assert.ok(owner.rows.some((r: any) => r.name === "معترض"));
});

test("ورقة طالب التجربة تنحسب بأجر المصحح مثل الحقيقية", async () => {
  const { balanceOf } = await import("../lib/graderPay.ts");
  const before = await balanceOf(30);
  const t = await paper(-5, v2, e2);
  await update("sched_items", { id: t }, { grader_id: 30, graded_at: "x", total: 60 });
  const after = await balanceOf(30);
  assert.equal(after.mand, before.mand + 1);
  assert.equal(after.amount, before.amount + after.rate.mandatory);
});
