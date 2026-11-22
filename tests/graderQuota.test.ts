// 🎯 حصة كل مصحح باليوم، و🛑 «يوقف من يوصل حصته»، وغرامة اليوم، و📜 عقد المصححين (طلب الأستاذ 2026-11-22)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-quota-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { gradeAction } = await import("../lib/gradeApi.ts");
const P = await import("../lib/graderPay.ts");
const { initDb, insert, put, update, find } = await import("../lib/db.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const g = (uid: number, action: string, x: object = {}) => gradeAction({ initData: sign(uid), action, ...x }) as Promise<any>;

const ex = await insert("bank_exams", { slug: "ch1", chapter: "الفصل الأول", ord: 1, title: "الثوابت", info: "", minutes: 60, pos: 1 });
const v = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
await insert("bank_questions", { version_id: v, n: 1, max_mark: 100, q_file: "t/q1.png" });
for (const [id, name] of [[31, "علي حسن"], [32, "زيد كريم"], [33, "سارة أحمد"]] as const) await put("staff", { user_id: id, name, perms: "grade" });
const today = stamp().slice(0, 10);
const old = "2026-01-10";
const paper = (uid: number, day: string) => insert("sched_items", { user_id: uid, exam_id: ex, at: `${day} 10:00`, status: "done", version_id: v, submitted_at: `${day} 11:00` });
const todays: number[] = [];
for (let i = 0; i < 20; i++) todays.push(await paper(100 + i, today));

test("الحصة بالعدد: الأوراق ÷ المصححين، واللي قدرته ×2 ياخذ ضعف", async () => {
  let q = await P.dayQuotas(today);
  assert.deepEqual([31, 32, 33].map((id) => q.get(id)!.target), [7, 7, 7]);   // 20 ÷ 3 ← 7 لكل واحد
  await g(1, "setRate", { grader: 31, mandatory: 100, optional: 100, deduct: 0, chapters: [], weight: 2 });
  P.clearQuotaCache();
  q = await P.dayQuotas(today);
  assert.deepEqual([31, 32, 33].map((id) => q.get(id)!.target), [10, 5, 5]);   // 20 × 2/4 = 10
  const l = await g(32, "list");
  assert.deepEqual(l.quota, { target: 5, done: 0 }, "يشوف «🎯 حصتك اليوم»");
});

test("🛑 يوقف من يوصل حصته: بالأصل يكمل، وإذا انأشر الامتحان ما تطلعله أوراق جديدة", async () => {
  for (const id of todays.slice(0, 5)) await update("sched_items", { id }, { grader_id: 32, graded_at: `${today} 12:00` });
  P.clearQuotaCache();
  assert.equal((await g(32, "list")).waiting.length, 15, "بالأصل يكمل ويعوض");
  await assert.rejects(g(32, "quotaStop", { exam: ex, on: true }), (e: any) => e.status === 403);
  await g(1, "quotaStop", { exam: ex, on: true });
  P.clearQuotaCache();
  assert.equal((await g(32, "list")).waiting.length, 0, "وصل حصته (5): يوقف");
  assert.equal((await g(33, "list")).waiting.length, 15, "اللي ما وصل يكمل");
  await g(1, "quotaStop", { exam: ex, on: false });
  P.clearQuotaCache();
  assert.equal((await g(32, "list")).waiting.length, 15);
});

test("الغرامة: يوم ما وصل بيه حصته والأوراق ما خلصت. إذا غيره عوض، ماكو غرامة. والتسوية تخصمها أو تسامحه", async () => {
  // يوم قديم: 6 أوراق، 3 مصححين (31 قدرته ×2: حصته 3، الباقين 2 و2)
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) ids.push(await paper(200 + i, old));
  // 33 صحح 4 (عوض عن 32)، و31 صحح 2، فبقت ورقة ما مصححة بنهاية اليوم
  for (const id of ids.slice(0, 4)) await update("sched_items", { id }, { grader_id: 33, graded_at: `${old} 20:00` });
  for (const id of ids.slice(4, 5)) await update("sched_items", { id }, { grader_id: 31, graded_at: `${old} 20:00` });
  await put("grader_pay", { ...(await find("grader_pay", { user_id: 32 }))[0] ?? { user_id: 32 }, mandatory: 100, optional: 100, deduct: 0, fine: 5000, fine_from: "2026-01-01" });
  await put("grader_pay", { ...(await find("grader_pay", { user_id: 31 }))[0], fine: 5000, fine_from: "2026-01-01" });
  P.clearQuotaCache();
  assert.deepEqual((await P.fineDays(32)).map((f) => [f.day, f.done, f.target]), [[old, 0, 2]], "ما صحح والأوراق ما خلصت");
  assert.deepEqual((await P.fineDays(31)).map((f) => [f.day, f.done, f.target]), [[old, 1, 3]]);
  // ورقة آخر اليوم انصححت بنفس اليوم: خلصت، فماكو غرامة على أحد (غيرهم عوض)
  await update("sched_items", { id: ids[5] }, { grader_id: 33, graded_at: `${old} 23:00` });
  P.clearQuotaCache();
  assert.equal((await P.fineDays(32)).length, 0);
  assert.equal((await P.fineDays(31)).length, 0);
  // ترجع ما مصححة: الغرامة ترجع، والتسوية تخصمها
  await update("sched_items", { id: ids[5] }, { grader_id: null, graded_at: null });
  P.clearQuotaCache();
  const b = await P.balanceOf(32);
  assert.equal(b.fines.length, 1);
  assert.equal(b.amount, 5 * 100 - 5000, "5 أوراق صححها اليوم ناقص غرامة يوم");
  await g(1, "settle", { grader: 32 });
  assert.equal((await P.fineDays(32)).length, 0, "اليوم اللي انحاسب ما يرجع");
  const b31 = await P.balanceOf(31);
  await g(1, "settle", { grader: 31, forgiveFine: true });
  const s = (await find("grader_settlements", { user_id: 31 })).at(-1)!;
  assert.equal(s.fine_forgiven, 1);
  assert.equal(s.amount, b31.amount + 5000, "سامحه بالغرامة");
});

