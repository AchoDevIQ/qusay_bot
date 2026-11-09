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
/** نوع فلوس المنتج. الدفتر أول فحص، لأن «دفتر محاضرات» ورق وفلوسه ويا الملازم */
export type MoneyKind = "booklets" | "exams" | "lectures" | "both" | "other";
export type MoneyParts = Record<MoneyKind, number>;
const PART_LABELS: [MoneyKind, string][] = [["booklets", "📚 الملازم"], ["exams", "📝 الامتحانات"], ["lectures", "🎬 المحاضرات"], ["both", "🎓 محاضرات + امتحانات سوية"], ["other", "📦 غيرها"]];
export function moneyKind(name: string | null | undefined): MoneyKind {
  const n = name ?? "";
  if (/دفتر|دفاتر|ملزم|ملازم/.test(n)) return "booklets";
  const lec = n.includes("محاضر"), exam = n.includes("امتحان");
  return lec && exam ? "both" : exam ? "exams" : lec ? "lectures" : "other";
}
const noParts = (): MoneyParts => ({ booklets: 0, exams: 0, lectures: 0, both: 0, other: 0 });
/** تقسيم مبلغ الطلب. أي فرق عن المبلغ الفعلي يروح لـ«غيرها» حتى المجموع يطابق دائماً */
export function moneyParts(items: { name?: string | null; price: number; qty: number }[], amount: number): MoneyParts {
  const p = noParts();
  for (const i of items) p[moneyKind(i.name)] += i.price * i.qty;
  p.other += amount - sumParts(p);
  return p;
}
export const sumParts = (p: MoneyParts) => p.booklets + p.exams + p.lectures + p.both + p.other;
export function addParts(list: MoneyParts[]) {
  const t = noParts();
  for (const p of list) for (const [k] of PART_LABELS) t[k] += p[k];
  return t;
}
/** الأسطر اللي بيها فلوس فقط */
export const partRows = (p: MoneyParts) => PART_LABELS.filter(([k]) => p[k] !== 0).map(([k, label]) => [label, p[k]] as [string, number]);
export const partsLine = (p: MoneyParts) => partRows(p).map(([l, v]) => `${l} ${v.toLocaleString("en-US")}`).join(" · ");
/** فصول المحاضرات والامتحانات بالطلب. «الفصل الرابع والخامس» يبقى فصل واحد لأنه ينباع سوية */
export function chaptersInOrder(names: (string | null | undefined)[]) {
  const labels = names.filter(firstRoundOnly).map((n) => chapterLabel(n)?.replace("الاول", "الأول"));
  return [...new Set(labels.filter((l): l is string => !!l))];
}
