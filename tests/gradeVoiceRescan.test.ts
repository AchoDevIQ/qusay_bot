// التصحيح: تعليق بالفويس (ينحفظ بالأخطاء الشائعة ويوصل للطالب ويا ورقته)،
// ومسح ورقة حضوري انرفعت غلط بالسكنر: رسالة للي رفعها، وتبقى بقائمته لحد ما يعيد رفعها
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-gv-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { gradeAction, gradeUpload } = await import("../lib/gradeApi.ts");
const ip = await import("../lib/inPerson.ts");
const { initDb, insert, one, find, put } = await import("../lib/db.ts");
const { stamp, todayStr } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const g = (uid: number, action: string, x: object = {}) => gradeAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const voiceForm = (uid: number, id: number, name: string, keep: boolean) => {
  const f = new FormData();
  f.set("initData", sign(uid)); f.set("action", "voice"); f.set("id", String(id)); f.set("name", name); f.set("keep", keep ? "1" : "0");
  f.set("voice", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/ogg" }), "voice");
  return gradeUpload(f) as Promise<any>;
};
const jpg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: "image/jpeg" });
const scan = (uid: number, item: number, q: number) => { const fd = new FormData(); fd.set("initData", sign(uid)); fd.set("item", String(item)); fd.set("q", String(q)); fd.set("file", jpg(), "p.jpg"); return ip.scanUpload(fd); };

const area = await insert("areas", { gov: "بغداد", name: "البنوك" });
const center = await insert("centers", { area_id: area, name: "معهد تجربة", active: 1 });
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 60, pos: 1 });
const ver = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
await insert("bank_questions", { version_id: ver, n: 1, max_mark: 100, q_file: "none/q1.png" });
await put("staff", { user_id: 41, name: "مصحح", perms: "grade" });
await put("staff", { user_id: 42, name: "مساعد السكنر", perms: "camup" });
await put("staff", { user_id: 43, name: "مساعد ثاني", perms: "attend" });
await put("students", { user_id: 90, name: "إلكتروني أول", exam: "إلكتروني", created: "2026-01-01 00:00" });
await put("students", { user_id: 91, name: "إلكتروني ثاني", exam: "إلكتروني", created: "2026-01-01 00:00" });
await put("students", { user_id: 92, name: "حضوري أول", exam: "حضوري", center_id: center, created: "2026-01-01 00:00" });
const paper = async (uid: number) => {
  const id = await insert("sched_items", { user_id: uid, exam_id: ex, at: `${todayStr()} 10:00`, status: "done", version_id: ver, started_at: stamp(), submitted_at: stamp() });
  await insert("exam_answers", { item_id: id, q: 1, file: "none/a.jpg", created: stamp() });
  return id;
};
const p1 = await paper(90), p2 = await paper(91);

test("فويس على الورقة: ينحفظ بالأخطاء الشائعة، ومصحح ثاني يستعمله على ورقة ثانية بنفس الامتحان", async () => {
  await g(41, "open", { id: p1 });
  await assert.rejects(voiceForm(41, p1, "", true), /اسم قصير/);
  const r = await voiceForm(41, p1, "خطأ بالإشارة", true);
  assert.equal(r.voices.length, 1);
  assert.equal(r.voices[0].name, "خطأ بالإشارة");
  assert.match(r.voices[0].ref, /^gradevoices\//);
  assert.equal(r.myVoices.length, 1);
  // فويس بدون حفظ: يروح لهذي الورقة بس
  const r2 = await voiceForm(41, p1, "", false);
  assert.deepEqual([r2.voices.length, r2.myVoices.length], [1, 2]);
  // الورقة الثانية تشوف الفويس المحفوظ وتضيفه بضغطة
  const open2 = await g(1, "open", { id: p2 });
  assert.equal(open2.paper.voices.length, 1);
  assert.equal(open2.paper.myVoices.length, 0);
  const used = await g(1, "voiceUse", { id: p2, vid: open2.paper.voices[0].id });
  assert.equal(used.myVoices.length, 1);
  // ورقة مو إله ما يگدر يضيف عليها
  await assert.rejects(g(41, "voiceUse", { id: p2, vid: open2.paper.voices[0].id }), /مصحح ثاني/);
});

test("الحفظ: الفويسات توصل للطالب بعد ورقته، مرقمة، ومحمية. وولي الأمر ما توصله", async () => {
  await put("question_marks", { item_id: p1, q: 1, mark: 70 });
  calls.length = 0;
  await g(41, "finish", { id: p1 });
  const v = calls.filter((c) => c.method === "sendVoice");
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((c) => c.p.chat_id), ["90", "90"]);
  assert.match(v[0].p.caption, /تعليق المصحح 1/);
  assert.match(v[1].p.caption, /تعليق المصحح 2/);
  assert.equal(v[0].p.protect_content, "true");
});

