import { test } from "node:test";
import assert from "node:assert/strict";
import { strongPin } from "../lib/doorLink.ts";

test("الرمز اللي يسويه النظام: 4 أرقام وصعب", () => {
  for (let i = 0; i < 2000; i++) {
    const p = strongPin();
    assert.match(p, /^\d{4}$/);
    assert.ok(new Set(p).size >= 3, p);
    assert.ok(!["1234", "4321", "0123", "9876", "2468"].includes(p), p);
    assert.notEqual(p.slice(0, 2), p.slice(2), p);
  }
});
