// تقارير أعطال تطبيق الطلاب (طلب الأستاذ 2026-11-16: «هاي لا تنساها، كلش مهمة»): إذا التطبيق وگع أو علگ بتلفون طالب،
// يوصل خبر للأستاذ (واللي عنده صلاحية 📱) باسم الطالب ونوع تلفونه ونسخة النظام والشاشة والخطأ، بدون ما الطالب يگول.
// التطبيق يدز ثلاث أشياء: start (انفتح)، home (وصل للرئيسية)، crash (خطأ). اللي انفتح وما وصل للرئيسية بعشر دقايق = علگ.
// كل تلفون إله رقم تنصيب (install) ينحفظ بالتطبيق، وينربط باسم الطالب من أول مرة يدز رمز دخوله
import { find, insert, kvGet, kvSet, update, type Row } from "./db.ts";
import { staffIds, student } from "./data.ts";
import { send } from "./telegram.ts";
import { addMinutes } from "./scheduleRules.ts";
import { stamp } from "./util.ts";

export const CRASH_PERM = "appcrash";
const STUCK_MIN = 10;
const MAX_PER_HOUR = 30;       // من نفس التلفون: أكثر من هيچ يعني حلقة أخطاء، ما ينحفظ
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export type CrashIn = { kind: string; install: string; uid: number | null; model: string; os: string; ver: string; screen: string; error: string; stack: string; fatal: boolean };

/** رقم الطالب لهذا التلفون: من رمز دخوله هسه، أو من آخر مرة دز رمزه */
async function uidOf(install: string, uid: number | null) {
  if (uid) { await kvSet(`app_install_${install}`, String(uid)); return uid; }
  return Number(await kvGet(`app_install_${install}`)) || null;
}
const who = async (uid: number | null) => (uid ? `${esc(String((await student(uid))?.name ?? "طالب"))} (${uid})` : "طالب ما مسجل دخول بعد");
const device = (r: { model: string; os: string; ver: string }) => `📱 ${esc(r.model || "تلفون")} · ${esc(r.os || "")} · نسخة التطبيق ${esc(r.ver || "")}`;
async function tell(text: string) { for (const id of await staffIds(CRASH_PERM)) await send(id, text).catch((e) => console.error("crash alert", e)); }

export async function appReport(r: CrashIn) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(r.install)) return { ok: false };
  const now = stamp();
  const uid = await uidOf(r.install, r.uid);
  // حد لكل تلفون، حتى خطأ يتكرر بحلقة ما يغرق الرسائل
  const hourKey = `app_crash_rate_${r.install}_${now.slice(0, 13)}`;
  const n = Number(await kvGet(hourKey)) || 0;
  if (n >= MAX_PER_HOUR) return { ok: true };
  await kvSet(hourKey, String(n + 1));
  const base = { install: r.install, uid, model: cut(r.model, 80), os: cut(r.os, 60), ver: cut(r.ver, 30) };
  if (r.kind === "start") {
    await insert("app_crashes", { ...base, kind: "start", screen: "", error: "", stack: "", at: now, home_at: null, told: null });
    return { ok: true };
  }
  if (r.kind === "home") {
    // آخر فتحة لهذا التلفون وصلت للرئيسية
    const open = (await find("app_crashes", { install: r.install, kind: "start" })).filter((x) => !x.home_at).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    if (open) await update("app_crashes", { id: open.id }, { home_at: now, uid });
    return { ok: true };
  }
  if (r.kind !== "crash") return { ok: false };
  const error = cut(r.error, 1500), stack = cut(r.stack, 4000), screen = cut(r.screen, 120);
  await insert("app_crashes", { ...base, kind: "crash", screen, error, stack, at: now, home_at: null, told: null });
  // نفس الخطأ من نفس الطالب: خبر وحد باليوم
  const sig = `app_crash_told_${uid ?? r.install}_${now.slice(0, 10)}_${error.slice(0, 80).replace(/\W+/g, "")}`;
  if (await kvGet(sig)) return { ok: true };
  await kvSet(sig, "1");
  await tell(`💥 <b>التطبيق ${r.fatal ? "انسد" : "طلع بيه خطأ"} عند طالب</b>
👤 ${await who(uid)}
${device(base)}${screen ? `\n📍 الشاشة: ${esc(screen)}` : ""}
⚠️ ${esc(error.slice(0, 400))}`);
  return { ok: true };
}

/** دكة المؤقت: التطبيق انفتح وما وصل للرئيسية بعشر دقايق = علگ (شاشة بيضة، أو انسد قبل ما يبين) */
export async function stuckTick(now = stamp()) {
  const before = addMinutes(now, -STUCK_MIN), since = addMinutes(now, -24 * 60);
  const stuck = (await find("app_crashes", { kind: "start" })).filter((x) => !x.home_at && !x.told && String(x.at) <= before && String(x.at) >= since);
  let told = 0;
  for (const x of stuck) {
    await update("app_crashes", { id: x.id }, { told: now });
    // نفس التلفون ما ينعاد خبره بنفس اليوم، والفتحة اللي بعدها وصلت للرئيسية تعني صار تمام
    const later = (await find("app_crashes", { install: x.install, kind: "start" })).some((y) => String(y.at) > String(x.at) && y.home_at);
    const key = `app_stuck_told_${x.install}_${String(x.at).slice(0, 10)}`;
    if (later || await kvGet(key)) continue;
    await kvSet(key, "1");
    await tell(`🧊 <b>التطبيق ما فتح عند طالب</b> (انفتح وما وصل للرئيسية بـ ${STUCK_MIN} دقايق)
👤 ${await who(x.uid as number | null)}
${device({ model: String(x.model ?? ""), os: String(x.os ?? ""), ver: String(x.ver ?? "") })}
🕐 ${String(x.at)}`);
    told++;
  }
  return told;
}

/** أعطال طالب واحد لملفه: آخر 20 */
export async function crashesOf(uid: number): Promise<Row[]> {
  return (await find("app_crashes", { uid, kind: "crash" })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20)
    .map((x) => ({ at: x.at, model: x.model, os: x.os, ver: x.ver, screen: x.screen, error: x.error }));
}
