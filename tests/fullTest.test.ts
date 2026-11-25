// 🧭 التست الكامل: كل خطوة بيها شنو يسوي وشنو لازم يطلع، والمفاتيح ما تتكرر، والصفحات اللي تفتحها موجودة
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const { JOURNEY, jKey } = await import("../lib/fullTest.ts");

test("🧭 كل خطوة كاملة، والمفاتيح ما تتكرر، والصفحات موجودة", () => {
  const keys = new Set<string>();
  for (const s of JOURNEY) for (const st of s.steps) {
    const k = jKey(s.id, st.id);
    assert.ok(!keys.has(k), `مكرر ${k}`); keys.add(k);
    assert.ok(st.do.length > 0 && st.text.length > 5, k);
    if (st.open) assert.ok(fs.existsSync(`app/store/${st.open.page}`), `${k}: صفحة ${st.open.page} مو موجودة`);
  }
  assert.ok(keys.size >= 40);
});
