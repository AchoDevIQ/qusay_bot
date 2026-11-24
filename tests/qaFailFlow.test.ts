// من الطالب للأستاذ: الذكاء واقف (رصيد أو خدمة)، فسؤال الطالب يروح للمجموعة ويا ملاحظة، والطالب ما يوصله شي عن الذكاء،
// وصاحب البوت يوصله تنبيه بزر «🔁 جربهم هسه». من يرجع الذكاء، الطالب يوصله الحل وموضوعه بالمجموعة ينكتب عليه
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-qaflow-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"), GRADING_AI_URL: "https://ai.test/", GRADING_AI_KEY: "k" });
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.ANTHROPIC_API_KEY;
type Call = { method: string; p: any };
const calls: Call[] = [];
let down = true;
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.startsWith("https://ai.test")) {
    if (down) return new Response("Internal Server Error", { status: 500 });
    const body = JSON.parse(init.body);
    return Response.json({ ...(body.mode === "solve" ? { found: true, solution: "$z=3-2i$" } : { found: false, solution: "" }), usage: [] });
  }
  const method = u.split("/").pop()!;
  const p = JSON.parse(init.body);
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId, message_thread_id: ++nextId } }));
}) as typeof fetch;
const { handleUpdate } = await import("../lib/bot.ts");
const qa = await import("../lib/qaBank.ts");
// الحل صار بجهتنا (2026-11-23): هالفحوصات تمشي على خدمة وهمية بنفس شكل الطلب القديم
qa.setQaService(async (route, body) => (await import("../lib/aiGrade.ts")).svc(route, body));
const { qaFailTick, qaRetryTick } = await import("../lib/questions.ts");
const { qaFails } = await import("../lib/qaFails.ts");
const { initDb, find, one } = await import("../lib/db.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
function docx(xml: string) {
  const name = Buffer.from("word/document.xml"), data = Buffer.from(xml, "utf8");
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(crc(data), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, cen, name, end]);
}
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const BOOK = docx(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p("الجذور التربيعية المحاضرة 1")}${p("س1 / جد الجذور التربيعية للعدد 8i")}${p("الحل: نفرض x+yi")}</w:body></w:document>`);
const msg = async (uid: number, text: string) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: uid, type: "private" }, from: { id: uid, username: "u" + uid }, text } });
const cb = async (uid: number, data: string) => await handleUpdate({ callback_query: { id: "c", from: { id: uid }, message: { chat: { id: uid }, message_id: 50 }, data } });
const group = async (uid: number, text: string) => await handleUpdate({ message: { message_id: ++nextId, chat: { id: -1001, type: "supergroup", is_forum: true }, from: { id: uid }, text } });
const to = (chat: number) => calls.filter((c) => c.p.chat_id === chat && c.method === "sendMessage").map((c) => String(c.p.text));

test("الذكاء واقف: السؤال للأستاذ، تنبيه لصاحب البوت بس، ومن يرجع ينجاوب الطالب وحده", async () => {
  const f = new FormData(); f.set("initData", sign(1)); f.set("action", "upload"); f.set("chapter", "1"); f.set("lang", "ar"); f.set("kind", "main"); f.set("file", new File([BOOK], "ch1.docx"));
  await qa.qaAction(f);
  await qa.qaAction({ initData: sign(1), action: "settings", on: true });
  await msg(2, "/start");
  await handleUpdate({ message: { message_id: ++nextId, chat: { id: 2, type: "private" }, from: { id: 2 }, web_app_data: { data: JSON.stringify({ k: "reg", sx: "بنين", n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "", c: 0 }) } } });
  await group(1, "/setgroup");
  const ch = (await find("chapters")).sort((a, b) => a.ord - b.ord)[0];
  const t = (await find("topics")).find((x) => x.ar === "الجذور التربيعية")!;
  await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch.id}`); await cb(2, `qt:${t.id}`); await cb(2, `ql:${t.id}:1`);
  calls.length = 0;
  await msg(2, "جد الجذور التربيعية للعدد 5-12i");
  // الطالب: وصل سؤاله، ولا كلمة عن الذكاء
  const mine = to(2).join("\n");
  assert.match(mine, /وصل سؤالك/);
  assert.doesNotMatch(mine, /الذكاء|رصيد|Anthropic/);
  // المجموعة: السؤال وملاحظة
  const q = (await find("questions")).at(-1)!;
  assert.equal(q.status, "open");
  assert.ok(to(-1001).some((x) => x.includes("🤖 الذكاء ما گدر يجاوب هذا السؤال") && x.includes("(500)")));
  assert.deepEqual((await qaFails()).map((x) => [x.qid, x.uid, x.where.includes("الجذور التربيعية")]), [[q.id, 2, true]]);
  // التنبيه لصاحب البوت، ويا زر
  calls.length = 0;
  assert.equal(await qaFailTick(), 1);
  const alert = calls.find((c) => c.p.chat_id === 1)!;
  assert.match(alert.p.text, /الذكاء ما جاوب هذول الطلاب[\s\S]*علي حسن محمد[\s\S]*#\d+/);
  assert.equal(alert.p.reply_markup.inline_keyboard[0][0].callback_data, "qr:go");
  assert.ok(!calls.some((c) => c.p.chat_id === 2));
  assert.equal(await qaFailTick(), 0);   // نفس الطالب ما يتنبه مرتين
  // الطالب ما يگدر يدوس الزر
  await cb(2, "qr:go");
  assert.equal(await one("kv", { k: "qa_retry_now" }).then((r) => Number(r?.v) || 0), 0);
  // بعده واقف: «🔁 جربهم هسه» يگول السبب
  await cb(1, "qr:go");
  calls.length = 0;
  await qaRetryTick();
  assert.ok(to(1).some((x) => x.includes("بعده الذكاء ما يشتغل") && x.includes("(500)")));
  assert.equal(to(2).length, 0);
  // رجع الذكاء
  down = false;
  await cb(1, "qr:go");
  calls.length = 0;
  const r = await qaRetryTick();
  assert.equal(r.answered, 1);
  const stu = calls.find((c) => c.p.chat_id === 2 && c.method === "sendMessage")!;
  assert.match(stu.p.text, new RegExp(`بخصوص سؤالك #${q.id}`));
  assert.match(stu.p.text, /عيوني، تفضل هذا الحل/);
  assert.deepEqual(stu.p.reply_markup.inline_keyboard[1].map((x: any) => x.callback_data), [`qf:${q.id}`]);
  assert.ok(to(-1001).some((x) => x.includes("رجع الذكاء يشتغل، وجاوب الطالب هسه")));
  assert.ok(to(1).some((x) => x.includes("✅ <b>رجع الذكاء يشتغل، وجاوب هذول الطلاب (1)")));
  assert.equal((await one("questions", { id: q.id }))!.status, "answered");
  assert.equal((await qaFails()).length, 0);
});

