// ترتيب كلمات الشرط قبل المتجر، وتنبيه الدور الأول للمحاضرات والامتحانات
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
const { chaptersInOrder, firstRoundOnly } = await import("../lib/student.ts");
const { REFUND_SENTENCE, TERM_SENTENCE } = await import("../lib/config.ts");
const { getSession } = await import("../lib/db.ts");
const { get, run } = await import("../lib/sqliteDriver.ts");

const msg = async (uid: number, text: string, extra: object = {}) => await handleUpdate({
  message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid, first_name: "اسم" }, text, ...extra },
});
const webapp = async (uid: number, o: unknown) => await msg(uid, "", { text: undefined, web_app_data: { data: JSON.stringify(o) } });
const cb = async (uid: number, data: string) => await handleUpdate({ callback_query: { id: "c", from: { id: uid, username: "u" + uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const flush = () => calls.splice(0);
const sent = () => calls.filter((c) => c.method !== "answerCallbackQuery");
const lastSent = () => sent().at(-1)!;
const buttons = (c: Call) => (c.p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);

/** يضغط الكلمات بالترتيب الصحيح من اللي محفوظ بالجلسة */
async function solve(uid: number, sentence: string) {
  for (const word of sentence.split(" ")) {
    const { data } = await getSession(uid);
    await cb(uid, `wp:${data.words.pool.indexOf(word)}`);
  }
}
const register = async (uid: number) => await webapp(uid, {
  k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0,
});
const addProduct = async (name: string) => {
  await run("INSERT OR IGNORE INTO cats (name) VALUES ('قسم')");
  const cat = (await get("SELECT id FROM cats WHERE name='قسم'"))!.id;
  await run("INSERT INTO products (cat_id, name, price) VALUES (?, ?, 1000)", cat, name);
  return (await get("SELECT id FROM products WHERE name=?", name))!.id as number;
};
const fee = async () => (await get("SELECT fee FROM fees WHERE gov='البصرة'"))!.fee as number;
const orders = async (uid: number) => (await get("SELECT COUNT(*) n FROM orders WHERE user_id=?", uid))!.n as number;
const order = async (uid: number, pid: number) => await webapp(uid, { p1: "07701234567", p2: "07801234567", i: [[pid, 1]], t: 1000 + await fee() });
/** يوصل لحد ما يفتح المتجر */
async function openStore(uid: number) {
  await msg(uid, "🛒 المتجر");
  await cb(uid, "agree");
  await cb(uid, "agree");
  await solve(uid, REFUND_SENTENCE);
  await cb(uid, "wok");
}

test("منو يطلع له تنبيه الدور الأول", () => {
  const yes = ["الفصل الأول - محاضرات فقط", "الفصل الأول - امتحانات إلكترونية", "الفصل الرابع والخامس - امتحانات حضورية", "الفصل الثالث - محاضرات + امتحانات إلكتروني"];
  const no = ["ملزمة الفصل الأول إلكتروني", "ملازم الفصل الثاني", "دفتر امتحانات الفصل الأول", "دفتر محاضرات الفصل الأول", null];
  for (const n of yes) assert.equal(firstRoundOnly(n), true, String(n));
  for (const n of no) assert.equal(firstRoundOnly(n), false, String(n));
});

test("موافقتين، وبعدها ترتيب الجملة، وما ينفتح المتجر بدونها", async () => {
  await msg(2, "/start");
  await register(2);
  flush();
  await msg(2, "🛒 المتجر");
  await cb(2, "agree");
  flush();
  await cb(2, "agree");
  const screen = lastSent();
  const wordCount = REFUND_SENTENCE.split(" ").length;
  assert.equal(buttons(screen).filter((b: string) => b.startsWith("wp:")).length, wordCount);
  assert.ok(!buttons(screen).includes("agree"));
  assert.notEqual((await getSession(2)).data.words.pool.join(" "), REFUND_SENTENCE);

  // ضغطة «agree» أو طلب من الصفحة بهاي المرحلة ما يتجاوزها
  flush();
  await cb(2, "agree");
  assert.equal((await getSession(2)).state, "words");
  await cb(2, "wok");
  assert.equal(calls.at(-1)!.p.text, "رتب الكلمات أولا");
  flush();
  await webapp(2, { p1: "07701234567", p2: "07801234567", i: [], t: 0 });
  assert.equal(await orders(2), 0);
  assert.equal((await getSession(2)).state, "agree");
  flush();
});

test("الترتيب الغلط يعيد الكلمات، والمسح يرجع آخر كلمة، والصح يفتح المتجر", async () => {
  await msg(2, "🛒 المتجر");
  await cb(2, "agree");
  await cb(2, "agree");
  const words = (await getSession(2)).data.words;
  const wrong = [...REFUND_SENTENCE.split(" ")].reverse();

  await cb(2, `wp:${words.pool.indexOf(wrong[0])}`);
  await cb(2, `wp:${words.pool.indexOf(wrong[1])}`);
  assert.equal((await getSession(2)).data.words.picked.length, 2);
  flush();
  await cb(2, "wu");
  assert.equal((await getSession(2)).data.words.picked.length, 1);
  await cb(2, `wp:${words.pool.indexOf(wrong[0])}`); // نفس الكلمة مرتين ما تنحسب
  assert.equal((await getSession(2)).data.words.picked.length, 1);

  for (const w of wrong.slice(1)) await cb(2, `wp:${words.pool.indexOf(w)}`);
  const after = await getSession(2);
  assert.equal(after.state, "words");
  assert.equal(after.data.words.picked.length, 0);
  assert.ok(!after.data.words.done);
  assert.match(sent().at(-1)!.p.text, /الترتيب غلط/);

  flush();
  await solve(2, REFUND_SENTENCE);
  assert.deepEqual(buttons(lastSent()), ["wok"]);
  flush();
  await cb(2, "wok");
  assert.equal((await getSession(2)).state, "store");
  assert.match(lastSent().p.reply_markup.keyboard[0][0].web_app.url, /\/store\?v=/);
  flush();
});

test("الملزمة تكمل بدون تنبيه الدور الأول", async () => {
  const pid = await addProduct("ملزمة الفصل الأول إلكتروني");
  await order(2, pid);
  assert.equal(await orders(2), 1);
  assert.ok(!calls.some((c) => String(c.p.text ?? "").includes(TERM_SENTENCE)));
  flush();
});

test("المحاضرات: موافق، بعدها ترتيب، وبعدها ينحفظ الطلب", async () => {
  const pid = await addProduct("الفصل الأول - محاضرات فقط");
  await openStore(2);
  flush();
  await order(2, pid);
  assert.equal(await orders(2), 1);                     // لسه ما انحفظ
  assert.match(lastSent().p.text, new RegExp(TERM_SENTENCE));
  assert.deepEqual(buttons(lastSent()), ["termok"]);
  flush();
  await cb(2, "termok");
  assert.equal((await getSession(2)).state, "words");
  assert.equal((await getSession(2)).data.words.kind, "term");
  await solve(2, TERM_SENTENCE);
  assert.equal(await orders(2), 1);                     // لازم يضغط موافق
  await cb(2, "wok");
  assert.equal(await orders(2), 2);
  flush();
});

const orderMany = async (uid: number, pids: number[]) => await webapp(uid, { p1: "07701234567", p2: "07801234567", i: pids.map((p) => [p, 1]), t: 1000 * pids.length + await fee() });

test("منو يحسب فصلين", () => {
  const n = (...names: string[]) => chaptersInOrder(names.map((name) => ({ name }))).length;
  assert.equal(n("الفصل الأول - محاضرات فقط", "الفصل الثاني - امتحانات إلكترونية"), 2);
  assert.equal(n("الفصل الأول - محاضرات فقط", "فقط امتحانات الفصل الاول"), 1);      // نفس الفصل
  assert.equal(n("الفصل الرابع والخامس - امتحانات حضورية"), 1);                     // ينباعن سوية
  assert.equal(n("الفصل الأول - محاضرات فقط", "ملزمة الفصل الثاني", "دفتر امتحانات الفصل الثالث"), 1);
});

test("فصلين برسالة الفصل الواحد: أعدل يرجع للصفحة، وأكمل يكمل للتنبيه", async () => {
  const a = await addProduct("الفصل الثاني - محاضرات فقط");
  const b = await addProduct("الفصل الثالث - محاضرات فقط");
  await openStore(2);
  const before = await orders(2);
  flush();
  await orderMany(2, [a, b]);
  assert.match(lastSent().p.text, /فصل واحد/);
  assert.deepEqual(buttons(lastSent()), ["manyok", "manyedit"]);
  assert.equal(await orders(2), before);
  flush();
  await cb(2, "manyedit");
  assert.equal((await getSession(2)).state, "store");
  assert.match(lastSent().p.reply_markup.keyboard[0][0].web_app.url, /\/store\?v=/);
  flush();
  await orderMany(2, [a, b]);
  assert.match(lastSent().p.text, /فصل واحد/);
  flush();
  await cb(2, "manyok");
  assert.deepEqual(buttons(lastSent()), ["termok"]);
  await cb(2, "termok");
  await solve(2, TERM_SENTENCE);
  await cb(2, "wok");
  assert.equal(await orders(2), before + 1);
  flush();
});

test("المنتج المخفي ما يطلع بالمتجر ولا ينطلب، والطلب القديم يبقى", async () => {
  const pid = await addProduct("الفصل الخامس - محاضرات فقط");
  await openStore(2);
  const seen = () => {
    const url = lastSent().p.reply_markup.keyboard[0][0].web_app.url as string;
    const d = JSON.parse(Buffer.from(new URL(url).searchParams.get("d")!, "base64url").toString("utf8"));
    return d.c.flatMap((c: any) => c[1].map((p: any) => p[0])) as number[];
  };
  assert.ok(seen().includes(pid));
  flush();
  await order(2, pid);
  await cb(2, "termok");
  await solve(2, TERM_SENTENCE);
  await cb(2, "wok");
  const count = await orders(2);

  await run("UPDATE products SET hidden=1 WHERE id=?", pid);
  await openStore(2);
  assert.ok(!seen().includes(pid));
  flush();
  await order(2, pid);                                  // صفحة قديمة بعدها مفتوحة
  assert.match(sent().at(-1)!.p.text, /تغيرت أو انحذفت/);
  assert.equal(await orders(2), count);
  assert.equal((await get("SELECT COUNT(*) n FROM orders WHERE user_id=2 AND items LIKE '%الفصل الخامس%'"))!.n, 1);

  await run("UPDATE products SET hidden=0 WHERE id=?", pid);
  flush();
  await openStore(2);
  assert.ok(seen().includes(pid));
  await run("UPDATE products SET hidden=1 WHERE id=?", pid);
  flush();
});

test("الامتحانات يطلع لها التنبيه، وبإلغاء التنبيه ما ينحفظ طلب", async () => {
  const pid = await addProduct("الفصل الأول - امتحانات إلكترونية");
  await openStore(2);
  const before = await orders(2);
  flush();
  await order(2, pid);
  assert.deepEqual(buttons(lastSent()), ["termok"]);
  await cb(2, "termok");
  await cb(2, "cancel");
  assert.equal(await orders(2), before);
  assert.equal((await getSession(2)).state, "");
  flush();
});
