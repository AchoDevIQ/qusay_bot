// خصم طالب العام: الطالب اللي اشترى امتحانات أو محاضرات فصل بالسنة الدراسية اللي فاتت، ياخذ نفس الشي
// من نفس الفصل هالسنة بخصم (نص السعر بالأساس). الخصم لكل فصل ولكل نوع: اللي اشترى امتحانات الفصل بس،
// ياخذ خصم على امتحاناته بس. المشتريات تنعرف من طلبات البوت (التوصيل والمكتبة والمكتب) ومن فصول التطبيق
// (جدول year_buys، ينكتب كل ما يدخل الطالب من التطبيق). الخصم ينحسب بالسيرفر، والصفحة بس تعرضه
import { find, insertIgnore, kvGet, kvSet, type Row } from "./db.ts";
import { products } from "./data.ts";
import { chapterKey, firstRoundOnly, moneyKind } from "./orderRules.ts";
import { stamp } from "./util.ts";

export type Kind = "exams" | "lectures";
export type RetSettings = { on: boolean; pct: number; start: string };
const KEY = "ret_disc";
const DEFAULTS: RetSettings = { on: true, pct: 50, start: "06-01" };
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function retSettings(): Promise<RetSettings> {
  try {
    const o = JSON.parse(await kvGet(KEY) || "{}") as Row;
    return {
      on: typeof o.on === "boolean" ? o.on : DEFAULTS.on,
      pct: Number.isInteger(o.pct) && o.pct >= 1 && o.pct <= 100 ? o.pct : DEFAULTS.pct,
      start: MD.test(String(o.start ?? "")) ? String(o.start) : DEFAULTS.start,
    };
  } catch { return { ...DEFAULTS }; }
}
/** يحفظ الإعدادات. يرجع سبب الرفض إذا القيمة غلط */
export async function saveRetSettings(patch: Row): Promise<string | null> {
  const cur = await retSettings();
  if (patch.on !== undefined) cur.on = !!patch.on;
  if (patch.pct !== undefined) {
    const n = Number(patch.pct);
    if (!Number.isInteger(n) || n < 1 || n > 100) return "النسبة لازم تكون رقم من 1 إلى 100";
    cur.pct = n;
  }
  if (patch.start !== undefined) {
    if (!MD.test(String(patch.start))) return "بداية السنة الدراسية لازم تكون شهر ويوم، مثل 06-01";
    cur.start = String(patch.start);
  }
  await kvSet(KEY, JSON.stringify(cur));
  return null;
}

/** السنة الدراسية لتاريخ («2026-11-20 10:00»): السنة اللي بدت بيها. مثلاً من 2026-06-01 لحد 2027-05-31 هي 2026 */
export function schoolYear(at: string, start = DEFAULTS.start) {
  const y = Number(at.slice(0, 4));
  return at.slice(5, 10) >= start ? y : y - 1;
}
export const yearName = (y: number) => `${y}-${y + 1}`;
const range = (y: number, start: string) => [`${y}-${start}`, `${y + 1}-${start}`] as const;

/** الفصل ونوعه من اسم المنتج. «محاضرات + امتحانات» يرجع النوعين. الملازم والدفاتر ما إلها نوع */
export function kindsOf(name: string | null | undefined): { ch: string; kinds: Kind[] } | null {
  if (!firstRoundOnly(name)) return null;
  const ch = chapterKey(name);
  if (!ch) return null;
  const k = moneyKind(name);
  return { ch, kinds: k === "both" ? ["exams", "lectures"] : k === "exams" ? ["exams"] : k === "lectures" ? ["lectures"] : [] };
}
const key = (ch: string, k: Kind) => `${ch}|${k}`;

/** اللي اشتراه الطالب بسنة دراسية: «الفصل الأول|exams». البيعة الملغية والراجعة ما تنحسب.
 *  withNew: الطلب الجديد اللي بعده ما تجهز ينحسب، وفصول التطبيق ما تنحسب (هذا فحص «أخذ الخصم هالسنة»: بالبوت بس،
 *  لأن قائمة التطبيق بأول السنة ممكن بعدها بيها فصول السنة اللي فاتت) */
export async function boughtIn(uid: number, y: number, withNew = false): Promise<Set<string>> {
  const { start } = await retSettings();
  const [from, to] = range(y, start);
  const out = new Set<string>();
  const orders = await find("orders", { user_id: uid }, {
    where: (o) => (o.printed === 1 || o.printed === 3 || (withNew && !o.printed)) && !o.ret && String(o.created) >= from && String(o.created) < to,
  });
  for (const o of orders) {
    let items: Row[] = [];
    try { items = JSON.parse(String(o.items || "[]")); } catch { /* */ }
    for (const it of items) {
      const k = kindsOf(it.name);
      if (k) for (const kind of k.kinds) out.add(key(k.ch, kind));
    }
  }
  if (!withNew) for (const r of await find("year_buys", { user_id: uid, year: y })) out.add(key(String(r.chapter), r.kind as Kind));
  return out;
}

