// الاستعلامات المشتركة والصلاحيات
import { count, find, kvGet, kvSet, one, sumOf, update, type Row } from "./db.ts";
import { ADMIN_IDS, DEFAULT_FEE, DAYS, DAY_ORDER, ORD_AR, toLatinDigits } from "./config.ts";
import { esc, nowIQ, stamp } from "./util.ts";

// ---------- المتجر
/** الأقسام اللي بيها منتجات */
export const allCats = async () => {
  const ps = await find("products", { active: 1 });
  return (await find("cats", { active: 1 }, { order: ["id"] })).map((c) => ({ id: c.id, name: c.name, n: ps.filter((p) => p.cat_id === c.id).length }));
};
export const cats = async () => (await allCats()).filter((c) => c.n);
export const cat = async (cid: number) => await one("cats", { id: cid, active: 1 });
export async function products(cid?: number | null) {
  if (cid != null) return find("products", { active: 1, cat_id: cid }, { order: ["id"] });
  const live = new Set((await find("cats", { active: 1 })).map((c) => c.id));
  return find("products", { active: 1 }, { where: (p) => live.has(p.cat_id), order: ["id"] });
}
export async function product(pid: number) {
  const p = await one("products", { id: pid, active: 1 });
  return p && await cat(p.cat_id) ? p : null;
}
export const feeOf = async (gov: string): Promise<number> => (await one("fees", { gov }))?.fee ?? DEFAULT_FEE;
export const newOrdersCount = async (): Promise<number> => count("orders", {}, { where: (o) => !o.printed });
export async function ordersByIds(ids: number[]) {
  const rows = await Promise.all([...new Set(ids)].map((id) => one("orders", { id })));
  return rows.filter((r): r is Row => !!r).sort((a, b) => a.id - b.id);
}
export const orderItems = (o: Row): Row[] => JSON.parse(o.items);

// ---------- الصلاحيات
// «شوف كطالب»: المدير أو المساعد يجرب البوت مثل طالب عادي، بدون صلاحياته لحد ما يرجع
const realStaffRow = async (uid: number) => await one("staff", { user_id: uid });
export const isRealStaff = async (uid: number) => ADMIN_IDS.includes(uid) || await realStaffRow(uid) !== null;
export const viewingAsStudent = async (uid: number) => await kvGet(`asstudent_${uid}`) === "1";
export const setStudentView = async (uid: number, on: boolean) => await kvSet(`asstudent_${uid}`, on ? "1" : "0");
export const staffRow = async (uid: number) => (await viewingAsStudent(uid) ? null : await realStaffRow(uid));
export const isAdmin = async (uid: number) => ADMIN_IDS.includes(uid) && !await viewingAsStudent(uid);
const permList = (s: Row) => String(s.perms ?? "").split(",");
export async function can(uid: number, perm: string) {
  if (await isAdmin(uid)) return true;
  const s = await staffRow(uid);
  return !!s && permList(s).includes(perm);
}
export const isStaff = async (uid: number) => await isAdmin(uid) || await staffRow(uid) !== null;
export async function staffIds(perm: string): Promise<number[]> {
  const rows = (await find("staff")).filter((r) => permList(r).includes(perm)).map((r) => r.user_id as number);
  const out: number[] = [];
  for (const id of new Set([...ADMIN_IDS, ...rows])) if (!await viewingAsStudent(id)) out.push(id);   // اللي يجرب كطالب ما يوصله شي إداري
  return out;
}
const starts = (d: string, ...p: string[]) => p.some((x) => d.startsWith(x));
function permOf(d: string) {
  if (d === "a:menu" || d === "a:asstudent") return "any";
  if (d.startsWith("a:ex")) return "exams";
  if (starts(d, "a:sf", "a:hr", "a:grp", "a:cur", "a:lib")) return "owner";
  if (starts(d, "a:q", "a:oq")) return "q";
  if (starts(d, "a:pend", "a:t:", "a:all", "a:none", "a:pdf", "a:done", "a:keep", "a:printed", "a:un:", "a:v:", "a:pos", "a:ps", "a:of")) return "orders";
  if (starts(d, "a:st", "a:sv", "a:sc", "a:se", "a:ce", "a:ca", "a:cc", "a:cd", "a:na", "a:nc2", "a:gm", "a:5th", "a:stall", "a:ad", "a:sg", "a:sx", "a:sw")) return "students";
  return "products";
}
export async function allowed(uid: number, d: string) {
  const p = permOf(d);
  if (p === "any") return await isStaff(uid);
  if (p === "owner") return await isAdmin(uid);
  return await can(uid, p);
}

