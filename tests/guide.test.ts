// دليل البوت: كل قسم كامل، وماكو أي شي سري بروابطه المفتوحة
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDE, SHARED_GUIDE, guideSection } from "../lib/guide.ts";

test("كل قسم إله معرف فريد وخطوات", () => {
  assert.equal(new Set(GUIDE.map((s) => s.id)).size, GUIDE.length);
  for (const s of GUIDE) {
    assert.match(s.id, /^[a-z-]+$/);
    assert.notEqual(s.id, "all");
    assert.ok(s.title && s.who && s.intro, s.id);
    assert.ok(s.blocks.some((b) => b.steps?.length), s.id);
  }
  assert.equal(guideSection("attend")?.icon, "🎫");
  assert.equal(guideSection("nothing"), null);
});
test("كل قسم مكتوب بيه الصلاحية، واللي ينرسل ما بيه شي من التست", () => {
  for (const s of GUIDE) assert.ok(s.perm.trim(), s.id);
  assert.ok(!SHARED_GUIDE.some((s) => s.id === "testing"));
  assert.doesNotMatch(JSON.stringify(SHARED_GUIDE), /تست التطبيق/);
});
test("الدليل ما بيه روابط أو رموز، عدا رابط البوت العام اللي ينطى للطالب", () => {
  const text = JSON.stringify(GUIDE).replaceAll("https://t.me/Qusay_Alomairi_Bot", "");
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /[A-Za-z0-9_-]{32,}/);
});
