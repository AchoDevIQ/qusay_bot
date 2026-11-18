// المقاعد بكل وقت (طلب الأستاذ 2026-11-18): كل وقت من أوقات المكان (يوم + ساعة) إله عدد بنين وعدد بنات.
// كل اللي يمتحنون بذاك الوقت ينحسبون: جروب «ويا الطلاب» اللي اختاروه، وطلاب الجدول الخاص والتعويض اللي امتحانهم بنفس المكان والساعة.
// من يكمل العدد، الطالب ما يگدر يختاره ولا ينتقل إله. صاحب البوت يگدر يعبره بعد تنبيه. بدون عدد = بدون حد
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { DAYS } from "./config.ts";
import { ampm, weekdayOf } from "./scheduleRules.ts";
import { stamp } from "./util.ts";

export type Sex = "b" | "g";
export type Limit = { b: number; g: number };
const key = (center: number) => `seats_${center}`;
export const SEX_LABEL: Record<Sex, string> = { b: "بنين", g: "بنات" };

/** بنين لو بنات: من البوت («بنين/بنات») أو من التطبيق («ذكر/أنثى») */
export function sexOf(st: Row | null | undefined): Sex | null {
  const g = String(st?.gender ?? "").trim().toLowerCase();
  if (["بنين", "ذكر", "male", "m", "boy"].includes(g)) return "b";
  if (["بنات", "أنثى", "انثى", "female", "f", "girl"].includes(g)) return "g";
  return null;
}

