// جدول الامتحانات: الحساب، بناء الطالب لجدوله، وإعدادات الإدارة
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, addDays, advanceDays, availableDays, buildPlan, daysLost, flattenDays, remapByOrder, groupSlots, spreadVersions, itemState, ampm, labelChapters, pickMandatory, answersClose, pickedAt, prettyAt, slotDays, pickOptional, weekdayOf } from "../lib/scheduleRules.ts";

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
const { closeFinished, myPaper, notifyStarted, roomFile, uploadAnswer } = await import("../lib/examRoom.ts");
const { files } = await import("../lib/files.ts");
const { schedSettings } = await import("../lib/schedApi.ts");
const { run: sqlRun } = await import("../lib/sqliteDriver.ts");
const { stamp } = await import("../lib/util.ts");
const { initDb, find, insert, kvSet, one, put, update } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();

const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...extra }) as Promise<any>;
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

test("غير المسجل مرفوض", async () => {
  await assert.rejects(act(72, "info"), /سجل/);
  await assert.rejects(myExamAction({ token: "x", action: "info" }), (e: any) => e.status === 401);
});

test("مربع امتحاناتي يفتح الصفحة", async () => {
  const r: any = await homeAction({ token: homeToken(70), pf: "ios", device: "dev-" + String(70).padStart(14, "0"), action: "exams" }).catch((e) => { throw e; });
  assert.match(r.url, /\/store\/myexams\?.*t=/);
});

test("الإدارة: الصلاحية، الحفظ، وتغيير العطلة يعيد الجداول ويخبر الطالب", async () => {
  await assert.rejects(schedAdminAction({ action: "list", initData: sign(5) }), (e: any) => e.status === 403);
  const before = await schedAdminAction({ action: "list", initData: sign(1) });
  assert.equal(before.window, 15);
  await assert.rejects(schedAdminAction({ action: "save", initData: sign(1), window: 0, perDay: 2, gap: 0, holidayDays: 0 }), /وقت الدخول/);
  calls.length = 0;
  const hol = addDays(todayStr(), 1);
  const r = await schedAdminAction({ action: "save", initData: sign(1), window: 20, extra: 15, perDay: 3, gap: 10, holidayStart: hol, holidayDays: 5, excluded: "", blockedHours: [3] });
  assert.equal(r.window, 20);
  assert.match(r.notice, /انعاد جدول 1/);
  assert.ok(calls.some((c) => c.p.chat_id === 70 && /تغير جدول/.test(c.p.text)));
  const waiting = await find("sched_items", { user_id: 70, status: "waiting" });
  assert.ok(waiting.every((i) => i.at.slice(0, 10) >= addDays(hol, 5)));
  const saved = await schedAdminAction({ action: "save", initData: sign(1), window: 25, extra: 15, perDay: 3, gap: 10, holidayStart: hol, holidayDays: 5, excluded: "", blockedHours: [] });
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
  assert.equal(pickMandatory(vs, 2), 2);
  assert.equal(pickMandatory(vs, null), 1);    // ما محددة: أول نسخة جاهزة
  assert.equal(pickMandatory(vs, 3), 1);       // المحددة موقوفة
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

const SLOTS = [{ d: 6, t: "16:00" }, { d: 6, t: "20:30" }, { d: 2, t: "16:00" }, { d: 2, t: "22:00" }];   // الأحد والأربعاء
// بعد باجر بأسبوع: يوم أحد
const nextWeekday = (w: number, after = 7) => { let d = addDays(todayStr(), after); while (weekdayOf(d) !== w) d = addDays(d, 1); return d; };

test("الوقت لكل يوم مستقل، ومواعيد المكان توصل وتتحدث، وما يصير يبدل", async () => {
  const admin = sign(1);
  await assert.rejects(schedAdminAction({ action: "saveSlots", center: 999, slots: SLOTS, initData: admin }), /المركز/);
  await assert.rejects(schedAdminAction({ action: "saveSlots", center: 0, slots: [{ d: 9, t: "x" }], initData: admin }), /وقت/);
  const saved: any = await schedAdminAction({ action: "saveSlots", center: 0, slots: SLOTS, initData: admin });
  const ch1 = saved.rows.filter((r: any) => r.chapter === "الفصل الأول");
  assert.equal(ch1.length, 3);
  const sun = nextWeekday(6), wed = nextWeekday(2);
  const v = ch1[0].models[0].id;
  await assert.rejects(schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: ch1[0].exam, date: "bad" }], initData: admin }), /تاريخ/);
  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: ch1[0].exam, date: sun, versions: { "20:30": v } }, { exam: ch1[1].exam, date: wed, versions: {} }, { exam: ch1[2].exam, date: "2020-01-01", versions: {} }], initData: admin });
  const kept: any = await schedAdminAction({ action: "list", center: 0, initData: admin });
  assert.equal(kept.rows.find((r: any) => r.exam === ch1[0].exam).versions["20:30"], v);

  await student(82);
  await put("exam_access", { user_id: 82, chapter: "الفصل الأول", order_id: 1, created: "1" });
  const info = await act(82, "info");
  assert.equal(info.needsChoice, true);
  assert.deepEqual(info.days.map((d: any) => d.name), ["الأحد", "الأربعاء"]);
  assert.equal(info.days[0].times[1].label, "8:30 مساءً");
  await assert.rejects(act(82, "placePreview", { picks: { "6": "20:30" } }), /لكل يوم/);
  await assert.rejects(act(82, "placePreview", { picks: { "6": "20:30", "2": "20:30" } }), /لكل يوم/);   // هذا الوقت مو بالأربعاء
  // الأحد 8:30 والأربعاء 10: كل يوم بكيفه
  const picks = { "6": "20:30", "2": "22:00" };
  const pre = await act(82, "placePreview", { picks });
  assert.ok(pre.placePreview.items.some((i: any) => i.at === `${sun} 20:30`) && pre.placePreview.items.some((i: any) => i.at === `${wed} 22:00`));
  assert.equal((await find("schedules", { user_id: 82 })).length, 0);
  const j = await act(82, "joinPlace", { picks });
  assert.equal(j.mode, "general");
  assert.equal(j.needsBuild, false);
  assert.equal(j.late.length, 1);                                  // اللي فات موعده: يختار هو
  assert.equal(j.items.length, 2);
  const k = await act(82, "lateKeep");
  assert.equal(k.late.length, 0);
  assert.equal((await find("sched_items", { user_id: 82, status: "missed" })).length, 1);
  await assert.rejects(act(82, "joinPlace", { picks }), /مثبت/);
  await assert.rejects(act(82, "preview", form()), /مثبت/);

  calls.length = 0;
  const wed2 = addDays(wed, 7);
  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: ch1[0].exam, date: sun, versions: {} }, { exam: ch1[1].exam, date: wed2, versions: {} }, { exam: ch1[2].exam, date: "2020-01-01", versions: {} }], initData: admin });
  assert.equal(calls.filter((c) => c.p.chat_id === 82).length, 1);    // خبر واحد
  assert.ok((await act(82, "info")).items.some((i: any) => i.at === `${wed2} 22:00`));

  // الإدارة شالت الوقت اللي اختاره: يختار من جديد بدون ما يضيع جدوله
  await schedAdminAction({ action: "saveSlots", center: 0, slots: SLOTS.filter((x) => x.t !== "22:00").concat({ d: 2, t: "18:00" }), initData: admin });
  const again = await act(82, "info");
  assert.equal(again.repick, true);
  const fixed = await act(82, "joinPlace", { picks: { "6": "20:30", "2": "18:00" } });
  assert.equal(fixed.repick, false);
  assert.ok(fixed.items.some((i: any) => i.at === `${wed2} 18:00`));
  await schedAdminAction({ action: "saveSlots", center: 0, slots: SLOTS, initData: admin });
  await schedAdminAction({ action: "saveDates", center: 0, rows: [], initData: admin });
});

