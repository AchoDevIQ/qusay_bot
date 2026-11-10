// رد الاعتراض يوصل الطالب برسالة تليجرام، وتليجرام ما يرسم LaTeX: الرياضيات تنكتب نص عادي
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainMath } from "../lib/util.ts";

test("LaTeX يصير نص يقراه الطالب بتليجرام", () => {
  assert.equal(plainMath("المفروض $y=-\\frac{3}{2x}$"), "المفروض y=-3/(2x)");
  assert.equal(plainMath("$\\sqrt{3} \\pm 1$"), "√3 ± 1");
  assert.equal(plainMath("$x \\leq 2$ و $x \\neq 0$"), "x ≤ 2 و x ≠ 0");
  assert.ok(!plainMath("$\\frac{1}{2}$").includes("$"));
  assert.ok(!plainMath("\\left( x \\right)").includes("\\"));
});
