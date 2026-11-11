// «📄 أسئلة من الوورد»: الملف يتقسم لنسخ، يطابق نسخ البنك (العربي عن طريق توأمه الإنجليزي)، والمطابق بس ينحفظ،
// والسؤال المحفوظ يطلع مكتوب لطالب «✏️ اكتب بالقلم» بلغة منهجه
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-word-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { docxLines } = await import("../lib/docxText.ts");
const { splitExamDoc, alignBlocks, sameMath } = await import("../lib/wordQuestions.ts");
const { examUpload } = await import("../lib/examApi.ts");
const { initDb, find, insert, one } = await import("../lib/db.ts");
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
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
// معادلة بيها «+6»: لازم تبقى إشارة +
const eq = (a: string, b: string) => `<w:p><w:r><w:t xml:space="preserve">جد </w:t></w:r><m:oMath><m:r><m:t>${a}</m:t></m:r><m:r><m:t>+6</m:t></m:r><m:r><m:t>=${b}</m:t></m:r></m:oMath></w:p>`;
const eqEn = (a: string, b: string) => `<w:p><w:r><w:t xml:space="preserve">Find </w:t></w:r><m:oMath><m:r><m:t>${a}</m:t></m:r><m:r><m:t>+6</m:t></m:r><m:r><m:t>=${b}</m:t></m:r></m:oMath></w:p>`;
const body = (x: string) => docx(`<w:document ${W}><w:body>${x}</w:body></w:document>`);
// امتحانين: الأول نسختين (A, B) بسؤالين، الثاني نسخة وحدة بثلاث أسئلة
const AR = body(p("امتحان أول · نموذج A") + p("س 1 / ") + eq("x", "11") + p("س 2 / جد 31 و 47") +
  p("امتحان أول · نموذج B") + p("س 1 / ") + eq("y", "13") + p("س 2 / جد 37 و 53") +
  p("س 1 / جد 71") + p("س 2 / جد 73") + p("س 2 / جد 79"));            // ترقيم غلط بالعربي: س2 مرتين
const EN = body(p("First exam · Model A") + p("Q 1 / ") + eqEn("x", "11") + p("Q 2 / find 31 and 47") +
  p("First exam · Model B") + p("Q 1 / ") + eqEn("y", "13") + p("Q 2 / find 37 and 53") +
  p("Q 1 / find 71") + p("Q 2 / find 73") + p("Q 3 / find 79"));

test("الوورد: «+6» تبقى إشارتها، والملف يتقسم لنسخ بحرفها، والتشابه بأرقام المعادلات", () => {
  const lines = docxLines(AR);
  assert.ok(lines.some((l) => l.includes("x+6=11")), JSON.stringify(lines));
  const b = splitExamDoc(lines);
  assert.deepEqual(b.map((x) => [x.model, x.qs.length, x.odd]), [["A", 2, false], ["B", 2, false], [null, 3, true]]);
  assert.match(b[0].qs[0].text, /\$x\+6=11\$/);
  const e = splitExamDoc(docxLines(EN));
  assert.ok(sameMath(b[0].qs.map((q) => q.text).join(" "), e[0].qs.map((q) => q.text).join(" ")) > 0.8);
  assert.ok(sameMath(b[0].qs.map((q) => q.text).join(" "), e[1].qs.map((q) => q.text).join(" ")) < 0.3);
  // نسخة ناقصة بالملف ما تزحلق اللي بعدها: حرف النسخة يثبتها
  assert.deepEqual(alignBlocks([{ n: 2, model: "A" }, { n: 2, model: "B" }, { n: 2, model: "C" }], [{ n: 2, model: "A" }, { n: 2, model: "C" }]), [0, -1, 1]);
});

