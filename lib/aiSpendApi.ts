// كارت «💰 صرفية الذكاء»: التصحيح والأسئلة العلمية وقلم المصحح، كل واحد لحاله (اليوم، هذا الشهر، من البداية). لصاحب البوت بس
import { aiLog, costOf, prices } from "./aiGrade.ts";
import { isAdmin } from "./data.ts";
import { penTextUsage } from "./inkText.ts";
import { qaSpentAll } from "./qaBank.ts";
import { spendDays, spentIn, type SpendKind } from "./aiSpend.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import type { Row } from "./db.ts";

export type SpendRow = { key: "grade" | SpendKind; label: string; today: number; month: number; all: number };
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export async function spendReport(day = stamp().slice(0, 10)) {
  const month = day.slice(0, 7);
  const p = await prices();
  const log = await aiLog();
  const g = (pre: string) => log.filter((x) => String(x.at ?? "").startsWith(pre)).reduce((t, x) => t + costOf(x.usage ?? [], p), 0);
  const d = await spendDays();
  // «من البداية»: الأسئلة والقلم من عداداتهم القديمة (من قبل ما ينحسب كل يوم لحاله)، والتصحيح من سجله
  const raw: SpendRow[] = [
    { key: "grade", label: "📝 التصحيح (نظام التصحيح AI)", today: g(day), month: g(month), all: g("") },
    { key: "qa", label: "❓ الأسئلة العلمية", today: spentIn(d, "qa", day), month: spentIn(d, "qa", month), all: Math.max(await qaSpentAll(), spentIn(d, "qa", "")) },
    { key: "pen", label: "🖊 قلم المصحح (يتحول نص)", today: spentIn(d, "pen", day), month: spentIn(d, "pen", month), all: Math.max((await penTextUsage()).cost, spentIn(d, "pen", "")) },
  ];
  const rows: SpendRow[] = raw.map((x) => ({ ...x, today: r4(x.today), month: r4(x.month), all: r4(x.all) }));
  const sum = (k: "today" | "month" | "all") => r4(rows.reduce((t, x) => t + x[k], 0));
  // أول يوم انحسبت بيه الأسئلة والقلم يوم بيوم
  const since = Object.keys(d).sort()[0] ?? day;
  return { rows, total: { today: sum("today"), month: sum("month"), all: sum("all") }, since };
}

export async function aiSpendAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  return { ...await spendReport(), notice: "" };
}
