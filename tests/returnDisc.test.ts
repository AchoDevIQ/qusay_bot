// خصم طالب العام: اللي اشترى فصل بالسنة الدراسية اللي فاتت ياخذ نفس النوع من نفس الفصل بخصم، بالمتجر والمكتبة والوصل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-retdisc-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp,
  CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"),
});
delete process.env.NO_WORD_CHECK;

const calls: { method: string; p: any }[] = [];
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId } }));
}) as typeof fetch;

const { handleUpdate } = await import("../lib/bot.ts");
const { initDb, insert, one, put, find } = await import("../lib/db.ts");
const R = await import("../lib/returnDisc.ts");
const { lineTotal, itemLabel } = await import("../lib/orderRules.ts");
const { posSale } = await import("../lib/office.ts");
const { productAction } = await import("../lib/productApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();

const Y = R.schoolYear(stamp());
const LAST = `${Y - 1}-12-01 10:00`, NOW = `${Y}-11-20 10:00`, NEXT = `${Y + 1}-08-01 10:00`;
const cat = Number(await insert("cats", { name: "الفصول", active: 1 }));
const add = async (name: string, price: number) => Number(await insert("products", { name, price, cat_id: cat, mode: "both", active: 1, hidden: 0 }));
const ex1 = await add("الفصل الأول - امتحانات إلكتروني", 30000);
const lec1 = await add("الفصل الأول - محاضرات", 20000);
const both1 = await add("الفصل الأول - محاضرات + امتحانات إلكتروني", 45000);
const ex2 = await add("الفصل الثاني - امتحانات إلكتروني", 30000);
const book1 = await add("دفتر محاضرات الفصل الأول", 15000);
const item = (name: string, price: number, qty = 1) => ({ name, price, qty });
const order = async (uid: number, created: string, items: object[], extra: object = {}) =>
  Number(await insert("orders", { user_id: uid, name: "طالب", items: JSON.stringify(items), subtotal: 0, fee: 0, total: 0, created, printed: 1, ...extra }));
const student = async (uid: number) => await put("students", { user_id: uid, name: "علي حسن محمد كاظم", curr: "عربي", grade: "السادس العلمي", gov: "البصرة", side: "", area: "العشار قرب الجسر", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", created: LAST });

test("السنة الدراسية تبدي ببداية الشهر السادس", () => {
  assert.equal(R.schoolYear("2027-05-31 23:59"), 2026);
  assert.equal(R.schoolYear("2027-06-01 00:00"), 2027);
  assert.equal(R.schoolYear("2026-09-01 08:00", "09-01"), 2026);
  assert.equal(R.schoolYear("2026-08-31 08:00", "09-01"), 2025);
  assert.equal(R.yearName(2026), "2026-2027");
});

test("اشترى امتحانات الفصل الأول بس: الخصم على امتحانات الفصل الأول بس", async () => {
  await order(70, LAST, [item("الفصل الأول - امتحانات إلكتروني", 30000), item("دفتر محاضرات الفصل الأول", 15000)]);
  const d = await R.discountsFor(70, undefined, NOW);
  assert.deepEqual(d.get(ex1), { price: 15000, was: 30000 });
  assert.equal(d.has(lec1), false, "المحاضرات ما أخذها، فما عليها خصم");
  // المشترك: حصة المحاضرات = سعر المحاضرات لوحدها (20000)، والخصم على حصة الامتحانات (25000) بس
  assert.deepEqual(d.get(both1), { price: 45000 - 12500, was: 45000 });
  assert.equal(d.has(ex2), false, "فصل ثاني");
  assert.equal(d.has(book1), false, "الدفاتر ما عليها خصم");
  assert.equal((await R.discountsFor(70, undefined, NEXT)).size, 0, "بعد سنتين ما يبقى خصم");
});

test("الملغي والراجع وطالب السنة نفسها ما ياخذون خصم", async () => {
  await order(71, LAST, [item("الفصل الأول - امتحانات إلكتروني", 30000)], { printed: 2 });
  await order(72, LAST, [item("الفصل الأول - امتحانات إلكتروني", 30000)], { ret: 1 });
  await order(73, `${Y}-07-01 10:00`, [item("الفصل الأول - امتحانات إلكتروني", 30000)]);
  for (const uid of [71, 72, 73]) assert.equal((await R.discountsFor(uid, undefined, NOW)).size, 0, String(uid));
});

test("اشترى المشترك السنة اللي فاتت: الخصم على النوعين، ومرة وحدة بالسنة", async () => {
  await order(74, LAST, [item("الفصل الأول - محاضرات + امتحانات إلكتروني", 45000)]);
  let d = await R.discountsFor(74, undefined, NOW);
  assert.deepEqual(d.get(both1), { price: 22500, was: 45000 });
  assert.deepEqual(d.get(lec1), { price: 10000, was: 20000 });
  // اشترى امتحاناته هالسنة بخصم: ما يتكرر الخصم عليها، والمحاضرات بعدها عليها خصم
  await order(74, NOW, [item("الفصل الأول - امتحانات إلكتروني", 15000)], { printed: 0 });
  d = await R.discountsFor(74, undefined, NOW);
  assert.equal(d.has(ex1), false);
  assert.deepEqual(d.get(lec1), { price: 10000, was: 20000 });
});

test("فصول التطبيق تنحفظ لهالسنة وتنطي خصم السنة الجاية", async () => {
  await R.recordAppBuys(75, ["الفصل الثاني"], ["الفصل الأول"]);
  await R.recordAppBuys(75, ["الفصل الثاني"], []);
  assert.equal((await find("year_buys", { user_id: 75 })).length, 2);
  const d = await R.discountsFor(75, undefined, NEXT);
  assert.deepEqual(d.get(ex2), { price: 15000, was: 30000 });
  assert.deepEqual(d.get(lec1), { price: 10000, was: 20000 });
  assert.equal(d.has(ex1), false);
});

test("الإطفاء والنسبة من صفحة المنتجات (صلاحية المنتجات)", async () => {
  const sign = `tk:${homeToken(1)}`;
  let r: any = await productAction({ action: "retDisc", pct: "٢٥", initData: sign });
  assert.deepEqual(r.ret, { on: true, pct: 25, start: "06-01" });
  assert.deepEqual((await R.discountsFor(70, undefined, NOW)).get(ex1), { price: 22500, was: 30000 });
  await assert.rejects(productAction({ action: "retDisc", pct: 0, initData: sign }), /من 1 إلى 100/);
  await assert.rejects(productAction({ action: "retDisc", start: "13-01", initData: sign }), /شهر ويوم/);
  r = await productAction({ action: "retDisc", on: false, initData: sign });
  assert.equal(r.ret.on, false);
  assert.equal((await R.discountsFor(70, undefined, NOW)).size, 0);
  await productAction({ action: "retDisc", on: true, pct: 50, initData: sign });
  await put("staff", { user_id: 40, name: "مساعد", perms: "orders" });
  await assert.rejects(productAction({ action: "retDisc", on: false, initData: `tk:${homeToken(40)}` }));
});

test("سطر الخصم: أول نسخة بالخصم والباقي بسعره، والوصل يبين السعر الكامل", () => {
  const disc = new Map([[ex1, { price: 15000, was: 30000 }]]);
  const out = R.withDiscounts([{ id: ex1, name: "امتحانات", price: 30000, qty: 2 }, { id: book1, name: "دفتر", price: 15000, qty: 1 }], disc);
  assert.deepEqual(out, [{ name: "امتحانات", price: 15000, qty: 1, was: 30000 }, { name: "امتحانات", price: 30000, qty: 1 }, { name: "دفتر", price: 15000, qty: 1 }]);
  assert.equal(lineTotal(30000, 2, 15000), 45000);
  assert.equal(lineTotal(30000, 2), 60000);
  assert.match(itemLabel({ name: "امتحانات", was: 30000 }), /خصم طالب العام، سعره 30,000/);
  assert.equal(itemLabel({ name: "دفتر" }), "دفتر");
});

test("البيع بالمكتب: الخصم ينحسب بالسيرفر وينحفظ بالطلب", async () => {
  await student(76);
  await order(76, LAST, [item("الفصل الأول - امتحانات إلكتروني", 30000)]);
  const r = await posSale(1, { sid: 76, i: [[ex1, 1], [book1, 1]] });
  assert.equal(r.total, 15000 + 15000);
  const o = (await one("orders", { id: r.oid }))!;
  assert.equal(o.total, 30000);
  assert.equal(JSON.parse(o.items)[0].was, 30000);
});

test("متجر البوت: الصفحة تستلم سعر الخصم، والسيرفر يقبل المجموع المخصوم بس", async () => {
  const uid = 77;
  await student(uid);
  await order(uid, LAST, [item("الفصل الأول - امتحانات إلكتروني", 30000)]);
  const msg = async (text: string, extra: object = {}) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u", first_name: "ا" }, text, ...extra } });
  await msg("/start");
  calls.length = 0;
  await msg("🛒 المتجر");
  const url = calls.filter((c) => c.p?.reply_markup?.keyboard).at(-1)!.p.reply_markup.keyboard[0][0].web_app.url as string;
  const d = JSON.parse(Buffer.from(new URL(url).searchParams.get("d")!, "base64url").toString("utf8"));
  assert.deepEqual(d.rd.find((x: number[]) => x[0] === ex1), [ex1, 15000]);
  const fee = (await one("fees", { gov: "البصرة" }))?.fee ?? 0;
  const before = (await find("orders", { user_id: uid })).length;
  const send = async (t: number) => await msg("", { text: undefined, web_app_data: { data: JSON.stringify({ p1: "07701234567", p2: "07801234567", i: [[ex1, 1]], t, ag: 1, tm: 1 }) } });
  await send(30000 + fee);                         // صفحة بالسعر الكامل: يطلعله ملخص جديد بالخصم
  assert.equal((await find("orders", { user_id: uid })).length, before);
  assert.ok(calls.some((c) => String(c.p.text ?? "").includes("طالب العام")));
  await send(15000 + fee);
  const o = (await find("orders", { user_id: uid }, { order: ["-id"] }))[0];
  assert.equal(o.subtotal, 15000);
  assert.deepEqual(JSON.parse(o.items), [{ name: "الفصل الأول - امتحانات إلكتروني", qty: 1, price: 15000, was: 30000 }]);
});
