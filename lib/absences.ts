// رسالة الغياب (طلب الأستاذ 2026-11-17): كل طالب يفوته امتحان وما دخله، توصله رسالة وتوصل لولي أمره،
// مثل ما الدرجة توصل لولي الأمر، حتى ولي الأمر ما يگول «ليش ما عنده درجة؟»: يعرف إنه غايب وانحسبله غياب وصفر.
// الغياب: موعده فات وما دخله (إلكتروني)، أو ما سجلوا حضوره (حضوري)، أو دخل وما دز ولا جواب لحد ما خلص الوقت.
// الرسالة تنرسل مرة وحدة لكل امتحان. الامتحانات اللي فاتت قبل ما تشتغل هاي الميزة ما توصل عنها رسائل
import { guardianOf, logActivity } from "./access.ts";
import { find, kvGet, kvSet, one, update, type Row } from "./db.ts";
import { student } from "./data.ts";
import { closeFinished } from "./examRoom.ts";
import { schedSettings } from "./schedApi.ts";
import { ampm, itemState, prettyDay } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";

const SINCE = "absence_since";
const LAST = "absence_sweep";

/** الامتحان فاته وما إله أجوبة؟ */
export function isAbsent(i: Row, window: number, now = stamp()) {
  if (i.kind === "optional" || i.notified === "test" || i.graded_at || i.submitted_at) return false;
  if (i.status === "missed") return true;
  return i.status === "waiting" && itemState("waiting", i.at, window, now) === "missed";
}

export const studentAbsentText = (title: string, at: string) =>
  `❌ <b>غياب</b>\nما دخلت امتحان <b>${esc(title)}</b> (${prettyDay(at.slice(0, 10))} الساعة ${ampm(at.slice(11, 16))}).\nانحسبلك غياب وصفر، ويدخل بحساب السيطرة. وصل خبر لولي أمرك.`;
export const guardianAbsentText = (name: string, title: string, at: string) =>
  `السلام عليكم 🌷\nنبلغكم إن <b>${esc(name)}</b> غاب عن امتحان <b>${esc(title)}</b> يوم ${prettyDay(at.slice(0, 10))} الساعة ${ampm(at.slice(11, 16))}، فما إله درجة بهذا الامتحان، وانحسبله غياب وصفر.`;

/** يدور على الغيابات الجديدة ويدز رسائلها. كل 10 دقايق أكثر شي */
export async function sweepAbsences(force = false) {
  const last = Number(await kvGet(LAST)) || 0;
  if (!force && Date.now() - last < 10 * 60_000) return 0;
  await kvSet(LAST, String(Date.now()));
  const now = stamp();
  // أول مرة: من هسه وبس، حتى ما توصل رسائل عن غيابات قديمة
  let since = await kvGet(SINCE);
  if (!since) { await kvSet(SINCE, now); return 0; }
  const s = await schedSettings();
  const cand = await find("sched_items", {}, { where: (i) => Number(i.user_id) > 0 && !i.absent_told && String(i.at ?? "") >= since! && String(i.at ?? "") <= now && ["waiting", "missed", "started", "attended", "exception"].includes(String(i.status)) });
  const users = new Set<number>();
  for (const i of cand) users.add(Number(i.user_id));
  // يسد الامتحانات اللي خلص وقتها أول، حتى اللي دخل وما دز ولا جواب ينحسب
  for (const uid of users) await closeFinished(uid, s).catch((e) => console.error("absence close", e));
  let sent = 0;
  for (const c of cand) {
    const i = await one("sched_items", { id: c.id });
    if (!i || i.absent_told || !isAbsent(i, s.window, now)) continue;
    await update("sched_items", { id: i.id }, { absent_told: now });
    const uid = Number(i.user_id);
    const st = await student(uid);
    if (!st) continue;
    const e = await one("bank_exams", { id: i.exam_id });
    const title = String(e?.title ?? "الامتحان"), at = String(i.at);
    const safe = async (to: number, text: string) => { try { await send(to, text); } catch (x) { console.error("absence msg", x); } };
    await safe(uid, studentAbsentText(title, at));
    const g = await guardianOf(uid);
    if (g) await safe(Number(g.guardian_id), guardianAbsentText(String(st.name ?? ""), title, at));
    await logActivity(uid, `❌ غاب عن امتحان ${title}، ووصلته رسالة الغياب${g ? " وولي أمره" : ""}`);
    sent++;
  }
  return sent;
}
