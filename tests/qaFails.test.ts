// الذكاء ما جاوب سؤال علمي: سبب بكلام بسيط، تنبيه واحد يجمع الطلاب (نص ساعة بين تنبيه وتنبيه)،
// ومن يرجع الذكاء يشتغل ينجاوبون وحدهم، إلا اللي جاوبه الأستاذ أو مر عليه يومين
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-qafail-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const F = await import("../lib/qaFails.ts");
const { initDb, kvSet } = await import("../lib/db.ts");
await initDb();

const base = { uid: 5, name: "علي حسن", where: "المعدلات الزمنية", t: 3, l: 1, en: false, text: "سؤال", photo: "", why: "خدمة الذكاء ردت بخطأ (500)" };
const reset = async () => { await kvSet("qa_fails", "[]"); await kvSet("qa_fails_sent", "0"); };

test("سبب الفشل بكلام بسيط", () => {
  assert.equal(F.failWhy(new Error("خدمة التصحيح ردت 500")), "خدمة الذكاء ردت بخطأ (500)");
  assert.equal(F.failWhy(Object.assign(new Error("Your credit balance is too low to access the Anthropic API"), { status: 400 })), "رصيد حساب Anthropic خلص");
  assert.equal(F.failWhy(Object.assign(new Error("x"), { status: 429 })), "وصل حد الصرف أو حد الاستخدام بحساب Anthropic");
  assert.equal(F.failWhy(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), "الذكاء تأخر هواية وما رد");
  assert.equal(F.failWhy(new Error("نظام التصحيح AI مو مربوط")), "نظام الذكاء مو مربوط بالبوت");
  assert.equal(F.failWhy(new TypeError("fetch failed")), "البوت ما گدر يوصل لخدمة الذكاء");
});

test("التنبيه: أول مرة هسه، والجداد يتجمعون لحد ما تمر نص ساعة. ما يوصل للطالب", async () => {
  await reset();
  const t0 = 1_000_000_000_000;
  await F.noteQaFail({ ...base, qid: 11, ts: t0 });
  const first = await F.failAlertDue(t0);
  assert.match(first, /تنبيه إداري، ما يوصل للطالب/);
  assert.match(first, /علي حسن.*المعدلات الزمنية.*#11/);
  assert.match(first, /السبب: خدمة الذكاء ردت بخطأ \(500\)/);
  assert.match(first, /راحت للأستاذ/);
  // نفس السؤال ما يتنبه مرتين
  assert.equal(await F.failAlertDue(t0 + F.ALERT_GAP + 1), "");
  await F.noteQaFail({ ...base, qid: 12, name: "زينب", ts: t0 + 60_000 });
  await F.noteQaFail({ ...base, qid: 13, name: "مريم", why: "رصيد حساب Anthropic خلص", ts: t0 + 120_000 });
  assert.equal(await F.failAlertDue(t0 + 5 * 60_000), "");
  const second = await F.failAlertDue(t0 + F.ALERT_GAP + 1);
  assert.match(second, /\(2\)/);
  assert.ok(second.includes("زينب") && second.includes("مريم") && !second.includes("علي"));
  // سببين مختلفين: كل واحد جنب اسمه
  assert.match(second, /مريم[\s\S]*السبب: رصيد حساب Anthropic خلص/);
});

test("من يرجع الذكاء: ينجاوبون، واللي جاوبه الأستاذ أو مر عليه يومين ما ينعاد", async () => {
  await reset();
  const now = 2_000_000_000_000;
  await F.noteQaFail({ ...base, qid: 21, ts: now - 20 * 60_000 });
  await F.noteQaFail({ ...base, qid: 22, ts: now - 20 * 60_000 });          // جاوبه الأستاذ
  await F.noteQaFail({ ...base, qid: 23, ts: now - F.KEEP_FOR - 1 });       // قديم
  await F.noteQaFail({ ...base, qid: 24, ts: now - 60_000 });               // توه فشل: ينتظر 10 دقايق
  const tried: number[] = [];
  const r = await F.retryFails(async (f) => f.qid !== 22, async (f) => { tried.push(f.qid); return true; }, { now });
  assert.deepEqual(tried, [21]);
  assert.deepEqual(r.answered.map((f) => f.qid), [21]);
  assert.deepEqual((await F.qaFails()).map((f) => f.qid), [24]);
  // الزر: ما ينتظر
  const r2 = await F.retryFails(async () => true, async () => true, { now, force: true });
  assert.deepEqual(r2.answered.map((f) => f.qid), [24]);
  assert.equal(r2.left, 0);
  assert.match(F.backAlert(r.answered, 0), /رجع الذكاء يشتغل[\s\S]*#21/);
});

test("بعده واقف: يوگف عند أول واحد، والباقين يبقون، والسبب يتحدث", async () => {
  await reset();
  const now = 3_000_000_000_000;
  for (const qid of [31, 32, 33]) await F.noteQaFail({ ...base, qid, ts: now - 30 * 60_000 });
  let calls = 0;
  const r = await F.retryFails(async () => true, async () => { calls++; throw new Error("خدمة التصحيح ردت 503"); }, { now });
  assert.equal(calls, 1);
  assert.equal(r.why, "خدمة الذكاء ردت بخطأ (503)");
  assert.equal(r.left, 3);
  const l = await F.qaFails();
  assert.equal(l.find((f) => f.qid === 31)?.tried, now);
  // الذكاء ما لگاله حل: يبقى للأستاذ وينشال من القائمة
  const r2 = await F.retryFails(async () => true, async (f) => f.qid !== 32, { now, force: true });
  assert.deepEqual(r2.answered.map((f) => f.qid), [31, 33]);
  assert.equal(r2.left, 0);
});
