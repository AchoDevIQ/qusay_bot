// جدول الامتحانات: الحساب، بناء الطالب لجدوله، وإعدادات الإدارة
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, addDays, availableDays, buildPlan, itemState, labelChapters, pickMandatory, pickOptional, weekdayOf } from "../lib/scheduleRules.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-sched-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { myExamAction, schedAdminAction } = await import("../lib/schedApi.ts");
const { homeAction } = await import("../lib/homeApi.ts");
const { examAction } = await import("../lib/examApi.ts");
const { studentAction } = await import("../lib/studentApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { initDb, find, insert, kvSet, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();

const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), action, ...extra }) as Promise<any>;
const exams = (n: number, minutes = 60) => Array.from({ length: n }, (_, i) => ({ id: i + 1, minutes }));
const S = DEFAULT_SETTINGS;
const base = { start: "2027-02-01", end: "2027-02-28", weekdays: [0, 2], hour: 16, perDay: 2, settings: S };   // 2027-02-01 اثنين

test("الأيام المتاحة تشيل العطلة والأيام المستثناة", () => {
  assert.equal(weekdayOf("2027-02-01"), 0);
  const s = { ...S, holidayStart: "2027-02-08", holidayDays: 7, excluded: ["2027-02-03"] };
  assert.deepEqual(availableDays("2027-02-01", "2027-02-17", [0, 2], s), ["2027-02-01", "2027-02-15", "2027-02-17"]);
});

test("التوزيع بالتساوي، والثاني بنفس اليوم يبدي بعد نهاية الأول والفاصل", () => {
  const p = buildPlan(exams(4), base);
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.days, 8);
    assert.equal(p.maxPerDay, 1);
    assert.deepEqual(p.items.map((i) => i.at), ["2027-02-01 16:00", "2027-02-08 16:00", "2027-02-15 16:00", "2027-02-22 16:00"]);
  }
  const two = buildPlan(exams(3, 75), { ...base, end: "2027-02-03" });
  assert.ok(two.ok);
  if (two.ok) assert.deepEqual(two.items.map((i) => i.at), ["2027-02-01 16:00", "2027-02-01 17:45", "2027-02-03 16:00"]);
});

test("إذا الوقت ما يكفي يگله شگد يحتاج أيام، والساعة الممنوعة مرفوضة", () => {
  const p = buildPlan(exams(20), base);
  assert.equal(p.ok, false);
  if (!p.ok) { assert.equal(p.minWeekdays, 3); assert.match(p.error, /3 أيام/); }
  const none = buildPlan(exams(500), base);
  if (!none.ok) assert.match(none.error, /مدد/);
  assert.equal(buildPlan(exams(1), { ...base, settings: { ...S, blockedHours: [16] } }).ok, false);
  const skip = buildPlan(exams(2), { ...base, end: "2027-02-01", settings: { ...S, blockedHours: [17] } });
  if (skip.ok) assert.equal(skip.items[1].at, "2027-02-01 18:00");
  else assert.fail();
});

test("حالة الامتحان حسب الوقت", () => {
  assert.equal(itemState("waiting", "2027-02-01 16:00", 15, "2027-02-01 15:59"), "locked");
  assert.equal(itemState("waiting", "2027-02-01 16:00", 15, "2027-02-01 16:14"), "open");
  assert.equal(itemState("waiting", "2027-02-01 16:00", 15, "2027-02-01 16:15"), "missed");
  assert.equal(itemState("done", "2027-02-01 16:00", 15, "2027-03-01 16:00"), "done");
});

const student = (uid: number, exam = "إلكتروني") => put("students", { user_id: uid, username: "", name: "طالب رقم ثلاثة اربعة", curr: "عربي", grade: "السادس العلمي", gov: "البصرة", side: "", area: "ع", phone1: "07701234567", phone2: "07801234567", exam, created: "2026-01-01 10:00" });
const bank = async (chapter: string, n: number, slug: string) => {
  for (let i = 1; i <= n; i++) {
    const e = await insert("bank_exams", { slug, chapter, ord: i, title: `${chapter} ${i}`, info: "", minutes: 60 });
    await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
    await insert("bank_versions", { exam_id: e, model: "B", kind: "optional", ok: 1 });
  }
};
const start = () => addDays(todayStr(), 1);
const form = (o: object = {}) => ({ start: start(), end: addDays(todayStr(), 60), weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 16, ...o });

