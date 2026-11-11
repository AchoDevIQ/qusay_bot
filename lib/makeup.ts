// الفصل التعويضي: فصل بدينا بيه، وبعدها طلاب يسجلون متأخرين فيحتاجون جدول تعويضي.
// صاحب البوت يأشر الفصل «تعويضي»، ومن بعدها كل طالب يشتري امتحانات هذا الفصل (امتحانات، لو محاضرات وامتحانات) يطلع بقائمة
// بيها اسمه وتليفونه وتليگرامه حتى يتصلون بيه:
// - من المكتبة/المكتب: يوصل تنبيه وقت البيع.
// - من التوصيل: ثاني يوم من تجهيز الطلب يوصل تقرير بأسمائهم، وياهو فعّل الكود وياهو بعد ما فعّل.
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { chaptersOf } from "./exams.ts";
import { adminPageLink } from "./keyboards.ts";
import { send } from "./telegram.ts";
import { esc, stamp, todayStr } from "./util.ts";

const KEY = "makeup_chapters";
const REPORTED = "makeup_reported";
const REPORT_AT = "09:00";
export const MAKEUP_PERM = "signups";

/** الفصول التعويضية: الفصل ← من وكت صار تعويضي */
export async function makeupChapters(): Promise<Record<string, string>> {
  try { const j = JSON.parse(await kvGet(KEY) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; }
}
export async function setMakeup(chapter: string, on: boolean) {
  const m = await makeupChapters();
  if (on) m[chapter] = m[chapter] ?? stamp(); else delete m[chapter];
  await kvSet(KEY, JSON.stringify(m));
}
/** منو يوصله التنبيه: صاحب البوت والمساعدين اللي عندهم صلاحية تسجيلات الفصول */
async function readers() {
  const staff = (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes(MAKEUP_PERM)).map((s) => Number(s.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}
const itemsOf = (o: Row): Row[] => { try { const j = JSON.parse(String(o.items ?? "[]")); return Array.isArray(j) ? j : []; } catch { return []; } };

export type LateBuyer = { oid: number; uid: number; name: string; phone: string; phone2: string; username: string; source: string; library: boolean; at: string; activated: boolean; chapters: string[] };

/** طالب واحد من طلب واحد، إذا الطلب بيه فصل تعويضي اشتراه بعد ما صار تعويضي */
async function buyerOf(o: Row, m: Record<string, string>): Promise<LateBuyer | null> {
  const library = Number(o.printed) === 3;
  // اشترى بعد ما صار الفصل تعويضي (وقت الطلب). والتاريخ اللي يطلع: يوم البيع، أو يوم تجهيز طلب التوصيل
  const bought = String(o.created ?? "");
  const at = String((library ? o.created : o.printed_at ?? o.created) ?? "");
  const chapters = chaptersOf(itemsOf(o)).filter((c) => m[c] && bought >= m[c]);
  if (!chapters.length) return null;
  const st = o.user_id ? await one("students", { user_id: o.user_id }) : null;
  const office = o.office_id ? await one("offices", { id: o.office_id }) : null;
  const code = library ? null : await one("order_codes", { order_id: o.id });
  return {
    oid: o.id as number, uid: Number(o.user_id ?? 0), name: String(st?.name ?? o.name ?? `#${o.user_id}`),
    phone: String(o.phone1 ?? st?.phone1 ?? ""), phone2: String(o.phone2 ?? st?.phone2 ?? ""), username: String(o.username ?? st?.username ?? "").replace(/^@/, ""),
    source: library ? (office ? `🏬 ${office.name}` : "🏪 المكتب") : "🚚 توصيل", library, at,
    // المكتبة تفتح الفصل وقت البيع. التوصيل ينفتح لمن الطالب يفعّل الكود اللي بالوصل
    activated: library || !!code?.used_at, chapters,
  };
}
/** كل اللي اشتروا فصول تعويضية: بيع المكتبة/المكتب، وطلبات التوصيل اللي تجهزت */
export async function lateBuyers(): Promise<LateBuyer[]> {
  const m = await makeupChapters();
  if (!Object.keys(m).length) return [];
  const out: LateBuyer[] = [];
  for (const o of await find("orders", {}, { where: (r) => Number(r.printed) === 3 || Number(r.printed) === 1 })) {
    const b = await buyerOf(o, m);
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const tgLink = (b: LateBuyer) => (b.username ? `https://t.me/${b.username}` : b.uid ? `tg://user?id=${b.uid}` : "");
function line(b: LateBuyer) {
  const tg = tgLink(b);
  return [
    `👤 <b>${esc(b.name)}</b>${b.library ? "" : b.activated ? " · ✅ فعّل الكود" : " · ⏳ بعده ما فعّل"}`,
    `📞 ${esc(b.phone || "ماكو رقم")}${b.phone2 ? ` · ${esc(b.phone2)}` : ""}`,
    tg ? `✈️ <a href="${tg}">${b.username ? "@" + esc(b.username) : "حسابه بالتليگرام"}</a>` : "",
    `📘 ${b.chapters.map(esc).join("، ")} · ${b.source}`,
  ].filter(Boolean).join("\n");
}
const kb = () => [[{ text: "🔁 افتح الفصول التعويضية", web_app: { url: adminPageLink("signups") } }]];
async function tell(text: string) {
  for (const to of await readers()) { try { await send(to, text, { kb: kb() }); } catch (e) { console.error(e); } }
}
async function reported(): Promise<number[]> { try { const j = JSON.parse(await kvGet(REPORTED) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } }

/** بيع المكتبة/المكتب: التنبيه وقت البيع */
export async function notifyMakeupSale(oid: number) {
  try {
    const o = await one("orders", { id: oid });
    if (!o) return false;
    const b = await buyerOf({ ...o, printed: 3 }, await makeupChapters());
    if (!b) return false;
    await kvSet(REPORTED, JSON.stringify([...await reported(), oid]));
    await tell(`🔁 <b>طالب سجل بفصل تعويضي</b>\nاتصل بيه حتى تسويله جدول تعويضي.\n\n${line(b)}`);
    return true;
  } catch (e) { console.error(e); return false; }
}

/** للمؤقت: كل يوم الصبح، طلبات التوصيل اللي تجهزت قبل اليوم وبيها فصل تعويضي، مرة وحدة لكل طلب */
export async function sweepMakeup(force = false) {
  const today = todayStr();
  if (!force && stamp().slice(11, 16) < REPORT_AT) return 0;
  const done = new Set(await reported());
  const list = (await lateBuyers()).filter((b) => !b.library && !done.has(b.oid) && b.at.slice(0, 10) < today);
  if (!list.length) return 0;
  await kvSet(REPORTED, JSON.stringify([...done, ...list.map((b) => b.oid)]));
  const on = list.filter((b) => b.activated), off = list.filter((b) => !b.activated);
  const part = (title: string, l: LateBuyer[]) => (l.length ? [`<b>${title} (${l.length})</b>`, ...l.map(line)].join("\n\n") : "");
  await tell([`🔁 <b>طلاب التوصيل بالفصول التعويضية</b>`, "طلباتهم تجهزت. اتصل بيهم حتى تسويلهم جدول تعويضي.", part("✅ فعّلوا الكود", on), part("⏳ بعدهم ما فعّلوا", off)].filter(Boolean).join("\n\n"));
  return list.length;
}
