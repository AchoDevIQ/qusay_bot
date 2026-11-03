import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.DB_PATH = ":memory:";
const { initDb, run, get, all, kvGet, kvSet, getSession, setSession, modeFromName } = await import("../lib/db.ts");
const { esc, money, stamp, shiftDay, b64urlEncode, b64urlDecode } = await import("../lib/util.ts");
const { parseSettingsText } = await import("../lib/config.ts");

test("initDb creates schema and seeds fees/govmode", () => {
  initDb(); initDb();                       // مرتين بدون أخطاء
  assert.equal(get("SELECT COUNT(*) n FROM fees")!.n, 18);
  assert.equal(get("SELECT mode FROM govmode WHERE gov='بغداد'")!.mode, "both");
  assert.equal(get("SELECT mode FROM govmode WHERE gov='البصرة'")!.mode, "online");
});
test("kv + sessions roundtrip (Arabic)", () => {
  kvSet("a", "قيمة"); assert.equal(kvGet("a"), "قيمة"); assert.equal(kvGet("zz"), null);
  setSession(5, "st", { x: [1, "ب"] });
  assert.deepEqual(getSession(5), { state: "st", data: { x: [1, "ب"] } });
  assert.deepEqual(getSession(6), { state: "", data: {} });
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
  const src = "/tmp/w71/bot/store.db";
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, "/tmp/real_copy.db");
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("/tmp/real_copy.db");
  const n = (d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as any).n;
  assert.ok(n >= 15, "tables: " + n);
});