// ---------- حد المحاولات الغلط للرموز (5 بالساعة لكل حساب)
const FAIL_MAX = 5, FAIL_WINDOW_S = 3600;
async function fails(kind: string, uid: number) {
  const [n, ts] = (await kvGet(`${kind}_${uid}`) ?? "0:0").split(":").map(Number);
  return Date.now() / 1000 - ts < FAIL_WINDOW_S ? n : 0;
}
export const tooManyFails = async (kind: string, uid: number) => await fails(kind, uid) >= FAIL_MAX;
export async function noteFail(kind: string, uid: number) {
  await kvSet(`${kind}_${uid}`, `${await fails(kind, uid) + 1}:${Math.floor(Date.now() / 1000)}`);
}

// ---------- الطلاب والمراكز
export const student = async (uid: number) => await one("students", { user_id: uid });
/** زر امتحاناتي يطلع بس للي عنده امتحانات مفتوحة، أو طلب جاهز ينتظر الكود */
export const hasExamMenu = async (uid: number) => !!await one("exam_access", { user_id: uid }) || (await pendingCodes(uid)).length > 0;
/** الطلبات الجاهزة اللي رمزها لسه ما انستخدم */
export async function pendingCodes(uid: number) {
  const out: Row[] = [];
  const s = await student(uid);   // طلب قبل حذف تسجيله ما يفتح شي
  for (const o of await find("orders", { user_id: uid, printed: 1 }, { where: (r) => !s || String(r.created) >= String(s.created), order: ["id"] })) if (await one("order_codes", { order_id: o.id, used_at: null })) out.push(o);
  return out;
}
export async function centerName(cid: number | null | undefined) {
  if (!cid) return "";
  const c = await one("centers", { id: cid });
  const a = c && await one("areas", { id: c.area_id });
  return a ? `${c!.name} (${a.name})` : "";
}
export const govMode = async (gov: string): Promise<string> => (await one("govmode", { gov }))?.mode ?? "online";
export const placeOf = (s: Row) => s.gov + (s.side ? " - " + s.side : "");
export async function profileText(s: Row) {
  const lines = [`الاسم: <b>${esc(s.name)}</b>`, `المنهج: ${esc(s.curr)}`, `صفك بالمدرسة هذه السنة: ${esc(s.grade)}`,
    `المحافظة: ${esc(placeOf(s))}`, `العنوان: ${esc(s.area)}`,
    `الهاتف 1: ${esc(s.phone1)}`, `الهاتف 2: ${esc(s.phone2)}`, `الامتحان: ${esc(s.exam ?? "")}`];
  if (s.exam === "حضوري") lines.push(`المركز الامتحاني: ${esc(await centerName(s.center_id) || "—")}`);
  return lines.join("\n");
}
/** المناطق اللي بيها مراكز شغالة */
export async function areasWithCenters() {
  const used = new Set((await find("centers", { active: 1 })).map((c) => c.area_id));
  return find("areas", { active: 1 }, { where: (a) => used.has(a.id), order: ["gov", "id"] });
}
export async function centerAreas(gov: string) {
  const rows = await areasWithCenters();
  const mine = rows.filter((a) => a.gov === gov);
  return mine.length ? mine.sort((a, b) => a.id - b.id) : rows;
}
export async function examLabel(sid: number) {
  const st = await student(sid) ?? {};
  if (st.exam === "حضوري") return "حضوري — " + (await centerName(st.center_id) || "بدون مركز");
  return st.exam || "—";
}
export function checkPhone(raw: string): [string | null, string | null] {
  const t = raw.replace(/ /g, "").replace(/-/g, "");
  if (/[٠-٩۰-۹]/.test(t)) return [null, "⚠️ اكتب الرقم <b>بالأرقام الإنجليزية</b> مو العربية.\nمثال: <code>07701234567</code>"];
  if (!/^07\d{9}$/.test(t)) return [null, "⚠️ الرقم غير صحيح. لازم يكون 11 رقم ويبدأ بـ 07 وبالإنجليزي.\nمثال: <code>07701234567</code>"];
  return [t, null];
}

