// جملة القسم قبل الامتحان: الطالب يكتبها كاملة بيده. المقارنة تسامح بالهمزات والتاء المربوطة والياء والتشكيل
// والفواصل والمسافات، بس كل كلمة لازم تكون موجودة وبمكانها. الملف بلا شي من السيرفر، فصفحة الطالب تستعمله هم.

/** كلمات الجملة بعد التسهيل: «أني» و«اني» نفس الشي، و«ة» و«ه» نفس الشي */
export function oathWords(t: string): string[] {
  return String(t ?? "")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter(Boolean);
}

/** كتبها كاملة وصح */
export function sameOath(typed: string, sentence: string) {
  const a = oathWords(typed), b = oathWords(sentence);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** وين وصل: أول كلمة غلط (إذا أكو)، وكم كلمة باقية. الكلمة اللي بعده يكتبها ما تنحسب غلط */
export function oathProgress(typed: string, sentence: string): { ok: boolean; wrong: { got: string; want: string } | null; left: number } {
  const a = oathWords(typed), b = oathWords(sentence);
  const typing = !/[\s.،,]$/.test(typed) && a.length > 0;
  for (let i = 0; i < a.length; i++) {
    const want = b[i] ?? "";
    if (a[i] === want) continue;
    if (i === a.length - 1 && typing && want.startsWith(a[i])) return { ok: false, wrong: null, left: b.length - i };
    return { ok: false, wrong: { got: a[i], want }, left: Math.max(0, b.length - i) };
  }
  return { ok: a.length === b.length, wrong: null, left: Math.max(0, b.length - a.length) };
}
