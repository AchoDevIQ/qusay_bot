// بنك الامتحانات: الإدخال، والتعديل من الإدارة بصلاحية مستقلة، وزر «شوف كطالب»
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-bank-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: path.join(tmp, "content"),
  CHROME_PATH: path.join(tmp, "no-browser"), ASSETS_DIR: path.join(tmp, "no-assets"), SETTINGS_FILE: path.join(tmp, "no-settings"),
});

type Call = { method: string; p: any };
const calls: Call[] = [];
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "t" } }));
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: ++nextId } }));
}) as typeof fetch;

const { handleUpdate } = await import("../lib/bot.ts");
const { get, all, initDb, run } = await import("../lib/db.ts");
const { loadCatalog } = await import("../lib/examBank.ts");

const msg = (uid: number, text?: string, extra: object = {}) => handleUpdate({
  message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid }, text, ...extra },
});
const cb = (uid: number, data: string) => handleUpdate({ callback_query: { id: "c", from: { id: uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const flush = () => { const out = [...calls]; calls.length = 0; return out; };
const buttons = (c: Call) => (c.p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);
const keys = (c: Call) => (c.p.reply_markup?.keyboard ?? []).flat().map((b: any) => b.text);
const lastBtns = () => buttons(calls.filter((c) => c.p.reply_markup?.inline_keyboard).at(-1)!);

const dir = path.join(tmp, "content", "ch1", "e1", "A");
fs.mkdirSync(dir, { recursive: true });
for (const f of ["q1.png", "q2.png", "a1_1.png", "a1_2.png", "student_ar.pdf"]) fs.writeFileSync(path.join(dir, f), "x");
const CATALOG = {
  chapter: "الفصل الأول", slug: "ch1",
  exams: [{ ord: 1, title: "قبل x & y", info: "المحاضرة (1 & 2)", minutes: 60, versions: [
    { model: "A", ok: true, issues: [], has_en: false, questions: [{ n: 1, max: 20, q: "q1.png", a: ["a1_1.png", "a1_2.png"] }, { n: 2, max: 20, q: "q2.png", a: [] }] },
    { model: "B", ok: false, issues: ["امتحان 1 نسخة B: ماكو جواب للأسئلة [1]"], has_en: true, questions: [{ n: 1, max: 20, q: "q1.png", a: [] }] },
  ] }],
};

test("الإدخال يسوي الامتحانات، وإعادته ما تكرر ولا تمسح التعديل", () => {
  initDb();
  assert.deepEqual(loadCatalog(CATALOG), { exams: 1, versions: 2, questions: 3, needReview: 1 });
  run("UPDATE bank_questions SET max_mark=7, edited=1 WHERE n=2");
  loadCatalog(CATALOG);
  assert.equal(get("SELECT COUNT(*) n FROM bank_questions")!.n, 3);
  assert.equal(get("SELECT max_mark FROM bank_questions WHERE n=2")!.max_mark, 7);
  assert.equal(get("SELECT max_mark FROM bank_questions WHERE n=1 LIMIT 1")!.max_mark, 20);
  run("UPDATE bank_questions SET max_mark=20, edited=0 WHERE n=2");
});

test("التصفح: الفصل، الامتحان، النسخة، والنسخة الناقصة معلمة", async () => {
  await cb(1, "a:ex");
  assert.ok(buttons(calls[0]).includes("a:exh:0"));
  flush();
  await cb(1, "a:exh:0");
  assert.match(JSON.stringify(calls[0].p.reply_markup), /⚠️ 1\)/);
  flush();
  await cb(1, "a:exe:1");
  assert.match(calls[0].p.text, /1:00 ساعة/);
  flush();
  await cb(1, "a:exv:2");
  assert.match(calls[0].p.text, /ماكو جواب للأسئلة/);
  flush();
});

test("تغيير نوع النسخة ووقت الامتحان، وكل تعديل ينحفظ باسم صاحبه", async () => {
  assert.equal(get("SELECT kind FROM bank_versions WHERE id=1")!.kind, "mandatory");
  await cb(1, "a:exk:1");
  assert.equal(get("SELECT kind FROM bank_versions WHERE id=1")!.kind, "optional");
  flush();
  await cb(1, "a:exm:1");
  await msg(1, "مو رقم");
  assert.match(calls.at(-1)!.p.text, /عدد الدقائق/);
  await msg(1, "75");
  assert.equal(get("SELECT minutes FROM bank_exams WHERE id=1")!.minutes, 75);
  flush();
  assert.ok(all("SELECT * FROM bank_edits").every((e) => e.user_id === 1));
  assert.equal(all("SELECT * FROM bank_edits").length, 2);
});

test("فتح السؤال يرسل صورته وجوابه، وتعديل الدرجة والصور", async () => {
  await cb(1, "a:exq:1");
  assert.deepEqual(calls.filter((c) => c.method === "sendPhoto").map((c) => c.p.caption), ["س 1 (من 20)", "جواب س 1 (1/2)", "جواب س 1 (2/2)"]);
  flush();
  await cb(1, "a:exq:2");
  assert.ok(calls.some((c) => /ماكو إله جواب/.test(c.p.text ?? "")));
  flush();
  await cb(1, "a:exqm:1");
  await msg(1, "12.5");                                     // الدرجات أرقام كاملة بس
  assert.match(calls.at(-1)!.p.text, /رقم كامل/);
  await msg(1, "15");
  assert.equal(get("SELECT max_mark FROM bank_questions WHERE id=1")!.max_mark, 15);
  flush();
  await cb(1, "a:exqi:1");
  await msg(1, "نص");
  assert.match(calls.at(-1)!.p.text, /أرسل صورة/);
  await msg(1, undefined, { photo: [{ file_id: "s" }, { file_id: "NEWQ" }] });
  assert.equal(get("SELECT q_file FROM bank_questions WHERE id=1")!.q_file, "tg:NEWQ");
  assert.ok(calls.some((c) => c.method === "sendPhoto" && c.p.photo === "NEWQ"));
  flush();
  await cb(1, "a:exqa:1");
  await msg(1, "تم");
  assert.match(calls.at(-1)!.p.text, /أرسل صورة الجواب/);
  await msg(1, undefined, { photo: [{ file_id: "A1" }] });
  await msg(1, undefined, { photo: [{ file_id: "A2" }] });
  await msg(1, "تم");
  assert.deepEqual(JSON.parse(get("SELECT a_files FROM bank_questions WHERE id=1")!.a_files), ["tg:A1", "tg:A2"]);
  assert.equal(get("SELECT edited FROM bank_questions WHERE id=1")!.edited, 1);
  flush();
  await cb(1, "a:exp:1:ar");
  assert.equal(calls[0].method, "sendDocument");
  flush();
  await cb(1, "a:exo:1");
  assert.equal(get("SELECT ok FROM bank_versions WHERE id=1")!.ok, 0);
  flush();
  await cb(1, "a:exo:1");
  assert.equal(get("SELECT ok FROM bank_versions WHERE id=1")!.ok, 1);
  flush();
});

test("الصلاحية مستقلة: الطالب والمساعد بدونها ممنوعين، وبيها يدخل", async () => {
  await cb(2, "a:ex");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
  await cb(1, "a:sfa");
  await msg(1, "55555");
  await msg(1, "مساعد");
  flush();
  await cb(55555, "a:exq:1");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
  await msg(55555, "/admin");
  assert.ok(!lastBtns().includes("a:ex"));
  flush();
  await cb(1, "a:sfp:55555:exams");
  flush();
  await msg(55555, "/admin");
  assert.ok(lastBtns().includes("a:ex"));
  flush();
  await cb(55555, "a:exm:1");
  await msg(55555, "80");
  assert.equal(get("SELECT minutes FROM bank_exams WHERE id=1")!.minutes, 80);
  flush();
  await cb(1, "a:sfp:55555:exams");                         // سحب الصلاحية بنص العملية
  await cb(55555, "a:exm:1");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
});

test("شوف كطالب: نفس أزرار الطالب بدون صلاحيات، ويرجع بزر", async () => {
  await msg(1, "/admin");
  assert.ok(lastBtns().includes("a:asstudent"));
  flush();
  await cb(1, "a:asstudent");
  const k = keys(calls[0]);
  assert.ok(k.includes("🛒 المتجر") && k.includes("⚙️ رجوع للوحة التحكم"));
  assert.ok(!k.some((x: string) => x === "⚙️ لوحة التحكم"));
  flush();
  await cb(1, "a:ex");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
  await msg(1, "/admin");                                    // مثل الطالب: ما تنفتح اللوحة
  assert.ok(!JSON.stringify(calls).includes("a:bulk"));
  flush();
  await msg(1, "⚙️ رجوع للوحة التحكم");
  assert.ok(JSON.stringify(calls).includes("a:bulk"));
  flush();
  await cb(1, "a:ex");
  assert.notEqual(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
  await msg(2, "⚙️ رجوع للوحة التحكم");                       // طالب عادي يكتبها: ما تنطيه شي
  assert.ok(!JSON.stringify(calls).includes("a:bulk"));
  flush();
});

test("بوضع الطالب ما يوصل شي إداري أبداً، ويرجع كلشي بعد الرجوع", async () => {
  const { staffIds, myOffice } = await import("../lib/data.ts");
  run("INSERT INTO offices(name) VALUES('مكتبة')");
  run("INSERT INTO office_users(user_id, office_id, name) VALUES(1, 1, 'صاحبها')");
  assert.ok(staffIds("orders").includes(1));
  assert.ok(myOffice(1));
  await cb(1, "a:asstudent");
  flush();
  assert.ok(!staffIds("orders").includes(1));
  assert.equal(myOffice(1), null);
  await msg(1, "🏪 مكتبتي");
  assert.ok(!JSON.stringify(calls).includes("of:pos"));
  flush();
  await msg(1, "احمد");                                      // البحث السريع إداري
  assert.ok(!JSON.stringify(calls).includes("نتيجة"));
  flush();
  await msg(1, "⚙️ رجوع للوحة التحكم");
  flush();
  assert.ok(staffIds("orders").includes(1));
  assert.ok(myOffice(1));
  run("DELETE FROM office_users WHERE user_id=1");
});

test("المساعد يجرب كطالب، والطالب ما يطلعله زر التجربة", async () => {
  await cb(1, "a:sfp:55555:orders");
  flush();
  await msg(55555, "/admin");
  assert.ok(lastBtns().includes("a:asstudent"));
  flush();
  await cb(55555, "a:asstudent");
  assert.ok(keys(calls[0]).includes("⚙️ رجوع للوحة التحكم"));
  flush();
  await cb(2, "a:asstudent");
  assert.equal(calls.at(-1)!.p.text, "ما عندك صلاحية");
  flush();
});
