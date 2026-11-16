// محادثة البوت بالتطبيق: رسائل طالب التطبيق تنحفظ بدل تليگرام، والمربوط بتليگرام توصله بالاثنين،
// والطالب يرد من الصفحة بالكتابة والأزرار كأنها من تليگرام
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-chat-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

// تليگرام وهمي: نسجل كل طلب يروحله
const calls: { method: string; body: any }[] = [];
let nextMid = 500;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const method = String(url).split("/").pop()!;
  let body: any = {};
  try { body = JSON.parse(String(init?.body ?? "{}")); } catch { body = {}; }
  calls.push({ method, body });
  const result = method === "getMe" ? { username: "qbot" } : method.startsWith("send") ? { message_id: ++nextMid, chat: { id: body.chat_id } } : true;
  return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { find, one, put } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { send, edit, api } = await import("../lib/telegram.ts");
const { chatList } = await import("../lib/appChat.ts");
const { chatAction } = await import("../lib/appChatApi.ts");
const { homeToken, appKey } = await import("../lib/webAuth.ts");
await ensure();

const APP = 10_000_000_000_007, TG = 7_000_111;
await put("students", { user_id: APP, name: "طالب تطبيق", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00:00" });
await put("app_links", { fu: "fuT", uid: TG, env: "prod", chapters: "[]", created: "x", updated: "x" });

test("طالب التطبيق بس: الرسالة تنحفظ وما تروح لتليگرام، والتعديل والمسح ينطبقون", async () => {
  calls.length = 0;
  const r: any = await send(APP, "<b>أهلاً</b>", { kb: [[{ text: "زر", callback_data: "x:1" }]] });
  assert.ok(r?.message_id);
  assert.equal(calls.length, 0, "ولا طلب لتليگرام");
  let l = await chatList(APP);
  assert.equal(l.msgs.length, 1);
  assert.equal(l.msgs[0].text, "<b>أهلاً</b>");
  assert.equal(l.msgs[0].html, true);
  assert.deepEqual(l.msgs[0].kb, [[{ text: "زر", callback_data: "x:1" }]]);
  await edit(APP, r.message_id, "تعدلت");
  l = await chatList(APP);
  assert.equal(l.msgs[0].text, "تعدلت");
  assert.equal(l.msgs[0].kb, null);
  await api("deleteMessage", { chat_id: APP, message_id: r.message_id });
  assert.equal((await chatList(APP)).msgs.length, 0);
  await send(APP, "قائمة", { replyKb: { keyboard: [[{ text: "🏠 فتح القائمة" }]], resize_keyboard: true } });
  assert.deepEqual((await chatList(APP)).kb, [[{ text: "🏠 فتح القائمة" }]]);
});

test("المربوط بتليگرام: توصله بتليگرام وتنحفظ بالتطبيق برقمها هناك", async () => {
  calls.length = 0;
  const r: any = await send(TG, "درجتك 95");
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 1);
  const rows = await find("app_msgs", { uid: TG });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].tg), r.message_id);
  await edit(TG, r.message_id, "درجتك 96");
  assert.equal((await one("app_msgs", { uid: TG }))?.text, "درجتك 96");
});

test("الطالب الثاني (بس تليگرام) ما ينحفظله شي", async () => {
  await send(9_999_001, "هلا");
  assert.equal((await find("app_msgs", { uid: 9_999_001 })).length, 0);
});

test("من الصفحة: بس بمفتاح التطبيق، والكتابة توصل للبوت ورده يطلع", async () => {
  const auth = { token: homeToken(APP), app: appKey(APP) };
  await assert.rejects(chatAction({ token: homeToken(APP), app: "x".repeat(32), action: "list" }), /التطبيق/);
  const r: any = await chatAction({ ...auth, action: "text", text: "/start" });
  const mine = r.msgs.filter((m: any) => m.dir === "in");
  assert.equal(mine.at(-1).text, "/start");
  assert.ok(r.msgs.some((m: any) => m.dir === "out" && m.id > mine.at(-1).id), "البوت رد");
  assert.equal(calls.filter((c) => c.body?.chat_id === APP).length, 0, "ولا رسالة لتليگرام");
});

test("السؤال العلمي: رسالة الطالب من التطبيق تنعاد للمجموعة، وجواب الأستاذ يوصله بمحتواه", async () => {
  const { saveIn, FAKE_MID } = await import("../lib/appChat.ts");
  const { kvSet } = await import("../lib/db.ts");
  await kvSet("q_group", "-100777");
  const inId = await saveIn(APP, "شلون أحل هذا؟", [{ t: "photo", s: "x", f: "PHOTO_ID" }]);
  calls.length = 0;
  const r: any = await api("copyMessage", { chat_id: -100777, from_chat_id: APP, message_id: FAKE_MID + inId, message_thread_id: 9 });
  assert.ok(r?.message_id);
  const sent = calls.find((c) => c.method === "sendPhoto");
  assert.equal(sent?.body.photo, "PHOTO_ID");
  assert.equal(sent?.body.caption, "شلون أحل هذا؟");
  assert.equal(sent?.body.message_thread_id, 9);
  assert.ok(!calls.some((c) => c.method === "copyMessage"), "ما ينطلب نسخ من تليگرام");
  // جواب الأستاذ من المجموعة لطالب التطبيق: يتحول لمكان مخفي حتى نعرف محتواه، وينمسح
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, body });
    const result = method === "forwardMessage" ? { message_id: 77, text: "الجواب: x = 3", chat: { id: body.chat_id } } : true;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    calls.length = 0;
    await api("copyMessage", { chat_id: APP, from_chat_id: -100777, message_id: 55, reply_markup: { inline_keyboard: [[{ text: "✅ فهمت", callback_data: "qok:1" }]] } });
    assert.ok(calls.some((c) => c.method === "forwardMessage" && c.body.chat_id === -100777));
    assert.ok(calls.some((c) => c.method === "deleteMessage" && c.body.message_id === 77));
    const last = (await chatList(APP)).msgs.at(-1)!;
    assert.equal(last.text, "الجواب: x = 3");
    assert.deepEqual(last.kb, [[{ text: "✅ فهمت", callback_data: "qok:1" }]]);
  } finally { globalThis.fetch = realFetch; }
});

test("الفويس مسدود من البداية، وينفتح من صفحة «شنو يشوف الطالب»", async () => {
  const { voiceAllowed } = await import("../lib/appChat.ts");
  const { kvSet } = await import("../lib/db.ts");
  assert.equal(await voiceAllowed(APP), false);
  await kvSet("student_vis", JSON.stringify({ voice: { mode: "some", students: [APP] } }));
  assert.equal(await voiceAllowed(APP), true);
  assert.equal(await voiceAllowed(TG), false);
  assert.equal((await chatList(APP)).voice, true);
});
