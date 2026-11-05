// جدول الامتحانات: إعدادات الإدارة، بناء الطالب لجدوله، وعرضه
import { find, insert, kvGet, kvSet, one, put, remove, tx, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { DAYS, DAY_ORDER } from "./config.ts";
import { student } from "./data.ts";
import { send } from "./telegram.ts";
import { DEFAULT_SETTINGS, addDays, buildPlan, itemState, validDay, type PlanExam, type SchedSettings } from "./scheduleRules.ts";
import { stamp, todayStr } from "./util.ts";
import { authed, ensure, intOf, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const SCHED_PERM = "schedule";
export async function schedSettings(): Promise<SchedSettings> {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await kvGet("sched_settings") || "{}") }; } catch { return DEFAULT_SETTINGS; }
}
/** حد الامتحانات باليوم: الخاص بالطالب إذا موجود، وإلا العام */
export async function perDayFor(uid: number, s: SchedSettings) { return Number(await kvGet(`sched_perday_${uid}`)) || s.perDay; }

/** الامتحانات الإجبارية الجاهزة من الفصول اللي اشتراها، بترتيبها */
async function boughtExams(uid: number) {
  const chapters = (await find("exam_access", { user_id: uid }, { order: ["created", "chapter"] })).map((r) => r.chapter as string);
  const ready = new Set((await find("bank_versions", { kind: "mandatory", ok: 1 })).map((v) => v.exam_id));
  const out: Row[] = [];
  for (const ch of chapters) {
    const list = (await find("bank_exams", { chapter: ch })).filter((e) => ready.has(e.id)).sort((a, b) => (a.pos ?? a.ord) - (b.pos ?? b.ord) || a.id - b.id);
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
  const gone = new Set(items.filter((i) => i.status !== "waiting").map((i) => i.exam_id));
  return bought.filter((e) => !gone.has(e.id));
};
const toPlanExams = (rows: Row[]): PlanExam[] => rows.map((e) => ({ id: e.id, minutes: e.minutes ?? 75 }));

async function itemsView(uid: number, s: SchedSettings) {
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const now = stamp();
  return (await find("sched_items", { user_id: uid }, { order: ["at"] })).map((i) => {
    const e = exams.get(i.exam_id);
    return { id: i.id, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", minutes: e?.minutes ?? 75, at: i.at, state: i.status === "missed" ? "missed" : itemState(i.status, i.at, s.window, now) };
  });
}
async function studentInfo(uid: number) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const st = await student(uid);
  const sched = await one("schedules", { user_id: uid });
  const bought = await boughtExams(uid);
  const items = await find("sched_items", { user_id: uid });
  const left = remaining(bought, items);
  const planned = new Set(items.filter((i) => i.status === "waiting").map((i) => i.exam_id));
  return {
    inPerson: st?.exam === "حضوري", name: st?.name ?? "", remaining: left.length, needsBuild: left.some((e) => !planned.has(e.id)),
    schedule: sched ? { start: sched.start_day, end: sched.end_day, weekdays: JSON.parse(sched.weekdays), hour: sched.hour } : null,
    items: await itemsView(uid, s), today: todayStr(), minStart: addDays(todayStr(), 1), window: s.window, perDay: await perDayFor(uid, s),
    week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), hours: Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 6 && !s.blockedHours.includes(h)),
    holiday: s.holidayStart && s.holidayDays ? { start: s.holidayStart, days: s.holidayDays } : null,
  };
}
function formOf(body: Row, minStart: string) {
  const start = body.start, end = body.end;
  need(validDay(start) && validDay(end), "اختار تاريخ البداية والنهاية");
  need(start >= minStart, "تاريخ البداية لازم يكون من باجر فصاعداً");
  const weekdays = [...new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number))].filter((d) => DAY_ORDER.includes(d)) as number[];
  return { start: start as string, end: end as string, weekdays, hour: intOf(body.hour, 0, 23, "اختار الساعة") };
}
async function planFor(uid: number, body: Row) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const f = formOf(body, addDays(todayStr(), 1));
  const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
  return { f, left, plan: buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings: s }) };
}
async function saveItems(uid: number, f: Row, items: { examId: number; at: string }[]) {
  await tx(async () => {
    await put("schedules", { user_id: uid, start_day: f.start, end_day: f.end, weekdays: JSON.stringify(f.weekdays), hour: f.hour, created: stamp() });
    await remove("sched_items", { user_id: uid, status: "waiting" });
    for (const it of items) await insert("sched_items", { user_id: uid, exam_id: it.examId, at: it.at, status: "waiting" });
  });
}

