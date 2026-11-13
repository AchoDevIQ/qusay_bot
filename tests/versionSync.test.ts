// صفحات نسخة الطالب أو الجواب النموذجي يتبدلون من صفحة الامتحانات: ملف الطباعة وصور الأسئلة وصور الحل وخطوات التصحيح تتبعهم
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-sync-"));
const TOKEN = "123:secret-token";
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: path.join(tmp, "content"),
  CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"), GRADING_AI_URL: "https://ai.test/", GRADING_AI_KEY: "k",
});
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.AI_RUBRIC_CHECK;
let rubricCalls = 0;
globalThis.fetch = (async (url: string) => {
  if (String(url).endsWith("/bot/rubric")) { rubricCalls++; return new Response(JSON.stringify({ steps: [{ text: "خطوة من الجواب الجديد", points: 50 }], usage: [] })); }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { createCanvas } = await import("@napi-rs/canvas");
const { cropQuestions, imagesPdf } = await import("../lib/versionSync.ts");
const { examAction, examUpload } = await import("../lib/examApi.ts");
const { initDb, kvGet, kvSet } = await import("../lib/db.ts");
const { get, run } = await import("../lib/sqliteDriver.ts");
const { draftQueueTick, rubricOf } = await import("../lib/aiGrade.ts");
await initDb();

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }), query_id: "q" });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
};
const form = (o: Record<string, any>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x); return f; };

/** صفحة مثل صفحات الملزمة: شريط هدر غامق، وكل سؤال يبدي برقم ذهبي يم اليمين، والسؤال الثاني بسطرين */
async function page(labels: number[], extraTitle = false) {
  const c = createCanvas(1320, 1860);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1320, 1860);
  g.fillStyle = "#1e2533"; g.fillRect(40, 30, 1240, 200);
  if (extraTitle) { g.fillStyle = "#d35400"; g.fillRect(1100, 260, 80, 40); }
  for (const [i, y] of labels.entries()) {
    g.fillStyle = "#b89b5e"; g.fillRect(1100, y, 80, 40);
    g.fillStyle = "#222"; g.fillRect(200, y, 850, 40);
    if (i === 1) g.fillRect(200, y + 60, 700, 40);
  }
  return Buffer.from(await c.encode("png"));
}

test("📄 الصور تصير PDF: كل صورة بصفحة A4، والجدول الداخلي مال الملف سليم", async () => {
  const pdf = (await imagesPdf([await page([400]), await page([400, 700])]))!;
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Count 2/);
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  const offs = text.slice(xref).split("\n").slice(3).filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  assert.equal(offs.length, 8);
  for (const [k, o] of offs.entries()) assert.ok(text.startsWith(`${k + 1} 0 obj`, o), `object ${k + 1}`);
  assert.equal(await imagesPdf([Buffer.from("not an image")]), null);
});

test("✂️ قص الأسئلة: يلگى كل سؤال من رقمه الملوّن، والسؤال اللي بسطرين ينقص كامل", async () => {
  const crops = (await cropQuestions(await page([400, 650, 950]), 3))!;
  assert.equal(crops.length, 3);
  const { loadImage } = await import("@napi-rs/canvas");
  const h = await Promise.all(crops.map(async (b) => (await loadImage(b)).height));
  assert.ok(h[1] > h[0] + 40, "السؤال الثاني أطول لأن بيه سطرين");
  // عدد الأسئلة مو نفسه، أو عنوان ملوّن فوك الأسئلة: ما يقص، حتى ما يحط صورة غلط
  assert.equal(await cropQuestions(await page([400, 650, 950]), 4), null);
  assert.equal(await cropQuestions(await page([400, 650, 950], true), 3), null);
});

test("🔁 تبديل الصفحات والجواب من صفحة الامتحانات: ملف الطباعة وصور الأسئلة وصور الحل والخطوات تتبعهم", async () => {
  const init = sign(1);
  const e = (await examAction({ action: "addChapter", chapter: "فصل المزامنة", title: "امتحان المزامنة", initData: init })).chapters.find((c: any) => c.chapter === "فصل المزامنة").exams.at(-1);
  await examAction({ action: "addVersion", id: e.id, initData: init });
  const v = (await get("SELECT id FROM bank_versions WHERE exam_id=?", e.id))!.id as number;
  const blank = await page([]);
  for (let i = 0; i < 3; i++) await examUpload(form({ initData: init, action: "addQuestion", id: v, mark: i ? 25 : 50, q: new Blob([blank], { type: "image/png" }) }));
  const before = await get("SELECT id, q_file FROM bank_questions WHERE version_id=? AND n=1", v);

  const r1 = await examUpload(form({ initData: init, action: "pagesAr", id: v, file: new Blob([await page([400, 650, 950])], { type: "image/png" }) }));
  assert.match(r1.notice, /ملف الطباعة/);
  assert.match(r1.notice, /انقصّت/);
  const ver = await get("SELECT pdf_ar FROM bank_versions WHERE id=?", v);
  assert.match(ver!.pdf_ar, /^uploads\/.*\.pdf$/);
  const after = await get("SELECT q_file, edited FROM bank_questions WHERE id=?", before!.id);
  assert.notEqual(after!.q_file, before!.q_file);
  assert.equal(after!.edited, 1);

  // صفحة ما يعرف يقسمها: ملف الطباعة يتحدث، وصور الأسئلة تبقى ويطلب تبديلها باليد
  const q1 = (await get("SELECT q_file FROM bank_questions WHERE id=?", before!.id))!.q_file;
  const r2 = await examUpload(form({ initData: init, action: "pagesAr", id: v, file: new Blob([await page([400, 650])], { type: "image/png" }) }));
  assert.match(r2.notice, /ما تحدثت/);
  assert.equal((await get("SELECT q_file FROM bank_questions WHERE id=?", before!.id))!.q_file, q1);
  const r3 = await examUpload(form({ initData: init, action: "pagesEn", id: v, file: new Blob([await page([400])], { type: "image/png" }) }));
  assert.match(r3.notice, /عربي/);
  assert.match((await get("SELECT pdf_en FROM bank_versions WHERE id=?", v))!.pdf_en, /\.pdf$/);

  // الجواب يتبدل: صورة الحل القديمة تنشال، والخطوات المحفوظة تنعاد من الجواب الجديد وتبقى القديمة لحد ذاك الوقت
  await run("UPDATE bank_questions SET a_files=? WHERE id=?", JSON.stringify(["ch9/old_a1.png"]), before!.id);
  await kvSet(`ai_rubric_q_${before!.id}`, JSON.stringify({ steps: [{ text: "خطوة قديمة", points: 50 }] }));
  const r4 = await examUpload(form({ initData: init, action: "answerPdf", id: v, file: new Blob(["%PDF-1.7 new"]) }));
  assert.match(r4.notice, /صور الحل القديمة لـ 1 سؤال/);
  assert.match(r4.notice, /خطوات التصحيح AI لـ 1 سؤال/);
  assert.equal((await get("SELECT a_files FROM bank_questions WHERE id=?", before!.id))!.a_files, "[]");
  assert.equal((await rubricOf(before!.id))![0].text, "خطوة قديمة");
  const t = await draftQueueTick(1);
  assert.equal(t.done, 1);
  assert.equal(rubricCalls, 1);
  assert.equal((await rubricOf(before!.id))![0].text, "خطوة من الجواب الجديد");
  assert.match(String(await kvGet(`ai_rubric_prev_q_${before!.id}`)), /خطوة قديمة/);
  assert.deepEqual(JSON.parse(String(await kvGet("ai_draft_queue"))).re, []);
});
