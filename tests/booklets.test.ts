// الملازم والجواب الآلي: عناوين المحاضرات من نص الملزمة، والطالب يسأل عادي. إذا الأستاذ حال السؤال بالملازم،
// يوصله الحل نفسه (مقصوص من صفحة الملزمة) بصورة بإطار، ويا زر للأستاذ. إذا طافي، أو ما لگاه، أو وصله قبل، يروح للأستاذ
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
let found: Record<string, unknown> = {};
let crop: Record<string, unknown> = { found: true, top: 0.1, bottom: 0.5 };
let claudeCalls = 0;
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.includes("anthropic.com")) {
    claudeCalls++;
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal(body.fallbacks, undefined);   // Haiku 5.5 has no server-side fallback
    assert.ok(body.max_tokens >= 16000);       // structured calls leave room for thinking (agent-docs/models-haiku.md)
    const isCrop = "top" in body.output_config.format.schema.properties;
    return new Response(JSON.stringify({ id: "m1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(isCrop ? crop : found) }], usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 } }), { headers: { "content-type": "application/json" } });
  }
  if (u.includes("/file/bot")) return new Response(new Uint8Array([255, 216, 255, 1, 2]));
  const method = u.split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "getMe" ? { username: "test_bot" } : method === "getFile" ? { file_path: "photos/a.jpg" } : { message_id: ++nextId, message_thread_id: ++nextId };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;
const { handleUpdate } = await import("../lib/bot.ts");
const { findLectures, bookletAction, replyText, framed, DEFAULT_REPLY } = await import("../lib/booklets.ts");
const { get } = await import("../lib/sqliteDriver.ts");
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
/** PDF صغير بصفحتين، حتى نجرب صور الصفحات والقص */
function tinyPdf() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    "<< /Length 44 >>\nstream\nBT /F1 24 Tf 40 300 Td (x^2 + 3x) Tj ET\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
const msg = async (uid: number, text: string, extra: object = {}) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid }, text, ...extra } });
const cb = async (uid: number, data: string) => await handleUpdate({ callback_query: { id: "c", from: { id: uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const group = async (uid: number, text: string) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: -1001, type: "supergroup", is_forum: true }, from: { id: uid }, text } });
const flush = () => { calls.length = 0; };
const admin = (action: string, x: object = {}) => bookletAction({ initData: sign(1), action, ...x }) as Promise<any>;
const upload = (file: Blob, name: string) => { const f = new FormData(); f.set("initData", sign(1)); f.set("action", name.endsWith(".json") ? "bundle" : "upload"); f.set("file", new File([file], name)); return bookletAction(f) as Promise<any>; };
const questions = async () => Number((await get("SELECT COUNT(*) n FROM questions"))!.n);

test("عناوين المحاضرات من نص Word: كل عنوان يبدي محاضرة لحد اللي بعده، وبالأرقام أو بالكلمات", () => {
  const pages = ["الاساسيات     (1) lecturer\nبعض الشرح", "تكملة", "الاساسيات     (2) lecturer\nسؤال", "في هذه المحاضرة لا توجد واجبات", "قبل  x & y  ) lecturer (1\nشرح", "القطع المكاف ئ المحاضه 3", "ا لق طع المكاف المحاض ه 4"];
  assert.deepEqual(findLectures(pages).map((l) => [l.from, l.to, l.topic, l.lecture]), [
    [1, 2, "الاساسيات", 1], [3, 4, "الاساسيات", 2], [5, 5, "قبل x & y", 1], [6, 6, "القطع المكاف ئ", 3], [7, 7, "ا لق طع المكاف", 4],
  ]);
  assert.deepEqual(findLectures(["المحاضرة الأولى  :  الاشتقاق\nf", "المحاضرة الثانية : الاشتقاق", "المحاضرة الحادية عشر : التقريب", "Lecture 3  :  The Derivation"]).map((l) => [l.topic, l.lecture]),
    [["الاشتقاق", 1], ["الاشتقاق", 2], ["التقريب", 11], ["The Derivation", 3]]);
});