test("حذف فويس من الأخطاء الشائعة ومن الورقة", async () => {
  const open2 = await g(1, "open", { id: p2 });
  const vid = open2.paper.voices[0].id;
  assert.equal((await g(1, "voiceDrop", { id: p2, n: 1 })).myVoices.length, 0);
  assert.equal((await g(1, "voiceDel", { id: p2, vid })).voices.length, 0);
});

test("السكنر غلط: الورقة تنمسح، وتوصل رسالة للي رفعها، وتبقى بقائمته لحد ما يعيد رفعها", async () => {
  const it = await insert("sched_items", { user_id: 92, exam_id: ex, at: `${todayStr()} 10:00`, status: "attended", version_id: ver, attended_at: stamp() });
  await scan(42, it, 1);
  await ip.attendAction({ initData: sign(42), action: "finish", items: [it] });
  assert.equal((await one("sched_items", { id: it }))!.status, "done");
  // الورقة الإلكترونية ما بيها هذا الزر
  await g(41, "open", { id: p2 }).catch(() => undefined);
  await g(41, "open", { id: it });
  await put("question_marks", { item_id: it, q: 1, mark: 10 });
  calls.length = 0;
  const r = await g(41, "rescan", { id: it });
  assert.match(r.notice, /انمسحت أوراق حضوري أول/);
  const msgs = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(msgs.map((c) => c.p.chat_id), [42]);
  assert.match(msgs[0].p.text, /عيد رفع ورقة/);
  assert.match(msgs[0].p.text, /حضوري أول/);
  assert.match(msgs[0].p.text, /معهد تجربة/);
  assert.match(msgs[0].p.text, /الأوميگا/);
  const row = (await one("sched_items", { id: it }))!;
  assert.deepEqual([row.status, row.grader_id], ["attended", null]);
  assert.equal((await find("exam_answers", { item_id: it })).length, 0);
  assert.equal((await find("question_marks", { item_id: it })).length, 0);
  // بقائمة اللي رفعها، ومو بقائمة مساعد ثاني ما رفعها
  assert.equal((await ip.attendAction({ initData: sign(42), action: "list" }) as any).rescan.length, 1);
  assert.equal((await ip.attendAction({ initData: sign(43), action: "list" }) as any).rescan.length, 0);
  // الكاميرا تفتح نفس الورقة حتى لو مو يومها
  const cam = await ip.attendAction({ initData: sign(42), action: "cam", code: "92" }) as any;
  assert.equal(cam.cam.item, it);
  // يعيد الرفع: تنشال من قائمته وحدها
  await scan(42, it, 1);
  await ip.attendAction({ initData: sign(42), action: "finish", items: [it] });
  assert.equal((await ip.attendAction({ initData: sign(42), action: "list" }) as any).rescan.length, 0);
  assert.equal((await one("sched_items", { id: it }))!.status, "done");
});

test("الورقة الإلكترونية: كل أوراقه تنمسح، وينفتح إله الامتحان، وتوصله رسالة يعيد رفعها", async () => {
  const p3 = await paper(91);
  await g(41, "open", { id: p3 });
  calls.length = 0;
  const r = await g(41, "rescan", { id: p3 });
  assert.match(r.notice, /انفتح إله الامتحان/);
  const row = (await one("sched_items", { id: p3 }))!;
  assert.deepEqual([row.status, row.submitted_at, row.grader_id], ["exception", null, null]);
  assert.equal((await find("exam_answers", { item_id: p3 })).length, 0);
  const msgs = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(msgs.map((c) => c.p.chat_id), [91]);
  assert.match(msgs[0].p.text, /عيد رفع أجوبتك/);
});
