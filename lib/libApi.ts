// صفحة المكتبات: الحسابات، الرصيد، المبيعات، المحاسبة، والأرشيف. للمدير بس
import { find, insert, one, put, remove, sumOf, tx, update, type Row } from "./db.ts";
import { BTN_OFFICE, toLatinDigits } from "./config.ts";
import { officeUnsettled, orderItems, partsOf, savedParts } from "./data.ts";
import { priceReport } from "./orderRules.ts";
import { mainKb } from "./keyboards.ts";
import { createInvite, notifySettled, officeDayRows, officeOpenRows, officePdf, parseAmount, settleDetail, settleOffice } from "./office.ts";
import { send } from "./telegram.ts";
import { cut, esc, todayStr } from "./util.ts";
import { authed, need } from "./webApi.ts";

const nameOf = (raw: unknown, max: number, label: string) => {
  const t = String(raw ?? "").trim();
  need(t, label);
  return cut(t, max);
};
const totalOf = (rows: Row[]) => ({ n: rows.length, total: sumOf(rows, "total") });
async function pageData() {
  const offs = await find("offices", { active: 1 }, { order: ["id"] });
  return {
    today: todayStr(),
    offices: await Promise.all(offs.map(async (o) => ({
      id: o.id, name: o.name, lim: o.lim ?? 0,
      today: totalOf(await officeDayRows(o.id, todayStr())), yesterday: totalOf(await officeDayRows(o.id, todayStr(1))),
      open: await officeUnsettled(o.id), settled: sumOf(await find("settlements", { office_id: o.id }), "amount"),
      users: (await find("office_users", { office_id: o.id })).map((u) => ({ id: u.user_id, name: u.name || String(u.user_id) })),
      archive: (await find("settlements", { office_id: o.id }, { order: ["-id"], limit: 30 })).map((s) => ({ id: s.id, amount: s.amount, n: s.n, created: s.created, parts: savedParts(s) })),
    }))),
  };
}
const liveOffice = async (raw: unknown) => {
  const o = await one("offices", { id: Number(raw), active: 1 });
  need(o, "المكتبة غير موجودة");
  return o!;
};
const saleRow = (r: Row, withDate: boolean) => ({ id: r.id, time: String(r.created).slice(withDate ? 0 : 11), name: r.name, total: r.total, items: orderItems(r).map((i) => `${i.name} ×${i.qty}`).join("، ") });
const rowsFor = async (id: number, kind: unknown) => {
  if (kind === "all") return { title: "كل المبيعات", fname: `office${id}_all`, rows: await find("orders", { printed: 3, office_id: id }, { order: ["id"] }) };
  if (kind === "open") return { title: "غير المحاسب عليها", fname: `office${id}_open`, rows: await officeOpenRows(id) };
  const day = todayStr(kind === "yesterday" ? 1 : 0);
  return { title: day, fname: `office${id}_${day}`, rows: await officeDayRows(id, day) };
};

export async function libAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  let extra: Row = {};
  if (a === "add") {
    extra = { openId: await insert("offices", { name: nameOf(body.name, 60, "اكتب اسم المكتبة") }), notice: "✅ انضافت المكتبة" };
  } else if (a === "rename") {
    await liveOffice(body.id);
    await update("offices", { id: Number(body.id) }, { name: nameOf(body.name, 60, "اكتب اسم المكتبة") });
  } else if (a === "limit") {
    await liveOffice(body.id);
    const amt = parseAmount(String(body.amount ?? ""));
    need(amt !== null && amt >= 0, "اكتب رقم صحيح، مثل 20 مليون. و0 يعني بدون حد");
    await update("offices", { id: Number(body.id) }, { lim: amt });
    extra = { notice: "✅ انحفظ الرصيد المسموح" };
  } else if (a === "del") {
    const o = await liveOffice(body.id);
    await tx(async () => {
      await update("offices", { id: o.id }, { active: 0 });
      await remove("office_users", { office_id: o.id });
    });
    extra = { notice: "🗑 انحذفت المكتبة. مبيعاتها تبقى محفوظة" };
  } else if (a === "sales") {
    const o = await liveOffice(body.id);
    const { title, rows } = await rowsFor(o.id, body.kind);
    extra = { sales: { officeId: o.id, title, rows: rows.map((r) => saleRow(r, body.kind === "all")), parts: await partsOf(rows), prices: priceReport(rows.map(orderItems) as Parameters<typeof priceReport>[0]) } };
  } else if (a === "pdf") {
    const o = await liveOffice(body.id);
    const { title, rows, fname } = await rowsFor(o.id, body.kind);
    need(await officePdf(uid, `${o.name} — ${title}`, rows, fname), "ما گدرت أرسل الملف، حاول مرة ثانية");
    extra = { notice: "✅ الملف وصلك بمحادثة البوت" };
  } else if (a === "settlePdf") {
    const st = await one("settlements", { id: Number(body.id) });
    need(st, "المحاسبة غير موجودة");
    need(await settleDetail(uid, st!.office_id, st!.id), "ما گدرت أرسل الملف، حاول مرة ثانية");
    extra = { notice: "✅ الملف وصلك بمحادثة البوت" };
  } else if (a === "settle") {
    const o = await liveOffice(body.id);
    const un = await officeUnsettled(o.id);
    need(un.n, "ما أكو مبيعات غير محاسب عليها");
    // المبلغ اللي شافه المدير لازم يطابق، حتى ما تدخل بيعة جديدة بالمحاسبة بدون علمه
    need(un.total === Number(body.amount), "صارت مبيعات جديدة، راجع المبلغ واضغط مرة ثانية");
    await settleOffice(o.id, un);
    await notifySettled(o.id, un);
    extra = { notice: "✅ تمت المحاسبة وانتقلت للأرشيف" };
  } else if (a === "invite") {
    const o = await liveOffice(body.id);
    extra = { invite: { officeId: o.id, ...await createInvite(o.id) } };
  } else if (a === "addUser") {
    const o = await liveOffice(body.id);
    const u = Number(toLatinDigits(String(body.user ?? "")).trim());
    need(Number.isSafeInteger(u) && u >= 10000, "رقم الحساب لازم أرقام بس");
    await put("office_users", { user_id: u, office_id: o.id, name: nameOf(body.name, 40, "اكتب اسم صاحب الحساب") });
    await send(u, `✅ تمت إضافتك لـ <b>${esc(o.name)}</b> بالبوت.\nاضغط زر «${BTN_OFFICE}» اللي جوة 👇`, { replyKb: await mainKb(u) });
    extra = { notice: "✅ انضاف الحساب" };
  } else if (a === "delUser") {
    const u = Number(body.user);
    need(await one("office_users", { user_id: u }), "الحساب غير موجود");
    await remove("office_users", { user_id: u });
    await send(u, "ℹ️ انشال حسابك من المكتبة.", { replyKb: await mainKb(u) });
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice: "", ...extra };
}
