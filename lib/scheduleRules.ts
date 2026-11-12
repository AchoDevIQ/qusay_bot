// حساب جدول الامتحانات: بدون قاعدة بيانات حتى ينفحص لوحده. الأيام: 0 = الاثنين، مثل DAYS بالإعدادات
export type SchedSettings = { window: number; extra: number; excWindow: number; optionalOpen: boolean; perDay: number; gap: number; holidayStart: string; holidayDays: number; holidayNote: string; blockedHours: number[]; excluded: string[]; gallery: boolean; fromHour: number; toHour: number; offDays: number[]; perWeek: number };
export const DEFAULT_SETTINGS: SchedSettings = { window: 15, extra: 15, excWindow: 60, optionalOpen: true, perDay: 2, gap: 30, holidayStart: "", holidayDays: 0, holidayNote: "", blockedHours: [], excluded: [], gallery: false, fromHour: 8, toHour: 22, offDays: [], perWeek: 4 };
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
/** times: وقت كل امتحان باليوم (الأول، الثاني...) لكل يوم من الأسبوع، يختاره الطالب. بدونه كل الامتحانات تبدي من hour */
export function buildPlan(exams: PlanExam[], o: { start: string; end: string; weekdays: number[]; hour: number; perDay: number; settings: SchedSettings; times?: Record<string, string[]>; pack?: boolean }): Plan {
  const { start, end, weekdays, hour, settings: s, times } = o;
  // كل يوم بقد الأوقات اللي اختارها إله: اليوم اللي بيه وقت واحد ما ينحطله امتحانين
  const capW = (w: number) => (times ? Math.min(o.perDay, (times[String(w)] ?? []).length) : o.perDay);
  const perDay = Math.min(...weekdays.map(capW), o.perDay);
  if (!exams.length) return { ok: false, error: "ماكو امتحانات تنحسب بالجدول." };
  if (end < start) return { ok: false, error: "تاريخ النهاية لازم يكون بعد البداية." };
  if (!weekdays.length) return { ok: false, error: "اختار أيام الامتحان." };
  if (times && perDay < 1) return { ok: false, error: "اختار وقت الامتحان لكل يوم." };
  if (!times && s.blockedHours.includes(hour)) return { ok: false, error: "هذي الساعة موقوفة من الإدارة، اختار غيرها." };
  const days = availableDays(start, end, weekdays, s);
  const n = exams.length;
  const caps = days.map((d) => capW(weekdayOf(d)));
  const room = caps.reduce((t, c) => t + c, 0);
  if (room < n) {
    const k = neededWeekdays(n, start, end, s, Math.max(1, perDay));
    const second = times && weekdays.some((w) => capW(w) < o.perDay) ? "، أو اختار وقت امتحان ثاني باليوم" : "";
    if (k === null) return { ok: false, error: `عندك ${n} امتحان، والمدة ما تكفي حتى لو اخترت كل الأيام. مدد تاريخ النهاية${second}.` };
    return { ok: false, minWeekdays: k, error: `عندك ${n} امتحان، وهالأيام تكفي لـ ${room} بس. اختار ${k} أيام بالأسبوع على الأقل، أو مدد تاريخ النهاية${second}.` };
  }
  // بالتساوي: كل دورة تنطي كل يوم بعده بيه مكان امتحان واحد، والدورة الناقصة تتوزع على طول المدة.
  // pack: الطالب اختار كم امتحان بالأسبوع، فتنملى الأيام بالترتيب من البداية لحد ما تخلص
  const counts = caps.map(() => 0);
  if (o.pack) for (let di = 0, left = n; left > 0 && di < caps.length; di++) { counts[di] = Math.min(caps[di], left); left -= counts[di]; }
  for (let r = 0, left = o.pack ? 0 : n; left > 0; r++) {
    const open = caps.flatMap((c, i) => (c > r ? [i] : []));
    const take = Math.min(left, open.length);
    for (let j = 0; j < take; j++) counts[open[Math.floor((j * open.length) / take)]]++;
    left -= take;
  }
  const perDayIdx = new Map<number, PlanExam[]>();
  let next = 0;
  counts.forEach((c, di) => { if (c) { perDayIdx.set(di, exams.slice(next, next + c)); next += c; } });
  const items: PlanItem[] = [];
  let maxPerDay = 0;
  for (const [di, list] of [...perDayIdx].sort((a, b) => a[0] - b[0])) {
    maxPerDay = Math.max(maxPerDay, list.length);
    if (times) {
      // الوقت اللي اختاره الطالب، بس لازم يكون بعد نهاية اللي قبله والفاصل
      const own = times[String(weekdayOf(days[di]))] ?? [];
      let free = -1;
      for (const [k, e] of list.entries()) {
        const m = toMinutes(own[k] ?? "");
        if (m < 0) return { ok: false, error: "اختار وقت الامتحان الثاني باليوم." };
        // كلام واضح للطالب: ليش ما ينقبل، ومن أي ساعة يگدر يختار
        if (free >= 0 && m < free) return { ok: false, error: `⏰ ما يصير تختار ${ampm(own[k])} للامتحان ${ORDINAL[k] ?? k + 1}، لأن الامتحان اللي قبله بعده ما خالص. اختار وقت أبعد شوية: من الساعة ${ampm(`${p2(Math.floor(free / 60))}:${p2(free % 60)}`)} وطالع، حتى يبقى ${s.gap} دقيقة بين الامتحانين.` };
        items.push({ examId: e.id, at: `${days[di]} ${own[k]}` });
        free = m + e.minutes + s.gap;
      }
      continue;
    }
    let minute = hour * 60;
    for (const e of list) {
      while (s.blockedHours.includes(Math.floor(minute / 60))) minute = (Math.floor(minute / 60) + 1) * 60;
      if (minute >= 24 * 60) return { ok: false, error: "الامتحانات ما تلحك بنفس اليوم. اختار ساعة أبكر." };
      items.push({ examId: e.id, at: `${days[di]} ${p2(Math.floor(minute / 60))}:${p2(minute % 60)}` });
      minute += e.minutes + s.gap;
    }
  }
  const last = o.pack && items.length ? items[items.length - 1].at.slice(0, 10) : end;
  const weeks = Math.max(1, Math.ceil((parse(last).getTime() - parse(start).getTime() + DAY_MS) / (7 * DAY_MS)));
  return { ok: true, items, days: o.pack ? perDayIdx.size : days.length, maxPerDay, perWeek: Math.ceil(n / weeks) };
}
const ORDINAL = ["الأول", "الثاني", "الثالث", "الرابع"];
/** 16:30 تصير 990 دقيقة. الوقت الغلط -1 */
const toMinutes = (t: string) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : -1);

