// السؤال العلمي من «📝 الراصد»: صفحات الراصد الحقيقي (الفصل الثالث عربي) مثل ما ينقرا نصها بالسيرفر،
// وأسئلة الأستاذ من ملف Word. سؤال الطالب يلگى صفحته بالأرقام والموضوع، وما يلگى صفحة سؤال ثاني
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const R = await import("../lib/rasidQa.ts");
const F = JSON.parse(fs.readFileSync(new URL("./fixtures/rasid-ch3.json", import.meta.url), "utf8")) as { pages: string[]; toc: any[]; words: Record<string, string> };
const index = R.buildIndex(F.pages, F.toc);
const words = (s: string) => s.split(/\s+/).filter((w) => /[؀-ۿ]{3,}/.test(w));
const any = () => true;

test("صفحات الراصد: كل صفحة موضوعها ورقم سؤالها، ونص سؤالها هو بس (الأسئلة المخفية حولها ما تدخل)", () => {
  assert.deepEqual([index[1].topic, index[1].q], ["المعدلات الزمنية", "س 2"]);
  // صفحة س1 بيها نص س2 وس3 مخفي: ما يدخل
  assert.deepEqual(index[0].nums, ["0.4", "2", "3"]);
  // الأس ³ مال cm³ يبقى ويا سؤاله، مو ويا اللي گبله
  assert.deepEqual(index[1].nums, ["0.4", "10", "3", "640"]);
  assert.deepEqual(index[2].nums, ["0.5", "3", "3", "48"]);
  // فرع «2 …» من سؤال رول: الفرع نفسه بس
  assert.equal(index[34].q, "س 2");
  assert.deepEqual(index[34].nums, R.numsOf(F.words.rolle2));
});

test("سؤال الطالب نفس سؤال بالراصد: صفحته. سؤال ثاني بنفس الأرقام: ما يطابق", () => {
  assert.equal(R.rasidFind(F.words.q2, index, any, words(F.words.q2))?.page, 2);
  assert.equal(R.rasidFind(F.words.q3, index, any, words(F.words.q3))?.page, 3);
  // كتبه بطريقته (بدون «س 2»، و³ بدل ^{3})
  const typed = "متوازي مستطيلات قاعدته مربعة يزداد طول ضلعه بمعدل 0.4 cm/s ويبقى الحجم ثابت 640 cm³ جد معدل تغير الارتفاع لما يكون الارتفاع 10 cm";
  assert.equal(R.rasidFind(typed, index, any, words(typed))?.page, 2);
  // فرع: صفحة الفرع الثاني
  assert.equal(R.rasidFind(F.words.rolle2, index, any, words(F.words.rolle2))?.page, 35);
  // س27 وس34 بالثوابت نفس الأرقام بالضبط (+1 و x=3، و+c و (3,1)): ما نعرف ياهو، فما ينطي صفحة
  assert.equal(R.rasidFind(F.words.c27, index, any, words(F.words.c27)), null);
  // رقم تغير: ما يطابق
  assert.equal(R.rasidFind(F.words.q2.replace("640", "650"), index, any, words(F.words.q2)), null);
  // نفس الأرقام بس كلام ثاني تماماً: ما يطابق
  assert.equal(R.rasidFind("كرة نصف قطرها 0.4 تتمدد بمعدل 640 وحجمها 3 جد المساحة 10", index, any, ["كرة", "نصف", "قطرها", "تتمدد", "بمعدل", "وحجمها", "المساحة"]), null);
  // الموضوع اللي اختاره: إذا موضوعه بالراصد، يدور بيه بس
  assert.equal(R.rasidFind(F.words.q2, index, (t) => t.includes("رول"), words(F.words.q2)), null);
});

test("بصمة الأرقام: «س 2» ورقم الفرع ورقم الطلب «1/ معدل…» مو من السؤال", () => {
  assert.deepEqual(R.numsOf("س 2 / جد 0.4 و 640"), ["0.4", "640"]);
  assert.deepEqual(R.numsOf("2 … f(x)=9x"), ["9"]);
  assert.deepEqual(R.numsOf("نصف قطره 10 جد 1/ معدل نقصان حجمه 2/ معدل نقصان مساحته"), ["10"]);
  assert.deepEqual(R.numsOf("٦٤٠ و cm²"), ["2", "640"]);
  assert.equal(R.loose("الارتفاع"), R.loose("االرتفاع"));   // نص الـ PDF يقلب «لا»
});
