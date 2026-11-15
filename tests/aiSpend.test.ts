// صرفية الذكاء كل شي لحاله: التصحيح من سجله، والأسئلة العلمية والقلم يوم بيوم، والكارت لصاحب البوت بس
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-spend-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none"), GRADING_AI_URL: "https://ai.test/", GRADING_AI_KEY: "k" });
delete process.env.FIREBASE_STORAGE_BUCKET;
globalThis.fetch = (async (url: string) => {
  if (String(url).startsWith("https://ai.test")) return Response.json({ solution: "شرح", usage: [{ model: "claude-haiku-5-5", calls: 1, input: 100_000, output: 20_000 }] });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const S = await import("../lib/aiSpend.ts");
const { spendReport, aiSpendAction } = await import("../lib/aiSpendApi.ts");
const qa = await import("../lib/qaBank.ts");
const { initDb, kvSet } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};

test("يوم بيوم: اليوم والشهر ينجمعون لحالهم، ونوع ما يختلط بالثاني", async () => {
  await S.addSpend("qa", 0.5, "2026-10-30");
  await S.addSpend("qa", 0.25, "2026-11-01");
  await S.addSpend("qa", 0.125, "2026-11-01");
  await S.addSpend("pen", 0.01, "2026-11-01");
  await S.addSpend("qa", 0, "2026-11-01");
  const d = await S.spendDays();
  assert.equal(S.spentIn(d, "qa", "2026-11-01"), 0.375);
  assert.equal(S.spentIn(d, "qa", "2026-11"), 0.375);
  assert.equal(S.spentIn(d, "qa", ""), 0.875);
  assert.equal(S.spentIn(d, "pen", "2026-11"), 0.01);
  await kvSet("ai_spend_days", "{}");
});

test("الكارت: التصحيح لحاله والأسئلة العلمية لحالها، والمجموع", async () => {
  const day = stamp().slice(0, 10);
  // ورقة انصححت اليوم: 1M داخل و0.2M طالع على Haiku 5.5 = 0.1 + 0.1
  await kvSet("ai_log", JSON.stringify([{ at: `${day} 09:00`, kind: "sent", usage: [{ model: "claude-haiku-5-5", calls: 1, input: 1_000_000, output: 200_000 }] }]));
  // شرح خطوة: 100k داخل و20k طالع = 0.01 + 0.01
  const tid = 1;
  const id = await qa.saveAnswer(80, "س", { source: "ai", solution: "$x=1$" }, "x", "ar", { chapter: 1, tid, lecture: 1 });
  await qa.qaAction({ initData: sign(1), action: "settings", stepBtn: true });
  await qa.qaExplain({ token: homeToken(80), id, ask: "ليش هيك؟" });
  const r = await spendReport(day);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by.grade.today, 0.2);
  assert.equal(by.grade.month, 0.2);
  assert.equal(by.qa.today, 0.02);
  assert.equal(by.qa.all, 0.02);
  assert.equal(by.pen.today, 0);
  assert.equal(r.total.today, 0.22);
  assert.equal(r.since, day);
  // يوم ثاني: التصحيح ما ينحسب بيه
  assert.equal((await spendReport("2000-01-01")).rows.find((x) => x.key === "grade")!.today, 0);
});

test("الكارت لصاحب البوت بس", async () => {
  await assert.rejects(aiSpendAction({ initData: sign(5) }), (e: any) => e.status === 403);
  const r: any = await aiSpendAction({ initData: sign(1) });
  assert.equal(r.rows.length, 3);
});
