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
import { skippableExams } from "./skipExams.ts";
import { centerName, isAdmin, student } from "./data.ts";
import { siteBase } from "./keyboards.ts";
import { chapterLabel } from "./orderRules.ts";
import { askException } from "./lateRequest.ts";
import { createGroup, joinGroup, leaveGroup, studentComp } from "./competition.ts";
import { CLOSED_TEXT, LATE_TEXT, closeFinished, deleteAnswer, examLeft, myPaper, openRoom, roomState, submitRoom, takeOath } from "./examRoom.ts";
import { send } from "./telegram.ts";
import { DEFAULT_SETTINGS, addDays, advanceDays, buildPlan, daysLost, inHoliday, itemState, labelChapters, pickOptional, pickedAt, remapByOrder, slotDays, ampm, prettyDay, validDay, weekdayOf, type PlanExam, type Slot, type SchedSettings } from "./scheduleRules.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { authed, ensure, intOf, need } from "./webApi.ts";
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
  const chapters = await scheduleChapters(uid);
  // الامتحان اللي كل نسخه اختيارية ما يدخل الجدول. اللي نسخه لسه ما انضافت يدخل بمكانه
  const versions = await find("bank_versions");
  const skip = (examId: number) => { const vs = versions.filter((v) => v.exam_id === examId); return vs.length > 0 && vs.every((v) => v.kind !== "mandatory"); };
  const out: Row[] = [];
  for (const ch of chapters.flatMap(labelChapters)) {
    const list = (await find("bank_exams", { chapter: ch })).filter((e) => !skip(e.id)).sort((a, b) => (a.pos ?? a.ord) - (b.pos ?? b.ord) || a.id - b.id);
    out.push(...list);
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
    if (sc.mode === "general") continue;
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
function daysView(slots: Slot[]) {
  return DAY_ORDER.filter((d) => slots.some((x) => x.d === d)).map((d) => ({ d, name: DAYS[d], times: slots.filter((x) => x.d === d).map((x) => x.t).sort().map((t) => ({ t, label: ampm(t) })) }));
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
  for (const e of await boughtExams(uid)) {
    const at = days.has(e.id) ? pickedAt(days.get(e.id)!, picks) : null;
    if (at && !has.has(e.id) && itemState("waiting", at, s.window, now) === "missed") out.push({ ...e, at });
  }
  return out;
}
/** الطالب العام: يوم كل امتحان من المكان، والوقت من اختياره. يتحدث بس إذا تغير شي */
async function syncGeneral(uid: number, sc: Row, s: SchedSettings) {
  const days = await placeDays(sc.center_id);
  const picks = picksOf(sc);
  const items = await find("sched_items", { user_id: uid });
  const late = new Set((await lateExams(uid, sc, s)).map((e) => e.id));
  const wanted: string[] = [];
  for (const e of remaining(await boughtExams(uid), items)) {
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
  return (await find("sched_items", { user_id: uid }, { order: ["at"] })).filter((i) => i.status !== "skipped").map((i) => {
    const e = exams.get(i.exam_id);
    const state = roomState(i, s, now);
    // الحضوري ينقدم بالمركز، فبعد موعده يكفي نگول انتهى
    return { id: i.id, exam: i.exam_id as number, optional: i.kind === "optional", total: i.graded_at ? i.total : null, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", minutes: e?.minutes ?? 75, lectures: i.kind === "optional" ? [] : lec.get(i.exam_id) ?? [], at: i.at, exc: i.exc_state ?? null, status: i.status, retake: !!i.retake_of, state: ipad ? ipadState(i.status, state) : inPerson && state !== "locked" ? "past" : inPerson ? "center" : state };
  });
}
/** امتحانات الفصول المشتراة اللي عندها نسخة اختيارية. كل واحد ينفتح مرة وحدة بوقت يختاره الطالب */
async function optionalList(uid: number, bought: Row[]) {
  const versions = await find("bank_versions", { kind: "optional", ok: 1 });
  const taken = new Set((await find("sched_items", { user_id: uid, kind: "optional" })).map((i) => i.exam_id));
  return bought.filter((e) => versions.some((v) => v.exam_id === e.id) && !taken.has(e.id)).map((e) => ({ exam: e.id, title: e.title, chapter: e.chapter, minutes: e.minutes ?? 75 }));
}
async function studentInfo(uid: number) {
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
    inPerson: place.inPerson, place: place.label, name: st?.name ?? "", remaining: left.length, mode: sched?.mode ?? (sched ? "private" : null),
    needsChoice: !sched && left.length > 0, needsBuild: !general && left.some((e) => !planned.has(e.id)),
    // الإدارة غيرت الأوقات واللي اختاره راح: يختار من جديد
    repick: general && !picksFit(slots, picksOf(sched!)),
    picks: general ? picksOf(sched!) : null,
    schedule: sched && !general ? { start: sched.start_day, end: sched.end_day, weekdays: JSON.parse(sched.weekdays), hour: sched.hour, times: sched.picks ? JSON.parse(sched.picks) : null, hol: holOf(sched.hol) ?? null } : null,
    holidays: await myHolidays(uid, sched), midHol: await midHolidayRow(sched, s), gap: s.gap,
    days: daysView(slots),
    optional: place.inPerson || !s.optionalOpen ? [] : await optionalList(uid, bought),
    // آخر سيطرة عبرها: تومض ويا شخصيتها لحد ما يشوفها
    cp: await checkpointCard(uid),
    // ملفات المحاضرات اللي صاحب البوت خلاها ظاهرة. وبنص الامتحان ماكو ملفات ولا رابط التطبيق
    inExam: await examInProgress(uid),
    lectureFiles: await examInProgress(uid) ? [] : await visibleLectureFiles(),
    // المنافسة: مجموعته وترتيبه بالمركز
    comp: await studentComp(uid),
    late: late.map((e) => ({ title: e.title, at: e.at })), lateText: LATE_TEXT, closedText: CLOSED_TEXT,
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
  need(sc && sc.mode !== "general", "هذا الطالب ما عنده جدول خاص");
  await closeMissed(uid, s);
  const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  const f = { start: addDays(todayStr(), 1), end: sc!.end_day, weekdays: JSON.parse(sc!.weekdays), hour: sc!.hour, times: sc!.picks ? JSON.parse(sc!.picks) as Record<string, string[]> : undefined, hol };
  const plan = buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings: { ...withOwnHol(s, hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] } });
  need(left.length === 0 || plan.ok, plan.ok ? "" : `بهذي العطلة ما يكفي الوقت: ${plan.error}`);
  await saveItems(uid, { ...f, start: sc!.start_day }, plan.ok ? plan.items : []);
  await saveHolRequests((await holRequests()).filter((r) => r.uid !== uid));
  await logActivity(uid, `🏖 تغيرت عطلته: ${holText(hol)}`);
  return holText(hol);
}
function formOf(body: Row, minStart: string) {
  const start = body.start, end = body.end;
  need(validDay(start) && validDay(end), "اختار تاريخ البداية والنهاية");
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
  return { start: start as string, end: end as string, weekdays, hour, times, hol };
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
  const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  const settings = { ...withOwnHol(s, f.hol), excluded: [...s.excluded, ...await studentHolidayDays(uid)] };
  return { f, left, plan: buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings }) };
}
async function saveItems(uid: number, f: Row & { times?: Record<string, string[]>; hol?: OwnHol }, items: { examId: number; at: string }[]) {
  await tx(async () => {
    await put("schedules", { user_id: uid, mode: "private", center_id: null, picks: f.times ? JSON.stringify(f.times) : null, start_day: f.start, end_day: f.end, weekdays: JSON.stringify(f.weekdays), hour: f.hour, created: stamp(), hol: f.hol ? JSON.stringify(f.hol) : null });
    await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed });
    for (const it of items) await insert("sched_items", { user_id: uid, exam_id: it.examId, at: it.at, status: "waiting" });
  });
}

