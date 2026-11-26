// إشعار على شاشة تلفون طالب التجربة: رسالة بالمحادثة وإشعار جديد، وما يطلع إذا هو داخل المحادثة
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-push-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { put, kvGet, kvSet } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { announceAction } = await import("../lib/notices.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { beforeTelegram } = await import("../lib/appChat.ts");
const push = await import("../lib/appPush.ts");
await ensure();
const admin = `tk:${homeToken(1)}`;
const A = 10_000_000_000_060, B = 10_000_000_000_061, C = 10_000_000_000_062;
await put("students", { user_id: A, name: "علي حسن", curr: "عربي", gender: "بنين", exam: "إلكتروني", created: "x" });
await put("students", { user_id: B, name: "زينب علي", curr: "إنجليزي", gender: "بنات", exam: "إلكتروني", created: "x" });
await put("students", { user_id: C, name: "حسين كريم", curr: "إنجليزي", gender: "بنين", exam: "إلكتروني", created: "x" });
await kvSet("app_pilot", JSON.stringify([A, B]));
const tok = (n: number) => `tok-${n}-abcdefghijklmnopqrstuvwxyz`;
for (const u of [A, B, C]) assert.equal(await push.savePushToken(u, tok(u)), true);
const sent: { token: string; m: any }[] = [];
let reply: "ok" | "gone" | "fail" = "ok";
push.setPushSender(async (token, m) => { sent.push({ token, m }); return reply; });

test("رمز التلفون الغلط ما ينحفظ", async () => {
  assert.equal(await push.savePushToken(A, "قصير"), false);
  assert.equal(await push.savePushToken(A, "a b".repeat(20)), false);
  assert.equal(await kvGet(`app_push_${A}`), tok(A));
});

test("إشعار جديد: يطلع على تلفون طلاب التجربة اللي يوصلهم بس", async () => {
  sent.length = 0;
  const r: any = await announceAction({ initData: admin, action: "send", text: "بكرة <b>عطلة</b>", kind: "temp", aud: "all" });
  assert.deepEqual(sent.map((s) => s.token).sort(), [tok(A), tok(B)]);
  assert.equal(sent[0].m.type, "bot_notice");
  assert.equal(sent[0].m.body, "بكرة عطلة");
  assert.match(r.notice, /2 طالب/);
  sent.length = 0;
  await announceAction({ initData: admin, action: "send", text: "للإنجليزي", kind: "temp", aud: "some", rule: JSON.stringify({ curr: "إنجليزي" }) });
  assert.deepEqual(sent.map((s) => s.token), [tok(B)]);
});

test("رسالة بالمحادثة: إشعار واحد للرسائل ورا بعض، وما يطلع إذا هو فاتح المحادثة", async () => {
  sent.length = 0;
  await beforeTelegram("sendMessage", { chat_id: A, text: "<b>درجتك</b> 90" });
  await beforeTelegram("sendMessage", { chat_id: A, text: "ثانية" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].m.type, "bot_chat");
  assert.equal(sent[0].m.body, "درجتك 90");
  // غير طالب تجربة: ما يطلعله
  await beforeTelegram("sendMessage", { chat_id: C, text: "هلا" });
  assert.equal(sent.length, 1);
  // فاتح المحادثة
  await push.noteChatIn(B);
  await beforeTelegram("sendMessage", { chat_id: B, text: "هلا" });
  assert.equal(sent.length, 1);
});

test("التطبيق انمسح من التلفون: الرمز ينمسح", async () => {
  reply = "gone";
  assert.equal(await push.pushApp(C, { title: "x", body: "y", type: "bot_chat" }), false);
  assert.equal(await kvGet(`app_push_${C}`), null);
  reply = "ok";
});

test("🧾 تم الشراء: إشعار يوصل دائماً، يفتح المحادثة، ورسالة الوصل اللي وراه ما تطلع إشعار ثاني", async () => {
  sent.length = 0;
  await push.noteChatIn(B);
  assert.equal(await push.purchasePush(B, "الفصل الأول - محاضرات فقط", "40,000"), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].m.type, "bot_chat");
  assert.match(sent[0].m.title, /تم الشراء/);
  assert.match(sent[0].m.body, /الفصل الأول.*40,000.*مشترياتي/);
  await beforeTelegram("sendMessage", { chat_id: B, text: "🧾 وصل شرائك" });
  assert.equal(sent.length, 1);
});

test("🟢 بدأ الامتحان: يوصل دائماً حتى لو فاتح المحادثة، وإشعار المحادثة ما يتكرر وياه", async () => {
  sent.length = 0;
  await push.noteChatIn(B);
  assert.equal(await push.examPush(B, "امتحان الفصل الأول <b>1</b>", 15), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].m.type, "bot_exam");
  assert.match(sent[0].m.title, /بدأ امتحانك: امتحان الفصل الأول 1/);
  assert.match(sent[0].m.body, /15 دقيقة/);
  // رسالة المحادثة اللي وراه ما تطلع إشعار ثاني
  await beforeTelegram("sendMessage", { chat_id: B, text: "🟢 بدأ امتحانك" });
  assert.equal(sent.length, 1);
  // غير طالب تجربة: لا
  assert.equal(await push.examPush(C, "x", 15), false);
});
