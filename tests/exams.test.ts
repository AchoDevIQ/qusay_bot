// الامتحانات: تنفتح بالبيع من المكتبة مباشرة، وبالتوصيل برمز QR، ولصاحب الطلب بس
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-exams-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, NO_WORD_CHECK: "1",
  CHROME_PATH: path.join(tmp, "no-browser"), ASSETS_DIR: path.join(tmp, "no-assets"), SETTINGS_FILE: path.join(tmp, "no-settings"),
});

type Call = { method: string; p: any };
const calls: Call[] = [];
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

const { handleUpdate } = await import("../lib/bot.ts");
const { kvSet } = await import("../lib/db.ts");
const { all, get, run } = await import("../lib/sqliteDriver.ts");
const { examChapterOf } = await import("../lib/exams.ts");

const msg = async (uid: number, text: string | undefined, extra: object = {}) => await handleUpdate({
  message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid }, text, ...extra },
});
const webapp = async (uid: number, o: unknown) => await msg(uid, undefined, { web_app_data: { data: JSON.stringify(o) } });
const cb = async (uid: number, data: string) => await handleUpdate({ callback_query: { id: "c", from: { id: uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const texts = () => calls.map((c) => c.p.text ?? c.p.caption ?? "").join("\n---\n");
const flush = () => { const out = [...calls]; calls.length = 0; return out; };
const buttons = (c: Call) => (c.p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);
const access = async (uid: number) => (await all("SELECT chapter FROM exam_access WHERE user_id=? ORDER BY chapter", uid)).map((r) => r.chapter);
const mainButtons = (uid: number) => {
  const c = calls.filter((x) => x.p.chat_id === uid && x.p.reply_markup?.keyboard).at(-1)!;
  return c.p.reply_markup.keyboard.flat().map((b: any) => b.text);
};
const register = async (uid: number, phone: string) => await webapp(uid, {
  k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "0770" + phone, p2: "0780" + phone, e: "", c: 0,
});
/** طلب توصيل من الصفحة، يرجع رقمه */
async function order(uid: number, pid: number) {
  await msg(uid, "🛒 المتجر");
  for (let i = 0; i < 3; i++) await cb(uid, "agree");
  const price = (await get("SELECT price FROM products WHERE id=?", pid))!.price;
  const fee = (await get("SELECT fee FROM fees WHERE gov='البصرة'"))!.fee;
  await webapp(uid, { p1: "07701234567", p2: "07801234567", i: [[pid, 1]], t: price + fee });
  return (await get("SELECT MAX(id) id FROM orders WHERE user_id=?", uid))!.id as number;
}
async function markPrinted(oid: number) {
  await cb(1, `a:t:${oid}`);
  await cb(1, "a:pdf");
  const bid = /a:done:(\d+)/.exec(calls.find((c) => c.method === "sendDocument")!.p.reply_markup)![1];
  flush();
  await cb(1, `a:done:${bid}`);
}

test("أي منتج يفتح الامتحانات (أسماء المنتجات الحقيقية)", () => {
  const chapter: Record<string, string | null> = {
    "الفصل الأول - امتحانات إلكترونية": "الفصل الأول",
    "الفصل الرابع والخامس - امتحانات إلكترونية": "الفصل الرابع والخامس",
    "الفصل الثالث - محاضرات + امتحانات إلكتروني": "الفصل الثالث",
    "فقط امتحانات الفصل الاول": "الفصل الأول",
    "الفصل الرابع والخامس - امتحانات حضورية": null,      // ينقدم بالمركز
    "الفصل الرابع والخامس - محاضرات + امتحانات حضوري": null,
    "دفتر امتحانات الفصل الأول": null,                     // دفتر ورق
    "دفتر محاضرات الفصل الأول": null,
    "الفصل الأول - محاضرات فقط": null,
    "امتحانات بدون فصل": null,
  };
  for (const [name, want] of Object.entries(chapter)) assert.equal(examChapterOf(name), want, name);
});

test("الإعداد: منتجات وطلاب", async () => {
  await cb(1, "a:bulk");
  await msg(1, "# امتحانات\nالفصل الأول - امتحانات إلكترونية = 35000\nالفصل الثاني - امتحانات إلكترونية = 35000\n# الملازم\nدفتر امتحانات الفصل الأول = 4000");
  assert.equal((await get("SELECT COUNT(*) n FROM products"))!.n, 3);
  await register(2, "1111111");
  await register(3, "2222222");
  await register(4, "3333333");
  flush();
});

test("الطالب العادي ما يدير الامتحانات", async () => {
  await cb(2, "a:ex");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
});

test("بدون شراء: ماكو زر، ولا يفتح امتحان بتزوير الزر", async () => {
  await msg(2, "/start");
  assert.ok(!mainButtons(2).includes("📝 امتحاناتي"));
  flush();
  await msg(2, "📝 امتحاناتي");
  assert.match(texts(), /ما عندك امتحانات/);
  flush();
  await cb(2, "xc:0");
  assert.equal(calls.at(-1)!.p.text, "الفصل غير موجود");
  flush();
});

test("المكتبة: البيع يفتح الامتحانات مباشرة وبدون كود، والدفتر ما يفتح", async () => {
  await run("INSERT INTO offices(name) VALUES('مكتبة')");
  await run("INSERT INTO office_users(user_id, office_id, name) VALUES(9, 1, 'صاحبها')");
  await webapp(9, { k: "pos", sid: 2, i: [[3, 1]] });     // دفتر
  assert.deepEqual(await access(2), []);
  assert.doesNotMatch(texts(), /انفتحت/);
  flush();
  await webapp(9, { k: "pos", sid: 2, i: [[1, 1]] });
  assert.deepEqual(await access(2), ["الفصل الأول"]);
  assert.equal(calls.filter((c) => c.p.chat_id === 2 && /انفتحت امتحاناتك/.test(c.p.text ?? "")).length, 1);
  assert.ok(mainButtons(2).includes("📝 امتحاناتي"));
  assert.ok(calls.some((c) => c.p.chat_id === 9 && /انفتحت عنده امتحانات: الفصل الأول/.test(c.p.text ?? "")));
  assert.equal((await get("SELECT COUNT(*) n FROM order_codes"))!.n, 0);
  flush();
});

let code = "", oid = 0;
test("التوصيل: الرمز ما ينعطى للطالب، والامتحانات تبقى مقفولة لحد المسح", async () => {
  oid = await order(3, 1);
  code = (await get("SELECT code FROM order_codes WHERE order_id=?", oid))!.code;
  assert.match(code, /^QM-[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(!JSON.stringify(calls).includes(code), "الرمز ما لازم يوصل برسائل تليجرام");
  assert.deepEqual(await access(3), []);
  flush();
  await cb(3, `xs:${oid}`);                               // قبل التجهيز
  assert.equal(calls.at(-1)!.p.text, "طلبك لسه ما تجهز");
  flush();
  await webapp(3, { k: "scan", code });                   // حتى لو عرف الرمز
  assert.match(texts(), /لسه ما تجهز/);
  assert.deepEqual(await access(3), []);
  flush();
});

test("الوصل المطبوع بيه QR والرمز، وطلب بدون امتحانات ما بيه", async () => {
  await cb(1, "a:pend");
  flush();
  await cb(1, `a:t:${oid}`);
  await cb(1, "a:pdf");
  flush();
  const html = fs.readFileSync(path.join(tmp, fs.readdirSync(tmp).filter((f) => f.startsWith("orders_") && f.endsWith(".html")).sort().at(-1)!), "utf8");
  assert.ok(html.includes(code));
  assert.ok(html.includes("<svg"));
  const noExam = await order(4, 3);
  assert.equal((await get("SELECT COUNT(*) n FROM order_codes WHERE order_id=?", noExam))!.n, 0);
  flush();
});

test("رسالة التجهيز بيها زر الكود، والمسح يفتح الامتحانات لصاحب الطلب بس", async () => {
  await cb(1, "a:none");
  flush();
  await markPrinted(oid);
  const ready = calls.find((c) => c.p.chat_id === 3 && /تم تجهيز طلبك/.test(c.p.text ?? ""))!;
  assert.deepEqual(buttons(ready), [`xs:${oid}`]);
  assert.match(ready.p.text, /لمن يوصلك الطلب/);
  flush();

  await webapp(4, { k: "scan", code });                   // طالب ثاني لگه الوصل
  assert.match(texts(), /غلط، أو مو لطلبك/);
  assert.deepEqual(await access(4), []);
  flush();

  await cb(3, `xs:${oid}`);
  const url = calls[0].p.reply_markup.keyboard[0][0].web_app.url as string;
  assert.ok(url.startsWith("https://x.test/store/scan?v="));
  flush();
  await msg(3, "QM-WRONG123");
  assert.match(texts(), /غلط/);
  assert.deepEqual(await access(3), []);
  flush();
  await webapp(3, { k: "scan", code });
  assert.deepEqual(await access(3), ["الفصل الأول"]);
  assert.match(texts(), /انفتحت امتحاناتك/);
  assert.ok((await get("SELECT used_at FROM order_codes WHERE code=?", code))!.used_at);
  assert.equal((await get("SELECT state FROM sessions WHERE user_id=3"))!.state, "");
  flush();
  await webapp(3, { k: "scan", code });                   // مرة ثانية ما يضر
  assert.match(texts(), /انستخدم قبل/);
  flush();
});

test("الكتابة اليدوية للرمز تشتغل بأي شكل", async () => {
  const o2 = await order(3, 2);
  flush();
  const c2 = (await get("SELECT code FROM order_codes WHERE order_id=?", o2))!.code as string;
  await markPrinted(o2);
  flush();
  await cb(3, `xs:${o2}`);
  flush();
  await msg(3, "  " + c2.toLowerCase().replace("qm-", "qm ") + " ");
  assert.deepEqual(await access(3), ["الفصل الأول", "الفصل الثاني"]);
  flush();
});

test("طلب ملغي ما يفتح، و5 محاولات غلط توقف الحساب ساعة", async () => {
  const o3 = await order(4, 1);
  flush();
  const c3 = (await get("SELECT code FROM order_codes WHERE order_id=?", o3))!.code as string;
  await cb(4, `ocy:${o3}`);
  flush();
  await webapp(4, { k: "scan", code: c3 });
  assert.match(texts(), /ملغي/);
  assert.deepEqual(await access(4), []);
  flush();
  const o4 = await order(4, 1);
  flush();
  const c4 = (await get("SELECT code FROM order_codes WHERE order_id=?", o4))!.code as string;
  await markPrinted(o4);
  flush();
  for (let i = 0; i < 4; i++) await webapp(4, { k: "scan", code: "QM-AAAAAAAA" });
  flush();
  await webapp(4, { k: "scan", code: c4 });
  assert.match(texts(), /حاولت هوايا/);
  assert.deepEqual(await access(4), []);
  flush();
  await kvSet("xfail_4", `5:${Math.floor(Date.now() / 1000) - 3700}`);
  await webapp(4, { k: "scan", code: c4 });
  assert.deepEqual(await access(4), ["الفصل الأول"]);
  flush();
});