// ---------- الأسئلة
export const chapters = async () => await find("chapters", { active: 1 }, { order: ["ord"] });
export const topics = async (chid: number) => await find("topics", { active: 1, chapter_id: chid }, { order: ["ord"] });
export async function topic(tid: number): Promise<Row | null> {
  const t = await one("topics", { id: tid });
  const c = t && await one("chapters", { id: t.chapter_id });
  return c ? { ...t, char: c.ar, chen: c.en, chord: c.ord } : null;
}
export const question = async (qid: number) => await one("questions", { id: qid });
export async function setQ(qid: number, fields: Record<string, string | number | null>) {
  await update("questions", { id: qid }, { ...fields, updated: stamp() });
}
export function chLabel(ch: Row, en: boolean) {
  if (en) return `Chapter ${ch.ord}: ${ch.en || ch.ar}`;
  return `الفصل ${ch.ord <= 10 ? ORD_AR[ch.ord - 1] : ch.ord}: ${ch.ar}`;
}
export async function qWhere(q: Row, en = false) {
  const t = await topic(q.topic_id);
  if (!t) return "—";
  const lec = q.lecture ? (en ? ` — Lecture ${q.lecture}` : ` — المحاضرة ${q.lecture}`) : "";
  return en ? `Ch${t.chord} › ${t.en || t.ar}${lec}` : `ف${t.chord} › ${t.ar}${lec}`;
}
export async function groupId() {
  const g = await kvGet("q_group");
  return g ? Number(g) : null;
}
export type Hours = { on?: boolean; days: number[]; from: string; to: string };
export async function qHours(): Promise<Hours> {
  let h: Hours | null = null;
  try { h = JSON.parse(await kvGet("q_hours") || ""); } catch { /* الافتراضي */ }
  return h || { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" };
}
export function hoursText(h: Hours) {
  const days = DAY_ORDER.filter((i) => h.days.includes(i)).map((i) => DAYS[i]).join("، ") || "لا يوجد";
  return `الأيام: ${days}\nالوقت: من ${h.from} إلى ${h.to}`;
}
export async function qOpenNow() {
  const h = await qHours();
  if (h.on === false) return false;
  const t = nowIQ();
  if (!h.days.includes((t.getUTCDay() + 6) % 7)) return false;
  const cur = t.toISOString().slice(11, 16);
  return h.from <= h.to ? h.from <= cur && cur <= h.to : cur >= h.from || cur <= h.to;
}

// ---------- المكتبات والمساعدين
export async function myOffice(uid: number) {
  if (await viewingAsStudent(uid)) return null;
  const u = await one("office_users", { user_id: uid });
  return u && await one("offices", { id: u.office_id, active: 1 });
}
export const office = async (oid: number) => await one("offices", { id: oid });
export async function officeUnsettled(oid: number) {
  const rows = await find("orders", { printed: 3, office_id: oid, settle_id: null });
  return { n: rows.length, total: sumOf(rows, "total") };
}
export async function staffName(uid: number | null | undefined) {
  if (uid != null && await isAdmin(uid)) return "قصي العميري";
  if (uid == null) return "مساعد";
  const u = await one("office_users", { user_id: uid });
  const of = u && await one("offices", { id: u.office_id });
  if (of) return u!.name ? `${of.name} (${u!.name})` : of.name;
  return (await one("staff", { user_id: uid }))?.name || "مساعد";
}
/** البائع بالوصل: اسم المكتبة بس، أو اسمك */
export async function sellerLabel(o: Row) {
  if (o.office_id) {
    const of = await office(o.office_id);
    if (of) return of.name;
  }
  return !o.seller || await isAdmin(o.seller) ? "قصي العميري" : await staffName(o.seller);
}
/** ذمة المساعد = مبيعاته بالمكتب − اللي سلمه إلك */
export async function staffAccount(sid: number) {
  // بيع المكتبة حسابه ويا المكتبة، واللي قبل ما ينضاف مساعد ما ينحسب عليه
  const since = await kvGet(`staff_since_${sid}`) ?? "";
  const sold = sumOf(await find("orders", { printed: 3, seller: sid }, { where: (o) => o.office_id === null && String(o.created) >= since }), "total");
  const paid = sumOf(await find("staff_pay", { staff_id: sid }, { where: (p) => String(p.created) >= since }), "amount");
  const limit = Number(await kvGet(`limit_${sid}`) || 0);
  const owed = sold - paid;
  return { sold, paid, owed, limit, left: limit ? limit - owed : 0 };
}
export async function searchStudents(q: string) {
  const s = toLatinDigits(q.trim()).toLowerCase();
  const has = (v: unknown) => v !== null && String(v).toLowerCase().includes(s);
  return find("students", {}, { where: (r) => has(r.name) || has(r.phone1) || has(r.phone2), order: ["name"], limit: 15 });
}