export async function myExamAction(body: Row) {
  await ensure();
  // صاحب البوت يشوف جدول الطالب مثل ما يطلعله: عرض بس، بلا قفل جهاز، وما يتغير شي
  const viewed = verifyViewToken(body?.token);
  if (viewed !== null) {
    need(String(body.action ?? "") === "info", "👁 هذا عرض بس لجدول الطالب، ما تگدر تغير شي منه");
    need(await student(viewed), "الطالب غير موجود");
    return { ...await studentInfo(viewed), viewOnly: true };
  }
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  const id = uid!;
  const a = String(body.action ?? "");
  need(await student(id), "سجل معلوماتك أول");
  await checkDevice(id, body.device);
  await checkPhone(id, body.pf);
  await checkStopped(id);
  // سلّم أول امتحان: الحساب ينقفل لحد ما يربط ولي أمره
  need(!await needsGuardian(id), "🔒 حسابك مقفول لحد ما تربط ولي أمرك. افتح 🏠 القائمة الرئيسية وسوي الخطوات، أو شوف الرسالة بالمحادثة.");
  if (a === "preview" || a === "confirm") {
    const info = await studentInfo(id);
    need(info.needsBuild, "جدولك مثبت. لتغييره تواصل ويا قصي العميري");
    const { f, left, plan } = await planFor(id, body);
    need(plan.ok, plan.ok ? "" : plan.error);
    if (!plan.ok) return {};
    const titles = new Map(left.map((e) => [e.id, e.title]));
    if (a === "preview") return { ...await studentInfo(id), preview: { items: plan.items.map((i) => ({ title: titles.get(i.examId), at: i.at })), days: plan.days, maxPerDay: plan.maxPerDay, perWeek: plan.perWeek } };
    await saveItems(id, f, plan.items);
    await logActivity(id, `🗓 ثبت جدول امتحاناته: ${plan.items.length} امتحان`);
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
    need(e && (await student(id))!.exam !== "حضوري", "هذا الامتحان مو متاح");
    const version = pickOptional(await find("bank_versions", { exam_id: e!.exam }) as { id: number; kind: string; ok: unknown }[]);
    need(version, "هذا الامتحان مو متاح");
    const now = stamp();
    const item = await insert("sched_items", { user_id: id, exam_id: e!.exam, at: now, status: "started", kind: "optional", version_id: version, started_at: now, opened_at: now });
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
    if (a === "openExam") { const room = await openRoom(id, body.item, s); return { ...await studentInfo(id), room }; }
    if (a === "oath") { const room = await takeOath(id, body.item, s, body.text); return { ...await studentInfo(id), room }; }
    if (a === "delAnswer") { const room = await deleteAnswer(id, body.item, body.answer, s); return { ...await studentInfo(id), room }; }
    await submitRoom(id, body.item, s);
    return { ...await studentInfo(id), notice: "✅ وصلت أجوبتك" };
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
  if (a === "askException") {
    await askException(id, body.item, body.reason, await schedSettings());
    return { ...await studentInfo(id), notice: "📨 وصل طلبك. من يوافقون ينفتحلك الامتحان وتوصلك رسالة" };
  }
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
    if (sc.mode === "general") continue;   // مواعيد المكان بيد الإدارة
    const uid = sc.user_id as number;
    await closeMissed(uid, s);
    const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
    if (!left.length) continue;
    const f = { start, end: sc.end_day, weekdays: JSON.parse(sc.weekdays), hour: sc.hour, times: sc.picks ? JSON.parse(sc.picks) as Record<string, string[]> : undefined, hol: holOf(sc.hol) };
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
  return { ...await schedSettings(), cronUrl: await isAdmin(uid) ? cronUrl() : "", ...await placesPage(Number(body.center ?? 0)), schedules: (await find("schedules")).length, notice, holidays: holidayList, holidayPreview: preview, holReqs };
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
  const way = !sc ? "" : sc.mode === "general" ? `ويا الطلاب: ${Object.entries(picksOf(sc)).map(([d, t]) => `${DAYS[Number(d)]} ${ampm(t)}`).join("، ")}` : "جدول خاص";
  const hol = sc && sc.mode !== "general" ? holOf(sc.hol) ?? (s.holidayStart && s.holidayDays ? { from: s.holidayStart, to: addDays(s.holidayStart, s.holidayDays - 1) } : { from: "", to: "" }) : null;
  return { way, items: await itemsView(uid, s), perDay: Number(await kvGet(`sched_perday_${uid}`)) || 0, general: s.perDay, hol, holReq: (await holRequests()).find((r) => r.uid === uid) ?? null };
}
export async function resetSchedule(uid: number) {
  await remove("sched_items", { user_id: uid, status: "waiting" }, { where: (r) => !r.fixed });
  await remove("schedules", { user_id: uid });
  await logActivity(uid, "🗓 الإدارة فتحت جدوله حتى يرتبه من جديد");
  await send(uid, `🗓 <b>تگدر تعيد ترتيب جدول امتحاناتك.</b> افتح امتحاناتي ورتبه.`);
}
export const setPerDay = async (uid: number, n: number) => await kvSet(`sched_perday_${uid}`, String(n));
