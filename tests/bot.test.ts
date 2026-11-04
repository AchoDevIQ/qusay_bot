// يشغل البوت كامل على رسائل تليجرام وهمية، ويفحص اللي يرسله وشنو ينحفظ
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-test-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp,
  CHROME_PATH: path.join(tmp, "no-browser"), ASSETS_DIR: path.join(tmp, "no-assets"), SETTINGS_FILE: path.join(tmp, "no-settings"),
});

type Call = { method: string; p: any };
const calls: Call[] = [];
let nextId = 100;
let failMethods: string[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  if (failMethods.includes(method)) return new Response(JSON.stringify({ ok: false, description: "fail" }));
  const result = method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId, message_thread_id: ++nextId };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

const { allowUpdate, handleUpdate, enqueueUpdate } = await import("../lib/bot.ts");
const { all, get, kvSet, run } = await import("../lib/db.ts");
const { parseAmount } = await import("../lib/office.ts");

const msg = async (uid: number, text: string, extra: object = {}) => await handleUpdate({
  message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid, first_name: "اسم" }, text, ...extra },
});
const webapp = async (uid: number, o: unknown) => await msg(uid, "", { text: undefined, web_app_data: { data: typeof o === "string" ? o : JSON.stringify(o) } });
const cb = async (uid: number, data: string, mid = 50) => await handleUpdate({ callback_query: { id: "c", from: { id: uid, username: "u" + uid }, message: { chat: { id: uid }, message_id: mid }, data } });
const group = async (uid: number, text: string, extra: object = {}) => await handleUpdate({
  message: { message_id: ++nextId, chat: { id: -1001, type: "supergroup" }, from: { id: uid }, text, ...extra },
});
const texts = () => calls.map((c) => c.p.text ?? c.p.caption ?? "").join("\n---\n");
const flush = () => { const out = [...calls]; calls.length = 0; return out; };
/** آخر رسالة (ضغطة الزر دائماً تنتهي بـ answerCallbackQuery) */
const lastSent = () => calls.filter((c) => c.method !== "answerCallbackQuery").at(-1)!;
const buttons = (c: Call) => (c.p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data ?? b.text);
const lastUrl = (c: Call) => c.p.reply_markup.keyboard[0][0].web_app.url as string;
const pageData = (url: string) => JSON.parse(Buffer.from(new URL(url).searchParams.get("d")!, "base64url").toString("utf8"));

const REG = { k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 };
const register = async (uid: number, over: object = {}) => await webapp(uid, { ...REG, ...over });

test("/start يرحب ويطلب التسجيل بفورمة صفحة /store/reg", async () => {
  await msg(2, "/start");
  const c = flush();
  assert.equal(c[0].method, "getMe");
  assert.match(c[1].p.text, /QMath/);
  assert.match(c[2].p.text, /التسجيل/);
  const url = lastUrl(c[2]);
  assert.ok(url.startsWith("https://x.test/store/reg?v="));
  const d = pageData(url);
  assert.equal(d.g.length, 18);
  assert.equal(d.a.length, 4);
});

test("التسجيل يرفض البيانات الغلط ويقبل الصحيحة، وبعدها يقفل", async () => {
  await register(2, { n: "علي", p2: "07701234567" });
  assert.match(texts(), /ما انحفظت[\s\S]*رباعي[\s\S]*أرقام الهاتف/);
  assert.equal((await get("SELECT COUNT(*) n FROM students"))!.n, 0);
  flush();
  await register(2);
  const s = (await get("SELECT * FROM students WHERE user_id=2"))!;
  assert.equal(s.exam, "إلكتروني");   // البصرة إلكتروني بس
  assert.match(texts(), /تم الحفظ بنجاح/);
  flush();
  await register(2, { n: "زينب علي حسين جاسم" });
  assert.match(texts(), /مقفولة/);
  assert.equal((await get("SELECT name FROM students WHERE user_id=2"))!.name, REG.n);
  flush();
});

