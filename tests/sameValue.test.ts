// 🔢 نفس القيمة بشكل ثاني: الكود يرجّع الخطوة اللي انخصمت على الشكل بس (طلب الأستاذ 2026-11-25)
import { test } from "node:test";
import assert from "node:assert/strict";

const { evalNum, valuesOf, sameValueOtherForm, restoreSameValues } = await import("../lib/sameValue.ts");

test("🔢 الحساب: كسور، جذور، π، وضرب بلا علامة", () => {
  assert.equal(evalNum("((6)/(4))"), 1.5);
  assert.ok(Math.abs(evalNum("2pi")! - 2 * Math.PI) < 1e-9);
  assert.ok(Math.abs(evalNum("3sqrt(2)")! - 3 * Math.SQRT2) < 1e-9);
  assert.equal(evalNum("x+1"), null);
  assert.deepEqual(valuesOf(String.raw`$(\pm1,\frac{3}{2})$`), [1, -1, 1.5]);
});

test("🔢 «6/4» بدل «3/2» يرجع كامل، والقيمة الغلط أو نفس الكتابة ما تنلمس", () => {
  assert.ok(sameValueOtherForm(String.raw`f'(x)=0 ; $(\pm1,\frac{3}{2})$`, String.raw`$(\pm 1,\frac{6}{4})$`));
  assert.ok(sameValueOtherForm(String.raw`$x=\frac{\pi}{2}$`, "x = 0.5π"));
  assert.ok(sameValueOtherForm(String.raw`$y=-\frac{1}{\sqrt{2}}$`, String.raw`$y=-\frac{\sqrt{2}}{2}$`));
  assert.ok(!sameValueOtherForm(String.raw`$(\pm1,\frac{3}{2})$`, String.raw`$(\pm1,\frac{5}{2})$`), "قيمة غلط");
  assert.ok(!sameValueOtherForm(String.raw`$x=\frac{3}{2}$`, String.raw`$x=\frac{3}{2}$`), "نفس الكتابة: الخصم على شي ثاني");
  assert.ok(!sameValueOtherForm("x=2 , y=3", "x=3 , y=2"), "القيم بغير ترتيب");
  assert.ok(!sameValueOtherForm("symmetric about the origin", "متناظرة حول نقطة الأصل"), "ماكو أرقام");
  const steps = [{ text: String.raw`$(\pm1,\frac{3}{2})$`, points: 2, awarded: 1, note: "المفروض 3/2", w: String.raw`$(\pm1,\frac{6}{4})$` }, { text: "$x=2$", points: 1, awarded: 0, note: "غلط", w: "$x=3$" }];
  assert.equal(restoreSameValues(steps), 1);
  assert.deepEqual([steps[0].awarded, steps[0].note, steps[1].awarded], [2, "", 0]);
});
