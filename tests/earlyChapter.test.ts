// 🚀 الفصل الرابع قبل نصف السنة: المراجعات إجبارية، وبس اللي يبدي الفصل الرابع مبكر يختار ويا المراجعات لو بدونها
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-early-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as unknown as typeof fetch;

const { myExamAction, schedAdminAction } = await import("../lib/schedApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
const { initDb, find, insert, kvGet, kvSet, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
const { outOf } = await import("../lib/graderPay.ts");
await initDb();

const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...extra }) as Promise<any>;
const student = (uid: number, exam = "إلكتروني") => put("students", { user_id: uid, username: "", gender: "بنين", name: `طالب ${uid}`, curr: "عربي", grade: "السادس العلمي", gov: "البصرة", side: "", area: "ع", phone1: "07701234567", phone2: "07801234567", exam, created: "2026-01-01 10:00" });
const T = (n: number) => addDays(todayStr(), n);
const ALL = { "0": "16:00", "1": "16:00", "2": "16:00", "3": "16:00", "4": "16:00", "5": "16:00", "6": "16:00" };
const join = async (uid: number, chapters: string[]) => {
  await student(uid);
  for (const ch of chapters) await put("exam_access", { user_id: uid, chapter: ch, order_id: 1, created: "1" });
  await put("schedules", { user_id: uid, mode: "general", center_id: 0, picks: JSON.stringify(ALL), created: "1" });
};
const exam = async (slug: string, chapter: string, ord: number, day: string) => {
  const id = await insert("bank_exams", { slug, chapter, ord, title: `${chapter} ${ord}`, info: "", minutes: 60 });
  await insert("bank_versions", { exam_id: id, model: "A", kind: "mandatory", ok: 1 });
  await put("place_dates", { center_id: 0, exam_id: id, day, versions: "{}" });
  return id as number;
};

// المكان الإلكتروني يمتحن كل يوم الساعة 4. الفصل الثالث باچر وعگبه، والمراجعة (فاينل الأول ويا الفصل الثالث) بعدها،
// وعطلة نصف السنة من بعد شهر، والفصل الرابع ورا العطلة
await put("place_slots", { center_id: 0, slots: JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, t: "16:00" }))) });
const c3 = [await exam("c3", "الفصل الثالث", 1, T(1)), await exam("c3", "الفصل الثالث", 2, T(2))];
const review = await exam("c1", "الفصل الأول", 9, T(3));
await kvSet("exam_with_chapter", JSON.stringify({ [review]: "الفصل الثالث" }));
const c4 = [await exam("c4", "الفصل الرابع", 1, T(50)), await exam("c4", "الفصل الرابع", 2, T(51)), await exam("c4", "الفصل الرابع", 3, T(52))];
const settings = { holidayStart: T(30), holidayDays: 15, holidayNote: "عطلة نصف السنة" };
await kvSet("sched_settings", JSON.stringify({ ...settings, earlyOpen: false }));
const atOf = async (uid: number, id: number) => (await find("sched_items", { user_id: uid, exam_id: id })).filter((i) => i.status === "waiting").map((i) => String(i.at));

test("مسدود بالأصل: ولا طالب يطلعله الخيار لحد ما صاحب البوت يفتحه", async () => {
  await join(500, ["الفصل الثالث", "الفصل الرابع"]);
  assert.equal((await act(500, "info")).early, null);
  await assert.rejects(act(500, "earlyStart", { with: true }), /مو مفتوح/);
});

test("ينفتح: يطلع بس للمشتري الفصل الرابع، ويا المراجعات ومواعيدها، والمراجعات إجبارية على الباقين", async () => {
  await kvSet("sched_settings", JSON.stringify({ ...settings, earlyOpen: true }));
  const j = await act(500, "info");
  assert.ok(j.early?.offer);
  assert.equal(j.early.offer.chapter, "الفصل الرابع");
  assert.equal(j.early.offer.count, 3);
  assert.deepEqual(j.early.offer.reviews.map((r: any) => r.at), [`${T(3)} 16:00`]);
  // ويا المراجعات: يوم الفصل الثالث ويوم المراجعة ينعبرون، امتحان واحد باليوم
  assert.equal(j.early.offer.withPlan.first, `${T(4)} 16:00`);
  assert.equal(j.early.offer.withPlan.last, `${T(6)} 16:00`);
  assert.equal(j.early.offer.withPlan.before, 3);
  // بدونها: يوم المراجعة يصير للفصل الرابع
  assert.equal(j.early.offer.withoutPlan.first, `${T(3)} 16:00`);
  // اللي ما مشتري الفصل الرابع: ما يطلعله شي، ومراجعته بمكانها
  await join(501, ["الفصل الثالث"]);
  const j1 = await act(501, "info");
  assert.equal(j1.early, null);
  assert.deepEqual(await atOf(501, review), [`${T(3)} 16:00`]);
  // الطالب الإلكتروني ما يمتحن بالمركز
  await assert.rejects(act(500, "earlyStart", { with: true, mode: "ipad", kit: true }), /لطالب المركز بس/);
});