test("الحضوري: أوقات مركزه بس، وفصوله من الطلب، وبالموعد ما يصير فايت، والخاص متاح", async () => {
  const admin = sign(1);
  const area = await insert("areas", { gov: "بغداد", name: "المنصور" });
  const c1 = await insert("centers", { area_id: area, name: "قمة" });
  await schedAdminAction({ action: "saveSlots", center: c1, slots: [{ d: 4, t: "08:00" }, { d: 4, t: "09:30" }], initData: admin });
  await student(83, "حضوري");
  await put("students", { ...(await find("students", { user_id: 83 }))[0], center_id: c1 });
  assert.equal((await act(83, "info")).remaining, 0);
  await insert("orders", { user_id: 83, name: "ط", gov: "بغداد", side: "", area: "م", phone1: "1", phone2: "2", items: JSON.stringify([{ name: "الفصل الأول - امتحانات حضورية", qty: 1, price: 1 }]), subtotal: 1, fee: 0, total: 1, created: "2026-02-01 10:00", printed: 3 });
  const info = await act(83, "info");
  assert.equal(info.remaining, 3);
  assert.deepEqual(info.days[0].times.map((x: any) => x.t), ["08:00", "09:30"]);
  await assert.rejects(act(83, "joinPlace", { picks: { "4": "16:00" } }), /لكل يوم/);
  await put("guardians", { guardian_id: 9001, student_id: 83, created: "x" });
  const r: any = await homeAction({ token: homeToken(83), pf: "ios", device: "dev-" + String(83).padStart(14, "0"), action: "exams" });
  assert.match(r.url, /myexams/);
  const rows = (await schedAdminAction({ action: "list", center: c1, initData: admin }) as any).rows.filter((x: any) => x.chapter === "الفصل الأول");
  const fri = nextWeekday(4);
  await schedAdminAction({ action: "saveDates", center: c1, rows: [{ exam: rows[0].exam, date: "2020-01-03" }, { exam: rows[1].exam, date: fri }], initData: admin });
  const j = await act(83, "joinPlace", { picks: { "4": "09:30" } });
  assert.equal(j.late.length, 1);
  const k = await act(83, "lateKeep");
  assert.deepEqual(k.items.map((i: any) => i.state), ["past", "center"]);
  // الحضوري الخاص: أيام مركزه وأوقاته بس
  await student(84, "حضوري");
  await put("students", { ...(await find("students", { user_id: 84 }))[0], center_id: c1 });
  await put("exam_access", { user_id: 84, chapter: "الفصل الأول", order_id: 1, created: "1" });
  await assert.rejects(act(84, "preview", form()), /أوقات مركزك/);
  await assert.rejects(act(84, "preview", form({ weekdays: [0], times: { "0": ["08:00"] } })), /أيام مركزك/);
  await assert.rejects(act(84, "preview", form({ weekdays: [4], times: { "4": ["16:00"] } })), /أوقات مركزك/);
  const pv = await act(84, "preview", form({ weekdays: [4], times: { "4": ["08:00", "09:30"] } }));
  assert.ok(pv.preview.items.every((i: any) => weekdayOf(i.at.slice(0, 10)) === 4 && ["08:00", "09:30"].includes(i.at.slice(11))));
});

