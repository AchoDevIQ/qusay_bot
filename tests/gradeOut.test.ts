// أوراق الاستثناء والتعويض (طلب الأستاذ 2026-11-20): كل امتحان مو ويا الطلاب بوقتهم يروح للمصححين اللي يختارهم صاحب البوت،
// ولكل فصل مصححين غيرهم إذا يريد. إذا ما اختار أحد تروح مثل باقي الأوراق
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-out-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { gradeScope, outOf } = await import("../lib/graderPay.ts");
const { gradeAction } = await import("../lib/gradeApi.ts");
const { initDb, insert, put, one } = await import("../lib/db.ts");
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
const paper = async (x: object) => (await one("sched_items", { id: await insert("sched_items", { user_id: 70, exam_id: e1, at: "2026-11-20 10:00", status: "done", submitted_at: "x", ...x }) }))!;

test("الاستثناء: الإعادة والتعويض واللي فتحته الإدارة وتقديم الموعد، مو الامتحان العادي", async () => {
  assert.equal(outOf(await paper({})), false);
  assert.equal(outOf(await paper({ kind: "catchup" })), true);
  assert.equal(outOf(await paper({ retake_of: 5 })), true);
  assert.equal(outOf(await paper({ exc_by: 1 })), true);
  assert.equal(outOf(await paper({ fixed: "moved" })), true);
});

test("مصححين لكل الفصول، وفصل بمصححين غيرهم، والورقة العادية ما تتأثر", async () => {
  const normal = await paper({}), late = await paper({ kind: "catchup" }), late2 = await paper({ exc_by: 1, exam_id: e2 });
  await assert.rejects(gradeAction({ initData: sign(40), action: "outSave", ids: [40] }), (e: any) => e.status === 403);
  const r: any = await gradeAction({ initData: sign(1), action: "outSave", ids: [41, 999], chapters: { "الفصل الثاني": [40] } });
  assert.deepEqual(r.only.out, { ids: [41], chapters: { "الفصل الثاني": [40] } });
  const a = await gradeScope(40), b = await gradeScope(41), boss = await gradeScope(1);
  assert.deepEqual([a.can(normal), b.can(normal)], [true, true]);
  assert.deepEqual([a.can(late), b.can(late), boss.can(late)], [false, true, true]);
  assert.deepEqual([a.can(late2), b.can(late2)], [true, false]);
  // تشيلهم كلهم: ترجع مثل باقي الأوراق
  await gradeAction({ initData: sign(1), action: "outSave", ids: [], chapters: {} });
  const c = await gradeScope(40);
  assert.equal(c.can(late), true);
});
