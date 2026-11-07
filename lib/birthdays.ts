// أعياد ميلاد الطلاب: كل يوم الصبح يوصل لصاحب البوت (وللمساعدين اللي عندهم الصلاحية) منو عيد ميلاده اليوم،
// ويا معدل درجاته لحد هسه. اللي معدله فوق الحد اللي يحطه صاحب البوت ينعزل فوك، حتى ينطوله هدية
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { isAdmin } from "./data.ts";
import { adminPageLink } from "./keyboards.ts";
import { addDays } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { authed, intOf, need } from "./webApi.ts";

export const BIRTHDAY_PERM = "birthdays";
const KEY = "birthday_cfg";
const SEND_AT = "08:00";
type Cfg = { min: number };

export async function birthdayCfg(): Promise<Cfg> {
  try { const j = JSON.parse(await kvGet(KEY) ?? "{}"); return { min: Number.isFinite(Number(j.min)) ? Number(j.min) : 90 }; } catch { return { min: 90 }; }
}

/** معدل كل طالب لحد هسه: الامتحانات الإجبارية المصححة بس */
async function averages() {
  const out = new Map<number, { sum: number; n: number }>();
  for (const i of await find("sched_items")) {
    if (!i.graded_at || i.kind === "optional") continue;
    const a = out.get(i.user_id) ?? { sum: 0, n: 0 };
    a.sum += Number(i.total) || 0; a.n++;
    out.set(i.user_id, a);
  }
  return out;
}

/** طلاب عيد ميلادهم بهذا اليوم، من أعلى معدل لأقل */
export async function birthdaysOn(date: string) {
  const md = date.slice(5);
  const avg = await averages();
  const year = Number(date.slice(0, 4));
  return (await find("students")).filter((s: Row) => String(s.birth ?? "").slice(5) === md).map((s) => {
    const a = avg.get(s.user_id);
    return { id: s.user_id as number, name: String(s.name ?? ""), age: year - Number(String(s.birth).slice(0, 4)), exams: a?.n ?? 0, avg: a?.n ? Math.round((a.sum / a.n) * 10) / 10 : null, phone: String(s.phone1 ?? ""), exam: String(s.exam ?? "") };
  }).sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1) || x.name.localeCompare(y.name, "ar"));
}

async function readers() {
  const staff = (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes(BIRTHDAY_PERM)).map((s) => Number(s.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}

/** للمؤقت: كل يوم الساعة 8 الصبح مرة وحدة، إذا أكو أعياد ميلاد */
export async function sweepBirthdays(force = false) {
  const today = todayStr();
  if (!force && (stamp().slice(11, 16) < SEND_AT || await kvGet(`birthday_sent_${today}`))) return 0;
  await kvSet(`birthday_sent_${today}`, stamp());
  const list = await birthdaysOn(today);
  if (!list.length) return 0;
  const { min } = await birthdayCfg();
  const line = (s: (typeof list)[number]) => `• ${esc(s.name)} · ${s.age} سنة · ${s.avg === null ? "بعده ما امتحن" : `معدله <b>${s.avg}</b> من ${s.exams} امتحان`}`;
  const top = list.filter((s) => s.avg !== null && s.avg >= min), rest = list.filter((s) => !(s.avg !== null && s.avg >= min));
  const text = [
    `🎂 <b>اليوم ${list.length} ${list.length === 1 ? "طالب عيد ميلاده" : "طلاب عيد ميلادهم"}</b>`,
    ...(top.length ? ["", `⭐ <b>معدلهم ${min} فما فوق (${top.length}):</b>`, ...top.map(line)] : []),
    ...(rest.length ? ["", ...(top.length ? ["<b>الباقين:</b>"] : []), ...rest.map(line)] : []),
  ].join("\n");
  const kb = [[{ text: "🎂 افتح أعياد الميلاد", web_app: { url: adminPageLink("birthdays") } }]];
  let sent = 0;
  for (const to of await readers()) { try { if (await send(to, text, { kb })) sent++; } catch (e) { console.error(e); } }
  return sent;
}

export async function birthdayAction(body: Row) {
  const uid = await authed(body?.initData, BIRTHDAY_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "save") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    await kvSet(KEY, JSON.stringify({ min: intOf(body.min, 0, 100, "اكتب معدل من 0 إلى 100") }));
    notice = "✅ انحفظ";
  } else need(a === "list", "أمر غير معروف");
  const today = todayStr();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : today;
  const days = [];
  for (let k = 0; k < 7; k++) { const d = addDays(today, k); days.push({ d, n: (await birthdaysOn(d)).length }); }
  return { date, days, list: await birthdaysOn(date), min: (await birthdayCfg()).min, owner: await isAdmin(uid), notice };
}

export const birthdaysToday = async () => (await birthdaysOn(todayStr())).length;
