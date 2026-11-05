// التنبيهات داخل صفحة المتجر: السيرفر يفتح الصفحة مباشرة، وما يقبل طلب ما مر بالتنبيهات. وإخفاء المنتج
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-words-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp,
  CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"),
});
delete process.env.NO_WORD_CHECK;

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
const { chaptersInOrder, firstRoundOnly } = await import("../lib/orderRules.ts");
const { get, run } = await import("../lib/sqliteDriver.ts");

const msg = async (uid: number, text: string, extra: object = {}) => await handleUpdate({
  message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid, first_name: "اسم" }, text, ...extra },
});
const webapp = async (uid: number, o: unknown) => await msg(uid, "", { text: undefined, web_app_data: { data: JSON.stringify(o) } });
const flush = () => calls.splice(0);
const lastSent = () => calls.filter((c) => c.method !== "answerCallbackQuery").at(-1)!;
const seen = () => {
  const url = lastSent().p.reply_markup.keyboard[0][0].web_app.url as string;
  const d = JSON.parse(Buffer.from(new URL(url).searchParams.get("d")!, "base64url").toString("utf8"));
  return d.c.flatMap((c: any) => c[1].map((p: any) => p[0])) as number[];
};
const addProduct = async (name: string) => {
  await run("INSERT OR IGNORE INTO cats (name) VALUES ('قسم')");
  const cat = (await get("SELECT id FROM cats WHERE name='قسم'"))!.id;
  await run("INSERT INTO products (cat_id, name, price) VALUES (?, ?, 1000)", cat, name);
  return (await get("SELECT id FROM products WHERE name=?", name))!.id as number;
};
const fee = async () => (await get("SELECT fee FROM fees WHERE gov='البصرة'"))!.fee as number;
const orders = async () => (await get("SELECT COUNT(*) n FROM orders WHERE user_id=2"))!.n as number;
const order = async (pids: number[], flags: object) => await webapp(2, { p1: "07701234567", p2: "07801234567", i: pids.map((p) => [p, 1]), t: 1000 * pids.length + await fee(), ...flags });

test("منو يطلع له تنبيه الدور الأول", () => {
  for (const n of ["الفصل الأول - محاضرات فقط", "الفصل الأول - امتحانات إلكترونية", "الفصل الرابع والخامس - امتحانات حضورية", "الفصل الثالث - محاضرات + امتحانات إلكتروني"]) assert.equal(firstRoundOnly(n), true, n);
  for (const n of ["ملزمة الفصل الأول إلكتروني", "ملازم الفصل الثاني", "دفتر امتحانات الفصل الأول", "دفتر محاضرات الفصل الأول", null]) assert.equal(firstRoundOnly(n), false, String(n));
});

test("منو يحسب فصلين", () => {
  assert.equal(chaptersInOrder(["الفصل الأول - محاضرات فقط", "الفصل الثاني - امتحانات إلكترونية"]).length, 2);
  assert.equal(chaptersInOrder(["الفصل الأول - محاضرات فقط", "فقط امتحانات الفصل الاول"]).length, 1);      // نفس الفصل
  assert.equal(chaptersInOrder(["الفصل الرابع والخامس - امتحانات حضورية"]).length, 1);                     // ينباعن سوية
  assert.equal(chaptersInOrder(["الفصل الأول - محاضرات فقط", "ملزمة الفصل الثاني", "دفتر امتحانات الفصل الثالث"]).length, 1);
});

test("زر المتجر يفتح الصفحة مباشرة، بدون رسائل موافقة بالمحادثة", async () => {
  await msg(2, "/start");
  await webapp(2, { k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 });
  flush();
  await msg(2, "🛒 المتجر");
  assert.match(lastSent().p.reply_markup.keyboard[0][0].web_app.url, /\/store\?v=/);
  assert.ok(!calls.some((c) => String(c.p.text ?? "").includes("تنبيه مهم")));
  flush();
});

test("طلب بدون علامة التنبيهات ما ينقبل", async () => {
  const pid = await addProduct("ملزمة الفصل الأول إلكتروني");
  await order([pid], {});
  assert.equal(await orders(), 0);
  assert.match(lastSent().p.text, /التنبيهات/);
  flush();
  await order([pid], { ag: 1 });
  assert.equal(await orders(), 1);                       // الملزمة ما تحتاج غير موافقات المتجر
  flush();
});

test("المحاضرات والامتحانات لازم تمر بتنبيه الدور الأول", async () => {
  const lec = await addProduct("الفصل الأول - محاضرات فقط");
  const n = await orders();
  await order([lec], { ag: 1 });
  assert.equal(await orders(), n);
  assert.match(lastSent().p.text, /التنبيهات/);
  flush();
  await order([lec], { ag: 1, tm: 1 });
  assert.equal(await orders(), n + 1);
  flush();
});

test("فصلين لازم يمرون برسالة الفصل الواحد", async () => {
  const a = await addProduct("الفصل الثاني - امتحانات إلكترونية");
  const b = await addProduct("الفصل الثالث - امتحانات إلكترونية");
  const n = await orders();
  await order([a, b], { ag: 1, tm: 1 });
  assert.equal(await orders(), n);
  flush();
  await order([a, b], { ag: 1, tm: 1, mn: 1 });
  assert.equal(await orders(), n + 1);
  flush();
});

test("المنتج المخفي ما يطلع بالمتجر ولا ينطلب، والطلب القديم يبقى", async () => {
  const pid = await addProduct("الفصل الخامس - محاضرات فقط");
  await msg(2, "🛒 المتجر");
  assert.ok(seen().includes(pid));
  flush();
  await order([pid], { ag: 1, tm: 1 });
  const n = await orders();

  await run("UPDATE products SET hidden=1 WHERE id=?", pid);
  await msg(2, "🛒 المتجر");
  assert.ok(!seen().includes(pid));
  flush();
  await order([pid], { ag: 1, tm: 1 });                  // صفحة قديمة بعدها مفتوحة
  assert.match(lastSent().p.text, /تغيرت أو انحذفت/);
  assert.equal(await orders(), n);
  assert.equal((await get("SELECT COUNT(*) n FROM orders WHERE user_id=2 AND items LIKE '%الفصل الخامس%'"))!.n, 1);

  await run("UPDATE products SET hidden=0 WHERE id=?", pid);
  flush();
  await msg(2, "🛒 المتجر");
  assert.ok(seen().includes(pid));
  flush();
});
