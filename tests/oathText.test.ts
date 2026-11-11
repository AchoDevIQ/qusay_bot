import { test } from "node:test";
import assert from "node:assert/strict";
import { oathProgress, sameOath } from "../lib/oathText.ts";

const S = "أني الطالب علي حسين محمد جاسم أقسم بالله أنني لن أغش في هذا الامتحان";

test("جملة القسم: لازم كاملة، والهمزات والمسافات والفواصل ما تفرق", () => {
  assert.equal(sameOath(S, S), true);
  assert.equal(sameOath("اني الطالب علي  حسين محمد جاسم، اقسم بالله انني لن اغش في هذا الامتحان.", S), true);
  assert.equal(sameOath("أني الطالب علي حسين أقسم بالله أنني لن أغش في هذا الامتحان", S), false);   // ناقص من الاسم
  assert.equal(sameOath("أني الطالب علي حسين محمد جاسم أقسم بالله أنني لن أغش", S), false);
  assert.equal(sameOath("", S), false);
});

test("جملة القسم: وين غلط وكم باقي", () => {
  assert.deepEqual(oathProgress("", S), { ok: false, wrong: null, left: 14 });
  assert.deepEqual(oathProgress("أني الطا", S), { ok: false, wrong: null, left: 13 });     // بعده يكتب الكلمة
  assert.deepEqual(oathProgress("أني الطالب ", S), { ok: false, wrong: null, left: 12 });
  assert.deepEqual(oathProgress("أني التلميذ ", S).wrong, { got: "التلميذ", want: "الطالب" });
  assert.deepEqual(oathProgress(S + " والله", S).wrong, { got: "والله", want: "" });
  assert.equal(oathProgress(S, S).ok, true);
});
