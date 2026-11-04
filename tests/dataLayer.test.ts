// طبقة البيانات: نفس السلوك على SQLite و Firestore
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-layer-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:x", ADMIN: "1", SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_PROJECT_ID;

const dbm = await import("../lib/db.ts");
const { firestoreDriver, setCounter } = await import("../lib/firestoreDriver.ts");
const { sqliteDriver, sqliteTables } = await import("../lib/sqliteDriver.ts");
const { SCHEMA, keyCols } = await import("../lib/schema.ts");
const { fakeFirestore } = await import("./fakeFirestore.ts");

const fake = fakeFirestore();
const drivers = { SQLite: sqliteDriver, Firestore: firestoreDriver(() => fake.db) };

test("schema.ts مطابق لجداول SQLite", async () => {
  await sqliteDriver.init();
  const real = await sqliteTables();
  for (const [t, def] of Object.entries(SCHEMA)) {
    assert.deepEqual([...keyCols(t), ...Object.keys(def.cols)].sort(), [...real[t]].sort(), t);
  }
});

for (const [name, d] of Object.entries(drivers)) {
  const fresh = async () => {
    dbm.setDriver(d);
    await dbm.remove("staff_pay", {});
    await dbm.remove("kv", {});
    await dbm.remove("exam_access", {});
    await dbm.remove("orders", {});
  };

  test(`${name}: الإضافة ترجع رقم، والبحث والترتيب والحد`, async () => {
    await fresh();
    const a = await dbm.insert("staff_pay", { staff_id: 1, amount: 5, created: "b" });
    const b = await dbm.insert("staff_pay", { staff_id: 1, amount: 7, created: "a" });
    await dbm.insert("staff_pay", { staff_id: 2, amount: 9, created: null });
    assert.ok(b > a);
    assert.deepEqual((await dbm.find("staff_pay", { staff_id: 1 })).map((r) => r.amount), [5, 7]);
    assert.deepEqual((await dbm.find("staff_pay", {}, { order: ["-id"], limit: 2 })).map((r) => r.amount), [9, 7]);
    assert.deepEqual((await dbm.find("staff_pay", {}, { order: ["created"] })).map((r) => r.amount), [9, 7, 5]);   // الفارغ أول
    assert.equal((await dbm.one("staff_pay", { created: null }))!.amount, 9);
    assert.equal(dbm.sumOf(await dbm.find("staff_pay", { staff_id: 1 }), "amount"), 12);
    assert.equal(await dbm.count("staff_pay", {}, { where: (r) => r.amount > 6 }), 2);
    assert.equal(await dbm.one("staff_pay", { id: a, staff_id: 99 }), null);
    assert.deepEqual(await dbm.find("staff_pay", { id: Number("x") }), []);          // زر مزور
  });

  test(`${name}: القيم الابتدائية للأعمدة`, async () => {
    await fresh();
    const id = await dbm.insert("orders", { user_id: 1, created: "x" });
    const o = (await dbm.one("orders", { id }))!;
    assert.deepEqual([o.printed, o.settle_id], [0, null]);
    assert.equal((await dbm.find("orders", { settle_id: null })).length, 1);         // يلگاه بالبحث عن الفارغ
  });

  test(`${name}: التعديل والحذف يرجعون العدد، والشرط يتفحص`, async () => {
    await fresh();
    const id = await dbm.insert("orders", { user_id: 1, printed: 1, created: "x" });
    assert.equal(await dbm.update("orders", { id }, { printed: 2 }, { where: (r) => !r.printed }), 0);
    assert.equal((await dbm.one("orders", { id }))!.printed, 1);
    assert.equal(await dbm.update("orders", { id }, (r) => ({ printed: r.printed + 2 })), 1);
    assert.equal((await dbm.one("orders", { id }))!.printed, 3);
    assert.equal(await dbm.remove("orders", { id }), 1);
    assert.equal(await dbm.one("orders", { id }), null);
  });

  test(`${name}: مفتاح مركب، والرموز الخاصة بالمفتاح، والإضافة بدون تكرار`, async () => {
    await fresh();
    await dbm.insertIgnore("exam_access", { user_id: 1, chapter: "الفصل / الأول" }, { order_id: 5 });
    await dbm.insertIgnore("exam_access", { user_id: 1, chapter: "الفصل / الأول" }, { order_id: 9 });
    assert.equal((await dbm.find("exam_access", { user_id: 1 })).length, 1);
    assert.equal((await dbm.one("exam_access", { user_id: 1, chapter: "الفصل / الأول" }))!.order_id, 5);
    await dbm.kvSet("a/b|c", "1");
    await dbm.kvSet("a/b|c", "2");
    assert.equal(await dbm.kvGet("a/b|c"), "2");
    assert.equal(await dbm.kvGet("none"), null);
  });

  test(`${name}: الخطأ داخل العملية يرجع كلشي، والقراءة تشوف كتابات نفس العملية`, async () => {
    await fresh();
    await assert.rejects(dbm.tx(async () => {
      await dbm.kvSet("t", "1");
      assert.equal(await dbm.kvGet("t"), "1");
      assert.equal((await dbm.find("kv", { v: "1" })).length, 1);
      const id = await dbm.insert("staff_pay", { staff_id: 7, amount: 1 });
      assert.equal((await dbm.one("staff_pay", { id }))!.staff_id, 7);
      await dbm.remove("kv", { k: "t" });
      assert.equal(await dbm.kvGet("t"), null);
      await dbm.kvSet("t", "2");
      throw new Error("وقف");
    }), /وقف/);
    assert.equal(await dbm.kvGet("t"), null);
    assert.deepEqual(await dbm.find("staff_pay", { staff_id: 7 }), []);
  });

  test(`${name}: إضافتين بعملية وحدة ياخذن رقمين مختلفين`, async () => {
    await fresh();
    const [a, b] = await dbm.tx(async () => [await dbm.insert("staff_pay", { staff_id: 8 }), await dbm.insert("staff_pay", { staff_id: 8 })]);
    assert.notEqual(a, b);
    assert.equal((await dbm.find("staff_pay", { staff_id: 8 })).length, 2);
  });
}

