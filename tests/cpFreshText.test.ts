import { test } from "node:test";
import assert from "node:assert/strict";
import { freshText } from "../lib/checkpoints.ts";

test("رسائل الإيقاف القديمة («ويا قصي العميري») تتبدل للمعهد وأيامه وأوقاته", () => {
  const st = freshText("⛔ توقفت عليك {الموقوف}\n\nغياباتك: {الغياب}\n\nحتى ترجع لازم يحضر ولي أمرك ويا قصي العميري.");
  assert.match(st, /غياباتك: \{الغياب\}\n\nحتى ترجعلك المحاضرات والامتحانات، لازم يحضر ولي أمرك إلى \{المعهد\} بهاي الأيام والأوقات:\n\{الأوقات\}$/);
  const g = freshText("⛔ توقفت\n\nحتى يرجع لازم تحضر ويا قصي العميري.");
  assert.match(g, /يرجى حضوركم إلى \{المعهد\} بهاي الأيام والأوقات:\n\{الأوقات\}$/);
  assert.ok(!/قصي/.test(st + g));
  assert.equal(freshText("رسالتي أنا"), "رسالتي أنا");
});
