// «أجب عن K أسئلة فقط» (مثل نصف السنة: 6 أسئلة والإجابة عن 5): قاعدة عامة لأي امتحان.
// السؤال اللي ما جاوبه الطالب يتأشر «⏭ ترك» (درجته -1 بالجدول). المجموع: أول K أسئلة جاوبهن بالترتيب،
// وإذا جاوب أكثر من K، الزايد (الأخير) ما ينحسب. الملف بلا شي من السيرفر، فصفحة المصحح تستعمله هم.

/** درجة «متروك» بجدول درجات الأسئلة */
export const SKIP = -1;

export type MarkQ = { n: number; mark: number | null; answered?: boolean };

/** عدد الأسئلة المطلوبة (0 = كل الأسئلة) */
export const answerOnlyOf = (e: { answer_only?: unknown } | null | undefined) => Number(e?.answer_only) || 0;

/** متروك: المصحح أشره، أو ما بي جواب (بامتحان صوره لكل سؤال) وما انطى درجة */
export const isSkipped = (q: MarkQ) => q.mark === SKIP || (q.answered === false && !q.mark);

/** الأسئلة اللي تنحسب بالمجموع */
export function countedQs(qs: MarkQ[], k: number): Set<number> {
  const sorted = [...qs].sort((a, b) => a.n - b.n);
  if (!k) return new Set(sorted.map((q) => q.n));
  return new Set(sorted.filter((q) => !isSkipped(q)).slice(0, k).map((q) => q.n));
}

/** مجموع الورقة */
export function paperTotal(qs: MarkQ[], k: number) {
  const c = countedQs(qs, k);
  return qs.reduce((s, q) => s + (c.has(q.n) ? Math.max(0, q.mark ?? 0) : 0), 0);
}

/** الأسئلة اللي بعد ما انطت درجتها. بـ«أجب عن K»: اللي ما بي جواب ما يحتاج درجة */
export const missingQs = (qs: MarkQ[], k: number) => qs.filter((q) => (q.mark === null || q.mark === undefined) && !(k && q.answered === false)).map((q) => q.n);

/** الدرجة الكاملة: مجموع درجات الأسئلة، وبـ«أجب عن K» مجموع أكبر K درجات */
export function fullMarks(marks: number[], k: number) {
  const s = [...marks].sort((a, b) => b - a);
  return (k ? s.slice(0, k) : s).reduce((a, b) => a + b, 0);
}
