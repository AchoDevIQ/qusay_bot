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

test("الوجه: بصمة مشفرة، القريب يفتح والبعيد يرفض، والصور تنحفظ مشفرة وصاحب البوت يشوفها", async () => {
  const { setFace, openWithFace, signPhotos } = await import("../lib/guardianPin.ts");
  const { one } = await import("../lib/db.ts");
  const face = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1);
  const near = face.map((x) => x + 0.01);
  const far = face.map((x, i) => x + (i % 2 ? 0.2 : -0.2));
  const jpg = "data:image/jpeg;base64," + Buffer.from("fake-jpeg").toString("base64");
  await assert.rejects(setFace(SID, [1, 2, 3], jpg), /الوجه/);
  await setFace(SID, face, jpg);
  const row = await one("guardian_pins", { user_id: SID });
  assert.ok(String(row?.face).startsWith("v1."), "البصمة مشفرة");
  assert.ok(!String(row?.face).includes("0.0841"), "ما تنقرا بدون المفتاح");
  assert.equal(verifyGuardToken(await openWithFace(SID, near, jpg)), SID);
  await assert.rejects(openWithFace(SID, far, jpg), /ما تطابق/);
  const photos = await signPhotos(SID);
  assert.ok(photos.length >= 2);
  assert.ok(photos.some((p) => p.kind === "تسجيل الوجه"));
  assert.equal(Buffer.from(photos[0].src.split(",")[1], "base64").toString(), "fake-jpeg");
});

test("تلفون ولي الأمر نفسه: رابطه يفتح الصفحة برمزه بس، وينبطل إذا انصفّر الرمز، ويحفظ اشتراك الإشعارات", async () => {
  const { deviceLink, verifyDeviceKey } = await import("../lib/guardianPush.ts");
  const { find } = await import("../lib/db.ts");
  const link = await deviceLink(SID);
  const d = new URL(link).searchParams.get("d")!;
  assert.equal(await verifyDeviceKey(d), SID);
  const own = (action: string, x: object = {}) => guardianAction({ d, action, ...x });
  const st: any = await own("state");
  assert.equal(st.own, true);
  await assert.rejects(own("setPin", { pin: "1357", pin2: "1357" }), /تلفون ابنك/);
  const o: any = await own("open", { pin: "5937" });
  await own("pushSub", { gtoken: o.gtoken, sub: { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } } });
  assert.equal((await find("guardian_push", { user_id: SID })).length, 1);
  await assert.rejects(own("pushSub", { gtoken: o.gtoken, sub: { endpoint: "http://bad", keys: {} } }), /الإشعارات/);
  await resetPin(SID);
  assert.equal(await verifyDeviceKey(d), null, "الرابط القديم ينبطل");
  await assert.rejects(own("state"), /انتهى/);
});
