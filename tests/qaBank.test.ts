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
const { initDb, find, insert } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
await initDb();
const tidOf = async (ar: string) => Number((await find("topics")).find((t) => t.ar === ar)?.id);
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
  // عناوين الأستاذ بأشكالها، وربطها بمواضيع البوت ولو الاسم يختلف
  assert.deepEqual(qa.lectureHead("الاساسيات (1) lecturer"), { topic: "الاساسيات", lecture: 1 });
  assert.deepEqual(qa.lectureHead("De Movier’s [ lecturer 2]"), { topic: "De Movier’s", lecture: 2 });
  assert.deepEqual(qa.lectureHead("فصل المتغيرات المحاضره 3 الثنائية (اثرائيات)"), { topic: "فصل المتغيرات", lecture: 3 });
  assert.deepEqual(qa.lectureHead("Lecture 2 الربط"), { topic: "الربط", lecture: 2 });
  assert.equal(qa.lectureHead("نعوض بالمحاضرة 2 x=3 → y=5"), null);
  const c1 = [{ id: 1, ar: "ما قبل إيجاد x و y", en: "Before Finding x and y" }, { id: 4, ar: "إيجاد قيم x و y", en: "Finding x and y" }, { id: 6, ar: "الصيغة القطبية وديموافر", en: "Polar Form and De Moivre's Theorem" }, { id: 5, ar: "الأوميگا ω", en: "Omega (Cube Roots of Unity)" }];
  assert.deepEqual(["قبل x & y", "x,y", "ديموافر", "De Movier’s", "الاوميكا", "Cubic Roots of one Integer ω", "الاساسيات"].map((t) => qa.bestTopic(t, c1)), [1, 4, 6, 6, 5, 5, null]);
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
  const a1 = await qa.qaAnswer({ text: "جد جذور 8i" }, 1, await tidOf("الجذور التربيعية"), 1, "ar");
  assert.deepEqual(a1, { source: "lecture", solution: "$x+yi=\\sqrt{8i}$" });
  assert.equal(ai.length, 1);
  assert.ok(!ai[0].body.context.includes("اوسع مجال"));   // موضوع ثاني ما يدخل
  // مو بالمحاضرة 1، موجود بالمحاضرة 2 من نفس الموضوع
  reply = (b) => (b.mode === "find" && b.context.includes("7+24i") && !b.context.includes("8i") ? { found: true, solution: "حل 7+24i" } : { found: false, solution: "" });
  ai.length = 0;
  const a2 = await qa.qaAnswer({ text: "7+24i" }, 1, await tidOf("الجذور التربيعية"), 1, "ar");
  assert.equal(a2!.source, "topic");
  assert.equal(ai.length, 2);
  // مو موجود: يحله على طريقته، والسياق موضوعه بس
  reply = (b) => (b.mode === "solve" ? { found: true, solution: "حل جديد" } : { found: false, solution: "" });
  ai.length = 0;
  const a3 = await qa.qaAnswer({ text: "جد جذور 3-4i" }, 1, await tidOf("الجذور التربيعية"), 1, "ar");
  assert.equal(a3!.source, "ai");
  assert.equal(ai.at(-1)!.body.mode, "solve");
  assert.ok(!ai.at(-1)!.body.context.includes("اوسع مجال"));
  // طالب المنهج الإنگليزي: ماكو ملزمة إنگليزية، فتنقرا العربية والحل ينطلب بالإنگليزي، والصفحة تعرف لغته
  ai.length = 0;
  const en = await qa.qaAnswer({ text: "roots of 3-4i" }, 1, await tidOf("الجذور التربيعية"), 1, "en");
  assert.equal(en!.source, "ai");
  assert.ok(ai.every((x) => x.body.lang === "en"));
  const enId = await qa.saveAnswer(70, "roots", en!, "Square roots — Lecture 1", "en");
  assert.equal(((await qa.answerView({ token: homeToken(70), id: enId })) as any).lang, "en");
  // موضوع ما بالملزمة: يرجع null والسؤال يروح للأستاذ
  assert.equal(await qa.qaAnswer({ text: "x" }, 1, await tidOf("أشكال آرگاند"), 1, "ar"), null);
  // الحل يفتح لصاحبه بس
  const id = await qa.saveAnswer(70, "جد جذور 8i", a1!, "الجذور التربيعية — المحاضرة 1");
  const v: any = await qa.answerView({ token: homeToken(70), id });
  assert.equal(v.solution, "$x+yi=\\sqrt{8i}$");
  await assert.rejects(qa.answerView({ token: homeToken(71), id }), (e: any) => e.status === 404);
  const page: any = await qa.qaAction({ initData: sign(1), action: "list" });
  assert.equal(page.qa.asked, 4);   // الموضوع اللي ما بالملزمة ما ينحسب
  assert.equal(page.qa.fromBook, 2);
  assert.equal(page.qa.solved, 2);
  assert.ok(page.qa.cost > 0);
});

test("أسئلة الامتحانات: تنقرا مرة وحدة كتابة ويا موضوعها، والطالب يلگى سؤاله بيها", async () => {
  fs.mkdirSync(path.join(tmp, "ex"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "ex", "q1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
  const e = await insert("bank_exams", { slug: "ch1", chapter: "الفصل الأول", ord: 50, title: "الجذور التربيعية", minutes: 60, pos: 50 });
  const v = await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
  const qid = await insert("bank_questions", { version_id: v, n: 1, max_mark: 10, q_file: "ex/q1.jpg", a_files: "[]" });
  const { saveRubric } = await import("../lib/aiGrade.ts");
  await saveRubric(qid, [{ text: "x^2-y^2=5", points: 5 }, { text: "x=3", points: 5 }], 1);
  reply = (b) => b.question_images ? { question: "جد الجذور التربيعية للعدد 5-12i", solution: "$x^{2}-y^{2}=5$" }
    : b.mode === "find" && b.context.includes("5-12i") ? { found: true, solution: "حل الامتحان" } : { found: false, solution: "" };
  const r: any = await qa.qaAction({ initData: sign(1), action: "exams" });
  assert.match(r.notice, /انحطت 1 سؤال/);
  ai.length = 0;
  assert.deepEqual(await qa.examQueueTick(), { done: 1, failed: 0, left: 0 });
  // الحل راح من خطوات التصحيح المحفوظة، مو صورة
  assert.equal(ai[0].route, "/bot/extract");
  assert.match(ai[0].body.solution_text, /x\^2-y\^2=5/);
  const tid = await tidOf("الجذور التربيعية");
  assert.equal((await qa.examQas(tid)).length, 1);
  // ما بالمحاضرة، بس جاي بالامتحان: يلگاه بالبحث بالموضوع
  const a = await qa.qaAnswer({ text: "جذور 5-12i" }, 1, tid, 1, "ar");
  assert.deepEqual(a, { source: "topic", solution: "حل الامتحان" });
  // مرة ثانية ما يعيد قراءته
  assert.match(((await qa.qaAction({ initData: sign(1), action: "exams" })) as any).notice, /كل أسئلة الامتحانات انقرت/);
  assert.equal(((await qa.qaAction({ initData: sign(1), action: "list" })) as any).exams.done, 1);
});
