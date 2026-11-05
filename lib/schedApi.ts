// جدول الامتحانات: إعدادات الإدارة، بناء الطالب لجدوله، وعرضه
import { find, insert, kvGet, kvSet, one, put, remove, tx, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { CENTER_GROUPS } from "./bookOutline.ts";
import { DAYS, DAY_ORDER } from "./config.ts";
import { centerName, student } from "./data.ts";
import { chapterLabel } from "./orderRules.ts";
import { send } from "./telegram.ts";
import { DEFAULT_SETTINGS, addDays, buildPlan, itemState, labelChapters, slotDates, ampm, validDay, type PlanExam, type Slot, type SchedSettings } from "./scheduleRules.ts";
import { stamp, todayStr } from "./util.ts";
import { authed, ensure, intOf, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const SCHED_PERM = "schedule";
export async function schedSettings(): Promise<SchedSettings> {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await kvGet("sched_settings") || "{}") }; } catch { return DEFAULT_SETTINGS; }
}
/** مكان الامتحان: المجاميع تتبع المركز، والإلكتروني كأنه مركز رقمه 0 */
async function placeFor(uid: number) {
  const st = await student(uid);
  const inPerson = st?.exam === "حضوري";
  const centerId = inPerson ? st?.center_id ?? -1 : 0;
  return { inPerson, centerId, gender: st?.gender ?? "", label: inPerson ? await centerName(st?.center_id) || "مركزك" : "الامتحان الإلكتروني" };
}
/** ساعات الجدول الخاص */
const allowedHours = (s: SchedSettings) => Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 6 && !s.blockedHours.includes(h));
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
async function boughtExams(uid: number) {
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
  const gone = new Set(items.filter((i) => i.status !== "waiting").map((i) => i.exam_id));
  return bought.filter((e) => !gone.has(e.id));
};
const toPlanExams = (rows: Row[]): PlanExam[] => rows.map((e) => ({ id: e.id, minutes: e.minutes ?? 75 }));

