// الحد اليومي لكلفة نظام التصحيح AI، ومفتاح الحفظ اللي يتغير وي نسخة المحرك
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyCap, dayOf, engineTag, overCap, spentOn } from "../lib/aiGuard.ts";

const prices = { "claude-haiku-5-5": { in: 0.1, out: 0.5 } };
const log = [
  { at: "2026-11-12 09:00", usage: [{ model: "claude-haiku-5-5", input: 1_000_000, output: 200_000 }] }, // 0.10 + 0.10
  { at: "2026-11-12 23:59", usage: [{ model: "claude-haiku-5-5", input: 0, output: 1_000_000 }] },       // 0.50
  { at: "2026-11-11 10:00", usage: [{ model: "claude-haiku-5-5", input: 9_000_000, output: 0 }] },       // أمس
  { at: "2026-11-12 10:00", usage: [{ model: "unknown-model", input: 5_000_000, output: 0 }] },          // بدون سعر
  { at: "2026-11-12 11:00", usage: [] },
];

test("كلفة اليوم تنحسب من سجل نفس اليوم بس", () => {
  assert.equal(dayOf("2026-11-12 09:00"), "2026-11-12");
  assert.ok(Math.abs(spentOn("2026-11-12", log, prices) - 0.7) < 1e-9);
  assert.ok(Math.abs(spentOn("2026-11-11", log, prices) - 0.9) < 1e-9);
  assert.equal(spentOn("2026-11-10", log, prices), 0);
});

test("الحد اليومي: فارغ أو صفر أو مو رقم يعني بدون حد", () => {
  assert.equal(dailyCap(undefined), null);
  assert.equal(dailyCap(""), null);
  assert.equal(dailyCap("0"), null);
  assert.equal(dailyCap("abc"), null);
  assert.equal(dailyCap(" 2.5 "), 2.5);
});

test("التصحيح يوگف من توصل الكلفة للحد", () => {
  assert.equal(overCap(0.7, null), false);
  assert.equal(overCap(0.69, 0.7), false);
  assert.equal(overCap(0.7, 0.7), true);
  assert.equal(overCap(5, 0.7), true);
});

test("مفتاح الحفظ يتغير وي نسخة المحرك", () => {
  assert.equal(engineTag("rubric-4", ""), "rubric-4");            // خدمة قديمة ما ترجع نسخة
  assert.equal(engineTag("rubric-4", "451f4b138b8c"), "rubric-4:451f4b138b8c");
  assert.notEqual(engineTag("rubric-4", "aaa"), engineTag("rubric-4", "bbb"));
});
