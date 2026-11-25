// ⏰ منبه الامتحانات: الطالب يختار نغمته ويشوف منبهاته، والأستاذ يحدد شوكت يرن
import { TONES, alarmCfg, alarmsFor, setAlarmCfg, setTone, toneOf } from "../../../lib/examAlarm.ts";
import { ApiError, ensure, need } from "../../../lib/webApi.ts";
import { verifyHomeToken } from "../../../lib/webAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const b = await req.json().catch(() => ({}));
    const uid = verifyHomeToken(b.t);
    need(uid !== null, "الرابط انتهى. افتح الصفحة من جديد", 401);
    const { isAdmin } = await import("../../../lib/data.ts");
    const admin = await isAdmin(uid!);
    if (b.action === "tone") await setTone(uid!, b.tone);
    if (b.action === "cfg") { need(admin, "بس صاحب البوت", 403); await setAlarmCfg(b.cfg ?? {}); }
    return Response.json({ tones: TONES, tone: await toneOf(uid!), alarms: await alarmsFor(uid!), admin, cfg: admin ? await alarmCfg() : null, notice: b.action === "tone" ? "✅ انحفظت نغمتك" : b.action === "cfg" ? "✅ انحفظت أوقات المنبه" : "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error("alarm", e);
    return Response.json({ error: e instanceof ApiError ? e.message : "صار خطأ" }, { status: e instanceof ApiError ? e.status : 500 });
  }
}
