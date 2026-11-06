// اللي يفتحه الشراء للطالب، ربط ولي الأمر، وسجل عمليات الطالب
import { find, insert, kvGet, one, put, type Row } from "./db.ts";
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
