// الاعتراضات: الطالب يعترض على سؤال بكتابة أو صوت، والمصحح يغير الدرجة (ينقبل) أو يرفض، والطالب يوصله الرد
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
const { initDb, find, insert, one, put } = await import("../lib/db.ts");
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
const object = (uid: number, item: number, x: Record<string, string | Blob>) => {
  const f = new FormData(); f.set("token", homeToken(uid)); f.set("pf", "ios"); f.set("device", "dev-" + String(uid).padStart(14, "0")); f.set("action", "object"); f.set("item", String(item));
  for (const [k, v] of Object.entries(x)) f.set(k, v);
  return submitObjection(f) as Promise<any>;
};

const e = await insert("bank_exams", { slug: "ch2", chapter: "الفصل الثاني", ord: 1, title: "امتحان الاعتراض", info: "", minutes: 60, pos: 1 });
const v = await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
await insert("bank_questions", { version_id: v, n: 1, max_mark: 50, q_file: "t/q1.png" });
await insert("bank_questions", { version_id: v, n: 2, max_mark: 50, q_file: "t/q2.png" });
await put("staff", { user_id: 30, name: "مصحح", perms: "grade" });
const item = await insert("sched_items", { user_id: 60, exam_id: e, at: "x", status: "done", version_id: v, submitted_at: "x" });

test("بعد الدرجة يوصل للطالب زر ورقته المصححة (والاعتراض من داخلها)، وما يگدر يعترض قبل التصحيح", async () => {
  await assert.rejects(object(60, item, { qs: "1", text_1: "x" }), /لسه ما انصحح/);
  await g(30, "open", { id: item });
  await g(30, "mark", { id: item, q: 1, mark: 30 });
  await g(30, "mark", { id: item, q: 2, mark: 40 });
  calls.length = 0;
  await g(30, "finish", { id: item });
  const btn = calls.find((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.text === "📂 شوف ورقتك المصححة");
  assert.ok(btn, "زر الورقة");
  assert.equal(btn!.p.reply_markup.inline_keyboard.length, 1);
  assert.equal(btn!.p.chat_id, 60);
  assert.match(btn!.p.reply_markup.inline_keyboard[0][0].web_app.url, new RegExp(`/store/myexams\\?.*&paper=${item}$`));
});

test("الطالب يعترض بالكتابة بس (الصوت ما ينقبل)، كل سؤال مرة وحدة، والخبر يوصل لصاحب البوت", async () => {
  await assert.rejects(object(60, item, {}), /اختار السؤال/);
  await assert.rejects(object(60, item, { qs: "1" }), /اكتب سبب اعتراضك على السؤال 1/);
  await assert.rejects(object(61, item, { qs: "1", text_1: "x" }), /غير موجود/);
  calls.length = 0;
  await assert.rejects(object(60, item, { qs: "2", voice_2: new File([new Uint8Array([1, 2, 3])], "v", { type: "audio/mp4" }) }), /اكتب سبب اعتراضك على السؤال 2/);
  const r = await object(60, item, { qs: "1,2", text_1: "جوابي صحيح <بالطريقة الثانية>", text_2: "نسيتوا الخطوة الثانية", voice_2: new File([new Uint8Array([1, 2, 3])], "v", { type: "audio/mp4" }) });
  assert.match(r.notice, /وصل اعتراضك/);
  assert.deepEqual(r.obj.questions.map((q: any) => q.obj.status), ["open", "open"]);
  const rows = await find("objections", { item_id: item });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((o) => o.q === 2)!.voice, null);
  assert.equal(rows.find((o) => o.q === 1)!.old_mark, 30);
  // المصحح ما عنده صلاحية الاعتراضات، فالخبر يروح لصاحب البوت بس
  assert.deepEqual(calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id), [1]);
  assert.match(calls[0].p.text, /اعتراض جديد[\s\S]*على السؤال: 1، 2/);
  // صاحب البوت يفتح صفحة الاعتراضات مالته
  assert.match(calls[0].p.reply_markup.inline_keyboard[0][0].web_app.url, /\/store\/objections/);
  await assert.rejects(object(60, item, { qs: "1", text_1: "مرة ثانية" }), /اعترضت على السؤال 1 من قبل/);
});

test("المصحح بدون صلاحية الاعتراضات ما يشوفها، وصاحب البوت يشوفها", async () => {
  assert.equal((await g(30, "list")).objections.length, 0);
  await assert.rejects(g(30, "openObj", { id: item }), (x: any) => x.status === 403);
  const own = await g(1, "list");
  assert.deepEqual(own.objections.map((p: any) => p.qs), [[1, 2]]);
});

