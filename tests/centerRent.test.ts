// المراكز: تقرير الحضور بعد كل جلسة للمدير، والتقرير الشهري، وحساب الإيجار ودفعه
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-cr-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method: String(url).split("/").pop()!, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { rentAction, sweepSessions } = await import("../lib/centerRent.ts");
const { initDb, insert, put, find } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const r = (uid: number, action: string, x: object = {}) => rentAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const area = await insert("areas", { gov: "بغداد", name: "زيونة", active: 1 });
const center = await insert("centers", { area_id: area, name: "معهد زيونة", active: 1 });
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 1, pos: 1 });
const today = todayStr(), month = today.slice(0, 7);
for (const [uid, name, gender] of [[60, "علي", "بنين"], [61, "زهراء", "بنات"], [62, "حسين", "بنين"]] as const) {
  await put("students", { user_id: uid, name, gender, exam: "حضوري", center_id: center, created: "x" });
}
// جلسة اليوم الصبح: اثنين حضروا وواحد غاب
await insert("sched_items", { user_id: 60, exam_id: ex, at: `${today} 00:00`, status: "attended", attended_at: `${today} 00:00` });
await insert("sched_items", { user_id: 61, exam_id: ex, at: `${today} 00:00`, status: "attended", attended_at: `${today} 00:00` });
await insert("sched_items", { user_id: 62, exam_id: ex, at: `${today} 00:00`, status: "waiting" });

test("صفحة المراكز لصاحب البوت بس، ويحفظ المدير والسعر", async () => {
  await put("staff", { user_id: 30, name: "مساعد", perms: "attend" });
  await assert.rejects(r(30, "list"), (e: any) => e.status === 403);
  await assert.rejects(r(1, "save", { center, managers: "abc", price: 4000 }), /أرقام بس/);
  const s = await r(1, "save", { center, managers: "500 501", price: 4000 });
  const c = s.centers.find((x: any) => x.id === center);
  assert.deepEqual([c.managers, c.price, c.students, c.boys, c.girls, c.amount], [[500, 501], 4000, 2, 1, 1, 8000]);
});

test("بعد ما تخلص الجلسة: تقرير الحضور يوصل للمدراء وصاحب البوت، ومرة وحدة بس", async () => {
  calls.length = 0;
  assert.equal(await sweepSessions(), 1);
  const to = calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort();
  assert.deepEqual(to, [1, 500, 501]);
  const text = calls[0].p.text;
  assert.match(text, /حضر <b>2<\/b> من 3 \(بنين 1 · بنات 1\)/);
  assert.match(text, /غاب 1: حسين/);
  calls.length = 0;
  assert.equal(await sweepSessions(), 0);
  assert.equal(calls.length, 0);
});

test("الشهر: التقرير يوصل إلك وللمدير، والدفع ينسجل ويوصله خبر بالمبلغ والوقت", async () => {
  calls.length = 0;
  const rep = await r(1, "report", { center, month });
  assert.match(rep.notice, /التقرير الشهري/);
  const docs = calls.filter((c) => c.method === "sendDocument");
  assert.deepEqual(docs.map((d) => Number(d.p.chat_id)).sort(), [1, 500, 501]);
  assert.match(docs[0].p.caption, /2 طالب \(بنين 1 · بنات 1\) × 4,000 = 8,000 دينار/);
  // بالقائمة: كم امتحان حضر من اللي إله بالجدول هذا الشهر
  await insert("sched_items", { user_id: 60, exam_id: ex, at: `${today} 23:59`, status: "missed" });
  await r(1, "report", { center, month });
  const html = fs.readdirSync(tmp).filter((f) => f.endsWith(".html")).map((f) => fs.readFileSync(path.join(tmp, f), "utf8")).join("");
  assert.match(html, /الامتحانات اللي حضرها/);
  assert.match(html, /1 من 2/);
  calls.length = 0;
  const p = await r(1, "pay", { center, month });
  assert.match(p.notice, /8,000 دينار/);
  assert.equal(p.centers.find((x: any) => x.id === center).paid.length, 1);
  const msg = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(msg.map((m) => m.p.chat_id).sort(), [500, 501]);
  assert.match(msg[0].p.text, /تم تسليم إيجار[\s\S]*8,000 دينار[\s\S]*الساعة/);
  assert.equal((await find("center_rent", { center_id: center })).length, 1);
});
