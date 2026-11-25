// 🛤 مساري: ترتيب المحاضرات والامتحانات من أسماء الامتحانات
import { test } from "node:test";
import assert from "node:assert/strict";
const { buildPath, examPlace } = await import("../lib/pathApi.ts");

const T = (name: string, n: number) => ({ name, lectures: Array.from({ length: n }, (_, i) => ({ id: `${name}-${i + 1}`, title: `المحاضرة ${i + 1}`, n: i + 1 })) });
const topics = [T("الاساسيات", 2), T("قبل x & y", 8), T("الجذور التربيعيه", 1), T("المعادله التربيعيه", 5), T("{ x & y }", 3), T("اوميكا", 3), T("ديموافر", 5), T("اشكال ارجاند", 1)];
const titles = ["قبل x & y المحاضرة (1 & 2)", "قبل x & y المحاضرة (3 & 4)", "قبل x & y المحاضرة (5 & 6)", "قبل x & y المحاضرة (7 & 8)", "قبل x & y", "الجذور التربيعية", "المعادلة التربيعية المحاضرة (1 & 2)", "المعادلة التربيعية المحاضرة (3 & 4)", "x & y المحاضرة (1)", "شامل x & y", "نصف فاينل", "اوميكا (ω) المحاضرة (1 & 2)", "اوميكا (ω)", "ديموافر المحاضرة (1 & 2)", "ديموافر المحاضرة (3)", "ديموافر المحاضرة (4 & 5)", "ديموافر وارجاند", "فاينل الفصل الاول"];
const exams = titles.map((title, i) => ({ id: i + 1, title }));

test("🛤 الموضوع واللي بعده من اسم الامتحان", () => {
  const names = topics.map((t) => t.name);
  assert.deepEqual(examPlace("قبل x & y المحاضرة (3 & 4)", names), { ti: 1, nums: [3, 4] });
  assert.deepEqual(examPlace("شامل x & y", names), { ti: 4, nums: [] });
  assert.deepEqual(examPlace("الجذور التربيعية", names), { ti: 2, nums: [] });
  assert.equal(examPlace("ديموافر وارجاند", names).ti, 7, "بعد أرجاند");
  assert.equal(examPlace("نصف فاينل", names).ti, -1);
});

test("🛤 الفصل الأول بالترتيب: محاضرتين وامتحان، والشامل بعد الموضوع، والنصف فاينل لحاله", () => {
  const { sections } = buildPath(topics, exams);
  const show = sections.map((s) => `${s.general ? "#" : ""}${s.name}: ${s.items.map((x) => x.kind === "lec" ? x.lec.n : `[${x.exam.id}]`).join(" ")}`);
  assert.deepEqual(show, [
    "الاساسيات: 1 2",
    "قبل x & y: 1 2 [1] 3 4 [2] 5 6 [3] 7 8 [4] [5]",
    "الجذور التربيعيه: 1 [6]",
    "المعادله التربيعيه: 1 2 [7] 3 4 [8] 5",
    "{ x & y }: 1 [9] 2 3 [10]",
    "#نصف فاينل: [11]",
    "اوميكا: 1 2 [12] 3 [13]",
    "ديموافر: 1 2 [14] 3 [15] 4 5 [16]",
    "اشكال ارجاند: 1 [17]",
    "#فاينل الفصل الاول: [18]",
  ]);
});
