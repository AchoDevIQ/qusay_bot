// المقاعد بكل وقت: عدد بنين وبنات، الطالب يغير وقته بنفسه قبل 24 ساعة إذا بيه مكان، والإدارة تغيره بأي وقت
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-seats-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => { calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }) as typeof fetch;

const { myExamAction, schedAdminAction } = await import("../lib/schedApi.ts");
const { studentAction } = await import("../lib/studentApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { addDays, weekdayOf } = await import("../lib/scheduleRules.ts");
const { initDb, find, insert, one, put, update } = await import("../lib/db.ts");
const { todayStr, stamp } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  params.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update("1:test").digest()).update(check).digest("hex"));
  return params.toString();
};
const admin = sign(1);
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...extra }) as Promise<any>;
const kid = (uid: number, gender: string) => put("students", { user_id: uid, name: `طالب ${uid}`, curr: "عربي", grade: "السادس العلمي", gov: "بغداد", area: "x", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", gender, created: "2026-01-01 10:00" });
const nextWeekday = (w: number, after: number) => { let d = addDays(todayStr(), after); while (weekdayOf(d) !== w) d = addDays(d, 1); return d; };

const e1 = await insert("bank_exams", { slug: "s1", chapter: "الفصل الأول", ord: 1, title: "امتحان 1", info: "", minutes: 60 });
const e2 = await insert("bank_exams", { slug: "s1", chapter: "الفصل الأول", ord: 2, title: "امتحان 2", info: "", minutes: 60 });
for (const e of [e1, e2]) await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
// الأحد 4 و6 العصر
await schedAdminAction({ action: "saveSlots", center: 0, slots: [{ d: 6, t: "16:00" }, { d: 6, t: "18:00" }], initData: admin });
const sun1 = nextWeekday(6, 3), sun2 = addDays(sun1, 7);
await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: e1, date: sun1, versions: {} }, { exam: e2, date: sun2, versions: {} }], initData: admin });
for (const [uid, g] of [[201, "بنين"], [202, "بنين"], [203, "بنات"], [204, "ذكر"]] as const) {
  await kid(uid, g);
  await put("exam_access", { user_id: uid, chapter: "الفصل الأول", order_id: 1, created: "1" });
}

test("عدد البنين والبنات بكل وقت: من يكمل، الوقت يطلع مكتمل وما ينختار، والبنات عددهن بروحه", async () => {
  await schedAdminAction({ action: "saveSeats", center: 0, seats: { "6|16:00": { b: 1, g: 1 } }, initData: admin });
  const list: any = await schedAdminAction({ action: "list", center: 0, initData: admin });
  assert.deepEqual(list.seats.find((x: any) => x.t === "16:00").limit, { b: 1, g: 1 });
  await act(201, "joinPlace", { picks: { "6": "16:00" } });
  // الثاني ولد: مكتمل
  const info = await act(202, "info");
  assert.equal(info.days[0].times.find((x: any) => x.t === "16:00").full, true);
  await assert.rejects(act(202, "joinPlace", { picks: { "6": "16:00" } }), /مكتمل للـبنين \(1 من 1\)/);
  // «ذكر» من التطبيق نفس «بنين»
  await assert.rejects(act(204, "joinPlace", { picks: { "6": "16:00" } }), /مكتمل/);
  // البنت عددها بروحه
  await act(203, "joinPlace", { picks: { "6": "16:00" } });
  await act(202, "joinPlace", { picks: { "6": "18:00" } });
  const after: any = await schedAdminAction({ action: "list", center: 0, initData: admin });
  assert.deepEqual(after.seats.find((x: any) => x.t === "16:00").taken, { b: 1, g: 1 });
});

test("الطالب يغير وقت يومه بنفسه إذا امتحانه الجاي بعده أكثر من 24 ساعة وبيه مكان، وكل امتحاناته الجاية تمشي", async () => {
  await assert.rejects(act(202, "movePick", { d: 6, time: "16:00" }), /مكتمل/);
  const r = await act(201, "movePick", { d: 6, time: "18:00" });
  assert.match(r.notice, /صار وقتك يوم الأحد الساعة 6:00 مساءً/);
  assert.deepEqual((await find("sched_items", { user_id: 201, status: "waiting" })).map((i) => i.at).sort(), [`${sun1} 18:00`, `${sun2} 18:00`]);
  // هسه 16:00 فرغ: 202 يگدر ينتقل
  await act(202, "movePick", { d: 6, time: "16:00" });
  // امتحانه الجاي بعد أقل من 24 ساعة: ما يتغير
  const soon = new Date(Date.now() + 5 * 3_600_000).toISOString();
  const at = `${soon.slice(0, 10)} ${soon.slice(11, 13)}:00`;
  const day = at.slice(0, 10), W = weekdayOf(day);
  await schedAdminAction({ action: "saveSlots", center: 0, slots: [{ d: 6, t: "16:00" }, { d: 6, t: "18:00" }, { d: W, t: at.slice(11, 16) }, { d: W, t: "23:59" }], initData: admin });
  await schedAdminAction({ action: "saveDates", center: 0, rows: [{ exam: e1, date: day, versions: {} }, { exam: e2, date: sun2, versions: {} }], initData: admin });
  await update("schedules", { user_id: 203 }, { picks: JSON.stringify({ "6": "16:00", [String(W)]: at.slice(11, 16) }) });
  await act(203, "info");
  assert.ok((await find("sched_items", { user_id: 203, status: "waiting" })).some((i) => i.at === at));
  await assert.rejects(act(203, "movePick", { d: weekdayOf(at.slice(0, 10)), time: "23:59" }), /أقل من 24 ساعة/);
  void stamp;
});

test("الإدارة تغير وقته بأي وقت، والمكتمل يحتاج «فوك العدد»، والطالب يوصله خبر", async () => {
  // 16:00 هسه بيه 202 (ولد): 201 ما يدخل بدون تأكيد
  await assert.rejects(studentAction({ action: "schedPick", id: 201, d: 6, time: "16:00", initData: admin }), /فوك العدد/);
  calls.length = 0;
  const r: any = await studentAction({ action: "schedPick", id: 201, d: 6, time: "16:00", force: true, initData: admin });
  assert.match(r.notice, /وقته يوم الأحد الساعة 4:00 مساءً/);
  assert.equal(JSON.parse((await one("schedules", { user_id: 201 }))!.picks)["6"], "16:00");
  assert.ok(calls.some((c) => Number(c.p.chat_id) === 201 && /تغير وقت امتحاناتك/.test(c.p.text)));
  assert.deepEqual(r.sched.times.picks, { "6": "16:00" });
  await put("staff", { user_id: 30, name: "مساعد", perms: "orders" });
  await assert.rejects(studentAction({ action: "schedPick", id: 201, d: 6, time: "18:00", initData: sign(30) }), (x: any) => x.status === 403);
});
