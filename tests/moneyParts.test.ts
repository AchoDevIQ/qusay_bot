// الفلوس مقسمة: الملازم والامتحانات والمحاضرات، والمجموع يطابق المبلغ دائماً
import { test } from "node:test";
import assert from "node:assert/strict";
import { addParts, moneyKind, moneyParts, partRows, sumParts } from "../lib/orderRules.ts";

test("كل نوع من أسماء المنتجات الفعلية يروح لمكانه", () => {
  for (const n of ["دفتر محاضرات الفصل الأول", "دفتر امتحانات الفصل الثالث", "ملزمة الفصل الأول", "ملازم الوزاريات"]) assert.equal(moneyKind(n), "booklets", n);
  for (const n of ["فقط امتحانات حضوري الفصل الرابع والخامس", "الفصل الأول - امتحانات إلكترونية"]) assert.equal(moneyKind(n), "exams", n);
  for (const n of ["فقط محاضرات الفصل الثالث", "الفصل الأول - محاضرات فقط"]) assert.equal(moneyKind(n), "lectures", n);
  for (const n of ["محاضرات +امتحانات الفصل الاول", "الفصل الأول - محاضرات + امتحانات إلكتروني"]) assert.equal(moneyKind(n), "both", n);
  assert.equal(moneyKind("تجريبي"), "other");
  assert.equal(moneyKind(null), "other");
});

test("الكمية تنحسب، وأجرة التوصيل ما تدخل، والمجموع يطابق", () => {
  const p = moneyParts([{ name: "دفتر محاضرات الفصل الأول", price: 15000, qty: 2 }, { name: "فقط امتحانات الفصل الثالث", price: 60000, qty: 1 }], 90000);
  assert.deepEqual(p, { booklets: 30000, exams: 60000, lectures: 0, both: 0, other: 0 });
  assert.equal(sumParts(p), 90000);
});

test("إذا المبلغ يختلف عن المنتجات، الفرق يطلع بغيرها حتى المجموع ما يكذب", () => {
  const p = moneyParts([{ name: "فقط محاضرات الفصل الثالث", price: 65000, qty: 1 }], 60000);
  assert.equal(p.lectures, 65000);
  assert.equal(p.other, -5000);
  assert.equal(sumParts(p), 60000);
});

test("الجمع يطابق، والأسطر الفارغة ما تطلع", () => {
  const a = moneyParts([{ name: "دفتر امتحانات الفصل الأول", price: 4000, qty: 1 }], 4000);
  const b = moneyParts([{ name: "دفتر امتحانات الفصل الثاني", price: 4000, qty: 1 }, { name: "محاضرات +امتحانات الفصل الثاني", price: 75000, qty: 1 }], 79000);
  const t = addParts([a, b]);
  assert.equal(sumParts(t), 83000);
  assert.deepEqual(partRows(t).map(([, v]) => v), [8000, 75000]);
  assert.deepEqual(partRows(addParts([])), []);
});
