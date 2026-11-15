// «📑 المواضيع»: عناوين المحاضرات بأعلى الصفحات تصير موضوع ← محاضرة ← عنوان فرعي، ويا رقم أول صفحة
import { test } from "node:test";
import assert from "node:assert/strict";
const { tocFromText } = await import("../lib/noteToc.ts");

const head = (lecture: string, topic: string, section: string) => [
  { s: "قصي العميري", x: 444, y: 806 }, { s: "1", x: 294, y: 811 },
  { s: `${lecture} :`, x: 297, y: 742 }, { s: topic, x: 181, y: 742 },
  { s: section, x: 242, y: 714 }, { s: "نص السؤال", x: 300, y: 600 },
];
test("📑 الفهرس من عناوين الصفحات: الموضوع، والمحاضرة بأول صفحة إلها، والكتاب والوزاري تحتها", () => {
  const pages = [
    head("المحاضرة الأولى", "المعدلات الزمنية", "أسئلة وأمثلة الكتاب"),
    [{ s: "تكملة", x: 300, y: 600 }],
    head("المحاضرة الأولى", "المعدلات الزمنية", "حل الأسئلة الوزارية"),
    head("المحاضرة الثانية", "المعدلات الزمنية", "أسئلة وأمثلة الكتاب"),
    head("المحاضرة الأولى", "مبرهنتا رول والقيمة المتوسطة", "أسئلة وأمثلة الكتاب"),
  ];
  const toc = tocFromText(pages, 842);
  assert.deepEqual(toc.map((t) => [t.t, t.p]), [["المعدلات الزمنية", 1], ["مبرهنتا رول والقيمة المتوسطة", 5]]);
  assert.deepEqual(toc[0].items!.map((l) => [l.t, l.p]), [["المحاضرة الأولى", 1], ["المحاضرة الثانية", 4]]);
  assert.deepEqual(toc[0].items![0].items!.map((s) => [s.t, s.p]), [["أسئلة وأمثلة الكتاب", 1], ["حل الأسئلة الوزارية", 3]]);
  // نص «المحاضرة» بنص الصفحة (مو بأعلاها) ما ينحسب عنوان
  assert.deepEqual(tocFromText([[{ s: "المحاضرة الأولى : شي", x: 300, y: 400 }]], 842), []);
});

const { tocFromLecturer } = await import("../lib/noteToc.ts");
const { matchPage, groupsOf, parseLecture } = await import("../lib/noteSpot.ts");
test("📑 الفهرس من عناوين «Square roots lecturer 1» بأي مكان بالصفحة، والأساسيات بأشكالها موضوع واحد", () => {
  const pg = (...l: [string, number, number][]) => l.map(([s, x, y]) => ({ s, x, y }));
  const pages = [
    pg(["الاساسيات", 470, 760], ["(1)", 439, 760], ["lecturer", 388, 760]),
    pg(["اسا سيات", 470, 760], ["(2)", 439, 760], ["lecturer", 388, 760]),
    pg(["قبلx", 494, 760], ["&", 483, 760], ["y", 473, 760], [")", 457, 760], ["lecturer (1", 394, 760]),
    pg(["قبلx", 494, 760], ["&", 483, 760], ["y", 473, 760], [")", 457, 760], ["lecturer ( 2", 394, 760], ["نص المحاضرة الثانية اللي جاية", 300, 600]),
    pg(["Square roots lecturer 1", 49, 700]),
    pg(["Cubic Roots of one Integer     ω [ lecturer 1]", 49, 760]),
  ];
  const toc = tocFromLecturer(pages);
  assert.deepEqual(toc.map((t) => [t.t, t.p, (t.items ?? []).map((l) => l.t + "@" + l.p).join(",")]), [
    ["الاساسيات", 1, "Lecture 1@1,Lecture 2@2"], ["قبلx & y", 3, "Lecture 1@3,Lecture 2@4"],
    ["Square roots", 5, "Lecture 1@5"], ["Cubic Roots of one Integer ω", 6, "Lecture 1@6"]]);
  assert.deepEqual(groupsOf(toc).map((g) => g.spots.length), [2, 2, 1, 1]);
  assert.deepEqual(groupsOf([{ t: "الاساسيات", p: 1, items: [{ t: "Lecture 1", p: 1 }] }, { t: "اسا سيات", p: 3, items: [{ t: "Lecture 2", p: 3 }] }]).map((g) => g.spots.length), [2]);
  assert.deepEqual(parseLecture("Square roots · Lecture 2"), { topic: "Square roots", lec: 2 });
  assert.deepEqual(parseLecture("المحاضرة الثالثة"), { topic: "", lec: 3 });
});

test("📍 نفس الموضوع والمحاضرة بين الكتاب والوزارية والراصد، حتى لو الأسماء تختلف", () => {
  const L = (t: string, p: number, items?: string[]) => ({ t, p, ...(items ? { items: items.map((x, i) => ({ t: x, p: p + i })) } : {}) });
  const book = [L("الاساسيات", 1, ["Lecture 1"]), L("قبل x & y", 10, ["Lecture 1", "Lecture 2", "Lecture 3", "Lecture 4", "Lecture 5"]),
    L("Square roots", 35, ["Lecture 1", "Lecture 2"]), L("x,y", 58, ["Lecture 1", "Lecture 2"]), L("De Movier’s", 78, ["Lecture 1", "Lecture 2"])];
  const wz = [L("Complex Numbers · Lecture 4", 1), L("Complex Numbers · Lecture 5", 8), L("Square roots · Lecture 1", 21), L("Square roots · Lecture 2", 24),
    L("x,y · Lecture 1", 44), L("De Movier’s · Lecture 1", 99), L("De Movier’s · Lecture 2", 110)];
  const rs = [L("Complex Numbers", 1, ["Q 1", "Q 2"]), L("Square Roots", 28, ["Q 1"]), L("x, y", 56, ["Q 1"]), L("De Moivre's Theorem", 132, ["Q 1"])];
  assert.equal(matchPage(book, 36, wz)?.page, 24);                // Square roots محاضرة 2
  assert.equal(matchPage(book, 36, rs)?.page, 28);                // الراصد: بداية الموضوع
  assert.equal(matchPage(book, 36, rs)?.label, "Square Roots");    // بلا «المحاضرة»: الراصد ما بيه محاضرات
  assert.equal(matchPage(book, 13, wz)?.page, 1);                 // «قبل x & y» = Complex Numbers، المحاضرة 4 أقرب وحدة للـ 4
  assert.equal(matchPage(book, 14, wz)?.page, 8);                 // المحاضرة 5
  assert.equal(matchPage(book, 11, wz)?.label, "Complex Numbers · المحاضرة 4");  // الوصف مال المكان اللي انفتح
  assert.equal(matchPage(wz, 45, book)?.page, 58);                // x,y ما ينخلط ويا «قبل x & y»
  assert.equal(matchPage(rs, 140, book)?.page, 78);               // «De Moivre's Theorem» = «De Movier’s» بمكانه
  assert.equal(matchPage(wz, 112, book)?.page, 79);
  assert.equal(matchPage(rs, 3, book)?.page, 10);                 // Complex Numbers بالراصد = «قبل x & y» بالكتاب
});
