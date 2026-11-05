// قواعد الطلب المشتركة بين صفحة المتجر والسيرفر. بدون أي استيراد حتى تشتغل بالمتصفح هم
/** كلمات الشرط اللي يرتبها الطالب: بدون العلامات الوحدها مثل - و * */
export const termWords = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

export const REFUND_SENTENCE = "جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان";
export const TERM_SENTENCE = "صلاحية المحاضرات والامتحانات للدور الأول فقط";

/** جملة الدور الأول حسب اللي بالسلة: محاضرات، امتحانات، أو الاثنين */
export function termSentenceFor(names: (string | null | undefined)[]) {
  const list = names.map((n) => n ?? "").filter(firstRoundOnly);
  const lec = list.some((n) => n.includes("محاضر")), exam = list.some((n) => n.includes("امتحان"));
  if (lec && !exam) return "صلاحية المحاضرات للدور الأول فقط";
  if (exam && !lec) return "صلاحية الامتحانات للدور الأول فقط";
  return TERM_SENTENCE;
}
export function chapterLabel(name: string | null | undefined) {
  const m = (name ?? "").match(/الفصل\s+(ال\S+(?:\s+و\S+)?)/);
  return m ? "الفصل " + m[1] : null;
}
/** تنبيه الدور الأول: للمحاضرات والامتحانات، مو للملازم والدفاتر الورقية */
export function firstRoundOnly(name: string | null | undefined) {
  const n = name ?? "";
  return /محاضر|امتحان/.test(n) && !n.includes("دفتر");
}
/** فصول المحاضرات والامتحانات بالطلب. «الفصل الرابع والخامس» يبقى فصل واحد لأنه ينباع سوية */
export function chaptersInOrder(names: (string | null | undefined)[]) {
  const labels = names.filter(firstRoundOnly).map((n) => chapterLabel(n)?.replace("الاول", "الأول"));
  return [...new Set(labels.filter((l): l is string => !!l))];
}
