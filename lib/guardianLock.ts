// القفل الجزئي إذا ولي الأمر ما استلم الدرجة (قرار الأستاذ 2026-11-17). الدراسة ما تنقفل أبداً (محاضرات، ملازم، امتحانات):
//   • الورقة المصححة بالتفصيل والاعتراض عليها: ينفتحن ورا ما ولي الأمر يستلم الدرجة.
//   • إذا درجة مرت عليها 3 أيام وما استلمها: ينقفل المتجر والتصويت والمنافسة لحد ما يستلم.
//   • «✈️ ولي أمري مسافر»: الطالب يطلب، وصاحب البوت يأجّل القفل أسبوع أو أسبوعين.
import { ADMIN_IDS } from "./config.ts";
import { kvGet, kvSet, one } from "./db.ts";
import { guardianOf, logActivity } from "./access.ts";
import { pendingSeen } from "./guardianWatch.ts";
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const LOCK_DAYS = 3;
export const PAPER_WAIT = "✍️ ورقتك المصححة تنفتح ورا ما ولي أمرك يستلم الدرجة (يدوس «✅ استلمت»).";
export const OLD_WAIT = `✍️ ولي أمرك ما استلم درجة من ${LOCK_DAYS} أيام. المتجر والتصويت والمنافسة ينفتحن ورا ما يستلمها. إذا مسافر، دوس «✈️ ولي أمري مسافر» بامتحاناتي.`;
const travelKey = (sid: number) => `guardian_travel_${sid}`;

/** الدرجة تنتظر استلام ولي الأمر؟ (بس إذا عنده ولي أمر مربوط) */
export async function paperWaits(sid: number, itemId: number) {
  if (!await guardianOf(sid)) return false;
  return (await pendingSeen(sid)).includes(itemId);
}
export async function travelUntil(sid: number) { return (await kvGet(travelKey(sid))) || ""; }
/** درجة مرت عليها 3 أيام وما استلمها، وما مأجّل لأن مسافر */
export async function oldUnseen(sid: number, now = Date.now()) {
  if (!await guardianOf(sid)) return false;
  const until = await travelUntil(sid);
  if (until && until >= stamp().slice(0, 10)) return false;
  for (const id of await pendingSeen(sid)) {
    const it = await one("sched_items", { id });
    const at = Date.parse(String(it?.graded_at ?? "").replace(" ", "T") + ":00+03:00");
    if (Number.isFinite(at) && now - at > LOCK_DAYS * 86400_000) return true;
  }
  return false;
}
export async function needSeenPaper(sid: number, itemId: unknown) { need(!await paperWaits(sid, Number(itemId)), PAPER_WAIT, 423); }
export async function needNoOld(sid: number) { need(!await oldUnseen(sid), OLD_WAIT, 423); }

/** الطالب يگول ولي أمره مسافر: يوصل خبر لصاحب البوت ويا أزرار التأجيل */
export async function askTravel(sid: number) {
  const st = await one("students", { user_id: sid });
  await logActivity(sid, "✈️ طلب: ولي أمري مسافر");
  for (const a of ADMIN_IDS) await send(a, `✈️ <b>الطالب «${esc(String(st?.name ?? sid))}» يگول ولي أمره مسافر</b>\nبعده ما استلم درجاته، فالمتجر والتصويت والمنافسة مقفولة عنده. تأجّل القفل؟`, {
    kb: [[{ text: "⏸ أجّل أسبوع", callback_data: `gtr:${sid}:7` }, { text: "⏸ أجّل أسبوعين", callback_data: `gtr:${sid}:14` }], [{ text: "❌ لا", callback_data: `gtr:${sid}:0` }]],
  });
}
/** صاحب البوت قرر: يأجّل القفل لحد تاريخ، أو لا. الطالب يوصله الخبر */
export async function decideTravel(sid: number, days: number) {
  if (days > 0) {
    const until = new Date(Date.now() + 3 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
    await kvSet(travelKey(sid), until);
    await logActivity(sid, `✈️ الإدارة أجّلت قفل ولي الأمر لحد ${until}`);
    await send(sid, `✈️ تمام، أجّلنا القفل لحد ${until}. ولي أمرك يستلم الدرجات أول ما يرجع.`);
    return `⏸ تأجّل لحد ${until}`;
  }
  await kvSet(travelKey(sid), "");
  await send(sid, "✈️ ما تأجّل القفل. خلي ولي أمرك يستلم الدرجة من صفحة «👨‍👧 ولي الأمر».");
  return "❌ ما تأجّل";
}
