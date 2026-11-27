// 🎤 مايك السبورة: الأرقام دائماً إنگليزي، حتى لو انگالت بالكلام عربي
import { test } from "node:test";
import assert from "node:assert/strict";
import { enDigits } from "../lib/board/spokenNum.ts";

test("الأرقام بالكلام تصير أرقام إنگليزي", () => {
  assert.equal(enDigits("ستة"), "6");
  assert.equal(enDigits("ستة"), "6");
  assert.equal(enDigits("الجواب ٦"), "الجواب 6");
  assert.equal(enDigits("x تربيع زائد خمسة وعشرين"), "x تربيع زائد 25");
  assert.equal(enDigits("مية وخمسين"), "150");
  assert.equal(enDigits("ثلاثمية و ستة"), "306");
  assert.equal(enDigits("ثلاث الاف وخمسمية"), "3500");
  assert.equal(enDigits("اثنعش"), "12");
  assert.equal(enDigits("x squared plus six"), "x squared plus 6");
  assert.equal(enDigits("نقطة حرجة"), "نقطة حرجة");
  assert.equal(enDigits("وهذا هو الحل"), "وهذا هو الحل");
});
