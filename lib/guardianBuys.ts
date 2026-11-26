// 🧾 وصل الشراء لولي الأمر (طلبه 2026-11-26): مثل الدرجة بالضبط. إذا ولي الأمر مربوط (رمز بالتطبيق لو تليگرام) يوصله
// الوصل الملون بكل اللي اشتراه ابنه. وإذا مو مربوط، الوصل ينتظر، وأول ما ينربط توصله كل الوصولات المنتظرة
import { kvGet, kvSet, one } from "./db.ts";
import { orderItems, sellerLabel } from "./data.ts";
import { itemLabel } from "./orderRules.ts";
import { send } from "./telegram.ts";
import { esc, money } from "./util.ts";

const waitKey = (sid: number) => `guardian_buys_wait_${sid}`;
/** أرقام البيعات اللي تنتظر ولي الأمر */
export async function waitingBuys(sid: number): Promise<number[]> {
  try { const v = JSON.parse((await kvGet(waitKey(sid))) ?? "[]"); return Array.isArray(v) ? v.map(Number).filter((x) => x > 0) : []; } catch { return []; }
}

/** يدز وصل بيعة وحدة لولي الأمر (صورة ملونة، وإذا ما صارت كتابة). true إذا انرسل */
async function sendBuy(gid: number, oid: number, late = false) {
  const o = await one("orders", { id: oid });
  if (!o || Number(o.printed) === 2) return true; // ملغية: ماكو شي يوصل
  const items = orderItems(o);
  const st = await one("students", { user_id: o.user_id });
  const name = String(st?.name ?? o.name ?? "");
  const cap = `🧾 <b>${esc(name)}</b> اشترى من ${esc(await sellerLabel(o))} (#${oid})${late ? ` بتاريخ ${esc(String(o.created ?? "").slice(0, 10))}` : ""}:\n` +
    `${items.map((i) => `• ${esc(itemLabel(i))}${Number(i.qty) > 1 ? ` × ${i.qty}` : ""}`).join("\n")}\n💰 المجموع: <b>${money(Number(o.total ?? 0))}</b>`;
  const { sendReceiptImage } = await import("./documents.ts");
  if (await sendReceiptImage(gid, o, items, cap).catch(() => false)) return true;
  return !!await send(gid, cap);
}

/** بيعة جديدة: لولي الأمر إذا مربوط، وإلا تنتظره */
export async function guardianBuy(sid: number, oid: number) {
  const { guardianOf } = await import("./access.ts");
  const g = await guardianOf(sid);
  if (g && await sendBuy(Number(g.guardian_id), oid)) return "sent" as const;
  const list = await waitingBuys(sid);
  if (!list.includes(oid)) list.push(oid);
  await kvSet(waitKey(sid), JSON.stringify(list.slice(-50)));
  return "waiting" as const;
}

/** ولي الأمر انربط هسه: كل الوصولات المنتظرة توصله، بترتيبها. يرجع شگد وصل */
export async function releaseBuys(sid: number) {
  const list = await waitingBuys(sid);
  if (!list.length) return 0;
  const { guardianOf } = await import("./access.ts");
  const g = await guardianOf(sid);
  if (!g) return 0;
  const left: number[] = [];
  let n = 0;
  for (const oid of list) {
    if (await sendBuy(Number(g.guardian_id), oid, true).catch(() => false)) n++;
    else left.push(oid);
  }
  await kvSet(waitKey(sid), JSON.stringify(left));
  return n;
}