test("Firestore: الأرقام تترتب كأرقام مو كنص، والعداد يكمل بعد النقل", async () => {
  const f = fakeFirestore();
  const d = firestoreDriver(() => f.db);
  dbm.setDriver(d);
  for (const id of [10, 9, 100]) await d.put("staff_pay", { id, amount: id });
  assert.deepEqual((await dbm.find("staff_pay")).map((r) => r.id), [9, 10, 100]);
  await setCounter(() => f.db, "staff_pay", 100);
  assert.equal(await dbm.insert("staff_pay", { amount: 1 }), 101);
});

test("Firestore: البحث بالمفتاح يقرا وثيقة وحدة بس", async () => {
  const f = fakeFirestore();
  dbm.setDriver(firestoreDriver(() => f.db));
  for (let i = 0; i < 20; i++) await dbm.put("kv", { k: "k" + i, v: "x" });
  f.stats.reads = 0;
  await dbm.kvGet("k5");
  assert.equal(f.stats.reads, 1);
});

test("نسخ store.db إلى Firestore: نفس الأرقام، والعداد يكمل، وما يكتب فوق بيانات موجودة", async () => {
  const { copyToFirestore } = await import("../lib/copyData.ts");
  const f = fakeFirestore();
  const rows: Record<string, any[]> = {
    orders: [{ id: 3, user_id: 1, printed: 1 }, { id: 7, user_id: 2, printed: null }],
    kv: [{ k: "a/b", v: "1" }],
    exam_access: [{ user_id: 1, chapter: "الفصل", order_id: 3, created: "x" }],
  };
  const counts = await copyToFirestore(async (t) => rows[t] ?? [], () => f.db);
  assert.deepEqual([counts.orders, counts.kv, counts.exam_access], [2, 1, 1]);
  dbm.setDriver(firestoreDriver(() => f.db));
  assert.equal((await dbm.one("orders", { id: 7 }))!.user_id, 2);
  assert.equal(await dbm.kvGet("a/b"), "1");
  assert.equal((await dbm.one("exam_access", { user_id: 1, chapter: "الفصل" }))!.order_id, 3);
  assert.equal(await dbm.insert("orders", { user_id: 9 }), 8);
  await assert.rejects(copyToFirestore(async (t) => rows[t] ?? [], () => f.db), /--force/);
  await copyToFirestore(async (t) => rows[t] ?? [], () => f.db, { force: true });
});

test("Firestore: القيم الأولى تنكتب مرة وحدة", async () => {
  const f = fakeFirestore();
  dbm.setDriver(firestoreDriver(() => f.db));
  await dbm.initDb();
  assert.ok(await dbm.one("fees"));
  await dbm.update("fees", {}, { fee: 1 });
  await dbm.remove("areas", {});
  await dbm.initDb();
  assert.equal(await dbm.one("areas"), null);
});
