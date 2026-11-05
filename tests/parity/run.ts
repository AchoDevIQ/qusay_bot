// يشغل سيناريو واحد على نسخة TypeScript ويطبع النتيجة JSON، بنفس شكل تسجيلات record.py
// كل سيناريو بعملية مستقلة، لأن الإعدادات تنقرأ مرة وحدة عند التحميل
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [, , file, name] = process.argv;
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const prelude: Record<string, any[]> = read("prelude.json");
const sc = read(file).find((x: any) => x.name === name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-parity-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: sc.noStore ? "" : "https://x.test", PDF_DIR: tmp, NO_WORD_CHECK: "1",
  CHROME_PATH: path.join(tmp, "no-browser"), SETTINGS_FILE: path.join(tmp, "no-settings"),
});

const trace: any[] = [];
let fail: string[] = [];
let nextId = 100;
const result = (method: string) => {
  if (fail.includes(method)) return null;
  if (method === "createForumTopic") return { message_thread_id: ++nextId };
  if (["sendMessage", "copyMessage", "sendDocument"].includes(method)) return { message_id: ++nextId };
  if (method === "sendPhoto") { ++nextId; return { message_id: nextId, photo: [{ file_id: `F${nextId}` }] }; }
  return true;
};
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "test_bot" } }));
  if (init.body instanceof FormData) {
    const p: Record<string, any> = {};
    let fname = "";
    for (const [k, v] of init.body.entries()) {
      if (typeof v === "string") p[k] = k === "reply_markup" ? JSON.parse(v) : v;
      else fname = v.name;
    }
    trace.push(method === "sendDocument" ? { m: method, p, up: true, file: fname } : { m: method, p, up: true });
  } else trace.push({ m: method, p: JSON.parse(init.body) });
  const r = result(method);
  return new Response(JSON.stringify(r === null ? { ok: false, description: "fail" } : { ok: true, result: r }));
}) as typeof fetch;

const { handleUpdate } = await import("../../lib/bot.ts");
const { initDb, kvSet, setDriver } = await import("../../lib/db.ts");
const { all, db, run, sqliteDriver } = await import("../../lib/sqliteDriver.ts");
const { docId, firestoreDriver } = await import("../../lib/firestoreDriver.ts");
const { SCHEMA, keyOf } = await import("../../lib/schema.ts");
const { fakeFirestore } = await import("../fakeFirestore.ts");

// إذا PARITY_DRIVER=firestore: نفس السيناريو على Firestore الوهمي
const fake = process.env.PARITY_DRIVER === "firestore" ? fakeFirestore() : null;
if (fake) {
  setDriver(firestoreDriver(() => fake.db));
  await sqliteDriver.init();
}
const fakeRows = (t: string) => [...(fake!.store.get(t)?.values() ?? [])];
/** خطوات السيناريو مكتوبة SQL، فتتنفذ على نسخة SQLite وترجع للوهمي */
async function execOnFake(sql: string) {
  for (const t of Object.keys(SCHEMA)) {
    await run(`DELETE FROM ${t}`);
    for (const r of fakeRows(t)) {
      const cols = Object.keys(r);
      await run(`INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, ...cols.map((c) => r[c]));
    }
  }
  db().exec(sql);
  for (const t of Object.keys(SCHEMA)) {
    const docs = new Map<string, any>();
    for (const r of await all(`SELECT * FROM ${t} ORDER BY rowid`)) docs.set(docId(keyOf(t, r)), r);
    fake!.store.set(t, docs);
    if (SCHEMA[t].auto) {
      const c = fake!.store.get("_counters") ?? new Map();
      const last = Math.max(Number(c.get(t)?.last ?? 0), ...[...docs.values()].map((r) => r.id));
      c.set(t, { last });
      fake!.store.set("_counters", c);
    }
  }
}
await initDb();
await kvSet("bot_username", "test_bot");

const expand = (steps: any[]): any[] => steps.flatMap((s) => (s[0] === "u" ? expand(prelude[s[1]]) : [s]));
const vars: Record<string, string> = {};
const subst = (v: any): any => {
  if (typeof v === "string") return v.replace(/\$\{(\w+)\}/g, (_, k) => vars[k]);
  if (Array.isArray(v)) return v.map(subst);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]));
  return v;
};
const user = (uid: number) => ({ id: uid, username: `u${uid}`, first_name: "اسم" });
const update = async (u: any) => {
  try { await handleUpdate(u); } catch (e) { console.error(e); trace.push({ m: "CRASH" }); }
};

let msgId = 5000;
for (const raw of expand(sc.steps)) {
  const s = subst(raw);
  const k = s[0];
  if (k === "m" || k === "w" || k === "g") {
    const chat = k === "g" ? { id: -1001234, type: "supergroup" } : { id: s[1], type: "private" };
    const msg: any = { message_id: ++msgId, chat, from: user(s[1]) };
    if (k === "w") msg.web_app_data = { data: typeof s[2] === "string" ? s[2] : JSON.stringify(s[2]) };
    else if (s[2] !== null) msg.text = s[2];
    await update({ message: { ...msg, ...(s[3] ?? {}) } });
  } else if (k === "c") {
    await update({ callback_query: { id: "c", from: user(s[1]), message: { chat: { id: s[1] }, message_id: 50 }, data: s[2] } });
  } else if (k === "s") { if (fake) await execOnFake(s[1]); else db().exec(s[1]); }
  else if (k === "f") fail = s[1];
  else if (k === "cap") {
    const re = new RegExp(s[1]);
    const hit = [...trace].reverse().map((e) => re.exec(JSON.stringify(e))).find(Boolean);
    if (!hit) throw new Error(`cap: ${s[1]} not found in ${name}`);
    vars[s[2]] = hit[1];
  } else throw new Error("bad step " + JSON.stringify(s));
}

const tables = (await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name as string);
const dbDump = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, fake ? fakeRows(t) : await all(`SELECT * FROM ${t} ORDER BY rowid`)])));
const files: Record<string, string> = {};
for (const n of fs.readdirSync(tmp).sort()) {
  files[n] = fs.readFileSync(path.join(tmp, n), "utf8")
    .replace(/base64,[A-Za-z0-9+/=]{100,}/g, (m) => "base64:" + createHash("md5").update(m).digest("hex"));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ trace, db: dbDump, files }), () => process.exit(0));
