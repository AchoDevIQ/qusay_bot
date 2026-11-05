// الصفحة الرئيسية للطالب: الزر الواحد، الرمز الموقع، والمربعات، وإرسال الطلب للسيرفر
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-home-"));
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
const { homeAction } = await import("../lib/homeApi.ts");
const { homeToken, verifyHomeToken } = await import("../lib/webAuth.ts");
const { mainKb } = await import("../lib/keyboards.ts");
const { POST } = await import("../app/api/home/route.ts");
const { get, run } = await import("../lib/sqliteDriver.ts");

const msg = async (uid: number, extra: object) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid, first_name: "اسم" }, ...extra } });
const act = (action: string, extra: object = {}, uid = 2) => homeAction({ token: homeToken(uid), action, ...extra });
const flush = () => calls.splice(0);

test("الرمز: الغلط والمنتهي مرفوضين، ولحساب ثاني ما يشتغل", async () => {
  const t = homeToken(2);
  assert.equal(verifyHomeToken(t), 2);
  assert.equal(verifyHomeToken(t, Date.now() / 1000 + 61 * 24 * 3600), null);
  const [, exp, sig] = t.split(".");
  assert.equal(verifyHomeToken(`3.${exp}.${sig}`), null);
  assert.equal(verifyHomeToken("x"), null);
  const res = await POST(new Request("http://x/api/home", { method: "POST", body: JSON.stringify({ action: "list", token: "bad" }) }));
  assert.equal(res.status, 401);
});

test("أسفل المحادثة زر واحد يفتح القائمة برمز صاحبه", async () => {
  await msg(2, { text: "/start" });
  await msg(2, { web_app_data: { data: JSON.stringify({ k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 }) } });
  const kb = (await mainKb(2)).keyboard;
  assert.equal(kb.length, 1);
  const url = new URL(kb[0][0].web_app!.url);
  assert.equal(url.pathname, "/store/home");
  assert.equal(verifyHomeToken(url.searchParams.get("t")), 2);
  assert.ok((await mainKb(1)).keyboard.flat().some((b) => b.text.includes("لوحة التحكم")));   // المدير يبقى عنده زر اللوحة
  flush();
});

test("القائمة ترجع اسمه، وامتحاناتي تطلع بس لمن عنده", async () => {
  const r: any = await act("list");
  assert.equal(r.name, "علي");
  assert.equal(r.exams, false);
  await run("INSERT INTO exam_access (user_id, chapter) VALUES (2, 'الفصل الأول')");
  assert.equal(((await act("list")) as any).exams, true);
});

test("كل مربع يوصل الطالب لمكانه بالمحادثة", async () => {
  for (const [action, re] of [["ask", /الأسئلة العلمية/], ["me", /علي حسن/], ["myq", /سؤال|أسئلت/], ["exams", /امتحانات/]] as const) {
    flush();
    assert.deepEqual(await act(action), { close: true }, action);
    assert.match(calls.map((c) => c.p.text ?? c.p.caption ?? "").join("\n"), re, action);
  }
  await assert.rejects(act("bad"), (e: any) => e.status === 400);
  flush();
});

test("المتجر: غير المسجل يروح للتسجيل، والمسجل ياخذ رابط برمزه", async () => {
  const reg: any = await act("shop", {}, 9);
  assert.equal(new URL(reg.url).pathname, "/store/reg");
  flush();
  const r: any = await act("shop");
  assert.ok(r.url.startsWith("https://x.test/store?v="));
  const d = JSON.parse(Buffer.from(new URL(r.url).searchParams.get("d")!, "base64url").toString("utf8"));
  assert.equal(verifyHomeToken(d.tk), 2);
  flush();
});

test("الطلب يوصل السيرفر مباشرة وينحفظ باسم صاحب الرمز", async () => {
  await run("INSERT OR IGNORE INTO cats (name) VALUES ('قسم')");
  const cat = (await get("SELECT id FROM cats WHERE name='قسم'"))!.id;
  await run("INSERT INTO products (cat_id, name, price) VALUES (?, 'ملزمة الفصل الأول', 1000)", cat);
  const pid = (await get("SELECT id FROM products WHERE name='ملزمة الفصل الأول'"))!.id;
  const fee = (await get("SELECT fee FROM fees WHERE gov='البصرة'"))!.fee;
  const n = (await get("SELECT COUNT(*) n FROM orders WHERE user_id=2"))!.n;
  await assert.rejects(act("order"), (e: any) => e.status === 400);
  assert.deepEqual(await act("order", { order: { p1: "07701234567", p2: "07801234567", i: [[pid, 1]], t: 1000 + fee, ag: 1 } }), { close: true });
  const o = (await get("SELECT * FROM orders WHERE user_id=2 ORDER BY id DESC LIMIT 1"))!;
  assert.equal((await get("SELECT COUNT(*) n FROM orders WHERE user_id=2"))!.n, n + 1);
  assert.equal(o.username, "u2");
  assert.ok(!calls.some((c) => /طلب جديد/.test(c.p.text ?? "")));   // الطلب يطلع بالصفحة، بدون رسالة
  flush();
});
