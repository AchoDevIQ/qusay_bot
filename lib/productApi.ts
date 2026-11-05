// واجهة صفحة المنتجات والأقسام. المنتج المحذوف يبقى مخفي، لأن الطلبات القديمة تحفظ اسمه وسعره لوحدها
import { catIdFor, find, insert, modeFromName, one, tx, update, type Row } from "./db.ts";
import { toLatinDigits } from "./config.ts";
import { allCats } from "./data.ts";
import { authed, need } from "./webApi.ts";

export const PRODUCTS_PERM = "products";
const MODES = ["both", "in", "online"];
const MAX_NAME = 120, MAX_PRICE = 100_000_000;

export function parsePrice(raw: unknown) {
  const t = toLatinDigits(String(raw ?? "")).replace(/[,،٬. ]/g, "").replace(/(دينار|د\.ع|IQD)$/, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}
const priceOf = (raw: unknown) => {
  const p = parsePrice(raw);
  need(p !== null && p <= MAX_PRICE, "اكتب السعر أرقام فقط، مثل 15000");
  return p!;
};
const textOf = (raw: unknown, label: string) => {
  const t = String(raw ?? "").trim();
  need(t, label);
  need(t.length <= MAX_NAME, "الاسم طويل، خليه أقصر");
  return t;
};
const modeOf = (raw: unknown) => { need(MODES.includes(String(raw)), "اختار نوع المنتج"); return String(raw); };
const liveCat = async (raw: unknown) => {
  const id = Number(raw);
  need(await one("cats", { id, active: 1 }), "القسم غير موجود");
  return id;
};

/** يضيف منتجات من نص: سطر # اسم قسم، وكل منتج بسطر «الاسم = السعر» */
export async function bulkAdd(text: string) {
  const added: string[] = [], bad: string[] = [];
  let cur: number | null = null;
  await tx(async () => {
    // Firestore ممكن يعيد العملية، فتبدي من الصفر كل مرة
    added.length = 0;
    bad.length = 0;
    cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) {
        const name = line.replace(/^#+/, "").trim();
        cur = name ? await catIdFor(name) : null;
        continue;
      }
      const m = line.match(/^(.+?)\s*[=:]\s*([\d٠-٩۰-۹,،٬.\s]+)\s*(دينار|د\.ع)?\s*$/);
      const pr = m ? parsePrice(m[2]) : null;
      if (!m || pr === null) { bad.push(line); continue; }
      cur ??= await catIdFor("منتجات أخرى");
      await insert("products", { name: m[1].trim(), price: pr, cat_id: cur, mode: modeFromName(m[1]) });
      added.push(m[1].trim());
    }
  });
  return { added, bad };
}

async function productList() {
  const products = await find("products", { active: 1 }, { order: ["id"] });
  return (await allCats()).map((c) => ({
    id: c.id, name: c.name,
    products: products.filter((p) => p.cat_id === c.id).map((p) => ({ id: p.id, name: p.name, price: p.price, mode: p.mode || "both", hidden: !!p.hidden })),
  }));
}

export async function productAction(body: Row) {
  await authed(body?.initData, PRODUCTS_PERM);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let extra: Row = {};
  if (a === "list") {
    // بس يرجع القائمة
  } else if (a === "addCat") {
    const name = textOf(body.name, "اكتب اسم القسم");
    extra = { catId: await tx(async () => await catIdFor(name)) };
  } else if (a === "renameCat") {
    const name = textOf(body.name, "اكتب اسم القسم");
    await liveCat(id);
    const same = await one("cats", { name });
    need(!same || same.id === id, "اكو قسم ثاني بهذا الاسم");
    await update("cats", { id }, { name });
  } else if (a === "delCat") {
    await liveCat(id);
    await tx(async () => {
      await update("cats", { id }, { active: 0 });
      await update("products", { cat_id: id }, { active: 0 });
    });
  } else if (a === "add") {
    const name = textOf(body.name, "اكتب اسم المنتج");
    const price = priceOf(body.price);
    const cat_id = await liveCat(body.catId);
    // بدون اختيار، النوع ينعرف من الاسم مثل ما كان
    await insert("products", { name, price, cat_id, mode: body.mode ? modeOf(body.mode) : modeFromName(name) });
  } else if (a === "save") {
    need(await one("products", { id, active: 1 }), "المنتج غير موجود");
    await update("products", { id }, { name: textOf(body.name, "اكتب اسم المنتج"), price: priceOf(body.price), mode: modeOf(body.mode), cat_id: await liveCat(body.catId) });
  } else if (a === "del") {
    need(await one("products", { id, active: 1 }), "المنتج غير موجود");
    await update("products", { id }, { active: 0 });
  } else if (a === "hide") {
    // الإخفاء من المتجر فقط: اللي اشترى قبل تبقى مشترياته وطلباته مثل ما هي
    need(await one("products", { id, active: 1 }), "المنتج غير موجود");
    await update("products", { id }, { hidden: body.hidden ? 1 : 0 });
  } else if (a === "hideCat") {
    await liveCat(id);
    await update("products", { cat_id: id }, { hidden: body.hidden ? 1 : 0 });
  } else if (a === "bulk") {
    need(String(body.text ?? "").trim(), "اكتب المنتجات");
    extra = await bulkAdd(String(body.text));
  } else need(false, "أمر غير معروف");
  return { cats: await productList(), ...extra };
}
