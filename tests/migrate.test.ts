// ملف store.db من نسخة بايثون قديمة (قبل الأقسام والتسجيل) لازم ينفتح ويترقى بدون ما يضيع شي
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-migrate-"));
const file = path.join(tmp, "store.db");
const old = new DatabaseSync(file);
old.exec(`
  CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER, active INTEGER DEFAULT 1);
  CREATE TABLE fees(gov TEXT PRIMARY KEY, fee INTEGER);
  CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, name TEXT, gov TEXT, side TEXT, area TEXT,
    phone1 TEXT, phone2 TEXT, items TEXT, subtotal INTEGER, fee INTEGER, total INTEGER, created TEXT);
  INSERT INTO products(name, price) VALUES('ملزمة حضوري', 15000), ('ملزمة إلكتروني', 10000), ('كتاب', 5000);
  INSERT INTO fees VALUES('بغداد', 3000);
  INSERT INTO orders(user_id, name, gov, items, subtotal, fee, total, created) VALUES(2, 'علي', 'بغداد', '[]', 1, 2, 3, '2025-01-01 10:00');
`);
old.close();
process.env.DB_PATH = file;
const { initDb } = await import("../lib/db.ts");
const { all, closeDb, get } = await import("../lib/sqliteDriver.ts");

test("الترقية تحفظ البيانات وتضيف الأعمدة والأقسام", async () => {
  await initDb();
  assert.deepEqual((await all("SELECT name, mode FROM products ORDER BY id")).map((p) => [p.name, p.mode]),
    [["ملزمة حضوري", "in"], ["ملزمة إلكتروني", "online"], ["كتاب", "both"]]);
  const cat = (await get("SELECT id FROM cats WHERE name='منتجات أخرى'"))!.id;
  assert.equal((await get("SELECT COUNT(*) n FROM products WHERE cat_id=?", cat))!.n, 3);
  assert.equal((await get("SELECT fee FROM fees WHERE gov='بغداد'"))!.fee, 3000);   // ما يرجع للافتراضي
  assert.equal((await get("SELECT fee FROM fees WHERE gov='البصرة'"))!.fee, 5000);
  const o = (await get("SELECT * FROM orders"))!;
  assert.equal(o.total, 3);
  assert.equal(o.printed, 0);
  assert.equal(o.curr, null);
  await initDb();                                                                 // مرة ثانية ما يغير شي
  assert.equal((await get("SELECT COUNT(*) n FROM cats"))!.n, 1);
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});
