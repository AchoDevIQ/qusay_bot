// السكة: محاضرات كل امتحان تطلع قبله بجدول الطالب، من العنوان أو مثل ما عدلها صاحب البوت
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-lec-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { guessLectures, lecturesAction } = await import("../lib/lectures.ts");
const { myExamAction } = await import("../lib/schedApi.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const lec = (action: string, x: object = {}, uid = 1) => lecturesAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const titles = ["قطع مكافئ 1&2", "قطع مكافئ 3&4", "قطع مكافئ شامل", "الانسحاب 1&2&3", "نصف فاينل"];
const exams: number[] = [];
for (const [i, title] of titles.entries()) exams.push(await insert("bank_exams", { slug: "c2", chapter: "الفصل الثاني", ord: i + 1, title, minutes: 60, pos: 2 }));

test("المحاضرات تطلع من العنوان، والمراجعة بدون محاضرات", () => {
  assert.deepEqual(guessLectures("قطع مكافئ 1&2"), ["قطع مكافئ: المحاضرة 1", "قطع مكافئ: المحاضرة 2"]);
  assert.deepEqual(guessLectures("ديموافر المحاضرة (6)"), ["ديموافر: المحاضرة 6"]);
  assert.deepEqual(guessLectures("امتحان", "(3&4)"), ["امتحان: المحاضرة 3", "امتحان: المحاضرة 4"]);
  for (const t of ["فاينل", "قطع مكافئ شامل", "نصف فاينل (قطع مكافئ، قطع ناقص)", "Ln&E", "المتفرقات"]) assert.deepEqual(guessLectures(t), [], t);
});

test("صفحة المحاضرات لصاحب البوت بس، ويعدل محاضرات أي امتحان ويرجعها", async () => {
  await put("staff", { user_id: 30, name: "مساعد", perms: "grade" });
  await assert.rejects(lec("list", {}, 30), (e: any) => e.status === 403);
  const r = await lec("list");
  assert.deepEqual(r.chapters[0].exams.map((e: any) => e.lectures.length), [2, 2, 0, 3, 0]);
  const s = await lec("save", { exam: exams[2], lines: "مراجعة القطع\n\n  حل أسئلة  " });
  assert.deepEqual(s.chapters[0].exams[2], { id: exams[2], title: "قطع مكافئ شامل", lectures: ["مراجعة القطع", "حل أسئلة"], custom: true });
  const b = await lec("reset", { exam: exams[2] });
  assert.deepEqual(b.chapters[0].exams[2].lectures, []);
  await assert.rejects(lec("saveLink", { link: "javascript:alert(1)" }), /https/);
  assert.equal((await lec("saveLink", { link: "https://app.example/lectures" })).link, "https://app.example/lectures");
});

test("جدول الطالب: المحاضرات قبل امتحانها، والرابط بس للي مشتري محاضرات", async () => {
  await put("students", { user_id: 60, name: "طالب", exam: "إلكتروني", created: "2026-01-01 00:00:00" });
  await insert("sched_items", { user_id: 60, exam_id: exams[0], at: "2027-02-01 10:00", status: "waiting" });
  await insert("sched_items", { user_id: 60, exam_id: exams[4], at: "2027-02-02 10:00", status: "waiting" });
  const info = async () => await myExamAction({ token: homeToken(60), pf: "ios", device: "dev-00000000000060", action: "info" }) as any;
  const r = await info();
  assert.deepEqual(r.items.map((i: any) => [i.title, i.lectures]), [["قطع مكافئ 1&2", ["قطع مكافئ: المحاضرة 1", "قطع مكافئ: المحاضرة 2"]], ["نصف فاينل", []]]);
  assert.equal(r.appLink, "");   // امتحانات بس: يشوف الأسماء بدون رابط
  await insert("orders", { user_id: 60, items: JSON.stringify([{ name: "محاضرات الفصل الثاني" }]), created: "2026-01-02 00:00:00", printed: 0 });
  assert.equal((await info()).appLink, "https://app.example/lectures");
});

test("رقم المحاضرة يصير جزء من عنوان الامتحان، ومحاضراته تنقرا منه مثل قبل", async () => {
  const { lectureTitle } = await import("../lib/examBank.ts");
  assert.equal(lectureTitle("قبل x & y", "المحاضرة (1 & 2)  ·  الوقت: ساعة"), "قبل x & y المحاضرة (1 & 2)");
  assert.equal(lectureTitle("ديموافر", "المحاضرة (3)  ·  الوقت: ساعة وربع"), "ديموافر المحاضرة (3)");
  assert.equal(lectureTitle("قبل x & y", "الوقت: ساعة وربع"), "قبل x & y");
  assert.equal(lectureTitle("نصف السنة", "Mid-Year Exam"), "نصف السنة");
  assert.equal(lectureTitle("قبل x & y المحاضرة (1 & 2)", "المحاضرة (1 & 2)"), "قبل x & y المحاضرة (1 & 2)");
  assert.deepEqual(guessLectures("قبل x & y المحاضرة (1 & 2)", ""), ["قبل x & y: المحاضرة 1", "قبل x & y: المحاضرة 2"]);
  assert.deepEqual(guessLectures("قبل x & y المحاضرة (1 & 2)", ""), guessLectures("قبل x & y", "المحاضرة (1 & 2)"));
});