test("📄 أسئلة من الوورد: المطابقة قبل الحفظ، والمطابق بس ينحفظ، والعربي الغلط يطلع بالتقرير", async () => {
  const e1 = await insert("bank_exams", { slug: "w1", chapter: "فصل الوورد", ord: 1, pos: 1, title: "امتحان أول", info: "", minutes: 60 });
  const e2 = await insert("bank_exams", { slug: "w1", chapter: "فصل الوورد", ord: 2, pos: 2, title: "امتحان ثاني", info: "", minutes: 60 });
  const va = await insert("bank_versions", { exam_id: e1, model: "A", kind: "mandatory", ok: 1 });
  const vb = await insert("bank_versions", { exam_id: e1, model: "B", kind: "optional", ok: 1 });
  const vc = await insert("bank_versions", { exam_id: e2, model: "A", kind: "mandatory", ok: 1 });
  for (const [v, n] of [[va, 2], [vb, 2], [vc, 3]]) for (let k = 1; k <= n; k++) await insert("bank_questions", { version_id: v, n: k, max_mark: 10, q_file: `q${v}_${k}.png`, a_files: "[]" });
  const form = (action: string) => { const f = new FormData(); f.set("initData", sign(1)); f.set("action", action); f.set("chapter", "فصل الوورد"); f.set("ar", new Blob([AR])); f.set("en", new Blob([EN])); return f; };
  const pre: any = await examUpload(form("wordPreview"));
  assert.deepEqual(pre.word.rows.map((r: any) => [r.title, r.model, r.ar.ok, r.en.ok]), [["امتحان أول", "A", true, true], ["امتحان أول", "B", true, true], ["امتحان ثاني", "A", false, true]]);
  assert.deepEqual(pre.word.rows[2].ar.got, [1, 2, 2]);
  assert.equal((await one("bank_questions", { version_id: va, n: 1 }))!.q_text ?? null, null);   // المعاينة ما تحفظ
  const saved: any = await examUpload(form("wordSave"));
  assert.deepEqual(saved.word.saved, { ar: 2, en: 3 });
  assert.match(String((await one("bank_questions", { version_id: va, n: 1 }))!.q_text), /\$x\+6=11\$/);
  assert.match(String((await one("bank_questions", { version_id: vb, n: 2 }))!.q_text_en), /find 37 and 53/);
  assert.equal((await one("bank_questions", { version_id: vc, n: 1 }))!.q_text ?? null, null);   // العربي الغلط ما ينحفظ
  assert.match(String((await one("bank_questions", { version_id: vc, n: 3 }))!.q_text_en), /find 79/);
  // ملف مو Word مرفوض
  const bad = new FormData(); bad.set("initData", sign(1)); bad.set("action", "wordPreview"); bad.set("chapter", "فصل الوورد"); bad.set("ar", new Blob([Buffer.from("hello")]));
  await assert.rejects(examUpload(bad), /docx/);
  assert.ok((await find("bank_questions")).length >= 7);
});

test("أشكال رقم السؤال بالوورد: «س /3» و«س1*/» و«س $4*$» و«… / س 4» بآخر السطر و«$$ س 1»", () => {
  const lines = ["نموذج A · امتحان", "$$ س 1 / جد 11", "س /2 جد 12", "س3*/ جد 13", "س $4*$ جد 14", "$x+1=5$ جد / س 5", "س ٦ / جد 16"];
  const b = splitExamDoc(lines);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].qs.map((q) => q.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(b[0].odd, false);
  assert.equal(b[0].qs[2].text, "جد 13");
  assert.equal(b[0].qs[4].text, "$x+1=5$ جد");
});

