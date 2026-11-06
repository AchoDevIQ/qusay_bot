// المؤقت: رسالة «بدأ الامتحان» لهواية طلاب بنفس الدقيقة تطلع دفعات، ما تتكرر، والدكة ما تبدي إذا اللي قبلها بعدها تشتغل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-cron-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const sent: { chat: number; at: number }[] = [];
let busyOnce = new Set<number>();
globalThis.fetch = (async (url: string, init: any) => {
  const p = JSON.parse(init.body);
  if (String(url).endsWith("sendMessage")) {
    // أول مرة لهذا الطالب تليجرام يكول «انتظر ثانية»
    if (busyOnce.has(p.chat_id)) { busyOnce.delete(p.chat_id); return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 1 } })); }
    if (p.chat_id === 999) return new Response(JSON.stringify({ ok: false, error_code: 403, description: "blocked" }));
    sent.push({ chat: p.chat_id, at: Date.now() });
  }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { cronTick } = await import("../lib/cronTick.ts");
const { initDb, insert, put, find, kvSet } = await import("../lib/db.ts");
const { cronKey } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 75, pos: 1 });
const ids = [...Array.from({ length: 60 }, (_, i) => 1000 + i), 999];
for (const uid of ids) {
  await put("students", { user_id: uid, name: `طالب ${uid}`, exam: "الكتروني", created: "x" });
  await insert("sched_items", { user_id: uid, exam_id: ex, at: stamp(), status: "waiting" });
}

test("المفتاح الغلط ما يشغل شي", async () => {
  await assert.rejects(cronTick("bad"), (e: any) => e.status === 401);
});

test("الدكة ما تبدي إذا اللي قبلها بعدها تشتغل", async () => {
  await kvSet("cron_lock", String(Date.now()));
  assert.deepEqual(await cronTick(cronKey()), { busy: true });
  assert.equal(sent.length, 0);
  await kvSet("cron_lock", String(Date.now() - 10 * 60 * 1000));   // قفل قديم: الدكة وگفت، نكمل
});

test("61 طالب بنفس الدقيقة: دفعات بالثانية، الحاظر ما يوگف الباقي، و«انتظر» من تليجرام تنعاد", async () => {
  busyOnce = new Set([1005]);
  const t0 = Date.now();
  const r: any = await cronTick(cronKey());
  assert.equal(r.started.due, 61);
  assert.equal(r.started.sent, 60);                         // 999 حاظر البوت
  assert.deepEqual(sent.map((s) => s.chat).sort(), ids.filter((x) => x !== 999).sort());
  // أكثر من 25 بالثانية ما يطلع
  const first = sent.filter((s) => s.at - t0 < 900).length;
  assert.ok(first <= 25, `بأول ثانية طلع ${first}`);
  assert.equal((await find("sched_items", { notified: null })).length, 0);
  // الدكة الجاية ما تعيد ولا رسالة
  sent.length = 0;
  const again: any = await cronTick(cronKey());
  assert.equal(again.started.due, 0);
  assert.equal(sent.length, 0);
});
