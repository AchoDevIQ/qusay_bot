// إعادة الامتحان وتقديم موعده: كل وحدة بصلاحيتها، بيوم وساعة، والطالب يوصله خبر، وترتيب الجدول ما يمسحهن
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-mv-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { retakeExam, moveExam } = await import("../lib/examMoves.ts");
const { resetSchedule } = await import("../lib/schedApi.ts");
const { initDb, insert, put, one, find } = await import("../lib/db.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 75, pos: 1 });
await put("staff", { user_id: 30, name: "مساعد الإعادة", perms: "retake" });
await put("staff", { user_id: 31, name: "مساعد المواعيد", perms: "move" });
await put("students", { user_id: 70, name: "حسين", exam: "الكتروني", created: "x" });
const later = (d: number) => `${addDays(todayStr(), d)}T16:00`;

test("الإعادة: بصلاحيتها بس، للمخلص أو الفايت، بموعد بعد هسه، والطالب يوصله خبر", async () => {
  const done = await insert("sched_items", { user_id: 70, exam_id: ex, at: "2026-01-01 10:00", status: "done", total: 50, graded_at: "x" });
  const wait = await insert("sched_items", { user_id: 70, exam_id: ex, at: `${addDays(todayStr(), 9)} 10:00`, status: "waiting" });
  await assert.rejects(retakeExam(31, done, later(3)), (e: any) => e.status === 403);
  await assert.rejects(retakeExam(30, wait, later(3)), /ما خلص/);
  await assert.rejects(retakeExam(30, done, "2020-01-01T10:00"), /بعد هسه/);
  await assert.rejects(retakeExam(30, done, ""), /اختار اليوم/);
  calls.length = 0;
  const at = await retakeExam(30, done, later(3));
  const r = (await find("sched_items", { user_id: 70, retake_of: done }))[0];
  assert.deepEqual([r.at, r.status, r.fixed], [at, "waiting", "retake"]);
  assert.match(calls[0].p.text, /إعادة امتحان الأوميگا[\s\S]*ينحسب غياب/);
  // الأولى تبقى بدرجتها
  assert.equal((await one("sched_items", { id: done }))!.total, 50);
});

test("تقديم الموعد: بصلاحيته بس، للي بعده ما بدا، والجدول من ينعاد ترتيبه ما يمسحه", async () => {
  const wait = (await find("sched_items", { user_id: 70, status: "waiting" })).find((i) => !i.fixed)!;
  await assert.rejects(moveExam(30, wait.id, later(1)), (e: any) => e.status === 403);
  calls.length = 0;
  const at = await moveExam(31, wait.id, later(1));
  const m = (await one("sched_items", { id: wait.id }))!;
  assert.deepEqual([m.at, m.fixed, m.notified], [at, "moved", null]);
  assert.match(calls[0].p.text, /تغير موعد امتحان الأوميگا/);
  await resetSchedule(70);
  assert.equal((await find("sched_items", { user_id: 70, status: "waiting" })).length, 2);
});
