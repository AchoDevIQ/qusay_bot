// متابعة ولي الأمر: ما نگدر نمنع الطالب يمسح البوت من موبايل أهله، بس نكشفه.
// ١. بلوك: تليگرام يگول للبوت (أو تفشل الرسالة)، فيوصل خبر لصاحب البوت والطالب.
// ٢. كل درجة توصل لولي الأمر وياها زر «✅ استلمت الدرجة». الدرجة الجديدة ما توصل لحد ما يدوس استلمت على اللي قبلها،
//    وبدالها توصله رسالة تگله يدوس استلمت. إذا ٣ درجات ما انداس عليهن (موصولة أو منتظرة)، يوصل خبر لصاحب البوت.
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, one } from "./db.ts";
import { send, wasBlocked, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";

export const UNSEEN_ALERT = 3;
type Watch = { unseen: number[]; held: number[]; lastSeen: string | null; blockedAt: string | null; alerted: boolean };
const key = (sid: number) => `guardian_watch_${sid}`;
async function load(sid: number): Promise<Watch> {
  try {
    const j = JSON.parse((await kvGet(key(sid))) ?? "{}");
    return { unseen: Array.isArray(j.unseen) ? j.unseen.map(Number) : [], held: Array.isArray(j.held) ? j.held.map(Number) : [], lastSeen: j.lastSeen ?? null, blockedAt: j.blockedAt ?? null, alerted: !!j.alerted };
  } catch { return { unseen: [], held: [], lastSeen: null, blockedAt: null, alerted: false }; }
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
/** خبر لصاحب البوت، وللمساعد اللي عنده صلاحية «👨‍👧 تنبيهات أولياء الأمور»، ووياه زر واتساب ولي الأمر */
async function tellOwner(sid: number, text: string) {
  const wa = whatsappOf((await one("students", { user_id: sid }))?.phone2);
  const kb: Kb | undefined = wa ? [[{ text: "💬 كلم ولي الأمر بالواتساب", url: wa }]] : undefined;
  let to: number[] = ADMIN_IDS;
  try { const { staffIds } = await import("./data.ts"); to = await staffIds("guardians"); } catch (e) { console.error(e); }
  for (const a of to) await send(a, wa ? text : `${text}\n\n(ماكو رقم واتساب لولي الأمر بمعلوماته)`, kb ? { kb } : {});
}

/** حالة ولي الأمر لصفحة الطلاب */
export async function guardianState(sid: number) {
  const w = await load(sid);
  return { lastSeen: w.lastSeen, unseen: w.unseen.length + w.held.length, held: w.held.length, blockedAt: w.blockedAt };
}

/** زر الاستلام: بعرض الرسالة كلها، وبكلام واضح (تليگرام ما يسمح بزر أكبر) */
export const seenButton = (itemId: number): Kb => [[{ text: "✅ استلمت الدرجة", callback_data: `gs:${itemId}` }]];
export const SEEN_CAPTION = "👇 دوسوا «✅ استلمت الدرجة» حتى نعرف وصلتكم، وتنفتحلكم الدرجة الجاية.";

/** درجة وصلت (أو انرسلت) لولي الأمر: إذا الرسالة فشلت لأنه حاظر البوت، يعتبر بلوك */
export async function guardianSent(sid: number, gid: number, itemId: number) {
  if (wasBlocked(gid)) { await guardianBlocked(gid); return; }
  const w = await load(sid);
  if (!w.unseen.includes(itemId)) w.unseen.push(itemId);
  await alertIfMany(sid, w);
  await save(sid, w);
}
/** ٣ درجات ما انداس عليهن (اللي وصلت واللي منتظرة): خبر لصاحب البوت مرة وحدة */
async function alertIfMany(sid: number, w: Watch) {
  if (w.unseen.length + w.held.length >= UNSEEN_ALERT && !w.alerted) {
    w.alerted = true;
    await tellOwner(sid, `⚠️ <b>ولي أمر الطالب «${esc(await nameOf(sid))}» ما فتح آخر ${w.unseen.length + w.held.length} درجات</b>\nما داس «✅ استلمت» عليهن. يمكن الطالب دا يمسح رسائل البوت من موبايل أهله، فتأكد وياهم.`);
  }
}

/** درجة قبلها بعده ما انداس عليها «استلمت»: رقمها، والدرجة الجديدة تنتظر */
export async function unseenBefore(sid: number) {
  const w = await load(sid);
  return w.unseen.at(-1) ?? null;
}
/** الدرجة الجديدة تنتظر: توصل لولي الأمر رسالة يدوس «استلمت» على اللي قبلها */
export async function holdGrade(sid: number, gid: number, itemId: number, prev: number) {
  const w = await load(sid);
  if (!w.held.includes(itemId)) w.held.push(itemId);
  await send(gid, `📩 <b>وصلت درجة جديدة للطالب «${esc(await nameOf(sid))}»</b>
حتى تشوفوها، دوسوا أول «✅ استلمت الدرجة» على الدرجة اللي قبلها، لأن بعدكم ما داسين عليها.
👇 أو دوسوا هنا:`,
    { kb: [[{ text: "✅ استلمت الدرجة السابقة، وراويني الجديدة", callback_data: `gs:${prev}` }]] });
  if (wasBlocked(gid)) { await save(sid, w); await guardianBlocked(gid); return; }
  await alertIfMany(sid, w);
  await save(sid, w);
}
/** أول درجة منتظرة (إذا اكو)، تنشال من الانتظار لأنها راح توصل هسه */
export async function nextHeld(sid: number) {
  const w = await load(sid);
  const id = w.held.shift() ?? null;
  if (id !== null) await save(sid, w);
  return id;
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
