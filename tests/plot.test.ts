import { test } from "node:test";
import assert from "node:assert/strict";
const { parseFn, plot } = await import("../lib/board/plot.ts");

test("📈 يقرا المعادلة: الضرب المخفي، الأس، الدوال، الثوابت، والأرقام العربية", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(parseFn("y = x^2 - 4x + 3")(1), 0);
  near(parseFn("2x(x+1)")(2), 12);
  near(parseFn("-x^2")(3), -9, );
  near(parseFn("sin(pi/2)")(0), 1);
  near(parseFn("√(x)")(9), 3);
  near(parseFn("|x-5|")(2), 3);
  near(parseFn("x^(1/3)")(-8), -2);
  near(parseFn("٢س²")(3), 18);
  near(parseFn("e^x")(0), 1);
  near(parseFn("sin^2 x + cos^2 x")(0.7), 1);
  assert.throws(() => parseFn("x +"), /ناقصة/);
  assert.throws(() => parseFn("(x+1"), /قوس/);
  assert.throws(() => parseFn("foo(x)"), /ما أعرف/);
});

test("📈 الرسمة: محاور وتدريج، والمنحني ينقطع عند الخط المقارب", () => {
  const box = { x: 100, y: 100, w: 800, h: 500 };
  const p = plot("1/x", -5, 5, box);
  const curves = p.strokes.filter((s) => !s.axis);
  assert.ok(curves.length >= 2, "1/x قطعتين");
  assert.ok(p.strokes.some((s) => s.axis));
  assert.ok(p.labels.some((l) => l.t === "x") && p.labels.some((l) => l.t === "1"));
  for (const c of curves) for (let i = 1; i < c.p.length; i += 2) assert.ok(c.p[i] >= box.y - 1 && c.p[i] <= box.y + box.h + 1, "داخل المربع");
  assert.throws(() => plot("x", 5, 1, box), /أكبر/);
  assert.throws(() => plot("sqrt(x)", -5, -1, box), /ما إلها قيم/);
});
