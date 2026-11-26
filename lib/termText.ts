// ✍️ الشرط ينكتب من جديد (طلبه 2026-11-26: «الشرط يعيد كتابته كلمة كلمة»): الكلمات لازم كلها وبترتيبها،
// بس الهمزات والتاء المربوطة والياء والتشكيل والتطويل والفواصل والأرقام العربية/الإنگليزية ما تفرق.
// نفس الفحص بالصفحة (حتى يگله وين غلط) وبالسيرفر (حتى ما يعبر بلا ما يكتب).

/** الكلمة بشكل واحد للمقارنة */
export const normWord = (w: string) => w
  .replace(/[ً-ٰٟـ]/g, "")       // التشكيل والتطويل
  .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[^\p{L}\p{N}]/gu, "")
  .toLowerCase();
/** كلمات النص (بلا اللي بس علامات) */
export const termWordsOf = (text: string) => String(text ?? "").split(/\s+/).map(normWord).filter(Boolean);

/** شگد كاتب صح من البداية، وأول كلمة غلط (إذا أكو): wrong = رقمها من 1، got = اللي كتبه، want = المفروض */
export function typedCheck(target: string, typed: string) {
  const want = String(target ?? "").split(/\s+/).filter((w) => normWord(w));
  const t = termWordsOf(typed);
  let ok = 0;
  while (ok < t.length && ok < want.length && t[ok] === normWord(want[ok])) ok++;
  const raw = String(typed ?? "").split(/\s+/).filter((w) => normWord(w));
  // الكلمة الأخيرة بعده يكتبها: إذا بدايتها صح، ما ننحسبها غلط
  const last = ok === t.length - 1 && ok < want.length && normWord(want[ok]).startsWith(t[ok]) && !/\s$/.test(typed);
  const wrong = ok < t.length && !last ? { n: ok + 1, got: raw[ok] ?? "", want: want[ok] ?? "" } : null;
  return { ok, total: want.length, done: ok === want.length && t.length === want.length, wrong };
}
