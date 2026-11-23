// كارت «💰 صرفية الذكاء»: التصحيح والأسئلة العلمية وقلم المصحح، كل واحد لحاله (اليوم، هذا الشهر، من البداية). لصاحب البوت بس
import { aiLog, costOf, prices } from "./aiGrade.ts";
import { can, isAdmin } from "./data.ts";
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
    { key: "qusay", label: "🧠 تصحيح قصي", today: spentIn(d, "qusay", day), month: spentIn(d, "qusay", month), all: spentIn(d, "qusay", "") },
  ];
  const rows: SpendRow[] = raw.map((x) => ({ ...x, today: r4(x.today), month: r4(x.month), all: r4(x.all) }));
  const sum = (k: "today" | "month" | "all") => r4(rows.reduce((t, x) => t + x[k], 0));
  // أول يوم انحسبت بيه الأسئلة والقلم يوم بيوم
  const since = Object.keys(d).sort()[0] ?? day;
  // بالمجمل (طلب الأستاذ 2026-11-23): الأسئلة العلمية، والامتحانات (تصحيح مؤمل + تصحيح قصي + قلم المصحح)
  const pick = (keys: string[]) => (k: "today" | "month" | "all") => r4(rows.filter((x) => keys.includes(x.key)).reduce((t, x) => t + x[k], 0));
  const qa = pick(["qa"]), ex = pick(["grade", "qusay", "pen"]);
  const groups = [
    { key: "qa", label: "❓ الأسئلة العلمية", today: qa("today"), month: qa("month"), all: qa("all") },
    { key: "exams", label: "📝 الامتحانات (التصحيح كله)", today: ex("today"), month: ex("month"), all: ex("all") },
  ];
  // آخر 30 يوم، كل يوم بيومه
  const dayList = Array.from({ length: 30 }, (_, k) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); });
  const days = dayList.map((dd) => {
    const q = spentIn(d, "qa", dd), e = g(dd) + spentIn(d, "qusay", dd) + spentIn(d, "pen", dd);
    return { day: dd, qa: r4(q), exams: r4(e), total: r4(q + e) };
  }).filter((x) => x.total > 0);
  return { rows, groups, days, total: { today: sum("today"), month: sum("month"), all: sum("all") }, since };
}

export async function aiSpendAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  need(await isAdmin(uid) || await can(uid, "spend"), "ما عندك صلاحية الصرفية", 403);
  return { ...await spendReport(), notice: "" };
}
