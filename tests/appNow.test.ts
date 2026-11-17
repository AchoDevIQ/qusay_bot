// «يهمك هسه»: بطاقات الرئيسية بالترتيب: المفتوح هسه، امتحانات اليوم وباچر (كل امتحان بطاقة)، الإشعارات، الدرجة، الطلب، وإلا الامتحان الجاي
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-now-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { put, insert } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { nowCards } = await import("../lib/appNow.ts");
await ensure();
const NOW = "2026-11-18 16:00";
await put("students", { user_id: 80, name: "علي", exam: "إلكتروني", created: "x" });
const e1 = Number(await insert("bank_exams", { title: "الأعداد المركبة", chapter: "الفصل الأول", minutes: 60 }));
const e3 = Number(await insert("bank_exams", { title: "القطوع المخروطية", chapter: "الفصل الثالث", minutes: 60 }));

test("امتحانين باچر (تعويض الأول والثالث ويا جماعته): بطاقتين جنب بعض، كل وحدة بوقتها ومكانها", async () => {
  await insert("sched_items", { user_id: 80, exam_id: e1, at: "2026-11-19 10:00", status: "waiting", kind: "catchup", fixed: 1 });
  await insert("sched_items", { user_id: 80, exam_id: e3, at: "2026-11-19 17:00", status: "waiting" });
  await insert("sched_items", { user_id: 80, exam_id: e3, at: "2026-11-25 17:00", status: "waiting" });
  const c = await nowCards(80, NOW);
  assert.deepEqual(c.map((x) => x.title), ["📝 الأعداد المركبة", "📝 القطوع المخروطية"]);
  assert.match(c[0].text, /باچر الساعة 10:00 صباحاً · تعويض إلكتروني/);
  assert.match(c[1].text, /باچر الساعة 5:00 مساءً · إلكتروني/);
});

test("المفتوح هسه أول، والإشعار والدرجة والطلب وراه", async () => {
  await insert("sched_items", { user_id: 80, exam_id: e3, at: "2026-11-18 15:50", status: "waiting" });
  await insert("sched_items", { user_id: 80, exam_id: e1, at: "2026-11-17 17:00", status: "done", graded_at: "2026-11-18 09:00", total: 87 });
  await insert("notices", { kind: "temp", text: "<b>بكرة</b> عطلة", aud: "all", created: "x", del: 0 });
  await insert("orders", { user_id: 80, items: "[]", total: 1, created: "2026-11-17 10:00" });
  const c = await nowCards(80, NOW);
  assert.equal(c[0].hot, true);
  assert.equal(c[0].text, "امتحانك مفتوح هسه، ادخل");
  assert.deepEqual(c.slice(3).map((x) => x.kind), ["notice", "grade", "order"]);
  assert.equal(c[3].text, "بكرة عطلة");
  assert.match(c[4].text, /87 من 100/);
});

test("ماكو شي اليوم وباچر: امتحانه الجاي", async () => {
  await put("students", { user_id: 81, name: "زينب", exam: "حضوري", created: "x" });
  await insert("sched_items", { user_id: 81, exam_id: e3, at: "2026-11-25 17:00", status: "waiting" });
  const c = (await nowCards(81, NOW)).filter((x) => x.kind !== "notice");   // الإشعار للكل يطلعله هم
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "next");
  assert.match(c[0].text, /بمركزك/);
});
