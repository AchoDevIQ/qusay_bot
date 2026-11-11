// اللي يفتحه الشراء للطالب، ربط ولي الأمر، وسجل عمليات الطالب
import { find, insert, kvGet, kvSet, one, put, type Row } from "./db.ts";
import { firstRoundOnly } from "./orderRules.ts";
import { stamp } from "./util.ts";
import { guardianCode, verifyGuardianCode } from "./webAuth.ts";

/** خطأ بالسجل ما لازم يوقف البيع أو الطلب */
export async function logActivity(uid: number, what: string) {
  try { await insert("activity", { user_id: uid, what, created: stamp() }); } catch (e) { console.error(e); }
}
export const activityOf = async (uid: number, limit = 100) =>
  (await find("activity", { user_id: uid }, { order: ["-id"], limit })).map((r) => ({ what: r.what, created: r.created }));

/** الطلبات اللي تخص تسجيله الحالي: الملغية، واللي قبل حذف تسجيله، ما تنحسب */
async function liveItems(uid: number): Promise<string[]> {
  const s = await one("students", { user_id: uid });
  const rows = await find("orders", { user_id: uid }, { where: (o) => o.printed !== 2 && (!s || String(o.created) >= String(s.created)) });
  return rows.flatMap((o) => (JSON.parse(o.items || "[]") as Row[]).map((i) => String(i.name)));
}
/** الافتراضي: المحاضرات والامتحانات تعطي حق السؤال، وصاحب البوت يغيرها لكل منتج */
export const askDefault = (p: Row) => (p.ask === null || p.ask === undefined ? firstRoundOnly(p.name) : !!p.ask);
export async function canAsk(uid: number) {
  const names = await liveItems(uid);
  if (!names.length) return false;
  const byName = new Map((await find("products")).map((p) => [String(p.name), p]));
  return names.some((n) => { const p = byName.get(n); return p ? askDefault(p) : firstRoundOnly(n); });
}
export const boughtLectures = async (uid: number) => (await liveItems(uid)).some((n) => n.includes("محاضر") && !n.includes("دفتر"));
export const boughtCourse = async (uid: number) => (await liveItems(uid)).some(firstRoundOnly);

