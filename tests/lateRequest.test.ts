// الامتحان الفايت: الطالب يطلب بعذره، والطلب يوصل لأصحاب الصلاحية ويا موافق وغير موافق
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-late-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { askException, exceptionCb } = await import("../lib/lateRequest.ts");
const { initDb, insert, put, one } = await import("../lib/db.ts");
const { schedSettings } = await import("../lib/schedApi.ts");
const { addMinutes } = await import("../lib/scheduleRules.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const s = await schedSettings();
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 75, pos: 1 });
await put("staff", { user_id: 30, name: "علي المساعد", perms: "exception" });
await put("staff", { user_id: 31, name: "مصحح", perms: "grade" });
await put("students", { user_id: 70, name: "حسين", exam: "الكتروني", created: "x" });
const late = (min: number) => insert("sched_items", { user_id: 70, exam_id: ex, at: addMinutes(stamp(), -min), status: "waiting" });
const sentTo = (m: string) => calls.filter((c) => c.method === m).map((c) => c.p.chat_id).sort();

test("ما ينطلب إلا للفايت، والعذر لازم", async () => {
  const notYet = await insert("sched_items", { user_id: 70, exam_id: ex, at: addMinutes(stamp(), 60), status: "waiting" });
  await assert.rejects(askException(70, notYet, "مريض", s), /مو فايت/);
  const it = await late(30);
  await assert.rejects(askException(70, it, " ", s), /اكتب عذرك/);
  await assert.rejects(askException(71, it, "مريض", s), /غير موجود/);
});

test("الطلب يوصل لصاحب البوت واللي عنده الصلاحية بس، ويا زرين، ومرة وحدة", async () => {
  const it = await late(30);
  calls.length = 0;
  await askException(70, it, "جنت بالمستشفى", s);
  assert.deepEqual(sentTo("sendMessage"), [1, 30]);
  const m = calls[0].p;
  assert.match(m.text, /حسين[\s\S]*الأوميگا[\s\S]*ما دخل[\s\S]*جنت بالمستشفى/);
  assert.deepEqual(m.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), [`ek:ok:${it}`, `ek:no:${it}`]);
  await assert.rejects(askException(70, it, "مرة ثانية", s), /من قبل/);
  // اللي ما عنده صلاحية ما يگدر يوافق
  assert.equal(await exceptionCb(31, 31, 5, `ek:ok:${it}`), "ما عندك صلاحية");
  // موافق: ينفتح ويوصل الطالب خبر، والرسالة تتعدل باسم اللي وافق
  calls.length = 0;
  assert.match(await exceptionCb(30, 30, 5, `ek:ok:${it}`), /انفتح/);
  const row = (await one("sched_items", { id: it }))!;
  assert.deepEqual([row.status, row.exc_state, row.exc_by], ["exception", "approved", 30]);
  assert.deepEqual(sentTo("sendMessage"), [70]);
  assert.match(calls.find((c) => c.method === "editMessageText")!.p.text, /وافق عليه: علي المساعد/);
  // صاحب البوت يدوس بعدين على نفس الطلب: ما يصير شي
  calls.length = 0;
  assert.match(await exceptionCb(1, 1, 6, `ek:no:${it}`), /من قبل/);
  assert.equal(sentTo("sendMessage").length, 0);
});

test("غير موافق: يوصل الطالب خبر الرفض والامتحان يبقى مسدود", async () => {
  const it = await late(40);
  await askException(70, it, "نسيت", s);
  calls.length = 0;
  assert.match(await exceptionCb(1, 1, 7, `ek:no:${it}`), /انرفض/);
  const row = (await one("sched_items", { id: it }))!;
  assert.deepEqual([row.status, row.exc_state], ["missed", "rejected"]);
  assert.deepEqual(sentTo("sendMessage"), [70]);
  assert.match(calls.find((c) => c.method === "sendMessage")!.p.text, /انرفض طلب فتح امتحان الأوميگا/);
});