// ---------- العطلة قبل امتحان: الامتحان واللي بعده يزحفون
/** اليوم اللي بعد day بـ m أيام تنفع (ok يگول إذا اليوم ينفع للامتحان) */
export function advanceDays(day: string, m: number, ok: (d: string) => boolean) {
  let d = day;
  for (let left = m, guard = 0; left > 0 && guard < 3000; guard++) { d = addDays(d, 1); if (ok(d)) left--; }
  return d;
}
/** كم يوم امتحان راح بالعطلة. أقلها واحد: يوم الامتحان نفسه */
export function daysLost(from: string, to: string, ok: (d: string) => boolean) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (ok(d)) n++;
  return Math.max(1, n);
}
/** النسخ تمشي ويا ترتيب الوقت: نسخة أول وقت باليوم القديم تصير لأول وقت باليوم الجديد */
export function remapByOrder<T>(map: Record<string, T>, oldTimes: string[], newTimes: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  oldTimes.forEach((t, i) => { if (map[t] !== undefined && newTimes[i]) out[newTimes[i]] = map[t]; });
  return out;
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
/** أسماء الأيام بنفس ترتيب weekdayOf: 0 = الاثنين */
export const DAY_NAMES = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
/** 2027-02-02 تصير «الثلاثاء 2/2/2027»: اسم اليوم ويا التاريخ */
export const prettyDay = (d: string) => (validDay(d) ? `${DAY_NAMES[weekdayOf(d)]} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(0, 4)}` : d);
export const prettyAt = (at: string) => `${prettyDay(at.slice(0, 10))} · ${ampm(at.slice(11))}`;
