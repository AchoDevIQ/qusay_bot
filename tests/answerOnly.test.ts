// استثناء «أجب عن K أسئلة»: المجموع، الترك، والدرجة الكاملة
import { test } from "node:test";
import assert from "node:assert/strict";
import { SKIP, countedQs, fullMarks, missingQs, paperTotal } from "../lib/answerOnly.ts";

test("أجب عن K: أول K جاوبهن بالترتيب، والترك ما ينحسب، والكل إذا ماكو استثناء", () => {
  const qs = [{ n: 1, mark: 10 }, { n: 2, mark: SKIP }, { n: 3, mark: 20 }, { n: 4, mark: 30 }];
  assert.equal(paperTotal(qs, 2), 30);
  assert.deepEqual([...countedQs(qs, 2)], [1, 3]);
  assert.equal(paperTotal([{ n: 1, mark: 10 }, { n: 2, mark: 20 }], 0), 30);
  // ما بي جواب ودرجته 0: ترك. بي درجة: تنحسب حتى لو ما بي صورة
  assert.equal(paperTotal([{ n: 1, mark: 0, answered: false }, { n: 2, mark: 15, answered: true }, { n: 3, mark: 5, answered: false }], 2), 20);
  assert.deepEqual(missingQs([{ n: 1, mark: null, answered: false }, { n: 2, mark: null, answered: true }], 1), [2]);
  assert.deepEqual(missingQs([{ n: 1, mark: null, answered: false }], 0), [1]);
});

test("الدرجة الكاملة: مجموع الكل، وبالاستثناء مجموع أكبر K", () => {
  assert.equal(fullMarks([20, 20, 20, 20, 20, 20], 5), 100);
  assert.equal(fullMarks([40, 60], 0), 100);
  assert.equal(fullMarks([20, 20, 20, 20, 20, 20], 0), 120);
});
