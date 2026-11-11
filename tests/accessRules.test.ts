// القواعد الجديدة: زر واحد لكل حساب، الشراء يفتح الأسئلة، ولي الأمر، المكتبة، حساب الشركة، وسجل الطالب
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-access-"));
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
const { homeAction } = await import("../lib/homeApi.ts");
const { orderAction, salesAction } = await import("../lib/orderApi.ts");
const { productAction } = await import("../lib/productApi.ts");
const { studentAction } = await import("../lib/studentApi.ts");
const { staffAction } = await import("../lib/staffApi.ts");
const { adminHomeAction } = await import("../lib/adminHomeApi.ts");
const { feeAction } = await import("../lib/feeApi.ts");
const { canAsk, guardianLink } = await import("../lib/access.ts");
const { mainKb } = await import("../lib/keyboards.ts");
const { staffAccount } = await import("../lib/data.ts");
const { termSentenceFor } = await import("../lib/orderRules.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { initDb, insert, one, put } = await import("../lib/db.ts");
await initDb();

const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const home = (uid: number, action = "list") => homeAction({ token: homeToken(uid), device: "dev-" + String(uid).padStart(14, "0"), action }) as Promise<any>;
const student = (uid: number, curr = "عربي") => put("students", { user_id: uid, username: "", name: `طالب رقم ${uid} اسم`, curr, grade: "السادس العلمي", gov: "البصرة", side: "", area: "العشار", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", created: "2026-01-01 10:00:00" });
const order = (uid: number, names: string[], o: Record<string, unknown> = {}) => insert("orders", {
  user_id: uid, name: `طالب ${uid}`, curr: "عربي", gov: "البصرة", side: "", area: "ع", phone1: "1", phone2: "2", items: JSON.stringify(names.map((name) => ({ name, qty: 1, price: 1000 }))),
  subtotal: 1000, fee: 200, total: 1200, created: "2026-02-01 10:00:00", ...o,
});
const start = (uid: number, text: string) => handleUpdate({ update_id: Math.random(), message: { message_id: 1, chat: { id: uid, type: "private" }, from: { id: uid, first_name: "ا" }, text } });
const keyTexts = async (uid: number) => (await mainKb(uid)).keyboard.flat().map((b: any) => b.text);

test("كل حساب يطلع له زر واحد، والطالب ما يشوف لوحة التحكم", async () => {
  await student(10);
  await put("staff", { user_id: 20, name: "مساعد", perms: "orders" });
  const off = await insert("offices", { name: "مكتبة النور" });
  await put("office_users", { user_id: 30, office_id: off, name: "صاحبها" });
  assert.deepEqual(await keyTexts(10), ["🏠 فتح القائمة"]);
  assert.deepEqual(await keyTexts(20), ["⚙️ لوحة التحكم"]);
  assert.deepEqual(await keyTexts(30), ["🏪 مكتبتي"]);
  const url = (await mainKb(20)).keyboard[0][0].web_app!.url;
  assert.match(url, /\/store\/admin\?.*t=/);
  // الرمز اللي بالزر يكفي حتى تنفتح اللوحة، بدون رسالة قبلها
  assert.ok(await adminHomeAction({ action: "list", initData: `tk:${homeToken(20)}` }));
  await assert.rejects(adminHomeAction({ action: "list", initData: "tk:20.999.bad" }), (e: any) => e.status === 401);
  await assert.rejects(adminHomeAction({ action: "list", initData: `tk:${homeToken(10)}` }), (e: any) => e.status === 403);
});

test("/start لغير المسجل: رسالة قصيرة وزر التسجيل، والمكتبة والمساعد ما يطلع لهم تسجيل", async () => {
  calls.length = 0;
  await start(40, "/start");
  const texts = JSON.stringify(calls);
  assert.ok(!texts.includes("بعد الحفظ"));
  assert.ok(texts.includes("افتح فورمة التسجيل"));
  calls.length = 0;
  await start(30, "/start");
  assert.ok(!JSON.stringify(calls).includes("فورمة التسجيل"));
  assert.ok(JSON.stringify(calls).includes("مكتبتي"));
});

test("السؤال العلمي بس بعد شراء محاضرات أو امتحانات، وصاحب البوت يطفيه لكل منتج", async () => {
  await student(11);
  const cat = await insert("cats", { name: "قسم" });
  const lec = await insert("products", { name: "محاضرات الفصل الأول", price: 1000, cat_id: cat, mode: "both" });
  await insert("products", { name: "ملزمة الفصل الأول", price: 1000, cat_id: cat, mode: "both" });
  assert.equal(await canAsk(11), false);
  await order(11, ["ملزمة الفصل الأول"]);
  assert.equal(await canAsk(11), false);
  const oid = await order(11, ["محاضرات الفصل الأول"]);
  assert.equal(await canAsk(11), true);
  await productAction({ action: "ask", id: lec, ask: false, initData: sign(1) });
  assert.equal(await canAsk(11), false);
  await productAction({ action: "ask", id: lec, ask: true, initData: sign(1) });
  assert.equal(await canAsk(11), true);
  const { update } = await import("../lib/db.ts");
  await update("orders", { id: oid }, { printed: 2 });
  assert.equal(await canAsk(11), false);   // الطلب الملغي ما يفتح شي
});

test("ورا أول امتحان لازم يربط ولي الأمر: الحساب ينقفل، يحول الرابط، وولي الأمر يضغطه وStart بس", async () => {
  await student(12);
  assert.equal((await home(12)).link, null);
  await order(12, ["امتحانات الفصل الأول"]);
  assert.equal((await home(12)).link, null);                // الشراء وحده ما يقفل
  await insert("sched_items", { user_id: 12, exam_id: 1, at: "2026-01-01 10:00", status: "done", notified: "test" });
  assert.equal((await home(12)).link, null);                // امتحان التجربة ما يحسب
  await insert("sched_items", { user_id: 12, exam_id: 1, at: "2026-01-02 10:00", status: "done" });
  // رسالة المحادثة: زر «حوّل لولي أمرك» وزر «انسخ»، والرسالة تشرح لولي الأمر يدوس START بس
  calls.length = 0;
  const { sendGuardianAsk } = await import("../lib/access.ts");
  await sendGuardianAsk(12);
  const m = calls.find((c) => c.p.chat_id === 12)!.p;
  const kb = JSON.stringify(m.reply_markup);
  assert.match(m.text, /حسابك مقفول/);
  assert.ok(kb.includes("حوّل لولي أمرك") && kb.includes("t.me/share/url") && kb.includes("copy_text") && kb.includes("START"));
  const link = (await home(12)).link as string;
  assert.ok(link.includes("?start=par_12_"));
  // الرسالة باسمه الكامل و«توصلكم أول بأول»، وزر «انسخ» ما يقص الرابط (حده 256 حرف)
  const h12 = await home(12);
  assert.match(String(h12.linkText), /آني طالب رقم 12 اسم\.\nاربطوا حسابكم ويا حسابي حتى توصلكم درجاتي أول بأول/);
  assert.ok(String(h12.linkCopy).endsWith(link));
  const { guardianCopy } = await import("../lib/access.ts");
  const long = guardianCopy("عبد الرحمن محمد عبد الله حسين علي الجبوري", link);
  assert.ok(long.length <= 256 && long.endsWith(link));
  await assert.rejects(home(12, "ask"), /ولي أمرك/);
  await assert.rejects(home(12, "exams"), /ولي أمرك/);
  // طالب التجربة (رقمه سالب) ما ينقفل حتى لو عنده أوراق مسلمة
  const { needsGuardian } = await import("../lib/access.ts");
  await insert("students", { user_id: -4, name: "طالب تجربة 4", curr: "عربي" });
  await insert("sched_items", { user_id: -4, exam_id: 1, at: "2026-01-02 10:00", status: "done" });
  assert.equal(await needsGuardian(-4), false);
  assert.equal(await needsGuardian(12), true);
  const param = link.split("?start=")[1];
  calls.length = 0;
  await start(12, `/start ${param}`);                      // الطالب نفسه ما يصير
  assert.match(JSON.stringify(calls), /لولي الأمر، مو للطالب/);
  await start(50, "/start par_12_wrong");
  assert.equal(await one("guardians", { guardian_id: 50 }), null);
  calls.length = 0;
  await start(50, `/start ${param}`);
  assert.ok(await one("guardians", { guardian_id: 50, student_id: 12 }));
  assert.match(JSON.stringify(calls), /مو للمراسلة/);         // من يربط يعرف إن البوت مو للمراسلة
  calls.length = 0;
  await start(50, "شلونكم، شكد درجته؟");                      // ولي الأمر يكتب: يطلعله «مو للمراسلة» ومعرف الأستاذ
  const reply = calls.find((c) => c.method === "sendMessage" && c.p.chat_id === 50)!.p.text;
  assert.match(reply, /هذا البوت مو للمراسلة/);
  assert.match(reply, /راسلوا الأستاذ قصي العميري/);
  assert.equal((await home(12)).link, null);
  calls.length = 0;
  await start(51, `/start ${param}`);                      // ولي أمر ثاني مرفوض
  assert.match(JSON.stringify(calls), /ولي أمر ثاني/);
  assert.equal(await guardianLink(12), link);
  assert.deepEqual((await home(50)).children, ["طالب رقم 12 اسم"]);   // ولي الأمر ما يسجل
  calls.length = 0;
  await start(50, "/start");
  assert.ok(!JSON.stringify(calls).includes("فورمة التسجيل"));
});

test("حذف تسجيل الطالب يشيل امتحاناته، وطلب قبل الحذف ما يفتح شي", async () => {
  await student(13);
  await put("exam_access", { user_id: 13, chapter: "الفصل الأول", order_id: 1, created: "x" });
  assert.equal((await home(13)).exams, true);
  await studentAction({ action: "del", id: 13, initData: sign(1) });
  assert.equal(await one("exam_access", { user_id: 13 }), null);
  await student(13);
  await put("students", { ...(await one("students", { user_id: 13 }))!, created: "2030-01-01 10:00:00" });
  await order(13, ["محاضرات الفصل الأول"]);
  assert.equal(await canAsk(13), false);
});

test("جملة الدور الأول حسب السلة", () => {
  assert.equal(termSentenceFor(["محاضرات الفصل الأول"]), "صلاحية المحاضرات للدور الأول فقط");
  assert.equal(termSentenceFor(["امتحانات الفصل الأول", "ملزمة"]), "صلاحية الامتحانات للدور الأول فقط");
  assert.equal(termSentenceFor(["محاضرات", "امتحانات"]), "صلاحية المحاضرات والامتحانات للدور الأول فقط");
  assert.equal(termSentenceFor(["المحاضرة الأولى مع امتحانها"]), "صلاحية المحاضرات والامتحانات للدور الأول فقط");
});

test("المساعد يشوف المطبوعة اللي طبعها بس، وإعادة الطباعة والملف ينشاف", async () => {
  await put("staff", { user_id: 21, name: "سجاد", perms: "orders" });
  await put("staff", { user_id: 22, name: "ثاني", perms: "orders" });
  const a = await order(14, ["ملزمة"], { curr: "إنجليزي" });
  const b = await order(14, ["ملزمة"]);
  await orderAction({ action: "pdf", ids: [a, b], initData: sign(21) });
  const html = fs.readdirSync(tmp).filter((f) => f.startsWith("orders_") && f.endsWith(".html")).sort().at(-1)!;
  const body = fs.readFileSync(path.join(tmp, html), "utf8");
  assert.ok(body.includes('class="page en"') && body.includes("ENGLISH") && body.includes('class="page ar"'));
  await orderAction({ action: "done", ids: [a], initData: sign(21) });
  await orderAction({ action: "done", ids: [b], initData: sign(22) });
  const mine: any = await orderAction({ action: "list", initData: sign(21) });
  assert.deepEqual(mine.printed.map((o: any) => o.id), [a]);
  await assert.rejects(orderAction({ action: "reprint", ids: [b], initData: sign(21) }), /مو بالمطبوعة/);
  calls.length = 0;
  await orderAction({ action: "reprint", ids: [a], initData: sign(21) });
  assert.ok(calls.some((c) => c.method === "sendDocument" && String(c.p.caption).includes("إعادة طباعة")));
  const owner: any = await orderAction({ action: "list", initData: sign(1) });
  assert.ok(owner.printed.length >= 2 && owner.printed.find((o: any) => o.id === a).printedBy === "سجاد");
});

test("حساب شركة التوصيل: من وصل إلى وصل، يطرح التوصيل، وما ينحسب مرتين", async () => {
  const before: any = await orderAction({ action: "list", initData: sign(1) });
  for (const o of before.company.open) await orderAction({ action: "settle", from: o.id, to: o.id, net: o.total - o.fee, initData: sign(1) });
  const x = await order(15, ["ملزمة"], { printed: 1 });
  const y = await order(15, ["ملزمة"], { printed: 1 });
  await assert.rejects(orderAction({ action: "list", initData: sign(23) }), (e: any) => e.status === 403);
  await assert.rejects(orderAction({ action: "settle", from: x, to: y, net: 2000, initData: sign(21) }), (e: any) => e.status === 403);
  await assert.rejects(orderAction({ action: "settle", from: x, to: y, net: 1, initData: sign(1) }), /الأرقام تغيرت/);
  const r: any = await orderAction({ action: "settle", from: x, to: y, net: 2000, initData: sign(1) });
  assert.deepEqual(r.company.open, []);
  assert.equal(r.company.archive[0].net, 2000);
  assert.equal(r.company.archive[0].fees, 400);
  await assert.rejects(orderAction({ action: "settle", from: x, to: y, net: 2000, initData: sign(1) }), /ماكو طلبات/);
  await assert.rejects(orderAction({ action: "back", id: x, initData: sign(1) }), /انحسب/);
});

test("المكتبة تشوف بيعها بس وتطبع وصلها، وبيعها ما ينحسب على مساعد", async () => {
  const off2 = await insert("offices", { name: "مكتبة ثانية" });
  await put("office_users", { user_id: 31, office_id: off2, name: "ب" });
  await student(16);
  const pid = (await one("products", { name: "ملزمة الفصل الأول" }))!.id;
  const sold: any = await salesAction({ action: "sale", sid: 16, items: [[pid, 2]], initData: `tk:${homeToken(30)}` });
  assert.ok(sold.soldId);
  assert.equal(sold.shop.name, "مكتبة النور");
  assert.equal(sold.total, 2000);
  assert.equal((await one("activity", { user_id: 16 }))!.what.includes("مكتبة النور"), true);
  const other: any = await salesAction({ action: "list", initData: sign(31) });
  assert.deepEqual(other.sales, []);
  await assert.rejects(salesAction({ action: "receipt", id: sold.soldId, kind: "paper", initData: sign(31) }), /غير موجودة/);
  for (const kind of ["paper", "framed"]) {
    calls.length = 0;
    await salesAction({ action: "receipt", id: sold.soldId, kind, initData: `tk:${homeToken(30)}` });
    assert.ok(calls.some((c) => c.method === "sendDocument"), kind);   // إذا الرسم ما صار، يبقى الملف يوصل
  }
  const pos = fs.readFileSync(path.join(tmp, `receipt_${sold.soldId}.html`), "utf8");
  assert.ok(pos.includes("58mm") && pos.includes("مكتبة النور"));
  const frame = fs.readFileSync(path.join(tmp, `receipt_framed_${sold.soldId}.html`), "utf8");
  assert.ok(frame.includes("A5") && frame.includes("مكتبة النور"));
  await assert.rejects(salesAction({ action: "list", initData: sign(10) }), (e: any) => e.status === 403);

  // نفس الحساب كان مكتبة وباع، وبعدها انضاف مساعد: حسابه يبدي صفر
  await order(16, ["ملزمة"], { printed: 3, seller: 60000, office_id: off2, total: 16000 });
  await order(16, ["ملزمة"], { printed: 3, seller: 60000, total: 5000, created: "2020-01-01 10:00:00" });
  await staffAction({ action: "add", id: 60000, name: "سجاع عقيل", initData: sign(1) });
  assert.equal((await staffAccount(60000)).sold, 0);
});

test("الطلب ما يوصل برسالة للمساعد، والعدد يطلع بمربع اللوحة", async () => {
  await put("staff", { user_id: 24, name: "م", perms: "fees" });
  assert.ok(await feeAction({ action: "list", initData: sign(24) }));
  await assert.rejects(productAction({ action: "list", initData: sign(24) }), (e: any) => e.status === 403);
  const tiles = (await adminHomeAction({ action: "list", initData: sign(21) })).groups.flatMap((g: any) => g.tiles);
  assert.deepEqual(tiles.map((t: any) => t.page), ["orders"]);
  assert.match(tiles[0].note, /طلب جديد|ماكو جديد/);
});

test("صفحة الطلاب: الفلاتر، القائمة بطلب بس، وسجل العمليات", async () => {
  await student(17, "إنجليزي");
  calls.length = 0;
  const f: any = await studentAction({ action: "list", filters: { curr: "إنجليزي" }, initData: sign(1) });
  assert.ok(f.results.every((s: any) => s.curr === "إنجليزي") && f.found >= 1);
  assert.ok(!calls.some((c) => c.method === "sendDocument"));
  await assert.rejects(studentAction({ action: "pdf", kind: "picked", ids: [], initData: sign(1) }), /حدد/);
  await studentAction({ action: "pdf", kind: "picked", ids: [17], initData: sign(1) });
  assert.ok(calls.some((c) => c.method === "sendDocument"));
  const log: any = await studentAction({ action: "log", id: 16, initData: sign(1) });
  assert.ok(log.log.rows.some((r: any) => r.what.startsWith("🏪 اشترى")));
});

test("👁 شوف كمساعد: صاحب البوت يشوف اللوحة بصلاحيات المساعد بالضبط، وتتحدث وياه، و↩️ يرجعه", async () => {
  const owner = sign(1);
  await staffAction({ action: "add", id: 61000, name: "مساعد المعاينة", initData: owner });
  await staffAction({ action: "perms", id: 61000, perms: ["students"], initData: owner });
  const r: any = await staffAction({ action: "viewAs", id: 61000, initData: owner });
  assert.equal(r.open, "admin");
  const tiles = async () => ((await adminHomeAction({ action: "list", initData: owner })) as any);
  let h = await tiles();
  assert.equal(h.asStaff, "مساعد المعاينة");
  assert.equal(h.owner, false);
  const pages = (x: any) => x.groups.flatMap((g: any) => g.tiles.map((t: any) => t.page));
  assert.deepEqual(pages(h), ["students"]);
  // المساعد ياخذ صلاحية ثانية: تطلع هم
  const { update } = await import("../lib/db.ts");
  await update("staff", { user_id: 61000 }, { perms: "schedule,students" });
  h = await tiles();
  assert.deepEqual(pages(h).sort(), ["schedule", "students"]);
  await assert.rejects(staffAction({ action: "list", initData: owner }), /صلاحية/);   // صفحة المساعدين لصاحب البوت بس
  // ↩️ ارجع لحسابي
  h = await adminHomeAction({ action: "endGrader", initData: owner });
  assert.equal(h.owner, true);
  assert.ok(pages(h).includes("staff"));
});
