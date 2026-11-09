// الفلوس مقسمة: الملازم والامتحانات والمحاضرات، والمجموع يطابق المبلغ دائماً
import { test } from "node:test";
import assert from "node:assert/strict";
import { addParts, lectureChapterPrices, moneyKind, moneyParts, partRows, priceReport, sumParts } from "../lib/orderRules.ts";

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

test("المشترك ينقسم: المحاضرات بسعرها لوحدها والباقي امتحانات، بأسعار البوت الفعلية", () => {
  const lec = lectureChapterPrices([
    { name: "الفصل الأول - محاضرات فقط", price: 40000 }, { name: "فقط محاضرات الفصل الثاني", price: 40000 }, { name: "الفصل الثالث - محاضرات فقط", price: 65000 },
    { name: "فقط محاضرات الفصل الرابع والخامس", price: 65000 }, { name: "دفتر محاضرات الفصل الأول", price: 15000 }, { name: "فقط امتحانات الفصل الثاني", price: 40000 },
  ]);
  const split = (name: string, price: number, qty = 1) => moneyParts([{ name, price, qty }], price * qty, lec);
  assert.deepEqual(split("محاضرات +امتحانات الفصل الاول", 75000), { booklets: 0, exams: 35000, lectures: 40000, both: 0, other: 0 });
  assert.deepEqual(split("الفصل الثاني - محاضرات + امتحانات إلكتروني", 75000), { booklets: 0, exams: 35000, lectures: 40000, both: 0, other: 0 });
  assert.deepEqual(split("محاضرات +امتحانات الفصل الثالث", 125000), { booklets: 0, exams: 60000, lectures: 65000, both: 0, other: 0 });
  assert.deepEqual(split("الفصل الرابع والخامس - محاضرات + امتحانات حضوري", 150000), { booklets: 0, exams: 85000, lectures: 65000, both: 0, other: 0 });
  assert.deepEqual(split("محاضرات +امتحانات الفصل الرابع والخامس الكتروني", 125000, 2), { booklets: 0, exams: 120000, lectures: 130000, both: 0, other: 0 });
});

test("المشترك يبقى سطر وحده إذا ماكو سعر محاضرات لفصله، أو سعره أكبر من المشترك", () => {
  const name = "محاضرات +امتحانات الفصل الثالث";
  assert.equal(moneyParts([{ name, price: 125000, qty: 1 }], 125000, new Map()).both, 125000);
  assert.equal(moneyParts([{ name, price: 125000, qty: 1 }], 125000).both, 125000);
  assert.equal(moneyParts([{ name, price: 50000, qty: 1 }], 50000, new Map([["الفصل الثالث", 65000]])).both, 50000);
});

test("تقرير الأسعار: 50 بسعر 40,000، وبعد تغيير السعر 25 بسعر 30,000", () => {
  const name = "فقط محاضرات الفصل الثالث";
  const sales = [...Array.from({ length: 50 }, () => [{ name, price: 40000, qty: 1 }]), ...Array.from({ length: 25 }, () => [{ name, price: 30000, qty: 1 }])];
  assert.deepEqual(priceReport(sales), [{ name, qty: 75, total: 2750000, prices: [{ price: 40000, qty: 50 }, { price: 30000, qty: 25 }] }]);
  assert.deepEqual(priceReport([]), []);
});

test("تقرير الأسعار: الكمية تنحسب، وكل منتج بسطره", () => {
  const r = priceReport([[{ name: "ب", price: 10, qty: 3 }, { name: "أ", price: 5, qty: 1 }], [{ name: "ب", price: 10, qty: 1 }]]);
  assert.deepEqual(r.map((l) => [l.name, l.qty, l.total]), [["أ", 1, 5], ["ب", 4, 40]]);
});

test("الجمع يطابق، والأسطر الفارغة ما تطلع", () => {
  const a = moneyParts([{ name: "دفتر امتحانات الفصل الأول", price: 4000, qty: 1 }], 4000);
  const b = moneyParts([{ name: "دفتر امتحانات الفصل الثاني", price: 4000, qty: 1 }, { name: "محاضرات +امتحانات الفصل الثاني", price: 75000, qty: 1 }], 79000);
  const t = addParts([a, b]);
  assert.equal(sumParts(t), 83000);
  assert.deepEqual(partRows(t).map(([, v]) => v), [8000, 75000]);
  assert.deepEqual(partRows(addParts([])), []);
});
