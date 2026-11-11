// «املأ الفراغات» بالشروط والقسم: الفراغات متوزعة، والكلمة الصحيحة بين الاختيارات، وعلامات الترقيم برا الفراغ
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCount, makeBlanks, type Blank } from "../lib/fillBlanks.ts";

const seeded = (s: number) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
const LONG = "يغلق الكود بعد نهايه الدور الاول مهما كان السبب، يعني بعدين مو دكول ليش سديتو الكود، لان نخاف الله نكلك من هسه حتى إذا ماعجبك ماسجل";

test("الفراغات: عددها حسب طول الجملة، والجملة ترجع نفسها إذا انملت", () => {
  assert.equal(blankCount(3), 0);
  assert.equal(blankCount(8), 2);
  assert.equal(blankCount(60), 5);
  for (let s = 1; s < 30; s++) {
    const parts = makeBlanks(LONG, seeded(s));
    const blanks = parts.filter((p): p is Blank => typeof p !== "string");
    assert.equal(blanks.length, blankCount(LONG.split(/\s+/).length));
    // نفس الجملة بالضبط إذا انحطت الكلمات الصحيحة
    assert.equal(parts.map((p) => (typeof p === "string" ? p : p.pre + p.answer + p.post)).join(""), LONG);
    for (const b of blanks) {
      assert.equal(b.options.length, 3);
      assert.equal(new Set(b.options).size, 3);
      assert.ok(b.options.includes(b.answer));
      assert.ok(!/[،,.]/.test(b.answer));        // الفارزة برا الفراغ
      assert.ok(!/\d/.test(b.answer) && b.answer.length >= 3);
    }
    // ما تتكرر كلمة «الكود» (مكررة بالجملة فما تصير فراغ)
    assert.ok(!blanks.some((b) => b.answer === "الكود"));
  }
});

test("جملة قصيرة: بلا فراغات، وجملة متوسطة فراغين بمكانين مختلفين", () => {
  assert.equal(makeBlanks("أوافق على الشروط").filter((p) => typeof p !== "string").length, 0);
  const parts = makeBlanks("جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان", seeded(7));
  const blanks = parts.filter((p): p is Blank => typeof p !== "string");
  assert.equal(blanks.length, 2);
  assert.notEqual(blanks[0].i, blanks[1].i);
});
