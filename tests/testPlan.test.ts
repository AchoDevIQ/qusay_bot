// تست التطبيق: الصح ما يرجع، والمشكلة ترجع لمن تنصلح، وللصاحب البوت بس
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-plan-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const { initDb, put } = await import("../lib/db.ts");
const { TEST_PLAN, stepKey, stepState } = await import("../lib/testPlan.ts");
const { guideSection } = await import("../lib/guide.ts");
const { testPlanAction } = await import("../lib/testPlanApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
await initDb();
const init = `tk:${homeToken(1)}`;

test("كل خطوة معرفها فريد ومكتوب شنو تحتاج", () => {
  const keys = TEST_PLAN.flatMap((s) => s.steps.map((x) => stepKey(s.id, x.id)));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length > 80);
  for (const s of TEST_PLAN) assert.ok(s.needs.length && s.steps.length, s.id);
});
test("كل خطوة مكتوب بيها وين تروح، وكل قسم إله شرح من الدليل", () => {
  for (const s of TEST_PLAN) {
    assert.ok(s.guide.length, s.id);
    for (const g of s.guide) assert.ok(guideSection(g), `${s.id}: ${g}`);
    for (const x of s.steps) assert.ok(x.how.trim().length >= 10, stepKey(s.id, x.id));
  }
});
test("الصح يبقى صح حتى لو الخطوة تغيرت، والمشكلة ترجع بس لمن تنصلح", () => {
  assert.equal(stepState({ id: "a", text: "x" }), "todo");
  assert.equal(stepState({ id: "a", text: "x" }, { state: "ok", rev: 1, at: "" }), "ok");
  assert.equal(stepState({ id: "a", text: "x", rev: 2 }, { state: "ok", rev: 1, at: "" }), "ok");
  assert.equal(stepState({ id: "a", text: "x", rev: 2 }, { state: "bad", rev: 1, note: "n", at: "" }), "changed");
  assert.equal(stepState({ id: "a", text: "x" }, { state: "bad", rev: 1, note: "n", at: "" }), "bad");
});
test("صاحب البوت يأشر ويشيل، والمشكلة تحتاج كتابة، والمساعد ما يدخل", async () => {
  const key = stepKey(TEST_PLAN[0].id, TEST_PLAN[0].steps[0].id);
  assert.deepEqual(((await testPlanAction({ initData: init, action: "list" })) as any).marks, {});
  assert.equal(((await testPlanAction({ initData: init, action: "ok", key })) as any).marks[key].state, "ok");
  await assert.rejects(testPlanAction({ initData: init, action: "bad", key, note: " " }), /شنو المشكلة/);
  assert.equal(((await testPlanAction({ initData: init, action: "bad", key, note: "ما اشتغل" })) as any).marks[key].note, "ما اشتغل");
  assert.equal(((await testPlanAction({ initData: init, action: "clear", key })) as any).marks[key], undefined);
  await assert.rejects(testPlanAction({ initData: init, action: "ok", key: "x.y" }), /غير موجودة/);
  await put("staff", { user_id: 70, name: "مساعد", perms: "q" });
  await assert.rejects(testPlanAction({ initData: `tk:${homeToken(70)}`, action: "list" }), (e: any) => e.status === 403);
});