test("صفحة الملازم لصاحب البوت: الملازم.json أول، بعده الـ PDF باسمه ينضاف لملزمته، والجواب الآلي يتشغل", async () => {
  await handleUpdate({ message: { message_id: 1, chat: { id: 9, type: "private" }, from: { id: 9 }, text: "/start" } });
  await assert.rejects(bookletAction({ initData: sign(9), action: "list" }), (e: any) => e.status === 403);
  const ch = Number((await get("SELECT ord FROM chapters ORDER BY ord LIMIT 1"))!.ord);
  await assert.rejects(upload(new Blob([tinyPdf()]), `${ch}-ar-main.pdf`), /ارفع ملف «الملازم.json» أول/);
  const bundle = { booklets: [{ chapter: ch, lang: "ar", kind: "main", name: "الملزمة", pages: ["الاشتقاق المحاضرة 1\nجد مشتقة x^2+3x", "تكملة الحل"] }] };
  const r = await upload(new Blob([JSON.stringify(bundle)]), "الملازم.json");
  assert.match(r.notice, /1 ملزمة/);
  assert.equal(r.list[0].pdf, undefined);
  const p = await upload(new Blob([tinyPdf()]), `${ch}-ar-main.pdf`);
  assert.match(p.notice, /انرفع PDF الملزمة/);
  assert.equal(p.list[0].pdf, true);
  assert.equal((await admin("settings", { on: true })).on, true);
  assert.equal(p.reply, DEFAULT_REPLY);
});

test("بدون مفتاح: الطالب يسأل عادي (كتابة)، وسؤاله يروح للأستاذ مثل قبل", async () => {
  await msg(2, "/start");
  await handleUpdate({ message: { message_id: ++nextId, chat: { id: 2, type: "private" }, from: { id: 2 }, web_app_data: { data: JSON.stringify({ k: "reg", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 }) } } });
  await group(1, "/setgroup");
  const ch = (await get("SELECT id FROM chapters ORDER BY ord LIMIT 1"))!.id;
  const t = (await get("SELECT id FROM topics WHERE chapter_id=? ORDER BY ord LIMIT 1", ch))!.id;
  await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch}`); await cb(2, `qt:${t}`); await cb(2, `ql:${t}:1`);
  flush();
  const before = await questions();
  await msg(2, "جد مشتقة x^2+3x");
  assert.equal(await questions(), before + 1);
  assert.equal(claudeCalls, 0);
  flush();
});

test("الجواب الآلي: الحل من الملزمة بصورة بإطار ويا زر للأستاذ، وإذا وصله قبل أو ما لگاه يروح للأستاذ", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const b = (await admin("list")).list[0];
  const ch = (await get("SELECT id FROM chapters ORDER BY ord LIMIT 1"))!.id;
  const t = (await get("SELECT id FROM topics WHERE chapter_id=? ORDER BY ord LIMIT 1", ch))!.id;
  const ask = async () => { await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch}`); await cb(2, `qt:${t}`); await cb(2, `ql:${t}:1`); flush(); };
  found = { found: true, booklet: b.id, page: 1, page_end: 2, confidence: "high" };
  await ask();
  const before = await questions();
  await msg(2, "جد مشتقة x^2+3x");
  assert.equal(claudeCalls, 2);   // وين الحل، ووين القص
  assert.equal(await questions(), before);
  const photo = calls.find((c) => c.method === "sendPhoto")!;
  assert.ok(photo, "صورة الحل");
  assert.equal(photo.p.photo, "<file>");
  assert.match(photo.p.caption, /هاك حل سؤالك/);
  assert.doesNotMatch(photo.p.caption, /صفحة|المحاضرة/);
  assert.deepEqual(JSON.parse(photo.p.reply_markup).inline_keyboard[0].map((x: any) => x.callback_data), ["qx:go"]);
  flush();
  await cb(2, "qx:go");
  assert.equal(await questions(), before + 1);
  flush();
  // نفس الحل مرة ثانية: يروح للأستاذ مباشرة
  await ask(); await msg(2, "جد مشتقة x^2+3x");
  assert.equal(await questions(), before + 2);
  // مو متأكد: يروح للأستاذ
  found = { found: true, booklet: b.id, page: 2, page_end: 2, confidence: "low" };
  await ask(); await msg(2, "سؤال ثاني");
  assert.equal(await questions(), before + 3);
  // لگاه بس ما گدر يقص: يروح للأستاذ
  found = { found: true, booklet: b.id, page: 2, page_end: 2, confidence: "high" };
  crop = { found: false, top: 0, bottom: 0 };
  await ask(); await msg(2, "سؤال ثالث");
  assert.equal(await questions(), before + 4);
  const r = await admin("list");
  assert.deepEqual([r.used, r.matched], [4, 2]);   // المرة الثانية لگاه بس وصله قبل
  assert.ok(r.cost > 0);
});

test("صورة الحل: رأس فوك وجواه المقطع، وصورة JPG", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(400, 600); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 600);
  const page = Buffer.from(await c.encode("jpeg", 80));
  const out = await framed([page, page], 0.5, 0.25);
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
});

test("الكلام ويا الصورة: صاحب البوت يكتبه، والخط العريض بس يشتغل", () => {
  assert.equal(replyText("<b>هاك</b> <i>حل</i>"), "<b>هاك</b> &lt;i&gt;حل&lt;/i&gt;");
});
