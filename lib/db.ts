// قاعدة البيانات: Firestore إذا اكو FIREBASE_PROJECT_ID، وإلا SQLite على الحاسبة.
// البحث والترتيب والتعديل هنا، فالبوت يتصرف نفس الشي على القاعدتين
import { DEFAULT_FEE, GOVS, SEED_CENTERS, SEED_CURRIC, toLatinDigits } from "./config.ts";
import { firestore } from "./firebase.ts";
import { firestoreDriver, type FirestoreLike } from "./firestoreDriver.ts";
import { keyOf } from "./schema.ts";
import type { Driver, Row } from "./types.ts";

export type { Row } from "./types.ts";

let _driver: Driver | null = null;
async function driver(): Promise<Driver> {
  if (_driver) return _driver;
  // SQLite ينحمل بس إذا احتجناه، لأن السيرفر ما يستخدمه
  _driver = process.env.FIREBASE_PROJECT_ID?.trim()
    ? firestoreDriver(firestore as unknown as () => FirestoreLike)
    : (await import("./sqliteDriver.ts")).sqliteDriver;
  return _driver;
}
/** تبديل القاعدة بالفحوصات */
export const setDriver = (d: Driver | null) => { _driver = d; };

type Opts = {
  /** شرط إضافي يتفحص هنا، للي ما ينكتب بمطابقة مباشرة */
  where?: (r: Row) => boolean;
  /** أسماء أعمدة، والـ - قبل الاسم يعني من الأكبر للأصغر */
  order?: string[];
  limit?: number;
};
const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number) < (b as number) ? -1 : 1;
};
/** رقم غلط من زر مزور ما يطابق شي */
const badEq = (eq: Row) => Object.values(eq).some((v) => v === undefined || (typeof v === "number" && Number.isNaN(v)));

export async function find(table: string, eq: Row = {}, o: Opts = {}): Promise<Row[]> {
  if (badEq(eq)) return [];
  let rows = await (await driver()).list(table, eq);
  if (o.where) rows = rows.filter(o.where);
  if (o.order) {
    const keys = o.order.map((k) => (k.startsWith("-") ? [k.slice(1), -1] as const : [k, 1] as const));
    rows = [...rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const c = cmp(a[k], b[k]);
        if (c) return c * dir;
      }
      return 0;
    });
  }
  return o.limit === undefined ? rows : rows.slice(0, o.limit);
}
export const one = async (table: string, eq: Row = {}, o: Opts = {}): Promise<Row | null> => (await find(table, eq, { ...o, limit: 1 }))[0] ?? null;
export const count = async (table: string, eq: Row = {}, o: Opts = {}) => (await find(table, eq, o)).length;
export const sumOf = (rows: Row[], col: string) => rows.reduce((s, r) => s + (r[col] ?? 0), 0);
export const maxOf = (rows: Row[], col: string) => rows.reduce((m, r) => Math.max(m, r[col] ?? 0), 0);

/** يضيف صف ويرجع رقمه */
export const insert = async (table: string, row: Row) => (await driver()).insert(table, row);
/** يضيف الصف أو يبدله كله */
export const put = async (table: string, row: Row) => (await driver()).put(table, row);
/** يضيف الصف إذا مفتاحه مو موجود */
export async function insertIgnore(table: string, keys: Row, rest: Row = {}) {
  await tx(async () => { if (!await one(table, keys)) await insert(table, { ...keys, ...rest }); });
}
/** يعدل الصفوف المطابقة ويرجع عددها */
export async function update(table: string, eq: Row, patch: Row | ((r: Row) => Row), o: Opts = {}): Promise<number> {
  const d = await driver();
  return d.tx(async () => {
    const rows = await find(table, eq, o);
    for (const r of rows) await d.patch(table, keyOf(table, r), typeof patch === "function" ? patch(r) : patch);
    return rows.length;
  });
}
export async function remove(table: string, eq: Row, o: Opts = {}): Promise<number> {
  const d = await driver();
  return d.tx(async () => {
    const rows = await find(table, eq, o);
    for (const r of rows) await d.del(table, keyOf(table, r));
    return rows.length;
  });
}
/** عدة أوامر كوحدة وحدة: إذا فشل واحد ما يتغير شي. لا تحط بداخلها رسائل تليجرام، لأن Firestore ممكن يعيدها */
export const tx = async <T>(fn: () => Promise<T>): Promise<T> => (await driver()).tx(fn);

export function modeFromName(name: string) {
  if (name.includes("حضوري")) return "in";
  if (name.includes("إلكتروني") || name.includes("الكتروني")) return "online";
  return "both";
}

export async function catIdFor(name: string) {
  name = name.trim();
  const r = await one("cats", { name });
  if (r) { if (!r.active) await update("cats", { id: r.id }, { active: 1 }); return r.id as number; }
  return insert("cats", { name });
}

