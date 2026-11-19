// الدرجة بالصوت: من الكلام لرقم، والكلام المو واضح ما ينحفظ
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickMark, spokenMark, spokenNumber } from "../lib/spokenMark.ts";

const n = (s: string, max = 100) => spokenNumber(s, max);

test("أرقام مكتوبة: إنكليزية وعربية وفارسية", () => {
  assert.equal(n("20"), 20);
  assert.equal(n("٢٠"), 20);
  assert.equal(n("۱۵"), 15);
  assert.equal(n("0"), 0);
  assert.equal(n(" 7 "), 7);
  assert.equal(n("20 درجة"), 20);
  assert.equal(n("الدرجة ٢٥"), 25);
});

test("كلمات عربية فصحى ولهجة", () => {
  assert.equal(n("صفر"), 0);
  assert.equal(n("عشرين"), 20);
  assert.equal(n("عشرون"), 20);
  assert.equal(n("واحد"), 1);
  assert.equal(n("وحدة"), 1);
  assert.equal(n("اثنين"), 2);
  assert.equal(n("ثلاثة"), 3);
  assert.equal(n("ثمنية"), 8);
  assert.equal(n("عشرة"), 10);
  assert.equal(n("خمسطعش"), 15);
  assert.equal(n("ثلطعش"), 13);
  assert.equal(n("سطعش"), 16);
  assert.equal(n("ستطعش"), 16);
  assert.equal(n("اثنعش"), 12);
  assert.equal(n("احدعش"), 11);
  assert.equal(n("تسعتعش"), 19);
  assert.equal(n("ثمنطعش"), 18);
  assert.equal(n("خمسة عشر"), 15);
  assert.equal(n("ثلاثة عشرة"), 13);
  assert.equal(n("خمسة وعشرين"), 25);
  assert.equal(n("خمسه و عشرين"), 25);
  assert.equal(n("عشرين وخمسة"), 25);
  assert.equal(n("أربعين"), 40);
  assert.equal(n("مية"), 100);
  assert.equal(n("مئة"), 100);
  assert.equal(n("مائة"), 100);
  assert.equal(n("عِشْرِين"), 20);
});

test("كلمات إنكليزية ومكتوبة بالعربي", () => {
  assert.equal(n("twenty"), 20);
  assert.equal(n("Twenty-Five"), 25);
  assert.equal(n("twenty five"), 25);
  assert.equal(n("zero"), 0);
  assert.equal(n("fifteen"), 15);
  assert.equal(n("one hundred"), 100);
  assert.equal(n("تونتي"), 20);
  assert.equal(n("فايف"), 5);
  assert.equal(n("give it 20 marks"), 20);
});

test("نص وربع: يطلع كسر", () => {
  assert.equal(n("خمسة ونص"), 5.5);
  assert.equal(n("خمسه و نص"), 5.5);
  assert.equal(n("5.5"), 5.5);
  assert.equal(n("٥٫٥"), 5.5);
  assert.equal(n("five and a half"), 5.5);
  assert.equal(n("نص"), 0.5);
});

test("«من» و«/»: الدرجة هي الأولى", () => {
  assert.equal(n("عشرين من خمسة وعشرين"), 20);
  assert.equal(n("20/25"), 20);
  assert.equal(n("15 out of 20"), 15);
});

test("الدرجة الكاملة", () => {
  assert.equal(n("كاملة", 12), 12);
  assert.equal(n("الدرجة الكاملة", 25), 25);
  assert.equal(n("full mark", 10), 10);
});

test("كلام مو واضح يرجع null", () => {
  for (const s of ["", "هلو", "اوكي عشرين", "عشرين عشرين", "خمسة ستة", "20 15", "نص خمسة", "السلام عليكم", "next", "كاملة عشرين"]) assert.equal(n(s), null, s);
});

test("spokenMark: رقم كامل وبحدود درجة السؤال", () => {
  assert.deepEqual(spokenMark("عشرين", 20), { mark: 20, heard: "عشرين" });
  assert.deepEqual(spokenMark("صفر", 5), { mark: 0, heard: "صفر" });
  const over = spokenMark("خمسة وعشرين", 20);
  assert.ok("error" in over && over.kind === "over" && over.error.includes("25") && over.error.includes("20"));
  const half = spokenMark("خمسة ونص", 10);
  assert.ok("error" in half && half.kind === "fraction");
  const bad = spokenMark("ما ادري", 10);
  assert.ok("error" in bad && bad.kind === "unclear" && bad.heard === "ما ادري");
});

test("pickMark: أول احتمال صحيح، وإذا ماكو السبب الأوضح", () => {
  assert.deepEqual(pickMark(["عشرين اوكي", "عشرين"], 20), { mark: 20, heard: "عشرين" });
  assert.deepEqual(pickMark(["هلو", "15"], 20), { mark: 15, heard: "15" });
  const r = pickMark(["هلو", "30"], 20);
  assert.ok("error" in r && r.kind === "over");
  const e = pickMark([], 20);
  assert.ok("error" in e && e.kind === "unclear");
});

test("مايك الكيبورد: بس الكلام الجديد ينحسب", async () => {
  const { newSpoken } = await import("../lib/spokenMark.ts");
  let r = newSpoken("عشرين", 0);
  assert.deepEqual(r, { seg: "عشرين", done: 5 });
  r = newSpoken("عشرين خمسطعش", r.done);
  assert.equal(r.seg, "خمسطعش");
  r = newSpoken("عشرين خمسطعش", r.done);
  assert.equal(r.seg, "");
  // انمسح المربع: يبدي من جديد
  r = newSpoken("٧", r.done);
  assert.deepEqual(r, { seg: "٧", done: 1 });
});
