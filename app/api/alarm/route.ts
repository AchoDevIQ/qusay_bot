// ⏰ منبه الامتحانات: الطالب يختار نغمته ويشوف منبهاته، والأستاذ يحدد شوكت يرن
import { addTone, alarmCfg, alarmsFor, allTones, delTone, setAlarmCfg, setTone, toneOf } from "../../../lib/examAlarm.ts";
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
    if (b.action === "cfg" || b.action === "addTone" || b.action === "delTone") need(admin, "بس صاحب البوت", 403);
    if (b.action === "cfg") await setAlarmCfg(b.cfg ?? {});
    if (b.action === "addTone") await addTone(b.name, b.data);
    if (b.action === "delTone") await delTone(b.id);
    const NOTE: Record<string, string> = { tone: "✅ انحفظت نغمتك", cfg: "✅ انحفظت أوقات المنبه", addTone: "✅ انضافت النغمة. توصل للطلاب أول ما يفتحون التطبيق", delTone: "🗑 انحذفت النغمة" };
    return Response.json({ tones: await allTones(), tone: await toneOf(uid!), alarms: await alarmsFor(uid!), admin, cfg: admin ? await alarmCfg() : null, notice: NOTE[String(b.action)] ?? "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error("alarm", e);
    return Response.json({ error: e instanceof ApiError ? e.message : "صار خطأ" }, { status: e instanceof ApiError ? e.status : 500 });
  }
}
