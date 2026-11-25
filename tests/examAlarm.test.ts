// ⏰ منبه الامتحانات: يتحسب من جدول الطالب، وإذا تبدل الموعد يتبدل المنبه، والنغمة اختياره
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-alarm-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const { initDb, insert, put, update } = await import("../lib/db.ts");
await initDb();
const A = await import("../lib/examAlarm.ts");

test("⏰ قبل ساعة وبوقته، والموعد يتبدل فيتبدل المنبه، والليلة اللي قبل، والنغمة", async () => {
  const e = await insert("bank_exams", { slug: "a", chapter: "الفصل الأول", ord: 1, title: "قبل x & y المحاضرة (1 & 2)", minutes: 60 });
  await put("students", { user_id: 7, name: "س", created: "x" });
  const it = await insert("sched_items", { user_id: 7, exam_id: e, at: "2026-12-02 16:00", status: "waiting" });
  await insert("sched_items", { user_id: 7, exam_id: e, at: "2026-11-01 16:00", status: "waiting" });
  let a = await A.alarmsFor(7, "2026-12-01 10:00");
  assert.deepEqual(a.map((x) => x.at), ["2026-12-02T15:00:00+03:00", "2026-12-02T16:00:00+03:00"]);
  assert.match(a[0].title, /بعد ساعة/); assert.match(a[1].title, /هسه عندك امتحان/);
  await update("sched_items", { id: it }, { at: "2026-12-05 18:00" });
  a = await A.alarmsFor(7, "2026-12-01 10:00");
  assert.equal(a[1].at, "2026-12-05T18:00:00+03:00", "الموعد الجديد");
  await A.setAlarmCfg({ before: [10], night: true, tone: "bell" });
  a = await A.alarmsFor(7, "2026-12-01 10:00");
  assert.deepEqual(a.map((x) => x.at), ["2026-12-04T21:00:00+03:00", "2026-12-05T17:50:00+03:00"]);
  assert.equal(await A.toneOf(7), "bell", "النغمة الأساسية");
  await A.setTone(7, "beep");
  assert.equal(await A.toneOf(7), "beep");
  await assert.rejects(A.setTone(7, "x"), /اختار نغمة/);
});