/** آخر نسختين من كل امتحان تصير اختياري. يتكرر بأمان، وتبقى نسخة إجبارية وحدة على الأقل */
export async function lastTwoOptional() {
  let moved = 0;
  await tx(async () => {
    moved = 0;
    for (const e of await find("bank_exams")) {
      const vs = (await find("bank_versions", { exam_id: e.id })).sort((x, y) => String(x.model).localeCompare(String(y.model)));
      for (const v of vs.length <= 2 ? vs.slice(1) : vs.slice(-2)) {
        if (v.kind !== "optional") { await update("bank_versions", { id: v.id }, { kind: "optional" }); moved++; }
      }
    }
    await kvSet("last_two_done", "1");
  });
  return moved;
}

export async function initDb() {
  const d = await driver();
  await d.init();
  // بطلب صاحب البوت: تنطبق مرة وحدة على الامتحانات الموجودة. خطأ بيها ما يوقف البوت، وتنعاد بالتشغيل الجاي
  if (!await kvGet("last_two_done")) {
    try { await lastTwoOptional(); } catch (e) { console.error(e); }
  }
  if (d.seedOnce && await kvGet("seeded")) return;
  const orphan = await find("products", { cat_id: null });
  if (orphan.some((p) => p.active === 1)) await update("products", { cat_id: null }, { cat_id: await catIdFor("منتجات أخرى") });
  await update("products", { mode: null }, (p) => ({ mode: modeFromName(p.name) }));
  for (const g of GOVS) {
    await insertIgnore("fees", { gov: g }, { fee: DEFAULT_FEE });
    await insertIgnore("govmode", { gov: g }, { mode: g === "بغداد" ? "both" : "online" });
  }
  if (!await one("areas")) {
    for (const [gov, area, cs] of SEED_CENTERS) {
      const aid = await insert("areas", { gov, name: area });
      for (const cn of cs) await insert("centers", { area_id: aid, name: cn });
    }
  }
  if (!await one("chapters")) await saveCurriculum(SEED_CURRIC);
  if (d.seedOnce) await kvSet("seeded", "1");
}

/** يحفظ الفصول والمواضيع من نص، ويحدّث الموجود بمكانه حتى ما تضيع ارتباطات الأسئلة القديمة */
export async function saveCurriculum(text: string): Promise<[number, number]> {
  const chs: { ar: string; en: string; t: { ar: string; en: string; n: number }[] }[] = [];
  const parts = (s: string) => {
    const i = s.indexOf("|");
    return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  };
  let cur: (typeof chs)[number] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const [ar, en] = parts(line.replace(/^#+/, ""));
      cur = { ar, en, t: [] };
      chs.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^(.+?)\s*=\s*([\d٠-٩]+)\s*$/);
    const [ar, en] = parts(m ? m[1] : line);
    cur.t.push({ ar, en, n: m ? Number(toLatinDigits(m[2])) : 0 });
  }
  if (!chs.length) return [0, 0];
  return await tx(async () => {
    const oldCh = await find("chapters", { active: 1 }, { order: ["ord"] });
    let nt = 0;
    for (const [i, ch] of chs.entries()) {
      let chid: number;
      if (i < oldCh.length) {
        chid = oldCh[i].id;
        await update("chapters", { id: chid }, { ord: i + 1, ar: ch.ar, en: ch.en });
      } else chid = await insert("chapters", { ord: i + 1, ar: ch.ar, en: ch.en });
      const oldT = await find("topics", { chapter_id: chid, active: 1 }, { order: ["ord"] });
      for (const [j, t] of ch.t.entries()) {
        nt++;
        if (j < oldT.length) await update("topics", { id: oldT[j].id }, { ord: j + 1, ar: t.ar, en: t.en, lectures: t.n });
        else await insert("topics", { chapter_id: chid, ord: j + 1, ar: t.ar, en: t.en, lectures: t.n });
      }
      for (const t of oldT.slice(ch.t.length)) await update("topics", { id: t.id }, { active: 0 });
    }
    for (const ch of oldCh.slice(chs.length)) await update("chapters", { id: ch.id }, { active: 0 });
    return [chs.length, nt] as [number, number];
  });
}

// ---------- مفاتيح/قيم عامة وجلسات
export const kvGet = async (k: string): Promise<string | null> => ((await one("kv", { k }))?.v as string | undefined) ?? null;
export const kvSet = async (k: string, v: string) => { await put("kv", { k, v }); };

export async function getSession(uid: number): Promise<{ state: string; data: Row }> {
  const r = await one("sessions", { user_id: uid });
  if (!r) return { state: "", data: {} };
  return { state: r.state || "", data: JSON.parse(r.data || "{}") };
}
export async function setSession(uid: number, state: string, data: Row) {
  await put("sessions", { user_id: uid, state, data: JSON.stringify(data) });
}
