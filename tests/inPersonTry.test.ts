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
  assert.match(text, /BITMAP 8,4,56,52,0,/);
  assert.match(text, /BITMAP 8,208,56,92,0,/);
  assert.ok(text.includes(`"QI:${r.card.item}"`));
  assert.ok(text.endsWith("PRINT 1\r\n"));
  const start = text.indexOf(",0,") + 3;
  assert.ok(b.subarray(start, start + 56 * 52).some((x) => x !== 0xff), "لازم بالصورة كتابة");
  await attendAction({ station, action: "done", id: job.id });
  assert.equal(((await attendAction({ station, action: "next" })) as any).job, null);
});

test("المحطة: قراءة الكود تسجل الحضور وترجع الليبل مباشرة، حتى لو مسجل قبل، والضبط يحرك الليبل", async () => {
  const { attendAction, stationToken, studentCode } = await import("../lib/inPerson.ts");
  const station = stationToken(1);
  const area = await insert("areas", { gov: "بغداد", name: "منطقة 3" });
  const center = await insert("centers", { area_id: area, name: "مركز الكاميرا", gender: "بنين" });
  const exam = await insert("bank_exams", { slug: "t3", chapter: "الفصل الثالث", ord: 1, title: "امتحان الكاميرا", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  const k = await startInPersonTest(center, vid);
  const code = studentCode(-k);
  const first: any = await attendAction({ station, action: "scan", code, dx: 16, dy: -8 });
  assert.equal(first.card.already, false);
  const text = Buffer.from(first.job.b64, "base64").toString("latin1");
  assert.match(text, /BITMAP 24,0,56,52,0,/);
  assert.match(text, /QRCODE 30,50,M,7,A,0,/);
  const again: any = await attendAction({ station, action: "scan", code });
  assert.equal(again.card.already, true);
  // ما تأكد انطباعه بعد: يقدر يطبع. وبعد ما تأكد: يگول مطبوع له ليبل وما يطبع
  assert.ok(again.job.b64.length > 1000);
  await attendAction({ station, action: "printed", id: first.card.item });
  const third: any = await attendAction({ station, action: "scan", code });
  assert.equal(third.card.printed, true);
  assert.equal(third.job, null);
  assert.equal(((await attendAction({ station, action: "reprint", item: first.card.item })) as any).job.id, first.card.item);
  assert.ok(((await attendAction({ station, action: "test" })) as any).job.b64.length > 1000);
  // الضبط ينحفظ ويطبق على الليبلات الجاية بدون ما ينرسل كل مرة
  assert.deepEqual(((await attendAction({ station, action: "pos", dx: 8, dy: 16 })) as any).pos, { dx: 8, dy: 16 });
  const saved = Buffer.from(((await attendAction({ station, action: "reprint", item: first.card.item })) as any).job.b64, "base64").toString("latin1");
  assert.match(saved, /BITMAP 16,20,56,52,0,/);
  await attendAction({ station, action: "pos", dx: 0, dy: 0 });
  await assert.rejects(attendAction({ station, action: "scan", code: "QS:5.abc" }), /مو كود طالب/);
});

test("الجاي بغير وقته: ما ينسجل، واستثناء يدخله ويطبع، ورفض ما يغير شي، والاستثناء يحتاج صلاحية", async () => {
  const { attendAction, stationToken, studentCode } = await import("../lib/inPerson.ts");
  const { put } = await import("../lib/db.ts");
  const { homeToken } = await import("../lib/webAuth.ts");
  const station = stationToken(1);
  const area = await insert("areas", { gov: "بغداد", name: "منطقة 4" });
  const center = await insert("centers", { area_id: area, name: "مركز الاستثناء", gender: "بنين" });
  const exam = await insert("bank_exams", { slug: "t4", chapter: "الفصل الرابع", ord: 1, title: "امتحان الاستثناء", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  const k = await startInPersonTest(center, vid, true);
  const code = studentCode(-k);
  const first: any = await attendAction({ station, action: "scan", code });
  assert.equal(first.card.late, true);
  assert.equal(first.job, null);
  const item = first.card.item;
  assert.equal((await one("sched_items", { id: item }))!.status, "waiting");
  await attendAction({ station, action: "rejectLate", item });
  assert.equal((await one("sched_items", { id: item }))!.status, "waiting");
  // مساعد عنده الحضور بس: يگدر يرفض، وما يگدر يستثني
  await put("staff", { user_id: 55, name: "مساعد", perms: "attend" });
  const init = `tk:${homeToken(55)}`;
  assert.equal((await attendAction({ initData: init, action: "scan", code }) as any).card.late, true);
  await assert.rejects(attendAction({ initData: init, action: "except", item }), (e: any) => e.status === 403);
  const yes: any = await attendAction({ station, action: "except", item });
  assert.equal(yes.card.late, false);
  assert.ok(yes.job.b64.length > 1000);
  assert.equal((await one("sched_items", { id: item }))!.status, "attended");
  // بوقته: يدخل بدون سؤال
  const on = await startInPersonTest(center, vid, false);
  assert.equal(on, k);
  assert.equal(((await attendAction({ station, action: "scan", code })) as any).card.late, false);
});

test("صلاحية 🖨: ترى رابط المحطة وتطبع بس، وبدونها المحطة مرفوضة", async () => {
  const { attendAction, stationToken } = await import("../lib/inPerson.ts");
  const { put } = await import("../lib/db.ts");
  const { homeToken } = await import("../lib/webAuth.ts");
  await put("staff", { user_id: 66, name: "مساعد الطباعة", perms: "station" });
  await put("staff", { user_id: 67, name: "مساعد الحضور", perms: "attend" });
  const list: any = await attendAction({ initData: `tk:${homeToken(66)}`, action: "list" });
  assert.equal(list.full, false);
  assert.equal(list.canCam, false);
  assert.ok(list.station.token);
  assert.equal(((await attendAction({ station: list.station.token, action: "next" })) as any).job, null);
  await assert.rejects(attendAction({ initData: `tk:${homeToken(66)}`, action: "scan", code: "5" }), (e: any) => e.status === 403);
  await assert.rejects(attendAction({ station: stationToken(67), action: "next" }), (e: any) => e.status === 403);
  assert.equal(((await attendAction({ initData: `tk:${homeToken(67)}`, action: "list" })) as any).station, null);
});
