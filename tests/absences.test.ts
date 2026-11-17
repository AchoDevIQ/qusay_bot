// رسالة الغياب: الامتحان اللي فات وما دخله توصل عنه رسالة للطالب ولولي أمره، مرة وحدة، والقديم قبل الميزة ما يوصل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-abs-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const sent: { chat: number; text: string }[] = [];
globalThis.fetch = (async (_u: unknown, init?: { body?: unknown }) => {
  try { const b = JSON.parse(String(init?.body ?? "{}")); if (b.chat_id && b.text) sent.push({ chat: Number(b.chat_id), text: String(b.text) }); } catch { /* مو JSON */ }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { put, insert, one, kvSet } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { sweepAbsences } = await import("../lib/absences.ts");
const { stamp } = await import("../lib/util.ts");
await ensure();
const ago = (min: number) => { const d = new Date(Date.now() + 3 * 3600_000 - min * 60_000); return d.toISOString().slice(0, 16).replace("T", " "); };
await put("students", { user_id: 70, name: "علي حسن", curr: "عربي", gender: "بنين", exam: "إلكتروني", created: "x" });
await insert("guardians", { student_id: 70, guardian_id: 700 });
const exam = Number(await insert("bank_exams", { title: "امتحان الأعداد المركبة", chapter: "الفصل الأول", minutes: 60 }));

test("أول تشغيل ما يدز شي، وبعدها الغياب الجديد يوصل للطالب وولي أمره مرة وحدة", async () => {
  const old = Number(await insert("sched_items", { user_id: 70, exam_id: exam, at: ago(60 * 24 * 3), status: "waiting" }));
  assert.equal(await sweepAbsences(true), 0);
  await kvSet("absence_since", ago(60 * 24));
  const miss = Number(await insert("sched_items", { user_id: 70, exam_id: exam, at: ago(60 * 5), status: "waiting" }));
  const done = Number(await insert("sched_items", { user_id: 70, exam_id: exam, at: ago(60 * 4), status: "done", submitted_at: stamp() }));
  const soon = Number(await insert("sched_items", { user_id: 70, exam_id: exam, at: ago(-60), status: "waiting" }));
  const opt = Number(await insert("sched_items", { user_id: 70, exam_id: exam, at: ago(60 * 5), status: "waiting", kind: "optional" }));
  sent.length = 0;
  assert.equal(await sweepAbsences(true), 1);
  assert.deepEqual(sent.map((s) => s.chat).sort(), [70, 700]);
  assert.match(sent.find((s) => s.chat === 70)!.text, /غياب وصفر/);
  assert.match(sent.find((s) => s.chat === 700)!.text, /علي حسن.*غاب عن امتحان/s);
  assert.ok((await one("sched_items", { id: miss }))?.absent_told);
  for (const id of [old, done, soon, opt]) assert.ok(!(await one("sched_items", { id }))?.absent_told);
  sent.length = 0;
  assert.equal(await sweepAbsences(true), 0);
  assert.equal(sent.length, 0);
});