/** فصول التطبيق: تنحفظ لسنة اليوم الدراسية، حتى السنة الجاية نعرف شنو اشترى */
export async function recordAppBuys(uid: number, exams: string[], lectures: string[]) {
  const y = schoolYear(stamp(), (await retSettings()).start);
  for (const [list, kind] of [[exams, "exams"], [lectures, "lectures"]] as const) {
    for (const chapter of list) await insertIgnore("year_buys", { user_id: uid, year: y, chapter, kind }, { src: "app", created: stamp() });
  }
}

export type Disc = { price: number; was: number };
/** خصم كل منتج لهذا الطالب: رقم المنتج ← سعر النسخة الأولى بعد الخصم.
 *  منتج «محاضرات + امتحانات»: حصة المحاضرات = سعر منتج محاضرات نفس الفصل لوحدها، والباقي امتحانات */
export async function discountsFor(uid: number | null | undefined, list?: Row[], now = stamp()): Promise<Map<number, Disc>> {
  const out = new Map<number, Disc>();
  const set = await retSettings();
  if (!set.on || !uid) return out;
  const y = schoolYear(now, set.start);
  const last = await boughtIn(uid, y - 1);
  if (!last.size) return out;
  const used = await boughtIn(uid, y, true);
  const all = list ?? await products();
  const single = (kind: Kind) => {
    const m = new Map<string, number>();
    for (const p of all) {
      const k = kindsOf(p.name);
      if (k && k.kinds.length === 1 && k.kinds[0] === kind && !m.has(k.ch)) m.set(k.ch, Number(p.price));
    }
    return m;
  };
  const lec = single("lectures"), ex = single("exams");
  for (const p of all) {
    const k = kindsOf(p.name), price = Number(p.price);
    if (!k || !k.kinds.length || !(price > 0)) continue;
    let parts: Partial<Record<Kind, number>>;
    if (k.kinds.length === 1) parts = { [k.kinds[0]]: price };
    else {
      const l = lec.get(k.ch), e = ex.get(k.ch);
      if (l !== undefined && l <= price) parts = { lectures: l, exams: price - l };
      else if (e !== undefined && e <= price) parts = { exams: e, lectures: price - e };
      else parts = { exams: price / 2, lectures: price / 2 };
    }
    let off = 0;
    for (const [kind, part] of Object.entries(parts) as [Kind, number][]) {
      if (last.has(key(k.ch, kind)) && !used.has(key(k.ch, kind))) off += (part * set.pct) / 100;
    }
    off = Math.min(price, Math.round(off / 250) * 250);
    if (off > 0) out.set(Number(p.id), { price: price - off, was: price });
  }
  return out;
}

/** أسطر الطلب بعد الخصم: أول نسخة من المنتج المخصوم سطر لوحده بسعر الخصم وبيه السعر الكامل (was) */
export function withDiscounts<T extends Row>(items: (T & { id: number; price: number; qty: number })[], disc: Map<number, Disc>, keepId = false): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const d = disc.get(it.id);
    const { id: _id, ...noId } = it;
    const rest: Row = keepId ? it : noId;
    if (!d || it.qty <= 0) { out.push(rest); continue; }
    out.push({ ...rest, qty: 1, price: d.price, was: d.was });
    if (it.qty > 1) out.push({ ...rest, qty: it.qty - 1 });
  }
  return out;
}
/** للصفحات: [رقم المنتج، سعر الخصم] */
export const discPairs = (disc: Map<number, Disc>) => [...disc].map(([id, d]) => [id, d.price]);

/** لملف الطالب: شنو اشترى السنة اللي فاتت (عليه خصم هالسنة) وشنو اشترى هالسنة (عليه خصم السنة الجاية) */
export async function retFileInfo(uid: number) {
  const set = await retSettings();
  const y = schoolYear(stamp(), set.start);
  const label = (s: Set<string>) => [...s].sort().map((x) => { const [ch, k] = x.split("|"); return `${k === "exams" ? "امتحانات" : "محاضرات"} ${ch}`; });
  return { on: set.on, pct: set.pct, year: yearName(y), lastYear: yearName(y - 1), last: label(await boughtIn(uid, y - 1)), now: label(await boughtIn(uid, y)) };
}