test("الفصل غير المشترى مقفول، واللي اشترى متأخر يگدر يتحول خاص، ونسخة الخاص لفصل كامل", async () => {
  const admin = sign(1);
  await schedAdminAction({ action: "saveSlots", center: 0, slots: SLOTS, initData: admin });
  const rows = (await schedAdminAction({ action: "list", center: 0, initData: admin }) as any).rows;
  const first = rows.find((r: any) => r.chapter === "الفصل الأول"), other = rows.find((r: any) => r.chapter === "الفصل الثاني");
  const sun = nextWeekday(6, 20);
  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: first.exam, date: sun }, { exam: other.exam, date: addDays(sun, 3) }], initData: admin });
  await student(85);
  await put("exam_access", { user_id: 85, chapter: "الفصل الأول", order_id: 1, created: "1" });
  const picks = { "6": "16:00", "2": "16:00" };
  const pre = await act(85, "placePreview", { picks });
  assert.deepEqual(pre.placePreview.items.map((i: any) => i.locked), [false, true]);
  const j = await act(85, "joinPlace", { picks });
  assert.deepEqual(j.items.map((i: any) => i.state), ["locked", "notbought"]);

  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: first.exam, date: sun }, { exam: other.exam, date: "2020-01-05" }], initData: admin });
  await put("exam_access", { user_id: 85, chapter: "الفصل الثاني", order_id: 2, created: "2" });
  assert.ok((await act(85, "info")).late.length >= 1);
  const out = await act(85, "latePrivate");
  assert.equal(out.mode, null);
  assert.equal(out.needsChoice, true);
  await assert.rejects(act(85, "lateKeep"), /ويا الطلاب/);

  const pc: any = await examAction({ action: "privateChapter", slug: "ch1", model: "A", initData: admin });
  const exams = pc.chapters.find((c: any) => c.slug === "ch1").exams;
  assert.ok(exams.every((x: any) => x.privateVersion === x.versions.find((v: any) => v.model === "A").id));
  await examAction({ action: "privateChapter", slug: "ch1", model: "", initData: admin });
});

test("التوزيع: يوم لكل امتحان، يتخطى العطلة، وصباحاً ومساءً، والوقت الإضافي", () => {
  const slots = [{ d: 5, t: "11:00" }, { d: 5, t: "14:00" }, { d: 1, t: "14:00" }];   // السبت بوقتين، والثلاثاء
  assert.deepEqual(slotDays(slots, "2027-02-01", 3, S), ["2027-02-02", "2027-02-06", "2027-02-09"]);
  assert.deepEqual(slotDays(slots, "2027-02-01", 2, { ...S, excluded: ["2027-02-02"], holidayStart: "2027-02-06", holidayDays: 1 }), ["2027-02-09", "2027-02-13"]);
  assert.deepEqual(slotDays([], "2027-02-01", 2, S), []);
  assert.equal(pickedAt("2027-02-06", { "5": "14:00" }), "2027-02-06 14:00");
  assert.equal(pickedAt("2027-02-02", { "5": "14:00" }), null);
  assert.equal(answersClose("2027-02-06 16:00", 60, 15), "2027-02-06 17:15");
  assert.equal(ampm("09:30"), "9:30 صباحاً");
  assert.equal(ampm("12:30"), "12:30 مساءً");
  assert.equal(ampm("14:00"), "2:00 مساءً");
  assert.equal(prettyAt("2027-02-02 14:00"), "الثلاثاء 2/2/2027 · 2:00 مساءً");
});

test("أوقات الأماكن تدخل بضغطة، بالعطلة، والتوزيع يوصل للطالب", async () => {
  const admin = sign(1);
  const centers = await find("centers");
  const athar = centers.find((c) => c.name === "معهد أثر")!.id;
  const girls = centers.find((c) => c.name === "قمة النجاح للبنات")!.id;
  await put("place_slots", { center_id: 0, slots: "[]" });
  await kvSet("sched_settings", "{}");
  await kvSet("sched_settings", "{}");   // العطلة تنكتب بس إذا لسه ما مكتوبة
  const r: any = await schedAdminAction({ action: "loadPlaces", initData: admin });
  assert.match(r.notice, /انضافت أوقات 5 مكان/);   // الإلكتروني صار عنده صف من قبل
  assert.equal(r.canLoad, false);
  assert.equal(r.holidayStart, "2027-01-15");
  assert.equal(r.holidayDays, 18);
  const a: any = await schedAdminAction({ action: "list", center: athar, initData: admin });
  assert.equal(a.slots.filter((x: any) => x.d === 5).length, 4);
  assert.ok(a.slots.some((x: any) => x.d === 1 && x.t === "18:30"));
  assert.equal((await find("centers", { id: girls }))[0].gender, "بنات");

  await student(86, "حضوري");
  await put("students", { ...(await find("students", { user_id: 86 }))[0], center_id: athar });
  await put("exam_access", { user_id: 86, chapter: "الفصل الأول", order_id: 1, created: "1" });
  await act(86, "joinPlace", { picks: { "5": "11:00", "1": "18:30" } });
  await assert.rejects(schedAdminAction({ action: "fillDates", center: athar, start: "bad", initData: admin }), /تاريخ/);
  calls.length = 0;
  const f: any = await schedAdminAction({ action: "fillDates", center: athar, start: addDays(todayStr(), 1), initData: admin });
  assert.match(f.notice, /توزع/);
  assert.equal(calls.filter((c) => c.p.chat_id === 86).length, 1);
  const dated = f.rows.filter((x: any) => x.date);
  assert.ok(dated.length > 3);
  assert.ok(dated.every((x: any) => [5, 1].includes(weekdayOf(x.date))));
  const items = (await act(86, "info")).items;
  assert.ok(items.some((i: any) => i.at.endsWith(" 11:00")) && items.some((i: any) => i.at.endsWith(" 18:30")));
});

