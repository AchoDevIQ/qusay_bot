// جدول الامتحانات: إعدادات الإدارة، بناء الطالب لجدوله، وعرضه
import { titleFor } from "./examTitlesEn.ts";
import { LOCK_TEXT, examInProgress } from "./examLock.ts";
import { ipadExam, photosAllowed, setIpadExam, studentCode } from "./inPerson.ts";
import { appLink, lectureMap, sendLectureFile, visibleLectureFiles } from "./lectures.ts";
import { checkStopped, checkpointCard, seeCheckpoint } from "./checkpoints.ts";
import { checkDevice, checkPhone } from "./deviceLock.ts";
import { objectionInfo } from "./objections.ts";
import { find, insert, kvGet, kvSet, one, put, remove, tx, update, type Row } from "./db.ts";
import { boughtLectures, logActivity, needsGuardian } from "./access.ts";
import { PLACE_DAYS, PLACE_SLOTS, SESSIONS, YEAR_START } from "./bookOutline.ts";
import { DAYS, DAY_ORDER } from "./config.ts";
import { fullTimes, seatProblem, seatProblems, seatsView, setSeatLimits } from "./seats.ts";
import { examWith, skippableExams } from "./skipExams.ts";
import { centerName, isAdmin, student } from "./data.ts";
import { siteBase } from "./keyboards.ts";
import { chapterLabel } from "./orderRules.ts";
import { createGroup, joinGroup, leaveGroup, studentComp } from "./competition.ts";
import { CLOSED_TEXT, LATE_TEXT, closeFinished, deleteAnswer, examLeft, myPaper, openRoom, roomState, submitRoom, takeOath } from "./examRoom.ts";
import { send } from "./telegram.ts";
import { DEFAULT_SETTINGS, addDays, addMinutes, advanceDays, buildPlan, daysLost, inHoliday, itemState, labelChapters, pickOptional, pickedAt, remapByOrder, slotDays, ampm, prettyAt, prettyDay, validDay, weekdayOf, type PlanExam, type Slot, type SchedSettings } from "./scheduleRules.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { ApiError, authed, ensure, intOf, need } from "./webApi.ts";
import { cronKey, verifyHomeToken, verifyViewToken } from "./webAuth.ts";

export const SCHED_PERM = "schedule";
export async function schedSettings(): Promise<SchedSettings> {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await kvGet("sched_settings") || "{}") }; } catch { return DEFAULT_SETTINGS; }
}
/** مكان الامتحان: الأوقات تتبع المركز، والإلكتروني كأنه مركز رقمه 0 */
async function placeFor(uid: number) {
  const st = await student(uid);
  const inPerson = st?.exam === "حضوري";
  const centerId = inPerson ? st?.center_id ?? -1 : 0;
  return { inPerson, centerId, label: inPerson ? await centerName(st?.center_id) || "مركزك" : "الامتحان الإلكتروني" };
}
/** ساعات الطالب الخاص الإلكتروني: من الساعة اللي تحددها الإدارة إلى الساعة */
/** جدول التعويض (اتفاق الأستاذ 2026-11-17): الامتحانات اللي فاتته بترتيبها، بالأيام اللي اختارها الطالب.
 *  لحد ما يبدي الفصل اللي بعد فصل التعويض (phase2، من «مراحل الفصول») بأيام days1 (أكثر شي 4 بالأسبوع)،
 *  ومن بدايته يخف لأيام days2 (امتحان أو امتحانين بالأسبوع) ويمشي ويا جماعته بالفصل الجديد.
 *  اليوم اللي ما ينفع (عطلة، أو بيه امتحان ويا جماعته) ينعبر. الوقت لكل يوم من timeOf */
export type CatchPick = { days1: number[]; days2: number[]; timeOf: (weekday: number) => string };
export function catchupPlan(late: { id: number; at: string }[], pick: CatchPick, from: string, phase2: string | null, dayOk: (d: string) => boolean) {
  const out: { examId: number; at: string }[] = [];
  const list = [...late].sort((a, b) => a.at.localeCompare(b.at));
  let d = from;
  for (let guard = 0; out.length < list.length && guard < 900; guard++, d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    const days = phase2 && d >= phase2 ? pick.days2 : pick.days1;
    if (!days.includes(wd) || !dayOk(d)) continue;
    out.push({ examId: list[out.length].id, at: `${d} ${pick.timeOf(wd)}` });
  }
  return out;
}
/** أيام التعويض صحيحة؟ بالعدد اللي اختاره، من الأيام المسموحة، و«يوم بين يوم»: ما يصير يومين ورا بعض
 *  (بالأسبوع 7 أيام، فالـ4 لازم بيهن يومين ورا بعض مرة وحدة بس). يرجع رسالة الغلط أو "" */
