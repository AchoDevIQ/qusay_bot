// تعديل ورقة مصححة: بالصلاحية بس، والدرجة تتغير ويوصل خبر
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-edit-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const sent: any[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  sent.push({ method: String(url).split("/").pop(), p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { initDb, insert, one, put } = await import("../lib/db.ts");
const { gradeAction } = await import("../lib/gradeApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const by = (u: number) => `tk:${homeToken(u)}`;

test("تعديل ورقة مصححة: البحث، الفتح، الدرجة الجديدة، والخبر", async () => {
  await put("students", { user_id: 80, name: "علي حسن عمر", curr: "عربي", exam: "إلكتروني", created: "2026-01-01 00:00" });
  await put("guardians", { guardian_id: 180, student_id: 80, created: stamp() });
  await put("staff", { user_id: 81, name: "مصحح عادي", perms: "grade" });
  await put("staff", { user_id: 82, name: "مصحح التعديل", perms: "grade,editgrade" });
  const exam = await insert("bank_exams", { slug: "e1", chapter: "الفصل الأول", ord: 1, title: "الجذور", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  for (const n of [1, 2]) await insert("bank_questions", { version_id: vid, n, max_mark: 50 });
  const id = await insert("sched_items", { user_id: 80, exam_id: exam, at: stamp(), status: "done", version_id: vid, submitted_at: stamp(), graded_at: stamp(), total: 60, grader_id: 81 });
  await put("question_marks", { item_id: id, q: 1, mark: 30 });
  await put("question_marks", { item_id: id, q: 2, mark: 30 });

  await assert.rejects(gradeAction({ initData: by(81), action: "find", q: "علي" }), (e: any) => e.status === 403);
  await assert.rejects(gradeAction({ initData: by(81), action: "openEdit", id }), (e: any) => e.status === 403);
  await assert.rejects(gradeAction({ initData: by(82), action: "mark", id, q: 1, mark: 40 }), /مخلصة/);

  const f: any = await gradeAction({ initData: by(82), action: "find", q: "علي" });
  assert.equal(f.found[0].id, id);
  assert.equal(f.canEdit, true);
  const opened: any = await gradeAction({ initData: by(82), action: "openEdit", id });
  assert.equal(opened.paper.editing, true);
  await gradeAction({ initData: by(82), action: "mark", id, q: 1, mark: 40 });
  sent.length = 0;
  const done: any = await gradeAction({ initData: by(82), action: "finish", id });
  assert.match(done.notice, /60 ← 70/);
  const row = (await one("sched_items", { id }))!;
  assert.equal(row.total, 70);
  assert.equal(row.grader_id, 81);
  assert.ok(sent.some((m) => String(m.p.chat_id) === "80" && /صارت <b>70/.test(m.p.text ?? "")));
  assert.ok(sent.some((m) => String(m.p.chat_id) === "180" && /صارت <b>70/.test(m.p.text ?? "")));
  // بعد الحفظ تنسد: التعديل الجاي يحتاج فتح جديد
  await assert.rejects(gradeAction({ initData: by(82), action: "mark", id, q: 1, mark: 10 }), /مخلصة/);
});
