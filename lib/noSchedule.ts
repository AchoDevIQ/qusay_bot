// «⏳ ما سووا جدول» (طلب الأستاذ 2026-11-20): الطالب اللي اشترى امتحانات وما سوى جدوله، أو جدول تعويضه،
// كلشي يبقى مقفول عليه لحد ما يسويه (حتى المحاضرات بالتطبيق). كل يوم يوصله تذكير، وصاحب البوت (والمساعد اللي
// عنده صلاحية «تسجيلات الفصول») يوصله تنبيه بأسمائهم، ويا صفحة بيها أرقامهم وواتساب ولي الأمر وتليگرامهم حتى يراسلونهم
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, one } from "./db.ts";
import { adminPageLink } from "./keyboards.ts";
import { whatsappOf } from "./guardianWatch.ts";
import { send } from "./telegram.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { MAKEUP_PERM } from "./makeup.ts";

export type Waiting = { uid: number; name: string; phone: string; phone2: string; wa: string; tg: string; username: string; chapters: string[]; since: string; why: "none" | "late"; late: number };
const REMIND_AT = "10:00";
const DAY_KEY = "nosched_day";

/** كل طالب اشترى امتحانات وبعده ما سوى جدوله، أو جدول تعويضه */
export async function waitingSchedule(): Promise<Waiting[]> {
  const { scheduleChapters, schedSettings, lateFor } = await import("./schedApi.ts");
  const s = await schedSettings();
  const ids = new Set<number>([
    ...(await find("exam_access")).map((r) => Number(r.user_id)),
    ...(await find("orders", {}, { where: (o) => o.printed === 1 || o.printed === 3 })).map((o) => Number(o.user_id ?? 0)),
  ].filter((u) => u > 0));
  const scheds = new Map((await find("schedules")).map((x) => [Number(x.user_id), x]));
  const access = await find("exam_access");
  const out: Waiting[] = [];
  for (const uid of ids) {
    const st = await one("students", { user_id: uid });
    if (!st) continue;
    const sc = scheds.get(uid);
    let why: Waiting["why"] | null = null, late = 0;
    if (!sc) { if ((await scheduleChapters(uid)).length) why = "none"; }
    else if (sc.mode === "general") { late = (await lateFor(uid, sc, s)).length; if (late) why = "late"; }
    if (!why) continue;
    const chapters = await scheduleChapters(uid);
    const since = access.filter((r) => Number(r.user_id) === uid).map((r) => String(r.created ?? "")).filter((x) => /^\d{4}-\d\d-\d\d/.test(x)).sort()[0] ?? String(st.created ?? "");
    const username = String(st.username ?? "").replace(/^@/, "");
    out.push({ uid, name: String(st.name ?? `#${uid}`), phone: String(st.phone1 ?? ""), phone2: String(st.phone2 ?? ""), wa: whatsappOf(st.phone2) ?? "", tg: username ? `https://t.me/${username}` : `tg://user?id=${uid}`, username, chapters, since: since.slice(0, 16), why, late });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

async function readers() {
  const staff = (await find("staff")).filter((x) => String(x.perms ?? "").split(",").includes(MAKEUP_PERM)).map((x) => Number(x.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}

/** للمؤقت: مرة باليوم الصبح. الطالب يوصله تذكير، والإدارة توصلها القائمة */
export async function noScheduleTick(force = false) {
  const today = todayStr();
  if (!force && (stamp().slice(11, 16) < REMIND_AT || await kvGet(DAY_KEY) === today)) return 0;
  await kvSet(DAY_KEY, today);
  const list = await waitingSchedule();
  if (!list.length) return 0;
  for (const w of list) {
    const kbStudent = [[{ text: "🗓 رتب جدولك", web_app: { url: adminPageLink("myexams", w.uid) } }]];
    const text = w.why === "late"
      ? `⏳ <b>بعدك ما سويت جدول تعويضك</b>\nعندك ${w.late} امتحان فاتك قبل ما تسجل. افتح «📝 امتحاناتي» واختار أيامك، وكلشي مقفول عليك لحد ما تسويه.`
      : `⏳ <b>بعدك ما رتبت جدول امتحاناتك</b>\nافتح «📝 امتحاناتي» واختار أوقاتك. كلشي مقفول عليك، حتى المحاضرات، لحد ما ترتبه.`;
    try { await send(w.uid, text, { kb: kbStudent }); } catch (e) { console.error(e); }
  }
  const lines = list.slice(0, 30).map((w) => `👤 <b>${esc(w.name)}</b> · ${w.why === "late" ? `تعويض ${w.late} امتحان` : "ما رتب جدوله"}\n📞 ${esc(w.phone || "ماكو رقم")}${w.phone2 ? ` · ولي الأمر ${esc(w.phone2)}` : ""}`);
  const text = [`⏳ <b>${list.length} طالب اشتروا امتحانات وما سووا جدول</b>`, "راسلهم حتى يسوونه. أرقامهم وواتساب أولياء أمورهم بالصفحة.", "", ...lines, list.length > 30 ? `\n… و${list.length - 30} غيرهم بالصفحة` : ""].filter((x) => x !== "").join("\n\n");
  const kb = [[{ text: "⏳ افتح القائمة", web_app: { url: adminPageLink("signups") } }]];
  for (const to of await readers()) { try { await send(to, text, { kb }); } catch (e) { console.error(e); } }
  return list.length;
}
