// العمليات اللي بيها أكثر من كتابة، على Firestore الصارم (يعيد العملية ويمنع القراءة بعد الكتابة)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-fs-"));
const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const dbm = await import("../lib/db.ts");
const { firestoreDriver } = await import("../lib/firestoreDriver.ts");
const { fakeFirestore } = await import("./fakeFirestore.ts");
const { centerAction } = await import("../lib/centerApi.ts");
const { productAction } = await import("../lib/productApi.ts");
const { libAction } = await import("../lib/libApi.ts");
const { orderAction, salesAction } = await import("../lib/orderApi.ts");
const { curriculumAction } = await import("../lib/settingsApi.ts");
const { staffAction } = await import("../lib/staffApi.ts");
const { adminHomeAction } = await import("../lib/adminHomeApi.ts");
const { stamp } = await import("../lib/util.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const initData = sign(1);
const fake = fakeFirestore();
dbm.setDriver(firestoreDriver(() => fake.db));
await dbm.initDb();

test("كل الصفحات تشتغل على Firestore", async () => {
  assert.ok((await adminHomeAction({ action: "list", initData })).groups.length);

  const area = await centerAction({ action: "addArea", gov: "بغداد", name: "تجربة", center: "مركز", initData });
  const a = area.areas.find((x: any) => x.name === "تجربة");
  assert.equal(a.centers.length, 1);
  await centerAction({ action: "delArea", id: a.id, initData });

  const { catId } = await productAction({ action: "addCat", name: "قسم", initData });
  const p = await productAction({ action: "add", catId, name: "امتحانات الفصل الأول", price: 1000, initData });
  const pid = p.cats.find((c: any) => c.id === catId).products[0].id;
  assert.deepEqual((await productAction({ action: "bulk", text: "# دفعة\nأ = 1\nب = 2", initData })).added, ["أ", "ب"]);

  await dbm.put("students", { user_id: 100, username: "", name: "علي حسن محمد كاظم", curr: "عربي", grade: "السادس العلمي", gov: "بغداد", side: "", area: "س", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", center_id: null, created: stamp(), updated: "" });
  const sold = await salesAction({ action: "sale", sid: 100, items: [[pid, 1]], initData });
  assert.equal(sold.total, 1000);

  const list = (await curriculumAction({ action: "list", initData })).chapters;
  list[0].ar = "اسم جديد";
  assert.equal((await curriculumAction({ action: "save", chapters: list, initData })).chapters[0].ar, "اسم جديد");

  const { openId } = await libAction({ action: "add", name: "مكتبة", initData });
  await dbm.insert("orders", { user_id: 100, name: "ع", gov: "م", area: "م", phone1: "1", phone2: "2", items: "[]", subtotal: 5, fee: 0, total: 5, created: stamp(), printed: 3, seller: 1, office_id: openId });
  const settled = await libAction({ action: "settle", id: openId, amount: 5, initData });
  assert.equal(settled.offices[0].archive.length, 1);
  await libAction({ action: "del", id: openId, initData });

  const oid = await dbm.insert("orders", { user_id: 100, name: "ع", gov: "م", side: "", area: "م", phone1: "1", phone2: "2", items: "[]", subtotal: 5, fee: 0, total: 5, created: stamp(), printed: 0 });
  await orderAction({ action: "done", ids: [oid], initData });
  assert.equal((await dbm.one("orders", { id: oid }))!.printed, 1);

  await staffAction({ action: "add", id: "12345", name: "س", initData });
  await staffAction({ action: "pay", id: 12345, amount: "5", initData });
  await staffAction({ action: "del", id: 12345, initData });
});