test("بغداد: الحضوري يلزمه مركز صالح", async () => {
  await register(3, { g: "بغداد", s: "الكرخ", e: "حضوري", c: 0 });
  assert.match(texts(), /اختر المركز الامتحاني/);
  flush();
  const c = (await get("SELECT id FROM centers LIMIT 1"))!.id;
  await register(3, { g: "بغداد", s: "الكرخ", e: "حضوري", c });
  assert.equal((await get("SELECT center_id FROM students WHERE user_id=3"))!.center_id, c);
  flush();
});

test("الإدارة تضيف منتجات دفعة وحدة", async () => {
  await msg(1, "/admin");
  assert.ok(buttons(calls.at(-1)!).includes("a:bulk"));
  await cb(1, "a:bulk");
  flush();
  await msg(1, "# الملازم\nملزمة الفصل الأول حضوري = 15,000\nملزمة الفصل الأول إلكتروني = ١٠٠٠٠\nسطر غلط\n# محاضرات\nمحاضرة : 5000 دينار");
  assert.match(texts(), /تمت إضافة 3 منتج[\s\S]*سطر غلط/);
  const ps = await all("SELECT name, price, mode FROM products ORDER BY id");
  assert.deepEqual(ps.map((p) => [p.price, p.mode]), [[15000, "in"], [10000, "online"], [5000, "both"]]);
  flush();
});

test("الطالب العادي ما يفتح أزرار الإدارة", async () => {
  await cb(2, "a:bulk");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  assert.equal(calls.length, 1);
  flush();
});

test("المتجر: 3 موافقات، وطالب الإلكتروني يشوف منتجات الإلكتروني بس", async () => {
  await msg(2, "🛒 المتجر");
  assert.match(texts(), /غير قابلة للإرجاع/);
  flush();
  await cb(2, "agree"); await cb(2, "agree"); flush();
  await cb(2, "agree");
  const url = lastUrl(lastSent());
  assert.ok(url.startsWith("https://x.test/store?v="));
  const d = pageData(url);
  const names = d.c.flatMap((c: any) => c[1].map((p: any) => p[1]));
  assert.ok(names.includes("ملزمة الفصل الأول إلكتروني"));
  assert.ok(!names.includes("ملزمة الفصل الأول حضوري"));
  assert.equal(d.p.n, REG.n);
  flush();
});

test("طلب من الصفحة: تغيّر السعر يطلب موافقة، والتأكيد ينشئ الطلب ويبلغ الإدارة", async () => {
  const pid = (await get("SELECT id FROM products WHERE name LIKE '%إلكتروني'"))!.id;
  await webapp(2, { n: "أي شي", p1: "07701234567", p2: "07801234567", i: [[pid, 2]], t: 1 });
  assert.match(texts(), /تحدثت بعض الأسعار/);
  assert.equal((await get("SELECT COUNT(*) n FROM orders"))!.n, 0);
  flush();
  await cb(2, "confirm");
  const o = (await get("SELECT * FROM orders ORDER BY id DESC LIMIT 1"))!;
  assert.equal(o.name, REG.n);                 // الاسم من التسجيل مو من الصفحة
  assert.equal(o.total, 25000);                // 2×10000 + توصيل 5000
  assert.match(texts(), /تم استلام طلبك[\s\S]*طلب جديد/);
  flush();
});

test("بالسعر الصحيح يكمل مباشرة، وأخطاء الجلسة ما تسوي طلب", async () => {
  await msg(2, "🛒 المتجر");   // الموافقات لسه محفوظة؟ finalize يصفر الجلسة، فلازم يوافق من جديد
  assert.match(texts(), /غير قابلة للإرجاع/);
  flush();
  for (let i = 0; i < 3; i++) await cb(2, "agree");
  flush();
  const pid = (await get("SELECT id FROM products WHERE name LIKE '%إلكتروني'"))!.id;
  await webapp(2, { p1: "07701234567", p2: "07701234567", i: [[pid, 1]], t: 15000 });
  assert.match(texts(), /أرقام الهاتف/);
  flush();
  await webapp(2, { p1: "07701234567", p2: "07801234567", i: [[pid, 1]], t: 15000 });
  assert.equal((await get("SELECT COUNT(*) n FROM orders"))!.n, 2);
  flush();
});

