// حساب جدول الامتحانات: بدون قاعدة بيانات حتى ينفحص لوحده. الأيام: 0 = الاثنين، مثل DAYS بالإعدادات
export type SchedSettings = { window: number; extra: number; excWindow: number; optionalOpen: boolean; perDay: number; gap: number; holidayStart: string; holidayDays: number; blockedHours: number[]; excluded: string[]; gallery: boolean };
export const DEFAULT_SETTINGS: SchedSettings = { window: 15, extra: 15, excWindow: 60, optionalOpen: true, perDay: 2, gap: 30, holidayStart: "", holidayDays: 0, blockedHours: [], excluded: [], gallery: false };
export type PlanExam = { id: number; minutes: number };
export type PlanItem = { examId: number; at: string };
export type Plan = { ok: true; items: PlanItem[]; days: number; maxPerDay: number; perWeek: number } | { ok: false; error: string; minWeekdays?: number };

const DAY_MS = 86400000;
const parse = (d: string) => new Date(d + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmt(new Date(parse(d).getTime() + n * DAY_MS));
export const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && fmt(parse(d)) === d;
export const weekdayOf = (d: string) => (parse(d).getUTCDay() + 6) % 7;
const p2 = (n: number) => String(n).padStart(2, "0");

export function inHoliday(day: string, s: SchedSettings) {
  if (!s.holidayStart || s.holidayDays <= 0) return false;
  return day >= s.holidayStart && day < addDays(s.holidayStart, s.holidayDays);
}
/** الأيام اللي يصير بيها امتحان ضمن المدة */
export function availableDays(start: string, end: string, weekdays: number[], s: SchedSettings) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d)) && !inHoliday(d, s) && !s.excluded.includes(d)) out.push(d);
  return out;
}
/** أقل عدد أيام بالأسبوع يكفي لهالعدد من الامتحانات */
function neededWeekdays(n: number, start: string, end: string, s: SchedSettings, perDay: number) {
  for (let k = 1; k <= 7; k++) {
    // أكثر الأيام توفراً هو أحسن اختيار ممكن لـ k يوم بالأسبوع
    const counts = [0, 1, 2, 3, 4, 5, 6].map((w) => availableDays(start, end, [w], s).length).sort((a, b) => b - a);
    if (counts.slice(0, k).reduce((t, c) => t + c, 0) * perDay >= n) return k;
  }
  return null;
}
/** يوزع الامتحانات بالتساوي على الأيام المتاحة. الامتحان الثاني بنفس اليوم يبدي بعد نهاية اللي قبله */
export function buildPlan(exams: PlanExam[], o: { start: string; end: string; weekdays: number[]; hour: number; perDay: number; settings: SchedSettings }): Plan {
  const { start, end, weekdays, hour, perDay, settings: s } = o;
  if (!exams.length) return { ok: false, error: "ماكو امتحانات تنحسب بالجدول." };
  if (end < start) return { ok: false, error: "تاريخ النهاية لازم يكون بعد البداية." };
  if (!weekdays.length) return { ok: false, error: "اختار أيام الامتحان." };
  if (s.blockedHours.includes(hour)) return { ok: false, error: "هذي الساعة موقوفة من الإدارة، اختار غيرها." };
  const days = availableDays(start, end, weekdays, s);
  const n = exams.length;
  if (days.length * perDay < n) {
    const k = neededWeekdays(n, start, end, s, perDay);
    if (k === null) return { ok: false, error: `عندك ${n} امتحان، والمدة ما تكفي حتى لو اخترت كل الأيام. مدد تاريخ النهاية.` };
    return { ok: false, minWeekdays: k, error: `عندك ${n} امتحان، وهالأيام تكفي لـ ${days.length * perDay} بس. اختار ${k} أيام بالأسبوع على الأقل، أو مدد تاريخ النهاية.` };
  }
  const perDayIdx = new Map<number, PlanExam[]>();
  exams.forEach((e, i) => {
    const di = Math.floor((i * days.length) / n);
    perDayIdx.set(di, [...(perDayIdx.get(di) ?? []), e]);
  });
  const items: PlanItem[] = [];
  let maxPerDay = 0;
  for (const [di, list] of [...perDayIdx].sort((a, b) => a[0] - b[0])) {
    maxPerDay = Math.max(maxPerDay, list.length);
    let minute = hour * 60;
    for (const e of list) {
      while (s.blockedHours.includes(Math.floor(minute / 60))) minute = (Math.floor(minute / 60) + 1) * 60;
      if (minute >= 24 * 60) return { ok: false, error: "الامتحانات ما تلحك بنفس اليوم. اختار ساعة أبكر." };
      items.push({ examId: e.id, at: `${days[di]} ${p2(Math.floor(minute / 60))}:${p2(minute % 60)}` });
      minute += e.minutes + s.gap;
    }
  }
  const weeks = Math.max(1, Math.ceil((parse(end).getTime() - parse(start).getTime() + DAY_MS) / (7 * DAY_MS)));
  return { ok: true, items, days: days.length, maxPerDay, perWeek: Math.ceil(n / weeks) };
}
/** وقت بعد الدقايق، بنفس صيغة at */
export function addMinutes(at: string, m: number) {
  const d = new Date(at.replace(" ", "T") + ":00Z");
  return new Date(d.getTime() + m * 60000).toISOString().slice(0, 16).replace("T", " ");
}
export type ItemState = "locked" | "open" | "missed" | "done";
export function itemState(status: string, at: string, window: number, now: string): ItemState {
  if (status === "done") return "done";
  if (now < at) return "locked";
  return now < addMinutes(at, window) ? "open" : "missed";
}

