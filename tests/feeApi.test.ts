// صفحة أسعار التوصيل، على SQLite وعلى Firestore
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";

const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", SETTINGS_FILE: path.join(os.tmpdir(), "qmath-none") });

const { feeAction } = await import("../lib/feeApi.ts");
const { ApiError } = await import("../lib/webApi.ts");
const dbm = await import("../lib/db.ts");
const { feeOf } = await import("../lib/data.ts");
const { sqliteDriver } = await import("../lib/sqliteDriver.ts");
const { firestoreDriver } = await import("../lib/firestoreDriver.ts");
const { fakeFirestore } = await import("./fakeFirestore.ts");
const { GOVS, DEFAULT_FEE } = await import("../lib/config.ts");
const { POST } = await import("../app/api/fees/route.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const initData = sign(1);
const act = (body: Record<string, unknown>) => feeAction({ initData, ...body });
const fails = (body: Record<string, unknown>, re: RegExp) => assert.rejects(act(body), (e: any) => e instanceof ApiError && e.status === 400 && re.test(e.message));
const fake = fakeFirestore();
const drivers = { SQLite: sqliteDriver, Firestore: firestoreDriver(() => fake.db) };

for (const [name, d] of Object.entries(drivers)) {
  test(`${name}: حفظ محافظات، وخطأ وحدة ما يحفظ الباقي، وسعر موحد`, async () => {
    dbm.setDriver(d);
    await dbm.initDb();
    const first = (await act({ action: "list" })).fees;
    assert.deepEqual(first.map((f: any) => f.gov), GOVS);
    assert.equal(first[0].fee, DEFAULT_FEE);

    const r = await act({ action: "save", fees: { "بغداد": "٣,٠٠٠", "البصرة": 7000 } });
    assert.deepEqual([r.fees[0].fee, r.fees[1].fee, r.fees[2].fee], [3000, 7000, DEFAULT_FEE]);
    assert.equal(await feeOf("بغداد"), 3000);                                         // الطالب يشوف السعر الجديد

    await fails({ action: "save", fees: { "نينوى": 1000, "البصرة": "abc" } }, /البصرة/);
    assert.equal(await feeOf("نينوى"), DEFAULT_FEE);
    await fails({ action: "save", fees: { "لندن": 1000 } }, /محافظة/);
    await fails({ action: "save", fees: { "بغداد": "" } }, /بغداد/);
    await fails({ action: "save", fees: {} }, /تغير/);
    await fails({ action: "all", value: "x" }, /السعر/);
    await fails({ action: "زر" }, /معروف/);

    const all = await act({ action: "all", value: "6000" });
    assert.ok(all.fees.every((f: any) => f.fee === 6000));
    assert.equal(all.fees.length, GOVS.length);
  });
}

test("الصلاحية", async () => {
  dbm.setDriver(sqliteDriver);
  await dbm.put("staff", { user_id: 5, name: "م", perms: "orders" });
  await dbm.put("staff", { user_id: 6, name: "م", perms: "fees" });
  await assert.rejects(feeAction({ action: "list" }), (e: any) => e.status === 401);
  await assert.rejects(feeAction({ action: "all", value: 1, initData: sign(2) }), (e: any) => e.status === 403);
  await assert.rejects(feeAction({ action: "all", value: 1, initData: sign(5) }), (e: any) => e.status === 403);
  assert.ok((await feeAction({ action: "list", initData: sign(6) })).fees);
  assert.equal((await POST(new Request("http://x/api/fees", { method: "POST", body: "{}" }))).status, 401);

});
