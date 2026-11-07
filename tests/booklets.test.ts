// الملازم والجواب الآلي: عناوين المحاضرات من نص الملزمة، صورة السؤال لازمة، والجواب الآلي يگول وين مشروح
// (الكلام من القالب، وClaude يگول بس الملف والصفحة). إذا طافي أو ما لگاه أو سأله قبل، يروح للأستاذ
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-bk-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.ANTHROPIC_API_KEY;
type Call = { method: string; p: any };
const calls: Call[] = [];
let claude: { found: boolean; booklet: string; page: number; confidence: string } | null = null;
let claudeCalls = 0;
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.includes("anthropic.com")) {
    claudeCalls++;
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.messages[0].content[0].type, "image");
    return new Response(JSON.stringify({ id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(claude) }], usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 } }), { headers: { "content-type": "application/json" } });
  }
  if (u.includes("/file/bot")) return new Response(new Uint8Array([255, 216, 255, 1, 2]));
  const method = u.split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "getMe" ? { username: "test_bot" } : method === "getFile" ? { file_path: "photos/a.jpg" } : { message_id: ++nextId, message_thread_id: ++nextId };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;
const { handleUpdate } = await import("../lib/bot.ts");
const { findLectures, bookletAction, replyText, DEFAULT_REPLY } = await import("../lib/booklets.ts");
const { get } = await import("../lib/sqliteDriver.ts");
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const msg = async (uid: number, text: string, extra: object = {}) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid }, text, ...extra } });
const photo = (uid: number) => msg(uid, "", { text: undefined, photo: [{ file_id: "small" }, { file_id: "big" }] });
const cb = async (uid: number, data: string) => await handleUpdate({ callback_query: { id: "c", from: { id: uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const group = async (uid: number, text: string) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: -1001, type: "supergroup", is_forum: true }, from: { id: uid }, text } });
const texts = () => calls.map((c) => c.p.text ?? c.p.caption ?? "").join("\n---\n");
const flush = () => { calls.length = 0; };
const admin = (action: string, x: object = {}) => bookletAction({ initData: sign(1), action, ...x }) as Promise<any>;
const questions = async () => Number((await get("SELECT COUNT(*) n FROM questions"))!.n);

test("عناوين المحاضرات من نص Word: كل عنوان يبدي محاضرة لحد اللي بعده", () => {
  const pages = ["الاساسيات     (1) lecturer\nبعض الشرح", "تكملة", "الاساسيات     (2) lecturer\nسؤال", "في هذه المحاضرة لا توجد واجبات", "قبل  x & y  ) lecturer (1\nشرح", "القطع المكاف ئ المحاضه 3", "ا لق طع المكاف المحاض ه 4"];
  assert.deepEqual(findLectures(pages).map((l) => [l.from, l.to, l.topic, l.lecture]), [
    [1, 2, "الاساسيات", 1], [3, 4, "الاساسيات", 2], [5, 5, "قبل x & y", 1], [6, 6, "القطع المكاف ئ", 3], [7, 7, "ا لق طع المكاف", 4],
  ]);
});

test("صفحة الملازم لصاحب البوت: ملف الملازم ينرفع مرة وحدة، والأسماء تتصلح، والجواب الآلي يتشغل", async () => {
  await handleUpdate({ message: { message_id: 1, chat: { id: 9, type: "private" }, from: { id: 9 }, text: "/start" } });
  await assert.rejects(bookletAction({ initData: sign(9), action: "list" }), (e: any) => e.status === 403);
  const ch = Number((await get("SELECT ord FROM chapters ORDER BY ord LIMIT 1"))!.ord);
  const bundle = { booklets: [
    { chapter: ch, lang: "ar", kind: "main", name: "الملزمة", pages: ["الاشتقاق المحاضرة 1\nجد مشتقة x^2+3x", "تكملة", "الاشتقاق المحاضرة 2\nجد مشتقة sin 5x"] },
    { chapter: ch, lang: "ar", kind: "exams", name: "الوزاريات", pages: ["وزاري 2019\nسؤال"] },
  ] };
  const f = new FormData();
  f.set("initData", sign(1)); f.set("action", "bundle"); f.set("file", new Blob([JSON.stringify(bundle)]), "الملازم.json");
  const r = await bookletAction(f) as any;
  assert.match(r.notice, /2 ملزمة/);
  const main = r.list.find((b: any) => b.kind === "main");
  assert.deepEqual(main.lectures.map((l: any) => [l.from, l.to, l.lecture]), [[1, 2, 1], [3, 3, 2]]);
  const t = await admin("topics", { id: main.id, topics: ["التفاضل", "التفاضل"] });
  assert.equal(t.list.find((b: any) => b.id === main.id).lectures[0].topic, "التفاضل");
  assert.equal(t.key, false);
  assert.equal((await admin("settings", { on: true })).on, true);
  assert.equal(t.reply, DEFAULT_REPLY);
});

