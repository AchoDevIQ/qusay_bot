// تعليقات الدرجات ومكتبة الملصقات: صاحب البوت بس، المقولات المقترحة، وما تتكرر على الطالب، وتوصل ويا الدرجة
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-cm-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method: String(url).split("/").pop()!, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { commentsAction, stickerUpload, stickerFile, pickComment } = await import("../lib/commentsApi.ts");
const { gradeAction } = await import("../lib/gradeApi.ts");
const { initDb, find, insert, put } = await import("../lib/db.ts");
const { DEFAULT_COMMENTS } = await import("../lib/defaultComments.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const c = (action: string, x: object = {}) => commentsAction({ initData: sign(1), action, ...x }) as Promise<any>;
const up = async (name: string, lo: number, hi: number, fname = "a.png") => {
  const f = new FormData();
  f.set("initData", sign(1)); f.set("name", name); f.set("lo", String(lo)); f.set("hi", String(hi)); f.set("file", new File([new Uint8Array([137, 80, 78, 71])], fname));
  return await stickerUpload(f) as any;
};

test("الصفحة لصاحب البوت بس، وتبدي بالمقولات المقترحة مرة وحدة", async () => {
  await put("staff", { user_id: 20, name: "مساعد", perms: "grade" });
  await assert.rejects(commentsAction({ initData: sign(20), action: "list" }), (x: any) => x.status === 403);
  const first = await c("list");
  assert.equal(first.comments.length, DEFAULT_COMMENTS.length);
  assert.ok(first.comments.every((x: any) => x.lo <= x.hi));
  await c("del", { id: first.comments[0].id });
  assert.equal((await c("list")).comments.length, DEFAULT_COMMENTS.length - 1);                  // ما ترجع تنضاف
});

test("إضافة وتعديل وحذف، والمدى محدود", async () => {
  await assert.rejects(c("add", { lo: 50, hi: 40, text: "x" }), /المدى/);
  await assert.rejects(c("add", { lo: 0, hi: 101, text: "x" }), /المدى/);
  await assert.rejects(c("add", { lo: 0, hi: 10, text: " " }), /اكتب/);
  const r = await c("add", { lo: 0, hi: 10, text: "مقولة <تجربة>" });
  const mine = r.comments.find((x: any) => x.text === "مقولة <تجربة>");
  await c("save", { id: mine.id, lo: 5, hi: 10, text: "معدلة", sticker: 0 });
  assert.ok((await c("list")).comments.some((x: any) => x.id === mine.id && x.lo === 5 && x.text === "معدلة"));
  await c("del", { id: mine.id });
});

test("الملصقات: نوع الصورة، وتنعرض، وتنمسح من المقولات", async () => {
  await assert.rejects(up("ملف", 0, 100, "a.exe"), /PNG/);
  const r = await up("بطل", 90, 100);
  const s = r.stickers[0];
  assert.equal(s.name, "بطل");
  assert.equal((await stickerFile(s.id)).type, "image/png");
  const a = await c("add", { lo: 0, hi: 100, text: "بملصق", sticker: s.id });
  const withSticker = a.comments.find((x: any) => x.text === "بملصق");
  assert.equal(withSticker.sticker, s.id);
  await c("delSticker", { id: s.id });
  assert.equal((await c("list")).comments.find((x: any) => x.id === withSticker.id).sticker, 0);
  await c("del", { id: withSticker.id });
});

test("المقولة عشوائية من مدى الدرجة وما تتكرر لحد ما تخلص", async () => {
  const fit = (await c("list")).comments.filter((x: any) => x.lo <= 97 && 97 <= x.hi);
  const got = new Set<string>();
  for (let i = 0; i < fit.length; i++) got.add((await pickComment(77, 97))!.text);
  assert.equal(got.size, fit.length);                                      // كلها مختلفة
  assert.ok((await pickComment(77, 97))!.text);                             // وبعدها تبدي من جديد
  assert.equal((await find("comment_sent", { user_id: 77 })).length, 1);
});

test("لمن تخلص الورقة، الطالب وولي أمره توصلهم المقولة ويا صورة الملصق", async () => {
  await up("أسطورة", 0, 100);
  await put("staff", { user_id: 30, name: "مصحح", perms: "grade" });
  await put("students", { user_id: 50, name: "علي حسن محمد كاظم", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 10:00" });
  await put("guardians", { guardian_id: 51, student_id: 50, created: "x" });
  const e = await insert("bank_exams", { slug: "t", chapter: "ف", ord: 1, title: "امتحان", info: "", minutes: 60, pos: 1 });
  const v = await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 });
  await insert("bank_questions", { version_id: v, n: 1, max_mark: 100, q_file: "t/q1.png" });
  const id = await insert("sched_items", { user_id: 50, exam_id: e, at: "x", status: "done", version_id: v, submitted_at: "x" });
  const g = (action: string, x: object = {}) => gradeAction({ initData: sign(30), action, id, ...x }) as Promise<any>;
  await g("open"); await g("mark", { q: 1, mark: 60 });
  calls.length = 0;
  await g("finish");
  const photos = calls.filter((x) => x.method === "sendPhoto");
  assert.deepEqual(photos.map((x) => x.p.chat_id).sort(), ["50", "51"]);
  assert.match(photos[0].p.caption, /60<\/b> من 100[\s\S]*💬 «/);
  assert.equal(photos[0].p.protect_content, "true");
});
