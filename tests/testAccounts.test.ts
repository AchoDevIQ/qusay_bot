// 🧪 حسابات التجربة: ما تطلع بقائمة الطلاب ولا البحث ولا الإحصاء، تطلع بس جوه «🧪 التجريب»
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-testacct-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { initDb, put } = await import("../lib/db.ts");
await initDb();
const { studentAction } = await import("../lib/studentApi.ts");
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  params.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update("1:test").digest()).update(check).digest("hex"));
  return params.toString();
};
const act = (action: string, x: object = {}) => studentAction({ initData: sign(1), action, ...x }) as Promise<any>;

test("🧪 حساب تجربة: يختفي من القائمة والبحث والإحصاء، ويطلع جوه «🧪 التجريب»، ويرجع", async () => {
  await put("students", { user_id: 801, name: "طالب حقيقي علي حسن", phone1: "07700000801", grade: "السادس العلمي", created: "2026-01-01" });
  await put("students", { user_id: 802, name: "حساب تجربتي علي حسن", phone1: "07000000901", grade: "السادس العلمي", created: "2026-01-02" });
  await put("students", { user_id: -5, name: "طالب تجربة 5", phone1: "", created: "2026-01-03" });
  let d = await act("list");
  assert.ok(!d.results.some((x: any) => x.id === -5), "طالب التجربة ما يطلع");
  assert.equal(d.stats.all, 2);
  d = await act("testAcct", { id: 802, on: true });
  assert.ok(!d.results.some((x: any) => x.id === 802), "حساب التجربة اختفى");
  assert.equal(d.stats.all, 1);
  assert.deepEqual(d.testAccts.map((x: any) => x.id), [802], "يطلع جوه التجريب");
  assert.equal((await act("list", { q: "0700000090" })).found, 0, "ولا بالبحث");
  d = await act("testAcct", { id: 802, on: false });
  assert.ok(d.results.some((x: any) => x.id === 802));
  assert.equal(d.testAccts.length, 0);
});