export function catchDaysError(days: number[], per: number, allowed: number[], label: string) {
  const set = [...new Set(days)];
  if (set.length !== days.length || set.length !== per) return `اختار ${per} أيام بالضبط ${label}`;
  if (set.some((d) => !allowed.includes(d))) return `بعض الأيام ${label} مو من أيام الامتحان`;
  const pairs = set.filter((d) => set.includes((d + 1) % 7)).length;
  if (pairs > Math.max(0, per - 3)) return per >= 4 ? `${label}: ما يصير أكثر من يومين ورا بعض مرة وحدة` : `${label}: خلي يوم بين يوم، لا تختار يومين ورا بعض`;
  return "";
}
/** فصل التعويض: يوم يبدي الفصل اللي بعده (من «مراحل الفصول»)، ومنه يخف التعويض. null إذا ما محدد */
async function catchPhase2(late: Row[]): Promise<string | null> {
  const order = await allChapters();
  const idx = late.flatMap((e) => labelChapters(String(e.chapter ?? ""))).map((c) => order.indexOf(c)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const next = order[Math.min(...idx) + 1];
  const { chapterStages } = await import("./chapterStages.ts");
  const st = next ? (await chapterStages())[next]?.start : null;
  return st && validDay(st) ? st : null;
}
/** يوم ينفع للتعويض: مو عطلة الإدارة ولا مستثنى ولا عطلة مكانه، وما بيه امتحان ويا جماعته */
async function catchDayOk(uid: number, sc: Row, s: SchedSettings) {
  const busy = new Set<string>();
  const days = await placeDays(sc.center_id), picks = picksOf(sc);
  for (const e of await boughtExams(uid)) { const day = days.get(e.id); const at = day ? pickedAt(day, picks) : null; if (at) busy.add(at.slice(0, 10)); }
  for (const i of await find("sched_items", { user_id: uid, status: "waiting" })) busy.add(String(i.at).slice(0, 10));
  const ranges = (await holidays()).filter((h) => !h.insert).flatMap((h) => h.places.filter((p) => p.center === sc.center_id || p.center === 0));
  return (d: string) => !busy.has(d) && !inHoliday(d, s) && !s.excluded.includes(d) && !s.offDays.includes(weekdayOf(d)) && !ranges.some((r) => inRange(d, r));
}
/** شنو يختار الطالب لجدول تعويضه */
async function catchView(uid: number, late: Row[], s: SchedSettings) {
  const tomorrow = addDays(todayStr(), 1);
  const phase2 = await catchPhase2(late);
  const place = await placeFor(uid);
  return {
    phase2, light: !!phase2 && phase2 <= tomorrow, maxHeavy: 4, maxLight: 2,
    week: DAY_ORDER.filter((d) => !s.offDays.includes(d)).map((d) => ({ d, name: DAYS[d] })),
    // الحضوري: بمركزه بس، بأيامه وأوقاته، بالآيباد
    center: place.inPerson ? { name: place.label, days: daysView(await placeSlots(place.centerId)).filter((x) => !s.offDays.includes(x.d)) } : null,
  };
}
// ---------- 🚀 الفصل الرابع قبل نصف السنة (اتفاق الأستاذ 2026-11-21)
// المراجعات (امتحانات مربوطة بفصل ثاني بـ «يطلع ويا الفصل»، مثل فاينل الأول والثاني ويا الفصل الثالث) إجبارية، وجدولها ما يتحرك.
// بس طالب «ويا الطلاب» اللي مشتري الفصل اللي جماعته يبدونه ورا عطلة نصف السنة، يگدر يبديه هسه، ويختار: ويا المراجعات لو بدونها.
// امتحاناته بأيام مكانه وبالوقت اللي اختاره لكل يوم، امتحان واحد باليوم: اليوم اللي بيه امتحان إله (مراجعة أو غيره) ينعبر،
// ومن تخلص أيام قبل العطلة يكمل بعدها. صاحب البوت يفتح الخيار من إعدادات الجدول (مسدود بالأصل)
const earlyKey = (uid: number) => `early_ch_${uid}`;
type Early = { at: string; chapter: string; with: boolean; place: "online" | "ipad"; exams: number[]; dropped: number[] };
async function earlyOf(uid: number): Promise<Early | null> {
  try { const j = JSON.parse(await kvGet(earlyKey(uid)) ?? "null"); return j && Array.isArray(j.exams) ? j : null; } catch { return null; }
}
type EarlyCan = { chapter: string; exams: Row[]; reviews: { e: Row; at: string }[]; mid: Range };
/** يگدر يبدي فصل قبل العطلة؟ الفصل (أول فصل بالمنهج كل امتحاناته بمكانه ورا العطلة)، امتحاناته اللي اشتراها، ومراجعاته قبل العطلة */
async function earlyCan(uid: number, sc: Row | null | undefined, s: SchedSettings): Promise<EarlyCan | null> {
  if (!s.earlyOpen || sc?.mode !== "general" || await earlyOf(uid)) return null;
  const mid = await midFor(sc.center_id, s);
  if (!mid || todayStr() >= mid.from) return null;
  const days = await placeDays(sc.center_id);
  const withCh = await examWith();
  const linked = (e: Row) => !!withCh[String(e.id)] && withCh[String(e.id)] !== e.chapter;
  const all = await find("bank_exams");
  const chapter = (await allChapters()).find((ch) => {
    const list = all.filter((e) => e.chapter === ch && !linked(e));
    return list.length > 0 && list.every((e) => !days.has(e.id) || days.get(e.id)! > mid.to);
  });
  if (!chapter) return null;
  const bought = await boughtExams(uid);
  const items = await find("sched_items", { user_id: uid });
  const gone = new Set(items.filter((i) => i.kind !== "optional" && (i.status !== "waiting" || i.fixed)).map((i) => i.exam_id));
  const exams = bought.filter((e) => e.chapter === chapter && !linked(e) && !gone.has(e.id));
  if (!exams.length) return null;
  const picks = picksOf(sc), now = stamp();
  const reviews = bought.filter((e) => linked(e) && !gone.has(e.id))
    .map((e) => ({ e, at: days.has(e.id) ? pickedAt(days.get(e.id)!, picks) ?? "" : "" }))
    .filter((r) => r.at > now && r.at.slice(0, 10) < mid.from);
  return { chapter, exams, reviews, mid };
}
/** مواعيد الفصل المبكر: من باچر، بأيام مكانه ووقته، امتحان واحد باليوم، وما ينحط بيوم بيه امتحان إله ولا بعطلة */
async function earlyPlan(uid: number, sc: Row, s: SchedSettings, c: EarlyCan, withReviews: boolean) {
  const days = await placeDays(sc.center_id), picks = picksOf(sc);
  const moving = new Set(c.exams.map((e) => e.id as number));
  const dropped = new Set(withReviews ? [] : c.reviews.map((r) => r.e.id as number));
  const busy = new Set<string>();
  for (const e of await boughtExams(uid)) {
    if (moving.has(e.id) || dropped.has(e.id)) continue;
    const d = days.get(e.id), at = d ? pickedAt(d, picks) : null;
    if (at) busy.add(at.slice(0, 10));
  }
  for (const i of await find("sched_items", { user_id: uid, status: "waiting" })) if (!moving.has(i.exam_id) && !dropped.has(i.exam_id)) busy.add(String(i.at).slice(0, 10));
  const ps = await placeSettings(sc.center_id, s);
  const ranges = (await holidays()).filter((h) => !h.insert).flatMap((h) => h.places.filter((p) => p.center === sc.center_id));
  const weekdays = [...new Set((await placeSlots(sc.center_id)).map((x) => x.d))].filter((d) => !s.offDays.includes(d) && !!picks[String(d)]);
  const ok = (d: string) => !busy.has(d) && !inHoliday(d, ps) && !s.excluded.includes(d) && !ranges.some((r) => inRange(d, r));
  return catchupPlan(c.exams.map((e, k) => ({ id: e.id as number, at: String(k).padStart(4, "0") })), { days1: weekdays, days2: [], timeOf: (wd) => picks[String(wd)] }, addDays(todayStr(), 1), null, ok);
}
/** يگدر يرجع ويا جماعته؟ لحد ما يجي موعد أول امتحان مبكر أو أول مراجعة شالها */
async function earlyUndoable(uid: number) {
  const now = stamp();
  const mine = (await find("sched_items", { user_id: uid })).filter((i) => i.kind === "early" || i.kind === "early_skip");
  return mine.every((i) => i.at > now && (i.kind === "early_skip" || i.status === "waiting"));
}
/** شنو يطلع للطالب: العرض، لو اللي اختاره (إذا بعده يگدر يرجع) */
async function earlyView(uid: number, sc: Row | null | undefined, s: SchedSettings) {
  if (sc?.mode !== "general") return null;
  const mine = await earlyOf(uid);
  if (mine) return await earlyUndoable(uid) ? { chosen: { chapter: mine.chapter, with: mine.with, place: mine.place } } : null;
  const c = await earlyCan(uid, sc, s);
  if (!c) return null;
  const sum = async (w: boolean) => {
    const p = await earlyPlan(uid, sc, s, c, w);
    return p.length === c.exams.length ? { first: p[0].at, last: p[p.length - 1].at, before: p.filter((x) => x.at.slice(0, 10) < c.mid.from).length } : null;
  };
  const place = await placeFor(uid);
  return { offer: { chapter: c.chapter, count: c.exams.length, midFrom: c.mid.from, reviews: c.reviews.map((r) => ({ title: String(r.e.title), at: r.at })),
    withPlan: await sum(true), withoutPlan: c.reviews.length ? await sum(false) : null, center: place.inPerson ? place.label : "" } };
}
/** يثبت الفصل المبكر: امتحاناته تصير ثابتة بمواعيدها الجديدة، والمراجعات اللي شالها تنحسب «منشالة» (مو غياب) */
async function earlyStart(uid: number, body: Row, force = false) {
  const sc = await one("schedules", { user_id: uid });
  // force: صاحب البوت يثبته من نتيجة التصويت، حتى لو خيار الطلاب بالجدول مسدود
  const s = force ? { ...await schedSettings(), earlyOpen: true } : await schedSettings();
  const c = await earlyCan(uid, sc, s);
  need(c, "هذا الخيار مو مفتوح إلك هسه");
  const withReviews = body.with !== false || !c!.reviews.length;
  const place = await placeFor(uid);
  const ipad = body.mode === "ipad";
  if (ipad) {
    need(place.inPerson, "الامتحان بالمركز بالآيباد لطالب المركز بس");
    need(body.kit === true, "أشّر إن عندك آيباد وقلم، وإنترنت شغال وياك بالمركز");
  }
  const plan = await earlyPlan(uid, sc!, s, c!, withReviews);
  need(plan.length === c!.exams.length, "ما گدرنا نرتب كل امتحانات الفصل بأيام مكانك. راسل الإدارة");
  if (ipad) { const why = await seatProblems(place.centerId, plan, await student(uid), uid); need(!why, why); }
  const moving = new Set(c!.exams.map((e) => e.id as number));
  const dropped = withReviews ? [] : c!.reviews;
  const drop = new Set(dropped.map((r) => r.e.id as number));
  await tx(async () => {
    await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed && r.kind !== "optional" && (moving.has(r.exam_id) || drop.has(r.exam_id)) });
    for (const x of plan) await insert("sched_items", { user_id: uid, exam_id: x.examId, at: x.at, status: "waiting", kind: "early", fixed: 1, catch_place: ipad ? "ipad" : "online" });
    for (const r of dropped) await insert("sched_items", { user_id: uid, exam_id: r.e.id, at: r.at, status: "skipped", kind: "early_skip", fixed: 1 });
  });
  const e: Early = { at: stamp(), chapter: c!.chapter, with: withReviews, place: ipad ? "ipad" : "online", exams: plan.map((x) => x.examId), dropped: [...drop] };
  await kvSet(earlyKey(uid), JSON.stringify(e));
  const last = plan[plan.length - 1].at.slice(0, 10);
  const how = ipad ? `حضوري بالآيباد بـ${place.label}` : "إلكتروني";
  await logActivity(uid, `🚀 بدا ${c!.chapter} قبل نصف السنة ${c!.reviews.length ? (withReviews ? "ويا المراجعات" : `بدون المراجعات (انشالت ${dropped.length})`) : ""}: ${plan.length} امتحان ${how} من ${prettyDay(plan[0].at.slice(0, 10))} إلى ${prettyDay(last)}`);
  return `✅ انثبت: ${plan.length} امتحان من ${c!.chapter}، أولها ${prettyAt(plan[0].at)} وآخرها ${prettyDay(last)}.${dropped.length ? ` وانشالت ${dropped.length} مراجعة من جدولك.` : ""} الامتحان اللي يفوتك ينحسب غياب وصفر.`;
}
/** «⚡ طبّق على المصوتين» بالتصويت: يبدي الفصل المبكر لطالب صوّت إله. امتحاناته إلكتروني، حتى طالب المركز (الآيباد يحتاج يأشّر بنفسه إن عنده آيباد وقلم) */
export const earlyStartFor = (uid: number, withReviews: boolean) => earlyStart(uid, { with: withReviews, mode: "online" }, true);
/** يرجع ويا جماعته: امتحانات الفصل ترجع لمواعيد مكانه، والمراجعات ترجع */
async function earlyUndo(uid: number) {
  const e = await earlyOf(uid);
  need(e, "ما بديت فصل قبل وقته");
  need(await earlyUndoable(uid), "بديت بامتحانات الفصل، فما يصير ترجع هسه");
  await remove("sched_items", { user_id: uid }, { where: (r) => r.kind === "early" || r.kind === "early_skip" });
  await kvSet(earlyKey(uid), "null");
  await logActivity(uid, `↩️ رجع ويا جماعته: ${e!.chapter} بعد نصف السنة${e!.dropped.length ? "، والمراجعات رجعت" : ""}`);
  return `↩️ رجعت ويا جماعتك: ${e!.chapter} بعد العطلة${e!.dropped.length ? "، والمراجعات رجعت لجدولك" : ""}`;
}
/** لصفحة الجدول: منو بدا فصل قبل وقته */
async function earlyStudents() {
  const by = new Map<number, Row[]>();
  for (const i of await find("sched_items", { kind: "early" })) by.set(i.user_id as number, [...by.get(i.user_id as number) ?? [], i]);
  const out: { uid: number; name: string; with: boolean; last: string }[] = [];
  for (const [uid, list] of by) {
    const e = await earlyOf(uid);
    out.push({ uid, name: String((await student(uid))?.name ?? uid), with: e?.with ?? true, last: list.map((i) => String(i.at)).sort().at(-1) ?? "" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** ياخذ جدول تعويض؟ بالامتحانات الفايتة امتحان من فصل صار تعويضي (باليد أو بالأيام)، أو فاته من الفصل
 *  «تعويضي ورا كم امتحان» أو أكثر، أو امتحان موعده أقل من 24 ساعة من وقت ما اشترى (ما ينحسب عليه، يروح للتعويض) */
async function hasMakeup(late: Row[]) {
  if (late.some((e) => e.soon)) return true;
  const mk = await (await import("./makeup.ts")).makeupChapters();
  if (late.some((e) => labelChapters(String(e.chapter ?? "")).some((c) => mk[c]))) return true;
  const stages = await (await import("./chapterStages.ts")).chapterStages();
  const per = new Map<string, number>();
  for (const e of late) for (const c of labelChapters(String(e.chapter ?? ""))) per.set(c, (per.get(c) ?? 0) + 1);
  return [...per].some(([c, n]) => !!stages[c]?.after && n >= Number(stages[c].after));
}
/** شوكت انفتحله كل فصل (اشتراه): من الشراء بالبوت، أو طلب المكتبة/المكتب للحضوري */
async function chapterSince(uid: number) {
  const out = new Map<string, string>();
  const keep = (c: string, at: unknown) => { const t = String(at ?? "").replace("T", " ").slice(0, 16); if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(t) && (!out.has(c) || t < out.get(c)!)) out.set(c, t); };
  for (const r of await find("exam_access", { user_id: uid })) keep(String(r.chapter), r.created);
  for (const o of await find("orders", { user_id: uid }, { where: (o) => o.printed === 1 || o.printed === 3 })) {
    for (const it of JSON.parse(o.items || "[]") as Row[]) {
      const label = String(it.name).includes("امتحان") && !String(it.name).includes("دفتر") ? chapterLabel(it.name)?.replace("الاول", "الأول") : null;
      if (label) keep(label, o.created);
    }
  }
  return out;
}
const GRACE_MIN = 24 * 60;
async function guardWaitOf(uid: number) {
  const g = await import("./guardianLock.ts");
  const { pendingSeen } = await import("./guardianWatch.ts");
  const { guardianOf } = await import("./access.ts");
  if (!await guardianOf(uid)) return null;
  return { pending: await pendingSeen(uid), old: await g.oldUnseen(uid), travel: await g.travelUntil(uid) };
}
// ---------- 🐢 الجدول البطيء (طلب الأستاذ 2026-11-18): طالب الخامس يحط تاريخ ووقت كل امتحان بإيده.
// بالترتيب، من باچر وطالع، مو بعطلة ولا بيوم ما يمتحنون بيه، ضمن الأوقات (الإلكتروني ساعات الإدارة، الحضوري أوقات مركزه)،
// وحد الامتحانات باليوم والفاصل بينهم، والعدد بكل وقت. امتحاناته ثابتة (fixed)، فالعطل وإعادة الترتيب ما تحركها
const SLOW_GRADE = "الخامس العلمي";
async function slowCheck(uid: number, changes: Map<number, string>) {
  const s = await schedSettings();
  const place = await placeFor(uid);
  const slots = place.inPerson ? await placeSlots(place.centerId) : [];
  const exams = new Map((await find("bank_exams")).map((e) => [e.id as number, e]));
  const title = (e: number) => String(exams.get(e)?.title ?? "امتحان");
  const hours = allowedHours(s), tomorrow = addDays(todayStr(), 1);
  for (const [e, at] of changes) {
    need(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at) && validDay(at.slice(0, 10)), `اختار تاريخ ووقت «${title(e)}»`);
    const day = at.slice(0, 10), t = at.slice(11, 16), wd = weekdayOf(day);
    need(day >= tomorrow, `«${title(e)}»: التاريخ لازم من باچر وطالع`);
    need(!s.offDays.includes(wd) && !inHoliday(day, s) && !s.excluded.includes(day), `«${title(e)}»: ${prettyDay(day)} عطلة، اختار يوم ثاني`);
    if (place.inPerson) need(slots.some((x) => x.d === wd && x.t === t), `«${title(e)}»: اختار من أوقات مركزك يوم ${DAYS[wd]}`);
    else need(t.endsWith(":00") && hours.includes(Number(t.slice(0, 2))), `«${title(e)}»: الامتحان يبدي من الساعة ${ampm(`${String(s.fromHour).padStart(2, "0")}:00`)} إلى ${ampm(`${String(s.toHour).padStart(2, "0")}:00`)} بس`);
  }
  // كل امتحاناته الجاية ويا الجديدة: بالترتيب، وباليوم العدد والفاصل
  const all = new Map<number, string>();
  for (const i of await find("sched_items", { user_id: uid, status: "waiting" })) if (i.kind !== "optional" && i.notified !== "test") all.set(i.exam_id as number, String(i.at));
  for (const [e, at] of changes) all.set(e, at);
  const seq = (await boughtExams(uid)).map((e) => e.id as number).filter((e) => all.has(e));
  for (let k = 1; k < seq.length; k++) need(all.get(seq[k])! > all.get(seq[k - 1])!, `«${title(seq[k])}» لازم يجي بعد «${title(seq[k - 1])}»`);
  const perDay = await perDayFor(uid, s);
  const byDay = new Map<string, [number, string][]>();
  for (const [e, at] of all) byDay.set(at.slice(0, 10), [...byDay.get(at.slice(0, 10)) ?? [], [e, at]]);
  const m = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
  for (const [day, list] of byDay) {
    need(list.length <= perDay, `${prettyDay(day)}: أكثر شي ${perDay} امتحان باليوم`);
    list.sort((a, b) => a[1].localeCompare(b[1]));
    for (let k = 1; k < list.length; k++) {
      const [pe, pat] = list[k - 1];
      need(m(list[k][1]) >= m(pat) + Number(exams.get(pe)?.minutes ?? 75) + s.gap, `${prettyDay(day)}: «${title(list[k][0])}» لازم يبدي بعد نهاية «${title(pe)}» بـ ${s.gap} دقيقة`);
    }
  }
  const why = await seatProblems(place.centerId, [...changes.values()].map((at) => ({ at })), await student(uid), uid);
  need(!why, why);
}
/** يثبت تواريخ امتحاناته اللي بعدها ما مرتبة (أول مرة، أو فصل جديد اشتراه) */
async function slowSave(uid: number, raw: unknown) {
  need((await student(uid))?.grade === SLOW_GRADE, "الجدول البطيء لطلاب الخامس بس");
  const sc = await one("schedules", { user_id: uid });
  need(!sc || sc.mode === "slow", "جدولك مثبت. لتغييره تواصل ويا قصي العميري");
  const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  need(left.length, "كل امتحاناتك مرتبة");
  const given = new Map<number, string>();
  for (const x of (Array.isArray(raw) ? raw : []) as Row[]) given.set(Number(x.exam), String(x.at ?? "").replace("T", " ").slice(0, 16));
  const changes = new Map<number, string>();
  for (const e of left) { need(given.get(e.id), `اختار تاريخ ووقت «${e.title}»`); changes.set(e.id as number, given.get(e.id)!); }
  await slowCheck(uid, changes);
  const dates = [...changes.values()].sort();
  await tx(async () => {
    if (!sc) await put("schedules", { user_id: uid, mode: "slow", center_id: null, picks: null, start_day: dates[0].slice(0, 10), end_day: dates.at(-1)!.slice(0, 10), weekdays: "[]", hour: 0, created: stamp(), hol: null, pack: null });
    else await update("schedules", { user_id: uid }, { end_day: [String(sc.end_day ?? ""), dates.at(-1)!.slice(0, 10)].sort().at(-1) });
    for (const [e, at] of changes) await insert("sched_items", { user_id: uid, exam_id: e, at, status: "waiting", fixed: 1 });
  });
  await logActivity(uid, `🐢 رتب جدوله البطيء: ${changes.size} امتحان، من ${prettyDay(dates[0].slice(0, 10))} إلى ${prettyDay(dates.at(-1)!.slice(0, 10))}`);
  return `✅ انثبت جدولك: ${changes.size} امتحان، آخرها ${prettyDay(dates.at(-1)!.slice(0, 10))}`;
}
/** يغير تاريخ ووقت امتحان من جدوله البطيء، قبل 24 ساعة منه */
async function slowMove(uid: number, item: unknown, raw: unknown) {
  const sc = await one("schedules", { user_id: uid });
  need(sc?.mode === "slow", "هذا لطالب الجدول البطيء");
  const it = await one("sched_items", { id: Number(item), user_id: uid });
  need(it?.status === "waiting" && !it.kind && it.notified !== "test", "هذا الامتحان ما يتغير موعده");
  need(hoursUntil(String(it!.at)) >= MOVE_HOURS, "موعد الامتحان يتغير قبل 24 ساعة منه بس. بعدها ما يتغير");
  const at = String(raw ?? "").replace("T", " ").slice(0, 16);
  need(at !== String(it!.at), "هذا نفس موعده");
  await slowCheck(uid, new Map([[it!.exam_id as number, at]]));
  await update("sched_items", { id: it!.id }, { at, notified: null });
  const title = String((await one("bank_exams", { id: it!.exam_id }))?.title ?? "");
  await logActivity(uid, `🐢 غير موعد ${title}: من ${prettyAt(String(it!.at))} إلى ${prettyAt(at)}`);
  return `✅ صار موعد ${title} ${prettyAt(at)}`;
}
const allowedHours = (s: SchedSettings) => Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= s.fromHour && h <= s.toHour);
/** حد الامتحانات باليوم: الخاص بالطالب إذا موجود، وإلا العام */
export async function perDayFor(uid: number, s: SchedSettings) { return Number(await kvGet(`sched_perday_${uid}`)) || s.perDay; }

/** فصول جدول الطالب. الحضوري ما يفتح شي بالبوت، فتنحسب من طلباته المستلمة */
export async function scheduleChapters(uid: number): Promise<string[]> {
  const out = (await find("exam_access", { user_id: uid }, { order: ["created", "chapter"] })).map((r) => r.chapter as string);
  const st = await student(uid);
  if (st?.exam !== "حضوري") return out;
  const orders = await find("orders", { user_id: uid }, { where: (o) => (o.printed === 1 || o.printed === 3) && String(o.created) >= String(st.created), order: ["id"] });
  for (const o of orders) for (const it of JSON.parse(o.items || "[]") as Row[]) {
    const label = String(it.name).includes("امتحان") && !String(it.name).includes("دفتر") ? chapterLabel(it.name)?.replace("الاول", "الأول") : null;
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
/** الامتحانات الإجبارية من الفصول اللي اشتراها، بترتيبها */
export async function boughtExams(uid: number) {
  return await examsFor(await scheduleChapters(uid));
}
/** فصول المنهج بترتيبها (من البنك) */
async function allChapters() {
  const first = new Map<string, string>();
  for (const e of await find("bank_exams")) if (String(e.chapter).startsWith("الفصل") && (!first.has(e.chapter) || String(e.slug) < first.get(e.chapter)!)) first.set(e.chapter, String(e.slug));
  return [...first].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true })).map(([c]) => c);
}
/** امتحانات هذي الفصول بترتيبها، ويا الامتحانات المربوطة بيها من فصول ثانية */
async function examsFor(chapters: string[]) {
  // الامتحان اللي كل نسخه اختيارية ما يدخل الجدول. اللي نسخه لسه ما انضافت يدخل بمكانه
  const versions = await find("bank_versions");
  const skip = (examId: number) => { const vs = versions.filter((v) => v.exam_id === examId); return vs.length > 0 && vs.every((v) => v.kind !== "mandatory"); };
  const out: Row[] = [];
  const mine = chapters.flatMap(labelChapters);
  // امتحان مربوط بفصل ثاني اشتراه الطالب: يطلع بآخر ذاك الفصل، مو ويا فصله
  const withCh = await examWith();
  const elsewhere = (e: Row) => !!withCh[String(e.id)] && withCh[String(e.id)] !== e.chapter && mine.includes(withCh[String(e.id)]);
  const order = (a: Row, b: Row) => (a.pos ?? a.ord) - (b.pos ?? b.ord) || a.id - b.id;
  const all = await find("bank_exams");
  const seen = new Set<number>();
  for (const ch of mine) {
    const list = all.filter((e) => e.chapter === ch && !skip(e.id) && !elsewhere(e)).sort(order);
    const extra = all.filter((e) => elsewhere(e) && withCh[String(e.id)] === ch && !skip(e.id))
      .sort((a, b) => mine.indexOf(String(a.chapter)) - mine.indexOf(String(b.chapter)) || String(a.slug).localeCompare(String(b.slug)) || order(a, b));
    for (const e of [...list, ...extra]) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return out;
}
/** اللي انتهى وقته ولا دخله ينسجل فايت، وما له إعادة */
async function closeMissed(uid: number, s: SchedSettings) {
  const now = stamp();
  for (const it of await find("sched_items", { user_id: uid, status: "waiting" })) {
    if (itemState("waiting", it.at, s.window, now) === "missed") await put("sched_items", { ...it, status: "missed" });
  }
}
const remaining = (bought: Row[], items: Row[]) => {
  // الفايت والمخلص ما يرجعون. اللي بالانتظار ينعاد توزيعه
  // واللي موعده انحط باليد (إعادة أو تقديم) يبقى مثل ما هو
  const gone = new Set(items.filter((i) => (i.status !== "waiting" || i.fixed) && i.kind !== "optional").map((i) => i.exam_id));
  return bought.filter((e) => !gone.has(e.id));
};
const toPlanExams = (rows: Row[]): PlanExam[] => rows.map((e) => ({ id: e.id, minutes: e.minutes ?? 75 }));

/** الامتحانات اللي الطالب داس عليها ✅ خليه */
async function keptExams(uid: number): Promise<number[]> {
  try { const j = JSON.parse(await kvGet(`skip_keep_${uid}`) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; }
}
const placeSlots = async (center: number): Promise<Slot[]> => JSON.parse((await one("place_slots", { center_id: center }))?.slots || "[]");
const picksOf = (sc: Row): Record<string, string> => JSON.parse(sc.picks || "{}");
const placeDays = async (center: number) => new Map((await find("place_dates", { center_id: center })).map((d) => [d.exam_id as number, d.day as string]));

// ---------- عطلة قبل امتحان: الامتحان واللي بعده يزحفون، بالمكان وبجداول الطلاب الخاصة
type Range = { from: string; to: string };
/** عطلة ثانية بعد هذي العطلة بنفس المكان أو الجدول: تزحف ويا امتحانها، حتى تبقى قبله */
type HolMove = { id: number; from: string; to: string; toFrom: string; toTo: string };
type HolPlace = Range & { center: number; name: string; moved: { exam: number; title: string; day: string; versions: string; to: string; toVersions: string }[]; hols?: HolMove[] };
type HolStudent = Range & { uid: number; on: boolean; kept?: boolean; moves: { id: number; at: string; to: string }[]; hols?: HolMove[] };
/** insert: امتحان من البنك انحط بيوم exam بدل الفراغ. added: مواعيده بجداول الطلاب الخاصة */
type Holiday = { id: number; exam: number; title: string; days: number; reason: string; places: HolPlace[]; students: HolStudent[]; at: string; insert?: number; added?: number[] };
const HOL_KEY = "exam_holidays";
async function holidays(): Promise<Holiday[]> {
  try { const j = JSON.parse(await kvGet(HOL_KEY) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; }
}
const saveHolidays = (list: Holiday[]) => kvSet(HOL_KEY, JSON.stringify(list));
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
const daysOf = (r: Range) => { const out: string[] = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d); return out; };
/** أيام عطل الطالب الخاص اللي ما لغاها: ما ينحط بيها امتحان إذا انعاد جدوله */
const studentHolidayDays = async (uid: number) => (await holidays()).filter((h) => !h.insert).flatMap((h) => h.students.filter((x) => x.uid === uid && x.on).flatMap(daysOf));
/** يوم ينفع للامتحان: من أيامه، مو عطلة ولا مستثنى ولا داخل عطلة امتحان ثانية */
const dayOk = (weekdays: Set<number>, s: SchedSettings, ranges: Range[]) => (d: string) =>
  weekdays.has(weekdayOf(d)) && !inHoliday(d, s) && !s.excluded.includes(d) && !ranges.some((r) => inRange(d, r));
async function placeNames() {
  return new Map<number, string>([[0, "💻 الإلكتروني"], ...(await find("centers")).map((c) => [c.id as number, `🏫 ${c.name}`] as [number, string])]);
}
/** شنو يصير إذا انحطت عطلة days يوم قبل الامتحان exam بهذي الأماكن: مواعيد المكان، وجداول الطلاب الخاصة */
async function planHoliday(exam: number, days: number, centers: number[], onlyFor?: number) {
  const s = await schedSettings();
  const hols = await holidays();
  const tomorrow = addDays(todayStr(), 1);
  const titles = new Map((await find("bank_exams")).map((e) => [e.id as number, String(e.title ?? "")]));
  const names = await placeNames();
  const places: HolPlace[] = [];
  for (const center of centers) {
    const rows = await find("place_dates", { center_id: center });
    const x = rows.find((r) => r.exam_id === exam);
    // جدول المكان يتعدل حتى بأيام فاتت، حتى ينتقل الجدول القديم كامل. جداول الطلاب الخاصة بس من باجر
    if (!x?.day) continue;
    const slots = await placeSlots(center);
    const r = { from: x.day as string, to: addDays(x.day, days - 1) };
    // العطل اللي من هذا اليوم وبعده تزحف ويا امتحاناتها، والعطل اللي قبله ثابتة
    const mine = hols.filter((h) => !h.insert).flatMap((h) => h.places.filter((p) => p.center === center).map((p) => ({ id: h.id, from: p.from, to: p.to })));
    const base = dayOk(new Set(slots.map((t) => t.d)), await placeSettings(center, s), mine.filter((p) => p.from < r.from));
    const lost = daysLost(r.from, r.to, base);
    const ok = (d: string) => base(d) && !inRange(d, r);
    const timesOf = (d: string) => slots.filter((t) => t.d === weekdayOf(d)).map((t) => t.t).sort();
    const moved = rows.filter((row) => row.day >= r.from).sort((a, b) => String(a.day).localeCompare(String(b.day))).map((row) => {
      const to = advanceDays(row.day, lost, ok);
      return { exam: row.exam_id as number, title: titles.get(row.exam_id) ?? "", day: row.day as string, versions: String(row.versions || "{}"), to, toVersions: JSON.stringify(remapByOrder(JSON.parse(row.versions || "{}"), timesOf(row.day), timesOf(to))) };
    });
    const holMoves = mine.filter((p) => p.from >= r.from).map((p) => ({ ...p, toFrom: advanceDays(p.from, lost, ok), toTo: advanceDays(p.to, lost, ok) }));
    places.push({ ...r, center, name: names.get(center) ?? "", moved, hols: holMoves });
  }
  const students: HolStudent[] = [];
  for (const sc of await find("schedules")) {
    if (sc.mode === "general" || sc.mode === "slow") continue;
    const uid = sc.user_id as number;
    if (!centers.includes((await placeFor(uid)).centerId)) continue;
    // الامتحان المضاف: بس اللي مشتري فصله
    if (onlyFor && !(await boughtExams(uid)).some((e) => e.id === onlyFor)) continue;
    const items = (await find("sched_items", { user_id: uid, status: "waiting" }, { order: ["at"] })).filter((i) => !i.fixed && i.notified !== "test");
    const x = items.find((i) => i.exam_id === exam);
    const d0 = String(x?.at ?? "").slice(0, 10);
    if (!x || d0 < tomorrow) continue;
    const r = { from: d0, to: addDays(d0, days - 1) };
    const mine = hols.filter((h) => !h.insert).flatMap((h) => h.students.filter((y) => y.uid === uid && y.on).map((y) => ({ id: h.id, from: y.from, to: y.to })));
    const base = dayOk(new Set(JSON.parse(sc.weekdays || "[]") as number[]), s, mine.filter((y) => y.from < r.from));
    const lost = daysLost(r.from, r.to, base);
    const ok = (d: string) => base(d) && !inRange(d, r);
    const times: Record<string, string[]> | null = sc.picks ? JSON.parse(sc.picks) : null;
    const moves = items.filter((i) => String(i.at).slice(0, 10) >= d0).map((i) => {
      const day = String(i.at).slice(0, 10), t = String(i.at).slice(11);
      const to = advanceDays(day, lost, ok);
      // الامتحان الثاني باليوم يبقى ثاني باليوم الجديد، بوقته اللي اختاره الطالب لذاك اليوم
      const k = times?.[String(weekdayOf(day))]?.indexOf(t) ?? -1;
      return { id: i.id as number, at: i.at as string, to: `${to} ${(k >= 0 && times?.[String(weekdayOf(to))]?.[k]) || t}` };
    });
    const holMoves = mine.filter((y) => y.from >= r.from).map((y) => ({ ...y, toFrom: advanceDays(y.from, lost, ok), toTo: advanceDays(y.to, lost, ok) }));
    students.push({ ...r, uid, on: true, moves, hols: holMoves });
  }
  return { places, students };
}
/** امتحان add ياخذ يوم الامتحان exam بهذي الأماكن، وهو واللي بعده يزحفون. null إذا ماكو شي يتغير */
async function insertBefore(exam: number, add: number, centers: number[]) {
  const e = await one("bank_exams", { id: add });
  if (!e) return null;
  const plan = await planHoliday(exam, 1, centers, add);
  if (!plan.places.length && !plan.students.length) return null;
  const h: Holiday = { id: Date.now(), exam, title: String(e.title ?? ""), days: 1, reason: "", places: plan.places, students: plan.students, at: stamp(), insert: add };
  const told = await applyHoliday(h);
  await saveHolidays([...await holidays(), h]);
  return { title: h.title, told, places: plan.places.length, students: plan.students.length };
}
/** لما تتوزع مواعيد مكان من جديد: عطله قبل كل امتحان تنعاد. إذا المكان ما إله عطلة قبل امتحان،
 *  ياخذ العطل اللي قبل نفس الامتحان من المكان الثاني اللي بيه أكثر عطل قبله (الإلكتروني أول إذا تساووا) */
async function copyHolidays(center: number) {
  const list = (await holidays()).filter((h) => !h.insert);
  const pick = new Map<number, number>();   // الامتحان → المكان اللي ناخذ عطله
  for (const exam of new Set(list.map((h) => h.exam))) {
    const count = new Map<number, number>();
    for (const h of list.filter((x) => x.exam === exam)) for (const p of h.places) count.set(p.center, (count.get(p.center) ?? 0) + 1);
    if (!count.size) continue;
    pick.set(exam, count.has(center) ? center : [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
  }
  const chosen = list.filter((h) => h.places.some((p) => p.center === pick.get(h.exam))).sort((a, b) => a.id - b.id).map((h) => h.id);
  // عطل هذا المكان القديمة تنشال من السجل، لأن مواعيده انعادت من الصفر
  const all = await holidays();
  for (const h of all) if (!h.insert) h.places = h.places.filter((p) => p.center !== center);
  await saveHolidays(all);
  let n = 0;
  for (const id of chosen) {
    const h = (await holidays()).find((x) => x.id === id);
    if (!h) continue;
    const plan = await planHoliday(h.exam, h.days, [center]);
    const p = plan.places[0];
    if (!p) continue;
    const cur = await holidays();
    shiftHols(cur, { ...h, places: [p], students: [] }, false);
    const rec = cur.find((x) => x.id === id)!;
    rec.places = [...rec.places, p];
    await saveHolidays(cur);
    await tx(async () => { for (const m of p.moved) await put("place_dates", { center_id: center, exam_id: m.exam, day: m.to, versions: m.toVersions }); });
    n++;
  }
  // عطلة ما بقى إلها مكان ولا طالب: تنشال
  await saveHolidays((await holidays()).filter((h) => h.insert || h.places.length || h.students.length));
  return n;
}
/** امتحان جديد بالبنك: ينحط بالجدول وحده قبل الامتحان اللي بعده بترتيب الكتاب، بكل مكان هذا الامتحان إله موعد بيه */
export async function autoInsertExam(add: number) {
  const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord) || a.id - b.id);
  const next = exams[exams.findIndex((x) => x.id === add) + 1];
  if (!next) return null;
  const centers: number[] = [];
  for (const c of [0, ...(await find("centers", { active: 1 })).map((x) => x.id as number)]) if (!await one("place_dates", { center_id: c, exam_id: add })) centers.push(c);
  const r = await insertBefore(next.id, add, centers);
  return r ? { ...r, before: String(next.title ?? "") } : null;
}
/** الطالب الخاص لغى العطلة، أو الإدارة شالتها: امتحاناته ترجع لمواعيدها، إذا محد غيرها بعدين */
async function restoreStudent(st: HolStudent) {
  for (const m of st.moves) {
    const it = await one("sched_items", { id: m.id });
    if (it?.status === "waiting" && it.at === m.to) await update("sched_items", { id: m.id }, { at: m.at });
  }
}
/** العطل الثانية اللي زحفت ويا امتحاناتها (forward)، أو ترجع لمكانها (back). المكان والطالب كل واحد بعطله */
function shiftHols(list: Holiday[], h: Holiday, back: boolean, uid?: number) {
  const fix = (r: Range, m: HolMove) => {
    const [a, b, c, d] = back ? [m.toFrom, m.toTo, m.from, m.to] : [m.from, m.to, m.toFrom, m.toTo];
    if (r.from === a && r.to === b) { r.from = c; r.to = d; }
  };
  for (const p of uid === undefined ? h.places : []) for (const m of p.hols ?? []) {
    const r = list.find((x) => x.id === m.id)?.places.find((y) => y.center === p.center);
    if (r) fix(r, m);
  }
  for (const st of h.students) if (uid === undefined || st.uid === uid) for (const m of st.hols ?? []) {
    const r = list.find((x) => x.id === m.id)?.students.find((y) => y.uid === st.uid);
    if (r) fix(r, m);
  }
}
const holidayText = (h: Holiday, r: Range) => `قبل امتحان ${esc(h.title)}${h.reason ? ` (${esc(h.reason)})` : ""}، ${r.from === r.to ? `يوم ${prettyDay(r.from)}` : `من ${prettyDay(r.from)} لـ ${prettyDay(r.to)}`}`;
async function applyHoliday(h: Holiday) {
  const list = await holidays();
  shiftHols(list, h, false);
  await saveHolidays(list);
  await tx(async () => {
    for (const p of h.places) for (const m of p.moved) await put("place_dates", { center_id: p.center, exam_id: m.exam, day: m.to, versions: m.toVersions });
    for (const st of h.students) for (const m of st.moves) await update("sched_items", { id: m.id }, { at: m.to });
    if (h.insert) {
      // الامتحان المضاف ياخذ اليوم اللي فرغ، وبجدول الطالب الخاص ياخذ موعد الامتحان اللي زحف
      for (const p of h.places) await put("place_dates", { center_id: p.center, exam_id: h.insert, day: p.from, versions: "{}" });
      h.added = [];
      for (const st of h.students) {
        const first = st.moves.find((m) => m.at.slice(0, 10) === st.from);
        if (first) h.added.push(await insert("sched_items", { user_id: st.uid, exam_id: h.insert, at: first.at, status: "waiting" }));
      }
    }
  });
  if (h.insert) {
    let told = 0;
    for (const p of h.places) told += await tellPlace(p.center);
    for (const st of h.students) {
      await send(st.uid, `🗓 <b>انضاف امتحان ${esc(h.title)}</b> بجدولك يوم ${prettyDay(st.from)}، وامتحاناتك من بعده تأخرت. افتح امتحاناتي وشوف المواعيد.`);
      await logActivity(st.uid, `🗓 انضافله امتحان ${h.title}، وزحف جدوله`);
    }
    return told + h.students.length;
  }
  let told = 0;
  for (const p of h.places) told += await tellPlace(p.center);
  for (const st of h.students) {
    await send(st.uid, `🏖 <b>عطلة ${holidayText(h, st)}</b>\nوامتحاناتك من بعدها تأخرت. افتح امتحاناتي وشوف المواعيد.\n\nإذا ما تريد العطلة: بامتحاناتي دوس «❌ ما أريد العطلة»، فجدولك يرجع يتقدم.`);
    await logActivity(st.uid, `🏖 انحطتله عطلة قبل ${h.title}، وزحف جدوله`);
  }
  return told + h.students.length;
}
async function undoHoliday(h: Holiday) {
  const list = await holidays();
  shiftHols(list, h, true);
  await saveHolidays(list);
  await tx(async () => {
    for (const p of h.places) {
      const slots = await placeSlots(p.center);
      const timesOf = (d: string) => slots.filter((t) => t.d === weekdayOf(d)).map((t) => t.t).sort();
      for (const m of p.moved) {
        const cur = await one("place_dates", { center_id: p.center, exam_id: m.exam });
        if (cur?.day !== m.to) continue;   // الإدارة غيرته بعد العطلة: يبقى مثل ما هو
        const versions = cur.versions === m.toVersions ? m.versions : JSON.stringify(remapByOrder(JSON.parse(cur.versions || "{}"), timesOf(m.to), timesOf(m.day)));
        await put("place_dates", { center_id: p.center, exam_id: m.exam, day: m.day, versions });
      }
    }
    if (h.insert) {
      for (const p of h.places) { const cur = await one("place_dates", { center_id: p.center, exam_id: h.insert }); if (cur?.day === p.from) await remove("place_dates", { center_id: p.center, exam_id: h.insert }); }
      for (const id of h.added ?? []) { const it = await one("sched_items", { id }); if (it?.status === "waiting") await remove("sched_items", { id }); }
    }
    for (const st of h.students) if (st.on) await restoreStudent(st);
  });
  for (const p of h.places) await tellPlace(p.center);
  if (h.insert) { for (const st of h.students) await send(st.uid, `🗓 <b>انشال امتحان ${esc(h.title)}</b> من جدولك، ورجعت مواعيد امتحاناتك. افتح امتحاناتي وشوفها.`); return; }
  for (const st of h.students) if (st.on) await send(st.uid, `🗓 <b>انشالت العطلة</b> ${holidayText(h, st)}، ورجعت مواعيد امتحاناتك. افتح امتحاناتي وشوفها.`);
}
/** جزء العطلة اللي يخص مكان واحد: مواعيده، وطلاب الجدول الخاص اللي بيه */
async function holidayPart(h: Holiday, center: number): Promise<Holiday> {
  const students: HolStudent[] = [];
  for (const st of h.students) if ((await placeFor(st.uid)).centerId === center) students.push(st);
  const uids = new Set(students.map((x) => x.uid));
  const added: number[] = [];
  for (const id of h.added ?? []) { const it = await one("sched_items", { id }); if (it && uids.has(it.user_id as number)) added.push(id); }
  return { ...h, places: h.places.filter((p) => p.center === center), students, added };
}
/** العطل اللي يشوفها الطالب بجدوله: عطل مكانه إذا ويا الطلاب، وعطله إذا جدول خاص (ويگدر يلغيها) */
async function myHolidays(uid: number, sc: Row | null) {
  const today = todayStr();
  const rows = (await holidays()).filter((h) => !h.insert).flatMap((h) => (sc?.mode === "general"
    ? h.places.filter((p) => p.center === sc.center_id).map((p) => ({ id: h.id, exam: h.exam, from: p.from, to: p.to, title: h.title, reason: h.reason, cancel: false }))
    : h.students.filter((x) => x.uid === uid && x.on).map((x) => ({ id: h.id, exam: h.exam, from: x.from, to: x.to, title: h.title, reason: h.reason, cancel: !x.kept, kept: !!x.kept }))));
  return mergeHolidays(rows).filter((x) => x.to >= today);
}
/** عطلة نصف السنة (أو عطلة الطالب الخاص اللي اختارها): سطر بجدوله بين الامتحانات، ويا وصفها */
async function midHolidayRow(sc: Row | null, s: SchedSettings) {
  const own = sc && sc.mode !== "general" ? holOf(sc.hol) : undefined;
  const mid = own ? (own.from && own.to ? own : null) : sc?.mode === "general" ? await midFor(Number(sc.center_id ?? 0), s) : midRange(s);
  return mid && mid.to >= todayStr() ? { from: mid.from, to: mid.to, reason: own ? "عطلتك" : s.holidayNote || "عطلة نصف السنة" } : null;
}
/** عطلة فوك عطلة قبل نفس الامتحان: تطلع عطلة وحدة من أول يوم لآخر يوم */
function mergeHolidays<T extends { id: number; exam: number; from: string; to: string; reason: string }>(rows: T[]) {
  const out: (T & { ids: number[] })[] = [];
  for (const r of [...rows].sort((a, b) => a.from.localeCompare(b.from))) {
    const same = out.find((x) => x.exam === r.exam);
    if (!same) { out.push({ ...r, ids: [r.id] }); continue; }
    same.ids.push(r.id);
    if (r.to > same.to) same.to = r.to;
    // كل عطلة بسببها: «استعداد للفاينل، عيد»
    if (r.reason && !same.reason.split("، ").includes(r.reason)) same.reason = same.reason ? `${same.reason}، ${r.reason}` : r.reason;
  }
  return out;
}
/** أوقات كل يوم من أيام المكان، حتى يختار الطالب وقت لكل يوم */
function daysView(slots: Slot[], full?: Set<string>) {
  return DAY_ORDER.filter((d) => slots.some((x) => x.d === d)).map((d) => ({ d, name: DAYS[d], times: slots.filter((x) => x.d === d).map((x) => x.t).sort().map((t) => ({ t, label: ampm(t), ...(full?.has(`${d}|${t}`) ? { full: true } : {}) })) }));
}
/** طالب «ويا الطلاب» يغير وقت يوم من أيامه بكيفه، إذا امتحانه الجاي بهذا اليوم بعده أكثر من 24 ساعة */
const MOVE_HOURS = 24;
const hoursUntil = (at: string, now = stamp()) => (Date.parse(`${at.replace(" ", "T")}:00Z`) - Date.parse(`${now.replace(" ", "T")}:00Z`)) / 3_600_000;
/** يغير وقت جروبه: الطالب بشرط 24 ساعة والعدد، وصاحب البوت بأي وقت (والعدد بعد تنبيه) */
export async function movePick(uid: number, d: number, t: string, by: "student" | "owner", force = false) {
  const sc = await one("schedules", { user_id: uid });
  need(sc?.mode === "general", "هذا لطالب «ويا الطلاب»");
  const slots = await placeSlots(sc!.center_id);
  need(slots.some((x) => x.d === d && x.t === t), "اختار من أوقات المكان بهذا اليوم");
  const picks = picksOf(sc!);
  const old = picks[String(d)];
  need(old !== t, "هذا نفس وقتك");
  const s = await schedSettings();
  if (by === "student") {
    const next = (await find("sched_items", { user_id: uid, status: "waiting" })).filter((i) => !i.fixed && i.notified !== "test" && weekdayOf(String(i.at).slice(0, 10)) === d && String(i.at) > stamp())
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
    need(!next || hoursUntil(String(next.at)) >= MOVE_HOURS, next ? `امتحانك الجاي يوم ${prettyDay(String(next.at).slice(0, 10))} الساعة ${ampm(String(next.at).slice(11, 16))} بعده أقل من 24 ساعة، فوقته ما يتغير. تگدر تغير وقت ${DAYS[d]} بعد ما يخلص` : "");
  }
  const why = await seatProblem(sc!.center_id, d, t, await student(uid), { except: uid });
  if (why && !(by === "owner" && force)) throw new ApiError(409, by === "owner" ? `${why.replace(". اختار وقت ثاني", "")}. تريد تضيفه فوك العدد؟` : why, by === "owner" ? { askForce: true } : undefined);
  await update("schedules", { user_id: uid }, { picks: JSON.stringify({ ...picks, [String(d)]: t }) });
  await syncGeneral(uid, (await one("schedules", { user_id: uid }))!, s);
  await logActivity(uid, `🕐 ${by === "owner" ? "الإدارة غيرت" : "غير"} وقت ${DAYS[d]}: من ${old ? ampm(old) : "—"} إلى ${ampm(t)}${why ? " (فوك العدد)" : ""}`);
  return `✅ صار وقتك يوم ${DAYS[d]} الساعة ${ampm(t)}، وكل امتحاناتك الجاية بهذا اليوم تمشي عليه`;
}
/** لازم وقت من أوقات المكان لكل يوم */
const picksFit = (slots: Slot[], picks: Record<string, string>) => [...new Set(slots.map((x) => x.d))].every((d) => slots.some((x) => x.d === d && x.t === picks[String(d)]));
/** اشترى متأخر: امتحانات موعدها فات وما انحسبت بعد. نسأله يبقى ويا الطلاب لو يتحول خاص */
async function lateExams(uid: number, sc: Row, s: SchedSettings): Promise<Row[]> {
  const days = await placeDays(sc.center_id);
  const picks = picksOf(sc);
  const has = new Set((await find("sched_items", { user_id: uid })).filter((i) => i.kind !== "optional").map((i) => i.exam_id));
  const now = stamp();
  const out: Row[] = [];
  const since = await chapterSince(uid);
  for (const e of await boughtExams(uid)) {
    const at = days.has(e.id) ? pickedAt(days.get(e.id)!, picks) : null;
    if (!at || has.has(e.id)) continue;
    // اشترى قبل الامتحان بأقل من 24 ساعة: ما ينحسب عليه، يروح ويا التعويض
    const bought = labelChapters(String(e.chapter ?? "")).map((c) => since.get(c)).filter(Boolean).sort()[0];
    const soon = !!bought && at >= bought && at < addMinutes(bought, GRACE_MIN);
    if (soon || itemState("waiting", at, s.window, now) === "missed") out.push({ ...e, at, soon });
  }
  return out;
}
/** الطالب العام: يوم كل امتحان من المكان، والوقت من اختياره. يتحدث بس إذا تغير شي */
async function syncGeneral(uid: number, sc: Row, s: SchedSettings) {
  const days = await placeDays(sc.center_id);
  const picks = picksOf(sc);
  const items = await find("sched_items", { user_id: uid });
  const lateList = await lateExams(uid, sc, s);
  const late = new Set(lateList.map((e) => e.id));
  // فصل تعويضي وبعده ما سوى جدول تعويضه (قاعدة الأستاذ 2026-11-20): ولا امتحان من هذا الفصل ينحط بجدوله،
  // فما ينحسب غايب. من يسوي جدول التعويض، الجاي من الفصل يرجع ويا الطلاب، والغياب يبدي من بعدها
  const held = new Set(lateList.length && await hasMakeup(lateList) ? lateList.flatMap((e) => labelChapters(String(e.chapter ?? ""))) : []);
  const wanted: string[] = [];
  for (const e of remaining(await boughtExams(uid), items)) {
    if (labelChapters(String(e.chapter ?? "")).some((c) => held.has(c))) continue;
    const at = days.has(e.id) && !late.has(e.id) ? pickedAt(days.get(e.id)!, picks) : null;
    if (at) wanted.push(`${e.id}|${at}`);
  }
  wanted.sort();
  const trial = new Set(items.filter((i) => i.status === "waiting" && i.notified === "test").map((i) => i.exam_id));
  const keep = wanted.filter((w) => !trial.has(Number(w.split("|")[0])));
  const have = items.filter((i) => i.status === "waiting" && i.notified !== "test" && !i.fixed).map((i) => `${i.exam_id}|${i.at}`).sort();
  if (keep.join() === have.join()) return;
  await tx(async () => {
    for (const i of items) if (i.status === "waiting" && i.notified !== "test" && !i.fixed) await remove("sched_items", { id: i.id });
    for (const w of keep) { const [e, at] = w.split("|"); await insert("sched_items", { user_id: uid, exam_id: Number(e), at, status: "waiting" }); }
  });
  await closeMissed(uid, s);
}
/** الحضوري بالآيباد: ينتظر الحضور بالمركز لحد ما يفوت وقت الدخول، وبعد الحضور الامتحان مفتوح إله */
function ipadState(status: string, state: string) {
  if (status === "started" || status === "attended") return "open" as const;
  if (status === "done") return "done" as const;
  return state === "missed" ? "past" as const : "center" as const;
}
async function itemsView(uid: number, s: SchedSettings) {
  await closeFinished(uid, s);
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const now = stamp();
  // الحضوري ينقدم بالمركز، إلا إذا صاحب البوت فتحله يصور أجوبته بنفسه
  const inPerson = (await placeFor(uid)).inPerson && !await photosAllowed(uid);
  const ipad = inPerson && await ipadExam(uid);
  const lec = await lectureMap();
  // وين ينقدم: الإدارة تگدر تفتحه «إلكتروني من بيته» لو «بمركزه بالآيباد»، والتعويض حسب اختياره
  // درجة ولي أمره بعده ما استلمها: الرقم ما يطلع للطالب (طلب الأستاذ 2026-11-24)
  const gw = new Set((await guardWaitOf(uid))?.pending ?? []);
  const placeOf = (i: Row) => (i.catch_place === "online" ? "online" : i.catch_place === "ipad" ? "ipad" : i.kind === "catchup" ? "online" : ipad ? "ipad" : inPerson ? "paper" : "online");
  return (await find("sched_items", { user_id: uid }, { order: ["at"] })).filter((i) => i.status !== "skipped").map((i) => {
    const e = exams.get(i.exam_id);
    const state = roomState(i, s, now);
    // الحضوري ينقدم بالمركز، فبعد موعده يكفي نگول انتهى
    return { id: i.id, exam: i.exam_id as number, optional: i.kind === "optional", catchup: i.kind === "catchup", total: i.graded_at && !gw.has(Number(i.id)) ? i.total : null, gwait: !!i.graded_at && gw.has(Number(i.id)), title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", minutes: e?.minutes ?? 75, lectures: i.kind === "optional" ? [] : lec.get(i.exam_id) ?? [], at: i.at, exc: i.exc_state ?? null, status: i.status, retake: !!i.retake_of,
      // بالآيباد بالمركز: ينتظر الحضور، ومن ينسجل تنفتح أسئلته (التعويض الحضوري هم)
      ipad: placeOf(i) === "ipad", away: i.catch_place === "online",
      state: placeOf(i) === "online" ? state : placeOf(i) === "ipad" ? ipadState(i.status, state) : inPerson && state !== "locked" ? "past" : inPerson ? "center" : state };
  });
}
/** امتحانات الفصول المشتراة اللي عندها نسخة اختيارية. كل واحد ينفتح مرة وحدة بوقت يختاره الطالب */
/** 🧪 الاختبار الذاتي (الامتحان الاختياري): مرة وحدة لكل امتحان، وبس قبل الامتحان الرسمي (طلبه 2026-11-26).
 *  الرسمي اللي انفتح أو فات أو انحل: اختباره الذاتي ما يطلع */
async function optionalList(uid: number, bought: Row[]) {
  const versions = await find("bank_versions", { kind: "optional", ok: 1 });
  const items = await find("sched_items", { user_id: uid });
  const taken = new Set(items.filter((i) => i.kind === "optional").map((i) => i.exam_id));
  const s = await schedSettings(), now = stamp();
  const past = new Set(items.filter((i) => i.kind !== "optional" && i.status !== "skipped" && (i.status !== "waiting" || itemState("waiting", String(i.at), s.window, now) !== "locked")).map((i) => i.exam_id));
  return bought.filter((e) => versions.some((v) => v.exam_id === e.id) && !taken.has(e.id) && !past.has(e.id)).map((e) => ({ exam: e.id, title: e.title, chapter: e.chapter, minutes: e.minutes ?? 75 }));
}
/** للمسار: الامتحانات اللي اختبارها الذاتي متاح هسه، واللي انحل (ودرجته) */
export async function selfTests(uid: number) {
  const s = await schedSettings();
  const st = await student(uid);
  const off = !s.optionalOpen || !st; // الحضوري هم (طلبه 2026-11-26): يختبر نفسه من بيته، والرسمي بالمركز
  const open = off ? new Set<number>() : new Set((await optionalList(uid, await boughtExams(uid))).map((x) => Number(x.exam)));
  const done = new Map<number, Row>();
  for (const i of await find("sched_items", { user_id: uid, kind: "optional" })) done.set(Number(i.exam_id), i);
  return { open, done };
}
async function studentInfo(uid: number) {
  // درجات كانت تنتظر ولي الأمر وهسه ما تنتظر (انفك الربط، لو حظر البوت): توصله
  try { await (await import("./gradeApi.ts")).releaseStudent(uid); } catch (e) { console.error(e); }
  const s = await schedSettings();
  await closeMissed(uid, s);
  const st = await student(uid);
  const sched = await one("schedules", { user_id: uid });
  const general = sched?.mode === "general";
  if (general) await syncGeneral(uid, sched!, s);
  const bought = await boughtExams(uid);
  const items = await find("sched_items", { user_id: uid });
  const left = remaining(bought, items);
  const planned = new Set(items.filter((i) => i.status === "waiting").map((i) => i.exam_id));
  const place = await placeFor(uid);
  const slots = await placeSlots(place.centerId);
  const late = general ? await lateExams(uid, sched!, s) : [];
  // جدول المكان كله يطلع حتى يعرف شوكت يخلص، والفصول اللي ما اشتراها مقفولة
  const lockedRows: Row[] = [];
  // طالب المنهج الإنجليزي يشوف عناوين الامتحانات بالإنجليزي
  const byId = new Map((await find("bank_exams")).map((e) => [e.id as number, e]));
  const enTitle = (exam: number, title: string) => (st?.curr === "إنجليزي" && byId.get(exam)?.title_en) || title;
  const lec = await lectureMap();
  const skip = new Set(await skippableExams()), kept = new Set(await keptExams(uid));
  if (general) {
    const mine = new Set(bought.map((e) => e.id));
    const allExams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
    const picks = picksOf(sched!);
    for (const [examId, day] of await placeDays(sched!.center_id)) {
      const e = allExams.get(examId);
      const at = pickedAt(day, picks);
      if (e && at && !mine.has(examId)) lockedRows.push({ id: -e.id, title: titleFor(e, st?.curr), chapter: e.chapter, minutes: e.minutes ?? 75, lectures: lec.get(e.id) ?? [], at, state: "notbought" });
    }
  }
  return {
    // اللي مشتري محاضرات يدوس على المحاضرة فيفتح التطبيق
    appLink: await boughtLectures(uid) ? await appLink() : "",
    // كود الحضور: المساعد يقراه بالمركز
    attendCode: place.inPerson ? studentCode(uid) : "",
    // الحضوري يختار يمتحن بالآيباد (إذا مركزه ما مفتوحله يصور)
    ipad: place.inPerson && !await photosAllowed(uid) ? await ipadExam(uid) : null,
    // 🐢 الجدول البطيء لطلاب الخامس: يحط تاريخ ووقت كل امتحان بإيده
    slowOk: st?.grade === SLOW_GRADE,
    // بنين لو بنات والصف ناقصات: يختارهن قبل ما يرتب
    basics: (await import("./basics.ts")).missingBasics(st),
    inPerson: place.inPerson, place: place.label, name: st?.name ?? "", remaining: left.length, mode: sched?.mode ?? (sched ? "private" : null),
    needsChoice: !sched && left.length > 0,
    // وهو يرتب جدوله الخاص: الامتحانات اللي يگدر يشيلها من هسه
    canDrop: left.filter((e) => skip.has(e.id)).map((e) => ({ exam: e.id as number, title: enTitle(e.id, String(e.title)) })),
    // جدوله كامل وهو يرتب: كل الامتحانات بالترتيب، واللي «يمكن حذفه» معلم
    toPlan: left.map((e) => ({ exam: e.id as number, title: enTitle(e.id, String(e.title)), chapter: String(e.chapter), skip: skip.has(e.id) })),
    perWeekMax: s.perWeek, needsBuild: !general && left.some((e) => !planned.has(e.id)),
    // الإدارة غيرت الأوقات واللي اختاره راح: يختار من جديد
    repick: general && !picksFit(slots, picksOf(sched!)),
    picks: general ? picksOf(sched!) : null,
    schedule: sched && !general ? { start: sched.start_day, end: sched.end_day, weekdays: JSON.parse(sched.weekdays), hour: sched.hour, times: sched.picks ? JSON.parse(sched.picks) : null, hol: holOf(sched.hol) ?? null } : null,
    holidays: await myHolidays(uid, sched), midHol: await midHolidayRow(sched, s), gap: s.gap,
    days: daysView(slots, await fullTimes(place.centerId, slots, st, uid)),
    optional: !s.optionalOpen ? [] : await optionalList(uid, bought),
    // آخر سيطرة عبرها: تومض ويا شخصيتها لحد ما يشوفها
    cp: await checkpointCard(uid),
    // ملفات المحاضرات اللي صاحب البوت خلاها ظاهرة. وبنص الامتحان ماكو ملفات ولا رابط التطبيق
    inExam: await examInProgress(uid),
    lectureFiles: await examInProgress(uid) ? [] : await visibleLectureFiles(),
    // المنافسة: مجموعته وترتيبه بالمركز
    comp: await studentComp(uid),
    late: late.map((e) => ({ title: e.title, at: e.at })), lateText: LATE_TEXT, closedText: CLOSED_TEXT,
    // فصل صار تعويضي: يطلعله جدول تعويضي مكثف بدل «تنحسب فايتة»
    catchup: late.length > 0 && await hasMakeup(late), catchHours: allowedHours(s),
    catchPlan: late.length > 0 && await hasMakeup(late) ? await catchView(uid, late, s) : null,
    // 🚀 يبدي الفصل اللي ورا العطلة من هسه، ويا المراجعات لو بدونها
    early: await earlyView(uid, sched, s),
    // ولي الأمر ما استلم: الدرجات اللي تنتظره، والقفل بعد 3 أيام، وتأجيل السفر
    guardWait: await guardWaitOf(uid),
    items: [...(await itemsView(uid, s)).map((i) => ({ ...i, title: enTitle(i.exam, i.title), skippable: !general && !!sched && i.status === "waiting" && !i.optional && i.state === "locked" && skip.has(i.exam) && !kept.has(i.exam) })), ...lockedRows].sort((a, b) => String(a.at).localeCompare(String(b.at))), today: todayStr(), minStart: addDays(todayStr(), 1), window: s.window, perDay: await perDayFor(uid, s),
    week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), hours: allowedHours(s), offDays: s.offDays,
    holiday: s.holidayStart && s.holidayDays ? { start: s.holidayStart, days: s.holidayDays } : null,
    holReq: (await holRequests()).find((r) => r.uid === uid) ?? null,
  };
}
/** عطلة الطالب الخاص اللي اختارها هو (من، إلى). فاضية = بدون عطلة. ما محفوظة (جدول قديم) = عطلة نصف السنة مال الإدارة */
type OwnHol = { from: string; to: string };
const holOf = (raw: unknown): OwnHol | undefined => { try { const j = JSON.parse(String(raw ?? "")); return j && typeof j === "object" ? { from: String(j.from ?? ""), to: String(j.to ?? "") } : undefined; } catch { return undefined; } };
function withOwnHol(s: SchedSettings, hol?: OwnHol): SchedSettings {
  if (!hol) return s;
  if (!hol.from || !hol.to) return { ...s, holidayStart: "", holidayDays: 0 };
  let n = 0; for (let d = hol.from; d <= hol.to; d = addDays(d, 1)) n++;
  return { ...s, holidayStart: hol.from, holidayDays: n };
}
/** عطلة من إلى من الصفحة. الاثنين فاضيات = بدون عطلة */
function holFromBody(body: Row): OwnHol {
  const from = String(body.holFrom ?? ""), to = String(body.holTo ?? "");
  if (from || to) {
    need(validDay(from) && validDay(to), "اختار العطلة من تاريخ إلى تاريخ، أو شيلها");
    need(to >= from, "نهاية العطلة لازم تكون بعد بدايتها");
    need(addDays(from, 120) >= to, "العطلة أطول من 120 يوم");
  }
  return { from, to };
}
const holText = (h?: OwnHol | null) => (h && h.from && h.to ? `من ${prettyDay(h.from)} إلى ${prettyDay(h.to)}` : "بدون عطلة");
/** طلبات طلاب الجدول الخاص لتغيير عطلتهم: تنتظر موافقة الإدارة */
const HOL_REQ = "hol_requests";
type HolReq = OwnHol & { uid: number; at: string };
async function holRequests(): Promise<HolReq[]> { try { const j = JSON.parse(await kvGet(HOL_REQ) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } }
const saveHolRequests = (l: HolReq[]) => kvSet(HOL_REQ, JSON.stringify(l));
/** جدول طالب خاص ينعاد من باجر بعطلة جديدة. اللي فات واللي ثابت باليد ما يتحرك */
export async function setStudentHoliday(uid: number, hol: OwnHol) {
  const s = await schedSettings();
  const sc = await one("schedules", { user_id: uid });
  need(sc && sc.mode !== "general" && sc.mode !== "slow", "هذا الطالب ما عنده جدول خاص");
  await closeMissed(uid, s);
  const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  const f = { start: addDays(todayStr(), 1), end: sc!.pack ? addDays(todayStr(), PACK_DAYS) : sc!.end_day, pack: !!sc!.pack, weekdays: JSON.parse(sc!.weekdays), hour: sc!.hour, times: sc!.picks ? JSON.parse(sc!.picks) as Record<string, string[]> : undefined, hol };
  const plan = buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings: { ...withOwnHol(s, hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] } });
  need(left.length === 0 || plan.ok, plan.ok ? "" : `بهذي العطلة ما يكفي الوقت: ${plan.error}`);
  await saveItems(uid, { ...f, start: sc!.start_day }, plan.ok ? plan.items : []);
  await saveHolRequests((await holRequests()).filter((r) => r.uid !== uid));
  await logActivity(uid, `🏖 تغيرت عطلته: ${holText(hol)}`);
  return holText(hol);
}
/** الجدول بالأسبوع يدور أيام لحد 3 سنين */
const PACK_DAYS = 1100;
function formOf(body: Row, minStart: string) {
  const start = body.start;
  // pack: اختار كم امتحان بالأسبوع، فالنهاية تطلع من الحساب
  const pack = !!body.pack;
  const end = pack && validDay(start) ? addDays(String(start), PACK_DAYS) : body.end;
  need(validDay(start) && validDay(end), pack ? "اختار تاريخ البداية" : "اختار تاريخ البداية والنهاية");
  need(start >= minStart, "تاريخ البداية لازم يكون من باجر فصاعداً");
  const weekdays = [...new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number))].filter((d) => DAY_ORDER.includes(d)) as number[];
  // وقت كل امتحان باليوم (الأول والثاني...) لكل يوم من أيامه، يختاره الطالب
  let times: Record<string, string[]> | undefined;
  if (body.times && typeof body.times === "object") {
    need(weekdays.length, "اختار أيام الامتحان");
    times = {};
    for (const d of weekdays) {
      const raw = (body.times as Row)[String(d)];
      const list = (Array.isArray(raw) ? raw : []).map(String).filter(Boolean);
      need(list.length, "اختار وقت الامتحان لكل يوم");
      need(list.every((t) => /^\d{2}:\d{2}$/.test(t)), "وقت غير صحيح");
      need(list.every((t, i) => !i || t > list[i - 1]), "وقت الامتحان الثاني لازم يكون بعد الأول");
      times[String(d)] = list;
    }
  }
  const hour = times ? Number(times[String(weekdays[0])][0].slice(0, 2)) : intOf(body.hour, 0, 23, "اختار الساعة");
  // عطلته: يختارها هو من إلى، أو يشيلها
  const hol = body.holFrom !== undefined || body.holTo !== undefined ? holFromBody(body) : undefined;
  return { start: start as string, end: end as string, weekdays, hour, times, hol, pack };
}
async function planFor(uid: number, body: Row) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const f = formOf(body, addDays(todayStr(), 1));
  const place = await placeFor(uid);
  if (place.inPerson) {
    // الحضوري الخاص: نفس أيام مركزه وأوقاته، مو بكيفه
    const slots = await placeSlots(place.centerId);
    need(slots.length, "مركزك ما بيه أوقات بعد");
    need(f.times, "اختار وقت الامتحان من أوقات مركزك");
    need(f.weekdays.every((d) => slots.some((x) => x.d === d)), "اختار من أيام مركزك بس");
    need(f.weekdays.every((d) => f.times![String(d)].every((t) => slots.some((x) => x.d === d && x.t === t))), "اختار من أوقات مركزك بس");
  } else {
    need(!f.weekdays.some((d) => s.offDays.includes(d)), `لا يوجد امتحانات في هذا اليوم: ${f.weekdays.filter((d) => s.offDays.includes(d)).map((d) => DAYS[d]).join("، ")}. اختار غيره`);
  }
  if (!place.inPerson && f.times) need(Object.values(f.times).flat().every((t) => { const h = Number(t.slice(0, 2)); return h >= s.fromHour && h <= s.toHour; }), `الامتحان يبدي من الساعة ${ampm(`${String(s.fromHour).padStart(2, "0")}:00`)} إلى ${ampm(`${String(s.toHour).padStart(2, "0")}:00`)} بس`);
  const all = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  // الامتحانات اللي «يمكن حذفه» وشالها وهو يرتب: ما تدخل الجدول
  const skippable = new Set(await skippableExams());
  const drop = [...new Set((Array.isArray(body.drop) ? body.drop : []).map(Number))];
  need(drop.every((x) => skippable.has(x) && all.some((e) => e.id === x)), "هذا الامتحان ما يمكن حذفه");
  const left = all.filter((e) => !drop.includes(e.id));
  need(left.length, "شلت كل الامتحانات. خلي واحد على الأقل");
  if (f.pack) {
    need(f.times, "اختار وقت الامتحان لكل يوم");
    const week = f.weekdays.reduce((t, d) => t + (f.times![String(d)]?.length ?? 0), 0);
    need(week <= s.perWeek, `أكثر شي ${s.perWeek} امتحانات بالأسبوع. احذف يوم أو وقت`);
  }
  const settings = { ...withOwnHol(s, f.hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] };
  return { f, left, drop, plan: buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings }) };
}
/** «كم امتحان بالأسبوع؟»: لكل اختيار، شوكت يخلص الفصول اللي اشتراها، وشوكت يخلص المنهج كله إذا كمل بنفس الوتيرة واشترى الباقي */
async function paceInfo(uid: number, body: Row) {
  const s = await schedSettings();
  const start = String(body.start ?? "");
  need(validDay(start), "اختار تاريخ البداية");
  const items = await find("sched_items", { user_id: uid });
  const drop = new Set((Array.isArray(body.drop) ? body.drop : []).map(Number));
  const mine = await scheduleChapters(uid);
  const all = await allChapters();
  const last = Math.max(-1, ...mine.flatMap(labelChapters).map((c) => all.indexOf(c)));
  const later = all.filter((_, i) => i > last);
  const left = remaining(await examsFor(mine), items).filter((e) => !drop.has(e.id));
  const whole = remaining(await examsFor([...mine, ...later]), items).filter((e) => !drop.has(e.id));
  const place = await placeFor(uid);
  // أيام مركزه للحضوري، وكل الأيام إلا المحجوبة للإلكتروني
  const centerDays = place.inPerson ? new Set((await placeSlots(place.centerId)).map((x) => x.d)) : null;
  const usable = DAY_ORDER.filter((d) => (centerDays ? centerDays.has(d) : !s.offDays.includes(d)));
  const hol = body.holFrom !== undefined || body.holTo !== undefined ? holFromBody(body) : undefined;
  const settings = { ...withOwnHol(s, hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] };
  const perDay = await perDayFor(uid, s);
  // أيام متباعدة بالأسبوع: k امتحان، كل يوم واحد، وإذا الأيام ما تكفي امتحانين باليوم
  const endOf = (list: Row[], k: number) => {
    if (!list.length || !usable.length) return null;
    const per = Math.ceil(k / usable.length);
    if (per > perDay) return null;
    const pick = usable.length >= k ? Array.from({ length: k }, (_, i) => usable[Math.floor((i * usable.length) / k)]) : usable;
    const times: Record<string, string[]> = {};
    let room = k;
    for (const d of pick) { const c = Math.min(per, room); room -= c; times[String(d)] = ["06:00", "12:00", "18:00", "23:00"].slice(0, c); }
    const wd = pick.filter((d) => times[String(d)].length);
    const plan = buildPlan(toPlanExams(list).map((e) => ({ ...e, minutes: 60 })), { start, end: addDays(start, PACK_DAYS), weekdays: wd, hour: 6, perDay, settings: { ...settings, gap: 0 }, times, pack: true });
    return plan.ok && plan.items.length ? plan.items[plan.items.length - 1].at.slice(0, 10) : null;
  };
  const low = Math.min(2, s.perWeek);
  const options = Array.from({ length: s.perWeek - low + 1 }, (_, i) => low + i).map((k) => ({ k, end: endOf(left, k), all: later.length ? endOf(whole, k) : null })).filter((o) => o.end);
  return { n: left.length, nAll: whole.length, chapters: mine, later, options };
}
async function saveItems(uid: number, f: Row & { times?: Record<string, string[]>; hol?: OwnHol; pack?: boolean }, items: { examId: number; at: string }[]) {
  await tx(async () => {
    // بالأسبوع: النهاية هي آخر امتحان
    const end = f.pack && items.length ? items.map((i) => i.at.slice(0, 10)).sort().pop()! : f.end;
    await put("schedules", { user_id: uid, mode: "private", center_id: null, picks: f.times ? JSON.stringify(f.times) : null, start_day: f.start, end_day: end, weekdays: JSON.stringify(f.weekdays), hour: f.hour, created: stamp(), hol: f.hol ? JSON.stringify(f.hol) : null, pack: f.pack ? 1 : null });
    await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed });
    for (const it of items) await insert("sched_items", { user_id: uid, exam_id: it.examId, at: it.at, status: "waiting" });
  });
}

