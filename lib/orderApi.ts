// صفحتا الطلبات ومبيعات المكتب
import { find, one, update, type Row } from "./db.ts";
import { markPrinted } from "./admin.ts";
import { cats, orderItems, placeOf, products, searchStudents, staffName } from "./data.ts";
import { listPdf, sendColorReceipt, sendOrdersPdf, sendPaperReceipt } from "./documents.ts";
import { posSale } from "./office.ts";
import { num, shiftDay, todayStr } from "./util.ts";
import { authed, need } from "./webApi.ts";

const PERM = "orders";
const NEW_LIMIT = 60, PRINTED_LIMIT = 30;
const orderView = (o: Row) => ({
  id: o.id, created: o.created, name: o.name, curr: o.curr ?? "", place: placeOf(o), area: o.area, phone1: o.phone1, phone2: o.phone2, username: o.username ?? "", userId: o.user_id,
  items: orderItems(o).map((i) => ({ name: i.name, qty: i.qty, price: i.price })), subtotal: o.subtotal, fee: o.fee, total: o.total,
});
async function ordersData() {
  return {
    fresh: (await find("orders", {}, { where: (o) => !o.printed, order: ["id"], limit: NEW_LIMIT })).map(orderView),
    printed: (await find("orders", { printed: 1 }, { order: ["-id"], limit: PRINTED_LIMIT })).map(orderView),
  };
}
const idList = (raw: unknown) => {
  const ids = Array.isArray(raw) ? [...new Set((raw as unknown[]).map(Number))].filter(Number.isSafeInteger) : [];
  need(ids.length, "حدد طلب واحد على الأقل");
  return ids;
};
export async function orderAction(body: Row) {
  const uid = await authed(body?.initData, PERM);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "pdf") {
    const live = new Set((await find("orders", {}, { where: (o) => !o.printed })).map((o) => o.id));
    const ids = idList(body.ids).filter((i) => live.has(i));
    need(ids.length, "الطلبات المحددة ما بقت بالجديدة");
    need(await sendOrdersPdf(uid, ids), "ما گدرت أرسل الملف، حاول مرة ثانية");
    notice = "✅ الملف وصلك بمحادثة البوت. اطبعه، وبعدها اضغط «تم الطباعة»";
  } else if (a === "done") {
    const { ready, gone } = await markPrinted(idList(body.ids));
    notice = `✅ انتقلت ${ready.length} طلبات للمطبوعة`;
    if (gone.length) notice = `⚠️ لا ترسل هاي الطلبات، الطالب ألغاها: ${gone.map((i) => "#" + i).join("، ")}. ${notice}`;
  } else if (a === "back") {
    need((await one("orders", { id: Number(body.id) }))?.printed === 1, "الطلب مو بالمطبوعة");
    await update("orders", { id: Number(body.id) }, { printed: 0 });
    notice = "↩️ رجع للطلبات الجديدة";
  } else need(a === "list", "أمر غير معروف");
  return { ...await ordersData(), notice };
}

// ---------- مبيعات المكتب
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayRows = async (day: string) => await find("orders", { printed: 3 }, { where: (o) => String(o.created).startsWith(day), order: ["id"] });
async function salesData(rawDay: unknown, q: unknown) {
  const today = todayStr();
  const day = typeof rawDay === "string" && DAY.test(rawDay) && rawDay <= today ? rawDay : today;
  const rows = await dayRows(day);
  const days = new Map<string, { day: string; n: number; total: number }>();
  for (const o of await find("orders", { printed: 3 })) {
    const d = String(o.created).slice(0, 10);
    const r = days.get(d) ?? { day: d, n: 0, total: 0 };
    r.n++;
    r.total += o.total;
    days.set(d, r);
  }
  const by = new Map<number | null, number>();
  for (const r of rows) by.set(r.seller, (by.get(r.seller) ?? 0) + r.total);
  const s = String(q ?? "").trim();
  return {
    today, day, prev: shiftDay(day, -1), next: day < today ? shiftDay(day, 1) : null,
    total: rows.reduce((t, r) => t + r.total, 0),
    sales: await Promise.all(rows.map(async (r) => ({ id: r.id, time: String(r.created).slice(11), name: r.name, total: r.total, seller: await staffName(r.seller), items: orderItems(r).map((i) => `${i.name} ×${i.qty}`).join("، ") }))),
    sellers: await Promise.all([...by].map(async ([k, total]) => ({ name: await staffName(k), total }))),
    days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 31),
    results: s ? (await searchStudents(s)).map((x) => ({ id: x.user_id, name: x.name, phone: x.phone1, gov: x.gov })) : [],
    catalog: await Promise.all((await cats()).map(async (c) => ({ name: c.name, items: (await products(c.id)).map((p) => ({ id: p.id, name: p.name, price: p.price })) }))),
  };
}
export async function salesAction(body: Row) {
  const uid = await authed(body?.initData, PERM);
  const a = String(body.action ?? "");
  let extra: Row = { notice: "" };
  if (a === "sale") {
    const items = Array.isArray(body.items) ? body.items : [];
    const r = await posSale(uid, { sid: body.sid, i: items });
    need(!r.error, String(r.error ?? "").replace(/^[⚠️⛔ ]+/u, ""));
    extra = { notice: r.sent ? `✅ تم البيع #${r.oid}، والوصل وصل للطالب` : `✅ تم البيع #${r.oid}. ⚠️ الوصل ما وصل للطالب، ممكن حاظر البوت`, soldId: r.oid };
  } else if (a === "pdf") {
    const day = String(body.day ?? "");
    need(DAY.test(day), "اليوم غير معروف");
    const rows = await dayRows(day);
    need(rows.length, "ما أكو مبيعات بهذا اليوم");
    const out = await Promise.all(rows.map(async (r) => [`#${r.id}`, String(r.created).slice(11), r.name, orderItems(r).map((i) => `${i.name} ×${i.qty}`).join("، "), num(r.total), await staffName(r.seller)]));
    const sent = await listPdf(uid, `مبيعات المكتب — ${day} — المجموع ${num(rows.reduce((s, r) => s + r.total, 0))}`, ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ", "البائع"], out, "office_" + day);
    need(sent, "ما گدرت أرسل الملف، حاول مرة ثانية");
    extra = { notice: "✅ الملف وصلك بمحادثة البوت" };
  } else if (a === "receipt") {
    const id = Number(body.id);
    need((await one("orders", { id }))?.printed === 3, "البيعة غير موجودة");
    need(body.kind === "color" ? await sendColorReceipt(uid, id) : await sendPaperReceipt(uid, id), "ما گدرت أرسل الوصل، حاول مرة ثانية");
    extra = { notice: "✅ الوصل وصلك بمحادثة البوت" };
  } else need(a === "list", "أمر غير معروف");
  return { ...await salesData(body.day, body.q), ...extra };
}
