// 🧾 وصل الشراء لولي الأمر: يوصل إذا مربوط، وإلا ينتظر ويوصل كله أول ما ينربط (مثل الدرجة)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-gbuys-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp,
  CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"),
});
const calls: { method: string; p: any }[] = [];
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId } }));
}) as typeof fetch;

const { initDb, insert, put } = await import("../lib/db.ts");
const { guardianBuy, releaseBuys, waitingBuys } = await import("../lib/guardianBuys.ts");
await initDb();

const textTo = (chat: number) => calls.filter((c) => Number(c.p.chat_id) === chat).map((c) => String(c.p.text ?? c.p.caption ?? "")).join(" | ");

test("ولي الأمر مو مربوط: الوصل ينتظر، ومن ينربط يوصله كله، والبيعة الجاية توصل فوراً", async () => {
  await insert("students", { user_id: 7001, name: "طالب تجربة", created: "2026-01-01 00:00" });
  const oid = Number(await insert("orders", { user_id: 7001, name: "طالب تجربة", items: JSON.stringify([{ id: 1, name: "الفصل الأول - محاضرات فقط", price: 40000, qty: 1 }]), total: 40000, created: "2026-11-26 21:00", printed: 3, seller: 1 }));
  assert.equal(await guardianBuy(7001, oid), "waiting");
  assert.deepEqual(await waitingBuys(7001), [oid]);
  assert.equal(textTo(9001), "");
  await put("guardians", { guardian_id: 9001, student_id: 7001, created: "2026-11-26 22:00" });
  assert.equal(await releaseBuys(7001), 1);
  assert.deepEqual(await waitingBuys(7001), []);
  assert.match(textTo(9001), /طالب تجربة.*اشترى[\s\S]*الفصل الأول - محاضرات فقط[\s\S]*40,000/);
  const oid2 = Number(await insert("orders", { user_id: 7001, name: "طالب تجربة", items: JSON.stringify([{ id: 2, name: "دفتر امتحانات الفصل الأول", price: 4000, qty: 2 }]), total: 8000, created: "2026-11-26 22:10", printed: 3, seller: 1 }));
  assert.equal(await guardianBuy(7001, oid2), "sent");
  assert.match(textTo(9001), /دفتر امتحانات الفصل الأول × 2/);
});