export async function myExamAction(body: Row) {
  await ensure();
  // صاحب البوت يشوف جدول الطالب مثل ما يطلعله: عرض بس، بلا قفل جهاز، وما يتغير شي
  const viewed = verifyViewToken(body?.token);
  if (viewed !== null) {
    // يگدر يفتح ورقته وتصحيحها كمان (قراية بس)، طلب الأستاذ 2026-11-21
    const va = String(body.action ?? "");
    need(va === "info" || va === "paper", "👁 هذا عرض بس لجدول الطالب، ما تگدر تغير شي منه");
    need(await student(viewed), "الطالب غير موجود");
    if (va === "paper") return { ...await studentInfo(viewed), viewOnly: true, paper: await myPaper(viewed, body.item) };
    return { ...await studentInfo(viewed), viewOnly: true };
  }
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  const id = uid!;
  const a = String(body.action ?? "");
  need(await student(id), "سجل معلوماتك أول");
  await checkDevice(id, body.device);
  await checkPhone(id, body.pf);
  // الموقوف: يدخل بس على الامتحان اللي فتحته الإدارة إله
  await checkStopped(id, ["openExam", "oath", "delAnswer", "submitExam", "examLeft"].includes(a) ? body.item ?? -1 : undefined);
  // سلّم أول امتحان: الحساب ينقفل لحد ما يربط ولي أمره
  need(!await needsGuardian(id), "🔒 حسابك مقفول لحد ما تربط ولي أمرك. افتح 🏠 القائمة الرئيسية وسوي الخطوات، أو شوف الرسالة بالمحادثة.");
  if (a === "slowSave" || a === "slowMove") {
    await (await import("./basics.ts")).needBasics(id);
    const notice = a === "slowSave" ? await slowSave(id, body.items) : await slowMove(id, body.item, body.at);
    return { ...await studentInfo(id), notice };
  }
  if (["placePreview", "joinPlace", "preview", "confirm", "pace", "movePick", "moveTime", "lateCatchup", "lateKeep", "latePrivate"].includes(String(a))) await (await import("./basics.ts")).needBasics(id);
  if (a === "setBasics") { await (await import("./basics.ts")).setBasics(id, body); return await studentInfo(id); }
  if (a === "pace") return { ...await studentInfo(id), pace: await paceInfo(id, body) };
  if (a === "preview" || a === "confirm") {
    const info = await studentInfo(id);
    need(info.needsBuild, "جدولك مثبت. لتغييره تواصل ويا قصي العميري");
    const { f, left, drop, plan } = await planFor(id, body);
    need(plan.ok, plan.ok ? "" : plan.error);
    if (!plan.ok) return {};
    const titles = new Map(left.map((e) => [e.id, e.title]));
    // الامتحانات اللي «يمكن حذفه» تتعلم بالمعاينة، حتى يعرف من هسه شنو يگدر يشيل بعد التثبيت
    const skip = new Set(await skippableExams());
    if (a === "preview") return { ...await studentInfo(id), preview: { items: plan.items.map((i) => ({ title: titles.get(i.examId), at: i.at, skip: skip.has(i.examId) })), days: plan.days, maxPerDay: plan.maxPerDay, perWeek: plan.perWeek } };
    { const why = await seatProblems((await placeFor(id)).centerId, plan.items, await student(id), id); need(!why, why); }
    await saveItems(id, f, plan.items);
    for (const x of drop) await insert("sched_items", { user_id: id, exam_id: x, at: stamp(), status: "skipped" });
    await logActivity(id, `🗓 ثبت جدول امتحاناته: ${plan.items.length} امتحان${drop.length ? `، وشال ${drop.length}` : ""}`);
    return { ...await studentInfo(id), notice: "✅ انثبت جدولك" };
  }
  if (a === "placePreview" || a === "joinPlace") {
    const place = await placeFor(id);
    const sc = await one("schedules", { user_id: id });
    const slots = await placeSlots(place.centerId);
    need(!sc || (sc.mode === "general" && !picksFit(slots, picksOf(sc))), "جدولك مثبت. لتغييره تواصل ويا قصي العميري");
    need(slots.length, "مكانك ما بيه أوقات بعد");
    const picks: Record<string, string> = {};
    for (const [k, v] of Object.entries((body.picks ?? {}) as Row)) picks[String(k)] = String(v);
    need(picksFit(slots, picks), "اختار وقت لكل يوم من أوقات مكانك");
    const me = await student(id);
    for (const [d, t] of Object.entries(picks)) { const why = await seatProblem(place.centerId, Number(d), t, me, { except: id }); need(!why, why); }
    if (a === "joinPlace") {
      await put("schedules", { user_id: id, mode: "general", center_id: place.centerId, picks: JSON.stringify(picks), created: stamp() });
      await logActivity(id, `🗓 اختار يمشي ويا الطلاب: ${daysView(slots).map((d) => `${d.name} ${ampm(picks[String(d.d)])}`).join("، ")}`);
      return { ...await studentInfo(id), notice: "✅ انثبت جدولك" };
    }
    const days = await placeDays(place.centerId);
    const bought = await boughtExams(id);
    const mine = new Set(bought.map((e) => e.id));
    const dated = (await find("bank_exams")).filter((e) => days.has(e.id));
    return { ...await studentInfo(id), placePreview: { items: dated.map((e) => ({ title: e.title, at: pickedAt(days.get(e.id)!, picks), locked: !mine.has(e.id) })).filter((x) => x.at).sort((x, y) => String(x.at).localeCompare(String(y.at))), waiting: bought.filter((e) => !days.has(e.id)).length } };
  }
  if (a === "openOptional") {
    const s = await schedSettings();
    need(s.optionalOpen, "الامتحانات الاختيارية مسدودة هسه");
    const bought = await boughtExams(id);
    const e = (await optionalList(id, bought)).find((x) => x.exam === Number(body.exam));
    need(e, "هذا الامتحان مو متاح");
    const version = pickOptional(await find("bank_versions", { exam_id: e!.exam }) as { id: number; kind: string; ok: unknown }[]);
    need(version, "هذا الامتحان مو متاح");
    const now = stamp();
    // من البيت دائماً، حتى للحضوري: يصور جوابه بموبايله («💻 إلكتروني من بيته»)
    const item = await insert("sched_items", { user_id: id, exam_id: e!.exam, at: now, status: "started", kind: "optional", version_id: version, started_at: now, opened_at: now, catch_place: "online" });
    await logActivity(id, `🎯 دخل امتحان اختياري: ${e!.title}`);
    const room = await openRoom(id, item, s);
    return { ...await studentInfo(id), room };
  }
  if (a === "ipadExam") {
    const st = await student(id);
    need(st?.exam === "حضوري" && !await photosAllowed(id), "هذا للطالب الحضوري بس");
    await setIpadExam(id, !!body.on);
    return { ...await studentInfo(id), notice: body.on ? "📱 تمام: بالمركز ما تنطبعلك ورقة، ومن يسجلون حضورك تنفتح أسئلتك بالآيباد" : "📄 رجعت تمتحن بالورقة بالمركز" };
  }
  if (a === "examLeft") return await examLeft(id, body.item, await schedSettings(), body.phase, body.secs);
  if (a === "openExam" || a === "delAnswer" || a === "submitExam" || a === "oath") {
    const s = await schedSettings();
    // الغرفة أول: تحديث المواعيد يعيد كتابة الامتحانات اللي لسه ما بدت
    if (a === "openExam") { const room = await openRoom(id, body.item, s, body.tablet); return { ...await studentInfo(id), room }; }
    if (a === "oath") { const room = await takeOath(id, body.item, s, body.text); return { ...await studentInfo(id), room }; }
    if (a === "delAnswer") { const room = await deleteAnswer(id, body.item, body.answer, s); return { ...await studentInfo(id), room }; }
    await submitRoom(id, body.item, s);
    return { ...await studentInfo(id), notice: "✅ وصلت أجوبتك" };
  }
  if (a === "lateCatchup") {
    const sc = await one("schedules", { user_id: id });
    need(sc?.mode === "general", "هذا للطالب اللي يمشي ويا الطلاب");
    const s = await schedSettings();
    const late = await lateExams(id, sc!, s);
    need(late.length, "ماكو امتحانات فايتة تحتاج تعويض");
    const tomorrow = addDays(todayStr(), 1);
    const phase2 = await catchPhase2(late);
    const heavy = !(phase2 && phase2 <= tomorrow);
    const place = await placeFor(id);
    // حضوري: بمركزه هو بس (إيجاره مدفوع هناك)، بأوقات مركزه، وبالآيباد والقلم (ما ينطبعله شي)
    const ipad = body.mode === "ipad";
    if (ipad) {
      need(place.inPerson, "التعويض الحضوري لطالب المركز بس");
      need(body.kit === true, "أشّر إن عندك آيباد وقلم، وإنترنت شغال وياك بالمركز");
    }
    const slots = ipad ? await placeSlots(place.centerId) : [];
    const allowed = (ipad ? [...new Set(slots.map((x) => x.d))] : [0, 1, 2, 3, 4, 5, 6]).filter((d) => !s.offDays.includes(d));
    const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []);
    const days1 = heavy ? nums(body.days1) : [], days2 = phase2 ? nums(body.days2) : [];
    if (heavy) {
      const per1 = Number(body.per1);
      need(Number.isInteger(per1) && per1 >= 1 && per1 <= 4, "اختار كم امتحان بالأسبوع (من 1 إلى 4)");
      const err = catchDaysError(days1, per1, allowed, phase2 ? "لحد ما يبدي الفصل الجاي" : "");
      need(!err, err);
    }
    if (phase2) {
      const per2 = Number(body.per2);
      need(per2 === 1 || per2 === 2, "اختار امتحان أو امتحانين بالأسبوع من يبدي الفصل الجاي");
      const err = catchDaysError(days2, per2, allowed, "من يبدي الفصل الجاي");
      need(!err, err);
    }
    let timeOf: (wd: number) => string;
    if (ipad) {
      const times = (body.times && typeof body.times === "object" ? body.times : {}) as Record<string, unknown>;
      for (const wd of new Set([...days1, ...days2])) need(slots.some((x) => x.d === wd && x.t === times[String(wd)]), `اختار وقت يوم ${DAYS[wd]} من أوقات مركزك`);
      timeOf = (wd) => String(times[String(wd)]);
    } else {
      const hour = Number(body.hour);
      need(allowedHours(s).includes(hour), "اختار ساعة من الأوقات المسموحة");
      timeOf = () => `${String(hour).padStart(2, "0")}:00`;
    }
    const plan = catchupPlan(late.map((e) => ({ id: e.id, at: String(e.at) })), { days1, days2, timeOf }, tomorrow, phase2, await catchDayOk(id, sc!, s));
    need(plan.length === late.length, "ما گدرنا نرتب كل امتحاناتك بهالأيام، اختار أيام ثانية");
    { const why = await seatProblems(place.centerId, plan, await student(id), id); need(!why, why); }
    for (const x of plan) await insert("sched_items", { user_id: id, exam_id: x.examId, at: x.at, status: "waiting", kind: "catchup", fixed: 1, catch_place: ipad ? "ipad" : null });
    const how = ipad ? `حضوري بالآيباد بـ${place.label}` : "إلكتروني";
    const pace = [heavy && `${days1.length} بالأسبوع${phase2 ? ` لحد ${prettyDay(phase2)}` : ""}`, phase2 && `${days2.length} بالأسبوع${heavy ? " بعدها" : ""}`].filter(Boolean).join("، ");
    await logActivity(id, `📅 أخذ جدول تعويض: ${plan.length} امتحان ${how} من ${prettyDay(plan[0].at.slice(0, 10))} إلى ${prettyDay(plan[plan.length - 1].at.slice(0, 10))} (${pace})`);
    return { ...await studentInfo(id), notice: `✅ انثبت جدول تعويضك: ${plan.length} امتحان، آخرها ${prettyDay(plan[plan.length - 1].at.slice(0, 10))}. الامتحان اللي يفوتك ينحسب غياب وصفر.` };
  }
  if (a === "earlyStart" || a === "earlyUndo") {
    // يتثبت أول، وبعدها ترجع الصفحة بالجدول الجديد
    const notice = a === "earlyStart" ? await earlyStart(id, body) : await earlyUndo(id);
    return { ...await studentInfo(id), notice };
  }
  if (a === "lateKeep" || a === "latePrivate") {
    const sc = await one("schedules", { user_id: id });
    need(sc?.mode === "general", "هذا للطالب اللي يمشي ويا الطلاب");
    const s = await schedSettings();
    if (a === "lateKeep") {
      for (const e of await lateExams(id, sc!, s)) await insert("sched_items", { user_id: id, exam_id: e.id, at: e.at, status: "missed" });
      await logActivity(id, "🗓 بقى ويا الطلاب، والامتحانات اللي فات موعدها انحسبت فايتة");
    } else {
      await remove("sched_items", { user_id: id, status: "waiting" }, { where: (r) => !r.fixed });
      await remove("schedules", { user_id: id });
      await logActivity(id, "🗓 طلع من مجموعته حتى يختار جدول ثاني");
    }
    return await studentInfo(id);
  }
  if (a === "compCreate" || a === "compJoin") await (await import("./guardianLock.ts")).needNoOld(id);
  if (a === "compCreate" || a === "compJoin" || a === "compLeave") {
    if (a === "compCreate") await createGroup(id, body.name);
    else if (a === "compJoin") await joinGroup(id, body.code);
    else await leaveGroup(id);
    return { ...await studentInfo(id), notice: a === "compCreate" ? "✅ انسوت المجموعة. دز الرابط لأصدقائك" : a === "compJoin" ? "✅ فتت للمجموعة" : "🚪 طلعت من المجموعة" };
  }
  if (a === "holRequest" || a === "holRequestCancel") {
    // الطالب الخاص يطلب يغير عطلته بعد ما ثبت جدوله: ينتظر موافقة الإدارة
    const sc = await one("schedules", { user_id: id });
    need(sc && sc.mode !== "general", "هذا لطالب الجدول الخاص");
    const rest = (await holRequests()).filter((r) => r.uid !== id);
    if (a === "holRequestCancel") { await saveHolRequests(rest); return { ...await studentInfo(id), notice: "انلغى طلبك" }; }
    const h = holFromBody(body);
    await saveHolRequests([...rest, { uid: id, ...h, at: stamp() }]);
    await logActivity(id, `🏖 طلب يغير عطلته: ${holText(h)}`);
    return { ...await studentInfo(id), notice: "⏳ انرسل طلبك، وينتظر موافقة الإدارة" };
  }
  if (a === "holidayKeep") {
    // ✅ خليها: العطلة تبقى، والسؤال ما يطلع بعد
    const list = await holidays();
    const ids = new Set((Array.isArray(body.holidays) ? body.holidays : [body.holiday]).map(Number));
    let n = 0;
    for (const h of list) if (ids.has(h.id)) for (const x of h.students) if (x.uid === id && x.on) { x.kept = true; n++; }
    need(n, "هذي العطلة مو بجدولك");
    await saveHolidays(list);
    return { ...await studentInfo(id), notice: "✅ العطلة باقية بجدولك" };
  }
  if (a === "skipExam" || a === "keepExam") {
    // امتحان أشرت عليه الإدارة «يمكن حذفه»: طالب الجدول الخاص يشيله فيصعد جدوله، لو يخليه
    const sc = await one("schedules", { user_id: id });
    need(sc && sc.mode !== "general", "هذا لطالب الجدول الخاص");
    const it = await one("sched_items", { id: Number(body.item), user_id: id });
    need(it?.status === "waiting" && !it.kind && it.at > stamp(), "هذا الامتحان ما يتغير هسه");
    need((await skippableExams()).includes(it!.exam_id), "هذا الامتحان ما يمكن حذفه");
    const title = String((await one("bank_exams", { id: it!.exam_id }))?.title ?? "");
    if (a === "keepExam") {
      await kvSet(`skip_keep_${id}`, JSON.stringify([...new Set([...await keptExams(id), it!.exam_id])]));
      return { ...await studentInfo(id), notice: `✅ ${title} باقي بجدولك` };
    }
    // كل امتحان بعده ياخذ موعد اللي قبله، فيصعد الجدول
    const later = (await find("sched_items", { user_id: id, status: "waiting" }, { order: ["at"] })).filter((x) => !x.fixed && !x.kind && x.notified !== "test" && x.at > it!.at);
    const slots = [it!.at as string, ...later.map((x) => x.at as string)];
    await tx(async () => {
      await update("sched_items", { id: it!.id }, { status: "skipped" });
      for (const [k, x] of later.entries()) await update("sched_items", { id: x.id }, { at: slots[k] });
    });
    await logActivity(id, `🗑 شال امتحان ${title} من جدوله، فصعد جدوله`);
    return { ...await studentInfo(id), notice: `🗑 انشال ${title}، وصعد جدولك` };
  }
  if (a === "moveTime") {
    // طالب الجدول الخاص يغير وقت امتحان بنفس يومه، لحد اليوم اللي قبله
    const sc = await one("schedules", { user_id: id });
    need(sc && sc.mode !== "general", "هذا لطالب الجدول الخاص");
    const it = await one("sched_items", { id: Number(body.item), user_id: id });
    need(it?.status === "waiting" && !it.kind && it.notified !== "test", "هذا الامتحان ما يتغير وقته");
    const day = String(it!.at).slice(0, 10);
    need(hoursUntil(String(it!.at)) >= MOVE_HOURS, "وقت الامتحان يتغير قبل 24 ساعة منه بس. بعدها ما يتغير");
    const t = String(body.time ?? "");
    need(/^\d{2}:\d{2}$/.test(t), "اختار الوقت");
    need(t !== String(it!.at).slice(11, 16), "هذا نفس وقته");
    const place = await placeFor(id);
    const s = await schedSettings();
    if (place.inPerson) need((await placeSlots(place.centerId)).some((x) => x.d === weekdayOf(day) && x.t === t), "اختار من أوقات مركزك بهذا اليوم");
    else need(t.endsWith(":00") && allowedHours(s).includes(Number(t.slice(0, 2))), `الامتحان يبدي من الساعة ${ampm(`${String(s.fromHour).padStart(2, "0")}:00`)} إلى ${ampm(`${String(s.toHour).padStart(2, "0")}:00`)} بس`);
    // ما يتداخل ويا امتحان ثاني عنده بنفس اليوم، ويبقى الفاصل بينهم
    const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
    const mins = (x: Row) => Number(exams.get(x.exam_id)?.minutes ?? 75);
    const m = (at: string) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
    const mine = m(`${day} ${t}`);
    const clash = (await find("sched_items", { user_id: id })).find((x) => x.id !== it!.id && String(x.at).slice(0, 10) === day && !["skipped", "missed"].includes(String(x.status))
      && mine < m(String(x.at)) + mins(x) + s.gap && m(String(x.at)) < mine + mins(it!) + s.gap);
    { const why = await seatProblem(place.centerId, weekdayOf(day), t, await student(id), { date: day, except: id }); need(!why, why); }
    need(!clash, clash ? `⏰ هذا الوقت يتداخل ويا امتحانك الثاني بنفس اليوم (${exams.get(clash.exam_id)?.title ?? ""} ${ampm(String(clash.at).slice(11, 16))}). لازم يبقى ${s.gap} دقيقة بين الامتحانين.` : "");
    await update("sched_items", { id: it!.id }, { at: `${day} ${t}`, notified: null });
    const title = String(exams.get(it!.exam_id)?.title ?? "");
    await logActivity(id, `🕐 غير وقت ${title} يوم ${prettyDay(day)}: من ${ampm(String(it!.at).slice(11, 16))} إلى ${ampm(t)}`);
    return { ...await studentInfo(id), notice: `✅ صار وقت ${title} ${prettyDay(day)} الساعة ${ampm(t)}` };
  }
  if (a === "movePick") return { ...await studentInfo(id), notice: await movePick(id, Number(body.d), String(body.time ?? ""), "student") };
  if (a === "holidayOff") {
    const list = await holidays();
    // العطلة الطويلة جاية من أكثر من دسة: تنلغي كلها، من الأخيرة للأولى
    const ids = new Set((Array.isArray(body.holidays) ? body.holidays : [body.holiday]).map(Number));
    const mine = list.filter((h) => ids.has(h.id) && h.students.some((x) => x.uid === id && x.on)).sort((a, b) => b.id - a.id);
    need(mine.length, "هذي العطلة مو بجدولك");
    await tx(async () => { for (const h of mine) await restoreStudent(h.students.find((x) => x.uid === id && x.on)!); });
    for (const h of mine) { shiftHols(list, h, true, id); h.students.find((x) => x.uid === id && x.on)!.on = false; }
    await saveHolidays(list);
    await logActivity(id, `🏖 لغى العطلة قبل ${mine[0].title}، فتقدم جدوله`);
    return { ...await studentInfo(id), notice: "✅ لغيت العطلة، وجدولك تقدم" };
  }
  if (a === "lectureFile") { await sendLectureFile(id, body.name); return { ...await studentInfo(id), notice: "📄 وصلك ملف المحاضرة بالبوت" }; }
  if (a === "cpSeen") { await seeCheckpoint(id, body.key); return await studentInfo(id); }
  // «📨 عندي عذر» انشال (قرار الأستاذ 2026-11-20): الطالب الصادق يراسل الإدارة بنفسه، وهي تفتحله من ملفه
  need(a !== "askException", "تواصل ويا الإدارة إذا عندك عذر");
  if (a === "askTravel") {
    await (await import("./guardianLock.ts")).askTravel(id);
    return { ...await studentInfo(id), notice: "✈️ وصل طلبك للإدارة" };
  }
  if (a === "paper" || a === "objInfo") await (await import("./guardianLock.ts")).needSeenPaper(id, body.item);
  if (a === "paper") {
    need(!await examInProgress(id), LOCK_TEXT, 423);
    return { ...await studentInfo(id), paper: await myPaper(id, body.item) };
  }
  if (a === "objInfo") need(!await examInProgress(id), LOCK_TEXT, 423);
  if (a === "objInfo") return { ...await studentInfo(id), obj: await objectionInfo(id, body.item) };
  need(a === "info", "أمر غير معروف");
  return await studentInfo(id);
}

