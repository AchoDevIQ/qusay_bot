// الحماية: كل شي يوصل للطالب وولي الأمر محمي، والكادر والمجموعات بدون، وكلمة المرور تنسخ
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
const { send, upload, api } = await import("../lib/telegram.ts");
const { initDb, put } = await import("../lib/db.ts");
await initDb();
await put("staff", { user_id: 30, name: "مساعد", perms: "orders" });

test("الطالب محمي، والكادر والمجموعة لا، واللي ينطلب بدون حماية يبقى بدون", async () => {
  calls.length = 0;
  await send(60, "درجتك");
  await send(30, "طلب جديد");
  await send(1, "لصاحب البوت");
  await send(-1001, "مجموعة الأسئلة");
  await send(60, "كلمة المرور", { extra: { protect_content: false } });
  await api("copyMessage", { chat_id: 61, from_chat_id: -1001, message_id: 5 });
  await api("answerCallbackQuery", { callback_query_id: "x" });
  await upload("sendDocument", { chat_id: "62" }, "document", Buffer.from("x"), "a.pdf");
  assert.deepEqual(calls.map((c) => c.p.protect_content), [true, undefined, undefined, undefined, false, true, undefined, "true"]);
});