test("بدون المراجعات: الفصل الرابع ينحط من باچر بالأيام الفاضية، والمراجعة تنشال (مو غياب)، وجماعته ما يتغيرون", async () => {
  const r = await act(500, "earlyStart", { with: false, mode: "online" });
  assert.match(r.notice, /انثبت: 3 امتحان/);
  assert.deepEqual(await atOf(500, c4[0]), [`${T(3)} 16:00`]);
  assert.deepEqual(await atOf(500, c4[2]), [`${T(5)} 16:00`]);
  const items = await find("sched_items", { user_id: 500, kind: "early" });
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => Number(i.fixed) === 1 && i.catch_place === "online"));
  assert.ok(outOf(items[0]), "ورقته تروح لمصححين الاستثناء");
  const skipped = await find("sched_items", { user_id: 500, exam_id: review });
  assert.deepEqual(skipped.map((i) => i.status), ["skipped"]);
  // بجدوله: الفصل الرابع بمواعيده الجديدة، والمراجعة مو موجودة، والفصل الثالث مثل ما هو
  const info = await act(500, "info");
  assert.ok(!info.items.some((i: any) => i.exam === review));
  assert.ok(info.items.some((i: any) => i.exam === c3[0] && i.at === `${T(1)} 16:00`));
  assert.ok(!info.items.some((i: any) => i.exam === c4[0] && i.at.startsWith(T(50))), "موعد جماعته القديم انشال");
  assert.ok(info.early.chosen && info.early.chosen.with === false);
  // طالب ثاني ما تغير شي بجدوله
  assert.deepEqual(await atOf(501, review), [`${T(3)} 16:00`]);
  // لصاحب البوت: يطلع اسمه بصفحة الجدول
  const page: any = await schedAdminAction({ action: "list", center: 0, initData: sign(1) });
  assert.equal(page.early.length, 1);
  assert.equal(page.early[0].with, false);
});

test("يرجع ويا جماعته قبل أول امتحان: الفصل الرابع يرجع ورا العطلة والمراجعة ترجع، وبعدها يختار ويا المراجعات", async () => {
  const u = await act(500, "earlyUndo");
  assert.match(u.notice, /رجعت ويا جماعتك/);
  assert.equal((await find("sched_items", { user_id: 500, kind: "early" })).length, 0);
  assert.deepEqual(await atOf(500, review), [`${T(3)} 16:00`]);
  assert.deepEqual(await atOf(500, c4[0]), [`${T(50)} 16:00`]);
  assert.ok(u.early.offer, "يرجع يطلعله الخيار");
  const r = await act(500, "earlyStart", { with: true, mode: "online" });
  assert.match(r.notice, /انثبت/);
  assert.deepEqual(await atOf(500, review), [`${T(3)} 16:00`], "المراجعة بمكانها");
  assert.deepEqual(await atOf(500, c4[0]), [`${T(4)} 16:00`]);
  assert.deepEqual(await atOf(500, c4[2]), [`${T(6)} 16:00`]);
  // مرة وحدة بس
  await assert.rejects(act(500, "earlyStart", { with: true }), /مو مفتوح/);
});

test("بعد ما بدا أول امتحان ما يگدر يرجع، والإدارة تحفظ الخيار", async () => {
  await put("sched_items", { ...(await find("sched_items", { user_id: 500, exam_id: c4[0], kind: "early" }))[0], at: `${T(-1)} 16:00`, status: "missed" });
  await assert.rejects(act(500, "earlyUndo"), /ما يصير ترجع/);
  assert.equal((await act(500, "info")).early, null);
  const saved: any = await schedAdminAction({ action: "save", window: 15, extra: 15, perDay: 2, gap: 30, holidayStart: settings.holidayStart, holidayDays: 15, earlyOpen: false, initData: sign(1) });
  assert.equal(saved.earlyOpen, false);
  assert.equal(JSON.parse(await kvGet("sched_settings") ?? "{}").earlyOpen, false);
});
