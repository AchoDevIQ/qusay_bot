// توزيع صفحات السكانر: كل سؤال بصفحة بالكود، أو ورقة A3 بترتيب الصفحات
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-pages-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const { assignPages } = await import("../app/store/scanup/assign.ts");
const { initDb, insert, find, put } = await import("../lib/db.ts");
const { attendAction, scanUpload } = await import("../lib/inPerson.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const init = `tk:${homeToken(1)}`;
const item = (over: object = {}) => ({ id: 1, ok: true, name: "ع", qs: [1, 2, 3, 4], map: [[1], [2, 3], [4]], ...over });
const hit = (seq: number, q = 0) => ({ item: 1, q, seq, label: `ص${seq}` });

test("A3: ترتيب الصفحات يعرّف الأسئلة، وصفحة بسؤالين تصير لهم الاثنين", () => {
  const { good, problems } = assignPages([hit(1), hit(2), hit(3)], new Map([[1, item()]]));
  assert.deepEqual(problems, []);
  assert.deepEqual(good.map((h) => h.qs), [[1], [2, 3], [4]]);
  assert.deepEqual(good.map((h) => h.q), [1, 2, 4]);
});
test("A3: صفحة ناقصة ما ترفع الورقة، حتى ما يروح جواب لغير سؤاله", () => {
  const { good, problems } = assignPages([hit(1), hit(2)], new Map([[1, item()]]));
  assert.equal(good.length, 0);
  assert.match(problems[0], /عنده 2 صفحة، والمفروض 3/);
});
test("كل سؤال بصفحة: الكود يعرّف السؤال، وبدون كود مشكلة", () => {
  const items = new Map([[1, item({ map: null, qs: [1, 2] })]]);
  const { good, problems } = assignPages([hit(1, 1), hit(2, 2), hit(3, 0)], items);
  assert.deepEqual(good.map((h) => h.q), [1, 2]);
  assert.match(problems[0], /ما معروف أي سؤال/);
});
test("صاحب البوت يحفظ التوزيع، والصفحة تنرفع مرة وحدة لأسئلتها", async () => {
  const exam = await insert("bank_exams", { slug: "p1", chapter: "الفصل الأول", ord: 1, title: "A3", minutes: 60 });
  const vid = await insert("bank_versions", { exam_id: exam, model: "A", kind: "mandatory", ok: 1 });
  for (const n of [1, 2, 3]) await insert("bank_questions", { version_id: vid, n, max_mark: 10 });
  await put("students", { user_id: 70, name: "حضوري", exam: "حضوري", created: "2026-01-01 00:00" });
  const it = await insert("sched_items", { user_id: 70, exam_id: exam, at: stamp(), status: "attended", version_id: vid });
  await assert.rejects(attendAction({ initData: init, action: "pageMap", exam, map: [[]] }), /أسئلة/);
  const saved: any = await attendAction({ initData: init, action: "pageMap", exam, map: [[1], [2, 3]] });
  assert.deepEqual(saved.exams.find((e: any) => e.id === exam).pageMap, [[1], [2, 3]]);
  assert.deepEqual(((await attendAction({ initData: init, action: "items", items: [it] })) as any).items[0].map, [[1], [2, 3]]);
  const fd = new FormData();
  fd.set("initData", init); fd.set("item", String(it)); fd.set("q", "2"); fd.set("qs", "2,3");
  fd.set("file", new Blob([new Uint8Array([0xff, 0xd8, 1, 2])], { type: "image/jpeg" }), "p.jpg");
  await scanUpload(fd);
  const rows = await find("exam_answers", { item_id: it });
  assert.deepEqual(rows.map((r) => r.q).sort(), [2, 3]);
  assert.equal(rows[0].file, rows[1].file);
  const back: any = await attendAction({ initData: init, action: "pageMap", exam, map: [] });
  assert.equal(back.exams.find((e: any) => e.id === exam).pageMap, null);
});
