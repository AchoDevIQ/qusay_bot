// صفحة المنتجات: الصلاحية، الحفظ، الحذف بدون مسح، والإضافة دفعة وحدة
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";

const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", SETTINGS_FILE: path.join(os.tmpdir(), "qmath-none") });

const { productAction } = await import("../lib/productApi.ts");
const { ApiError } = await import("../lib/webApi.ts");
const { adminMenuFor } = await import("../lib/admin.ts");
const { initDb, insert, one, put } = await import("../lib/db.ts");
const { cats, product } = await import("../lib/data.ts");
const { POST } = await import("../app/api/products/route.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const initData = sign(1);
const act = (body: Record<string, unknown>) => productAction({ initData, ...body });
const fails = (body: Record<string, unknown>, status: number, re?: RegExp) => assert.rejects(act(body), (e: any) => e instanceof ApiError && e.status === status && (!re || re.test(e.message)));
await initDb();

test("بدون توقيع أو صلاحية ممنوع", async () => {
  await put("staff", { user_id: 5, name: "م", perms: "orders" });
  await put("staff", { user_id: 6, name: "م", perms: "products" });
  await assert.rejects(productAction({ action: "list" }), (e: any) => e.status === 401);
  await assert.rejects(productAction({ action: "list", initData: sign(2) }), (e: any) => e.status === 403);
  await assert.rejects(productAction({ action: "del", id: 1, initData: sign(5) }), (e: any) => e.status === 403);
  assert.ok((await productAction({ action: "list", initData: sign(6) })).cats);
  const res = await POST(new Request("http://x/api/products", { method: "POST", body: JSON.stringify({ action: "list" }) }));
  assert.equal(res.status, 401);
});

test("قسم ومنتج: إضافة وتعديل وحذف، والطالب يشوف النتيجة", async () => {
  const { catId, cats: c0 } = await act({ action: "addCat", name: " ملازم " });
  assert.equal(c0.find((c: any) => c.id === catId).name, "ملازم");
  assert.equal((await cats()).some((c) => c.id === catId), false);                   // القسم الفارغ مخفي عن الطالب
  await fails({ action: "add", catId, name: "", price: 1 }, 400, /اسم/);
  await fails({ action: "add", catId, name: "س", price: "مية" }, 400, /السعر/);
  await fails({ action: "add", catId: 999, name: "س", price: 1 }, 400, /القسم/);
  const r = await act({ action: "add", catId, name: "ملزمة حضوري", price: "١٥,٠٠٠" });
  const p = r.cats.find((c: any) => c.id === catId).products[0];
  assert.deepEqual([p.price, p.mode], [15000, "in"]);                                // السعر بأي أرقام، والنوع من الاسم
  assert.equal((await act({ action: "add", catId, name: "دفتر حضوري", price: 1, mode: "online" })).cats.find((c: any) => c.id === catId).products[1].mode, "online");

  const { catId: other } = await act({ action: "addCat", name: "دفاتر" });
  await fails({ action: "save", id: p.id, name: "س", price: 1, mode: "x", catId }, 400, /نوع/);
  await act({ action: "save", id: p.id, name: "ملزمة", price: 9000, mode: "both", catId: other });
  const saved = await product(p.id);
  assert.deepEqual([saved!.name, saved!.price, saved!.mode, saved!.cat_id], ["ملزمة", 9000, "both", other]);

  await act({ action: "del", id: p.id });
  assert.equal(await product(p.id), null);
  assert.equal((await one("products", { id: p.id }))!.active, 0);                    // يبقى مخفي، ما ينمسح
  await fails({ action: "save", id: p.id, name: "س", price: 1, mode: "both", catId }, 400);
  await fails({ action: "del", id: p.id }, 400);
});

test("اسم القسم ما يتكرر، وحذف القسم يخفي منتجاته", async () => {
  const { catId: a } = await act({ action: "addCat", name: "أ" });
  const { catId: b } = await act({ action: "addCat", name: "ب" });
  await fails({ action: "renameCat", id: a, name: "ب" }, 400, /اسم/);
  await act({ action: "renameCat", id: a, name: "أأ" });
  assert.equal((await one("cats", { id: a }))!.name, "أأ");
  await act({ action: "add", catId: b, name: "م", price: 1 });
  const pid = (await act({ action: "list" })).cats.find((c: any) => c.id === b).products[0].id;
  const r = await act({ action: "delCat", id: b });
  assert.equal(r.cats.some((c: any) => c.id === b), false);
  assert.equal(await product(pid), null);
  await fails({ action: "delCat", id: b }, 400);
});

test("دفعة وحدة: يحسب الصحيح بس، ويرجع السطور الغلط", async () => {
  const r = await act({ action: "bulk", text: "# دفعة\nأولى = 5000\nبدون سعر\nثانية : ٦٠٠٠\n" });
  assert.deepEqual(r.added, ["أولى", "ثانية"]);
  assert.deepEqual(r.bad, ["بدون سعر"]);
  assert.equal(r.cats.find((c: any) => c.name === "دفعة").products.length, 2);
  await fails({ action: "bulk", text: "  " }, 400);
  await fails({ action: "زر" }, 400);
});

test("قائمة المدير تفتح الصفحة بدل شاشات الأزرار", async () => {
  const kb = (await adminMenuFor(1))[1].flat();
  assert.ok(kb.find((b) => b.text === "🛒 المنتجات والأقسام")?.web_app?.url.includes("/store/products"));
  assert.equal(kb.some((b) => ["a:bulk", "a:add", "a:list"].includes(b.callback_data ?? "")), false);
  assert.ok(kb.some((b) => b.callback_data === "a:fees"));                           // باقي الأقسام مثل ما هي
});
