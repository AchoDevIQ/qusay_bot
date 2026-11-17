// المخزن (قرار الأستاذ 2026-11-17): المنتج الواحد إله توفر لكل منهج (عربي / إنجليزي)، لأن الطالب ياخذ نسخة منهجه.
//   ١. «متوفر / خلص» لكل منهج بدوسة: الطالب اللي منهجه خلص يشوف المنتج «⏳ خلص لمنهجك» وما يگدر يشتريه.
//   ٢. «🔔 بلّغني لما يتوفر»: ينحفظ اسمه، وأول ما يرجع يتوفر يوصله خبر.
//   ٥. العدد بالمخزن (اختياري لكل منتج ومنهج): كل بيعة تنقص، ومن يوصل صفر يصير «خلص» وحده، والإلغاء يرجعه.
//      ويوصل لصاحب البوت تنبيه من يقرب يخلص
import { ADMIN_IDS } from "./config.ts";
import { find, one, put, remove, type Row } from "./db.ts";
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";

export const STOCK_LANGS = ["عربي", "إنجليزي"] as const;
export type Lang = (typeof STOCK_LANGS)[number];
const langOf = (v: unknown): Lang | null => (STOCK_LANGS as readonly string[]).includes(String(v)) ? (String(v) as Lang) : null;

export type StockView = { out: boolean; count: number | null; low: number | null; waiting: number };
async function row(pid: number, lang: Lang) { return await one("product_stock", { product_id: pid, lang }); }

/** المنتج متوفر لهذا المنهج؟ (بلا سجل = متوفر) */
export async function available(pid: number, lang: unknown) {
  const l = langOf(lang);
  if (!l) return true;
  const r = await row(pid, l);
  if (!r) return true;
  if (r.out) return false;
  return r.count === null || r.count === undefined || Number(r.count) > 0;
}
export async function stockView(pid: number): Promise<Record<Lang, StockView>> {
  const out = {} as Record<Lang, StockView>;
  for (const l of STOCK_LANGS) {
    const r = await row(pid, l);
    out[l] = { out: !await available(pid, l), count: r?.count === null || r?.count === undefined ? null : Number(r.count), low: r?.low === null || r?.low === undefined ? null : Number(r.low), waiting: (await find("stock_wait", { product_id: pid, lang: l })).length };
  }
  return out;
}

/** صاحب البوت: متوفر/خلص، والعدد (فارغ = ما نعدّ)، وحد التنبيه */
export async function setStock(pid: number, lang: unknown, o: { out?: unknown; count?: unknown; low?: unknown }) {
  const l = langOf(lang);
  if (!l) return;
  const was = await available(pid, l);
  const r = await row(pid, l);
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Math.max(0, Math.floor(Number(v)) || 0));
  const next: Row = { product_id: pid, lang: l, out: r?.out ?? 0, count: r?.count ?? null, low: r?.low ?? null, alerted: r?.alerted ?? 0, updated: stamp() };
  if (o.out !== undefined) next.out = o.out ? 1 : 0;
  if (o.count !== undefined) { next.count = num(o.count); next.alerted = 0; if (next.count !== null && next.count > 0 && o.out === undefined) next.out = 0; }
  if (o.low !== undefined) next.low = num(o.low);
  await put("product_stock", next);
  if (!was && await available(pid, l)) await tellWaiting(pid, l);
}

/** «🔔 بلّغني لما يتوفر» */
export async function waitFor(uid: number, pid: number, lang: unknown) {
  const l = langOf(lang);
  if (!l || await available(pid, l)) return false;
  await put("stock_wait", { product_id: pid, lang: l, user_id: uid, created: stamp() });
  return true;
}
async function tellWaiting(pid: number, lang: Lang) {
  const p = await one("products", { id: pid });
  for (const w of await find("stock_wait", { product_id: pid, lang })) {
    await send(Number(w.user_id), `🔔 <b>رجع «${esc(String(p?.name ?? "المنتج"))}» يتوفر</b>\nتگدر تطلبه هسه من المتجر.`);
  }
  await remove("stock_wait", { product_id: pid, lang });
}

/** أسطر الطلب (اسم وكمية) ← منتجاتها: الطلب يحفظ الاسم بس */
async function linesOf(items: Row[]) {
  const all = await find("products", { active: 1 });
  return items.map((it) => ({ p: it.id ? all.find((x) => x.id === Number(it.id)) : all.find((x) => x.name === it.name), qty: Number(it.qty) || 1 })).filter((x) => x.p);
}
/** بيعة صارت: العدد ينقص، ومن يخلص يصير «خلص»، ومن يقرب يوصل تنبيه */
export async function takeStock(items: Row[], lang: unknown, sign = 1) {
  const l = langOf(lang);
  if (!l) return;
  for (const { p, qty } of await linesOf(items)) {
    const r = await row(Number(p!.id), l);
    if (!r || r.count === null || r.count === undefined) continue;
    const count = Math.max(0, Number(r.count) - sign * qty);
    const low = r.low === null || r.low === undefined ? null : Number(r.low);
    const alert = sign > 0 && !r.alerted && ((low !== null && count <= low) || count === 0);
    await put("product_stock", { ...r, count, alerted: alert ? 1 : sign < 0 && low !== null && count > low ? 0 : r.alerted ?? 0, updated: stamp() });
    if (alert) for (const a of ADMIN_IDS) await send(a, count === 0 ? `📦 <b>خلص «${esc(String(p!.name))}» (${l})</b>\nصار «خلص» بالمتجر وحده. من توصلك كمية جديدة اكتب عددها بالمنتجات.` : `📦 <b>«${esc(String(p!.name))}» (${l}) قرب يخلص</b>: باقي ${count}.`);
    if (sign < 0 && count > 0 && Number(r.count) <= 0) await tellWaiting(Number(p!.id), l);
  }
}
/** الطلب انلغى: يرجع العدد */
export const returnStock = (items: Row[], lang: unknown) => takeStock(items, lang, -1);

/** منتجات الطلب اللي خلصت لهذا المنهج (أسماؤها) */
export async function outOf(pids: number[], lang: unknown) {
  const names: string[] = [];
  for (const pid of pids) if (!await available(pid, lang)) names.push(String((await one("products", { id: pid }))?.name ?? pid));
  return names;
}
