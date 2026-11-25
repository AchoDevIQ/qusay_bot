// ⏰ منبه الامتحانات (طلبه 2026-11-25): منبه حقيقي على موبايل الطالب يرن وحده قبل كل امتحان وبوقته،
// مثل منبه الدوام، ويا ملاحظة «هسه عندك امتحان». المواعيد تنحسب وحدها من جدوله، فإذا تبدل موعد امتحان
// (مثلاً من الأربعاء للسبت، أو من الساعة 4 للـ6) المنبه يتبدل وحده أول ما يفتح التطبيق.
// الأستاذ يحدد شوكت يرن (قبل كم دقيقة، والليلة اللي قبل)، والطالب يختار النغمة من النغمات اللي جوه التطبيق.
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { addMinutes } from "./scheduleRules.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

/** النغمات اللي جوه التطبيق (ملفاتها بالتطبيق نفسه، ونسخة للسماع بـ public/alarm-tones) */
export const TONES = [
  { id: "soft", name: "🎵 نغمة هادئة" },
  { id: "bell", name: "🔔 جرس" },
  { id: "beep", name: "⏰ منبه" },
] as const;
export type ToneId = (typeof TONES)[number]["id"];
/** شوكت يرن: دقايق قبل الامتحان (0 = بوقته)، و«night» = الليلة اللي قبل الساعة 9 */
export type AlarmCfg = { on: boolean; before: number[]; night: boolean; tone: ToneId };
const CFG = "alarm_cfg";
const DEF: AlarmCfg = { on: true, before: [60, 0], night: false, tone: "soft" };
export const OFFSETS = [0, 10, 30, 60, 120] as const;

export async function alarmCfg(): Promise<AlarmCfg> {
  try { const j = JSON.parse((await kvGet(CFG)) ?? "{}"); return { ...DEF, ...j }; } catch { return DEF; }
}
export async function setAlarmCfg(raw: Row) {
  const before = (Array.isArray(raw.before) ? raw.before : []).map(Number).filter((n: number) => (OFFSETS as readonly number[]).includes(n));
  const tone = TONES.some((t) => t.id === raw.tone) ? raw.tone as ToneId : DEF.tone;
  need(before.length || raw.night, "اختار وقت واحد على الأقل يرن بيه");
  const c: AlarmCfg = { on: raw.on !== false, before: [...new Set(before)].sort((a, b) => b - a), night: !!raw.night, tone };
  await kvSet(CFG, JSON.stringify(c));
  return c;
}
const toneKey = (uid: number) => `alarm_tone_${uid}`;
export async function toneOf(uid: number): Promise<ToneId> {
  const t = await kvGet(toneKey(uid));
  return TONES.some((x) => x.id === t) ? t as ToneId : (await alarmCfg()).tone;
}
export async function setTone(uid: number, t: unknown) {
  need(TONES.some((x) => x.id === t), "اختار نغمة");
  await kvSet(toneKey(uid), String(t));
}

const when = (m: number) => (m >= 60 ? (m === 60 ? "ساعة" : m === 120 ? "ساعتين" : `${m / 60} ساعات`) : `${m} دقيقة`);
/** «2026-12-01 16:00» بتوقيت بغداد ← ISO */
const iso = (at: string) => `${at.replace(" ", "T").slice(0, 16)}:00+03:00`;

/** منبهات الطالب الجاية (أقصى شي 40): من امتحاناته اللي بعدها ما صارت */
export async function alarmsFor(uid: number, now = stamp()) {
  const cfg = await alarmCfg();
  if (!cfg.on) return [];
  const exams = new Map((await find("bank_exams")).map((e) => [Number(e.id), String(e.title ?? "")]));
  const out: { key: string; at: string; title: string; body: string }[] = [];
  for (const it of await find("sched_items", { user_id: uid })) {
    if (it.status !== "waiting" || !it.at || String(it.at) <= now) continue;
    const at = String(it.at).slice(0, 16), title = exams.get(Number(it.exam_id)) ?? "امتحانك";
    for (const m of cfg.before) {
      const t = addMinutes(at, -m);
      if (t <= now) continue;
      out.push({ key: `${it.id}-${m}`, at: iso(t), title: m ? `⏰ امتحانك بعد ${when(m)}` : "📝 هسه عندك امتحان", body: m ? `«${title}». جهز نفسك.` : `«${title}» بدأ. ادخل عليه من مساري.` });
    }
    if (cfg.night) {
      const t = `${addMinutes(at, -24 * 60).slice(0, 10)} 21:00`;
      if (t > now && t < at) out.push({ key: `${it.id}-n`, at: iso(t), title: "🌙 باچر عندك امتحان", body: `«${title}» الساعة ${at.slice(11, 16)}. نام زين وجهز نفسك.` });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 40);
}
