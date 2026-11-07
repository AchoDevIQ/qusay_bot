// ملف كل محاضرة: صاحب البوت يرفعه ويخليه ظاهر أو مخفي، والطالب يوصله بالبوت محمي.
// ومنع الغش: بنص الامتحان ماكو ملفات ولا أسئلة ولا اعتراضات
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-lf-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1, document: { file_id: "DOC1" } } }));
}) as typeof fetch;
const { lecturesAction, lectureFileUpload } = await import("../lib/lectures.ts");
const { myExamAction } = await import("../lib/schedApi.ts");
const { askStart } = await import("../lib/questions.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const lec = (action: string, x: object = {}) => lecturesAction({ initData: sign(1), action, ...x }) as Promise<any>;
const me = (action: string, x: object = {}) => myExamAction({ token: homeToken(60), device: "dev-00000000000060", action, ...x }) as Promise<any>;
const NAME = "قطع مكافئ: المحاضرة 1";
const ex = await insert("bank_exams", { slug: "c2", chapter: "الفصل الثاني", ord: 1, title: "قطع مكافئ 1&2", minutes: 60, pos: 2 });
const v = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
await insert("bank_questions", { version_id: v, n: 1, max_mark: 100, q_file: "t/q1.png" });
await put("students", { user_id: 60, name: "طالب", exam: "إلكتروني", created: "2026-01-01 00:00:00" });
await insert("sched_items", { user_id: 60, exam_id: ex, at: "2027-02-01 10:00", status: "waiting" });

test("صاحب البوت يرفع ملف المحاضرة، وأول ما ينرفع يبقى مخفي، ويبينه بزر", async () => {
  const f = new FormData();
  f.set("initData", sign(1)); f.set("name", NAME); f.set("file", new File([new Uint8Array([37, 80, 68, 70])], "مكافئ1.pdf"));
  const r = await lectureFileUpload(f) as any;
  assert.match(r.notice, /بعده مخفي/);
  assert.deepEqual([r.files[NAME].fname, r.files[NAME].visible], ["مكافئ1.pdf", false]);
  assert.deepEqual((await me("info")).lectureFiles, []);
  await assert.rejects(me("lectureFile", { name: NAME }), /مو متوفر/);
  assert.equal((await lec("fileShow", { name: NAME, visible: true })).files[NAME].visible, true);
  assert.deepEqual((await me("info")).lectureFiles, [NAME]);
});

test("الطالب يوصله الملف بالبوت محمي، والمرة الثانية بدون رفع", async () => {
  calls.length = 0;
  const r = await me("lectureFile", { name: NAME });
  assert.match(r.notice, /وصلك ملف المحاضرة/);
  assert.equal(calls[0].method, "sendDocument");
  assert.equal(calls[0].p.protect_content, "true");
  assert.equal(calls[0].p.document, "<file>");
  calls.length = 0;
  await me("lectureFile", { name: NAME });
  assert.equal(calls[0].p.document, "DOC1");
  assert.equal(calls[0].p.protect_content, true);
});

test("بنص الامتحان: ماكو ملفات ولا أسئلة ولا اعتراضات، وبعد ما يخلص ترجع", async () => {
  const live = await insert("sched_items", { user_id: 60, exam_id: ex, at: stamp(), status: "started", version_id: v, started_at: stamp() });
  const info = await me("info");
  assert.equal(info.inExam, true);
  assert.deepEqual(info.lectureFiles, []);
  await assert.rejects(me("lectureFile", { name: NAME }), (e: any) => e.status === 423 && /امتحان مفتوح/.test(e.message));
  await assert.rejects(me("objInfo", { item: live }), (e: any) => e.status === 423);
  calls.length = 0;
  await askStart(60, 60);
  assert.match(calls[0].p.text, /عندك امتحان مفتوح هسه/);
  // سلمه: كلشي يرجع
  const { update } = await import("../lib/db.ts");
  await update("sched_items", { id: live }, { status: "done", submitted_at: stamp() });
  assert.equal((await me("info")).inExam, false);
  assert.deepEqual((await me("info")).lectureFiles, [NAME]);
});

test("الحذف يشيل الملف من الطالب", async () => {
  await lec("fileDelete", { name: NAME });
  assert.deepEqual((await me("info")).lectureFiles, []);
});
