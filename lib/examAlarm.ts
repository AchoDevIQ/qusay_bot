// ⏰ منبه الامتحانات (طلبه 2026-11-25): منبه حقيقي على موبايل الطالب يرن وحده قبل كل امتحان وبوقته،
// مثل منبه الدوام، ويا ملاحظة «هسه عندك امتحان». المواعيد تنحسب وحدها من جدوله، فإذا تبدل موعد امتحان
// (مثلاً من الأربعاء للسبت، أو من الساعة 4 للـ6) المنبه يتبدل وحده أول ما يفتح التطبيق.
// الأستاذ يحدد شوكت يرن (قبل كم دقيقة، والليلة اللي قبل)، والطالب يختار النغمة من النغمات اللي جوه التطبيق.
import { createHash } from "node:crypto";
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { files } from "./files.ts";
import { addMinutes } from "./scheduleRules.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

/** النغمات اللي جوه التطبيق (ملفاتها بالتطبيق نفسه، ونسخة للسماع بـ public/alarm-tones) */
export const TONES = [
  { id: "soft", name: "🎵 نغمة هادئة" },
  { id: "bell", name: "🔔 جرس" },
  { id: "beep", name: "⏰ منبه" },
] as const;
export type ToneId = string;
/** نغمة: اللي جوه التطبيق (soft/bell/beep)، أو نغمة ضافها الأستاذ (صوته أو موسيقى) تنزل للموبايل وحدها.
 *  url للسماع بالصفحة، وللنغمات المضافة التطبيق ينزلها منه. v يتغير إذا تغير الملف */
export type Tone = { id: string; name: string; url: string; custom?: boolean };
type Custom = { id: string; name: string; ref: string };
const CUSTOM = "alarm_tones";
const builtIn = (t: { id: string; name: string }): Tone => ({ ...t, url: `/alarm-tones/tone_${t.id}.mp3` });
export const toneUrl = (id: string) => `/api/alarm/tone?id=${encodeURIComponent(id)}`;
async function customs(): Promise<Custom[]> {
  try { const l = JSON.parse((await kvGet(CUSTOM)) ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; }
}
export async function allTones(): Promise<Tone[]> {
  return [...TONES.map(builtIn), ...(await customs()).map((c) => ({ id: c.id, name: c.name, url: toneUrl(c.id), custom: true }))];
}
/** ملف النغمة المضافة (WAV) */
export async function toneFile(id: string) {
  const c = (await customs()).find((x) => x.id === id);
  return c ? files().read(c.ref) : null;
}
const TONE_MAX = 3 * 1024 * 1024, SECS_MAX = 30;
/** نغمة جديدة من الأستاذ: WAV (الصفحة تحول أي صوت لـWAV وتقصه قبل ما ترفعه)، أقل من 30 ثانية حتى يرن بالآيفون */
export async function addTone(name: unknown, b64: unknown) {
  const n = String(name ?? "").trim().slice(0, 30);
  need(n, "اكتب اسم للنغمة");
  const buf = Buffer.from(String(b64 ?? ""), "base64");
  need(buf.length > 44 && buf.length <= TONE_MAX, "النغمة لازم أصغر من 3 ميگا");
  need(buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WAVE", "الملف مو صوت");
  const byteRate = buf.readUInt32LE(28);
  need(byteRate > 0 && (buf.length - 44) / byteRate <= SECS_MAX + 0.5, "النغمة لازم أقل من 30 ثانية");
  const list = await customs();
  need(list.length < 20, "وصلت 20 نغمة. احذف وحدة أول");
  need(!list.some((c) => c.name === n) && !TONES.some((t) => t.name === n), "هذا الاسم موجود. اختار اسم ثاني");
  const h = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const id = `c${h.slice(0, 10)}`;
  need(!list.some((c) => c.id === id), "هاي النغمة نفسها مضافة من قبل");
  const ref = `alarm-tones/${h}.wav`;
  await files().write(ref, buf, "audio/wav");
  await kvSet(CUSTOM, JSON.stringify([...list, { id, name: n, ref }]));
  return id;
}
export async function delTone(id: unknown) {
  const list = await customs();
  need(list.some((c) => c.id === id), "النغمة مو موجودة");
  await kvSet(CUSTOM, JSON.stringify(list.filter((c) => c.id !== id)));
  // اللي جانت نغمته الأساسية، ترجع الأساسية «🎵 نغمة هادئة» (الطلاب اللي اختاروها يرجعون للأساسية وحدهم)
  const cfg = await alarmCfg();
  if (cfg.tone === id) await kvSet(CFG, JSON.stringify({ ...cfg, tone: "soft" }));
}
/** شوكت يرن: دقايق قبل الامتحان (0 = بوقته)، و«night» = الليلة اللي قبل الساعة 9 */
export type AlarmCfg = { on: boolean; before: number[]; night: boolean; tone: ToneId };
const CFG = "alarm_cfg";
// الأصل (طلبه 2026-11-25): يرن بوقت الامتحان بس، وهو يگدر يضيف قبله من الصفحة
const DEF: AlarmCfg = { on: true, before: [0], night: false, tone: "soft" };
export const OFFSETS = [0, 10, 30, 60, 120] as const;

export async function alarmCfg(): Promise<AlarmCfg> {
  try { const j = JSON.parse((await kvGet(CFG)) ?? "{}"); return { ...DEF, ...j }; } catch { return DEF; }
}
export async function setAlarmCfg(raw: Row) {
  const before = (Array.isArray(raw.before) ? raw.before : []).map(Number).filter((n: number) => (OFFSETS as readonly number[]).includes(n));
  const tone = (await allTones()).some((t) => t.id === raw.tone) ? String(raw.tone) : DEF.tone;
  need(before.length || raw.night, "اختار وقت واحد على الأقل يرن بيه");
  const c: AlarmCfg = { on: raw.on !== false, before: [...new Set(before)].sort((a, b) => b - a), night: !!raw.night, tone };
  await kvSet(CFG, JSON.stringify(c));
  return c;
}
const toneKey = (uid: number) => `alarm_tone_${uid}`;
export async function toneOf(uid: number): Promise<ToneId> {
  const all = await allTones(), t = await kvGet(toneKey(uid));
  if (all.some((x) => x.id === t)) return t!;
  const def = (await alarmCfg()).tone;
  return all.some((x) => x.id === def) ? def : "soft";
}
/** للتطبيق: النغمة، وإذا مضافة رابط تنزيلها */
export async function toneFor(uid: number) {
  const id = await toneOf(uid);
  return { tone: id, toneUrl: id.startsWith("c") ? toneUrl(id) : "" };
}
export async function setTone(uid: number, t: unknown) {
  need((await allTones()).some((x) => x.id === t), "اختار نغمة");
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