export async function myExamAction(body: Row) {
  await ensure();
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  const id = uid!;
  const a = String(body.action ?? "");
  need(await student(id), "سجل معلوماتك أول");
  if (a === "preview" || a === "confirm") {
    need((await student(id))!.exam !== "حضوري", "جدول الطالب الحضوري يتحدد لاحقاً");
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
  need(a === "info", "أمر غير معروف");
  return await studentInfo(id);
}

// ---------- الإدارة
const dayList = (raw: unknown) => {
  const list = String(raw ?? "").split(/[\s,،]+/).filter(Boolean);
  need(list.every(validDay), "اكتب الأيام المستثناة بهذا الشكل: 2027-01-25");
  return [...new Set(list)].sort();
};
/** تغيرت العطلة: كل الجداول تنعاد من باجر، وكل طالب يوصله الخبر */
async function rebuildAll(s: SchedSettings) {
  let moved = 0, stuck = 0;
  const start = addDays(todayStr(), 1);
  for (const sc of await find("schedules")) {
    const uid = sc.user_id as number;
    await closeMissed(uid, s);
    const left = remaining(await boughtExams(uid), await find("sched_items", { user_id: uid }));
    if (!left.length) continue;
    const f = { start, end: sc.end_day, weekdays: JSON.parse(sc.weekdays), hour: sc.hour };
    const plan = buildPlan(toPlanExams(left), { ...f, perDay: await perDayFor(uid, s), settings: s });
    if (plan.ok) {
      await saveItems(uid, f, plan.items);
      await send(uid, "🗓 <b>تغير جدول امتحاناتك</b> بسبب تغيير العطلة. افتح امتحاناتي وشوف المواعيد الجديدة.");
      moved++;
    } else {
      // ما يكفي الوقت: يرجع يرتب جدوله بنفسه
      await remove("sched_items", { user_id: uid, status: "waiting" });
      await send(uid, "🗓 <b>لازم تعيد ترتيب جدول امتحاناتك</b> بسبب تغيير العطلة. افتح امتحاناتي ورتبه من جديد.");
      stuck++;
    }
  }
  return { moved, stuck };
}
export async function schedAdminAction(body: Row) {
  await authed(body?.initData, SCHED_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "save") {
    const old = await schedSettings();
    const holidayStart = String(body.holidayStart ?? "");
    need(!holidayStart || validDay(holidayStart), "تاريخ بداية العطلة غير صحيح");
    const hours = [...new Set((Array.isArray(body.blockedHours) ? body.blockedHours : []).map(Number))].filter((h) => Number.isInteger(h) && h >= 0 && h < 24).sort((x, y) => x - y) as number[];
    const next: SchedSettings = {
      window: intOf(body.window, 1, 600, "وقت الدخول بالدقائق، من 1 إلى 600"), perDay: intOf(body.perDay, 1, 10, "امتحانات اليوم من 1 إلى 10"), gap: intOf(body.gap, 0, 600, "الفاصل بالدقائق، من 0 إلى 600"),
      holidayStart, holidayDays: intOf(body.holidayDays, 0, 120, "أيام العطلة من 0 إلى 120"), blockedHours: hours, excluded: dayList(body.excluded),
    };
    await kvSet("sched_settings", JSON.stringify(next));
    notice = "✅ انحفظت الإعدادات";
    const days = (x: SchedSettings) => JSON.stringify([x.holidayStart, x.holidayDays, x.excluded]);
    if (days(old) !== days(next)) {
      const r = await rebuildAll(next);
      notice += `. انعاد جدول ${r.moved} طالب${r.stuck ? `، و${r.stuck} لازم يرتبون جدولهم` : ""}`;
    }
  } else need(a === "list", "أمر غير معروف");
  return { ...await schedSettings(), schedules: (await find("schedules")).length, notice };
}
/** جدول طالب واحد بصفحة الطلاب */
export async function studentSchedule(uid: number) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  return { items: await itemsView(uid, s), perDay: Number(await kvGet(`sched_perday_${uid}`)) || 0, general: s.perDay };
}
export async function resetSchedule(uid: number) {
  await remove("sched_items", { user_id: uid, status: "waiting" });
  await remove("schedules", { user_id: uid });
  await logActivity(uid, "🗓 الإدارة فتحت جدوله حتى يرتبه من جديد");
  await send(uid, `🗓 <b>تگدر تعيد ترتيب جدول امتحاناتك.</b> افتح امتحاناتي ورتبه.`);
}
export const setPerDay = async (uid: number, n: number) => await kvSet(`sched_perday_${uid}`, String(n));