test("الطالب يشوف جدوله ويثبته، وبعدها يتقفل", async () => {
  await bank("الفصل الأول", 3, "ch1");
  await bank("الفصل الثاني", 2, "ch2");
  await bank("الفصل الثالث", 4, "ch3");
  await student(70);
  assert.equal((await act(70, "info")).remaining, 0);
  await put("exam_access", { user_id: 70, chapter: "الفصل الأول", order_id: 1, created: "1" });
  const info = await act(70, "info");
  assert.equal(info.remaining, 3);
  assert.equal(info.needsBuild, true);
  await assert.rejects(act(70, "preview", form({ start: todayStr() })), /من باجر/);
  await assert.rejects(act(70, "preview", form({ start: "bad" })), /تاريخ/);
  const pre = await act(70, "preview", form());
  assert.equal(pre.preview.items.length, 3);
  assert.equal((await find("sched_items", { user_id: 70 })).length, 0);   // المعاينة ما تحفظ
  const done = await act(70, "confirm", form());
  assert.equal(done.needsBuild, false);
  assert.equal(done.items.length, 3);
  assert.ok(done.items.every((i: any) => i.state === "locked"));
  await assert.rejects(act(70, "confirm", form()), /مثبت/);
});

test("شراء فصل جديد يرجع يطلب ترتيب الجدول، والفايت ما يرجع", async () => {
  await put("exam_access", { user_id: 70, chapter: "الفصل الثاني", order_id: 2, created: "2" });
  const items = await find("sched_items", { user_id: 70 }, { order: ["at"] });
  await put("sched_items", { ...items[0], at: "2020-01-01 10:00" });
  const info = await act(70, "info");
  assert.equal(info.needsBuild, true);
  assert.equal(info.remaining, 4);                 // 5 ناقص الفايت
  assert.equal(info.items.find((i: any) => i.at === "2020-01-01 10:00").state, "missed");
  const r = await act(70, "confirm", form());
  assert.equal(r.items.length, 5);
  assert.equal((await find("sched_items", { user_id: 70, status: "missed" })).length, 1);
});

test("الطالب الحضوري ما يبني جدول، وغير المسجل مرفوض", async () => {
  await student(71, "حضوري");
  await put("exam_access", { user_id: 71, chapter: "الفصل الأول", order_id: 3, created: "1" });
  assert.equal((await act(71, "info")).inPerson, true);
  await assert.rejects(act(71, "preview", form()), /حضوري/);
  await assert.rejects(act(72, "info"), /سجل/);
  await assert.rejects(myExamAction({ token: "x", action: "info" }), (e: any) => e.status === 401);
});

test("مربع امتحاناتي يفتح الصفحة", async () => {
  const r: any = await homeAction({ token: homeToken(70), action: "exams" }).catch((e) => { throw e; });
  assert.match(r.url, /\/store\/myexams\?.*t=/);
});

test("الإدارة: الصلاحية، الحفظ، وتغيير العطلة يعيد الجداول ويخبر الطالب", async () => {
  await assert.rejects(schedAdminAction({ action: "list", initData: sign(5) }), (e: any) => e.status === 403);
  const before = await schedAdminAction({ action: "list", initData: sign(1) });
  assert.equal(before.window, 15);
  await assert.rejects(schedAdminAction({ action: "save", initData: sign(1), window: 0, perDay: 2, gap: 0, holidayDays: 0 }), /وقت الدخول/);
  calls.length = 0;
  const hol = addDays(todayStr(), 1);
  const r = await schedAdminAction({ action: "save", initData: sign(1), window: 20, perDay: 3, gap: 10, holidayStart: hol, holidayDays: 5, excluded: "", blockedHours: [3] });
  assert.equal(r.window, 20);
  assert.match(r.notice, /انعاد جدول 1/);
  assert.ok(calls.some((c) => c.p.chat_id === 70 && /تغير جدول/.test(c.p.text)));
  const waiting = await find("sched_items", { user_id: 70, status: "waiting" });
  assert.ok(waiting.every((i) => i.at.slice(0, 10) >= addDays(hol, 5)));
  const saved = await schedAdminAction({ action: "save", initData: sign(1), window: 25, perDay: 3, gap: 10, holidayStart: hol, holidayDays: 5, excluded: "", blockedHours: [] });
  assert.equal(saved.notice, "✅ انحفظت الإعدادات");   // نفس العطلة: ما تنعاد الجداول
});

test("الإدارة من صفحة الطالب: حده باليوم، إعادة الجدول، والحذف يشيله", async () => {
  await studentAction({ action: "perDay", id: 70, value: 5, initData: sign(1) });
  const v: any = await studentAction({ action: "sched", id: 70, initData: sign(1) });
  assert.equal(v.sched.perDay, 5);
  assert.ok(v.sched.items.length);
  calls.length = 0;
  await studentAction({ action: "schedReset", id: 70, initData: sign(1) });
  assert.equal((await act(70, "info")).needsBuild, true);
  assert.ok(calls.some((c) => c.p.chat_id === 70));
  await kvSet("sched_perday_70", "0");
  await studentAction({ action: "del", id: 70, initData: sign(1) });
  assert.equal((await find("sched_items", { user_id: 70 })).length, 0);
});

