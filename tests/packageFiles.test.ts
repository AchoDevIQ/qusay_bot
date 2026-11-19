// «⬆️ ارفع البكج كله»: كل ملف من اسمه وين ينحط، والمصادر تنعبر
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPackage } from "../lib/packageFiles.ts";

const ch2 = ["~$فصل 2 انكلش   2027.docx", "~WRL0176.tmp", "اثرائيات انكلش 2  2027 - الحل النموذجي.pdf", "اثرائيات انكلش 2  2027 - حلي.pdf", "اثرائيات انكلش 2  2027.docx", "اثرائيات انكلش 2  2027.pdf",
  "الفصل 2 انكلش   2027.docx", "الفصل 2 انكلش   2027.pdf", "جواب 2 انكلش.docx", "جواب 2 انكلش.pdf", "راصد الفصل الثاني انكلش - الحل النموذجي.pdf", "راصد الفصل الثاني انكلش - حلي.pdf",
  "وزاريات انكلش 2  2027 - الحل النموذجي.pdf", "وزاريات انكلش 2  2027 - حلي.pdf", "وزاريات انكلش 2  2027.docx", "وزاريات انكلش 2  2027.pdf"];

test("مجلد الفصل الثاني إنجليزي: كل قسم بملفاته، وWord بأنواعه، والأصلية و«جواب» تنعبر", () => {
  const p = planPackage(ch2);
  assert.deepEqual([p.chapter, p.lang, p.problems], [2, "en", []]);
  assert.deepEqual(p.pdf.map((x) => [x.section, x.file, x.sol ?? ""]), [
    ["book", "الفصل 2 انكلش   2027.pdf", ""],
    ["wz", "وزاريات انكلش 2  2027 - حلي.pdf", "وزاريات انكلش 2  2027 - الحل النموذجي.pdf"],
    ["ith", "اثرائيات انكلش 2  2027 - حلي.pdf", "اثرائيات انكلش 2  2027 - الحل النموذجي.pdf"],
    ["rasid", "راصد الفصل الثاني انكلش - حلي.pdf", "راصد الفصل الثاني انكلش - الحل النموذجي.pdf"],
  ]);
  assert.deepEqual(p.word.map((x) => x.kind).sort(), ["exams", "extra", "main"]);
  assert.ok(["وزاريات انكلش 2  2027.pdf", "جواب 2 انكلش.pdf", "~WRL0176.tmp"].every((f) => p.skipped.includes(f)));
});

test("ناقص الحل النموذجي، أو فصلين سوا: ما يرفع ويگول ليش", () => {
  assert.match(planPackage(["وزاريات انكلش 3 2027 - حلي.pdf"]).problems.join(), /ناقص ملف «الحل النموذجي»/);
  assert.match(planPackage(["الفصل 2 انكلش 2027.pdf", "الفصل 3 انكلش 2027.pdf"]).problems.join(), /أكثر من فصل/);
  const ar = planPackage(["الفصل 1 عربي 2027.pdf", "راصد الفصل الاول عربي - حلي.pdf", "راصد الفصل الاول عربي - الحل النموذجي.pdf"]);
  assert.deepEqual([ar.chapter, ar.lang, ar.pdf.length], [1, "ar", 2]);
});

test("الفصل الرابع والخامس: «ف 4 انكلش 2027» هو الكتاب، والرقم مو من 2027", () => {
  const p4 = planPackage(["ف 4 انكلش 2027 .pdf", "ف 4 انكلش 2027 .docx", "وزاريات 4 انكلش 2027 - حلي.pdf", "وزاريات 4 انكلش 2027 - الحل النموذجي.pdf", "اثرائيات 4 انكلش 2027.docx"]);
  assert.deepEqual([p4.chapter, p4.lang, p4.problems], [4, "en", []]);
  assert.deepEqual(p4.pdf.map((x) => x.section), ["book", "wz"]);
  assert.equal(planPackage(["ف انكلش 5 2027.pdf", "وزاريات انكلش 5 2027 - حلي.pdf", "وزاريات انكلش 5 2027 - الحل النموذجي.pdf"]).chapter, 5);
});
