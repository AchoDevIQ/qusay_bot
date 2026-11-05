// باقي صفحات لوحة التحكم: الصلاحيات والمنطق
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-ad-"));
const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
const sent: any[] = [];
globalThis.fetch = (async (url: string, o: any) => {
  if (typeof o?.body === "string") sent.push({ m: String(url).split("/").pop(), p: JSON.parse(o.body) }); else sent.push({ m: String(url).split("/").pop() });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { adminMenuFor } = await import("../lib/admin.ts");
const { adminHomeAction } = await import("../lib/adminHomeApi.ts");
const { curriculumAction, hoursAction, onlineAction, questionsAction } = await import("../lib/settingsApi.ts");
const { staffAction } = await import("../lib/staffApi.ts");
const { libAction } = await import("../lib/libApi.ts");
const { orderAction, salesAction } = await import("../lib/orderApi.ts");
const { initDb, find, insert, kvGet, one, put } = await import("../lib/db.ts");
const { can, qHours, staffAccount, viewingAsStudent, setStudentView } = await import("../lib/data.ts");
const { joinOfficeByCode } = await import("../lib/office.ts");
const { stamp } = await import("../lib/util.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const initData = sign(1);
const as = <T extends (b: any) => Promise<any>>(fn: T) => (b: Record<string, unknown> = {}) => fn({ initData, ...b });
const staff = as(staffAction), lib = as(libAction), orders = as(orderAction), sales = as(salesAction), hours = as(hoursAction), cur = as(curriculumAction), online = as(onlineAction);
const status = (s: number) => (e: any) => e.status === s;
await initDb();
await put("students", { user_id: 100, username: "u", name: "علي حسن محمد كاظم", curr: "عربي", grade: "السادس العلمي", gov: "بغداد", side: "الكرخ", area: "المنصور", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", center_id: null, created: stamp(), updated: "" });
const cid = await insert("cats", { name: "ملازم" });
const pid = await insert("products", { name: "امتحانات الفصل الأول إلكتروني", price: 5000, cat_id: cid, mode: "online" });
const order = (printed: number, o: Record<string, unknown> = {}) => insert("orders", {
  user_id: 100, username: "u", name: "علي حسن", curr: "عربي", gov: "بغداد", side: "", area: "المنصور", phone1: "07701234567", phone2: "07801234567",
  items: JSON.stringify([{ id: pid, name: "م", price: 5000, qty: 1 }]), subtotal: 5000, fee: 1000, total: 6000, created: stamp(), printed, ...o,
});

test("زر لوحة التحكم يفتح الصفحة، وبس هو", async () => {
  const kb = (await adminMenuFor(1))[1];
  assert.equal(kb.flat().length, 1);
  assert.match(kb[0][0].web_app!.url, /\/store\/admin\?/);
});

test("الصفحة الرئيسية تطلع حسب الصلاحية", async () => {
  await put("staff", { user_id: 5, name: "م", perms: "orders" });
  const pages = async (u: number) => (await adminHomeAction({ action: "list", initData: sign(u) })).groups.flatMap((g: any) => g.tiles.map((t: any) => t.page));
  const all = await pages(1);
  for (const p of ["orders", "sales", "products", "fees", "online", "exams", "students", "centers", "questions", "libs", "staff", "hours", "curriculum"]) {
    assert.ok(all.includes(p), p);
    const file = path.join("app", "store", p, "page.tsx");
    assert.ok(fs.existsSync(file), file);                                              // كل زر إله صفحة
    assert.ok(fs.existsSync(path.join("app", "api", p, "route.ts")), p);
  }
  assert.deepEqual(await pages(5), ["orders"]);
  await assert.rejects(adminHomeAction({ action: "list" }), status(401));
  await assert.rejects(adminHomeAction({ action: "list", initData: sign(2) }), status(403));
});

test("شوف كطالب من الصفحة", async () => {
  await adminHomeAction({ action: "asStudent", initData });
  assert.equal(await viewingAsStudent(1), true);
  assert.equal(await can(1, "orders"), false);
  await setStudentView(1, false);
});

test("صفحات المدير ممنوعة على المساعد والطالب", async () => {
  for (const fn of [staffAction, libAction, hoursAction, curriculumAction]) {
    await assert.rejects(fn({ action: "list" }), status(401));
    await assert.rejects(fn({ action: "list", initData: sign(5) }), status(403));
    await assert.rejects(fn({ action: "list", initData: sign(2) }), status(403));
  }
  await assert.rejects(onlineAction({ action: "list", initData: sign(5) }), status(403));
  await assert.rejects(questionsAction({ action: "list", initData: sign(5) }), status(403));
  await assert.rejects(orderAction({ action: "list", initData: sign(2) }), status(403));
  await assert.rejects(salesAction({ action: "sale", sid: 100, items: [[pid, 1]], initData: sign(2) }), status(403));
});

test("الفصول الإلكترونية", async () => {
  assert.deepEqual((await online({ action: "list" })).chapters, [{ label: "الفصل الأول", on: false }]);
  assert.equal((await online({ action: "toggle", label: "الفصل الأول" })).chapters[0].on, true);
  assert.equal(await kvGet("online_only"), JSON.stringify(["الفصل الأول"]));
  assert.equal((await online({ action: "toggle", label: "الفصل الأول" })).chapters[0].on, false);
  await assert.rejects(online({ action: "toggle", label: "الفصل التاسع" }), /الفصل/);
});

test("أوقات الأسئلة", async () => {
  await assert.rejects(hours({ action: "save", on: true, days: [0], from: "25:00", to: "10:00" }), /الوقت/);
  await assert.rejects(hours({ action: "save", on: true, days: [9], from: "10:00", to: "11:00" }), /يوم/);
  const r = await hours({ action: "save", on: false, days: [2, 0, 2], from: "9:30", to: "22:00" });
  assert.deepEqual([r.on, r.days, r.from, r.to], [false, [0, 2], "09:30", "22:00"]);
  assert.equal((await qHours()).on, false);
});

test("الفصول والمواضيع: التعديل يبقى على نفس الصفوف", async () => {
  const start = (await cur({ action: "list" })).chapters;
  const firstCh = (await find("chapters", { active: 1 }, { order: ["ord"] }))[0];
  const firstT = (await find("topics", { chapter_id: firstCh.id, active: 1 }, { order: ["ord"] }))[0];
  const next = structuredClone(start);
  next[0].ar = "فصل معدل";
  next[0].topics[0].ar = "موضوع معدل";
  next[0].topics[0].lectures = "٧";
  next.push({ ar: "فصل أخير", en: "Last", topics: [{ ar: "جديد", en: "", lectures: 1 }] });
  const r = await cur({ action: "save", chapters: next });
  assert.equal(r.chapters.at(-1).ar, "فصل أخير");
  const t = (await one("topics", { id: firstT.id }))!;
  assert.deepEqual([t.ar, t.lectures], ["موضوع معدل", 7]);
  assert.equal((await one("chapters", { id: firstCh.id }))!.ar, "فصل معدل");
  await assert.rejects(cur({ action: "save", chapters: [] }), /فصل/);
  await assert.rejects(cur({ action: "save", chapters: [{ ar: "", topics: [] }] }), /اسم/);
  await assert.rejects(cur({ action: "save", chapters: [{ ar: "أ|ب", topics: [] }] }), /العلامات/);
  await assert.rejects(cur({ action: "save", chapters: [{ ar: "أ", topics: [{ ar: "ت", lectures: "x" }] }] }), /المحاضرات/);
});

test("المساعدين: إضافة، صلاحيات، دفعة، رصيد، وحذف", async () => {
  await assert.rejects(staff({ action: "add", id: "abc", name: "س" }), /رقم/);
  await assert.rejects(staff({ action: "add", id: "12345", name: "" }), /اسم/);
  sent.length = 0;
  const r = await staff({ action: "add", id: "٥٥٥١٢٣", name: "أحمد" });
  assert.deepEqual(r.staff.find((s: any) => s.id === 555123).perms, ["q"]);
  assert.ok(sent.some((x) => x.p?.chat_id === 555123));
  await assert.rejects(staff({ action: "add", id: "555123", name: "ثاني" }), /موجود/);
  await assert.rejects(staff({ action: "perms", id: 555123, perms: ["hack"] }), /صلاحية/);
  await staff({ action: "perms", id: 555123, perms: ["orders", "q", "sales"] });
  assert.equal(await can(555123, "orders"), true);
  assert.equal(await can(555123, "students"), false);
  await order(3, { seller: 555123, total: 10_000_000 });
  sent.length = 0;
  await staff({ action: "pay", id: 555123, amount: "4 مليون" });
  assert.equal((await staffAccount(555123)).owed, 6_000_000);
  assert.ok(sent.some((x) => x.p?.chat_id === 555123 && /سجّل استلام/.test(x.p.text)));
  await assert.rejects(staff({ action: "pay", id: 555123, amount: "x" }), /مبلغ/);
  await staff({ action: "limit", id: 555123, amount: "6100000" });
  assert.equal((await staffAccount(555123)).limit, 6_100_000);

  // الرصيد يوقف البيع بالصفحة، مثل البوت
  await assert.rejects(salesAction({ action: "sale", sid: 100, items: [[pid, 50]], initData: sign(555123) }), /الرصيد/);
  await staff({ action: "del", id: 555123 });
  assert.equal(await can(555123, "orders"), false);
});

test("الطلبات: PDF، تم الطباعة يبلغ الطالب، والملغي ما يتحرك، والإرجاع", async () => {
  const a = await order(0), b = await order(0), c = await order(2);
  const r = await orders({ action: "list" });
  assert.ok(r.fresh.some((o: any) => o.id === a));
  assert.equal(r.fresh.some((o: any) => o.id === c), false);
  await assert.rejects(orders({ action: "pdf", ids: [] }), /حدد/);
  await assert.rejects(orders({ action: "pdf", ids: [c] }), /ما بقت/);
  sent.length = 0;
  await orders({ action: "pdf", ids: [a, b] });
  assert.ok(sent.some((x) => x.m === "sendDocument"));
  sent.length = 0;
  const d = await orders({ action: "done", ids: [a, c] });
  assert.equal((await one("orders", { id: a }))!.printed, 1);
  assert.equal((await one("orders", { id: c }))!.printed, 2);
  assert.match(d.notice, /ألغاها/);
  assert.equal(sent.filter((x) => x.p?.chat_id === 100).length, 1);
  assert.ok(d.printed.some((o: any) => o.id === a));
  await orders({ action: "back", id: a });
  assert.equal((await one("orders", { id: a }))!.printed, 0);
  await assert.rejects(orders({ action: "back", id: a }), /المطبوعة/);
});

test("بيع بالمكتب وسجله", async () => {
  const r0 = await sales({ action: "list", q: "علي" });
  assert.deepEqual(r0.results.map((x: any) => x.id), [100]);
  assert.equal(r0.catalog[0].items[0].id, pid);
  await assert.rejects(sales({ action: "sale", sid: 999, items: [[pid, 1]] }), /الطالب/);
  await assert.rejects(sales({ action: "sale", sid: 100, items: [] }), /منتج/);
  sent.length = 0;
  const r = await sales({ action: "sale", sid: 100, items: [[pid, 2]] });
  const o = (await one("orders", { id: r.soldId }))!;
  assert.deepEqual([o.printed, o.total, o.seller, o.office_id], [3, 10000, 1, null]);
  assert.ok(sent.some((x) => x.p?.chat_id === 100));                                   // الوصل وصل الطالب
  assert.ok(await one("exam_access", { user_id: 100, chapter: "الفصل الأول" }));       // وانفتحت امتحاناته
  assert.ok(r.sales.some((s: any) => s.id === r.soldId));
  assert.equal(r.day, r.today);
  assert.equal(r.next, null);
  assert.ok((await sales({ action: "list", day: r.prev })).next);
  assert.equal((await sales({ action: "list", day: "2999-01-01" })).day, r.today);     // ماكو يوم بالمستقبل
  sent.length = 0;
  await sales({ action: "pdf", day: r.day });
  assert.ok(sent.some((x) => x.m === "sendDocument"));
  await assert.rejects(sales({ action: "pdf", day: "2000-01-01" }), /مبيعات/);
  await assert.rejects(sales({ action: "receipt", id: 99999, kind: "paper" }), /البيعة/);
});

test("المكتبات: حساب برمز، مبيعات، محاسبة، أرشيف، وحذف", async () => {
  const { openId: oid } = await lib({ action: "add", name: "مكتبة 1" });
  await lib({ action: "rename", id: oid, name: "مكتبة أ" });
  await lib({ action: "limit", id: oid, amount: "2 مليون" });
  await assert.rejects(lib({ action: "limit", id: oid, amount: "x" }), /رقم/);

  const { invite } = await lib({ action: "invite", id: oid });
  assert.match(invite.link, new RegExp(`lib_${invite.code}$`));
  await joinOfficeByCode(777777, 777777, invite.code, { first_name: "أبو أحمد" });
  await joinOfficeByCode(888888, 888888, invite.code, { first_name: "ثاني" });          // الرمز مرة وحدة
  assert.ok(await one("office_users", { user_id: 777777, office_id: oid }));
  assert.equal(await one("office_users", { user_id: 888888 }), null);
  await assert.rejects(lib({ action: "addUser", id: oid, user: "abc", name: "س" }), /رقم/);
  await lib({ action: "addUser", id: oid, user: "666666", name: "س" });
  await lib({ action: "delUser", user: 666666 });
  assert.equal(await one("office_users", { user_id: 666666 }), null);

  await order(3, { office_id: oid, seller: 777777, total: 3000 });
  await order(3, { office_id: oid, seller: 777777, total: 4000 });
  const r = await lib({ action: "sales", id: oid, kind: "open" });
  assert.equal(r.sales.rows.length, 2);
  const row = r.offices.find((o: any) => o.id === oid);
  assert.deepEqual([row.open.total, row.today.n, row.users.length], [7000, 2, 1]);
  await assert.rejects(lib({ action: "settle", id: oid, amount: 3000 }), /مبيعات جديدة/);  // مبلغ قديم
  sent.length = 0;
  const s = await lib({ action: "settle", id: oid, amount: 7000 });
  const after = s.offices.find((o: any) => o.id === oid);
  assert.deepEqual([after.open.n, after.settled, after.archive.length], [0, 7000, 1]);
  assert.ok(sent.some((x) => x.p?.chat_id === 777777 && /تمت المحاسبة/.test(x.p.text)));
  await assert.rejects(lib({ action: "settle", id: oid, amount: 0 }), /ما أكو/);
  sent.length = 0;
  await lib({ action: "settlePdf", id: after.archive[0].id });
  assert.ok(sent.some((x) => x.m === "sendDocument"));

  await lib({ action: "del", id: oid });
  assert.equal((await lib({ action: "list" })).offices.some((o: any) => o.id === oid), false);
  assert.equal(await one("office_users", { user_id: 777777 }), null);
  await assert.rejects(lib({ action: "rename", id: oid, name: "س" }), /غير موجودة/);
});
