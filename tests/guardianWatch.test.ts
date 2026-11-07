// متابعة ولي الأمر: زر «استلمت»، وخبر لصاحب البوت بعد ٣ درجات ما انفتحت، وكشف البلوك، وزر واتساب ولي الأمر
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-gw-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
let blockFor: number | null = null;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = JSON.parse(init.body);
  calls.push({ method, p });
  if (blockFor !== null && Number(p.chat_id) === blockFor) return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
}) as typeof fetch;

const gw = await import("../lib/guardianWatch.ts");
const { handleUpdate } = await import("../lib/bot.ts");
const { send } = await import("../lib/telegram.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
await put("students", { user_id: 90, name: "علي حسين", phone1: "07701111111", phone2: "07702223344", created: stamp() });
await put("guardians", { guardian_id: 500, student_id: 90, created: stamp() });
const item = () => insert("sched_items", { user_id: 90, exam_id: 1, status: "done", graded_at: stamp() });
const toOwner = () => calls.filter((c) => c.method === "sendMessage" && String(c.p.chat_id) === "1");

test("رقم ولي الأمر يصير رابط واتساب", () => {
  assert.equal(gw.whatsappOf("07702223344"), "https://wa.me/9647702223344");
  assert.equal(gw.whatsappOf("+964 770 222 3344"), "https://wa.me/9647702223344");
  assert.equal(gw.whatsappOf("123"), null);
});

test("٣ درجات ما انداس عليهن «استلمت»: خبر لصاحب البوت مرة وحدة، ووياه زر واتساب ولي الأمر", async () => {
  calls.length = 0;
  for (let i = 0; i < 4; i++) await gw.guardianSent(90, 500, await item());
  const msgs = toOwner();
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].p.text, /علي حسين/);
  assert.match(msgs[0].p.text, /ما فتح آخر 3/);
  assert.equal(msgs[0].p.reply_markup.inline_keyboard[0][0].url, "https://wa.me/9647702223344");
  assert.equal((await gw.guardianState(90)).unseen, 4);
});

test("ولي الأمر يدوس «استلمت»: تنصفر، وغيره ما يگدر يدوسها", async () => {
  const it = await item();
  await handleUpdate({ callback_query: { id: "c1", from: { id: 777 }, data: `gs:${it}`, message: { message_id: 3, chat: { id: 777 } } } });
  assert.equal((await gw.guardianState(90)).unseen, 4);
  calls.length = 0;
  await handleUpdate({ callback_query: { id: "c2", from: { id: 500 }, data: `gs:${it}`, message: { message_id: 3, chat: { id: 500 } } } });
  const st = await gw.guardianState(90);
  assert.equal(st.unseen, 0);
  assert.ok(st.lastSeen);
  assert.ok(calls.some((c) => c.method === "editMessageReplyMarkup"));
});

test("بلوك من تليگرام: خبر لصاحب البوت ويا الواتساب، والطالب يوصله تنبيه، ومن يرجع يفتح يوصل خبر", async () => {
  calls.length = 0;
  await handleUpdate({ my_chat_member: { chat: { id: 500, type: "private" }, from: { id: 500 }, new_chat_member: { status: "kicked" } } });
  assert.match(toOwner()[0].p.text, /سوى بلوك/);
  assert.equal(toOwner()[0].p.reply_markup.inline_keyboard[0][0].url, "https://wa.me/9647702223344");
  assert.ok(calls.some((c) => String(c.p.chat_id) === "90" && /ولي أمرك ما يستلم/.test(c.p.text)));
  assert.ok((await gw.guardianState(90)).blockedAt);
  // نفس البلوك مرة ثانية ما يكرر الخبر
  calls.length = 0;
  await handleUpdate({ my_chat_member: { chat: { id: 500, type: "private" }, from: { id: 500 }, new_chat_member: { status: "kicked" } } });
  assert.equal(toOwner().length, 0);
  await handleUpdate({ my_chat_member: { chat: { id: 500, type: "private" }, from: { id: 500 }, new_chat_member: { status: "member" } } });
  assert.match(toOwner()[0].p.text, /رجع فتح البوت/);
  assert.equal((await gw.guardianState(90)).blockedAt, null);
});

test("الدرجة ما توصل لأن ولي الأمر حاظر البوت: ينكشف البلوك حتى بدون خبر من تليگرام", async () => {
  blockFor = 500;
  await send(500, "درجة");
  calls.length = 0;
  await gw.guardianSent(90, 500, await item());
  assert.match(toOwner()[0].p.text, /سوى بلوك/);
  blockFor = null;
});
