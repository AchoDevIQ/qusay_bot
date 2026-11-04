// الاستعلامات المشتركة والصلاحيات
import { all, get, kvGet, kvSet, run, type Row } from "./db.ts";
import { ADMIN_IDS, DEFAULT_FEE, DAYS, DAY_ORDER, ORD_AR, toLatinDigits } from "./config.ts";
import { esc, nowIQ, stamp } from "./util.ts";

// ---------- المتجر
/** الأقسام اللي بيها منتجات */
export const cats = async () => await all(`SELECT cats.id, cats.name, COUNT(products.id) n FROM cats
  JOIN products ON products.cat_id=cats.id AND products.active=1
  WHERE cats.active=1 GROUP BY cats.id ORDER BY cats.id`);
export const allCats = async () => await all(`SELECT cats.id, cats.name, COUNT(products.id) n FROM cats
  LEFT JOIN products ON products.cat_id=cats.id AND products.active=1
  WHERE cats.active=1 GROUP BY cats.id ORDER BY cats.id`);
export const cat = async (cid: number) => await get("SELECT * FROM cats WHERE id=? AND active=1", cid);
export const products = async (cid?: number | null) => cid == null
  ? await all(`SELECT products.* FROM products JOIN cats ON cats.id=products.cat_id AND cats.active=1
         WHERE products.active=1 ORDER BY products.id`)
  : await all("SELECT * FROM products WHERE active=1 AND cat_id=? ORDER BY id", cid);
export const product = async (pid: number) => await get(`SELECT products.* FROM products JOIN cats ON cats.id=products.cat_id AND cats.active=1
  WHERE products.id=? AND products.active=1`, pid);
export const feeOf = async (gov: string): Promise<number> => (await get("SELECT fee FROM fees WHERE gov=?", gov))?.fee ?? DEFAULT_FEE;
export const newOrdersCount = async (): Promise<number> => (await get("SELECT COUNT(*) n FROM orders WHERE IFNULL(printed,0)=0"))!.n;
export const orderItems = (o: Row): Row[] => JSON.parse(o.items);

// ---------- الصلاحيات
// «شوف كطالب»: المدير أو المساعد يجرب البوت مثل طالب عادي، بدون صلاحياته لحد ما يرجع
const realStaffRow = async (uid: number) => await get("SELECT * FROM staff WHERE user_id=?", uid);
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
  const rows = (await all("SELECT user_id, perms FROM staff")).filter((r) => permList(r).includes(perm)).map((r) => r.user_id as number);
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
export const student = async (uid: number) => await get("SELECT * FROM students WHERE user_id=?", uid);
/** زر امتحاناتي يطلع بس للي عنده امتحانات مفتوحة، أو طلب جاهز ينتظر الكود */
export const hasExamMenu = async (uid: number) => !!await get(`SELECT 1 WHERE EXISTS(SELECT 1 FROM exam_access WHERE user_id=?)
  OR EXISTS(SELECT 1 FROM order_codes JOIN orders ON orders.id=order_codes.order_id WHERE orders.user_id=? AND orders.printed=1 AND order_codes.used_at IS NULL)`, uid, uid);
export async function centerName(cid: number | null | undefined) {
  if (!cid) return "";
  const r = await get("SELECT centers.name cn, areas.name an FROM centers JOIN areas ON areas.id=centers.area_id WHERE centers.id=?", cid);
  return r ? `${r.cn} (${r.an})` : "";
}
export const govMode = async (gov: string): Promise<string> => (await get("SELECT mode FROM govmode WHERE gov=?", gov))?.mode ?? "online";
export const placeOf = (s: Row) => s.gov + (s.side ? " - " + s.side : "");
export async function profileText(s: Row) {
  const lines = [`الاسم: <b>${esc(s.name)}</b>`, `المنهج: ${esc(s.curr)}`, `صفك بالمدرسة هذه السنة: ${esc(s.grade)}`,
    `المحافظة: ${esc(placeOf(s))}`, `العنوان: ${esc(s.area)}`,
    `الهاتف 1: ${esc(s.phone1)}`, `الهاتف 2: ${esc(s.phone2)}`, `الامتحان: ${esc(s.exam ?? "")}`];
  if (s.exam === "حضوري") lines.push(`المركز الامتحاني: ${esc(await centerName(s.center_id) || "—")}`);
  return lines.join("\n");
}
export async function centerAreas(gov: string) {
  const rows = await all(`SELECT areas.* FROM areas WHERE active=1 AND gov=? AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1)
    ORDER BY id`, gov);
  return rows.length ? rows : await all(`SELECT areas.* FROM areas WHERE active=1
    AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1) ORDER BY gov, id`);
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
export const chapters = async () => await all("SELECT * FROM chapters WHERE active=1 ORDER BY ord");
export const topics = async (chid: number) => await all("SELECT * FROM topics WHERE active=1 AND chapter_id=? ORDER BY ord", chid);
export const topic = async (tid: number) => await get(`SELECT topics.*, chapters.ar char, chapters.en chen, chapters.ord chord
  FROM topics JOIN chapters ON chapters.id=topics.chapter_id WHERE topics.id=?`, tid);
export const question = async (qid: number) => await get("SELECT * FROM questions WHERE id=?", qid);
export async function setQ(qid: number, fields: Record<string, string | number | null>) {
  const kw = { ...fields, updated: stamp() };
  await run(`UPDATE questions SET ${Object.keys(kw).map((k) => k + "=?").join(",")} WHERE id=?`, ...Object.values(kw), qid);
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
export const myOffice = async (uid: number) => (await viewingAsStudent(uid) ? null : await get(`SELECT offices.* FROM office_users JOIN offices ON offices.id=office_users.office_id
  WHERE office_users.user_id=? AND offices.active=1`, uid));
export const office = async (oid: number) => await get("SELECT * FROM offices WHERE id=?", oid);
export async function officeUnsettled(oid: number) {
  const r = (await get("SELECT COUNT(*) n, IFNULL(SUM(total),0) t FROM orders WHERE printed=3 AND office_id=? AND settle_id IS NULL", oid))!;
  return { n: r.n as number, total: r.t as number };
}
export async function staffName(uid: number | null | undefined) {
  if (uid != null && await isAdmin(uid)) return "قصي العميري";
  const u = await get(`SELECT office_users.name un, offices.name onm FROM office_users JOIN offices ON offices.id=office_users.office_id
    WHERE user_id=?`, uid ?? null);
  if (u) return u.un ? `${u.onm} (${u.un})` : u.onm;
  return (await get("SELECT name FROM staff WHERE user_id=?", uid ?? null))?.name || "مساعد";
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
  const sold: number = (await get("SELECT IFNULL(SUM(total),0) n FROM orders WHERE printed=3 AND seller=?", sid))!.n;
  const paid: number = (await get("SELECT IFNULL(SUM(amount),0) n FROM staff_pay WHERE staff_id=?", sid))!.n;
  const limit = Number(await kvGet(`limit_${sid}`) || 0);
  const owed = sold - paid;
  return { sold, paid, owed, limit, left: limit ? limit - owed : 0 };
}
export async function searchStudents(q: string) {
  const s = "%" + toLatinDigits(q.trim()) + "%";
  return await all("SELECT * FROM students WHERE name LIKE ? OR phone1 LIKE ? OR phone2 LIKE ? ORDER BY name LIMIT 15", s, s, s);
}
