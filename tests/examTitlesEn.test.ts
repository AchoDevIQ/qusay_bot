// عناوين الامتحانات بالإنجليزي: من الخريطة، أو الاسم الإنجليزي القديم، وطالب الإنجليزي يشوفها
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultEnTitle, titleFor } from "../lib/examTitlesEn.ts";

test("العنوان الإنجليزي المقترح، والطالب يشوف حسب منهجه", () => {
  assert.equal(defaultEnTitle({ title: "قبل x & y المحاضرة (1 & 2)", info: "المحاضرة (1 & 2)  ·  الوقت: ساعة" }), "Before x & y Lecture (1 & 2)");
  assert.equal(defaultEnTitle({ title: "قطع مكافئ 1&2", info: "Parabola 1&2" }), "Parabola 1&2");
  assert.equal(defaultEnTitle({ title: "ربط القطوع 1&2", info: "ربط القطوع 1&2" }), "Linking Conics 1&2");
  assert.equal(defaultEnTitle({ title: "عنوان جديد", info: "" }), "");
  const e = { title: "الجذور التربيعية", title_en: "Square Roots" };
  assert.equal(titleFor(e, "إنجليزي"), "Square Roots");
  assert.equal(titleFor(e, "عربي"), "الجذور التربيعية");
  assert.equal(titleFor({ title: "الجذور التربيعية" }, "إنجليزي"), "الجذور التربيعية");
});
