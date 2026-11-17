// ولي الأمر برمز سري على تطبيق ابنه: ينربط كولي أمر، والرمز الغلط ينقفل، وصفحته برمزه بس، و«✅ استلمت» تشتغل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-gpin-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;

const { one, put } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { homeToken, appKey } = await import("../lib/webAuth.ts");
const { pinGuardian, verifyGuardToken, resetPin } = await import("../lib/guardianPin.ts");
const { guardianAction } = await import("../lib/guardianApi.ts");
const { guardianOf } = await import("../lib/access.ts");
const { send } = await import("../lib/telegram.ts");
await ensure();

const SID = 10_000_000_000_050;
await put("students", { user_id: SID, name: "علي حسن", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00:00" });
const auth = { token: homeToken(SID), app: appKey(SID) };
const act = (action: string, x: object = {}) => guardianAction({ ...auth, action, ...x });

test("بس من التطبيق، وأول مرة يحط رمز صعب ومتطابق", async () => {
  await assert.rejects(guardianAction({ token: homeToken(SID), app: "0".repeat(32), action: "state" }), /التطبيق/);
  assert.equal((await act("state")).hasPin, false);
  await assert.rejects(act("setPin", { pin: "12", pin2: "12" }), /4 أرقام/);
  await assert.rejects(act("setPin", { pin: "4826", pin2: "4827" }), /مو نفس/);
  await assert.rejects(act("setPin", { pin: "1111", pin2: "1111" }), /سهل/);
  const r: any = await act("setPin", { pin: "٤٨٢٦", pin2: "4826" });
  assert.equal(r.hasPin, true);
  assert.equal(verifyGuardToken(r.gtoken), SID);
  assert.equal((await guardianOf(SID))?.guardian_id, pinGuardian(SID), "ينحسب ولي أمر مربوط");
  await assert.rejects(act("setPin", { pin: "5937", pin2: "5937" }), /محطوط/);
});

test("الرمز الغلط: 5 مرات تقفله، والصح يفتح بعد القفل", async () => {
  for (let i = 1; i <= 4; i++) await assert.rejects(act("open", { pin: "0000" }), /غلط/);
  await assert.rejects(act("open", { pin: "0000" }), /انقفل/);
  await assert.rejects(act("open", { pin: "4826" }), /انقفل/, "حتى الصح ما يفتح وهو مقفول");
  await put("guardian_pins", { ...(await one("guardian_pins", { user_id: SID }))!, locked_until: String(Date.now() - 1) });
  const r: any = await act("open", { pin: "4826" });
  assert.equal(verifyGuardToken(r.gtoken), SID);
});

test("رسائل ولي الأمر برمزه بس، والدوسة توصل للبوت باسمه", async () => {
  const g: any = await act("open", { pin: "4826" });
  await send(pinGuardian(SID), "📝 تم تصحيح امتحانك", { kb: [[{ text: "✅ استلمت", callback_data: "gs:done" }]] });
  await assert.rejects(act("list", { gtoken: "g1.2.3" }), /رمزك/);
  const l: any = await act("list", { gtoken: g.gtoken });
  assert.equal(l.msgs.at(-1).text, "📝 تم تصحيح امتحانك");
  const c: any = await act("cb", { gtoken: g.gtoken, mid: l.msgs.at(-1).mid, data: "gs:done" });
  assert.equal(c.answer, "✅ مستلمة");
});

test("صاحب البوت يصفّر الرمز: ينفك الربط، وولي الأمر يحط رمز جديد", async () => {
  await resetPin(SID);
  assert.equal((await act("state")).hasPin, false);
  assert.equal(await guardianOf(SID), null);
  await act("setPin", { pin: "5937", pin2: "5937" });
  assert.equal((await act("state")).hasPin, true);
});
