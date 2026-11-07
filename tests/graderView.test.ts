// «شوف كمساعد مصحح»: صاحب البوت يصير مثل مساعد ما عنده غير التصحيح والاعتراضات، ويرجع بزر
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-gv-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
}) as typeof fetch;

const { handleUpdate } = await import("../lib/bot.ts");
const { initDb } = await import("../lib/db.ts");
const { BTN_EXIT_GRADER } = await import("../lib/config.ts");
const { allowed, can, isAdmin, isStaff, viewingAsGrader } = await import("../lib/data.ts");
await initDb();

test("صاحب البوت يدخل كمصحح: التصحيح والاعتراضات بس، ويرجع بالزر", async () => {
  await handleUpdate({ callback_query: { id: "c1", from: { id: 1 }, data: "a:asgrader", message: { message_id: 3, chat: { id: 1 } } } });
  assert.equal(await viewingAsGrader(1), true);
  assert.equal(await isAdmin(1), false);
  assert.equal(await isStaff(1), true);
  assert.equal(await can(1, "grade"), true);
  assert.equal(await can(1, "objections"), true);
  assert.equal(await can(1, "students"), false);
  assert.equal(await allowed(1, "a:sf"), false);
  const kb = calls.find((c) => c.p.reply_markup?.keyboard)?.p.reply_markup.keyboard.flat().map((b: any) => b.text);
  assert.ok(kb.includes(BTN_EXIT_GRADER));

  await handleUpdate({ message: { message_id: 4, from: { id: 1 }, chat: { id: 1, type: "private" }, text: BTN_EXIT_GRADER } });
  assert.equal(await viewingAsGrader(1), false);
  assert.equal(await isAdmin(1), true);
});

test("المساعد العادي ما يگدر يدخل كمصحح", async () => {
  await handleUpdate({ callback_query: { id: "c2", from: { id: 55 }, data: "a:asgrader", message: { message_id: 3, chat: { id: 55 } } } });
  assert.equal(await viewingAsGrader(55), false);
});
