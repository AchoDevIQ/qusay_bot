// ملف الطالب: كل بياناته بمكان واحد
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-file-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const { initDb, insert, put } = await import("../lib/db.ts");
const { studentAction } = await import("../lib/studentApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const init = `tk:${homeToken(1)}`;

test("ملف الطالب يجمع درجاته وغياباته ومشترياته وإيقافاته وسجله، وللي عنده صلاحية بس", async () => {
  await put("students", { user_id: 50, name: "علي حسن عمر علي", curr: "عربي", grade: "السادس العلمي", exam: "حضوري", created: "2026-01-01 00:00" });
  await put("students", { user_id: 51, name: "طالب ثاني", curr: "عربي", grade: "السادس العلمي", exam: "حضوري", created: "2026-01-01 00:00" });
  const ex = await insert("bank_exams", { slug: "f1", chapter: "الفصل الأول", ord: 1, title: "الجذور", minutes: 60 });
  const ex2 = await insert("bank_exams", { slug: "f1", chapter: "الفصل الأول", ord: 2, title: "الأوميگا", minutes: 60 });
  const v = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
  await insert("sched_items", { user_id: 50, exam_id: ex, at: stamp(), status: "done", version_id: v, submitted_at: stamp(), graded_at: stamp(), total: 80 });
  await insert("sched_items", { user_id: 50, exam_id: ex2, at: "2026-02-01 10:00", status: "missed" });
  await insert("sched_items", { user_id: 51, exam_id: ex, at: stamp(), status: "missed" });
  await insert("orders", { user_id: 50, items: JSON.stringify([{ name: "امتحانات الفصل الأول", qty: 1, price: 25000 }, { name: "ملزمة الفصل الأول", qty: 1, price: 9000 }]), total: 39000, printed: 3, created: stamp() });
  await insert("orders", { user_id: 50, items: JSON.stringify([{ name: "محاضرات الفصل الثاني", qty: 1, price: 30000 }]), total: 30000, printed: 2, created: stamp() });
  await insert("orders", { user_id: 50, items: JSON.stringify([{ name: "ملزمة الفصل الثاني", qty: 1, price: 9000 }]), total: 9000, printed: 3, created: stamp() });
  await insert("student_stops", { user_id: 50, chapter: "الفصل الأول", score: 40, max: 200, absent: 2, reason: "درجة", created: stamp() });
  const r: any = await studentAction({ initData: init, action: "file", id: 50 });
  const f = r.file;
  assert.equal(f.id, 50);
  assert.equal(f.papers.length, 1);
  assert.equal(f.papers[0].total, 80);
  assert.equal(f.average, 80);
  assert.deepEqual(f.absences.map((a: any) => a.title), ["الأوميگا"]);
  assert.equal(f.spent, 25000);
  assert.equal(f.orders.length, 2);
  assert.equal(f.orders.find((o: any) => o.total === 30000).cancelled, true);
  assert.ok(!JSON.stringify(f.orders).includes("ملزمة"));
  assert.equal(f.stops.length, 1);
  assert.ok(f.fileToken);
  await assert.rejects(studentAction({ initData: init, action: "file", id: 999 }), /غير موجود/);
  await put("staff", { user_id: 60, name: "مساعد", perms: "q" });
  await assert.rejects(studentAction({ initData: `tk:${homeToken(60)}`, action: "file", id: 50 }), (e: any) => e.status === 403);
});
