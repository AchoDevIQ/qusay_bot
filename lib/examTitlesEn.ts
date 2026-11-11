// عناوين الامتحانات بالإنجليزي لطلاب المنهج الإنجليزي: من كلمات ملفات الوورد الإنجليزية نفسها،
// وتنحفظ بـ bank_exams.title_en. صاحب البوت يعدلها من «📄 إدارة الامتحانات» (🇬🇧 الاسم بالإنجليزي)
import { find, kvGet, kvSet, update, type Row } from "./db.ts";

/** العنوان العربي ← الإنجليزي. اللي ما بيها، تاخذ الاسم الإنجليزي القديم إذا كان إنجليزي */
export const EN_TITLES: Record<string, string> = {
  "قبل x & y المحاضرة (1 & 2)": "Before x & y Lecture (1 & 2)",
  "قبل x & y المحاضرة (3 & 4)": "Before x & y Lecture (3 & 4)",
  "قبل x & y المحاضرة (5 & 6)": "Before x & y Lecture (5 & 6)",
  "قبل x & y المحاضرة (7 & 8)": "Before x & y Lecture (7 & 8)",
  "قبل x & y": "Before x & y",
  "الجذور التربيعية": "Square Roots",
  "المعادلة التربيعية المحاضرة (1 & 2)": "Quadratic Equation Lecture (1 & 2)",
  "المعادلة التربيعية المحاضرة (3 & 4)": "Quadratic Equation Lecture (3 & 4)",
  "x & y المحاضرة (1)": "x & y Lecture (1)",
  "شامل x & y": "x & y Comprehensive",
  "نصف فاينل": "Mid-Final",
  "اوميكا (ω) المحاضرة (1 & 2)": "Omega (ω) Lecture (1 & 2)",
  "اوميكا (ω)": "Omega (ω)",
  "ديموافر المحاضرة (1 & 2)": "De Moivre's Theorem Lecture (1 & 2)",
  "ديموافر المحاضرة (3)": "De Moivre's Theorem Lecture (3)",
  "ديموافر المحاضرة (4 & 5)": "De Moivre's Theorem Lecture (4 & 5)",
  "ديموافر وارجاند": "De Moivre's Theorem & Argand",
  "فاينل الفصل الاول": "Chapter 1 Final",
  "ربط القطوع 1&2": "Linking Conics 1&2",
  "ربط القطوع 3&4": "Linking Conics 3&4",
  "ممنوع لو مسموح 1&2": "Allowed or Not Allowed 1&2",
  "ممنوع لو مسموح 3&4": "Allowed or Not Allowed 3&4",
  "المتفرقات": "Miscellaneous",
  "هل والإثبات": "Is It a Solution & Proof",
};
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
/** العنوان الإنجليزي المقترح لامتحان */
export function defaultEnTitle(e: Row): string {
  const t = String(e.title ?? "").trim(), info = String(e.info ?? "").trim();
  if (EN_TITLES[t]) return EN_TITLES[t];
  if (info && !hasArabic(info)) return info;
  return hasArabic(t) ? "" : t;
}
/** العنوان اللي يشوفه الطالب: الإنجليزي لطالب المنهج الإنجليزي إذا موجود */
export const titleFor = (e: Row | null | undefined, curr: unknown) => String((curr === "إنجليزي" && e?.title_en) || e?.title || "امتحان");

/** مرة وحدة: كل امتحان بلا عنوان إنجليزي ياخذ المقترح */
export async function fillEnTitles() {
  if (await kvGet("exam_titles_en_v1")) return 0;
  let n = 0;
  for (const e of await find("bank_exams")) {
    if (String(e.title_en ?? "").trim()) continue;
    const en = defaultEnTitle(e);
    if (en) { await update("bank_exams", { id: e.id }, { title_en: en }); n++; }
  }
  await kvSet("exam_titles_en_v1", "1");
  return n;
}