test("إلغاء الطلب، وبعد الطباعة ما ينلغي", async () => {
  const [a, b] = (await all("SELECT id FROM orders ORDER BY id")).map((r) => r.id);
  await cb(2, `oc:${a}`); await cb(2, `ocy:${a}`);
  assert.equal((await get("SELECT printed FROM orders WHERE id=?", a))!.printed, 2);
  assert.match(texts(), /ألغى الطلب/);
  flush();
  await cb(1, "a:pend");
  assert.ok(buttons(lastSent()).includes(`a:t:${b}`));
  assert.ok(!buttons(lastSent()).includes(`a:t:${a}`));
  flush();
  await cb(1, `a:t:${b}`);
  await cb(1, "a:pdf");
  const doc = calls.find((c) => c.method === "sendDocument")!;   // بدون متصفح يرسل HTML
  assert.match(doc.p.caption, /Ctrl \+ P/);
  const bid = /a:done:(\d+)/.exec(doc.p.reply_markup)![1];
  flush();
  await cb(1, `a:done:${bid}`);
  assert.equal((await get("SELECT printed FROM orders WHERE id=?", b))!.printed, 1);
  assert.match(texts(), /تم تجهيز طلبك/);
  flush();
  await cb(2, `ocy:${b}`);
  assert.equal((await get("SELECT printed FROM orders WHERE id=?", b))!.printed, 1);
  flush();
});

test("الأسئلة: موضوع بالمجموعة، جواب للطالب، واستفسار يرجع الموضوع", async () => {
  await msg(2, "❓ سؤال علمي");
  assert.match(texts(), /غير مفعّل/);
  flush();
  await group(1, "/setgroup");
  assert.equal((await get("SELECT v FROM kv WHERE k='q_group'"))!.v, "-1001");
  flush();
  await msg(2, "❓ سؤال علمي");
  const ch = (await get("SELECT id FROM chapters ORDER BY ord LIMIT 1"))!.id;
  const t = (await get("SELECT id FROM topics WHERE chapter_id=? ORDER BY ord LIMIT 1", ch))!.id;
  await cb(2, `qc:${ch}`); await cb(2, `qt:${t}`); await cb(2, `ql:${t}:2`);
  flush();
  await msg(2, "شلون أحل هاي؟");
  const q = (await get("SELECT * FROM questions ORDER BY id DESC LIMIT 1"))!;
  assert.equal(q.lecture, 2);
  assert.ok(q.thread_id);
  assert.ok(calls.some((c) => c.method === "createForumTopic"));
  assert.ok(calls.some((c) => c.method === "copyMessage"));
  flush();
  await group(1, "الجواب", { message_thread_id: q.thread_id, is_topic_message: true });
  assert.equal((await get("SELECT status FROM questions WHERE id=?", q.id))!.status, "answered");
  assert.ok(calls.some((c) => c.method === "copyMessage" && c.p.chat_id === 2));
  flush();
  await cb(1, `qh:${q.id}`);
  assert.equal((await get("SELECT thread_id FROM questions WHERE id=?", q.id))!.thread_id, null);
  flush();
  await cb(2, `qf:${q.id}`);
  flush();
  await msg(2, "ما فهمت");
  assert.equal((await get("SELECT status FROM questions WHERE id=?", q.id))!.status, "open");
  assert.equal(calls.filter((c) => c.method === "createForumTopic").length, 1);
  flush();
});

test("أوقات الأسئلة تقفل الاستقبال", async () => {
  await cb(1, "a:hro");
  flush();
  await msg(2, "❓ سؤال علمي");
  assert.match(texts(), /مغلق/);
  flush();
  await cb(1, "a:hro");
  flush();
});

