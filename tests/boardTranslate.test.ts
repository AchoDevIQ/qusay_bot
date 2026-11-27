// 🌐 ترجمة مايك السبورة: كل سطر وتحته ترجمته، والأرقام إنگليزي، وكلفتها تنحسب
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-btr-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", ANTHROPIC_API_KEY: "test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
let asked = "";
globalThis.fetch = (async (_url: string, init: any) => {
  asked = JSON.parse(init.body).messages[0].content;
  const body = { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ lines: ["x تربيع زائد ٦", "the answer is 6"] }) }], usage: { input_tokens: 1000, output_tokens: 100 } };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
const { initDb } = await import("../lib/db.ts");
await initDb();
const { translateBoard } = await import("../lib/boardTranslate.ts");
const { spendDays } = await import("../lib/aiSpend.ts");

test("🌐 كل سطر وتحته ترجمته، والأرقام إنگليزي، والكلفة تنحسب", async () => {
  const out = await translateBoard("x squared plus 6\n\nالجواب 6");
  assert.equal(out, "x squared plus 6\nx تربيع زائد 6\nالجواب 6\nthe answer is 6");
  assert.match(asked, /1\. x squared plus 6\n2\. الجواب 6/);
  const d = await spendDays();
  assert.ok(Object.values(d).some((r) => (r.board ?? 0) > 0));
  await assert.rejects(translateBoard("  "), /ماكو كلام/);
});