const slotsOf = (g: Row): Slot[] => { try { return JSON.parse(g.slots || "[]"); } catch { return []; } };
/** «السبت 11:00 صباحاً + الثلاثاء 2:00 مساءً» */
const slotsLabel = (g: Row) => slotsOf(g).map((x) => `${DAYS[x.d]} ${ampm(x.t)}`).join(" + ") || ampm(`${g.hour}:00`);
const groupFits = (g: Row, gender: string) => !g.gender || !gender || g.gender === gender;
/** اشترى متأخر: امتحانات موعدها مع مجموعته فات وما انحسبت بعد. نسأله يبقى ويا الطلاب لو يتحول خاص */
async function lateExams(uid: number, groupId: number, s: SchedSettings): Promise<Row[]> {
  const dates = new Map((await find("group_dates", { group_id: groupId })).map((d) => [d.exam_id, d.at]));
  const items = await find("sched_items", { user_id: uid });
  const has = new Set(items.map((i) => i.exam_id));
  const now = stamp();
  return (await boughtExams(uid)).filter((e) => dates.has(e.id) && !has.has(e.id) && itemState("waiting", dates.get(e.id), s.window, now) === "missed").map((e) => ({ ...e, at: dates.get(e.id) }));
}
/** الطالب العام مواعيده من مجموعته. يتحدث بس إذا تغير شي */
async function syncGeneral(uid: number, groupId: number, s: SchedSettings) {
  const dates = new Map((await find("group_dates", { group_id: groupId })).map((d) => [d.exam_id, d.at]));
  const items = await find("sched_items", { user_id: uid });
  const late = new Set((await lateExams(uid, groupId, s)).map((e) => e.id));
  const wanted = remaining(await boughtExams(uid), items).filter((e) => dates.has(e.id) && !late.has(e.id)).map((e) => `${e.id}|${dates.get(e.id)}`).sort();
  const have = items.filter((i) => i.status === "waiting").map((i) => `${i.exam_id}|${i.at}`).sort();
  if (wanted.join() === have.join()) return;
  await tx(async () => {
    await remove("sched_items", { user_id: uid, status: "waiting" });
    for (const w of wanted) { const [e, at] = w.split("|"); await insert("sched_items", { user_id: uid, exam_id: Number(e), at, status: "waiting" }); }
  });
  await closeMissed(uid, s);
}
async function itemsView(uid: number, s: SchedSettings) {
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const now = stamp();
  const { inPerson } = await placeFor(uid);
  return (await find("sched_items", { user_id: uid }, { order: ["at"] })).map((i) => {
    const e = exams.get(i.exam_id);
    const state = i.status === "missed" ? "missed" : itemState(i.status, i.at, s.window, now);
    // الحضوري ينقدم بالمركز، فبعد موعده يكفي نگول انتهى
    return { id: i.id, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", minutes: e?.minutes ?? 75, at: i.at, state: inPerson && state !== "locked" ? "past" : inPerson ? "center" : state };
  });
}
async function studentInfo(uid: number) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const st = await student(uid);
  const sched = await one("schedules", { user_id: uid });
  const general = sched?.mode === "general";
  if (general) await syncGeneral(uid, sched!.group_id, s);
  const bought = await boughtExams(uid);
  const items = await find("sched_items", { user_id: uid });
  const left = remaining(bought, items);
  const planned = new Set(items.filter((i) => i.status === "waiting").map((i) => i.exam_id));
  const place = await placeFor(uid);
  const groups = (await find("exam_groups", { center_id: place.centerId }, { order: ["hour"] })).filter((g) => groupFits(g, place.gender));
  const group = general ? await one("exam_groups", { id: sched!.group_id }) : null;
  const late = general ? await lateExams(uid, sched!.group_id, s) : [];
  // جدول المجموعة كله يطلع حتى يعرف شوكت يخلص، والفصول اللي ما اشتراها مقفولة
  const lockedRows: Row[] = [];
  if (general) {
    const mine = new Set(bought.map((e) => e.id));
    const allExams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
    for (const d of await find("group_dates", { group_id: sched!.group_id })) {
      const e = allExams.get(d.exam_id);
      if (e && !mine.has(d.exam_id)) lockedRows.push({ id: -e.id, title: e.title, chapter: e.chapter, minutes: e.minutes ?? 75, at: d.at, state: "notbought" });
    }
  }
  return {
    inPerson: place.inPerson, place: place.label, name: st?.name ?? "", remaining: left.length, mode: sched?.mode ?? (sched ? "private" : null), groupName: group?.name ?? "",
    needsChoice: !sched && left.length > 0, needsBuild: !general && left.some((e) => !planned.has(e.id)),
    schedule: sched && !general ? { start: sched.start_day, end: sched.end_day, weekdays: JSON.parse(sched.weekdays), hour: sched.hour } : null,
    groups: groups.map((g) => ({ id: g.id, name: g.name, hour: g.hour, label: slotsLabel(g) })),
    late: late.map((e) => ({ title: e.title, at: e.at })),
    items: [...await itemsView(uid, s), ...lockedRows].sort((a, b) => String(a.at).localeCompare(String(b.at))), today: todayStr(), minStart: addDays(todayStr(), 1), window: s.window, perDay: await perDayFor(uid, s),
    week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), hours: allowedHours(s),
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
    await put("schedules", { user_id: uid, mode: "private", group_id: null, start_day: f.start, end_day: f.end, weekdays: JSON.stringify(f.weekdays), hour: f.hour, created: stamp() });
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
  if (a === "groupPreview" || a === "joinGroup") {
    const place = await placeFor(id);
    need(!await one("schedules", { user_id: id }), "جدولك مثبت. لتغييره تواصل ويا قصي العميري");
    const g = await one("exam_groups", { id: Number(body.group) });
    need(g && g.center_id === place.centerId && groupFits(g, place.gender), "هذي المجموعة مو من مكانك");
    if (a === "joinGroup") {
      await put("schedules", { user_id: id, mode: "general", group_id: g!.id, created: stamp() });
      await logActivity(id, `🗓 اختار يمشي ويا ${g!.name}`);
      return { ...await studentInfo(id), notice: "✅ انضفت للمجموعة" };
    }
    const dates = new Map((await find("group_dates", { group_id: g!.id })).map((d) => [d.exam_id, d.at]));
    const bought = await boughtExams(id);
    const mine = new Set(bought.map((e) => e.id));
    const dated = (await find("bank_exams")).filter((e) => dates.has(e.id));
    return { ...await studentInfo(id), groupPreview: { id: g!.id, name: g!.name, items: dated.map((e) => ({ title: e.title, at: dates.get(e.id), locked: !mine.has(e.id) })).sort((x, y) => String(x.at).localeCompare(String(y.at))), waiting: bought.filter((e) => !dates.has(e.id)).length } };
  }
  if (a === "lateKeep" || a === "latePrivate") {
    const sc = await one("schedules", { user_id: id });
    need(sc?.mode === "general", "هذا للطالب اللي يمشي ويا الطلاب");
    const s = await schedSettings();
    if (a === "lateKeep") {
      for (const e of await lateExams(id, sc!.group_id, s)) await insert("sched_items", { user_id: id, exam_id: e.id, at: e.at, status: "missed" });
      await logActivity(id, "🗓 بقى ويا الطلاب، والامتحانات اللي فات موعدها انحسبت فايتة");
    } else {
      await remove("sched_items", { user_id: id, status: "waiting" });
      await remove("schedules", { user_id: id });
      await logActivity(id, "🗓 طلع من مجموعته حتى يختار جدول ثاني");
    }
    return await studentInfo(id);
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
    if (sc.mode === "general") continue;   // مواعيد المجموعة بيد الإدارة
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
  } else if (a === "addGroup") {
    const hour = intOf(body.hour, 0, 23, "اختار ساعة المجموعة");
    const center = Number(body.center);
    need(center === 0 || await one("centers", { id: center }), "المركز غير موجود");
    const name = String(body.name ?? "").trim().slice(0, 40);
    need(name, "اكتب اسم المجموعة");
    need(!await one("exam_groups", { center_id: center, name }), "أكو مجموعة بهذا الاسم");
    await insert("exam_groups", { center_id: center, name, hour, gender: String(body.gender ?? "") || null });
  } else if (a === "editGroup") {
    const id = Number(body.id);
    need(await one("exam_groups", { id }), "المجموعة غير موجودة");
    const name = String(body.name ?? "").trim().slice(0, 40);
    need(name, "اكتب اسم المجموعة");
    const slots = (Array.isArray(body.slots) ? body.slots : []) as Row[];
    need(slots.every((x) => Number.isInteger(x.d) && x.d >= 0 && x.d < 7 && /^\d{2}:\d{2}$/.test(String(x.t))), "وقت غير صحيح");
    const clean = slots.map((x) => ({ d: x.d as number, t: String(x.t) }));
    await update("exam_groups", { id }, { name, hour: clean.length ? Number(clean[0].t.slice(0, 2)) : intOf(body.hour, 0, 23, "اختار ساعة المجموعة"), gender: String(body.gender ?? "") || null, slots: JSON.stringify(clean) });
  } else if (a === "delGroup") {
    const id = Number(body.id);
    need(await one("exam_groups", { id }), "المجموعة غير موجودة");
    for (const sc of await find("schedules", { mode: "general", group_id: id })) {
      await remove("sched_items", { user_id: sc.user_id, status: "waiting" });
      await remove("schedules", { user_id: sc.user_id });
      await send(sc.user_id, "🗓 <b>مجموعة امتحانك انشالت.</b> افتح امتحاناتي واختار مجموعة ثانية.");
    }
    await remove("group_dates", { group_id: id });
    await remove("exam_groups", { id });
  } else if (a === "saveGroup") {
    const id = Number(body.id);
    const g = await one("exam_groups", { id });
    need(g, "المجموعة غير موجودة");
    const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
    for (const r of rows) need(!r.date || (validDay(r.date) && /^\d{2}:\d{2}$/.test(String(r.time ?? ""))), "تاريخ أو ساعة غير صحيحة");
    await tx(async () => {
      await remove("group_dates", { group_id: id });
      for (const r of rows) if (r.date) await put("group_dates", { group_id: id, exam_id: Number(r.exam), at: `${r.date} ${r.time}`, version_id: Number(r.version) || null });
    });
    const told = await tellGroup(id);
    notice = `✅ انحفظت المواعيد${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
  } else if (a === "fillGroup") {
    // يوزع امتحانات الكتاب بالترتيب على أوقات المجموعة من تاريخ البداية. النسخ المحددة تبقى
    const id = Number(body.id);
    const g = await one("exam_groups", { id });
    need(g, "المجموعة غير موجودة");
    need(validDay(body.start), "اختار تاريخ البداية");
    need(slotsOf(g!).length, "ضيف أوقات المجموعة بالأسبوع أول");
    const versions = await find("bank_versions");
    const exams = (await find("bank_exams")).filter((e) => { const vs = versions.filter((v) => v.exam_id === e.id); return !vs.length || vs.some((v) => v.kind === "mandatory"); })
      .sort((x, y) => String(x.slug).localeCompare(String(y.slug)) || (x.pos ?? x.ord) - (y.pos ?? y.ord));
    const ats = slotDates(slotsOf(g!), String(body.start), exams.length, await schedSettings());
    const old = new Map((await find("group_dates", { group_id: id })).map((d) => [d.exam_id, d.version_id]));
    await tx(async () => {
      await remove("group_dates", { group_id: id });
      for (const [i, e] of exams.entries()) if (ats[i]) await put("group_dates", { group_id: id, exam_id: e.id, at: ats[i], version_id: old.get(e.id) ?? null });
    });
    const told = await tellGroup(id);
    notice = `✅ توزع ${ats.length} امتحان، آخرها ${ats.at(-1) ?? ""}${told ? `، ووصل الخبر لـ ${told} طالب` : ""}`;
  } else if (a === "loadCenterGroups") {
    const centers = await find("centers", { active: 1 });
    const missing: string[] = [];
    let added = 0;
    for (const c of CENTER_GROUPS) {
      const row = centers.find((x) => String(x.name).includes(c.match));
      if (!row) { missing.push(c.match); continue; }
      if (c.gender) await update("centers", { id: row.id }, { gender: c.gender });
      if ((await find("exam_groups", { center_id: row.id })).length) continue;
      const n = c.days[0][1].length;
      for (let i = 0; i < n; i++) {
        const slots = c.days.map(([d, times]) => ({ d, t: times[i] }));
        await insert("exam_groups", { center_id: row.id, name: `المجموعة ${i + 1}`, hour: Number(slots[0].t.slice(0, 2)), gender: c.gender ?? null, slots: JSON.stringify(slots) });
        added++;
      }
    }
    await kvSet("center_groups_loaded", "1");
    notice = `✅ انضافت ${added} مجموعة${missing.length ? `. ما لگيت هاي المراكز: ${missing.join("، ")}` : ""}`;
  } else if (a === "copyGroup") {
    // نفس الأيام من مجموعة ثانية، بساعة هذي المجموعة. النسخ ما تنسخ لأن كل مجموعة إلها نسختها
    const g = await one("exam_groups", { id: Number(body.id) });
    need(g, "المجموعة غير موجودة");
    const from = await find("group_dates", { group_id: Number(body.from) });
    need(from.length, "المجموعة الثانية ما بيها مواعيد");
    const hh = `${String(g!.hour).padStart(2, "0")}:00`;
    const old = new Map((await find("group_dates", { group_id: g!.id })).map((d) => [d.exam_id, d.version_id]));
    await tx(async () => {
      await remove("group_dates", { group_id: g!.id });
      for (const d of from) await put("group_dates", { group_id: g!.id, exam_id: d.exam_id, at: `${String(d.at).slice(0, 10)} ${hh}`, version_id: old.get(d.exam_id) ?? null });
    });
    notice = "📋 انتسخت الأيام. راجعها واضغط حفظ حتى توصل للطلاب";
  } else need(a === "list", "أمر غير معروف");
  return { ...await schedSettings(), ...await groupsPage(body.open), schedules: (await find("schedules")).length, notice };
}
/** كل طالب بالمجموعة يوصله خبر واحد إذا تغيرت مواعيده */
async function tellGroup(id: number) {
  const s = await schedSettings();
  const stateOf = async (u: number) => (await find("sched_items", { user_id: u, status: "waiting" })).map((i) => `${i.exam_id}|${i.at}`).sort().join();
  let told = 0;
  for (const sc of await find("schedules", { mode: "general", group_id: id })) {
    const before = await stateOf(sc.user_id);
    await syncGeneral(sc.user_id, id, s);
    if (before !== await stateOf(sc.user_id)) {
      await send(sc.user_id, "🗓 <b>تحدثت مواعيد امتحاناتك.</b> افتح امتحاناتي وشوفها.");
      told++;
    }
  }
  return told;
}
/** المراكز ومجاميعها، وتفاصيل المجموعة المفتوحة */
async function groupsPage(open: unknown) {
  const groups = await find("exam_groups", {}, { order: ["hour"] });
  const counts = await find("schedules", { mode: "general" });
  const areas = new Map((await find("areas")).map((a) => [a.id, a.name]));
  const places = [{ id: 0, name: "💻 الإلكتروني" }, ...(await find("centers", { active: 1 }, { order: ["id"] })).map((c) => ({ id: c.id as number, name: `🏫 ${c.name} (${areas.get(c.area_id) ?? ""})` }))];
  let detail: Row | null = null;
  const g = open ? groups.find((x) => x.id === Number(open)) : null;
  if (g) {
    const dates = new Map((await find("group_dates", { group_id: g.id })).map((d) => [d.exam_id, d]));
    const versions = await find("bank_versions", { kind: "mandatory" }, { order: ["model"] });
    const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord));
    detail = { id: g.id, name: g.name, hour: g.hour, gender: g.gender ?? "", slots: slotsOf(g), rows: exams.map((e) => {
      const d = dates.get(e.id);
      return { exam: e.id, chapter: e.chapter, title: e.title, date: d ? String(d.at).slice(0, 10) : "", time: d ? String(d.at).slice(11) : "", version: d?.version_id ?? 0, versions: versions.filter((v) => v.exam_id === e.id).map((v) => ({ id: v.id, model: v.model })) };
    }) };
  }
  return { canLoadCenters: !await kvGet("center_groups_loaded"), week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), places, groups: groups.map((x) => ({ id: x.id, center: x.center_id, name: x.name, hour: x.hour, gender: x.gender ?? "", label: slotsLabel(x), students: counts.filter((c) => c.group_id === x.id).length })), detail };
}
/** جدول طالب واحد بصفحة الطلاب */
export async function studentSchedule(uid: number) {
  const s = await schedSettings();
  await closeMissed(uid, s);
  const sc = await one("schedules", { user_id: uid });
  if (sc?.mode === "general") await syncGeneral(uid, sc.group_id, s);
  const g = sc?.group_id ? await one("exam_groups", { id: sc.group_id }) : null;
  return { way: !sc ? "" : g ? `ويا الطلاب: ${g.name}` : "جدول خاص", items: await itemsView(uid, s), perDay: Number(await kvGet(`sched_perday_${uid}`)) || 0, general: s.perDay };
}
export async function resetSchedule(uid: number) {
  await remove("sched_items", { user_id: uid, status: "waiting" });
  await remove("schedules", { user_id: uid });
  await logActivity(uid, "🗓 الإدارة فتحت جدوله حتى يرتبه من جديد");
  await send(uid, `🗓 <b>تگدر تعيد ترتيب جدول امتحاناتك.</b> افتح امتحاناتي ورتبه.`);
}
export const setPerDay = async (uid: number, n: number) => await kvSet(`sched_perday_${uid}`, String(n));
