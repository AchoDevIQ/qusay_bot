// 📄 حل السؤال العلمي كملف PDF بهيدر (طلب الأستاذ 2026-11-24): العربي كحلي وذهبي، والإنگليزي رصاصي وبرتقالي،
// واسمه «قصي العميري» بلا «أستاذ»، والسؤال المشابه بمربعه، والكلام العربي داخل معادلات الـ Word ينكتب صح
import { test } from "node:test";
import assert from "node:assert/strict";

const { answerHtml } = await import("../lib/documents.ts");
const { fixWordLine } = await import("../lib/wordLine.ts");
const tex = (t: string) => `<i>${t}</i>`;

test("📄 ملف الحل: هيدر بلون للعربي ولون للإنگليزي، اسمه بلا «أستاذ»، والسؤال المشابه قبل حل سؤاله", () => {
  const base = { name: "علي حسن", where: "القطع الناقص — المحاضرة 9", question: "جد معادلة ال ق.ن", solution: "$A=24\\pi مربعة وحدة$\nالقطع صادي", date: "2026-11-24" };
  const ar = answerHtml({ ...base, lang: "ar", similar: { text: "سؤال الملزمة\n$x=1$", where: "الملزمة" } }, "", "", tex, fixWordLine);
  assert.match(ar, /#1f2a44/);
  assert.match(ar, /#e0b23a/);
  assert.match(ar, /قصي العميري/);
  assert.doesNotMatch(ar, /أستاذ/);
  assert.ok(ar.indexOf("📗 سؤال مشابه من الملزمة") < ar.indexOf("📘 حل سؤالك"), "المشابه أول");
  assert.match(ar, /\\text\{وحدة مربعة\}/, "الكلام العربي بالمعادلة بترتيبه");
  assert.match(ar, /dir=rtl/);
  const en = answerHtml({ ...base, lang: "en" }, "", "", tex, fixWordLine);
  assert.match(en, /#2b2b2b/);
  assert.match(en, /#e67e22/);
  assert.match(en, /dir=ltr/);
  assert.match(en, /📘 The solution/);
  assert.doesNotMatch(en, /سؤال مشابه|similar question/i);
});

test("سطر الـ Word: «اما 2a» داخل المعادلة ينكتب \\text، والكلمات المعكوسة ترجع، والكلام ورا المعادلة هم", () => {
  assert.equal(fixWordLine("$\\begin{matrix}اما 2a \\\\ او 2b\\end{matrix}=8$"), "$\\begin{matrix}\\text{اما} 2a \\\\ \\text{او} 2b\\end{matrix}=8$");
  assert.equal(fixWordLine("$p=2\\pi الناقص القطع محيط$"), "$p=2\\pi \\text{محيط القطع الناقص}$");
  assert.equal(fixWordLine("$2c=4\\sqrt{5} وحدة$ البؤرتين بين المسافة"), "$2c=4\\sqrt{5} \\text{وحدة}$ المسافة بين البؤرتين");
  assert.equal(fixWordLine("عبارة يقطع جزءا طوله 8"), "عبارة يقطع جزءا طوله 8", "السطر العربي ما يتغير");
});
