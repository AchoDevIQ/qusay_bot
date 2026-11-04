// قاعدة البيانات (SQLite). نفس جداول بوت Python القديم، فيمكن استخدام نفس ملف store.db مباشرة.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, GOVS, DEFAULT_FEE, SEED_CENTERS, SEED_CURRIC, toLatinDigits } from "./config.ts";

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
export const all = async (sql: string, ...p: Param[]): Promise<Row[]> => db().prepare(sql).all(...p).map(plain);
export const get = async (sql: string, ...p: Param[]): Promise<Row | null> => {
  const r = db().prepare(sql).get(...p);
  return r ? plain(r) : null;
};
/** ينفذ أمر ويرجع رقم آخر صف مضاف */
export const run = async (sql: string, ...p: Param[]): Promise<number> => Number(db().prepare(sql).run(...p).lastInsertRowid);
/** عدة أوامر كوحدة وحدة: إذا فشل واحد ما يتغير شي */
export async function tx<T>(fn: () => T | Promise<T>): Promise<T> {
  db().exec("BEGIN");
  try { const r = await fn(); db().exec("COMMIT"); return r; }
  catch (e) { db().exec("ROLLBACK"); throw e; }
}

export function modeFromName(name: string) {
  if (name.includes("حضوري")) return "in";
  if (name.includes("إلكتروني") || name.includes("الكتروني")) return "online";
  return "both";
}