// ---------- الإدارة
const dayList = (raw: unknown) => {
  const list = String(raw ?? "").split(/[\s,،]+/).filter(Boolean);
  need(list.every(validDay), "اكتب الأيام المستثناة بهذا الشكل: 2027-01-25");
  return [...new Set(list)].sort();
};
// ---------- عطلة نصف السنة بالجدول العام: الامتحانات اللي داخلها تطلع لبعدها، واللي بعدها تزحف وياها بنفس الترتيب والفراغات
const MID_KEY = "midyear_shift";
/** عطلة نصف السنة لمكان معين اذا تختلف عن الباقي: من، إلى. فاضية = هذا المكان بلا عطلة */
const MID_PLACES = "midyear_places";
async function midPlaces(): Promise<Record<string, Range>> { try { const j = JSON.parse(await kvGet(MID_PLACES) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; } }
/** عطلة نصف السنة بهذا المكان: الخاصة بيه، وإلا مال كل الأماكن */
async function midFor(center: number, s: SchedSettings): Promise<Range | null> {
  const own = (await midPlaces())[String(center)];
  if (own) return own.from && own.to ? own : null;
  return midRange(s);
}
/** إعدادات المكان: عطلة نصف السنة مالته بدل العامة */
async function placeSettings(center: number, s: SchedSettings): Promise<SchedSettings> {
  const r = await midFor(center, s);
  return { ...s, holidayStart: r?.from ?? "", holidayDays: r ? daysOf(r).length : 0 };
}
type MidPlace = { center: number; from?: string; to?: string; moved: { exam: number; day: string; to: string; versions: string; toVersions: string }[]; hols: HolMove[] };
type MidShift = { from: string; to: string; places: MidPlace[] };
async function midShift(): Promise<MidShift | null> {
  try { const j = JSON.parse(await kvGet(MID_KEY) ?? "null"); return j && Array.isArray(j.places) ? j : null; } catch { return null; }
}
const midRange = (s: SchedSettings): Range | null => (s.holidayStart && s.holidayDays > 0 ? { from: s.holidayStart, to: addDays(s.holidayStart, s.holidayDays - 1) } : null);
/** ترجع المواعيد اللي زحفتها العطلة القديمة، بس اللي بعدها بمكانها (اللي تغير باليد يبقى) */
async function undoMidyear(m: MidShift) {
  const list = await holidays();
  for (const p of m.places) {
    const slots = await placeSlots(p.center);
    const timesOf = (d: string) => slots.filter((t) => t.d === weekdayOf(d)).map((t) => t.t).sort();
    for (const x of p.moved) {
      const cur = await one("place_dates", { center_id: p.center, exam_id: x.exam });
      if (cur?.day !== x.to) continue;
      const versions = cur.versions === x.toVersions ? x.versions : JSON.stringify(remapByOrder(JSON.parse(cur.versions || "{}"), timesOf(x.to), timesOf(x.day)));
      await put("place_dates", { center_id: p.center, exam_id: x.exam, day: x.day, versions });
    }
    for (const m2 of p.hols) {
      const r = list.find((h) => h.id === m2.id)?.places.find((y) => y.center === p.center);
      if (r && r.from === m2.toFrom && r.to === m2.toTo) { r.from = m2.from; r.to = m2.to; }
    }
  }
  await saveHolidays(list);
}
/** كل مكان: من أول امتحان داخل العطلة، كل يوم امتحان ياخذ يوم الامتحان الصالح اللي بنفس ترتيبه بس برا العطلة.
 *  يعني اللي داخل العطلة يطلع لأول أيام بعدها، واللي بعدها يزحف بعدد أيام الامتحان اللي راحت، والفراغات تبقى مثل ما هي */
async function applyMidyear(range: Range, s: SchedSettings, centers: number[]): Promise<MidPlace[]> {
  const list = await holidays();
  const out: MidPlace[] = [];
  for (const center of centers) {
    const rows = await find("place_dates", { center_id: center });
    const first = rows.map((r) => String(r.day)).filter((d) => inRange(d, range)).sort()[0];
    if (!first) continue;
    const slots = await placeSlots(center);
    const weekdays = new Set(slots.map((t) => t.d));
    const mine = list.filter((h) => !h.insert).flatMap((h) => h.places.filter((p) => p.center === center).map((p) => ({ h, p })));
    // اليوم الصالح للامتحان: من أيام المكان، مو مستثنى، ومو بعطلة ثابتة قبل أول امتحان داخل العطلة
    const valid = (d: string) => weekdays.has(weekdayOf(d)) && !s.excluded.includes(d) && !mine.some(({ p }) => p.from < first && inRange(d, p));
    const lastDay = [...rows.map((r) => String(r.day)), ...mine.map(({ p }) => p.to)].sort().at(-1) ?? first;
    const inside: string[] = [], outside: string[] = [];
    const pos = new Map<string, number>();
    for (let d = first, guard = 0; guard < 5000 && (d <= lastDay || outside.length < inside.length + 1); d = addDays(d, 1), guard++) {
      if (valid(d)) { inside.push(d); if (!inRange(d, range)) outside.push(d); }
      pos.set(d, inside.length);
    }
    // يكمل أيام برا العطلة لحد ما يكفي لآخر يوم
    for (let d = addDays(outside.at(-1) ?? lastDay, 1), guard = 0; outside.length < inside.length && guard < 5000; d = addDays(d, 1), guard++) if (valid(d) && !inRange(d, range)) outside.push(d);
    const target = (d: string) => { const n = Math.max(1, pos.get(d) ?? inside.length); return outside[n - 1] ?? d; };
    const timesOf = (d: string) => slots.filter((t) => t.d === weekdayOf(d)).map((t) => t.t).sort();
    const moved: MidPlace["moved"] = [];
    for (const r of rows.filter((x) => String(x.day) >= first).sort((a, b) => String(a.day).localeCompare(String(b.day)))) {
      const to = target(String(r.day));
      if (to === r.day) continue;
      const toVersions = JSON.stringify(remapByOrder(JSON.parse(r.versions || "{}"), timesOf(r.day), timesOf(to)));
      moved.push({ exam: r.exam_id as number, day: r.day as string, to, versions: String(r.versions || "{}"), toVersions });
    }
    const hols: HolMove[] = mine.filter(({ p }) => p.from >= first).map(({ h, p }) => ({ id: h.id, from: p.from, to: p.to, toFrom: target(p.from), toTo: target(p.to) })).filter((m) => m.toFrom !== m.from || m.toTo !== m.to);
    await tx(async () => { for (const m of moved) await put("place_dates", { center_id: center, exam_id: m.exam, day: m.to, versions: m.toVersions }); });
    for (const m of hols) {
      const r = list.find((h) => h.id === m.id)?.places.find((y) => y.center === center);
      if (r) { r.from = m.toFrom; r.to = m.toTo; }
    }
    if (moved.length || hols.length) out.push({ center, from: range.from, to: range.to, moved, hols });
  }
  await saveHolidays(list);
  return out;
}
/** انحفظت عطلة نصف السنة: العطلة القديمة ترجع مواعيدها، والجديدة تطلع الامتحانات منها. يرجع عدد الأماكن اللي تغيرت */
async function syncMidyear(s: SchedSettings) {
  const old = await midShift();
  // كل مكان يعرف بأي عطلة زحف (القديم كان عطلة وحدة للكل)
  const done: MidPlace[] = (old?.places ?? []).map((p) => ({ ...p, from: p.from ?? old!.from, to: p.to ?? old!.to }));
  const changed = new Set<number>();
  const centers = [...new Set([...(await find("place_dates")).map((r) => r.center_id as number), ...done.map((p) => p.center)])];
  const keep: MidPlace[] = [];
  for (const center of centers) {
    const range = await midFor(center, s);
    let mine = done.filter((p) => p.center === center);
    const stale = mine.filter((p) => !range || p.from !== range.from || p.to !== range.to);
    // عطلته تغيرت أو انشالت: يرجع اللي زحف، من الأخير للأول
    for (const p of [...stale].reverse()) { await undoMidyear({ from: p.from!, to: p.to!, places: [p] }); changed.add(center); }
    mine = mine.filter((p) => !stale.includes(p));
    keep.push(...mine);
    if (range) {
      const added = await applyMidyear(range, await placeSettings(center, s), [center]);
      if (added.length) { keep.push(...added); changed.add(center); }
    }
  }
  const g = midRange(s);
  await kvSet(MID_KEY, JSON.stringify({ from: g?.from ?? "", to: g?.to ?? "", places: keep }));
  for (const c of changed) await tellPlace(c);
  return changed.size;
}
/** تغيرت العطلة: كل الجداول تنعاد من باجر، وكل طالب يوصله الخبر */
async function rebuildAll(s: SchedSettings) {
  let moved = 0, stuck = 0;
  const start = addDays(todayStr(), 1);
  for (const sc of await find("schedules")) {
    if (sc.mode === "general" || sc.mode === "slow") continue;   // مواعيد المكان بيد الإدارة، والبطيء بيد الطالب
    const uid = sc.user_id as number;
    await closeMissed(uid, s);
    const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
    if (!left.length) continue;
    const f = { start, end: sc.pack ? addDays(start, PACK_DAYS) : sc.end_day, pack: !!sc.pack, weekdays: JSON.parse(sc.weekdays), hour: sc.hour, times: sc.picks ? JSON.parse(sc.picks) as Record<string, string[]> : undefined, hol: holOf(sc.hol) };
    const plan = buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings: { ...withOwnHol(s, f.hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] } });
    if (plan.ok) {
      await saveItems(uid, f, plan.items);
      await send(uid, "🗓 <b>تغير جدول امتحاناتك</b> بسبب تغيير العطلة. افتح امتحاناتي وشوف المواعيد الجديدة.");
      moved++;
    } else {
      // ما يكفي الوقت: يرجع يرتب جدوله بنفسه
      await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed });
      await send(uid, "🗓 <b>لازم تعيد ترتيب جدول امتحاناتك</b> بسبب تغيير العطلة. افتح امتحاناتي ورتبه من جديد.");
      stuck++;
    }
  }
  return { moved, stuck };
}
export async function schedAdminAction(body: Row) {
  const uid = await authed(body?.initData, SCHED_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  let preview: Row | null = null;
  if (a === "midHoliday") {
    // سطر عطلة نصف السنة بجدول الامتحانات: من، إلى، ووصفها. لكل الأماكن (نفس حفظ الإعدادات)، أو لهذا المكان بس
    const old = await schedSettings();
    const center = Number(body.center ?? 0);
    if (body.scope === "place" || body.scope === "reset") {
      const map = await midPlaces();
      if (body.scope === "reset") delete map[String(center)];
      else {
        const from = String(body.holidayStart ?? ""), n = Number(body.holidayDays) || 0;
        need(!from || (validDay(from) && n > 0 && n <= 120), "اختار العطلة من تاريخ إلى تاريخ");
        map[String(center)] = from ? { from, to: addDays(from, n - 1) } : { from: "", to: "" };
      }
      await kvSet(MID_PLACES, JSON.stringify(map));
      if (body.holidayNote !== undefined) await kvSet("sched_settings", JSON.stringify({ ...old, holidayNote: String(body.holidayNote).trim().slice(0, 120) }));
      const moved = await syncMidyear(await schedSettings());
      notice = `✅ انحفظت عطلة نصف السنة ${body.scope === "reset" ? "لهذا المكان مثل باقي الأماكن" : "لهذا المكان بس"}${moved ? "، وزحفت مواعيده" : ""}`;
    } else return schedAdminAction({ ...old, action: "save", initData: body.initData, center, holidayStart: body.holidayStart, holidayDays: body.holidayDays, holidayNote: body.holidayNote });
  }
  if (a === "midHoliday") {
    // انحفظت فوك لهذا المكان
  } else if (a === "save") {
    const old = await schedSettings();
    const holidayStart = String(body.holidayStart ?? "");
    need(!holidayStart || validDay(holidayStart), "تاريخ بداية العطلة غير صحيح");
    // أيام بالأسبوع ما يمتحن بيها الطالب الخاص الإلكتروني (مثلاً الأحد)
    const offDays = body.offDays === undefined ? old.offDays : [...new Set((Array.isArray(body.offDays) ? body.offDays : []).map(Number))].filter((d) => DAY_ORDER.includes(d)).sort((x, y) => x - y);
    need(offDays.length < 7, "لازم يبقى يوم واحد على الأقل يمتحن بيه");
    const fromHour = body.fromHour === undefined ? old.fromHour : intOf(body.fromHour, 0, 23, "اختار أول ساعة");
    const toHour = body.toHour === undefined ? old.toHour : intOf(body.toHour, 0, 23, "اختار آخر ساعة");
    need(fromHour <= toHour, "آخر ساعة لازم تكون بعد أول ساعة");
    const next: SchedSettings = {
      window: intOf(body.window, 1, 600, "وقت الدخول بالدقائق، من 1 إلى 600"), extra: intOf(body.extra, 0, 600, "الوقت الإضافي بالدقائق، من 0 إلى 600"), excWindow: body.excWindow === undefined ? old.excWindow : intOf(body.excWindow, 1, 10000, "وقت الاستثناء بالدقائق"), optionalOpen: body.optionalOpen === undefined ? old.optionalOpen : !!body.optionalOpen, perDay: intOf(body.perDay, 1, 10, "امتحانات اليوم من 1 إلى 10"), gap: intOf(body.gap, 0, 600, "الفاصل بالدقائق، من 0 إلى 600"),
      holidayStart, holidayDays: intOf(body.holidayDays, 0, 120, "أيام العطلة من 0 إلى 120"),
      // وصف العطلة يطلع للطلاب بجدولهم، مثلاً «عطلة نصف السنة»
      holidayNote: body.holidayNote === undefined ? old.holidayNote : String(body.holidayNote).trim().slice(0, 120), blockedHours: [], excluded: body.excluded === undefined ? old.excluded : dayList(body.excluded), fromHour, toHour, offDays,
      // الطالب يگدر يختار صورة جوابه من الاستوديو، لو الكاميرا بس
      gallery: body.gallery === undefined ? old.gallery : !!body.gallery,
      // الجدول الخاص: أكثر شي كم امتحان بالأسبوع يگدر يختار الطالب
      perWeek: body.perWeek === undefined ? old.perWeek : intOf(body.perWeek, 1, 14, "امتحانات الأسبوع من 1 إلى 14"),
      // 🚀 الطالب ويا الطلاب يگدر يبدي الفصل اللي ورا عطلة نصف السنة من هسه
      earlyOpen: body.earlyOpen === undefined ? !!old.earlyOpen : !!body.earlyOpen,
    };
    await kvSet("sched_settings", JSON.stringify(next));
    notice = "✅ انحفظت الإعدادات";
    // الجدول العام: امتحانات المكان اللي داخل عطلة نصف السنة تطلع لبعدها، والباقي يزحف
    const places = await syncMidyear(next);
    if (places) notice += `. زحفت مواعيد ${places} مكان بسبب عطلة نصف السنة`;
    const days = (x: SchedSettings) => JSON.stringify([x.holidayStart, x.holidayDays, x.excluded]);
    if (days(old) !== days(next)) {
      const r = await rebuildAll(next);
      notice += `. انعاد جدول ${r.moved} طالب${r.stuck ? `، و${r.stuck} لازم يرتبون جدولهم` : ""}`;
    }
  } else if (a === "saveSeats") {
    const center = Number(body.center);
    need(center === 0 || await one("centers", { id: center }), "المركز غير موجود");
    await setSeatLimits(center, body.seats);
    notice = "✅ انحفظ عدد الطلاب بكل وقت";
  } else if (a === "saveSlots") {
    const center = Number(body.center);
    need(center === 0 || await one("centers", { id: center }), "المركز غير موجود");
    const raw = (Array.isArray(body.slots) ? body.slots : []) as Row[];
    need(raw.every((x) => Number.isInteger(x.d) && x.d >= 0 && x.d < 7 && /^\d{2}:\d{2}$/.test(String(x.t))), "وقت غير صحيح");
    const seen = new Set<string>();
    const slots = raw.map((x) => ({ d: x.d as number, t: String(x.t) })).filter((x) => { const k = `${x.d}|${x.t}`; if (seen.has(k)) return false; seen.add(k); return true; });
    await put("place_slots", { center_id: center, slots: JSON.stringify(slots) });
    const told = await tellPlace(center);
    notice = `✅ انحفظت الأوقات${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
  } else if (a === "saveDates") {
    const center = Number(body.center);
    const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
    for (const r of rows) need(!r.date || validDay(r.date), "تاريخ غير صحيح");
    await tx(async () => {
      await remove("place_dates", { center_id: center });
      for (const r of rows) if (r.date) await put("place_dates", { center_id: center, exam_id: Number(r.exam), day: r.date, versions: JSON.stringify(r.versions ?? {}) });
    });
    const told = await tellPlace(center);
    notice = `✅ انحفظت المواعيد${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
  } else if (a === "fillDates") {
    // يوزع امتحانات الكتاب بالترتيب على أيام المكان من تاريخ البداية. النسخ المحددة تبقى
    const center = Number(body.center);
    need(validDay(body.start), "اختار تاريخ البداية");
    const slots = await placeSlots(center);
    need(slots.length, "ضيف أوقات المكان أول");
    const versions = await find("bank_versions");
    const exams = (await find("bank_exams")).filter((e) => { const vs = versions.filter((v) => v.exam_id === e.id); return !vs.length || vs.some((v) => v.kind === "mandatory"); })
      .sort((x, y) => String(x.slug).localeCompare(String(y.slug)) || (x.pos ?? x.ord) - (y.pos ?? y.ord));
    const ss = await schedSettings();
    // يتوزع بلا عطل، وبعدها العطل قبل الامتحانات تنحط مثل باقي الأماكن، فكل مكان عطلته قبل نفس الامتحان
    const days = slotDays(slots, String(body.start), exams.length, await placeSettings(center, ss));
    // مواعيده انعادت من الصفر: سجل زحف نصف السنة القديم مالته ما بقى إله معنى
    const shift = await midShift();
    if (shift) await kvSet(MID_KEY, JSON.stringify({ ...shift, places: shift.places.filter((p) => p.center !== center) }));
    // النسخ المحددة تبقى، والأوقات اللي ما إلها نسخة تاخذ وحدة تلقائياً (syncVersions)
    const old = new Map((await find("place_dates", { center_id: center })).map((d) => [d.exam_id, d.versions]));
    const rows: { exam: number; day: string; versions: string }[] = [];
    for (const [i, e] of exams.entries()) if (days[i]) rows.push({ exam: e.id, day: days[i], versions: old.get(e.id) || "{}" });
    await tx(async () => {
      await remove("place_dates", { center_id: center });
      for (const r of rows) await put("place_dates", { center_id: center, exam_id: r.exam, day: r.day, versions: r.versions });
    });
    const hols = await copyHolidays(center);
    const told = await tellPlace(center);
    const last = (await find("place_dates", { center_id: center })).map((d) => String(d.day)).sort().at(-1);
    notice = `✅ توزع ${days.length} امتحان، آخرها ${last ? prettyDay(last) : ""}${hols ? `، وانحطت ${hols} عطلة قبل نفس امتحانات الأماكن الثانية` : ""}${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
  } else if (a === "loadPlaces") {
    const centers = await find("centers", { active: 1 });
    const missing: string[] = [];
    let added = 0;
    for (const c of PLACE_SLOTS) {
      const row = c.match === null ? { id: 0 } : centers.find((x) => String(x.name).includes(c.match!));
      if (!row) { missing.push(c.match!); continue; }
      if (c.gender) await update("centers", { id: row.id }, { gender: c.gender });
      if (await one("place_slots", { center_id: row.id })) continue;
      await put("place_slots", { center_id: row.id, slots: JSON.stringify(c.days.flatMap(([d, times]) => times.map((t) => ({ d, t })))) });
      added++;
    }
    await kvSet("places_loaded", "1");
    // عطلة نصف السنة مثل ما حددها قصي العميري، إذا لسه ما مكتوبة
    const cur = await schedSettings();
    if (!cur.holidayStart) await kvSet("sched_settings", JSON.stringify({ ...cur, holidayStart: "2027-01-15", holidayDays: 18 }));
    notice = `✅ انضافت أوقات ${added} مكان${missing.length ? `. ما لگيت هاي المراكز: ${missing.join("، ")}` : ""}`;
  } else if (a === "loadOldDates") {
    // تواريخ النظام القديم. النسخ المحددة تبقى، وأي تاريخ يتعدل بعدها من الصفحة
    const centers = await find("centers", { active: 1 });
    const missing: string[] = [];
    let added = 0;
    for (const pl of PLACE_DAYS) {
      const row = pl.match === null ? { id: 0 } : centers.find((x) => String(x.name).includes(pl.match!));
      if (!row) { missing.push(pl.match!); continue; }
      for (const [slug, list] of Object.entries(SESSIONS)) {
        const exams = (await find("bank_exams", { slug })).sort((x, y) => (x.pos ?? x.ord) - (y.pos ?? y.ord) || x.id - y.id);
        const started = pl.from ? pl.from[0] < slug || (pl.from[0] === slug) : true;
        if (!started) continue;
        const startAt = pl.from && pl.from[0] === slug ? list.findIndex(([x]) => x === pl.from![1]) : 0;
        for (const [exam, week, part] of list.slice(startAt)) {
          const e = typeof exam === "number" ? exams[exam] : exams.find((x) => x.title === exam);
          if (!e) continue;
          let w = week, sp = part as number;
          if (pl.shift) { if (sp === 1) sp = 2; else { sp = 1; w++; } }
          const day = addDays(YEAR_START, (w - 1) * 7 + (sp === 1 ? pl.first : pl.second));
          const old = await one("place_dates", { center_id: row.id, exam_id: e.id });
          if (old?.day) continue;   // اللي انكتب قبل يبقى، حتى تعديلك
          await put("place_dates", { center_id: row.id, exam_id: e.id, day, versions: old?.versions ?? "{}" });
          added++;
        }
      }
      await tellPlace(row.id);
    }
    await kvSet("old_dates_loaded_v2", "1");
    notice = `✅ انضاف ${added} موعد${missing.length ? `. ما لگيت هاي المراكز: ${missing.join("، ")}` : ""}`;
  } else if (a === "holidayPreview" || a === "holidayAdd") {
    const exam = Number(body.exam);
    const days = intOf(body.days, 1, 60, "أيام العطلة من 1 إلى 60");
    const reason = String(body.reason ?? "").trim().slice(0, 80);
    const all = body.scope === "all";
    const centers = all ? [0, ...(await find("centers", { active: 1 })).map((c) => c.id as number)] : [Number(body.center ?? 0)];
    const plan = await planHoliday(exam, days, centers);
    need(plan.places.length || plan.students.length, all ? "هذا الامتحان ما إله موعد بأي مكان" : "هذا الامتحان ما إله موعد بهذا المكان. حط تاريخه أول.");
    if (a === "holidayPreview") {
      preview = { exam, days, reason, scope: all ? "all" : "place", students: plan.students.length,
        places: plan.places.map((p) => ({ name: p.name, from: p.from, to: p.to, rows: p.moved.map((m) => ({ title: m.title, from: m.day, to: m.to })) })) };
    } else {
      const list = await holidays();
      const title = String((await one("bank_exams", { id: exam }))?.title ?? "");
      const h: Holiday = { id: Date.now(), exam, title, days, reason, places: plan.places, students: plan.students, at: stamp() };
      await saveHolidays([...list, h]);
      const told = await applyHoliday(h);
      notice = `🏖 انحطت العطلة، وزحفت مواعيد ${plan.places.length} مكان${plan.students.length ? ` و${plan.students.length} جدول خاص` : ""}${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
    }
  } else if (a === "insertExam") {
    // امتحان من البنك ما إله موعد ياخذ يوم هذا الامتحان، وهو واللي بعده يزحفون ليوم الامتحان الجاي
    const exam = Number(body.exam), add = Number(body.add);
    const e = await one("bank_exams", { id: add });
    need(e, "اختار الامتحان اللي تضيفه");
    const all = body.scope === "all";
    const centers = (all ? [0, ...(await find("centers", { active: 1 })).map((c) => c.id as number)] : [Number(body.center ?? 0)]);
    const free = [];
    for (const c of centers) if (!await one("place_dates", { center_id: c, exam_id: add })) free.push(c);
    need(free.length, "هذا الامتحان إله موعد بالجدول. اختار امتحان ما إله موعد");
    const r = await insertBefore(exam, add, free);
    need(r, "هذا الامتحان ما إله موعد بهذا المكان. حط تاريخه أول.");
    notice = `🗓 انضاف ${r!.title}، وزحف اللي بعده${r!.told ? `، ووصل الخبر لـ ${r!.told} طالب` : ""}`;
  } else if (a === "holidayReason") {
    // سبب العطلة: يطلع للطلاب بجدولهم
    const list = await holidays();
    const h = list.find((x) => x.id === Number(body.id));
    need(h, "العطلة غير موجودة");
    h!.reason = String(body.reason ?? "").trim().slice(0, 80);
    await saveHolidays(list);
    notice = h!.reason ? "✅ انحفظ سبب العطلة" : "انشال سبب العطلة";
  } else if (a === "holReqOk" || a === "holReqNo") {
    const r = (await holRequests()).find((x) => x.uid === Number(body.uid));
    need(r, "الطلب غير موجود");
    if (a === "holReqOk") {
      const t = await setStudentHoliday(r!.uid, r!);
      await send(r!.uid, `✅ <b>وافقت الإدارة على عطلتك</b> ${t}، وانعاد جدولك من باجر. افتح امتحاناتي وشوف المواعيد.`);
      notice = "✅ وافقت، وانعاد جدوله";
    } else {
      await saveHolRequests((await holRequests()).filter((x) => x.uid !== r!.uid));
      await send(r!.uid, "❌ <b>ما وافقت الإدارة على تغيير عطلتك</b>، وجدولك باقي مثل ما هو.");
      await logActivity(r!.uid, "🏖 انرفض طلب تغيير عطلته");
      notice = "❌ انرفض الطلب";
    }
  } else if (a === "holidayDel") {
    const list = await holidays();
    const h = list.find((x) => x.id === Number(body.id));
    need(h, "العطلة غير موجودة");
    // العطل اللي انحطت بعدها لنفس الامتحان تنشال وياها، من الأخيرة للأولى، حتى المواعيد ترجع صح
    // only: تنشال من هذا المكان بس، وباقي الأماكن تبقى عطلتها مثل ما هي
    const only = body.only === undefined || body.only === null || body.only === "" ? null : Number(body.only);
    const chain = list.filter((x) => x.exam === h!.exam && x.id >= h!.id && (only === null || x.places.some((p) => p.center === only))).sort((a, b) => b.id - a.id);
    if (only === null) {
      for (const x of chain) await undoHoliday(x);
      const gone = new Set(chain.map((x) => x.id));
      await saveHolidays((await holidays()).filter((x) => !gone.has(x.id)));
      notice = chain.length > 1 ? `↩️ انشالت ${chain.length} عطل قبل ${h!.title}، ورجعت المواعيد` : "↩️ انشالت العطلة، ورجعت المواعيد";
    } else {
      need(h!.places.some((p) => p.center === only), "هذي العطلة ما بهذا المكان");
      const parts = new Map<number, { uids: Set<number>; added: Set<number> }>();
      for (const x of chain) {
        const part = await holidayPart(x, only);
        await undoHoliday(part);
        parts.set(x.id, { uids: new Set(part.students.map((s) => s.uid)), added: new Set(part.added ?? []) });
      }
      const left = (await holidays()).map((x) => parts.has(x.id)
        ? { ...x, places: x.places.filter((p) => p.center !== only), students: x.students.filter((s) => !parts.get(x.id)!.uids.has(s.uid)), added: (x.added ?? []).filter((id) => !parts.get(x.id)!.added.has(id)) }
        : x).filter((x) => x.places.length || x.students.length);
      await saveHolidays(left);
      const name = only === 0 ? "الإلكتروني" : await centerName(only) || "هذا المكان";
      notice = `↩️ انشالت العطلة من ${name} بس${chain.length > 1 ? ` (${chain.length} عطل)` : ""}، ورجعت مواعيده. باقي الأماكن عطلتها باقية`;
    }
  } else need(a === "list" || a === "midHoliday", "أمر غير معروف");
  const holidayList = (await holidays()).map((h) => ({ id: h.id, title: h.title, days: h.days, reason: h.reason, places: h.places.map((p) => ({ center: p.center, text: `${p.name || (p.center === 0 ? "الإلكتروني" : "")}: ${prettyDay(p.from)}` })), students: h.students.filter((x) => x.on).length }));
  const holReqs = await Promise.all((await holRequests()).map(async (r) => {
    const sc = await one("schedules", { user_id: r.uid });
    return { uid: r.uid, name: String((await student(r.uid))?.name ?? r.uid), want: holText(r), now: holText(holOf(sc?.hol) ?? null), at: r.at };
  }));
  return { ...await schedSettings(), cronUrl: await isAdmin(uid) ? cronUrl() : "", ...await placesPage(Number(body.center ?? 0)), schedules: (await find("schedules")).length, notice, holidays: holidayList, holidayPreview: preview, holReqs, early: await earlyStudents() };
}
const cronUrl = () => `${siteBase()}/api/cron?key=${cronKey()}`;
/** كل طالب بهذا المكان يوصله خبر واحد إذا تغيرت مواعيده */
/**
 * نسخ المكان تمشي ويا أوقاته وحدها: كل وقت باليوم بلا نسخة ياخذ نسخة، والوقت اللي انشال تنشال نسخته.
 * النسخة الجديدة هي الأقل استعمال بالأماكن الثانية لنفس الامتحان، وغير عن باقي أوقات نفس اليوم،
 * حتى ما تتكرر النسخ بين المعاهد. إذا النسخ ما تكفي، تبدي تتكرر. النسخ اللي اختارها صاحب البوت ما تتغير
 */
export async function syncVersions(center: number) {
  const mine = await find("place_dates", { center_id: center });
  if (!mine.length) return 0;
  const slots = await placeSlots(center);
  const all = await find("place_dates");
  // بس النسخ الإجبارية: الاختيارية تنفتح عشوائي للطالب، وما تطلع بقائمة نسخ الأوقات
  const versions = await find("bank_versions", { kind: "mandatory" }, { order: ["model"] });
  let changed = 0;
  for (const d of mine) {
    const ids = versions.filter((v) => v.exam_id === d.exam_id).map((v) => v.id as number);
    const times = slots.filter((t) => t.d === weekdayOf(String(d.day))).map((t) => t.t).sort();
    let cur: Record<string, number> = {};
    try { cur = JSON.parse(d.versions || "{}"); } catch { /* نسخ خربانة: تنعاد */ }
    // نسخة مو من نسخ هذا الامتحان الإجبارية (مثلاً اختيارية انحطت غلط) تنعاد. «أول نسخة جاهزة» (0) تبقى
    const valid = (v: number) => v === 0 || ids.includes(v);
    const out: Record<string, number> = {};
    for (const t of times) if (t in cur && valid(cur[t])) out[t] = cur[t];
    const missing = times.filter((t) => !(t in out));
    if (missing.length && ids.length) {
      const used = new Map(ids.map((id) => [id, 0]));
      for (const o of all) if (o.center_id !== center && o.exam_id === d.exam_id) {
        try { for (const v of Object.values(JSON.parse(o.versions || "{}") as Record<string, number>)) if (used.has(v)) used.set(v, used.get(v)! + 1); } catch { /* تتخطى */ }
      }
      const today = new Set(Object.values(out));
      for (const t of missing) {
        const pick = [...ids].sort((x, y) => Number(today.has(x)) - Number(today.has(y)) || used.get(x)! - used.get(y)! || ids.indexOf(x) - ids.indexOf(y))[0];
        out[t] = pick; today.add(pick); used.set(pick, used.get(pick)! + 1);
      }
    }
    const sorted = JSON.stringify(Object.fromEntries(Object.entries(out).sort()));
    if (sorted !== JSON.stringify(Object.fromEntries(Object.entries(cur).sort()))) {
      await put("place_dates", { ...d, versions: sorted });
      changed++;
    }
  }
  return changed;
}
/** مرة وحدة: الأماكن اللي مواعيدها بلا نسخ تاخذ نسخها */
export async function fillAllVersions() {
  // v2: التعبئة الأولى حطت نسخ اختيارية ببعض الأوقات، فتنعاد بنسخ إجبارية
  if (await kvGet("versions_fill_v2")) return 0;
  let n = 0;
  for (const c of new Set((await find("place_dates")).map((d) => d.center_id as number))) n += await syncVersions(c);
  await kvSet("versions_fill_v2", "1");
  return n;
}

async function tellPlace(center: number) {
  // أي تغيير بالأوقات أو المواعيد: النسخ تتعدل وياه
  await syncVersions(center);
  const s = await schedSettings();
  const stateOf = async (u: number) => (await find("sched_items", { user_id: u, status: "waiting" })).map((i) => `${i.exam_id}|${i.at}`).sort().join();
  let told = 0;
  for (const sc of await find("schedules", { mode: "general", center_id: center })) {
    const before = await stateOf(sc.user_id);
    await syncGeneral(sc.user_id, sc, s);
    if (before !== await stateOf(sc.user_id)) {
      await send(sc.user_id, "🗓 <b>تحدثت مواعيد امتحاناتك.</b> افتح امتحاناتي وشوفها.");
      told++;
    }
  }
  return told;
}
/** الأماكن، وأوقات المكان المفتوح ويوم كل امتحان ونسخة كل وقت */
async function placesPage(center: number) {
  const hols = await holidays();
  const areas = new Map((await find("areas")).map((a) => [a.id, a.name]));
  const places = [{ id: 0, name: "💻 الإلكتروني" }, ...(await find("centers", { active: 1 }, { order: ["id"] })).map((c) => ({ id: c.id as number, name: `🏫 ${c.name} (${areas.get(c.area_id) ?? ""})` }))];
  const dates = new Map((await find("place_dates", { center_id: center })).map((d) => [d.exam_id, d]));
  const versions = await find("bank_versions", { kind: "mandatory" }, { order: ["model"] });
  const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord));
  return {
    canLoad: !await kvGet("places_loaded"), canLoadDates: !await kvGet("old_dates_loaded_v2"), week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), places, center,
    // عطلة نصف السنة بهذا المكان، وهل تختلف عن الباقي
    mid: await midFor(center, await schedSettings()), midOwn: !!(await midPlaces())[String(center)],
    slots: await placeSlots(center), students: (await find("schedules", { mode: "general", center_id: center })).length,
    // عدد البنين والبنات بكل وقت، والمحجوز منه
    seats: await seatsView(center, await placeSlots(center)),
    rows: exams.map((e) => {
      const d = dates.get(e.id);
      return { exam: e.id, chapter: e.chapter, title: e.title, date: d?.day ?? "", versions: JSON.parse(d?.versions || "{}"), models: versions.filter((v) => v.exam_id === e.id).map((v) => ({ id: v.id, model: v.model })),
        // كل عطلة انحطت قبل هذا الامتحان بهذا المكان: سطر «فراغ» قبله
        inserted: hols.find((h) => h.insert === e.id && h.places.some((p) => p.center === center))?.id ?? 0,
        hols: hols.filter((h) => h.exam === e.id && !h.insert).flatMap((h) => h.places.filter((p) => p.center === center).map((p) => ({ id: h.id, from: p.from, reason: h.reason }))).sort((x, y) => x.from.localeCompare(y.from)) };
    }),
  };
}
/** جدول طالب واحد بصفحة الطلاب */
export async function studentSchedule(uid: number) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const sc = await one("schedules", { user_id: uid });
  if (sc?.mode === "general") await syncGeneral(uid, sc, s);
  const way = !sc ? "" : sc.mode === "general" ? `ويا الطلاب: ${Object.entries(picksOf(sc)).map(([d, t]) => `${DAYS[Number(d)]} ${ampm(t)}`).join("، ")}` : sc.mode === "slow" ? "🐢 جدول بطيء (يحط تاريخ كل امتحان بإيده)" : "جدول خاص";
  const hol = sc && sc.mode !== "general" ? holOf(sc.hol) ?? (s.holidayStart && s.holidayDays ? { from: s.holidayStart, to: addDays(s.holidayStart, s.holidayDays - 1) } : { from: "", to: "" }) : null;
  // «ويا الطلاب»: أوقاته لكل يوم، والمكتمل يتعلم، حتى الإدارة تغيره
  let times = null;
  if (sc?.mode === "general") { const slots = await placeSlots(sc.center_id); times = { picks: picksOf(sc), days: daysView(slots, await fullTimes(sc.center_id, slots, await student(uid), uid)) }; }
  return { way, times, inPerson: (await student(uid))?.exam === "حضوري", items: await itemsView(uid, s), perDay: Number(await kvGet(`sched_perday_${uid}`)) || 0, general: s.perDay, hol, holReq: (await holRequests()).find((r) => r.uid === uid) ?? null };
}
export async function resetSchedule(uid: number) {
  await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed });
  await remove("schedules", { user_id: uid });
  await logActivity(uid, "🗓 الإدارة فتحت جدوله حتى يرتبه من جديد");
  await send(uid, `🗓 <b>تگدر تعيد ترتيب جدول امتحاناتك.</b> افتح امتحاناتي ورتبه.`);
}
export const setPerDay = async (uid: number, n: number) => await kvSet(`sched_perday_${uid}`, String(n));

/** اشترى شي بيه امتحانات وبعده ما اختار أوقاته (ويا الطلاب أو جدول خاص): كلشي يبقى مقفول لحد ما يختار.
 *  اللي اشترى محاضرات بس ما ينقفل. طلاب التجربة هم ينقفلون، حتى صاحب البوت يشوف نفس اللي يشوفه الطالب */
export async function needsSchedule(uid: number) {
  if (!uid || !await student(uid)) return false;
  const sc = await one("schedules", { user_id: uid });
  // ويا الطلاب بس فاتته امتحانات قبل ما يسجل وبعده ما اختار تعويضها (لو يبقى ويا الطلاب): هم مقفول
  if (sc) return sc.mode === "general" && (await lateExams(uid, sc, await schedSettings())).length > 0;
  return (await scheduleChapters(uid)).length > 0;
}
/** للقائمة «⏳ ما سووا جدول» */
export const lateFor = (uid: number, sc: Row, s: SchedSettings) => lateExams(uid, sc, s);
export const SCHED_FIRST = "🗓 اختار أوقات امتحاناتك أول من «امتحاناتي»، وبعدها ينفتحلك كلشي";