// ---------- أي نسخة ياخذ الطالب
type V = { id: number; kind: string; ok: unknown };
/** الإجباري: النسخة المحددة للمجموعة بهذا الامتحان، أو للجدول الخاص. إذا ما انحددت، أول نسخة جاهزة */
export function pickMandatory(versions: V[], wanted: number | null | undefined) {
  const ready = versions.filter((v) => v.kind === "mandatory" && v.ok);
  return ready.find((v) => v.id === wanted)?.id ?? ready[0]?.id ?? null;
}
/** الاختياري: نسخة وحدة تنفتح هي، وأكثر من وحدة عشوائي لكل طالب */
export function pickOptional(versions: V[], random = Math.random) {
  const ready = versions.filter((v) => v.kind === "optional" && v.ok);
  return ready.length ? ready[Math.floor(random() * ready.length)].id : null;
}
/** الفصول اللي يفتحها المنتج: «الفصل الرابع والخامس» ينباعون سوية */
export function labelChapters(label: string) {
  const m = /^الفصل (\S+) و(\S+)$/.exec(label);
  return m ? [`الفصل ${m[1]}`, `الفصل ${m[2]}`] : [label];
}

// ---------- أوقات المجموعة بالأسبوع
export type Slot = { d: number; t: string };
export type DaySlots = { d: number; times: string[] };
/** المواعيد مرتبة: كل يوم بترتيب الأسبوع، وتحته أوقاته من الأبكر */
export function groupSlots(slots: Slot[], week: number[]): DaySlots[] {
  return week.filter((d) => slots.some((x) => x.d === d)).map((d) => ({ d, times: [...new Set(slots.filter((x) => x.d === d).map((x) => x.t))].sort() }));
}
/** نسخة غير لكل وقت بنفس اليوم: تبدي من start وتمشي بالترتيب، فما يتكرر نفس الحرف بوقتين إذا النسخ تكفي */
export function spreadVersions(times: string[], ids: number[], start: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  times.forEach((t, k) => { out[t] = ids[(start + k) % ids.length]; });
  return out;
}
/** ترجع مواعيد للحفظ. الوقت الفاضي والمكرر ينشال */
export function flattenDays(days: DaySlots[]): Slot[] {
  return days.flatMap((x) => [...new Set(x.times.filter(Boolean))].sort().map((t) => ({ d: x.d, t })));
}
/** أيام الامتحان المتتالية من تاريخ البداية: كل يوم إله أوقات بالمكان ينحسب امتحان واحد، بدون العطلة */
export function slotDays(slots: Slot[], start: string, count: number, s: SchedSettings) {
  const out: string[] = [];
  const weekdays = new Set(slots.map((x) => x.d));
  if (!weekdays.size) return out;
  for (let d = start, guard = 0; out.length < count && guard < 3000; d = addDays(d, 1), guard++) {
    if (weekdays.has(weekdayOf(d)) && !inHoliday(d, s) && !s.excluded.includes(d)) out.push(d);
  }
  return out;
}
/** موعد الامتحان بالوقت اللي اختاره الطالب لهذا اليوم من الأسبوع */
export const pickedAt = (day: string, picks: Record<string, string>) => { const t = picks[String(weekdayOf(day))]; return t ? `${day} ${t}` : null; };
/** آخر وقت لرفع الأجوبة: وقت الحل، وفوقه الوقت الإضافي للطالب الإلكتروني */
export const answersClose = (startedAt: string, minutes: number, extra: number) => addMinutes(startedAt, minutes + extra);
/** 14:30 تصير 2:30 مساءً */
export function ampm(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "صباحاً" : "مساءً"}`;
}
export const prettyAt = (at: string) => `${at.slice(0, 10)} · ${ampm(at.slice(11))}`;