test("الأستاذ جاوب قبل ما يرجع الذكاء: ما ينعاد", async () => {
  down = true;
  const t = (await find("topics")).find((x) => x.ar === "الجذور التربيعية")!;
  const ch = (await find("chapters")).sort((a, b) => a.ord - b.ord)[0];
  await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch.id}`); await cb(2, `qt:${t.id}`); await cb(2, `ql:${t.id}:1`);
  await msg(2, "جد الجذور التربيعية للعدد 7-24i");
  const q = (await find("questions")).at(-1)!;
  assert.equal((await qaFails()).length, 1);
  // الأستاذ يجاوب بموضوع السؤال
  await handleUpdate({ message: { message_id: ++nextId, chat: { id: -1001, type: "supergroup", is_forum: true }, from: { id: 1 }, text: "الجواب", message_thread_id: q.thread_id, is_topic_message: true } });
  assert.equal((await one("questions", { id: q.id }))!.status, "answered");
  down = false;
  await cb(1, "qr:go");
  calls.length = 0;
  const r = await qaRetryTick();
  assert.equal(r.answered, 0);
  assert.ok(!calls.some((c) => c.p.chat_id === 2));
  assert.equal((await qaFails()).length, 0);
});

test("صاحب البوت خفّى «❓ بعدني ما فهمت»: الحل يوصل بزر «📘 افتح الحل» بس", async () => {
  down = false;
  await qa.qaAction({ initData: sign(1), action: "settings", teacherBtn: false });
  const t = (await find("topics")).find((x) => x.ar === "الجذور التربيعية")!;
  const ch = (await find("chapters")).sort((a, b) => a.ord - b.ord)[0];
  await msg(2, "❓ سؤال علمي"); await cb(2, `qc:${ch.id}`); await cb(2, `qt:${t.id}`); await cb(2, `ql:${t.id}:1`);
  calls.length = 0;
  await msg(2, "جد الجذور التربيعية للعدد 9-40i");
  const m = calls.find((c) => c.p.chat_id === 2 && /تفضل هذا الحل/.test(String(c.p.text)))!;
  assert.equal(m.p.reply_markup.inline_keyboard.length, 1);
  assert.match(m.p.reply_markup.inline_keyboard[0][0].text, /افتح الحل/);
  await qa.qaAction({ initData: sign(1), action: "settings", teacherBtn: true });
});

test("❓ السؤال من الصفحة: يختار الفصل والموضوع والمحاضرة، والسؤال ينتظر بالطابور، والجواب يوصل بإشعار بزر، و«بعدني ما فهمت» يوصله للأستاذ مرة وحدة", async () => {
  down = false;
  const { askInfo, askFromPage, askPageTick } = await import("../lib/questions.ts");
  const { homeToken } = await import("../lib/webAuth.ts");
  const info: any = await askInfo(2);
  assert.ok(info.chapters?.length, "فصوله تطلع");
  assert.ok(info.chapters[0].topics.length, "ومواضيعها");
  const t = (await find("topics")).find((x) => x.ar === "الجذور التربيعية")!;
  calls.length = 0;
  const r = await askFromPage(2, { tid: t.id, lec: 1, text: "جد الجذور التربيعية للعدد 7-24i" }, null);
  assert.deepEqual(r, { queued: true }, "ينحفظ بس، بلا «لحظة» ولا حل هسه");
  assert.equal(calls.length, 0);
  assert.equal(await askPageTick(), 1);
  const note = calls.find((c) => c.p.chat_id === 2 && /وصل جواب سؤالك/.test(String(c.p.text)))!;
  assert.ok(note, "إشعار بالجواب");
  assert.doesNotMatch(String(note.p.text), /الأستاذ|ذكاء|الملزمة/);
  const id = new URL(note.p.reply_markup.inline_keyboard[0][0].web_app.url, "https://x.test").searchParams.get("a")!;
  const v: any = await qa.answerView({ token: homeToken(2), id });
  assert.equal(v.page, true);
  const before = (await find("questions")).length;
  const s1: any = await qa.answerToTeacher({ token: homeToken(2), id });
  assert.ok(s1.sentTo > 0);
  assert.equal((await find("questions")).length, before + 1, "سؤاله بالمجموعة");
  assert.equal(((await qa.answerToTeacher({ token: homeToken(2), id })) as any).sentTo, s1.sentTo, "ما يتكرر");
  assert.ok((await askFromPage(2, { tid: 0, text: "x" }, null)).closed, "بلا موضوع ما ينبعث");
  assert.ok((await askFromPage(2, { tid: t.id, lec: 1, text: "" }, null)).closed, "بلا سؤال ما ينبعث");
  assert.equal(await askPageTick(), 0);
});
