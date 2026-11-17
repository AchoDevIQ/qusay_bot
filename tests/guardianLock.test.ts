// القفل الجزئي: الورقة تنتظر استلام ولي الأمر، و3 أيام تقفل المتجر والتصويت والمنافسة، والسفر يأجّل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-glock-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;

const { insert, kvSet, put } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { paperWaits, oldUnseen, decideTravel, needNoOld } = await import("../lib/guardianLock.ts");
const { stamp } = await import("../lib/util.ts");
await ensure();

const SID = 777;
await put("students", { user_id: SID, name: "طالب", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
const old = stamp(new Date(Date.now() + 3 * 3600_000 - 4 * 86400_000));
const fresh = stamp(new Date(Date.now() + 3 * 3600_000 - 3600_000));
const a = Number(await insert("sched_items", { user_id: SID, exam_id: 1, at: old, status: "done", graded_at: old, total: 80 }));
const b = Number(await insert("sched_items", { user_id: SID, exam_id: 2, at: fresh, status: "done", graded_at: fresh, total: 90 }));

test("بلا ولي أمر مربوط ما ينقفل شي", async () => {
  await kvSet(`guardian_watch_${SID}`, JSON.stringify({ unseen: [a], held: [b] }));
  assert.equal(await paperWaits(SID, a), false);
  assert.equal(await oldUnseen(SID), false);
});

test("ولي أمر ما استلم: الورقة تنتظر، وبعد 3 أيام قفل، والجديدة بس ما تقفل", async () => {
  await put("guardians", { guardian_id: 5000, student_id: SID, created: "x" });
  assert.equal(await paperWaits(SID, a), true);
  assert.equal(await paperWaits(SID, b), true);
  assert.equal(await oldUnseen(SID), true);
  await assert.rejects(needNoOld(SID), /3 أيام/);
  await kvSet(`guardian_watch_${SID}`, JSON.stringify({ unseen: [], held: [b] }));
  assert.equal(await oldUnseen(SID), false, "درجة عمرها ساعة ما تقفل");
  assert.equal(await paperWaits(SID, a), false);
});

test("مسافر: صاحب البوت يأجّل، فالقفل يروح لحد التاريخ", async () => {
  await kvSet(`guardian_watch_${SID}`, JSON.stringify({ unseen: [a], held: [] }));
  assert.equal(await oldUnseen(SID), true);
  await decideTravel(SID, 7);
  assert.equal(await oldUnseen(SID), false);
  await decideTravel(SID, 0);
  assert.equal(await oldUnseen(SID), true);
});
