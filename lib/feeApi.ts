// واجهة صفحة أسعار التوصيل
import { find, put, tx, type Row } from "./db.ts";
import { DEFAULT_FEE, GOVS } from "./config.ts";
import { PRODUCTS_PERM, parsePrice } from "./productApi.ts";
import { authed, need } from "./webApi.ts";

const MAX_FEE = 10_000_000;
const feeValue = (raw: unknown, label: string) => {
  const p = parsePrice(raw);
  need(p !== null && p <= MAX_FEE, `${label}: اكتب السعر أرقام فقط، مثل 5000`);
  return p!;
};
async function feeList() {
  const fees = new Map((await find("fees")).map((r) => [r.gov, r.fee]));
  return { fees: GOVS.map((gov) => ({ gov, fee: fees.get(gov) ?? DEFAULT_FEE })) };
}
async function saveFees(list: [string, number][]) {
  await tx(async () => { for (const [gov, fee] of list) await put("fees", { gov, fee }); });
}

export async function feeAction(body: Row) {
  await authed(body?.initData, PRODUCTS_PERM);
  const a = String(body.action ?? "");
  if (a === "save") {
    const entries = Object.entries((body.fees ?? {}) as Row);
    need(entries.length, "ما تغير شي");
    // يتفحص الكل قبل الحفظ، حتى ما ينحفظ نص التعديل
    const list = entries.map(([gov, v]): [string, number] => {
      need(GOVS.includes(gov), "محافظة غير معروفة");
      return [gov, feeValue(v, gov)];
    });
    await saveFees(list);
  } else if (a === "all") {
    const fee = feeValue(body.value, "السعر الموحد");
    await saveFees(GOVS.map((gov): [string, number] => [gov, fee]));
  } else need(a === "list", "أمر غير معروف");
  return await feeList();
}