export async function seatLimits(center: number): Promise<Record<string, Limit>> {
  try { const j = JSON.parse(await kvGet(key(center)) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; }
}
export async function setSeatLimits(center: number, raw: unknown) {
  const out: Record<string, Limit> = {};
  for (const [k, v] of Object.entries((raw && typeof raw === "object" ? raw : {}) as Record<string, Row>)) {
    if (!/^\d\|\d{2}:\d{2}$/.test(k)) continue;
    const n = (x: unknown) => { const i = Math.floor(Number(x)); return Number.isFinite(i) && i > 0 ? Math.min(i, 5000) : 0; };
    const lim = { b: n(v?.b), g: n(v?.g) };
    if (lim.b || lim.g) out[k] = lim;
  }
  await kvSet(key(center), JSON.stringify(out));
  return out;
}

/** مكان امتحان الطالب: مركزه إذا حضوري، و0 للإلكتروني */
const placeOf = (st: Row) => (st.exam === "حضوري" ? Number(st.center_id ?? -1) : 0);

type Count = { b: number; g: number };
/** منو قاعد بكل وقت بهذا المكان: الجروبات (يوم|ساعة) والامتحانات بتاريخها (تاريخ ساعة) */
async function occupancy(center: number, except?: number) {
  const students = new Map((await find("students")).map((s) => [s.user_id as number, s]));
  const scheds = new Map((await find("schedules")).map((s) => [s.user_id as number, s]));
  const groups = new Map<string, Count>(), dated = new Map<string, Count>();
  const add = (m: Map<string, Count>, k: string, sx: Sex) => { const c = m.get(k) ?? { b: 0, g: 0 }; c[sx]++; m.set(k, c); };
  const picksOf = (sc: Row | undefined): Record<string, string> => { try { return sc?.mode === "general" ? JSON.parse(sc.picks || "{}") : {}; } catch { return {}; } };
  for (const [uid, sc] of scheds) {
    if (uid === except || sc.mode !== "general" || Number(sc.center_id) !== center) continue;
    const sx = sexOf(students.get(uid));
    if (sx) for (const [d, t] of Object.entries(picksOf(sc))) add(groups, `${d}|${t}`, sx);
  }
  const now = stamp();
  for (const i of await find("sched_items", { status: "waiting" })) {
    const uid = i.user_id as number, st = students.get(uid);
    if (uid === except || !st || i.kind === "optional" || i.notified === "test" || String(i.at ?? "") <= now) continue;
    if (placeOf(st) !== center) continue;
    const sc = scheds.get(uid), at = String(i.at);
    // طالب الجروب ينحسب بجروبه، إلا امتحان انحط بغير وقت جروبه (تعويض، أو انحط باليد)
    if (sc?.mode === "general" && picksOf(sc)[String(weekdayOf(at.slice(0, 10)))] === at.slice(11, 16)) continue;
    const sx = sexOf(st);
    if (sx) add(dated, at.slice(0, 16), sx);
  }
  return { groups, dated };
}

type Occ = Awaited<ReturnType<typeof occupancy>>;
function problemIn(occ: Occ, lim: Limit | undefined, sx: Sex | null, d: number, t: string, date?: string) {
  if (!sx || !lim || !lim[sx]) return "";
  const group = occ.groups.get(`${d}|${t}`)?.[sx] ?? 0;
  let extra = 0;
  if (date) extra = occ.dated.get(`${date} ${t}`)?.[sx] ?? 0;
  else for (const [k, c] of occ.dated) if (k.slice(11, 16) === t && weekdayOf(k.slice(0, 10)) === d) extra = Math.max(extra, c[sx]);
  const taken = group + extra;
  return taken >= lim[sx] ? `⛔ وقت ${DAYS[d]} ${ampm(t)} مكتمل للـ${SEX_LABEL[sx]} (${taken} من ${lim[sx]}). اختار وقت ثاني` : "";
}
/** هذا الوقت بيه مكان لهذا الطالب؟ يرجع سبب المنع، أو "" إذا بيه مكان.
 *  date: امتحان بيوم معين (الجدول الخاص والتعويض). بدونه: جروب اليوم كله، فينحسب أزحم يوم جاي بنفس اليوم والساعة */
export async function seatProblem(center: number, d: number, t: string, st: Row | null | undefined, opts: { date?: string; except?: number } = {}) {
  const sx = sexOf(st);
  const lim = (await seatLimits(center))[`${d}|${t}`];
  if (!sx || !lim || !lim[sx]) return "";
  return problemIn(await occupancy(center, opts.except), lim, sx, d, t, opts.date);
}
/** نفس الشي لكذا امتحان مرة وحدة (الجدول الخاص كله) */
export async function seatProblems(center: number, list: { at: string }[], st: Row | null | undefined, except?: number) {
  const sx = sexOf(st);
  const limits = await seatLimits(center);
  if (!sx || !Object.values(limits).some((l) => l[sx])) return "";
  const occ = await occupancy(center, except);
  for (const x of list) {
    const day = x.at.slice(0, 10), t = x.at.slice(11, 16), d = weekdayOf(day);
    const why = problemIn(occ, limits[`${d}|${t}`], sx, d, t, day);
    if (why) return `${why} (امتحان ${day})`;
    // اللي ينحجز هسه ينحسب على اللي بعده
    const k = `${day} ${t}`, c = occ.dated.get(k) ?? { b: 0, g: 0 }; c[sx]++; occ.dated.set(k, c);
  }
  return "";
}

/** لصفحة الإدارة: لكل وقت عدده والمحجوز منه (الجروب + أزحم يوم جاي) */
export async function seatsView(center: number, slots: { d: number; t: string }[]) {
  const limits = await seatLimits(center);
  const { groups, dated } = await occupancy(center);
  return slots.map(({ d, t }) => {
    const k = `${d}|${t}`, g = groups.get(k) ?? { b: 0, g: 0 };
    const peak = { b: 0, g: 0 };
    for (const [dk, c] of dated) if (dk.slice(11, 16) === t && weekdayOf(dk.slice(0, 10)) === d) { peak.b = Math.max(peak.b, c.b); peak.g = Math.max(peak.g, c.g); }
    return { d, t, limit: limits[k] ?? { b: 0, g: 0 }, taken: { b: g.b + peak.b, g: g.g + peak.g } };
  });
}

/** للطالب: أي أوقات مكتملة إله (حتى تطلع «مكتمل» وما يگدر يختارها) */
export async function fullTimes(center: number, slots: { d: number; t: string }[], st: Row | null | undefined, except?: number) {
  const out = new Set<string>();
  const sx = sexOf(st);
  const limits = await seatLimits(center);
  if (!sx || !slots.some((x) => limits[`${x.d}|${x.t}`]?.[sx])) return out;
  const occ = await occupancy(center, except);
  for (const x of slots) if (problemIn(occ, limits[`${x.d}|${x.t}`], sx, x.d, x.t)) out.add(`${x.d}|${x.t}`);
  return out;
}