// ---------- ولي الأمر
export const guardianOf = async (sid: number) => (await find("guardians", { student_id: sid }))[0] ?? null;
export const childrenOf = async (gid: number) => await find("guardians", { guardian_id: gid });
export const isGuardian = async (gid: number) => (await childrenOf(gid)).length > 0;
/** سلّم أول امتحان (مو امتحان تجربة): من هنا لازم يربط ولي أمره */
export const tookExam = async (uid: number) => (await find("sched_items", { user_id: uid, status: "done" })).some((i) => i.notified !== "test");
/** حسابه مقفول: امتحن وبعده ما ربط ولي أمره. طلاب التجربة (أرقامهم سالبة) ما ينقفلون، حتى صاحب البوت يجرب بيهم */
export const needsGuardian = async (uid: number) => uid > 0 && await tookExam(uid) && !await guardianOf(uid);
/** الرسالة اللي يحولها الطالب لولي أمره: خطوتين بس، بكلام بسيط لكبار السن */
export const guardianText = (name: string) => `السلام عليكم، آني ${name}.\nاربطوا حسابكم ويا حسابي حتى توصلكم درجاتي أول بأول:\n١- دوسوا الرابط الأزرق جوة.\n٢- دوسوا الزر الأزرق «START» أو «ابدأ».\nبس هذا، ما تكتبون أي شي 🌷`;
/** زر «انسخ» بالتليجرام ياخذ 256 حرف بس: إذا الاسم طويل تنسخ نسخة أقصر، والرابط يبقى كامل */
export function guardianCopy(name: string, link: string) {
  const full = `${guardianText(name)}\n${link}`;
  return full.length <= 256 ? full : `السلام عليكم، آني ${name}. دوسوا الرابط وبعدها الزر الأزرق START حتى توصلكم درجاتي أول بأول 🌷\n${link}`;
}
/** معرف صاحب البوت (مثل @qusay1111)، ياخذه من حسابه بالتليجرام نفسه، ويتجدد كل يوم */
export async function ownerHandle(): Promise<string> {
  try {
    const c = JSON.parse(await kvGet("owner_handle") ?? "{}");
    if (c.h && Date.now() - Number(c.at) < 864e5) return c.h;
    const { api } = await import("./telegram.ts");
    const { ADMIN_IDS } = await import("./config.ts");
    const u = await api("getChat", { chat_id: ADMIN_IDS[0] });
    const h = u?.username ? `@${u.username}` : c.h ?? "";
    if (h) await kvSet("owner_handle", JSON.stringify({ h, at: Date.now() }));
    return h;
  } catch { return ""; }
}
/** ولي الأمر يكتب للبوت: البوت مو للمراسلة، ويطلعله معرف الأستاذ */
export async function notForChatText() {
  const h = await ownerHandle();
  const { ADMIN_IDS } = await import("./config.ts");
  return `⚠️ <b>هذا البوت مو للمراسلة</b>\nعليه بس توصلكم درجات ابنكم أو بنتكم أول بأول، والرسائل اللي تنكتب هنا محد يقراها.\nإذا تريدون تستفسرون عن أي شي، راسلوا الأستاذ قصي العميري على هذا المعرف 👇\n${h || `<a href="tg://user?id=${ADMIN_IDS[0]}">قصي العميري</a>`}`;
}
/** رسالة الطالب بالمحادثة: الرسالة الجاهزة، وزرين «حوّل» و«انسخ» */
export async function sendGuardianAsk(sid: number) {
  const s = await one("students", { user_id: sid });
  const link = await guardianLink(sid);
  const name = String(s?.name ?? "").trim() || "ابنكم";
  const text = guardianText(name);
  const { send } = await import("./telegram.ts");
  await send(sid, "🔒 <b>حسابك مقفول لحد ما تربط ولي أمرك</b>\nحتى توصل درجاتك لأهلك. سهلة:\n١- دوس «📤 حوّل لولي أمرك» واختار ولي أمرك من القائمة.\n٢- ولي أمرك يدوس الرابط، وبعدها الزر الأزرق «START».\n٣- يوصلك هنا «✅ انربط ولي أمرك»، وينفتح حسابك.", {
    kb: [[{ text: "📤 حوّل لولي أمرك", url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}` }], [{ text: "📋 انسخ الرسالة والرابط", copy_text: { text: guardianCopy(name, link) } }]],
  });
}
export async function guardianLink(sid: number) {
  return `https://t.me/${await kvGet("bot_username") || "Qusay_Alomairi_Bot"}?start=par_${guardianCode(sid)}`;
}
/** يرجع اسم الطالب إذا انربط، أو سبب الرفض */
export async function linkGuardian(gid: number, code: string): Promise<{ name?: string; sid?: number; error?: string }> {
  const sid = verifyGuardianCode(code);
  const s = sid === null ? null : await one("students", { user_id: sid });
  if (!s) return { error: "⚠️ هذا الرابط مو صحيح. اطلب من الطالب يدز الرابط مرة ثانية." };
  if (sid === gid) return { error: "⚠️ هذا الرابط لولي الأمر، مو للطالب. دزه لولي أمرك وخليه هو يضغطه." };
  const old = await guardianOf(sid!);
  if (old && old.guardian_id !== gid) return { error: "⚠️ هذا الطالب مربوط بولي أمر ثاني. إذا تريد تغيره تواصل ويا قصي العميري." };
  await put("guardians", { guardian_id: gid, student_id: sid, created: stamp() });
  if (!old) await logActivity(sid!, "👨‍👧 انربط ولي الأمر");
  return { name: s.name, sid: sid! };
}
