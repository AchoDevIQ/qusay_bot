// قاعدة البيانات (SQLite). نفس جداول بوت Python القديم، فيمكن استخدام نفس ملف store.db مباشرة.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, GOVS, DEFAULT_FEE } from "./config.ts";

export type Row = Record<string, any>;
type Param = string | number | bigint | null;

let _db: DatabaseSync | null = null;
export function db(): DatabaseSync {
  if (!_db) {
    if (DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  return _db;
}
export function closeDb() { _db?.close(); _db = null; }

const plain = (r: any): Row => ({ ...r });
export const all = (sql: string, ...p: Param[]): Row[] => db().prepare(sql).all(...p).map(plain);
export const get = (sql: string, ...p: Param[]): Row | null => {
  const r = db().prepare(sql).get(...p);
  return r ? plain(r) : null;
};
/** ينفذ أمر ويرجع رقم آخر صف مضاف */
export const run = (sql: string, ...p: Param[]): number => Number(db().prepare(sql).run(...p).lastInsertRowid);

export function modeFromName(name: string) {
  if (name.includes("حضوري")) return "in";
  if (name.includes("إلكتروني") || name.includes("الكتروني")) return "online";
  return "both";
}

function columns(table: string) { return all(`PRAGMA table_info(${table})`).map((r) => r.name as string); }
function addColumn(table: string, col: string, ddl: string) {
  if (!columns(table).includes(col)) db().exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

export function catIdFor(name: string) {
  name = name.trim();
  const r = get("SELECT id, active FROM cats WHERE name=?", name);
  if (r) { if (!r.active) run("UPDATE cats SET active=1 WHERE id=?", r.id); return r.id as number; }
  return run("INSERT INTO cats(name) VALUES(?)", name);
}

export function initDb() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS cats(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS fees(gov TEXT PRIMARY KEY, fee INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(user_id INTEGER PRIMARY KEY, state TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
      name TEXT, gov TEXT, side TEXT, area TEXT, phone1 TEXT, phone2 TEXT, items TEXT,
      subtotal INTEGER, fee INTEGER, total INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS students(user_id INTEGER PRIMARY KEY, username TEXT, name TEXT, curr TEXT, grade TEXT,
      gov TEXT, side TEXT, area TEXT, phone1 TEXT, phone2 TEXT, exam TEXT, center_id INTEGER, created TEXT, updated TEXT);
    CREATE TABLE IF NOT EXISTS areas(id INTEGER PRIMARY KEY AUTOINCREMENT, gov TEXT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS centers(id INTEGER PRIMARY KEY AUTOINCREMENT, area_id INTEGER, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS govmode(gov TEXT PRIMARY KEY, mode TEXT);
    CREATE TABLE IF NOT EXISTS chapters(id INTEGER PRIMARY KEY AUTOINCREMENT, ord INTEGER, ar TEXT, en TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER, ord INTEGER, ar TEXT, en TEXT,
      lectures INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chapter_id INTEGER, topic_id INTEGER,
      lecture INTEGER, status TEXT, thread_id INTEGER, created TEXT, updated TEXT);
    CREATE TABLE IF NOT EXISTS staff(user_id INTEGER PRIMARY KEY, name TEXT, perms TEXT);
    CREATE TABLE IF NOT EXISTS offices(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, lim INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS office_users(user_id INTEGER PRIMARY KEY, office_id INTEGER, name TEXT);
    CREATE TABLE IF NOT EXISTS settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, office_id INTEGER, amount INTEGER, n INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS staff_pay(id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, amount INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS qmsgs(id INTEGER PRIMARY KEY AUTOINCREMENT, qid INTEGER, kind TEXT, chat_id INTEGER, msg_id INTEGER);
  `);
  addColumn("orders", "curr", "TEXT");
  addColumn("orders", "printed", "INTEGER DEFAULT 0");
  addColumn("orders", "seller", "INTEGER");
  addColumn("orders", "office_id", "INTEGER");
  addColumn("orders", "settle_id", "INTEGER");
  addColumn("products", "cat_id", "INTEGER");
  addColumn("products", "mode", "TEXT");

  if (get("SELECT COUNT(*) n FROM products WHERE active=1 AND cat_id IS NULL")!.n) {
    run("UPDATE products SET cat_id=? WHERE cat_id IS NULL", catIdFor("منتجات أخرى"));
  }
  for (const r of all("SELECT id, name FROM products WHERE mode IS NULL")) {
    run("UPDATE products SET mode=? WHERE id=?", modeFromName(r.name), r.id);
  }
  for (const g of GOVS) {
    run("INSERT OR IGNORE INTO fees(gov, fee) VALUES(?, ?)", g, DEFAULT_FEE);
    run("INSERT OR IGNORE INTO govmode(gov, mode) VALUES(?,?)", g, g === "بغداد" ? "both" : "online");
  }
}

// ---------- مفاتيح/قيم عامة وجلسات
export const kvGet = (k: string): string | null => (get("SELECT v FROM kv WHERE k=?", k)?.v as string | undefined) ?? null;
export const kvSet = (k: string, v: string) => { run("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", k, v); };

export function getSession(uid: number): { state: string; data: Row } {
  const r = get("SELECT state, data FROM sessions WHERE user_id=?", uid);
  if (!r) return { state: "", data: {} };
  return { state: r.state || "", data: JSON.parse(r.data || "{}") };
}
export function setSession(uid: number, state: string, data: Row) {
  run("INSERT OR REPLACE INTO sessions(user_id, state, data) VALUES(?,?,?)", uid, state, JSON.stringify(data));
}
