import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DB_PATH = ":memory:";
const { initDb, get, all, kvGet, kvSet, getSession, setSession, modeFromName, saveCurriculum } = await import("../lib/db.ts");
const { esc, money, stamp, shiftDay, b64urlEncode, b64urlDecode } = await import("../lib/util.ts");
const { parseSettingsText } = await import("../lib/config.ts");

test("initDb creates schema and seeds fees/govmode", async () => {
  await initDb(); await initDb();                       // مرتين بدون أخطاء
  assert.equal((await get("SELECT COUNT(*) n FROM fees"))!.n, 18);
  assert.equal((await get("SELECT mode FROM govmode WHERE gov='بغداد'"))!.mode, "both");
  assert.equal((await get("SELECT mode FROM govmode WHERE gov='البصرة'"))!.mode, "online");
});
test("kv + sessions roundtrip (Arabic)", async () => {
  await kvSet("a", "قيمة"); assert.equal(await kvGet("a"), "قيمة"); assert.equal(await kvGet("zz"), null);
  await setSession(5, "st", { x: [1, "ب"] });
  assert.deepEqual(await getSession(5), { state: "st", data: { x: [1, "ب"] } });
  assert.deepEqual(await getSession(6), { state: "", data: {} });
});
test("modeFromName", () => {
  assert.equal(modeFromName("ملزمة حضوري"), "in");
  assert.equal(modeFromName("ملزمة إلكتروني"), "online");
  assert.equal(modeFromName("ملزمة"), "both");
});
test("util", () => {
  assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(money(15000), "15,000 د.ع");
  assert.match(stamp(), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(b64urlDecode(b64urlEncode({ a: "عربي" })), { a: "عربي" });
});
test("settings parser (legacy settings.txt format)", () => {
  const s = parseSettingsText('TOKEN =abc:123\nADMIN =١٢٣٤، 5678\nSTORE =https://x.netlify.app\n');
  assert.equal(s.token, "abc:123"); assert.deepEqual(s.admins, [1234, 5678]); assert.equal(s.url, "https://x.netlify.app");
});
test("opens the REAL Python store.db copy without errors", async () => {
  const src = process.env.REAL_DB;
  if (!src || !fs.existsSync(src)) return;
  const copy = path.join(os.tmpdir(), `qmath_real_copy_${process.pid}.db`);
  fs.copyFileSync(src, copy);
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync(copy);
  const n = (d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as any).n;
  d.close();
  fs.rmSync(copy, { force: true });
  assert.ok(n >= 15, "tables: " + n);
});
test("seeds + saveCurriculum keeps ids and deactivates removed rows", async () => {
  assert.equal((await get("SELECT COUNT(*) n FROM areas"))!.n, 4);
  assert.equal((await get("SELECT COUNT(*) n FROM chapters WHERE active=1"))!.n, 5);
  const firstId = (await get("SELECT id FROM chapters WHERE ord=1"))!.id;
  assert.deepEqual(await saveCurriculum("# فصل | Ch\nموضوع | Topic = ٣\nبدون رقم"), [1, 2]);
  assert.equal((await get("SELECT ar FROM chapters WHERE id=?", firstId))!.ar, "فصل");
  assert.equal((await get("SELECT COUNT(*) n FROM chapters WHERE active=1"))!.n, 1);
  assert.deepEqual((await all("SELECT lectures FROM topics WHERE active=1 AND chapter_id=? ORDER BY ord", firstId)).map((r) => r.lectures), [3, 0]);
  assert.deepEqual(await saveCurriculum("بدون فصل"), [0, 0]);
});
