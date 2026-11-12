// حراسة كلفة نظام التصحيح AI: حد يومي بالدولار، ومفتاح الحفظ اللي يتغير وي نسخة محرك التصحيح.
// كله حساب بسيط بدون قاعدة بيانات ولا شبكة، حتى ينفحص لحاله.

export type GuardUsage = { model: string; input: number; output: number };
export type GuardPrice = { in: number; out: number };
export type GuardLogRow = { at: string; usage: GuardUsage[] };

/** اليوم من ختم السجل "2026-11-12 14:05" */
export const dayOf = (at: string) => String(at ?? "").slice(0, 10);

/** كلفة اليوم بالدولار من سجل نظام التصحيح (كل الأنواع: تصحيح، خطوات، مقارنة، اعتراض) */
export function spentOn(day: string, log: GuardLogRow[], prices: Record<string, GuardPrice>): number {
  let total = 0;
  for (const row of log) {
    if (dayOf(row.at) !== day) continue;
    for (const u of row.usage ?? []) {
      const p = prices[u.model];
      if (p) total += (p.in * (Number(u.input) || 0) + p.out * (Number(u.output) || 0)) / 1e6;
    }
  }
  return total;
}

/** الحد اليومي من AI_DAILY_USD_CAP. فارغ أو صفر أو مو رقم = بدون حد */
export function dailyCap(raw: string | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** وصلنا الحد؟ بدون حد = لا */
export const overCap = (spent: number, cap: number | null) => cap !== null && spent >= cap;

/** اسم نسخة التصحيح بمفتاح الحفظ: الاسم الثابت وي نسخة المحرك اللي ترجعها الخدمة (إذا رجعتها) */
export const engineTag = (base: string, version: string) => (version ? `${base}:${version}` : base);
