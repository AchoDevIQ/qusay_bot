// الأسئلة العلمية من ملازم Word: قراءة الملف بمعادلاته، التقسيم على المحاضرات، والبحث بالمحاضرة ثم الموضوع ثم الحل على طريقة الأستاذ
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-qa-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"), GRADING_AI_URL: "https://ai.test/", GRADING_AI_KEY: "k" });
delete process.env.FIREBASE_STORAGE_BUCKET;
const ai: { route: string; body: any }[] = [];
let reply: (body: any) => any = () => ({ found: false, solution: "" });
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.startsWith("https://ai.test")) { const body = JSON.parse(init.body); ai.push({ route: u.slice(15), body }); return Response.json({ ...reply(body), usage: [{ model: "claude-haiku-5-5", calls: 1, input: 1000, output: 200 }] }); }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { docxLines } = await import("../lib/docxText.ts");
const qa = await import("../lib/qaBank.ts");
const { initDb } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};

/** ملف Word صغير (zip بدون ضغط) بيه نص ومعادلة */
function docx(xml: string) {
  const name = Buffer.from("word/document.xml"), data = Buffer.from(xml, "utf8");
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(crc(data), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, cen, name, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const frac = `<w:p><m:oMath><m:r><m:t>y=</m:t></m:r><m:f><m:num><m:r><m:t>4</m:t></m:r></m:num><m:den><m:r><m:t>x</m:t></m:r></m:den></m:f></m:oMath></w:p>`;
const sup = `<w:p><w:r><w:t>x</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t> = 4</w:t></w:r></w:p>`;
const BOOK = docx(`<w:document ${W}><w:body>${p("مقدمة")}${p("الجذور التربيعية المحاضرة 1")}${p("جد الجذور التربيعية للعدد 8i")}${frac}${sup}${p("الجذور التربيعية المحاضرة 2")}${p("جد الجذور التربيعية للعدد 7+24i")}${p("رسم الدوال المحاضرة 1")}${p("اوسع مجال")}</w:body></w:document>`);

test("Word: المعادلات تصير LaTeX، والأس المرفوع ^{}، والملزمة تتقسم على المحاضرات", () => {
  const lines = docxLines(BOOK);
  assert.ok(lines.includes("$y=\\frac{4}{x}$"));
  assert.ok(lines.includes("x^{2} = 4"));
  const lec = qa.splitLectures(lines);
  assert.deepEqual(lec.map((l) => [l.topic, l.lecture]), [["الجذور التربيعية", 1], ["الجذور التربيعية", 2], ["رسم الدوال", 1]]);
  assert.ok(!lec.some((l) => l.text.includes("مقدمة")));
  assert.ok(qa.sameTopic("القطع الناقص والزائد", "القطع الناقص و الزائد"));
  assert.ok(qa.sameTopic("الجذور التربيعيه", "الجذور التربيعية"));
  assert.ok(!qa.sameTopic("رسم الدوال", "الجذور التربيعية"));
});

test("رفع الملزمة لصاحب البوت بس، والبحث: المحاضرة، ثم الموضوع بس، ثم الحل على طريقة الأستاذ", async () => {
  const up = (uid: number) => { const f = new FormData(); f.set("initData", sign(uid)); f.set("action", "upload"); f.set("chapter", "1"); f.set("lang", "ar"); f.set("kind", "main"); f.set("file", new File([BOOK], "ch1.docx")); return qa.qaAction(f); };
  await assert.rejects(up(5), (e: any) => e.status === 403);
  const r: any = await up(1);
  assert.match(r.notice, /2 موضوع، 3 محاضرة/);
  assert.equal(await qa.qaReady(1), false);   // طافي من البداية
  await qa.qaAction({ initData: sign(1), action: "settings", on: true });
  assert.equal(await qa.qaReady(1), true);
  // موجود بالمحاضرة اللي اختارها
  reply = (b) => (b.mode === "find" && b.context.includes("8i") ? { found: true, solution: "$x+yi=\\sqrt{8i}$" } : { found: false, solution: "" });
  ai.length = 0;
  const a1 = await qa.qaAnswer({ text: "جد جذور 8i" }, 1, "الجذور التربيعية", 1, "ar");
  assert.deepEqual(a1, { source: "lecture", solution: "$x+yi=\\sqrt{8i}$" });
  assert.equal(ai.length, 1);
  assert.ok(!ai[0].body.context.includes("اوسع مجال"));   // موضوع ثاني ما يدخل
  // مو بالمحاضرة 1، موجود بالمحاضرة 2 من نفس الموضوع
  reply = (b) => (b.mode === "find" && b.context.includes("7+24i") && !b.context.includes("8i") ? { found: true, solution: "حل 7+24i" } : { found: false, solution: "" });
  ai.length = 0;
  const a2 = await qa.qaAnswer({ text: "7+24i" }, 1, "الجذور التربيعية", 1, "ar");
  assert.equal(a2!.source, "topic");
  assert.equal(ai.length, 2);
  // مو موجود: يحله على طريقته، والسياق موضوعه بس
  reply = (b) => (b.mode === "solve" ? { found: true, solution: "حل جديد" } : { found: false, solution: "" });
  ai.length = 0;
  const a3 = await qa.qaAnswer({ text: "جد جذور 3-4i" }, 1, "الجذور التربيعية", 1, "ar");
  assert.equal(a3!.source, "ai");
  assert.equal(ai.at(-1)!.body.mode, "solve");
  assert.ok(!ai.at(-1)!.body.context.includes("اوسع مجال"));
  // موضوع ما بالملزمة: يرجع null والسؤال يروح للأستاذ
  assert.equal(await qa.qaAnswer({ text: "x" }, 1, "ديموافر", 1, "ar"), null);
  // الحل يفتح لصاحبه بس
  const id = await qa.saveAnswer(70, "جد جذور 8i", a1!, "الجذور التربيعية — المحاضرة 1");
  const v: any = await qa.answerView({ token: homeToken(70), id });
  assert.equal(v.solution, "$x+yi=\\sqrt{8i}$");
  await assert.rejects(qa.answerView({ token: homeToken(71), id }), (e: any) => e.status === 404);
  const page: any = await qa.qaAction({ initData: sign(1), action: "list" });
  assert.equal(page.qa.asked, 3);   // الموضوع اللي ما بالملزمة ما ينحسب
  assert.equal(page.qa.fromBook, 2);
  assert.equal(page.qa.solved, 1);
  assert.ok(page.qa.cost > 0);
});