test("تغيير الدرجة يعني قبول، واللي ما تغير لازم ينرفض، والرد يوصل للطالب", async () => {
  await put("staff", { user_id: 30, name: "مصحح", perms: "grade,objections" });
  const open = await g(30, "openObj", { id: item });
  assert.equal(open.paper.objections.length, 2);
  // بس السؤال المعترض عليه تتغير درجته، والدرجة الأصلية ما تتغير لحد الحفظ
  await g(30, "mark", { id: item, q: 1, mark: 45 });
  assert.equal((await one("question_marks", { item_id: item, q: 1 }))!.mark, 30);
  assert.equal((await g(30, "prepare", { id: item })).total, 85);
  await assert.rejects(g(30, "decide", { id: item }), /ارفض اعتراض السؤال: 2/);
  await put("guardians", { guardian_id: 160, student_id: 60, created: "x" });
  await put("students", { user_id: 60, name: "علي حسن محمد كاظم", exam: "إلكتروني", created: "x" });
  calls.length = 0;
  const f = new FormData();
  f.set("initData", sign(30)); f.set("action", "decide"); f.set("id", String(item)); f.set("rejects", JSON.stringify({ 2: "الخطوة الأخيرة غلط" }));
  f.append("photo", new File([new Uint8Array([255, 216, 255])], "p0.jpg"));
  const r = await gradeUpload(f) as any;
  assert.match(r.notice, /1 انقبل، 1 انرفض. الدرجة 85/);
  assert.equal((await one("sched_items", { id: item }))!.total, 85);
  assert.equal((await one("question_marks", { item_id: item, q: 1 }))!.mark, 45);
  const sent = calls.find((c) => c.p.chat_id === "60" || c.p.chat_id === 60)!;
  assert.ok(sent, "الرد يوصل للطالب");
  const text = String(sent.p.caption ?? sent.p.text ?? JSON.stringify(sent.p));
  assert.match(text, /انقبل اعتراضك/);
  // ولي الأمر: الاسم الرباعي والامتحان والدرجة الجديدة بس، بدون السبب ولا الأسئلة
  const gm = calls.filter((c) => Number(c.p.chat_id) === 160);
  assert.equal(gm.length, 1);
  assert.match(gm[0].p.text, /درجة الطالب <b>علي حسن محمد كاظم<\/b> في امتحان <b>امتحان الاعتراض<\/b> صارت <b>85<\/b> من 100/);
  assert.doesNotMatch(gm[0].p.text, /السؤال|السبب|الخطوة/);
  const info = await objectionInfo(60, item);
  assert.deepEqual(info.questions.map((q: any) => q.obj.status), ["accepted", "rejected"]);
  assert.equal(info.questions[1].obj.reason, "الخطوة الأخيرة غلط");
  assert.equal(info.total, 85);
  // بعد الرد ما تنفتح مرة ثانية
  await assert.rejects(g(30, "openObj", { id: item }), /الورقة مخلصة/);
  assert.equal((await g(30, "list")).objections.length, 0);
});

test("اعتراض تجربة: صاحب البوت بس، وعلى ورقة تجربة مصححة", async () => {
  const t = await insert("sched_items", { user_id: -1, exam_id: e, at: "x", status: "done", version_id: v, submitted_at: "x", grader_id: 1, total: 70, graded_at: "x" });
  await assert.rejects(g(30, "testObj", { id: t }), (x: any) => x.status === 403);
  await assert.rejects(g(1, "testObj", { id: item }), /أوراق التجربة/);
  const r = await g(1, "testObj", { id: t });
  assert.match(r.notice, /اعتراض تجربة/);
  assert.ok(r.objections.some((p: any) => p.id === t));
  calls.length = 0;
  await g(1, "openObj", { id: t });
  await g(1, "decide", { id: t, rejects: { 1: "", 2: "" } });
  // طالب التجربة: الرد يوصل لصاحب البوت، وفوكه اسم الطالب
  assert.ok(calls.some((c) => Number(c.p.chat_id) === 1 && /رد المصحح على اعتراضك/.test(c.p.text ?? c.p.caption ?? "")));
  assert.ok(calls.some((c) => /الرسالة الجاية توصل لـ/.test(c.p.text ?? "")));
});

test("حتى السؤال اللي أخذ درجته الكاملة ينعترض عليه", async () => {
  await put("students", { user_id: 64, name: "كامل", exam: "إلكتروني", created: "x" });
  const full = await insert("sched_items", { user_id: 64, exam_id: e, at: "x", status: "done", version_id: v, submitted_at: "x" });
  await g(30, "open", { id: full });
  await g(30, "mark", { id: full, q: 1, mark: 50 });
  await g(30, "mark", { id: full, q: 2, mark: 20 });
  await g(30, "finish", { id: full });
  const r = await object(64, full, { qs: "1,2", text_1: "انطيتوني كاملة بس أشوف بيها غلط", text_2: "جوابي صحيح" });
  assert.match(r.notice, /وصل اعتراضك/);
});