test("تصحيح الفصل الثالث: يعدل العنوان ويضيف 7&8 بمكانه، بدون ما يرجع المحذوف", async () => {
  const admin = sign(1);
  const ch3 = await find("bank_exams", { slug: "ch3" });
  assert.ok(ch3.some((e) => e.title.endsWith("7&8") && e.title.startsWith("تطبيقات")));
  const order = (d: any) => d.chapters.find((c: any) => c.slug === "ch3").exams.map((e: any) => e.title);
  const fresh: any = await examAction({ action: "list", initData: admin });
  const titles = order(fresh);
  const i = titles.findIndex((t: string) => t.endsWith("7&8") && t.startsWith("تطبيقات"));
  assert.ok(titles[i - 1].endsWith("5&6"));
  assert.ok(titles[i + 1].startsWith("فقط مسائل") && titles[i + 1].endsWith("العظمى والصغرى)"));

  // جدول انضاف بالنسخة القديمة
  const eight = ch3.find((e) => e.title === titles[i])!;
  await examAction({ action: "delExam", id: eight.id, initData: admin });
  const only = ch3.find((e) => e.title === titles[i])! && ch3.find((e) => e.title.startsWith("فقط مسائل"))!;
  await update("bank_exams", { id: only.id }, { title: "فقط مسائل (التقريب والمعدلات الزمنية والتطبيقات على النهايات)" });
  const gone = ch3.find((e) => e.title === "الثوابت 1&2")!;
  await examAction({ action: "delExam", id: gone.id, initData: admin });
  await kvSet("book_loaded_v2", "");
  assert.equal(((await examAction({ action: "list", initData: admin })) as any).bookMissing, true);
  const r: any = await examAction({ action: "loadBook", initData: admin });
  const after = order(r);
  assert.equal(after.length, ch3.length - 1);     // 7&8 رجع، والمحذوف ما رجع
  assert.ok(!after.includes("الثوابت 1&2"));
  const j = after.findIndex((t: string) => t.endsWith("7&8") && t.startsWith("تطبيقات"));
  assert.ok(after[j - 1].endsWith("5&6") && after[j + 1].endsWith("العظمى والصغرى)"));
  assert.equal(r.bookMissing, false);
});

test("تواريخ الأسابيع 1 إلى 40 تدخل لكل مكان حسب جدول النظام القديم", async () => {
  const admin = sign(1);
  await sqlRun("DELETE FROM place_dates");
  const r: any = await schedAdminAction({ action: "loadOldDates", initData: admin });
  assert.match(r.notice, /انضاف \d+ موعد/);
  assert.equal(r.canLoadDates, false);
  const centers = await find("centers");
  const id = (n: string) => centers.find((c) => String(c.name).includes(n))!.id;
  const dayOf = async (center: number, slug: string, title: string) => {
    const rows = (await schedAdminAction({ action: "list", center, initData: admin }) as any).rows;
    const exams = await find("bank_exams", { slug });
    const e = exams.find((x) => x.title === title)!;
    return rows.find((x: any) => x.exam === e.id).date;
  };
  // كل تاريخ منقول من جدول قصي
  assert.equal(await dayOf(0, "ch2", "قطع مكافئ 1&2"), "2026-08-12");
  assert.equal(await dayOf(0, "ch2", "فاينل"), "2026-09-27");
  assert.equal(await dayOf(0, "ch3", "فاينل"), "2026-12-20");
  assert.equal(await dayOf(0, "ch4", "ممنوع لو مسموح 1&2"), "2027-02-07");
  assert.equal(await dayOf(id("أثر"), "ch4", "ممنوع لو مسموح 1&2"), "2027-02-06");
  assert.equal(await dayOf(id("قصي العميري"), "ch4", "ممنوع لو مسموح 1&2"), "2027-02-05");
  assert.equal(await dayOf(id("قصي العميري"), "ch4", "ساين وكوساين 1&2"), "2027-03-01");
  // المنصور جلسة وحدة وره الباقين، وقبل الساين ما عندهم مواعيد
  const m = id("قمة المنصور للبنين");
  assert.equal(await dayOf(m, "ch3", "اشتقاق الساين والكوساين"), "2026-10-05");
  assert.equal(await dayOf(m, "ch3", "المعدلات الزمنية 1&2"), "2026-10-09");
  assert.equal(await dayOf(m, "ch4", "ممنوع لو مسموح 1&2"), "2027-02-08");
  assert.equal(await dayOf(m, "ch4", "ساين وكوساين 1&2"), "2027-03-05");
  assert.equal(await dayOf(m, "ch3", "الاشتقاق 1&2"), "");
  assert.equal(await dayOf(m, "ch2", "قطع مكافئ 1&2"), "");
  // الباقي بنفس النمط بعد الأسبوع 40، والتعديل اليدوي ما ينمسح
  assert.equal(await dayOf(0, "ch4", "ساين وكوساين 5&6"), "2027-03-10");
  assert.equal(await dayOf(0, "ch5", "فاينل"), "2027-04-04");
  assert.equal(await dayOf(m, "ch5", "هل والإثبات"), "2027-03-29");
  await kvSet("old_dates_loaded_v2", "");
  const e2 = (await find("bank_exams", { slug: "ch5" })).find((x) => x.title === "فاينل")!;
  await put("place_dates", { center_id: 0, exam_id: e2.id, day: "2027-04-11", versions: "{}" });
  await schedAdminAction({ action: "loadOldDates", initData: admin });
  assert.equal(await dayOf(0, "ch5", "فاينل"), "2027-04-11");
});

