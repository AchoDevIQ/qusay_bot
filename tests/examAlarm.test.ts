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
  assert.deepEqual(a.map((x) => x.at), ["2026-12-02T16:00:00+03:00"], "الأصل: بوقت الامتحان بس");
  assert.match(a[0].title, /هسه عندك امتحان/);
  await A.setAlarmCfg({ before: [60, 0] });
  a = await A.alarmsFor(7, "2026-12-01 10:00");
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

test("🎵 نغمة يضيفها الأستاذ: WAV أقل من 30 ثانية، توصل للتطبيق برابطها، وتنحذف", async () => {
  const wav = (secs: number) => {
    const n = 8000 * secs, b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    b.writeInt16LE(secs, 44);
    return b.toString("base64");
  };
  await assert.rejects(A.addTone("طويلة", wav(40)), /أقل من 30 ثانية/);
  await assert.rejects(A.addTone("", wav(3)), /اكتب اسم/);
  await assert.rejects(A.addTone("مو صوت", Buffer.from("hello world, this is not a wave file at all!!").toString("base64")), /مو صوت/);
  const id = await A.addTone("صوت قصي", wav(3));
  assert.match(id, /^c[0-9a-f]{10}$/);
  await assert.rejects(A.addTone("ثانية", wav(3)), /مضافة من قبل/);
  assert.ok((await A.allTones()).some((t) => t.id === id && t.custom && t.url.includes(id)));
  assert.ok((await A.toneFile(id))!.length > 44);
  await A.setTone(8, id);
  assert.deepEqual(await A.toneFor(8), { tone: id, toneUrl: `/api/alarm/tone?id=${id}` });
  await A.setAlarmCfg({ before: [0], tone: id });
  await A.delTone(id);
  assert.equal((await A.alarmCfg()).tone, "soft", "الأساسية رجعت");
  assert.deepEqual(await A.toneFor(8), { tone: "soft", toneUrl: "" }, "اللي اختارها رجع للأساسية");
});
