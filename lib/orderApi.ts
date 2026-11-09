// صفحتا الطلبات ومبيعات المكتب والمكتبات
import { find, insert, one, tx, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { markPrinted } from "./admin.ts";
import { can, cats, isAdmin, myOffice, officeUnsettled, orderItems, orderParts, partsOf, placeOf, products, savedParts, searchStudents, staffName } from "./data.ts";
import { listPdf, sendColorReceipt, sendOrdersPdf, sendPaperReceipt } from "./documents.ts";
import { posSale, settleDetail } from "./office.ts";
import { num, shiftDay, stamp, todayStr } from "./util.ts";
import { ensure, need } from "./webApi.ts";
import { verifyInitData } from "./webAuth.ts";

const NEW_LIMIT = 60, PRINTED_LIMIT = 100;
const orderView = async (o: Row) => ({
  id: o.id, created: o.created, name: o.name, curr: o.curr ?? "", place: placeOf(o), area: o.area, phone1: o.phone1, phone2: o.phone2, username: o.username ?? "", userId: o.user_id,
  items: orderItems(o).map((i) => ({ name: i.name, qty: i.qty, price: i.price })), subtotal: o.subtotal, fee: o.fee, total: o.total,
  printedBy: o.printed_by ? await staffName(o.printed_by) : "", settled: !!o.settle_id,
});
const list = async (rows: Row[]) => await Promise.all(rows.map(orderView));

/** حساب شركة التوصيل: كل الطلبات اللي انسلمت للشركة ولسه ما تحاسبنا عليها */
async function companyData() {
  const open = await find("orders", { printed: 1, settle_id: null }, { order: ["id"] });
  return {
    open: open.map((o) => ({ id: o.id, total: o.total, fee: o.fee, parts: orderParts(o) })),
    archive: (await find("company_settlements", {}, { order: ["-id"], limit: 20 })).map((s) => ({ id: s.id, from: s.from_id, to: s.to_id, n: s.n, gross: s.gross, fees: s.fees, net: s.net, created: s.created, parts: savedParts(s) })),
  };
}
async function settleCompany(fromRaw: unknown, toRaw: unknown, expect: unknown) {
  const from = Number(fromRaw), to = Number(toRaw);
  need(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from <= to, "اكتب رقم أول وصل وآخر وصل صح");
  const rows = await find("orders", { printed: 1, settle_id: null }, { where: (o) => o.id >= from && o.id <= to, order: ["id"] });
  need(rows.length, "ماكو طلبات غير محاسب عليها بهذا المدى");
  const gross = rows.reduce((s, o) => s + o.total, 0), fees = rows.reduce((s, o) => s + o.fee, 0), net = gross - fees;
  need(net === Number(expect), "الأرقام تغيرت. راجع المبلغ واضغط مرة ثانية");
  await tx(async () => {
    const id = await insert("company_settlements", { from_id: from, to_id: to, n: rows.length, gross, fees, net, created: stamp(), parts: JSON.stringify(partsOf(rows)) });
    for (const o of rows) await update("orders", { id: o.id }, { settle_id: id });
  });
  return `✅ انسجل الحساب: ${rows.length} طلب، استلمت ${num(net)}`;
}

async function ordersData(uid: number) {
  const owner = await isAdmin(uid), orders = await can(uid, "orders");
  // الجديدة مشتركة حتى يطبعها أي واحد. المطبوعة: كل واحد يشوف اللي طبعه، والمدير يشوف الكل
  const printed = orders ? await find("orders", owner ? { printed: 1 } : { printed: 1, printed_by: uid }, { order: ["-id"], limit: PRINTED_LIMIT }) : [];
  return {
    fresh: orders ? await list(await find("orders", {}, { where: (o) => !o.printed, order: ["id"], limit: NEW_LIMIT })) : [],
    printed: await list(printed), owner,
    company: await can(uid, "company") ? await companyData() : null,
  };
}
const idList = (raw: unknown) => {
  const ids = Array.isArray(raw) ? [...new Set((raw as unknown[]).map(Number))].filter(Number.isSafeInteger) : [];
  need(ids.length, "حدد طلب واحد على الأقل");
  return ids;
};
async function pageUser(body: Row) {
  await ensure();
  const uid = verifyInitData(body?.initData);
  need(uid !== null, "هذا الرابط انتهى. اكتب /start بالبوت وافتح الصفحة من جديد", 401);
  return uid!;
}
export async function orderAction(body: Row) {
  const uid = await pageUser(body);
  const a = String(body.action ?? "");
  const company = await can(uid, "company");
  if (a === "settle") need(company, "ما عندك صلاحية", 403);
  else need(await can(uid, "orders") || (company && a === "list"), "ما عندك صلاحية", 403);
  let notice = "";
  if (a === "settle") notice = await settleCompany(body.from, body.to, body.net);
  else if (a === "pdf") {
    const live = new Set((await find("orders", {}, { where: (o) => !o.printed })).map((o) => o.id));
    const ids = idList(body.ids).filter((i) => live.has(i));
    need(ids.length, "الطلبات المحددة ما بقت بالجديدة");
    need(await sendOrdersPdf(uid, ids), "ما گدرت أرسل الملف. اكتب /start للبوت وحاول مرة ثانية");
    for (const id of ids) await update("orders", { id }, { printed_by: uid, printed_at: stamp() });
    await logActivity(uid, `🖨 طبع PDF لـ ${ids.length} طلب`);
    notice = "✅ الملف وصلك بمحادثة البوت. اطبعه، وبعدها اضغط «تم الطباعة»";
  } else if (a === "reprint") {
    const owner = await isAdmin(uid);
    const mine = new Set((await find("orders", owner ? { printed: 1 } : { printed: 1, printed_by: uid })).map((o) => o.id));
    const ids = idList(body.ids).filter((i) => mine.has(i));
    need(ids.length, "الطلبات المحددة مو بالمطبوعة عندك");
    need(await sendOrdersPdf(uid, ids, true), "ما گدرت أرسل الملف. اكتب /start للبوت وحاول مرة ثانية");
    await logActivity(uid, `🖨 إعادة طباعة ${ids.length} طلب`);
    notice = "✅ ملف إعادة الطباعة وصلك بمحادثة البوت";
  } else if (a === "done") {
    const ids = idList(body.ids);
    const { ready, gone } = await markPrinted(ids);
    for (const id of ready) await update("orders", { id }, { printed_by: uid, printed_at: stamp() });
    notice = `✅ انتقلت ${ready.length} طلبات للمطبوعة`;
    if (gone.length) notice = `⚠️ لا ترسل هاي الطلبات، الطالب ألغاها: ${gone.map((i) => "#" + i).join("، ")}. ${notice}`;
  } else if (a === "back") {
    const o = await one("orders", { id: Number(body.id) });
    need(o?.printed === 1, "الطلب مو بالمطبوعة");
    need(!o!.settle_id, "هذا الطلب انحسب ويا الشركة، ما يرجع");
    await update("orders", { id: Number(body.id) }, { printed: 0, printed_by: null, printed_at: null });
    notice = "↩️ رجع للطلبات الجديدة";
  } else need(a === "list", "أمر غير معروف");
  return { ...await ordersData(uid), notice };
}

// ---------- مبيعات المكتب والمكتبات
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const itemsText = (r: Row) => orderItems(r).map((i) => `${i.name} ×${i.qty}`).join("، ");

/** شغل كل مساعد بهذا اليوم: بيعاته، الطلبات اللي طبعها، وملفات PDF */
async function teamReport(day: string, sales: Row[]) {
  const staff = await find("staff", {}, { order: ["name"] });
  return await Promise.all(staff.map(async (s) => {
    const sold = sales.filter((r) => r.seller === s.user_id);
    const printed = await find("orders", { printed_by: s.user_id }, { where: (o) => String(o.printed_at).startsWith(day) });
    const pdfs = await find("activity", { user_id: s.user_id }, { where: (l) => String(l.created).startsWith(day) && String(l.what).startsWith("🖨") });
    return { id: s.user_id, name: s.name, sold: sold.length, total: sold.reduce((t, r) => t + r.total, 0), printed: printed.length, pdfs: pdfs.length };
  }));
}
async function salesData(uid: number, off: Row | null, rawDay: unknown, q: unknown) {
  const today = todayStr();
  const day = typeof rawDay === "string" && DAY.test(rawDay) && rawDay <= today ? rawDay : today;
  // المكتبة تشوف بيعها بس
  const all = await find("orders", off ? { printed: 3, office_id: off.id } : { printed: 3 }, { order: ["id"] });
  const rows = all.filter((o) => String(o.created).startsWith(day));
  const days = new Map<string, { day: string; n: number; total: number }>();
  for (const o of all) {
    const d = String(o.created).slice(0, 10);
    const r = days.get(d) ?? { day: d, n: 0, total: 0 };
    r.n++;
    r.total += o.total;
    days.set(d, r);
  }
  const by = new Map<number | null, number>();
  for (const r of rows) by.set(r.seller, (by.get(r.seller) ?? 0) + r.total);
  const s = String(q ?? "").trim();
  let shop: Row | null = null;
  if (off) {
    const un = await officeUnsettled(off.id);
    shop = {
      name: off.name, open: un.total, openN: un.n, openParts: un.parts, left: off.lim ? Math.max(off.lim - un.total, 0) : null,
      archive: (await find("settlements", { office_id: off.id }, { order: ["-id"], limit: 30 })).map((x) => ({ id: x.id, amount: x.amount, n: x.n, created: x.created, parts: savedParts(x) })),
    };
  }
  return {
    today, day, prev: shiftDay(day, -1), next: day < today ? shiftDay(day, 1) : null, shop,
    total: rows.reduce((t, r) => t + r.total, 0), parts: partsOf(rows),
    sales: await Promise.all(rows.map(async (r) => ({ id: r.id, time: String(r.created).slice(11), name: r.name, total: r.total, seller: await staffName(r.seller), items: itemsText(r) }))),
    sellers: await Promise.all([...by].map(async ([k, total]) => ({ name: await staffName(k), total }))),
    team: await isAdmin(uid) ? await teamReport(day, rows) : [],
    days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 31),
    results: s ? (await searchStudents(s)).map((x) => ({ id: x.user_id, name: x.name, phone: x.phone1, gov: off ? "" : x.gov })) : [],
    catalog: await Promise.all((await cats()).map(async (c) => ({ name: c.name, items: (await products(c.id)).map((p) => ({ id: p.id, name: p.name, price: p.price })) }))),
  };
}
export async function salesAction(body: Row) {
  const uid = await pageUser(body);
  const off = await myOffice(uid);
  need(off || await can(uid, "sales"), "ما عندك صلاحية", 403);
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
    const rows = await find("orders", off ? { printed: 3, office_id: off.id } : { printed: 3 }, { where: (o) => String(o.created).startsWith(day), order: ["id"] });
    need(rows.length, "ما أكو مبيعات بهذا اليوم");
    const out = await Promise.all(rows.map(async (r) => [`#${r.id}`, String(r.created).slice(11), r.name, itemsText(r), num(r.total), await staffName(r.seller)]));
    const sent = await listPdf(uid, `مبيعات ${off ? off.name : "المكتب"} — ${day} — المجموع ${num(rows.reduce((s, r) => s + r.total, 0))}`, ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ", "البائع"], out, "sales_" + day);
    need(sent, "ما گدرت أرسل الملف، حاول مرة ثانية");
    extra = { notice: "✅ الملف وصلك بمحادثة البوت" };
  } else if (a === "receipt") {
    const id = Number(body.id);
    const o = await one("orders", { id });
    need(o?.printed === 3 && (!off || o.office_id === off.id), "البيعة غير موجودة");
    const ok = body.kind === "color" ? await sendColorReceipt(uid, id) : await sendPaperReceipt(uid, id, body.kind === "framed");
    need(ok, "ما گدرت أرسل الوصل. اكتب /start للبوت وحاول مرة ثانية");
    extra = { notice: "✅ الوصل وصلك بمحادثة البوت. افتحه واطبعه" };
  } else if (a === "settlePdf") {
    need(off, "ما عندك صلاحية", 403);
    need(await settleDetail(uid, off!.id, Number(body.id)), "ما گدرت أرسل الملف، حاول مرة ثانية");
    extra = { notice: "✅ الملف وصلك بمحادثة البوت" };
  } else need(a === "list", "أمر غير معروف");
  return { ...await salesData(uid, off, body.day, body.q), ...extra };
}