test("📜 العقد: صاحب البوت يكتب الصيغة، المصحح يوقع، وإذا تغيرت يوقع من جديد", async () => {
  assert.equal((await g(32, "list")).contractDue, false, "ماكو عقد بعد");
  await assert.rejects(g(32, "contractSave", { text: "أنا {الاسم} أتعهد بتصحيح حصتي اليومية" }), (e: any) => e.status === 403);
  await g(1, "contractSave", { text: "أنا {الاسم} أتعهد بتصحيح حصتي اليومية، وإلا أدفع {الغرامة} عن كل يوم." });
  assert.equal((await g(32, "list")).contractDue, true);
  const c = (await g(32, "contract")).contract;
  assert.match(c.mine, /أنا زيد كريم أتعهد/);
  assert.match(c.mine, /5,000 دينار/);
  const sig = { w: 600, h: 220, s: [[10, 10, 50, 60, 90, 20, 120, 80, 150, 40]] };
  await assert.rejects(g(32, "contractSign", { name: "زيد", sig }), /اسمك الكامل/);
  await assert.rejects(g(32, "contractSign", { name: "زيد كريم", sig: { w: 600, h: 220, s: [] } }), /توقيعك/);
  await g(32, "contractSign", { name: "زيد كريم علي", sig });
  assert.equal((await g(32, "list")).contractDue, false);
  const own = (await g(1, "contract")).contract;
  assert.ok(own.graders.find((x: any) => x.id === 32).signed.current);
  const copy = (await g(1, "contractCopy", { grader: 32 })).contract.copy;
  assert.equal(copy.name, "زيد كريم علي");
  assert.match(copy.text, /زيد كريم/);
  // 👁 شكل العقد قبل الحفظ باسم مصحح أو «فلان الفلاني»، وتوقيع الأستاذ يطلع بكل العقود
  await assert.rejects(g(32, "contractPreview", { text: "أنا الموقع أدناه {الاسم} أتعهد بالتصحيح" }), (e: any) => e.status === 403);
  assert.match((await g(1, "contractPreview", { text: "أنا الموقع أدناه {الاسم} أتعهد بالتصحيح", grader: 33 })).contract.preview.text, /أنا الموقع أدناه سارة أحمد/);
  assert.match((await g(1, "contractPreview", { text: "أنا الموقع أدناه {الاسم} أتعهد بالتصحيح" })).contract.preview.text, /فلان الفلاني/);
  await assert.rejects(g(32, "contractOwnSign", { sig }), (e: any) => e.status === 403);
  await g(1, "contractOwnSign", { sig });
  assert.equal((await g(32, "contract")).contract.own.s.length, 1);
  // صيغة جديدة: يوقع من جديد
  await g(1, "contractSave", { text: "أنا {الاسم} أتعهد بتصحيح حصتي اليومية كاملة، وإلا أدفع {الغرامة} عن كل يوم." });
  assert.equal((await g(32, "list")).contractDue, true);
});