test("النسخة: الإجباري حسب المجموعة، والاختياري عشوائي إلا إذا وحدة", () => {
  const vs = [{ id: 1, kind: "mandatory", ok: 1 }, { id: 2, kind: "mandatory", ok: 1 }, { id: 3, kind: "mandatory", ok: 0 }, { id: 4, kind: "optional", ok: 1 }, { id: 5, kind: "optional", ok: 1 }];
  assert.equal(pickMandatory(vs, { "7": 2 }, 7), 2);
  assert.equal(pickMandatory(vs, { "7": 2 }, 8), 1);    // ما محددة: أول نسخة جاهزة
  assert.equal(pickMandatory(vs, { "7": 3 }, 7), 1);    // المحددة موقوفة
  assert.equal(pickOptional(vs, () => 0), 4);
  assert.equal(pickOptional(vs, () => 0.99), 5);
  assert.equal(pickOptional(vs.slice(0, 4), () => 0.99), 4);
  assert.equal(pickOptional(vs.slice(0, 3)), null);
  assert.deepEqual(labelChapters("الفصل الرابع والخامس"), ["الفصل الرابع", "الفصل الخامس"]);
  assert.deepEqual(labelChapters("الفصل الأول"), ["الفصل الأول"]);
});

test("جدول الكتاب ينضاف مرة وحدة، والفصل يتعدل وينحذف، والاختياري ما يدخل الجدول", async () => {
  const admin = sign(1);
  const r: any = await examAction({ action: "loadBook", initData: admin });
  const count = (d: any, ch: string) => d.chapters.find((c: any) => c.chapter === ch).exams.length;
  assert.equal(count(r, "الفصل الرابع"), 14);
  assert.equal(count(r, "الفصل الخامس"), 3);
  assert.equal(r.bookMissing, false);
  assert.equal(r.chapters.find((c: any) => c.chapter === "الفصل الخامس").exams[0].title, "هل والإثبات");
  await assert.rejects(examAction({ action: "addChapter", chapter: "الفصل الخامس", title: "س", initData: admin }), /موجود/);
  const six: any = await examAction({ action: "addChapter", chapter: "الفصل السادس", title: "اول امتحان", initData: admin });
  const c6 = six.chapters.find((c: any) => c.chapter === "الفصل السادس");
  await examAction({ action: "renameExam", id: c6.exams[0].id, title: "معدل", initData: admin });

  await student(80);
  await put("exam_access", { user_id: 80, chapter: "الفصل الرابع والخامس", order_id: 9, created: "1" });
  assert.equal((await act(80, "info")).remaining, 17);    // يفتح الفصلين سوية
  const onlyOpt = r.chapters.find((c: any) => c.chapter === "الفصل الخامس").exams[0].id;
  await insert("bank_versions", { exam_id: onlyOpt, model: "A", kind: "optional", ok: 1 });
  assert.equal((await act(80, "info")).remaining, 16);

  await student(81);
  await put("exam_access", { user_id: 81, chapter: "الفصل السادس", order_id: 9, created: "1" });
  await act(81, "confirm", form());
  assert.equal((await find("sched_items", { user_id: 81 })).length, 1);
  await examAction({ action: "delChapter", slug: c6.slug, initData: admin });
  assert.equal((await find("sched_items", { user_id: 81 })).length, 0);
});

test("المجاميع: الطالب يختار ساعتها بس، وكل امتحان ينحدد إله نسخة", async () => {
  const admin = sign(1);
  const g: any = await schedAdminAction({ action: "addGroup", hour: 20, initData: admin });
  await assert.rejects(schedAdminAction({ action: "addGroup", hour: 20, initData: admin }), /أكو مجموعة/);
  const gid = g.groups[0].id;
  assert.deepEqual((await act(80, "info")).hours, [20]);
  await assert.rejects(act(80, "preview", form({ hour: 16 })), /أوقات الامتحانات/);
  assert.ok((await act(80, "preview", form({ hour: 20 }))).preview);
  const e = (await find("bank_exams", { slug: "ch1" }))[0];
  const list = await find("bank_versions", { exam_id: e.id, kind: "mandatory" });
  const r: any = await examAction({ action: "groupVersion", id: e.id, group: gid, version: list[0].id, initData: admin });
  assert.equal(r.chapters.flatMap((c: any) => c.exams).find((x: any) => x.id === e.id).groupVersions[gid], list[0].id);
  const opt = (await find("bank_versions", { exam_id: e.id, kind: "optional" }))[0];
  await assert.rejects(examAction({ action: "groupVersion", id: e.id, group: gid, version: opt.id, initData: admin }), /إجبارية/);
  await schedAdminAction({ action: "delGroup", id: gid, initData: admin });
});