async function columns(table: string) { return (await all(`PRAGMA table_info(${table})`)).map((r) => r.name as string); }
async function addColumn(table: string, col: string, ddl: string) {
  if (!(await columns(table)).includes(col)) db().exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

export async function catIdFor(name: string) {
  name = name.trim();
  const r = await get("SELECT id, active FROM cats WHERE name=?", name);
  if (r) { if (!r.active) await run("UPDATE cats SET active=1 WHERE id=?", r.id); return r.id as number; }
  return await run("INSERT INTO cats(name) VALUES(?)", name);
}

export async function initDb() {
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
    CREATE TABLE IF NOT EXISTS bank_exams(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, chapter TEXT, ord INTEGER, title TEXT, info TEXT, minutes INTEGER, UNIQUE(slug, ord));
    CREATE TABLE IF NOT EXISTS bank_versions(id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, model TEXT, kind TEXT DEFAULT 'mandatory', ok INTEGER DEFAULT 1, issues TEXT, has_en INTEGER DEFAULT 0, UNIQUE(exam_id, model));
    CREATE TABLE IF NOT EXISTS bank_questions(id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER, n INTEGER, max_mark INTEGER, q_file TEXT, a_files TEXT, edited INTEGER DEFAULT 0, UNIQUE(version_id, n));
    CREATE TABLE IF NOT EXISTS bank_edits(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, what TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS exam_access(user_id INTEGER, chapter TEXT, order_id INTEGER, created TEXT, PRIMARY KEY(user_id, chapter));
    CREATE TABLE IF NOT EXISTS order_codes(code TEXT PRIMARY KEY, order_id INTEGER UNIQUE, chapters TEXT, used_at TEXT);
  `);
  await addColumn("orders", "curr", "TEXT");
  await addColumn("orders", "printed", "INTEGER DEFAULT 0");
  await addColumn("orders", "seller", "INTEGER");
  await addColumn("orders", "office_id", "INTEGER");
  await addColumn("orders", "settle_id", "INTEGER");
  await addColumn("products", "cat_id", "INTEGER");
  await addColumn("products", "mode", "TEXT");
  await addColumn("bank_exams", "manual", "INTEGER DEFAULT 0");
  await addColumn("bank_versions", "manual", "INTEGER DEFAULT 0");
  await addColumn("bank_versions", "pdf_ar", "TEXT");
  await addColumn("bank_versions", "pdf_en", "TEXT");

  if ((await get("SELECT COUNT(*) n FROM products WHERE active=1 AND cat_id IS NULL"))!.n) {
    await run("UPDATE products SET cat_id=? WHERE cat_id IS NULL", await catIdFor("منتجات أخرى"));
  }
  for (const r of await all("SELECT id, name FROM products WHERE mode IS NULL")) {
    await run("UPDATE products SET mode=? WHERE id=?", modeFromName(r.name), r.id);
  }
  for (const g of GOVS) {
    await run("INSERT OR IGNORE INTO fees(gov, fee) VALUES(?, ?)", g, DEFAULT_FEE);
    await run("INSERT OR IGNORE INTO govmode(gov, mode) VALUES(?,?)", g, g === "بغداد" ? "both" : "online");
  }
  if (!(await get("SELECT COUNT(*) n FROM areas"))!.n) {
    for (const [gov, area, cs] of SEED_CENTERS) {
      const aid = await run("INSERT INTO areas(gov, name) VALUES(?,?)", gov, area);
      for (const cn of cs) await run("INSERT INTO centers(area_id, name) VALUES(?,?)", aid, cn);
    }
  }
  if (!(await get("SELECT COUNT(*) n FROM chapters"))!.n) await saveCurriculum(SEED_CURRIC);
}

/** يحفظ الفصول والمواضيع من نص، ويحدّث الموجود بمكانه حتى ما تضيع ارتباطات الأسئلة القديمة */
export async function saveCurriculum(text: string): Promise<[number, number]> {
  const chs: { ar: string; en: string; t: { ar: string; en: string; n: number }[] }[] = [];
  const parts = (s: string) => {
    const i = s.indexOf("|");
    return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  };
  let cur: (typeof chs)[number] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const [ar, en] = parts(line.replace(/^#+/, ""));
      cur = { ar, en, t: [] };
      chs.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^(.+?)\s*=\s*([\d٠-٩]+)\s*$/);
    const [ar, en] = parts(m ? m[1] : line);
    cur.t.push({ ar, en, n: m ? Number(toLatinDigits(m[2])) : 0 });
  }
  if (!chs.length) return [0, 0];
  return await tx(async () => {
    const oldCh = await all("SELECT * FROM chapters WHERE active=1 ORDER BY ord");
    let nt = 0;
    for (const [i, ch] of chs.entries()) {
      let chid: number;
      if (i < oldCh.length) {
        chid = oldCh[i].id;
        await run("UPDATE chapters SET ord=?, ar=?, en=? WHERE id=?", i + 1, ch.ar, ch.en, chid);
      } else chid = await run("INSERT INTO chapters(ord, ar, en) VALUES(?,?,?)", i + 1, ch.ar, ch.en);
      const oldT = await all("SELECT * FROM topics WHERE chapter_id=? AND active=1 ORDER BY ord", chid);
      for (const [j, t] of ch.t.entries()) {
        nt++;
        if (j < oldT.length) await run("UPDATE topics SET ord=?, ar=?, en=?, lectures=? WHERE id=?", j + 1, t.ar, t.en, t.n, oldT[j].id);
        else await run("INSERT INTO topics(chapter_id, ord, ar, en, lectures) VALUES(?,?,?,?,?)", chid, j + 1, t.ar, t.en, t.n);
      }
      for (const t of oldT.slice(ch.t.length)) await run("UPDATE topics SET active=0 WHERE id=?", t.id);
    }
    for (const ch of oldCh.slice(chs.length)) await run("UPDATE chapters SET active=0 WHERE id=?", ch.id);
    return [chs.length, nt] as [number, number];
  });
}

// ---------- مفاتيح/قيم عامة وجلسات
export const kvGet = async (k: string): Promise<string | null> => ((await get("SELECT v FROM kv WHERE k=?", k))?.v as string | undefined) ?? null;
export const kvSet = async (k: string, v: string) => { await run("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", k, v); };

export async function getSession(uid: number): Promise<{ state: string; data: Row }> {
  const r = await get("SELECT state, data FROM sessions WHERE user_id=?", uid);
  if (!r) return { state: "", data: {} };
  return { state: r.state || "", data: JSON.parse(r.data || "{}") };
}
export async function setSession(uid: number, state: string, data: Row) {
  await run("INSERT OR REPLACE INTO sessions(user_id, state, data) VALUES(?,?,?)", uid, state, JSON.stringify(data));
}
