// شركة التوصيل: رقم وصل الشركة على الطلب، البحث، الراجع بمربعين، والحساب وصل وصل
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-co-"));
const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { orderAction, cleanCoNo } = await import("../lib/orderApi.ts");
const { initDb, insert, one, put } = await import("../lib/db.ts");
const { stamp } = await import("../lib/util.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const as = (uid: number) => (b: Record<string, unknown>) => orderAction({ initData: sign(uid), ...b });
const owner = as(1), printer = as(5), coMan = as(6);
const status = (s: number) => (e: any) => e.status === s;
await initDb();
await put("staff", { user_id: 5, name: "طباع", perms: "orders" });
await put("staff", { user_id: 6, name: "حسابات", perms: "company" });
const order = (printed: number, o: Record<string, unknown> = {}) => insert("orders", {
  user_id: 100, username: "u", name: "علي حسن", curr: "عربي", gov: "بغداد", side: "", area: "المنصور", phone1: "07701234567", phone2: "",
  items: JSON.stringify([{ id: 1, name: "ملزمة", price: 5000, qty: 1 }]), subtotal: 5000, fee: 1000, total: 6000, created: stamp(), printed, ...o,
});
const a = await order(1), b = await order(1, { name: "زينب كريم", phone1: "07809998877" }), c = await order(1), fresh = await order(0), shop = await order(3);

test("رقم الوصل ينظف: أرقام عربية، مسافات، #", () => {
  assert.equal(cleanCoNo(" ١٠٢٣٤ "), "10234");
  assert.equal(cleanCoNo("#10 234"), "10234");
  assert.equal(cleanCoNo(""), "");
});

test("رقم وصل الشركة ينحفظ على الطلب المطبوع، وما يتكرر", async () => {
  const r = await printer({ action: "coNo", id: a, no: "٥٠٠١" });
  assert.match(r.notice, /5001/);
  assert.equal((await one("orders", { id: a }))!.co_no, "5001");
  await assert.rejects(printer({ action: "coNo", id: b, no: "5001" }), new RegExp(`#${a}`));   // نفس الرقم على طلب ثاني
  await printer({ action: "coNo", id: b, no: "5002" });
  await assert.rejects(printer({ action: "coNo", id: fresh, no: "5003" }), /ما انطبع/);
  await assert.rejects(printer({ action: "coNo", id: shop, no: "5003" }), /غير موجود/);
  // التصليح باليد: يتغير ويتشال
  await printer({ action: "coNo", id: b, no: "5009" });
  assert.equal((await one("orders", { id: b }))!.co_no, "5009");
  await printer({ action: "coNo", id: b, no: "" });
  assert.equal((await one("orders", { id: b }))!.co_no, null);
  await printer({ action: "coNo", id: b, no: "5002" });
});

test("البحث: برقم الشركة أول، ورقم وصلنا، والاسم، والهاتف. وبيع المكتبات ما يطلع", async () => {
  assert.deepEqual((await printer({ action: "search", q: "5002" })).found.map((o: any) => o.id), [b]);
  assert.deepEqual((await printer({ action: "search", q: String(c) })).found.map((o: any) => o.id), [c]);
  assert.deepEqual((await printer({ action: "search", q: "زينب" })).found.map((o: any) => o.id), [b]);
  assert.deepEqual((await printer({ action: "search", q: "9998877" })).found.map((o: any) => o.id), [b]);
  assert.ok(!(await printer({ action: "search", q: String(shop) })).found.some((o: any) => o.id === shop));
  const f = (await coMan({ action: "search", q: "5001" })).found[0];
  assert.deepEqual([f.id, f.coNo, f.ret, f.retGot], [a, "5001", false, false]);
  await assert.rejects(printer({ action: "search", q: " " }), /اكتب/);
  // البحث يبقى بعد أي أمر ثاني
  assert.equal((await printer({ action: "coNo", id: a, no: "5001", q: "5001" })).found[0].id, a);
});

test("الراجع: ❌ يطلع من الحساب، ✅ استلمت البضاعة، وكلشي يرجع، والطلب ما ينمسح", async () => {
  await assert.rejects(printer({ action: "ret", id: b, on: true }), status(403));      // صلاحية الحساب بس
  await assert.rejects(coMan({ action: "retGot", id: b, on: true }), /❌ راجع أول/);
  let r = await coMan({ action: "ret", id: b, on: true });
  assert.ok(!r.company.open.some((o: any) => o.id === b));
  assert.deepEqual(r.company.returns.map((o: any) => [o.id, o.ret, o.retGot]), [[b, true, false]]);
  assert.equal(r.company.retWaiting, 1);
  await assert.rejects(owner({ action: "back", id: b }), /راجع/);
  r = await coMan({ action: "retGot", id: b, on: true });
  assert.equal(r.company.retWaiting, 0);
  assert.deepEqual(r.company.returns.map((o: any) => [o.id, o.retGot]), [[b, true]]);
  await assert.rejects(coMan({ action: "ret", id: b, on: false }), /شيل ✅ أول/);
  r = await coMan({ action: "retGot", id: b, on: false });
  assert.equal(r.company.retWaiting, 1);
  r = await coMan({ action: "ret", id: b, on: false });
  assert.ok(r.company.open.some((o: any) => o.id === b));
  assert.deepEqual(r.company.returns, []);
  await coMan({ action: "ret", id: b, on: true });
  assert.ok(await one("orders", { id: b }));
});

test("الحساب: الراجع ما ينحسب، واللي شلت عنه الصح يبقى للجاي، وما ينحسب مرتين", async () => {
  const d = await order(1);
  let r = await coMan({ action: "list" });
  assert.deepEqual(r.company.open.map((o: any) => [o.id, o.coNo]), [[a, "5001"], [c, ""], [d, ""]]);
  await assert.rejects(coMan({ action: "settle", from: a, to: d, net: 15000, skip: [c] }), /تغيرت/);
  r = await coMan({ action: "settle", from: a, to: d, net: 10000, skip: [c] });      // وصلين، كل واحد 6000 - 1000
  assert.match(r.notice, /2 طلب/);
  assert.deepEqual(r.company.open.map((o: any) => o.id), [c]);
  assert.equal(r.company.archive[0].net, 10000);
  await assert.rejects(coMan({ action: "settle", from: a, to: a, net: 5000 }), /ماكو طلبات/);   // ما ينحسب مرتين
  await assert.rejects(coMan({ action: "ret", id: a, on: true }), /انحسب/);
  // وين وصلت: آخر وصل محاسب
  assert.deepEqual(r.company.last, { id: d, coNo: "", co: 5001 });
});

test("الحساب حسب وصل الشركة: المدى بأرقامهم، والراجع بالمدى ينعد، والسجل يحفظ الطريقة", async () => {
  const e = await order(1), f = await order(1), g = await order(1), h = await order(1);
  for (const [id, no] of [[e, "7003"], [f, "7001"], [g, "7002"], [h, "7010"]] as const) await printer({ action: "coNo", id, no });
  await coMan({ action: "ret", id: g, on: true });
  let r = await coMan({ action: "list" });
  assert.ok(r.company.retAll.some((o: any) => o.id === g && o.coNo === "7002" && !o.retGot));
  // 7001 إلى 7005: وصلين (7001 و7003)، و7002 راجع ما ينحسب، و7010 برا المدى، و c بلا رقم شركة ما يدخل
  await assert.rejects(coMan({ action: "settle", by: "co", from: 7001, to: 7005, net: 15000 }), /تغيرت/);
  r = await coMan({ action: "settle", by: "co", from: 7001, to: 7005, net: 10000 });
  assert.match(r.notice, /2 طلب/);
  const s = r.company.archive[0];
  assert.deepEqual([s.by, s.from, s.to, s.n, s.rets, s.net], ["co", 7001, 7005, 2, 1, 10000]);
  assert.deepEqual(r.company.open.map((o: any) => o.id).sort(), [c, h].sort());
  assert.equal(r.company.last.id, f);                                   // أكبر وصل محاسب برقمنا
  assert.equal(r.company.last.co, 7003);
  // ✅ للراجع من نفس المكان
  r = await coMan({ action: "retGot", id: g, on: true });
  assert.ok(r.company.retAll.find((o: any) => o.id === g).retGot);
});
