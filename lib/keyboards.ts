// لوحات الأزرار وروابط صفحات المتجر (البيانات تنضغط داخل الرابط)
import { all, kvGet, type Row } from "./db.ts";
import { BTN_ADMIN, BTN_ASK, BTN_CANCEL, BTN_EXAMS, BTN_EXIT_VIEW, BTN_ME, BTN_MYQ, BTN_OFFICE, BTN_OPEN, BTN_REG, BTN_SCAN, BTN_SHOP, GOVS, STORE_URL } from "./config.ts";
import { can, cats, centerName, feeOf, hasExamMenu, isRealStaff, isStaff, myOffice, newOrdersCount, products, student, viewingAsStudent } from "./data.ts";
import { b64urlEncode, btn, chunk } from "./util.ts";

export function chapterLabel(name: string | null | undefined) {
  const m = (name ?? "").match(/الفصل\s+(ال\S+(?:\s+و\S+)?)/);
  return m ? "الفصل " + m[1] : null;
}
export async function onlineOnly(): Promise<string[]> {
  try { return JSON.parse(await kvGet("online_only") || "[]"); } catch { return []; }
}
async function modeOk(p: Row, s: Row | null) {
  const m = p.mode || "both";
  if (m === "both" || !s || !s.exam) return true;
  const label = chapterLabel(p.name);
  if (s.exam === "حضوري" && label !== null && (await onlineOnly()).includes(label)) return m !== "in"; // الفصل خلص حضوري: يشوف الإلكتروني بداله
  return (m === "in") === (s.exam === "حضوري");
}

/** عنوان الموقع بدون مسار (صفحات المتجر داخل نفس تطبيق Next.js) */
export function siteBase() {
  return STORE_URL.split("?")[0].replace(/\/+$/, "").replace(/\/store$/, "");
}
// v= رقم يتغير حتى التليجرام ما يفتح نسخة قديمة محفوظة من الصفحة
const pageUrl = (page: string, d: unknown) => `${siteBase()}${page}?v=${Math.floor(Date.now() / 1000)}&d=${b64urlEncode(d)}`;

export async function storeLink(uid?: number) {
  const s = uid ? await student(uid) : null;
  const c: unknown[][] = [];
  for (const ct of await cats()) {
    const ps: unknown[][] = [];
    for (const p of await products(ct.id)) if (await modeOk(p, s)) ps.push([p.id, p.name, p.price]);
    if (ps.length) c.push([ct.name, ps]);
  }
  const d: Row = { c, g: GOVS, f: await Promise.all(GOVS.map(feeOf)) };
  if (s?.exam === "حضوري") {
    const oo = await onlineOnly();
    const labels = [...new Set(c.flatMap((ct) => (ct[1] as unknown[][]).map((p) => chapterLabel(p[1] as string))))]
      .filter((l): l is string => l !== null && oo.includes(l)).sort();
    if (labels.length) d.w = labels;
  }
  if (s) d.p = { n: s.name, cu: s.curr, g: s.gov, s: s.side || "", a: s.area, p1: s.phone1, p2: s.phone2 };
  return pageUrl("/store", d);
}
export const storeKb = async (uid?: number) => ({
  keyboard: [[{ text: BTN_OPEN, web_app: { url: await storeLink(uid) } }], [{ text: BTN_CANCEL }]], resize_keyboard: true,
});

export async function regLink(uid: number, adminFor?: number | null) {
  const modes = Object.fromEntries((await all("SELECT * FROM govmode")).map((r) => [r.gov, r.mode]));
  const areas = await Promise.all((await all(`SELECT * FROM areas WHERE active=1
    AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1) ORDER BY gov, id`)).map(async (a) => [a.id, a.gov, a.name,
    (await all("SELECT * FROM centers WHERE area_id=? AND active=1 ORDER BY id", a.id)).map((x) => [x.id, x.name])]));
  const d: Row = { g: GOVS, m: GOVS.map((g) => modes[g] ?? "online"), a: areas };
  const s = await student(adminFor || uid);
  if (s) d.p = { n: s.name, cu: s.curr, gr: s.grade, g: s.gov, s: s.side || "", a: s.area, p1: s.phone1, p2: s.phone2, e: s.exam || "", c: s.center_id || 0 };
  if (adminFor) d.adm = adminFor;
  else if (s?.exam) d.x = { gr: s.grade || "", e: s.exam, c: s.exam === "حضوري" ? await centerName(s.center_id) : "" };
  return pageUrl("/store/reg", d);
}
export const regKb = async (uid: number, adminFor?: number | null) => ({
  keyboard: [[{ text: adminFor ? "✏️ افتح فورمة الطالب" : BTN_REG, web_app: { url: await regLink(uid, adminFor) } }], [{ text: BTN_CANCEL }]],
  resize_keyboard: true,
});

export async function posLink(sid: number) {
  const s = await student(sid) ?? {};
  const c: unknown[][] = [];
  for (const ct of await cats()) {
    const ps = (await products(ct.id)).map((p) => [p.id, p.name, p.price]);
    if (ps.length) c.push([ct.name, ps]);
  }
  return pageUrl("/store/pos", { c, s: { id: sid, n: s.name ?? "", p: s.phone1 ?? "", g: `${s.grade ?? ""} — ${s.curr ?? ""}` } });
}
export const posKb = async (sid: number) => ({
  keyboard: [[{ text: "🏪 افتح صفحة البيع", web_app: { url: await posLink(sid) } }], [{ text: BTN_CANCEL }]], resize_keyboard: true,
});

export const examsPageLink = () => `${siteBase()}/store/exams?v=${Math.floor(Date.now() / 1000)}`;
export const scanKb = (oid: number) => ({
  keyboard: [[{ text: BTN_SCAN, web_app: { url: pageUrl("/store/scan", { o: oid }) } }], [{ text: BTN_CANCEL }]], resize_keyboard: true,
});

export async function mainKb(uid: number) {
  const rows: { text: string }[][] = [[{ text: BTN_SHOP }, { text: BTN_ASK }], [{ text: BTN_MYQ }, { text: BTN_ME }]];
  if (await hasExamMenu(uid)) rows.push([{ text: BTN_EXAMS }]);
  if (await isStaff(uid)) {
    const n = await can(uid, "orders") ? await newOrdersCount() : 0;
    rows.push([{ text: BTN_ADMIN + (n ? `  🔴 ${n}` : "") }]);
  } else if (await myOffice(uid)) rows.push([{ text: BTN_OFFICE }]);
  if (await viewingAsStudent(uid) && await isRealStaff(uid)) rows.push([{ text: BTN_EXIT_VIEW }]);
  return { keyboard: rows, resize_keyboard: true };
}
export const flowKb = () => ({ keyboard: [[{ text: BTN_CANCEL }]], resize_keyboard: true });
export const govKb = (prefix = "gov:") => chunk(GOVS.map((g, i) => btn(g, prefix + i)), 3);
