// صفحة المساعدين: الإضافة، الصلاحيات، الحساب والدفعات. للمدير بس
import { find, insert, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { ADMIN_IDS, PERMS, toLatinDigits } from "./config.ts";
import { staffAccount } from "./data.ts";
import { parseAmount } from "./office.ts";
import { mainKb } from "./keyboards.ts";
import { send } from "./telegram.ts";
import { money, stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { allChapters, card, graders, payAction } from "./graderPay.ts";

const NAME_MAX = 60;
const nameOf = (raw: unknown) => {
  const t = String(raw ?? "").trim();
  need(t, "اكتب اسم المساعد");
  need(t.length <= NAME_MAX, "الاسم طويل، خليه أقصر");
  return t;
};
const amountOf = (raw: unknown) => {
  const a = parseAmount(String(raw ?? ""));
  need(a !== null && a >= 0, "اكتب مبلغ صحيح، مثل 10000000 أو 10 مليون");
  return a!;
};
async function pageData() {
  const rows = await find("staff", {}, { order: ["name"] });
  const graderIds = new Set(await graders());
  return {
    chapters: await allChapters(),
    perms: Object.entries(PERMS).map(([key, label]) => ({ key, label })),
    staff: await Promise.all(rows.map(async (s) => ({
      id: s.user_id, name: s.name, perms: String(s.perms ?? "").split(",").filter(Boolean), account: await staffAccount(s.user_id),
      // محفظة التصحيح: اللي إله على التصحيح، تطلع برا جنب اسمه ويندفع بضغطة
      grade: graderIds.has(s.user_id) ? await card(s.user_id) : null,
      pays: (await find("staff_pay", { staff_id: s.user_id }, { order: ["-id"], limit: 8 })).map((p) => ({ id: p.id, amount: p.amount, created: p.created })),
    }))),
  };
}
const liveStaff = async (id: number) => need(await one("staff", { user_id: id }), "المساعد غير موجود");

export async function staffAction(body: Row) {
  const me = await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let notice = "";
  if (a === "add") {
    const nid = Number(toLatinDigits(String(body.id ?? "")).trim());
    need(Number.isSafeInteger(nid) && nid >= 10000, "رقم الحساب لازم أرقام بس. خلي المساعد يكتب /myid بالبوت");
    need(!ADMIN_IDS.includes(nid), "هذا حساب المدير");
    need(!await one("staff", { user_id: nid }), "هذا المساعد موجود");
    await put("staff", { user_id: nid, name: nameOf(body.name), perms: "q" });
    await kvSet(`staff_since_${nid}`, stamp());
    await send(nid, "✅ تمت إضافتك مساعد بالبوت. اضغط الزر جوة 👇", { replyKb: await mainKb(nid) });
    notice = "✅ انضاف المساعد بصلاحية الأسئلة بس. لازم تضيفه هم لمجموعة الأسئلة";
  } else if (a === "rename") {
    await liveStaff(id);
    await update("staff", { user_id: id }, { name: nameOf(body.name) });
  } else if (a === "perms") {
    await liveStaff(id);
    const list = Array.isArray(body.perms) ? (body.perms as unknown[]).map(String) : [];
    need(list.every((p) => p in PERMS), "صلاحية غير معروفة");
    await update("staff", { user_id: id }, { perms: [...new Set(list)].sort().join(",") });
    notice = "✅ انحفظت الصلاحيات";
  } else if (a === "del") {
    await liveStaff(id);
    await remove("staff", { user_id: id });
    // يختفي زر اللوحة من عنده هسه، مو لحد ما يكتب /start
    await send(id, "ℹ️ انشال حسابك من المساعدين.", { replyKb: await mainKb(id) });
  } else if (a === "pay") {
    await liveStaff(id);
    const amt = amountOf(body.amount);
    need(amt > 0, "اكتب المبلغ");
    await insert("staff_pay", { staff_id: id, amount: amt, created: stamp() });
    await send(id, `✅ قصي العميري سجّل استلام <b>${money(amt)}</b> منك.\n🔴 باقي بذمتك: <b>${money((await staffAccount(id)).owed)}</b>`);
    notice = "✅ انسجلت الدفعة";
  } else if (a === "limit") {
    await liveStaff(id);
    await kvSet(`limit_${id}`, String(amountOf(body.amount)));
    notice = "✅ انحفظ الرصيد المسموح";
  } else if (a === "gradePay" || a === "gradeRate") {
    await liveStaff(id);
    notice = await payAction(me, { ...body, grader: id, action: a === "gradePay" ? "settle" : "setRate" });
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
