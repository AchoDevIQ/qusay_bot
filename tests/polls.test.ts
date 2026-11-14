// التصويت: الفئة (المراكز والجنس)، صوت واحد لكل حساب بعد «متأكد؟»، النتيجة الكاملة لصاحب البوت، والنسب بس للطلاب إذا وافق
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-poll-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.ANTHROPIC_API_KEY;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { pollAction, pollCb, percents, openFor } = await import("../lib/polls.ts");
const { gradeAction } = await import("../lib/gradeApi.ts");
const { penTextOn, readInk } = await import("../lib/inkText.ts");
const { initDb, insert, put, find } = await import("../lib/db.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const pa = (uid: number, action: string, x: object = {}) => pollAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const area = await insert("areas", { gov: "بغداد", name: "البنوك" });
const banook = await insert("centers", { area_id: area, name: "مركز البنوك", gender: null });
const mansour = await insert("centers", { area_id: area, name: "المنصور", gender: null });
await put("staff", { user_id: 30, name: "مساعد التصويت", perms: "polls" });
await put("staff", { user_id: 31, name: "مصحح", perms: "grade" });
for (const [uid, name, center, gender] of [[60, "علي", banook, "بنين"], [61, "زينب", banook, "بنات"], [62, "حسن", mansour, "بنين"], [63, "سارة", null, "بنات"], [64, "بلا جنس", banook, null]] as const) {
  await put("students", { user_id: uid, name, exam: center ? "حضوري" : "إلكتروني", center_id: center, gender, created: "x" });
}
const sentTo = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort((a, b) => a - b);

test("النسب تنجمع 100", () => {
  assert.deepEqual(percents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(percents([0, 0]), [0, 0]);
  assert.deepEqual(percents([3, 1, 0]), [75, 25, 0]);
});

test("الصفحة لصاحب البوت واللي عنده صلاحية 🗳 بس", async () => {
  await assert.rejects(pa(31, "list"), (e: any) => e.status === 403);
  const r = await pa(30, "list");
  assert.ok(r.centers.some((c: any) => c.name === "مركز البنوك"));
  assert.ok(r.centers.some((c: any) => c.id === -1));
  await assert.rejects(pa(1, "create", { question: "س", options: ["أ"] }), /اختيارين/);
});

test("يوصل بس لفئته: مركز البنوك بنين", async () => {
  calls.length = 0;
  const r = await pa(1, "create", { question: "شنو أحسن يوم؟", options: ["السبت", "الأحد", "الاثنين"], centers: [banook], gender: "بنين" });
  assert.match(r.notice, /لـ 1 من 1 طالب/);
  assert.deepEqual(sentTo(), [60]);
  assert.equal(calls[0].p.reply_markup.inline_keyboard.length, 3);
  assert.equal((await openFor(60)).length, 1);
  assert.equal((await openFor(61)).length, 0);
});

test("الطالب يختار، يطلعله متأكد؟، يدوس نعم، وصوته ما يتغير ومن حسابه بس", async () => {
  const p = (await pa(1, "list")).polls[0];
  calls.length = 0;
  assert.equal(await pollCb(60, 60, 5, `pv:${p.id}:1`), "");
  assert.match(calls[0].p.text, /هل أنت متأكد/);
  assert.equal(calls[0].p.reply_markup.inline_keyboard[0][0].callback_data, `pk:${p.id}:1`);
  assert.equal((await find("poll_votes")).length, 0, "قبل التأكيد ماكو صوت");
  await pollCb(60, 60, 5, `pb:${p.id}`);
  assert.equal(await pollCb(60, 60, 5, `pk:${p.id}:1`), "✅ انحسب صوتك");
  assert.equal(await pollCb(60, 60, 5, `pk:${p.id}:0`), "صوتت قبل، والصوت ما يتغير");
  assert.equal(await pollCb(60, 60, 5, `pv:${p.id}:2`), "صوتت قبل، والصوت ما يتغير");
  const v = await find("poll_votes");
  assert.equal(v.length, 1);
  assert.equal(v[0].choice, 1);
  // اللي مو من الفئة ما يگدر يصوت حتى لو وصله الزر
  assert.equal(await pollCb(61, 61, 5, `pk:${p.id}:0`), "هذا التصويت مو إلك");
  assert.equal((await openFor(60)).length, 0);
});

test("الإنهاء: النتيجة كاملة بالأسماء لصاحب البوت والمساعد، وسؤال النشر", async () => {
  const p = (await pa(1, "list")).polls[0];
  calls.length = 0;
  await pa(1, "close", { id: p.id });
  assert.deepEqual(sentTo(), [1, 30]);
  assert.match(calls[0].p.text, /انتهى التصويت[\s\S]*صوّت <b>1<\/b> من 1[\s\S]*الأحد<\/b> · 1 صوت \(100%\)[\s\S]*علي · مركز البنوك[\s\S]*تريد تظهر النتيجة للطلاب/);
  assert.equal(calls[0].p.reply_markup.inline_keyboard[0][0].callback_data, `pr:${p.id}:1`);
  // بعد الإنهاء ماكو تصويت
  await put("students", { user_id: 65, name: "متأخر", center_id: banook, gender: "بنين", created: "x" });
  assert.equal(await pollCb(65, 65, 5, `pk:${p.id}:0`), "التصويت انتهى");
});

test("النشر: الطلاب يوصلهم النسب بس، ومرة وحدة، والمصحح ما يگدر يقرر", async () => {
  const p = (await pa(1, "list")).polls[0];
  assert.equal(await pollCb(31, 31, 7, `pr:${p.id}:1`), "ما عندك صلاحية");
  calls.length = 0;
  assert.match(await pollCb(1, 1, 7, `pr:${p.id}:1`), /انرسلت لـ 2 طالب/);
  const toStudents = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(toStudents.map((c) => c.p.chat_id).sort(), [60, 65]);
  assert.match(toStudents[0].p.text, /نتيجة التصويت[\s\S]*الأحد: <b>100%<\/b>/);
  assert.doesNotMatch(toStudents[0].p.text, /علي|صوت \(/);
  assert.equal(await pollCb(1, 1, 7, `pr:${p.id}:1`), "انرسلت قبل");
});

test("الكل: بنات بس، والطالب اللي ما مسجل جنسه ما يوصله", async () => {
  calls.length = 0;
  await pa(30, "create", { question: "تحبون مراجعة؟", options: ["إي", "لا"], centers: [], gender: "بنات" });
  assert.deepEqual(sentTo(), [61, 63]);
  calls.length = 0;
  await pa(30, "create", { question: "الكل", options: ["إي", "لا"], centers: [-1], gender: "" });
  assert.deepEqual(sentTo(), [63]);
  const r = await pa(30, "delete", { id: (await pa(30, "list")).polls[0].id });
  assert.equal(r.polls.length, 2);
});

test("القلم: كل مصحح يختار لنفسه، وبدون مفتاح الكتابة تبقى قلم", async () => {
  await put("staff", { user_id: 32, name: "مصحح ثاني", perms: "grade" });
  assert.equal((await gradeAction({ initData: sign(31), action: "penText", on: true }) as any).penText, true);
  assert.equal(await penTextOn(31), true);
  assert.equal(await penTextOn(32), false);
  assert.equal((await gradeAction({ initData: sign(31), action: "list" }) as any).penText, true);
  assert.equal((await gradeAction({ initData: sign(32), action: "list" }) as any).penText, false);
  await gradeAction({ initData: sign(31), action: "penText", on: false });
  assert.equal(await penTextOn(31), false);
  await assert.rejects(readInk("data:image/png;base64,iVBORw0KGgo="), /مفتاح/);
  await assert.rejects(readInk("not an image"), /ما وصلت/);
});
