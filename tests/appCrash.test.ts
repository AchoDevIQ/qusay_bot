// أعطال تطبيق الطلاب: الخطأ يوصل للأستاذ باسم الطالب ونوع تلفونه، مرة وحدة باليوم لنفس الخطأ، واللي انفتح وما وصل للرئيسية = علگ
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-crash-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const sent: any[] = [];
globalThis.fetch = (async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }) as typeof fetch;
const { appReport, stuckTick, crashesOf } = await import("../lib/appCrash.ts");
const { initDb, put, find } = await import("../lib/db.ts");
const { stamp } = await import("../lib/util.ts");
const { addMinutes } = await import("../lib/scheduleRules.ts");
await initDb();
await put("students", { user_id: 900, name: "علي حسن", exam: "إلكتروني", created: "x" });
const dev = { model: "Samsung SM-A105F", os: "Android 9 (SDK 28)", ver: "2.4.1", screen: "", error: "", stack: "", fatal: false };

test("خطأ: يوصل للأستاذ باسمه وتلفونه مرة وحدة باليوم، ويطلع بملفه", async () => {
  await appReport({ ...dev, kind: "home", install: "inst-aaaa-1111", uid: 900 });   // أول مرة دز رمزه: التلفون انربط باسمه
  sent.length = 0;
  await appReport({ ...dev, kind: "crash", install: "inst-aaaa-1111", uid: null, screen: "/exams", error: "Null check operator used on a null value", fatal: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, 1);
  assert.match(sent[0].text, /انسد عند طالب[\s\S]*علي حسن \(900\)[\s\S]*SM-A105F[\s\S]*Android 9[\s\S]*\/exams[\s\S]*Null check/);
  await appReport({ ...dev, kind: "crash", install: "inst-aaaa-1111", uid: null, error: "Null check operator used on a null value" });
  assert.equal(sent.length, 1);
  assert.equal((await crashesOf(900)).length, 2);
  assert.deepEqual(await appReport({ ...dev, kind: "crash", install: "bad id!", uid: null }), { ok: false });
});

test("انفتح وما وصل للرئيسية بعشر دقايق: خبر «ما فتح»؛ واللي وصل ما يوصل خبره", async () => {
  await appReport({ ...dev, kind: "start", install: "inst-bbbb-2222", uid: null });
  await appReport({ ...dev, kind: "start", install: "inst-cccc-3333", uid: null });
  await appReport({ ...dev, kind: "home", install: "inst-cccc-3333", uid: 900 });
  sent.length = 0;
  assert.equal(await stuckTick(), 0);   // بعده ما مرت عشر دقايق
  const n = await stuckTick(addMinutes(stamp(), 11));
  assert.equal(n, 1);
  assert.match(sent[0].text, /ما فتح عند طالب[\s\S]*ما مسجل دخول/);
  assert.equal(await stuckTick(addMinutes(stamp(), 12)), 0);
  void find;
});
