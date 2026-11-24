// سطر حل من ملزمة الـ Word: كلام عربي داخل معادلة (مثل «اما 2a» بالمصفوفة، «وحدة مربعة») ينكتب \text{} حتى المعادلة
// تنرسم مو تطلع «\begin{matrix}»، والكلمتين أو أكثر ترجع لترتيبها (الـ Word يخزنها معكوسة: «مربعة وحدة»). وكلام عربي ورا
// معادلة بأول السطر هم معكوس («البؤرتين بين المسافة»). نفسه بصفحة الحل وبملف الـ PDF (طلب الأستاذ 2026-11-24)
const AR_RUN = /[؀-ۿ][؀-ۿ\s]*[؀-ۿ]|[؀-ۿ]+/g;
export function fixWordLine(text: string) {
  // معادلة انكسرت بـ $ جوة أقواسها («\overset{$ اما $2a}{$ او $2b}»): كلها معادلة وحدة، والعربي بيها \text
  if (/\{\s*\$|\$\s*\}/.test(text)) text = "$" + text.replace(/\$/g, " ").replace(/\s+/g, " ").trim() + "$";
  let out = text.replace(/\$([^$]+)\$/g, (_, m: string) => "$" + m.replace(AR_RUN, (run) => {
    const w = run.trim().split(/\s+/);
    return `\\text{${(w.length > 1 ? w.reverse() : w).join(" ")}}`;
  }) + "$");
  if (out.trim().startsWith("$")) out = out.replace(/\$\s+([؀-ۿ][؀-ۿ\s]*)$/, (_, a: string) => `$ ${a.trim().split(/\s+/).reverse().join(" ")}`);
  return out;
}
/** السطر اللي يبدي بمعادلة لو إنگليزي يبدي من اليسار، والعربي من اليمين */
export const startsLtr = (text: string) => /^\s*(\$|[A-Za-z0-9\\(])/.test(text);