test("المكتبة: انضمام بالرمز، رصيد، بيع، ومحاسبة", async () => {
  await cb(1, "a:liba");
  await msg(1, "مكتبة 1");
  const oid = (await get("SELECT id FROM offices"))!.id;
  flush();
  await cb(1, `a:libm:${oid}`);
  const code = /<code>(\d{8})<\/code>/.exec(lastSent().p.text)![1];
  flush();
  await msg(9, code);
  assert.equal((await get("SELECT office_id FROM office_users WHERE user_id=9"))!.office_id, oid);
  flush();
  await msg(8, code);   // الرمز مرة وحدة بس
  assert.equal((await get("SELECT COUNT(*) n FROM office_users WHERE user_id=8"))!.n, 0);
  flush();

  await run("UPDATE offices SET lim=20000 WHERE id=?", oid);
  const pid = (await get("SELECT id FROM products WHERE name='محاضرة'"))!.id;
  await webapp(9, { k: "pos", sid: 2, i: [[pid, 5]] });
  assert.match(texts(), /أكثر من الرصيد/);
  assert.equal((await get("SELECT COUNT(*) n FROM orders WHERE printed=3"))!.n, 0);
  flush();
  await webapp(9, { k: "pos", sid: 2, i: [[pid, 2]] });
  const sale = (await get("SELECT * FROM orders WHERE printed=3"))!;
  assert.deepEqual([sale.total, sale.office_id, sale.seller], [10000, oid, 9]);
  assert.ok(calls.some((c) => c.p.chat_id === 2 && /وصل شرائك/.test(c.p.text ?? "")));
  flush();

  await cb(1, `a:libs:${oid}`);
  assert.ok(buttons(lastSent()).includes(`a:libsy:${oid}:10000`));
  flush();
  await cb(1, `a:libsy:${oid}:999`);
  assert.match(calls.at(-1)!.p.text, /صارت مبيعات جديدة/);
  flush();
  await cb(1, `a:libsy:${oid}:10000`);
  assert.ok((await get("SELECT settle_id FROM orders WHERE id=?", sale.id))!.settle_id);
  assert.ok(calls.some((c) => c.p.chat_id === 9 && /تمت المحاسبة/.test(c.p.text ?? "")));
  flush();
});

test("البائع العادي ما يبيع، وطالب مو موجود مرفوض", async () => {
  await webapp(2, { k: "pos", sid: 3, i: [[1, 1]] });
  assert.match(texts(), /ما عندك صلاحية/);
  assert.equal((await get("SELECT COUNT(*) n FROM orders WHERE seller=2"))!.n, 0);
  flush();
});

test("الفورمة من الطالب ما تعدل غيره", async () => {
  await register(2, { adm: 3, n: "زينب علي حسين جاسم" });
  assert.match(texts(), /ما عندك صلاحية/);
  assert.notEqual((await get("SELECT name FROM students WHERE user_id=3"))!.name, "زينب علي حسين جاسم");
  flush();
});

test("الصلاحيات: المساعد يشوف بس اللي عنده", async () => {
  await cb(1, "a:sfa");
  await msg(1, "555123");
  await msg(1, "أحمد");
  flush();
  await msg(555123, "/admin");
  const b = buttons(calls.at(-1)!);
  assert.ok(b.includes("a:oq"));
  assert.ok(!b.includes("a:bulk") && !b.includes("a:lib"));
  flush();
  await cb(555123, "a:sf");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
});

test("البحث السريع يطابق بدون همزات", async () => {
  await msg(1, "زينب");   // ما موجود
  assert.match(texts(), /ما لگيت/);
  flush();
  await run("UPDATE students SET name='أحمد علي حسن كاظم' WHERE user_id=3");
  await msg(1, "احمد");
  assert.match(texts(), /1 نتيجة/);
  flush();
});

