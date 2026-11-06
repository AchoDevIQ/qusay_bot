// المراكز: لكل مركز مدير (أو أكثر) توصله تقارير الحضور، وسعر إيجار لكل طالب بالشهر.
// بعد كل جلسة امتحان يوصل تقرير الحضور للمدير ولصاحب البوت. آخر الشهر صاحب البوت يطلع التقرير الشهري PDF:
// كل طالب حضر ولو مرة ينحسب، والمبلغ = العدد × سعر المركز. ومن يدفع ينحفظ الاستلام باليوم والساعة ويوصل للمدير
import { ADMIN_IDS } from "./config.ts";
import { find, insert, kvGet, kvSet, one, type Row } from "./db.ts";
import { centerName, isAdmin } from "./data.ts";
import { listPdf } from "./documents.ts";
import { addMinutes } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { authed, need } from "./webApi.ts";

const KEY = "center_rent_cfg";
type Cfg = { managers: number[]; price: number };
const money = (n: number) => n.toLocaleString("en-US");

async function allCfg(): Promise<Record<string, Partial<Cfg>>> {
  try { return JSON.parse(await kvGet(KEY) ?? "{}"); } catch { return {}; }
}
export async function rentCfg(cid: number): Promise<Cfg> {
  const c = (await allCfg())[String(cid)] ?? {};
  return { managers: Array.isArray(c.managers) ? c.managers.map(Number) : [], price: Number(c.price) || 0 };
}
const DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
const dayName = (at: string) => DAYS[(new Date(at.slice(0, 10) + "T00:00:00Z").getUTCDay() + 6) % 7];

// ---------- تقرير بعد كل جلسة: من يخلص وقت الامتحان بالمركز
/** امتحانات الحضوري: كل ورقة ويا مركز طالبها وجنسه */
async function inPersonItems(filter: (i: Row) => boolean) {
  const students = new Map((await find("students", { exam: "حضوري" })).map((s) => [s.user_id, s]));
  return (await find("sched_items")).filter((i) => students.has(i.user_id) && i.kind !== "optional" && filter(i))
    .map((i) => ({ ...i, st: students.get(i.user_id)! }) as Row & { st: Row });
}
export async function sweepSessions() {
  const today = todayStr(), now = stamp();
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const items = await inPersonItems((i) => String(i.at).startsWith(today));
  let reported: string[] = [];
  try { reported = JSON.parse(await kvGet(`att_reported_${today}`) ?? "[]"); } catch { /* خربانة */ }
  const sessions = new Map<string, typeof items>();
  for (const i of items) {
    const key = `${i.st.center_id}|${i.at}`;
    if (reported.includes(key)) continue;
    // الجلسة تخلص بعد وقت أطول امتحان بيها
    sessions.set(key, [...sessions.get(key) ?? [], i]);
  }
  let sent = 0;
  for (const [key, list] of sessions) {
    const end = list.reduce((m, i) => { const t = addMinutes(String(i.at).slice(0, 16), Number(exams.get(i.exam_id)?.minutes ?? 75)); return t > m ? t : m; }, "");
    if (now < end) continue;
    const cid = Number(list[0].st.center_id);
    const came = list.filter((i) => i.attended_at), away = list.filter((i) => !i.attended_at);
    const g = (l: typeof list, x: string) => l.filter((i) => i.st.gender === x).length;
    const lines = [...new Set(list.map((i) => i.exam_id))].map((e) => `📝 ${esc(exams.get(e)?.title ?? "امتحان")}: ${came.filter((i) => i.exam_id === e).length} من ${list.filter((i) => i.exam_id === e).length}`);
    const text = [
      `📋 <b>تقرير الحضور</b>`, `🏫 ${esc(await centerName(cid) || "مركز")}`, `🗓 ${dayName(list[0].at)} ${String(list[0].at).slice(0, 10)} · ${String(list[0].at).slice(11, 16)}`, "",
      ...lines, "", `✅ حضر <b>${came.length}</b> من ${list.length} (بنين ${g(came, "بنين")} · بنات ${g(came, "بنات")})`,
      away.length ? `❌ غاب ${away.length}: ${away.map((i) => esc(i.st.name)).join("، ")}` : "👏 ماكو غياب",
    ].join("\n");
    for (const to of new Set([...(await rentCfg(cid)).managers, ...ADMIN_IDS])) { try { await send(to, text); } catch (e) { console.error(e); } }
    reported.push(key);
    sent++;
  }
  if (sent) await kvSet(`att_reported_${today}`, JSON.stringify(reported));
  return sent;
}

