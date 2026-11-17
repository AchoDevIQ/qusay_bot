// المخزن: توفر كل منتج لكل منهج، «بلّغني لما يتوفر»، والعدد ينقص بالبيع ويرجع بالإلغاء ويخلص وحده
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-stock-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const sent: { chat: number; text: string }[] = [];
globalThis.fetch = (async (_u: string, init: any) => { try { const p = JSON.parse(init.body); if (p.text) sent.push({ chat: p.chat_id, text: p.text }); } catch { /* */ } return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }) as typeof fetch;

const { insert, put, find } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { available, setStock, waitFor, takeStock, returnStock, stockView, outOf } = await import("../lib/stock.ts");
await ensure();

const cat = Number(await insert("cats", { name: "ملازم", active: 1 }));
const pid = Number(await insert("products", { name: "دفتر محاضرات الفصل الأول", price: 10000, cat_id: cat, mode: "both", active: 1, hidden: 0 }));
await put("students", { user_id: 50, name: "طالب", curr: "إنجليزي", created: "x" });

test("خلص للإنجليزي بس: العربي يشتري، والإنجليزي «بلّغني» ويوصله خبر من يرجع", async () => {
  assert.equal(await available(pid, "إنجليزي"), true);
  await setStock(pid, "إنجليزي", { out: true });
  assert.equal(await available(pid, "إنجليزي"), false);
  assert.equal(await available(pid, "عربي"), true);
  assert.deepEqual(await outOf([pid], "إنجليزي"), ["دفتر محاضرات الفصل الأول"]);
  assert.equal(await waitFor(50, pid, "إنجليزي"), true);
  assert.equal((await stockView(pid))["إنجليزي"].waiting, 1);
  sent.length = 0;
  await setStock(pid, "إنجليزي", { out: false });
  assert.ok(sent.some((m) => m.chat === 50 && m.text.includes("رجع")));
  assert.equal((await find("stock_wait", { product_id: pid })).length, 0);
});

test("العدد: البيع ينقص، الصفر يخلص وحده وينبه، والإلغاء يرجع", async () => {
  await setStock(pid, "عربي", { count: 3, low: 1 });
  sent.length = 0;
  await takeStock([{ name: "دفتر محاضرات الفصل الأول", qty: 2 }], "عربي");
  assert.equal((await stockView(pid))["عربي"].count, 1);
  assert.ok(sent.some((m) => m.chat === 1 && m.text.includes("قرب يخلص")));
  await takeStock([{ name: "دفتر محاضرات الفصل الأول", qty: 1 }], "عربي");
  assert.equal(await available(pid, "عربي"), false, "صفر = خلص");
  await waitFor(50, pid, "عربي");
  sent.length = 0;
  await returnStock([{ name: "دفتر محاضرات الفصل الأول", qty: 1 }], "عربي");
  assert.equal(await available(pid, "عربي"), true);
  assert.ok(sent.some((m) => m.chat === 50), "اللي ينتظرون يوصلهم خبر");
  await setStock(pid, "عربي", { count: "" });
  assert.equal((await stockView(pid))["عربي"].count, null, "فارغ = ما نعدّ");
});
