// تسجيلات الفصول: التقرير اليومي لصاحب البوت واللي عنده الصلاحية، والرسالة الجماعية أو للأفراد بالكتابة أو بالصوت
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-su-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "sendAudio" ? { message_id: 1, audio: { file_id: "AUD1" } } : { message_id: 1 };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;
const { signupsAction, sweepSignups } = await import("../lib/signups.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const su = (uid: number, action: string, x: object = {}) => signupsAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const today = todayStr(), old = addDays(today, -3);
await put("staff", { user_id: 30, name: "مساعد التسجيل", perms: "signups" });
await put("staff", { user_id: 31, name: "مصحح", perms: "grade" });
const office = await insert("orders", { user_id: 60, name: "x", office_id: 1, created: today });
for (const [uid, name, ch, day, oid] of [[60, "علي", "الفصل الأول", today, office], [61, "زهراء", "الفصل الأول", today, null], [62, "حسين", "الفصل الأول", old, null], [61, "زهراء", "الفصل الثاني", today, null]] as const) {
  await put("students", { user_id: uid, name, exam: "إلكتروني", created: "x" });
  await insert("exam_access", { user_id: uid, chapter: ch, order_id: oid, created: `${day} 10:00` });
}

test("الصفحة لصاحب الصلاحية بس، وتبين كل فصل: اللي سجلوا باليوم ومنين، وعدد الفصل كله", async () => {
  await assert.rejects(su(31, "list"), (e: any) => e.status === 403);
  const r = await su(30, "list");
  const c1 = r.chapters.find((c: any) => c.chapter === "الفصل الأول");
  assert.deepEqual([c1.total, c1.students.map((s: any) => s.name)], [3, ["علي", "زهراء"]]);
  assert.equal(c1.students[0].source, "🏪 المكتب");
  assert.equal(r.days.length, 7);
  const back = await su(30, "list", { date: old });
  assert.deepEqual(back.chapters.find((c: any) => c.chapter === "الفصل الأول").students.map((s: any) => s.name), ["حسين"]);
});

test("التقرير اليومي يوصل لصاحب البوت واللي عنده الصلاحية، مرة وحدة باليوم", async () => {
  calls.length = 0;
  assert.equal(await sweepSignups(true), 2);
  const to = calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort();
  assert.deepEqual(to, [1, 30]);
  assert.match(calls[0].p.text, /الفصل الأول: <b>2<\/b>[\s\S]*الفصل الثاني: <b>1<\/b>[\s\S]*المجموع: <b>3<\/b>/);
  calls.length = 0;
  assert.equal(await sweepSignups(), 0);
});

test("الرسالة: لليوم، لكل الفصل، أو للمحددين، بالكتابة", async () => {
  calls.length = 0;
  let r = await su(30, "send", { chapter: "الفصل الأول", scope: "day", text: "أهلاً <بيكم>" });
  assert.match(r.notice, /2 من 2/);
  assert.deepEqual(calls.map((c) => c.p.chat_id).sort(), [60, 61]);
  assert.equal(calls[0].p.text, "أهلاً &lt;بيكم&gt;");
  calls.length = 0;
  r = await su(30, "send", { chapter: "الفصل الأول", scope: "all", text: "للكل" });
  assert.deepEqual(calls.map((c) => c.p.chat_id).sort(), [60, 61, 62]);
  calls.length = 0;
  await su(30, "send", { chapter: "الفصل الأول", scope: "picked", ids: [62, 999], text: "إلك" });
  assert.deepEqual(calls.map((c) => c.p.chat_id), [62]);
  await assert.rejects(su(30, "send", { chapter: "الفصل الأول", scope: "picked", ids: [], text: "x" }), /حدد طالب/);
  await assert.rejects(su(30, "send", { chapter: "الفصل الأول", scope: "all", text: " " }), /اكتب الرسالة أو سجل صوت/);
});

test("الصوت: يترفع مرة وحدة، والباقين ياخذون نفس الملف", async () => {
  calls.length = 0;
  const f = new FormData();
  f.set("initData", sign(1)); f.set("action", "send"); f.set("chapter", "الفصل الأول"); f.set("scope", "all"); f.set("text", "");
  f.set("voice", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }), "voice");
  const r = await signupsAction(f) as any;
  assert.match(r.notice, /3 من 3/);
  const audio = calls.filter((c) => c.method === "sendAudio");
  assert.equal(audio.length, 3);
  assert.equal(audio.filter((c) => c.p.audio === "<file>").length, 1);
  assert.equal(audio.filter((c) => c.p.audio === "AUD1").length, 2);
});