// ---------- الشهر: كل طالب حضر ولو مرة
const MONTH = /^\d{4}-\d{2}$/;
type Items = Awaited<ReturnType<typeof inPersonItems>>;
async function monthOf(cid: number, month: string, preloaded?: Items) {
  const items = preloaded ?? await inPersonItems((i) => String(i.attended_at ?? "").startsWith(month));
  const mine = items.filter((i) => Number(i.st.center_id) === cid && String(i.attended_at ?? "").startsWith(month));
  const byStudent = new Map<number, { name: string; gender: string; times: number; days: string[] }>();
  for (const i of mine) {
    const s = byStudent.get(i.user_id) ?? { name: String(i.st.name ?? ""), gender: String(i.st.gender ?? ""), times: 0, days: [] };
    s.times++; s.days.push(String(i.at).slice(5, 10));
    byStudent.set(i.user_id, s);
  }
  const list = [...byStudent.entries()].map(([id, s]) => ({ id, ...s })).sort((a, b) => a.gender.localeCompare(b.gender) || a.name.localeCompare(b.name));
  return { list, boys: list.filter((s) => s.gender === "بنين").length, girls: list.filter((s) => s.gender === "بنات").length };
}
async function sendMonthly(cid: number, month: string, to: number[]) {
  const m = await monthOf(cid, month), cfg = await rentCfg(cid), name = await centerName(cid);
  const title = `حضور ${name} لشهر ${month}: ${m.list.length} طالب (بنين ${m.boys} · بنات ${m.girls}) × ${money(cfg.price)} = ${money(m.list.length * cfg.price)} دينار`;
  const rows = m.list.map((s) => [s.name, s.id, s.gender || "-", s.times, s.days.join("، ")]);
  for (const chat of new Set(to)) await listPdf(chat, title, ["الطالب", "الرقم", "الجنس", "مرات الحضور", "الأيام"], rows, `attendance_${cid}_${month}`);
}

async function pageData(month: string) {
  const all = await allCfg();
  const paid = await find("center_rent", { month });
  const items = await inPersonItems((i) => String(i.attended_at ?? "").startsWith(month));
  const centers = [];
  for (const c of await find("centers", { active: 1 })) {
    const m = await monthOf(c.id, month, items), cfg = { managers: [], price: 0, ...all[String(c.id)] } as Cfg;
    const p = paid.filter((x) => x.center_id === c.id).map((x) => ({ id: x.id as number, students: x.students as number, amount: x.amount as number, created: x.created as string }));
    centers.push({ id: c.id as number, name: await centerName(c.id), managers: cfg.managers, price: cfg.price, students: m.list.length, boys: m.boys, girls: m.girls, amount: m.list.length * cfg.price, paid: p });
  }
  return { month, months: lastMonths(), centers, notice: "" };
}
const lastMonths = () => { const t = todayStr(); const y = Number(t.slice(0, 4)), mo = Number(t.slice(5, 7)); return [0, 1, 2, 3].map((k) => { const d = new Date(Date.UTC(y, mo - 1 - k, 1)); return d.toISOString().slice(0, 7); }); };

export async function rentAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  const a = String(body.action ?? "");
  const month = MONTH.test(String(body.month ?? "")) ? String(body.month) : todayStr().slice(0, 7);
  let notice = "";
  const center = async () => { const id = Number(body.center); need(await one("centers", { id }), "المركز غير موجود"); return id; };
  if (a === "save") {
    const id = await center();
    const managers = [...new Set(String(body.managers ?? "").split(/[\s,،]+/).filter(Boolean).map(Number))];
    need(managers.every((x) => Number.isSafeInteger(x) && x > 0), "رقم حساب المدير لازم أرقام بس");
    const price = Number(body.price ?? 0);
    need(Number.isInteger(price) && price >= 0 && price <= 10_000_000, "السعر لازم رقم كامل بالدينار");
    const all = await allCfg();
    all[String(id)] = { managers, price };
    await kvSet(KEY, JSON.stringify(all));
    notice = `✅ انحفظ ${await centerName(id)}`;
  } else if (a === "report") {
    const id = await center();
    await sendMonthly(id, month, [uid, ...(await rentCfg(id)).managers]);
    notice = "📄 وصل التقرير الشهري إلك وللمدير";
  } else if (a === "pay") {
    const id = await center();
    const m = await monthOf(id, month), cfg = await rentCfg(id);
    need(m.list.length, "ماكو حضور بهذا الشهر");
    need(cfg.price > 0, "حط سعر الطالب للمركز أول");
    const amount = m.list.length * cfg.price, at = stamp();
    await insert("center_rent", { center_id: id, month, students: m.list.length, price: cfg.price, amount, created: at, by_id: uid });
    const text = `💵 <b>تم تسليم إيجار ${esc(await centerName(id))}</b>\nشهر ${month}: ${m.list.length} طالب (بنين ${m.boys} · بنات ${m.girls}) × ${money(cfg.price)} = <b>${money(amount)} دينار</b>\n🕓 ${at.slice(0, 10)} الساعة ${at.slice(11, 16)}`;
    for (const to of cfg.managers) { try { await send(to, text); } catch (e) { console.error(e); } }
    notice = `✅ انسجل دفع ${money(amount)} دينار`;
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(month), notice };
}
