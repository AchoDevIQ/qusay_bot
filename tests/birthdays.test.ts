// أعياد الميلاد: منو عيد ميلاده اليوم ويا معدله، والرسالة الصبح لصاحب البوت واللي عنده الصلاحية، واللي معدله عالي فوك
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-bd-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { birthdayAction, sweepBirthdays, birthdaysOn } = await import("../lib/birthdays.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const bd = (uid: number, action: string, x: object = {}) => birthdayAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const today = todayStr(), md = today.slice(5);
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "امتحان", minutes: 60, pos: 1 });
await put("staff", { user_id: 30, name: "مساعد الأعياد", perms: "birthdays" });
await put("staff", { user_id: 31, name: "مصحح", perms: "grade" });
for (const [uid, name, birth] of [[60, "شاطر", `2008-${md}`], [61, "عادي", `2007-${md}`], [62, "جديد", `2008-${md}`], [63, "مو اليوم", "2008-01-01"], [-1, "تجربة", `2008-${md}`]] as const) {
  await put("students", { user_id: uid, name, exam: "إلكتروني", birth, created: "x" });
}
const graded = (uid: number, total: number, kind: string | null = null) => insert("sched_items", { user_id: uid, exam_id: ex, at: "x", status: "done", graded_at: "x", total, kind });
await graded(60, 96); await graded(60, 92); await graded(61, 70); await graded(61, 100, "optional");

test("اليوم: الطلاب الحقيقيين بس، ومعدلهم من الإجباري المصحح، والأعلى أول", async () => {
  const l = await birthdaysOn(today);
  assert.deepEqual(l.map((s) => [s.name, s.avg, s.exams]), [["شاطر", 94, 2], ["عادي", 70, 1], ["جديد", null, 0]]);
  if (md !== "01-01") assert.ok(!l.some((s) => s.name === "مو اليوم"));
});

test("الصفحة لصاحب الصلاحية، والحد يغيره صاحب البوت بس", async () => {
  await assert.rejects(bd(31, "list"), (e: any) => e.status === 403);
  const r = await bd(30, "list");
  assert.equal(r.days[0].n, 3);
  await assert.rejects(bd(30, "save", { min: 80 }), (e: any) => e.status === 403);
  assert.equal((await bd(1, "save", { min: 90 })).min, 90);
});

test("رسالة الصبح: لصاحب البوت والمساعد، واللي معدله فوك الحد فوك، ومرة وحدة باليوم", async () => {
  calls.length = 0;
  assert.equal(await sweepBirthdays(true), 2);
  const to = calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort();
  assert.deepEqual(to, [1, 30]);
  assert.match(calls[0].p.text, /اليوم 3 طلاب عيد ميلادهم[\s\S]*معدلهم 90 فما فوق \(1\)[\s\S]*شاطر[\s\S]*الباقين[\s\S]*عادي[\s\S]*جديد · \d+ سنة · بعده ما امتحن/);
  calls.length = 0;
  assert.equal(await sweepBirthdays(), 0);
  assert.equal(calls.length, 0);
});