test("ملفات الفصل تدخل على جدول الكتاب حسب العنوان، حتى لو الأرقام مختلفة", async () => {
  const { loadCatalog } = await import("../lib/examBank.ts");
  const mk = async (ord: number, title: string) => await insert("bank_exams", { slug: "chx", chapter: "الفصل التجريبي", ord, title, info: "", minutes: 75, manual: 1, pos: ord });
  const a = await mk(1, "اول"), b = await mk(2, "اعادة"), c = await mk(3, "ثاني");
  const version = { model: "A", ok: true, issues: [], has_en: true, questions: [{ n: 1, max: 100, q: "q1.png", a: [] }] };
  await loadCatalog({ slug: "chx", chapter: "الفصل التجريبي", exams: [{ ord: 1, title: "اول", info: "", minutes: 75, versions: [version] }, { ord: 2, title: "ثاني", info: "", minutes: 75, versions: [version] }] });
  const rows = await find("bank_exams", { slug: "chx" });
  assert.equal(rows.find((r) => r.id === a)!.ord, 1);
  assert.equal(rows.find((r) => r.id === c)!.ord, 2);
  assert.ok(rows.find((r) => r.id === b)!.ord > 2);     // بقى بدون ملفات، وما انحذف
  assert.equal(rows.length, 3);
  assert.equal((await find("bank_versions", { exam_id: c })).length, 1);
  assert.equal((await find("bank_versions", { exam_id: b })).length, 0);
});

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const upload = async (uid: number, item: number, q: number, body: Buffer = JPG) => {
  const f = new FormData();
  f.set("token", homeToken(uid)); f.set("pf", "ios"); f.set("device", "dev-" + String(uid).padStart(14, "0")); f.set("item", String(item)); f.set("q", String(q));
  f.set("file", new Blob([new Uint8Array(body)]), "a.jpg");
  return await uploadAnswer(f, await schedSettings()) as any;
};
test("الامتحان: مقفول قبل وقته، يدخل بوقته، نسخته حسب وقته، يرفع ويسلم بدون كود، وبعد الوقت يتسد", async () => {
  const admin = sign(1);
  const e = await insert("bank_exams", { slug: "room", chapter: "فصل الغرفة", ord: 1, title: "امتحان الغرفة", info: "", minutes: 60, pos: 1 });
  const va = await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
  const vb = await insert("bank_versions", { exam_id: e, model: "B", kind: "mandatory", ok: 1 });
  for (const v of [va, vb]) for (const n of [1, 2]) await insert("bank_questions", { version_id: v, n, max_mark: 50, q_file: "x.png" });
  await schedAdminAction({ action: "saveSlots", center: 0, slots: SLOTS, initData: admin });
  const sun = nextWeekday(6);
  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: e, date: sun, versions: { "20:30": vb } }], initData: admin });
  await student(90);
  await put("exam_access", { user_id: 90, chapter: "فصل الغرفة", order_id: 1, created: "1" });
  const joined = await act(90, "joinPlace", { picks: { "6": "20:30", "2": "16:00" } });
  const item = joined.items.find((i: any) => i.title === "امتحان الغرفة").id;
  await assert.rejects(act(90, "openExam", { item }), /ما بدا/);
  await assert.rejects(upload(90, item, 1), /انتهى|ما بدا|وقت/);
  await assert.rejects(studentAction({ action: "examNow", id: 90, item, initData: sign(5) }), (x: any) => x.status === 403);
  await sqlRun("UPDATE sched_items SET at=? WHERE id=?", stamp(), item);
  const opened = await act(90, "openExam", { item });
  assert.equal(opened.room.questions.length, 2);
  assert.equal(opened.room.extra, 15);
  assert.equal(opened.room.gallery, false);   // الاستوديو مطفي من البداية: الكاميرا بس
  // قبل القسم ما تنفتح الكاميرا
  assert.equal(opened.room.sworn, false);
  assert.match(opened.room.oath, /^أني الطالب .+ أقسم بالله أنني لن أغش في هذا الامتحان$/);
  assert.deepEqual(opened.room.pages, []);   // الأسئلة ما تنفتح قبل القسم
  await assert.rejects(upload(90, item, 1), /رتب جملة القسم/);
  assert.equal((await act(90, "oath", { item })).room.sworn, true);
  await assert.rejects(upload(91, item, 1), /غير موجود/);      // طالب ثاني
  await assert.rejects(upload(90, item, 9), /السؤال/);
  await assert.rejects(upload(90, item, 1, Buffer.from("not image")), /صورة/);
  await assert.rejects(act(90, "submitExam", { item }), /ولا جواب/);
  const r = await upload(90, item, 1);

  const ans = r.questions[0].answers[0];
  assert.match(ans.file, /student_answers\/90\//);
  assert.ok((await roomFile(homeToken(90), item, ans.file, "ios", "dev-" + String(90).padStart(14, "0"))).body.length);
  await assert.rejects(roomFile(homeToken(90), item, ans.file, "ios", "dev-another-device-00"), (x: any) => x.status === 423);
  await assert.rejects(roomFile(homeToken(91), item, ans.file, "ios", "dev-" + String(91).padStart(14, "0")), (x: any) => x.status === 403);
  await assert.rejects(roomFile(homeToken(90), item, "ch1/secret.png", "ios", "dev-" + String(90).padStart(14, "0")), (x: any) => x.status === 403);
  const del = await act(90, "delAnswer", { item, answer: ans.id });
  assert.equal(del.room.questions[0].answers.length, 0);
  await upload(90, item, 2);
  const done = await act(90, "submitExam", { item });
  assert.equal(done.items.find((i: any) => i.id === item).state, "done");
  await assert.rejects(upload(90, item, 1), /سلمت/);

  // ملف الحلول الكامل: ما ينفتح قبل التصحيح، وبعده لصاحب الورقة بس
  const sol = "answers/test/A.pdf", dev = (u: number) => "dev-" + String(u).padStart(14, "0");
  await files().write(sol, Buffer.from("%PDF-1.4 fake"), "application/pdf");
  await update("bank_versions", { id: (await find("sched_items", { id: item }))[0].version_id }, { answer_pdf: sol });
  assert.equal((await myPaper(90, item)).solutions, null);
  await assert.rejects(roomFile(homeToken(90), item, sol, "ios", dev(90)), (x: any) => x.status === 403);
  await update("sched_items", { id: item }, { graded_at: stamp(), total: 80 });
  assert.equal((await myPaper(90, item)).solutions, sol);
  assert.equal((await roomFile(homeToken(90), item, sol, "ios", dev(90))).type, "application/pdf");
  await assert.rejects(roomFile(homeToken(91), item, sol, "ios", dev(91)), (x: any) => x.status === 403);
  await update("sched_items", { id: item }, { graded_at: null, total: null });

  // طالب ثاني: دخل وما دز لحد ما خلص الوقت، وبعدها استثناء
  await student(92);
  await put("exam_access", { user_id: 92, chapter: "فصل الغرفة", order_id: 1, created: "1" });
  const j2 = await act(92, "joinPlace", { picks: { "6": "20:30", "2": "16:00" } });
  const it2 = j2.items.find((i: any) => i.title === "امتحان الغرفة").id;
  await sqlRun("UPDATE sched_items SET at=? WHERE id=?", stamp(), it2);
  await act(92, "openExam", { item: it2 });
  assert.equal((await find("sched_items", { id: it2 }))[0].version_id, va);   // وقته تغير، فما اله نسخة محددة
  await sqlRun("UPDATE sched_items SET at='2020-01-01 10:00', started_at='2020-01-01 10:00' WHERE id=?", it2);
  await assert.rejects(upload(92, it2, 1), /لم ترسل الإجابة/);
  await closeFinished(92, await schedSettings());
  assert.equal((await act(92, "info")).items.find((i: any) => i.id === it2).state, "missed");
  await assert.rejects(studentAction({ action: "examException", id: 92, item: it2, initData: sign(5) }), /صلاحية/);
  calls.length = 0;
  await studentAction({ action: "examException", id: 92, item: it2, initData: admin });
  assert.ok(calls.some((c) => c.p.chat_id === 92));
  assert.equal((await act(92, "info")).items.find((i: any) => i.id === it2).state, "open");
  const back = await act(92, "openExam", { item: it2 });
  assert.ok(back.room.closeAt > stamp());                     // وقته يبدي من دخوله
  await act(92, "oath", { item: it2 });
  assert.ok(await upload(92, it2, 1));
  // صورة وحدة لكل سؤال: الثانية تبدل الأولى
  assert.equal((await upload(92, it2, 1)).questions[0].answers.length, 1);
});
test("🎲 نسخة غير بكل وقت، وإذا النسخ أقل من الأوقات تنعاد بالترتيب", () => {
  assert.deepEqual(spreadVersions(["16:00", "20:30", "22:00"], [7, 8, 9], 1), { "16:00": 8, "20:30": 9, "22:00": 7 });
  assert.deepEqual(spreadVersions(["16:00", "20:30", "22:00"], [7, 8], 0), { "16:00": 7, "20:30": 8, "22:00": 7 });
  assert.deepEqual(spreadVersions(["16:00"], [], 0), {});
});
test("الأيام وأوقاتها: كل يوم تحته أوقاته، والفاضي والمكرر ما ينحفظ", () => {
  const week = [5, 6, 0, 1, 2, 3, 4];
  const slots = [{ d: 1, t: "20:30" }, { d: 5, t: "22:00" }, { d: 1, t: "16:00" }, { d: 5, t: "16:00" }];
  assert.deepEqual(groupSlots(slots, week), [{ d: 5, times: ["16:00", "22:00"] }, { d: 1, times: ["16:00", "20:30"] }]);
  assert.deepEqual(flattenDays([{ d: 5, times: ["22:00", "", "16:00", "22:00"] }, { d: 1, times: [] }]), [{ d: 5, t: "16:00" }, { d: 5, t: "22:00" }]);
});
test("الحضوري ما يدخل غرفة الامتحان، ورسالة البدء مرة وحدة وبالمفتاح بس", async () => {
  const s = await schedSettings();
  await assert.rejects(notifyStarted("bad", s), (x: any) => x.status === 401);
  const e = (await find("bank_exams", { slug: "room" }))[0];
  await student(93, "حضوري");
  const it = await insert("sched_items", { user_id: 93, exam_id: e.id, at: stamp(), status: "waiting" });
  await assert.rejects(act(93, "openExam", { item: it }), /حضوري/);
});

