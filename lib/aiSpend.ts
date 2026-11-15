// صرفية الذكاء كل شي لحاله: الأسئلة العلمية، وقلم المصحح (كل يوم بيومه هنا)، والتصحيح (من سجله نفسه).
// الكل على نفس حساب Anthropic، فحساب Anthropic يطلع المجموع بس. هنا البوت يحسبها من عدد التوكنات وأسعار الموديل
import { kvGet, kvSet } from "./db.ts";
import { stamp } from "./util.ts";

export type SpendKind = "qa" | "pen";
const KEY = "ai_spend_days";
const KEEP_DAYS = 400;
type Days = Record<string, Partial<Record<SpendKind, number>>>;

export async function spendDays(): Promise<Days> {
  try { const j = JSON.parse((await kvGet(KEY)) ?? "{}"); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
/** يضيف كلفة طلب (بالدولار) على يوم اليوم */
export async function addSpend(kind: SpendKind, usd: number, day = stamp().slice(0, 10)) {
  if (!(usd > 0)) return;
  const d = await spendDays();
  const row = d[day] ?? {};
  row[kind] = Math.round(((row[kind] ?? 0) + usd) * 1e6) / 1e6;
  d[day] = row;
  const keep = Object.keys(d).sort().slice(-KEEP_DAYS);
  await kvSet(KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, d[k]]))));
}
/** مجموع نوع وحد للأيام اللي تبدي بهذا (يوم «2026-11-15» أو شهر «2026-11») */
export const spentIn = (d: Days, kind: SpendKind, prefix: string) =>
  Object.entries(d).filter(([day]) => day.startsWith(prefix)).reduce((t, [, r]) => t + (r[kind] ?? 0), 0);