test("السؤال: صورة الملزمة لازمة، وبدون مفتاح يروح للأستاذ مثل قبل", async () => {
  await msg(2, "/start");
  await handleUpdate({ message: { message_id: ++nextId, chat: { id: 2, type: "private" }, from: { id: 2 }, web_app_data: { data: JSON.stringify({ k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 }) } } });
  await group(1, "/setgroup");
  const ch = (await get("SELECT id FROM chapters ORDER BY ord LIMIT 1"))!.id;
  const t = (await get("SELECT id FROM topics WHERE chapter_id=? ORDER BY ord LIMIT 1", ch))!.id;
  const ask = async () => { await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch}`); await cb(2, `qt:${t}`); await cb(2, `ql:${t}:1`); };
  await ask();
  assert.match(texts(), /صور السؤال من الملزمة/);
  flush();
  const before = await questions();
  await msg(2, "شلون أحلها؟");
  assert.match(texts(), /لازم ترسل <b>صورة السؤال من الملزمة/);
  assert.equal(await questions(), before);
  await photo(2);   // ماكو مفتاح: يروح للأستاذ
  assert.equal(await questions(), before + 1);
  assert.equal(claudeCalls, 0);
  flush();
});

test("الجواب الآلي: يگول وين مشروح من القالب، وإذا بعده ما فهم أو سأله مرة ثانية يروح للأستاذ", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const list = (await admin("list")).list;
  const main = list.find((b: any) => b.kind === "main");
  const ch = (await get("SELECT id FROM chapters ORDER BY ord LIMIT 1"))!.id;
  const t = (await get("SELECT id FROM topics WHERE chapter_id=? ORDER BY ord LIMIT 1", ch))!.id;
  const ask = async () => { await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch}`); await cb(2, `qt:${t}`); await cb(2, `ql:${t}:1`); flush(); };
  claude = { found: true, booklet: main.id, page: 3, confidence: "high" };
  await ask();
  const before = await questions();
  await photo(2);
  assert.equal(claudeCalls, 1);
  assert.equal(await questions(), before);   // ما راح للأستاذ
  const reply = calls.find((c) => /سؤالك موجود بالملزمة/.test(c.p.text ?? ""))!;
  assert.match(reply.p.text, /التفاضل · المحاضرة 2[\s\S]*الملزمة الفصل \d+ صفحة 3/);
  assert.deepEqual(reply.p.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ["qx:go"]);
  flush();
  await cb(2, "qx:go");
  assert.equal(await questions(), before + 1);
  assert.ok(calls.some((c) => c.method === "createForumTopic"));
  flush();
  // نفس السؤال مرة ثانية: يروح للأستاذ مباشرة
  await ask();
  await photo(2);
  assert.equal(await questions(), before + 2);
  flush();
  // Claude مو متأكد: يروح للأستاذ
  claude = { found: true, booklet: main.id, page: 1, confidence: "low" };
  await ask();
  await photo(2);
  assert.equal(await questions(), before + 3);
  const r = await admin("list");
  assert.deepEqual([r.used, r.matched], [3, 2]);
  assert.ok(r.cost > 0);
});

test("القالب: صاحب البوت يكتب الكلام، والكلمات تتبدل، وما ينحقن HTML", () => {
  const m = { booklet: { id: "x", chapter: 2, lang: "ar", kind: "extra", name: "", pages: 9, lectures: [], created: "" }, page: 4, lecture: { from: 1, to: 9, topic: "<b>القطع</b>", lecture: 3 } } as any;
  assert.equal(replyText("<b>شوف</b> {الملف} ص{الصفحة} · {الموضوع} م{المحاضرة}", m), "<b>شوف</b> الاثرائيات الفصل 2 ص4 · &lt;b&gt;القطع&lt;/b&gt; م3");
});