test("ترقيم «1/ 2/ 3/» بلا س أو Q: ينقبل بعد العنوان، وفروع «1/ 2/» تحت سؤال تبقى منه", () => {
  const b = splitExamDoc([
    "الامتحان {8} الساين والكوساين A {1 & 2 } 1:15", "1/ جد 10", "2/ جد 11", "س3 / جد 12", "4/ جد 13",
    "الامتحان {4} ln &e B 1:15", "1/ جد 20", "2/ جد 21", "جد y`", "1/ y=5", "2/ y=6",
    "س 1 / جد 30", "1 / فرع", "2 / فرع",
  ]);
  assert.equal(b.length, 3);
  assert.deepEqual(b[0].qs.map((q) => q.n), [1, 2, 3, 4]);
  assert.equal(b[0].qs[0].text, "جد 10");
  assert.deepEqual(b[1].qs.map((q) => q.n), [1, 2]);
  assert.equal(b[1].qs[1].text, "جد 21\nجد y`\n1/ y=5\n2/ y=6");
  // نسخة بلا عنوان أسئلتها بـ«س»: «1 /» فروع، مو أسئلة
  assert.deepEqual(b[2].qs.map((q) => q.n), [1]);
});

test("بالوورد أسئلة أكثر من البوت بكل النسخ: يطلع زر يخليه مثل الوورد، وما يتغير شي إذا الصورة ما انرسمت أو أحد امتحن", async () => {
  const e = await insert("bank_exams", { slug: "g1", chapter: "فصل النمو", ord: 1, pos: 1, title: "Ln&E", info: "", minutes: 60 });
  const vs = [await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 }), await insert("bank_versions", { exam_id: e, model: "B", kind: "mandatory", ok: 1 })];
  for (const v of vs) for (let k = 1; k <= 2; k++) await insert("bank_questions", { version_id: v, n: k, max_mark: 50, q_file: `g${v}_${k}.png`, a_files: "[]" });
  const en = body(["Exam {4} · ln & e · Model A Time: 1:15", "1/ find 11", "2/ find 12", "find y`", "3/ y=13",
    "Exam {4} · ln & e · Model B Time: 1:15", "1/ find 21", "2/ find 22", "find y`", "3/ y=23 4/ x"].map(p).join(""));
  const form = (action: string) => { const f = new FormData(); f.set("initData", sign(1)); f.set("action", action); f.set("chapter", "فصل النمو"); f.set("en", new Blob([en])); f.set("grow", String(e)); return f; };
  const pre: any = await examUpload(form("wordPreview"));
  assert.deepEqual(pre.word.grow, [{ exam: e, title: "Ln&E", from: 2, to: 3, marks: [34, 33, 33] }]);
  // بالاختبار ماكو متصفح يرسم الصورة: يرفض وما يتغير شي
  await assert.rejects(examUpload(form("wordGrow")), /أرسم/);
  assert.equal((await find("bank_questions", { version_id: vs[0] })).length, 2);
  // أحد بدأ الامتحان: يرفض
  await insert("sched_items", { user_id: 5, exam_id: e, status: "done", started_at: "2026-11-01 10:00" });
  await assert.rejects(examUpload(form("wordGrow")), /امتحنوا/);
});

test("الرقم بنص السطر بالعربي «… sinx 10/ اذا علمت ان» ينقبل إذا هو اللي بعده بالتسلسل", () => {
  const b = splitExamDoc(["الامتحان {4} ln &e D 1:15", "1/ جد 1", "2/ جد 2", "$y'=cotx$ اثبت ان , e^{y}=sinx 3/ اذا علمت ان", "عدد 7/ مو سؤال"]);
  assert.deepEqual(b[0].qs.map((q) => q.n), [1, 2, 3]);
  assert.equal(b[0].qs[2].text, "$y'=cotx$ اثبت ان , e^{y}=sinx اذا علمت ان\nعدد 7/ مو سؤال");
});

test("بالترقيم «1/ 2/»: «جد y`» بين سؤالين يروح للسؤال اللي بعده", () => {
  const b = splitExamDoc(["الامتحان {4} ln &e A 1:15", "1/ جد 1", "7/ $x=16$ جد a", "جد y`", "8/ $y=25$"].map((l, i) => (i === 2 ? "2/ $x=16$ جد a" : i === 4 ? "3/ $y=25$" : l)));
  assert.deepEqual(b[0].qs.map((q) => q.text), ["جد 1", "$x=16$ جد a", "جد y`\n$y=25$"]);
});
