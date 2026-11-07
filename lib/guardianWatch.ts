// متابعة ولي الأمر: ما نگدر نمنع الطالب يمسح البوت من موبايل أهله، بس نكشفه.
// ١. بلوك: تليگرام يگول للبوت (أو تفشل الرسالة)، فيوصل خبر لصاحب البوت والطالب.
// ٢. كل درجة توصل لولي الأمر وياها زر «✅ استلمت». إذا ٣ درجات ورا بعض ما انداس عليهن، يوصل خبر لصاحب البوت.
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, one } from "./db.ts";
import { send, wasBlocked, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";

export const UNSEEN_ALERT = 3;
type Watch = { unseen: number[]; lastSeen: string | null; blockedAt: string | null; alerted: boolean };
const key = (sid: number) => `guardian_watch_${sid}`;
async function load(sid: number): Promise<Watch> {
  try {
    const j = JSON.parse((await kvGet(key(sid))) ?? "{}");
    return { unseen: Array.isArray(j.unseen) ? j.unseen.map(Number) : [], lastSeen: j.lastSeen ?? null, blockedAt: j.blockedAt ?? null, alerted: !!j.alerted };
  } catch { return { unseen: [], lastSeen: null, blockedAt: null, alerted: false }; }
}
const save = (sid: number, w: Watch) => kvSet(key(sid), JSON.stringify(w));
const nameOf = async (sid: number) => (await one("students", { user_id: sid }))?.name ?? `طالب #${sid}`;
/** رقم ولي الأمر (الهاتف الثاني بالتسجيل) كرابط واتساب: 07701234567 يصير 9647701234567 */
export function whatsappOf(phone: unknown): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (/^07\d{9}$/.test(d)) return `https://wa.me/964${d.slice(1)}`;
  if (/^9647\d{9}$/.test(d)) return `https://wa.me/${d}`;
  return null;
}
/** خبر لصاحب البوت، ووياه زر واتساب ولي الأمر */
async function tellOwner(sid: number, text: string) {
  const wa = whatsappOf((await one("students", { user_id: sid }))?.phone2);
  const kb: Kb | undefined = wa ? [[{ text: "💬 كلم ولي الأمر بالواتساب", url: wa }]] : undefined;
  for (const a of ADMIN_IDS) await send(a, wa ? text : `${text}\n\n(ماكو رقم واتساب لولي الأمر بمعلوماته)`, kb ? { kb } : {});
}

/** حالة ولي الأمر لصفحة الطلاب */
export async function guardianState(sid: number) {
  const w = await load(sid);
  return { lastSeen: w.lastSeen, unseen: w.unseen.length, blockedAt: w.blockedAt };
}

export const seenButton = (itemId: number): Kb => [[{ text: "✅ استلمت", callback_data: `gs:${itemId}` }]];

/** درجة وصلت (أو انرسلت) لولي الأمر: إذا الرسالة فشلت لأنه حاظر البوت، يعتبر بلوك */
export async function guardianSent(sid: number, gid: number, itemId: number) {
  if (wasBlocked(gid)) { await guardianBlocked(gid); return; }
  const w = await load(sid);
  if (!w.unseen.includes(itemId)) w.unseen.push(itemId);
  if (w.unseen.length >= UNSEEN_ALERT && !w.alerted) {
    w.alerted = true;
    await tellOwner(sid, `⚠️ <b>ولي أمر الطالب «${esc(await nameOf(sid))}» ما فتح آخر ${w.unseen.length} درجات</b>\nما داس «✅ استلمت» عليهن. يمكن الطالب دا يمسح رسائل البوت من موبايل أهله، فتأكد وياهم.`);
  }
  await save(sid, w);
}

/** ولي الأمر داس «استلمت»: لازم يكون هو ولي أمر صاحب الورقة */
export async function guardianSeen(gid: number, itemId: number): Promise<string> {
  const it = await one("sched_items", { id: itemId });
  if (!it || !await one("guardians", { guardian_id: gid, student_id: it.user_id })) return "هذي الدرجة مو لطالب مربوط بيك";
  const w = await load(it.user_id);
  w.unseen = [];
  w.lastSeen = stamp();
  w.alerted = false;
  await save(it.user_id, w);
  return "✅ شكراً، وصلتنا";
}

/** ولي الأمر سوى بلوك للبوت: خبر لصاحب البوت ومرة وحدة للطالب */
export async function guardianBlocked(gid: number) {
  for (const g of await find("guardians", { guardian_id: gid })) {
    const w = await load(g.student_id);
    if (w.blockedAt) continue;
    w.blockedAt = stamp();
    await save(g.student_id, w);
    const name = await nameOf(g.student_id);
    await tellOwner(g.student_id, `⛔ <b>ولي أمر الطالب «${esc(name)}» سوى بلوك للبوت</b>\nدرجاته ما توصل لأهله. تواصل وياهم.`);
    await send(g.student_id, "⚠️ <b>ولي أمرك ما يستلم درجاتك</b>، لأن البوت انحظر من موبايله. لازم يرجع يفتح البوت ويدوس Start.");
  }
}

/** ولي الأمر رجع فتح البوت بعد البلوك */
export async function guardianBack(gid: number) {
  for (const g of await find("guardians", { guardian_id: gid })) {
    const w = await load(g.student_id);
    if (!w.blockedAt) continue;
    w.blockedAt = null;
    await save(g.student_id, w);
    await tellOwner(g.student_id, `✅ ولي أمر الطالب «${esc(await nameOf(g.student_id))}» رجع فتح البوت.`);
  }
}

/** تليگرام يگول منو حظر البوت أو رجع فتحه (my_chat_member) */
export async function onMemberUpdate(u: any) {
  const uid = Number(u?.from?.id ?? u?.chat?.id);
  const status = String(u?.new_chat_member?.status ?? "");
  if (!uid || u?.chat?.type !== "private") return;
  if (status === "kicked") await guardianBlocked(uid);
  else if (status === "member") await guardianBack(uid);
}
