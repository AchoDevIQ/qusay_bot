// صفحات جنب بعض: وين ينحط التبويب لمن تسحبه، وكم صفحة تنعرض سوا
import { test } from "node:test";
import assert from "node:assert/strict";
import { closePane, frameZoom, isStacked, maxPanes, placePane, showTab, slotAt, slotCount, togglePane } from "../app/store/multi/panes.ts";

test("الموبايل صفحتين فوك بعض، والحاسبة جنب بعض حتى لو نافذتها صغيرة", () => {
  assert.equal(isStacked(390, true), true);
  assert.equal(isStacked(390, false), false);
  assert.equal(isStacked(1024, true), false);
  assert.equal(maxPanes(390, true), 2);
  assert.equal(maxPanes(390, false), 2);
  assert.equal(maxPanes(1000, false), 3);
  assert.equal(maxPanes(2500, false), 4);
});

test("الصفحة الضيقة تتصغر حتى تدخل كلها، والعريضة تبقى مثل ما هي", () => {
  assert.equal(frameZoom(1.15, 1000), 1.15);
  assert.equal(frameZoom(1.15, 360), 1);
  assert.equal(frameZoom(1.15, 180), 0.5);
  assert.equal(frameZoom(1.15, 0), 1.15);   // الصفحة المخفية عرضها صفر
});

test("السحب: ينحط جنب الصفحة بالجهة اللي تركته بيها", () => {
  assert.equal(slotCount([1], 2, 4), 2);
  assert.equal(slotAt(0.1, 2), 0);
  assert.equal(slotAt(0.9, 2), 1);
  assert.equal(slotAt(1, 2), 1);
  assert.deepEqual(placePane([1], 2, 0, 4), [2, 1]);
  assert.deepEqual(placePane([1], 2, 1, 4), [1, 2]);
});

test("سحب صفحة ظاهرة يبدل ترتيبها بدون ما تتكرر", () => {
  assert.equal(slotCount([1, 2], 1, 4), 2);
  assert.deepEqual(placePane([1, 2], 1, 1, 4), [2, 1]);
});

test("إذا الشاشة ممتلية، ياخذ مكان الصفحة اللي نزل عليها", () => {
  assert.equal(slotCount([1, 2], 3, 2), 2);
  assert.deepEqual(placePane([1, 2], 3, 0, 2), [3, 2]);
  assert.deepEqual(placePane([1, 2], 3, 1, 2), [1, 3]);
});

test("زر ◫ يضيف ويشيل، وآخر صفحة ما تنشال", () => {
  assert.deepEqual(togglePane([1], 2, 4), [1, 2]);
  assert.deepEqual(togglePane([1, 2], 2, 4), [1]);
  assert.deepEqual(togglePane([1], 1, 4), [1]);
});

test("الدوسة على تبويب تبدل الصفحة اللي إنت عليها بس", () => {
  assert.deepEqual(showTab([1, 2], 3, 1), [3, 2]);
  assert.deepEqual(showTab([1, 2], 3, 2), [1, 3]);
  assert.deepEqual(showTab([1, 2], 2, 1), [1, 2]);
  assert.deepEqual(showTab([], 5, 0), [5]);
});

test("سد تبويب: الباقية تبقى، وإذا ما بقت صفحة يطلع آخر تبويب", () => {
  assert.deepEqual(closePane([1, 2], 2, [1, 3]), [1]);
  assert.deepEqual(closePane([2], 2, [1, 3]), [3]);
  assert.deepEqual(closePane([2], 2, []), []);
});
