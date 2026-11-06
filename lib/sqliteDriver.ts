// SQLite للتشغيل على الحاسبة وللفحوصات. نفس جداول بوت Python القديم، فيمكن استخدام نفس ملف store.db مباشرة
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config.ts";
import { SCHEMA, keyCols } from "./schema.ts";
import type { Driver, Row } from "./types.ts";

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

// الأوامر المباشرة للفحوصات والنقل بس. البوت يستخدم db.ts
const plain = (r: any): Row => ({ ...r });
export const all = async (sql: string, ...p: Param[]): Promise<Row[]> => db().prepare(sql).all(...p).map(plain);
export const get = async (sql: string, ...p: Param[]): Promise<Row | null> => {
  const r = db().prepare(sql).get(...p);
  return r ? plain(r) : null;
};
export const run = async (sql: string, ...p: Param[]): Promise<number> => Number(db().prepare(sql).run(...p).lastInsertRowid);

async function addColumn(table: string, col: string, ddl: string) {
  if (!(await all(`PRAGMA table_info(${table})`)).some((r) => r.name === col)) db().exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

async function init() {
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
    CREATE TABLE IF NOT EXISTS student_pass(user_id INTEGER PRIMARY KEY, hash TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS pass_requests(user_id INTEGER PRIMARY KEY, created TEXT);
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
    CREATE TABLE IF NOT EXISTS bank_exams(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, chapter TEXT, ord INTEGER, title TEXT, info TEXT, minutes INTEGER, UNIQUE(slug, ord));
    CREATE TABLE IF NOT EXISTS bank_versions(id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, model TEXT, kind TEXT DEFAULT 'mandatory', ok INTEGER DEFAULT 1, issues TEXT, has_en INTEGER DEFAULT 0, UNIQUE(exam_id, model));
    CREATE TABLE IF NOT EXISTS bank_questions(id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER, n INTEGER, max_mark INTEGER, q_file TEXT, a_files TEXT, edited INTEGER DEFAULT 0, UNIQUE(version_id, n));
    CREATE TABLE IF NOT EXISTS bank_edits(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, what TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS exam_access(user_id INTEGER, chapter TEXT, order_id INTEGER, created TEXT, PRIMARY KEY(user_id, chapter));
    CREATE TABLE IF NOT EXISTS order_codes(code TEXT PRIMARY KEY, order_id INTEGER UNIQUE, chapters TEXT, used_at TEXT);
    CREATE TABLE IF NOT EXISTS schedules(user_id INTEGER PRIMARY KEY, start_day TEXT, end_day TEXT, weekdays TEXT, hour INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS place_slots(center_id INTEGER PRIMARY KEY, slots TEXT);
    CREATE TABLE IF NOT EXISTS place_dates(center_id INTEGER, exam_id INTEGER, day TEXT, versions TEXT, PRIMARY KEY(center_id, exam_id));
    CREATE TABLE IF NOT EXISTS grade_comments(id INTEGER PRIMARY KEY AUTOINCREMENT, lo INTEGER, hi INTEGER, text TEXT, sticker_id INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS stickers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, file TEXT, lo INTEGER, hi INTEGER, created TEXT);
    CREATE TABLE IF NOT EXISTS comment_sent(user_id INTEGER, comment_id INTEGER, at TEXT, PRIMARY KEY(user_id, comment_id));
    CREATE TABLE IF NOT EXISTS objections(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, user_id INTEGER, q INTEGER, text TEXT, voice TEXT, status TEXT, old_mark INTEGER, new_mark INTEGER, reason TEXT, created TEXT, decided_at TEXT, decided_by INTEGER, paid_id INTEGER);
    CREATE TABLE IF NOT EXISTS center_rent(id INTEGER PRIMARY KEY AUTOINCREMENT, center_id INTEGER, month TEXT, students INTEGER, price INTEGER, amount INTEGER, created TEXT, by_id INTEGER);
    CREATE TABLE IF NOT EXISTS student_stops(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chapter TEXT, block INTEGER, score INTEGER, max INTEGER, need INTEGER, absent INTEGER, reason TEXT, lectures INTEGER, created TEXT, lifted TEXT, lifted_by INTEGER);
    CREATE TABLE IF NOT EXISTS checkpoint_done(user_id INTEGER, chapter TEXT, block INTEGER, passed INTEGER, score INTEGER, absent INTEGER, created TEXT, PRIMARY KEY(user_id, chapter, block));
    CREATE TABLE IF NOT EXISTS student_devices(user_id INTEGER PRIMARY KEY, device TEXT, at TEXT, tried TEXT);
    CREATE TABLE IF NOT EXISTS grader_pay(user_id INTEGER PRIMARY KEY, mandatory INTEGER, optional INTEGER, deduct INTEGER, chapters TEXT, exams_off TEXT, places TEXT);
    CREATE TABLE IF NOT EXISTS grader_settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, n_mand INTEGER, n_opt INTEGER, n_obj INTEGER, amount INTEGER, forgiven INTEGER, created TEXT, by_id INTEGER);
    CREATE TABLE IF NOT EXISTS paper_ink(item_id INTEGER, page INTEGER, ink TEXT, PRIMARY KEY(item_id, page));
    CREATE TABLE IF NOT EXISTS question_marks(item_id INTEGER, q INTEGER, mark INTEGER, PRIMARY KEY(item_id, q));
    CREATE TABLE IF NOT EXISTS exam_answers(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, q INTEGER, file TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS sched_items(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, exam_id INTEGER, at TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, what TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS guardians(guardian_id INTEGER, student_id INTEGER, created TEXT, PRIMARY KEY(guardian_id, student_id));
    CREATE TABLE IF NOT EXISTS company_settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER, to_id INTEGER, n INTEGER, gross INTEGER, fees INTEGER, net INTEGER, created TEXT);
  `);
  await addColumn("orders", "curr", "TEXT");
  await addColumn("grader_settlements", "forgiven", "INTEGER");
  await addColumn("orders", "printed", "INTEGER DEFAULT 0");
  await addColumn("orders", "seller", "INTEGER");
  await addColumn("orders", "office_id", "INTEGER");
  await addColumn("orders", "settle_id", "INTEGER");
  await addColumn("orders", "printed_by", "INTEGER");
  await addColumn("orders", "printed_at", "TEXT");
  await addColumn("products", "ask", "INTEGER");
  await addColumn("products", "cat_id", "INTEGER");
  await addColumn("products", "mode", "TEXT");
  await addColumn("products", "hidden", "INTEGER DEFAULT 0");
  await addColumn("bank_exams", "manual", "INTEGER DEFAULT 0");
  await addColumn("bank_versions", "manual", "INTEGER DEFAULT 0");
  await addColumn("bank_versions", "pdf_ar", "TEXT");
  await addColumn("bank_versions", "pdf_en", "TEXT");
  await addColumn("bank_exams", "pos", "INTEGER");
  await addColumn("bank_exams", "group_versions", "TEXT");
  await addColumn("students", "gender", "TEXT");
  await addColumn("centers", "gender", "TEXT");
  await addColumn("sched_items", "version_id", "INTEGER");
  for (const c of ["grader_id", "total"]) await addColumn("sched_items", c, "INTEGER");
  for (const c of ["graded_at", "kind"]) await addColumn("sched_items", c, "TEXT");
  await addColumn("sched_items", "paid_id", "INTEGER");
  await addColumn("sched_items", "attended_at", "TEXT");
  await addColumn("sched_items", "attended_by", "INTEGER");
  for (const c of ["exc_state", "exc_reason", "exc_at"]) await addColumn("sched_items", c, "TEXT");
  await addColumn("sched_items", "exc_by", "INTEGER");
  await addColumn("grader_pay", "exams_off", "TEXT");
  await addColumn("grader_pay", "places", "TEXT");
  for (const c of ["started_at", "submitted_at", "opened_at", "notified"]) await addColumn("sched_items", c, "TEXT");
  await addColumn("schedules", "mode", "TEXT");
  await addColumn("schedules", "center_id", "INTEGER");
  await addColumn("schedules", "picks", "TEXT");
  await addColumn("bank_versions", "pages_ar", "TEXT");
  await addColumn("bank_versions", "pages_en", "TEXT");
  await addColumn("bank_versions", "answer_pdf", "TEXT");
}

const inTx = new AsyncLocalStorage<boolean>();
let txTail: Promise<unknown> = Promise.resolve();

export const sqliteDriver: Driver = {
  init,
  async list(table, eq) {
    const fields = Object.entries(eq);
    const where = fields.map(([k, v]) => (v === null ? `${k} IS NULL` : `${k}=?`)).join(" AND ");
    return all(`SELECT * FROM ${table}${where ? " WHERE " + where : ""}`, ...fields.map(([, v]) => v).filter((v) => v !== null));
  },
  async insert(table, row) {
    const cols = Object.keys(row);
    if (!cols.length) throw new Error("صف فارغ");
    return run(`INSERT INTO ${table}(${cols.join(", ")}) VALUES(${cols.map(() => "?").join(",")})`, ...Object.values(row));
  },
  async put(table, row) {
    const cols = Object.keys(row);
    await run(`INSERT OR REPLACE INTO ${table}(${cols.join(", ")}) VALUES(${cols.map(() => "?").join(",")})`, ...Object.values(row));
  },
  async patch(table, key, fields) {
    const sets = Object.keys(fields).map((k) => `${k}=?`).join(", ");
    await run(`UPDATE ${table} SET ${sets} WHERE ${keyCols(table).map((k) => `${k}=?`).join(" AND ")}`, ...Object.values(fields), ...(key as Param[]));
  },
  async del(table, key) {
    await run(`DELETE FROM ${table} WHERE ${keyCols(table).map((k) => `${k}=?`).join(" AND ")}`, ...(key as Param[]));
  },
  tx(fn) {
    if (inTx.getStore()) return fn();
    // SQLite يتحمل عملية وحدة بنفس الوقت، فالبقية تنتظر
    const go = () => inTx.run(true, async () => {
      db().exec("BEGIN");
      try { const r = await fn(); db().exec("COMMIT"); return r; }
      catch (e) { db().exec("ROLLBACK"); throw e; }
    });
    const result = txTail.then(go, go);
    txTail = result.catch(() => {});
    return result;
  },
};

/** أسماء أعمدة الجداول مثل ما بقاعدة البيانات، لفحص تطابقها مع schema.ts */
export const sqliteTables = async () => Object.fromEntries(await Promise.all(Object.keys(SCHEMA).map(async (t) => [t, (await all(`PRAGMA table_info(${t})`)).map((c) => c.name as string)])));