test("الرسائل بالطابور تتنفذ بالترتيب، والخطأ ما يوقف الباقي", async () => {
  const order: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    const p = JSON.parse(init.body);
    await new Promise((r) => setTimeout(r, p.chat_id === 2 ? 20 : 0));
    order.push(p.chat_id);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  const mk = (uid: number) => ({ message: { message_id: 1, chat: { id: uid, type: "private" }, from: { id: uid }, text: "/myid" } });
  await Promise.all([enqueueUpdate(mk(2)), enqueueUpdate({ message: { chat: null } }), enqueueUpdate(mk(3))]);
  globalThis.fetch = realFetch;
  assert.deepEqual(order, [2, 3]);
});

test("الإغراق: الرسائل الزايدة تنهمل، والمدير ما ينحد، وبعد المهلة يرجع عادي", () => {
  const t = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal(allowUpdate(77, t + i), true);
  assert.equal(allowUpdate(77, t + 21), false);
  assert.equal(allowUpdate(78, t + 21), true);          // غيره ما يتأثر
  assert.equal(allowUpdate(77, t + 10_100), true);
  for (let i = 0; i < 50; i++) assert.equal(allowUpdate(1, t + i), true);
});

test("البطاقة ما تنرسم مرتين إذا ما تغيرت", async () => {
  flush();
  const card = path.join(tmp, "card_3.png");
  await msg(3, "👤 معلوماتي");                          // بدون متصفح: يرسل نص
  assert.match(texts(), /معلوماتك/);
  flush();
  fs.writeFileSync(card, "x".repeat(2000));              // صورة جاهزة من مرة سابقة
  await msg(3, "👤 معلوماتي");
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
  flush();
  fs.rmSync(card);
});

test("رمز الدعوة: 5 محاولات غلط بالساعة، وبعدها حتى الصحيح ينرفض", async () => {
  const oid = await run("INSERT INTO offices(name) VALUES('مكتبة الحد')");
  await cb(1, `a:libm:${oid}`);
  const code = /<code>(\d{8})<\/code>/.exec(lastSent().p.text)![1];
  flush();
  for (let i = 0; i < 5; i++) await msg(70, "12345678");
  flush();
  await msg(70, code);
  assert.equal((await get("SELECT COUNT(*) n FROM office_users WHERE user_id=70"))!.n, 0);
  flush();
  await msg(70, `/start lib_${code}`);
  assert.match(texts(), /حاولت هوايا/);
  assert.equal((await get("SELECT COUNT(*) n FROM office_users WHERE user_id=70"))!.n, 0);
  flush();
  await msg(71, code);                                   // غيره يدخل عادي
  assert.equal((await get("SELECT office_id FROM office_users WHERE user_id=71"))!.office_id, oid);
  flush();
  await kvSet("invfail_70", `5:${Math.floor(Date.now() / 1000) - 3700}`);   // بعد ساعة ترجع المحاولات
  await msg(70, `/start lib_11111111`);
  assert.match(texts(), /غير صالح/);
  flush();
});

test("parseAmount", () => {
  assert.equal(parseAmount("20 مليون"), 20000000);
  assert.equal(parseAmount("١٠ الف"), 10000);
  assert.equal(parseAmount("1,500"), 1500);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
});

test("فشل فتح الموضوع يلغي السؤال", async () => {
  const before = (await get("SELECT COUNT(*) n FROM questions"))!.n;
  await kvSet("q_hours", "");
  await msg(2, "❓ سؤال علمي");
  const t = (await get("SELECT id FROM topics ORDER BY id DESC LIMIT 1"))!;
  await cb(2, `qt:${t.id}`); flush();
  await cb(2, `ql:${t.id}:1`); flush();
  failMethods = ["createForumTopic"];
  await msg(2, "سؤال");
  failMethods = [];
  assert.equal((await get("SELECT COUNT(*) n FROM questions"))!.n, before);
  assert.match(texts(), /ما گدرت أوصل سؤالك/);
  flush();
});
