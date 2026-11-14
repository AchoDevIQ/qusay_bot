// رياضيات صفحة التصحيح: سطر الطالب ما يطلع مصدر أحمر لو الذكاء كتبه بـ $ أو \frac(a)(b)
import { test } from "node:test";
import assert from "node:assert/strict";
import { braceArgs, mathHtml, renderTex, stripDelimiters, toTex } from "../app/store/myexams/mathTex.ts";

// السطور نفسها اللي طلعت حمرة بصفحة الطالب
const BROKEN = [
  "$3+4ω^(2)(2+3ω^(2))(2+3ω)(3+4ω)$",
  "$3+\\frac(4)(ω)(2+3ω^(2))(2+\\frac(3)(ω^(2)))$",
  "$42+29ω^(2)+29ω$",
];

test("سطر الطالب بـ $ أو بأقواس بدل الأقواس المعقوفة ينرسم رياضيات", () => {
  for (const line of BROKEN) {
    const html = renderTex(line);
    assert.ok(html, line);
    assert.ok(!html!.includes("katex-error"), line);
  }
});

test("الأقواس تصير أقواس LaTeX", () => {
  assert.equal(braceArgs("\\frac(4)(ω)"), "\\frac{4}{ω}");
  assert.equal(braceArgs("x^(2)+x_(1)"), "x^{2}+x_{1}");
  assert.equal(braceArgs("\\frac(1)(x^(2))"), "\\frac{1}{x^{2}}");
  assert.equal(stripDelimiters("$x$ = \\(y\\)"), "x = y");
  assert.equal(toTex("3/(2x)"), "\\frac{3}{2x}");
});

test("اللي ما ينقرا ينكتب نص عادي محمي، مو مصدر أحمر ولا HTML", () => {
  const html = mathHtml("\\frac{1}{2");
  assert.ok(!html.includes("katex-error"));
  assert.ok(html.startsWith('<span class="aiplain">'));
  const evil = mathHtml("\\unknowncmd <img src=x onerror=alert(1)>");
  assert.ok(!evil.includes("<img"), evil);
});

test("الكتابة الصحيحة تبقى مثل ما هي", () => {
  assert.ok(renderTex("x^{2}-y^{2}=4"));
  assert.ok(renderTex("y=\\frac{-3}{x}"));
});

test("خطوة ما تنرسم تطلع رسالة «أرسل صورة ثانية» بدل كتابة ما تنقرا", async () => {
  const { canRender } = await import("../app/store/myexams/mathTex.ts");
  assert.equal(canRender("x^{2}=4 ; x=\\pm 2"), true);
  assert.equal(canRender("$3+4ω^(2)$"), true);          // ينصلح وينرسم
  assert.equal(canRender("x = 2 يهمل"), true);          // سطر عربي ينكتب نص
  assert.equal(canRender("\\frac{1}{2"), false);        // ما ينرسم: الصفحة تطلع الرسالة
});

test("الكلام الإنجليزي بالرياضيات ما يلتصق: «square root both sides» تبقى بمسافاتها، والدوال والحروف تبقى رياضيات", async () => {
  const { toTex, renderTex, wordsAsText } = await import("../app/store/myexams/mathTex.ts");
  assert.equal(toTex("square root both sides"), String.raw`\text{ square root both sides }`);
  assert.match(toTex("x^2 = 4 => square root both sides"), /\\text\{ square root both sides \}/);
  // KaTeX يكتب المسافات بداخل \text مسافات ثابتة (nbsp): الكلمات مفصولة على الشاشة
  assert.ok(renderTex("x^2 = 4 => square root both sides")!.replace(/<[^>]+>/g, "").replace(/ /g, " ").includes("square root both sides"));
  assert.equal(wordsAsText("sin x + cos x = 1"), "sin x + cos x = 1");
  assert.equal(wordsAsText("dx + xy + abc = 0"), "dx + xy + abc = 0");
  assert.equal(wordsAsText(String.raw`\sqrt{x} \Rightarrow \frac{1}{2}`), String.raw`\sqrt{x} \Rightarrow \frac{1}{2}`);
  assert.equal(wordsAsText(String.raw`\text{area} = 4`), String.raw`\text{area} = 4`);
  assert.equal(wordsAsText("area = 36"), String.raw`\text{ area } = 36`);
});