test("النسخة تدخل اختياري إذا الملف محددها هيچ", async () => {
  const { loadCatalog } = await import("../lib/examBank.ts");
  const q = [{ n: 1, max: 100, q: "q1.png", a: [] }];
  await loadCatalog({ slug: "chk", chapter: "فصل النوع", exams: [{ ord: 1, title: "ع", info: "", minutes: 75, versions: [{ model: "A", ok: true, issues: [], has_en: true, questions: q }, { model: "D", kind: "optional", ok: true, issues: [], has_en: true, questions: q }] }] });
  const e = (await find("bank_exams", { slug: "chk" }))[0];
  const vs = await find("bank_versions", { exam_id: e.id }, { order: ["model"] });
  assert.deepEqual(vs.map((v) => v.kind), ["mandatory", "optional"]);
});

test("الجدول الخاص: الطالب يختار وقت كل امتحان، والثاني بعد نهاية الأول والفاصل", () => {
  const one = { ...base, end: "2027-02-01", weekdays: [0], settings: { ...S, gap: 30 } };
  const ok = buildPlan(exams(2, 60), { ...one, times: { "0": ["16:00", "19:00"] } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.items.map((i) => i.at), ["2027-02-01 16:00", "2027-02-01 19:00"]);
  const close = buildPlan(exams(2, 60), { ...one, times: { "0": ["16:00", "17:00"] } });
  assert.equal(close.ok, false);
  if (!close.ok) assert.match(close.error, /5:30 مساءً/);
  // اختار وقت امتحان واحد: ما ينحطله امتحانين باليوم
  const single = buildPlan(exams(2, 60), { ...one, times: { "0": ["16:00"] } });
  assert.equal(single.ok, false);
  if (!single.ok) assert.match(single.error, /امتحان ثاني/);
  // ساعات الإدارة ما تمنع وقت اختاره الطالب من القائمة
  assert.ok(buildPlan(exams(1), { ...one, times: { "0": ["16:00"] }, settings: { ...S, blockedHours: [16] } }).ok);
});

test("العطلة: كم يوم امتحان راح، ووين يوصل كل امتحان، والنسخ تمشي بترتيب الوقت", () => {
  const sat = "2027-02-06", tue = "2027-02-09";   // سبت وثلاثاء
  const ok = (d: string) => [5, 1].includes(weekdayOf(d)) && d !== tue;
  assert.equal(daysLost(tue, tue, (d) => [5, 1].includes(weekdayOf(d))), 1);
  assert.equal(daysLost("2027-02-10", "2027-02-11", ok), 1);   // ماكو يوم امتحان، بس يوم الامتحان نفسه ينحسب
  assert.equal(advanceDays(tue, 1, ok), "2027-02-13");
  assert.equal(advanceDays(sat, 1, ok), "2027-02-13");
  assert.deepEqual(remapByOrder({ "17:00": 1, "21:00": 2 }, ["17:00", "21:00"], ["16:00", "20:00"]), { "16:00": 1, "20:00": 2 });
});

test("🏖 عطلة قبل امتحان: هو واللي بعده يزحفون، والخاص يلغيها، والإدارة تشيلها", async () => {
  const admin = sign(1);
  const area = await insert("areas", { gov: "بغداد", name: "الكرادة" });
  const c = await insert("centers", { area_id: area, name: "مركز العطلة", active: 1 });
  await schedAdminAction({ action: "saveSlots", center: c, slots: [{ d: 5, t: "16:00" }, { d: 5, t: "20:00" }, { d: 1, t: "17:00" }, { d: 1, t: "21:00" }], initData: admin });
  const ex = (await find("bank_exams", { chapter: "الفصل الأول" })).sort((a, b) => a.ord - b.ord);
  const [a, b, cc] = ex;
  const vb = (await find("bank_versions", { exam_id: b.id }))[0].id;
  const sat = nextWeekday(5), tue = addDays(sat, 3), sat2 = addDays(sat, 7), tue2 = addDays(sat, 10);
  await schedAdminAction({ action: "saveDates", center: c, rows: [{ exam: a.id, date: sat }, { exam: b.id, date: tue, versions: { "21:00": vb } }, { exam: cc.id, date: sat2 }], initData: admin });
  // طالب خاص حضوري بهذا المركز، يمتحن السبت والثلاثاء
  await student(96, "حضوري");
  await put("students", { ...(await find("students", { user_id: 96 }))[0], center_id: c });
  await put("schedules", { user_id: 96, mode: "private", picks: JSON.stringify({ "5": ["16:00", "20:00"], "1": ["17:00", "21:00"] }), start_day: sat, end_day: addDays(sat, 60), weekdays: JSON.stringify([5, 1]), hour: 16, created: stamp() });
  const ib = await insert("sched_items", { user_id: 96, exam_id: b.id, at: `${tue} 21:00`, status: "waiting" });
  const ic = await insert("sched_items", { user_id: 96, exam_id: cc.id, at: `${sat2} 20:00`, status: "waiting" });

  await assert.rejects(schedAdminAction({ action: "holidayPreview", center: c, exam: b.id, days: 0, initData: admin }), /أيام العطلة/);
  const pv: any = await schedAdminAction({ action: "holidayPreview", center: c, exam: b.id, days: 1, reason: "راحة", scope: "place", initData: admin });
  assert.deepEqual(pv.holidayPreview.places[0].rows.map((r: any) => [r.from, r.to]), [[tue, sat2], [sat2, tue2]]);
  assert.equal(pv.holidayPreview.students, 1);
  assert.equal((await find("place_dates", { center_id: c, exam_id: b.id }))[0].day, tue);   // المعاينة ما تغير شي

  calls.length = 0;
  const done: any = await schedAdminAction({ action: "holidayAdd", center: c, exam: b.id, days: 1, reason: "راحة", scope: "place", initData: admin });
  assert.match(done.notice, /انحطت العطلة/);
  assert.equal((await find("place_dates", { center_id: c, exam_id: a.id }))[0].day, sat);   // اللي قبل العطلة ما يتحرك
  const pb = (await find("place_dates", { center_id: c, exam_id: b.id }))[0];
  assert.equal(pb.day, sat2);
  assert.deepEqual(JSON.parse(pb.versions), { "20:00": vb });   // نسخة ثاني وقت تبقى لثاني وقت
  assert.equal((await find("place_dates", { center_id: c, exam_id: cc.id }))[0].day, tue2);
  assert.equal((await one("sched_items", { id: ib }))!.at, `${sat2} 20:00`);
  assert.equal((await one("sched_items", { id: ic }))!.at, `${tue2} 21:00`);
  assert.ok(calls.some((x) => x.p.chat_id === 96 && /ما أريد العطلة/.test(x.p.text)));
  assert.equal(done.holidays.length, 1);

  // الطالب الخاص يشوف العطلة ويلغيها، فيتقدم جدوله
  const info = await act(96, "info");
  assert.deepEqual(info.holidays.map((h: any) => [h.from, h.cancel, h.reason]), [[tue, true, "راحة"]]);
  await assert.rejects(act(97, "holidayOff", { holiday: done.holidays[0].id }), /سجل/);
  const off = await act(96, "holidayOff", { holidays: [done.holidays[0].id] });
  assert.match(off.notice, /لغيت العطلة/);
  assert.equal(off.holidays.length, 0);
  assert.equal((await one("sched_items", { id: ib }))!.at, `${tue} 21:00`);
  assert.equal((await one("sched_items", { id: ic }))!.at, `${sat2} 20:00`);

  // الإدارة تشيل العطلة: مواعيد المكان ترجع
  const undo: any = await schedAdminAction({ action: "holidayDel", center: c, id: done.holidays[0].id, initData: admin });
  assert.equal(undo.holidays.length, 0);
  const back = (await find("place_dates", { center_id: c, exam_id: b.id }))[0];
  assert.equal(back.day, tue);
  assert.deepEqual(JSON.parse(back.versions), { "21:00": vb });
  assert.equal((await find("place_dates", { center_id: c, exam_id: cc.id }))[0].day, sat2);
});

test("الطالب الخاص الإلكتروني يمتحن من الساعة إلى الساعة اللي تحددها الإدارة", async () => {
  const admin = sign(1);
  const old: any = await schedAdminAction({ action: "list", initData: admin });
  await assert.rejects(schedAdminAction({ action: "save", initData: admin, window: 15, extra: 15, perDay: 2, gap: 30, holidayDays: 0, excluded: "", fromHour: 20, toHour: 9 }), /آخر ساعة/);
  await schedAdminAction({ action: "save", initData: admin, window: old.window, extra: old.extra, perDay: old.perDay, gap: old.gap, holidayStart: old.holidayStart, holidayDays: old.holidayDays, excluded: old.excluded.join("\n"), fromHour: 14, toHour: 18 });
  await student(98);
  await put("exam_access", { user_id: 98, chapter: "الفصل الأول", order_id: 1, created: "1" });
  const info = await act(98, "info");
  assert.deepEqual([info.hours[0], info.hours.at(-1)], [14, 18]);
  await assert.rejects(act(98, "preview", form({ times: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), ["20:00"]])) })), /من الساعة/);
  assert.ok((await act(98, "preview", form({ times: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), ["15:00"]])) }))).preview);
});

