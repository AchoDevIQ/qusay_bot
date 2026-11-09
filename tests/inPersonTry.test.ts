// طالب حضوري تجريبي: امتحانه اليوم، وصاحب البوت يكتب رقمه بصفحة الحضوري فينسجل حضوره
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-try-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const { initDb, insert, one, find } = await import("../lib/db.ts");
const { startInPersonTest } = await import("../lib/gradeApi.ts");
const { markAttendance, studentCode, verifyStudentCode, verifyPrintToken, labelHtml } = await import("../lib/inPerson.ts");
await initDb();

test("طالب حضوري تجريبي: امتحان اليوم، حضور، وليبل. وإعادتها ما تسوي طالب ثاني", async () => {
  const area = await insert("areas", { gov: "بغداد", name: "منطقة" });
  const center = await insert("centers", { area_id: area, name: "مركز التجربة", gender: "بنين" });
  const exam = await insert("bank_exams", { slug: "t1", chapter: "الفصل الأول", ord: 1, title: "امتحان", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  await assert.rejects(startInPersonTest(999, vid), /المركز/);
  const k = await startInPersonTest(center, vid);
  const uid = -k;
  const st = (await one("students", { user_id: uid }))!;
  assert.deepEqual([st.exam, st.center_id], ["حضوري", center]);
  assert.equal(verifyStudentCode(studentCode(uid)), uid);
  const card = await markAttendance(uid, 1);
  assert.equal(card.already, false);
  assert.equal(card.print, "label");
  assert.equal(verifyPrintToken(card.label)!.id, card.item);
  assert.match(await labelHtml(card.item), /طالب حضوري تجريبي/);
  assert.equal(await startInPersonTest(center, vid), k);
  assert.equal((await find("sched_items", { user_id: uid })).length, 1);
  assert.equal((await markAttendance(uid, 1)).already, false);
});

test("محطة طباعة البلوتوث: الليبل ينرسل بعد الحضور، ويطلع بلغة الطابعة، ورمز المحطة ما يفتح غيرها", async () => {
  const { attendAction, stationToken } = await import("../lib/inPerson.ts");
  const { homeToken } = await import("../lib/webAuth.ts");
  await assert.rejects(attendAction({ station: "1.1.bad", action: "next" }), (e: any) => e.status === 401);
  const station = stationToken(1);
  assert.equal(((await attendAction({ station, action: "next" })) as any).job, null);
  const area = await insert("areas", { gov: "بغداد", name: "منطقة 2" });
  const center = await insert("centers", { area_id: area, name: "مركز المحطة", gender: "بنين" });
  const exam = await insert("bank_exams", { slug: "t2", chapter: "الفصل الثاني", ord: 1, title: "امتحان المحطة", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  const k = await startInPersonTest(center, vid);
  const r: any = await attendAction({ initData: `tk:${homeToken(1)}`, action: "scan", code: String(k) });
  assert.equal(r.card.queued, true);
  assert.equal(r.card.uid, -k);
  const { job }: any = await attendAction({ station, action: "next" });
  assert.equal(job.id, r.card.item);
  const b = Buffer.from(job.b64, "base64");
  const text = b.toString("latin1");
  assert.ok(text.startsWith("SIZE 58 mm,39 mm"));
  assert.match(text, /BITMAP 176,12,35,288,0,/);
  assert.ok(text.includes(`"QI:${r.card.item}"`));
  assert.ok(text.endsWith("PRINT 1\r\n"));
  const start = text.indexOf(",0,") + 3;
  assert.ok(b.subarray(start, start + 35 * 288).some((x) => x !== 0xff), "لازم بالصورة كتابة");
  await attendAction({ station, action: "done", id: job.id });
  assert.equal(((await attendAction({ station, action: "next" })) as any).job, null);
});
