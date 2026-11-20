// فحص المصححين (طلب الأستاذ 2026-11-21): صاحب البوت يشوف كل مصحح والمواضيع اللي صححها،
// ويقلب أوراقه عشوائي من اللي بعده ما شافها، ويا معدله ومعدل باقي المصححين بنفس الموضوع
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-check-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { gradeAction, checkData, checkRandom } = await import("../lib/gradeApi.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const e1 = await insert("bank_exams", { slug: "ch1", chapter: "الفصل الأول", ord: 1, title: "الثوابت", minutes: 60, pos: 1 });
const e2 = await insert("bank_exams", { slug: "ch2", chapter: "الفصل الثاني", ord: 1, title: "المكافئ", minutes: 60, pos: 2 });
await put("staff", { user_id: 40, name: "أحمد", perms: "grade" });
await put("staff", { user_id: 41, name: "علي", perms: "grade" });
await put("staff", { user_id: 42, name: "حسن", perms: "grade,gcheck" });
const paper = (grader: number, exam: number, total: number, x: object = {}) => insert("sched_items", { user_id: 70, exam_id: exam, at: "2026-11-20 10:00", status: "done", submitted_at: "x", graded_at: "2026-11-20 12:00", grader_id: grader, total, ...x });
const a1 = await paper(40, e1, 90), a2 = await paper(40, e1, 80), a3 = await paper(40, e2, 70);
await paper(41, e1, 50);
await paper(40, e1, 10, { user_id: -3 });   // ورقة تجربة ما تنحسب
await insert("sched_items", { user_id: 70, exam_id: e1, at: "x", status: "done", submitted_at: "x", grader_id: 40 });   // ما انصححت

test("المصححين وكم ورقة، والمواضيع ويا معدله ومعدل الباقين", async () => {
  const all = await checkData();
  assert.deepEqual(all.graders.map((g) => [g.id, g.count]), [[40, 3], [41, 1]]);
  assert.equal(all.topics, null);
  const one = await checkData(40);
  assert.equal(one.name, "أحمد");
  const t1 = one.topics!.find((t) => t.exam === e1)!;
  assert.deepEqual([t1.count, t1.avg, t1.others], [2, 85, 50]);
  assert.equal(one.topics!.find((t) => t.exam === e2)!.others, null);
});

test("الورقة العشوائية من اللي ما شافها، وبعد ما يشوف الكل ترجع من جديد", async () => {
  const seen = new Set<number>();
  for (let i = 0; i < 2; i++) { const r = await checkRandom(40, e1); assert.equal(r.again, false); seen.add(r.it.id); }
  assert.deepEqual([...seen].sort(), [a1, a2].sort());
  assert.equal((await checkRandom(40, e1)).again, true);
  assert.equal((await checkData(40)).graders.find((g) => g.id === 40)!.checked, 2);
  assert.equal((await checkRandom(40, 0)).it.id, a3);
});

test("بس صاحب البوت واللي عنده الصلاحية", async () => {
  await assert.rejects(gradeAction({ initData: sign(40), action: "check" }), (e: any) => e.status === 403);
  const r = await gradeAction({ initData: sign(42), action: "checkRandom", grader: 41, exam: e1 }) as any;
  assert.equal(r.paper.id !== undefined, true);
  assert.equal(r.check.grader, 41);
  assert.equal((await gradeAction({ initData: sign(1), action: "list" }) as any).canCheck, true);
  assert.equal((await gradeAction({ initData: sign(40), action: "list" }) as any).canCheck, false);
});