test("🏖 عطلة فوك عطلة: الامتحان يزحف مرتين، الطالب يشوفها وحدة ويلغيها كلها، وشيل الأولى يشيل الثانية", async () => {
  const admin = sign(1);
  const area = await insert("areas", { gov: "بغداد", name: "الأعظمية" });
  const c = await insert("centers", { area_id: area, name: "مركز العطلتين", active: 1 });
  await schedAdminAction({ action: "saveSlots", center: c, slots: [{ d: 6, t: "16:00" }, { d: 2, t: "16:00" }], initData: admin });   // أحد وأربعاء
  const [, b] = (await find("bank_exams", { chapter: "الفصل الأول" })).sort((x, y) => x.ord - y.ord);
  const sun = nextWeekday(6), wed = addDays(sun, 3), sun2 = addDays(sun, 7);
  await schedAdminAction({ action: "saveDates", center: c, rows: [{ exam: b.id, date: sun }], initData: admin });
  await student(99, "حضوري");
  await put("students", { ...(await find("students", { user_id: 99 }))[0], center_id: c });
  await put("schedules", { user_id: 99, mode: "private", picks: JSON.stringify({ "6": ["16:00"], "2": ["16:00"] }), start_day: sun, end_day: addDays(sun, 60), weekdays: JSON.stringify([6, 2]), hour: 16, created: stamp() });
  const it = await insert("sched_items", { user_id: 99, exam_id: b.id, at: `${sun} 16:00`, status: "waiting" });
  const add = () => schedAdminAction({ action: "holidayAdd", center: c, exam: b.id, days: 1, scope: "place", initData: admin }) as Promise<any>;
  await add();
  const second = await add();
  assert.equal((await find("place_dates", { center_id: c, exam_id: b.id }))[0].day, sun2);   // الأحد ← الأربعاء ← الأحد الجاي
  assert.equal((await one("sched_items", { id: it }))!.at, `${sun2} 16:00`);
  assert.match(second.rows.find((r: any) => r.exam === b.id).hol, /إلى/);
  const info = await act(99, "info");
  assert.equal(info.holidays.length, 1);
  assert.deepEqual([info.holidays[0].from, info.holidays[0].to, info.holidays[0].ids.length], [sun, wed, 2]);
  await act(99, "holidayOff", { holidays: info.holidays[0].ids });
  assert.equal((await one("sched_items", { id: it }))!.at, `${sun} 16:00`);
  const first = second.holidays.filter((h: any) => h.title === b.title).sort((x: any, y: any) => x.id - y.id)[0];
  const undo: any = await schedAdminAction({ action: "holidayDel", center: c, id: first.id, initData: admin });
  assert.match(undo.notice, /انشالت 2 عطل/);
  assert.equal((await find("place_dates", { center_id: c, exam_id: b.id }))[0].day, sun);
});
