// ملازم الطلاب: تطلع بس للي استلم الفصل، الكتابة تنحفظ لكل طالب وحده، وتنقفل وقت الامتحان
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-notes-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { insert, one, put, update } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { myBooks, noteAction, ownedChapters, notePage } = await import("../lib/notes.ts");
const { files } = await import("../lib/files.ts");
await ensure();

const created = "2026-01-01 10:00:00";
const dev = (u: number) => "dev-" + String(u).padStart(14, "0");
const act = (u: number, action: string, x: object = {}) => noteAction({ token: homeToken(u), device: dev(u), pf: "android", action, ...x });
const stud = (id: number, curr = "عربي") => put("students", { user_id: id, name: "طالب " + id, curr, exam: "إلكتروني", created });
const order = (u: number, name: string, printed: number) => insert("orders", { user_id: u, items: JSON.stringify([{ name, qty: 1 }]), printed, created: "2026-02-01 10:00:00" });
const guardian = (u: number) => put("guardians", { guardian_id: 1000 + u, student_id: u, created });

await insert("note_books", { title: "ثالث", chapter: "الفصل الثالث", lang: "all", file: "b1", pages: 3, created });
await insert("note_books", { title: "ثالث انكليزي", chapter: "الفصل الثالث", lang: "en", file: "b2", pages: 2, created });
await insert("note_books", { title: "رابع", chapter: "الفصل الرابع", lang: "ar", file: "b3", pages: 2, created });

test("الملازم تطلع للي استلم الفصل، محاضرات أو امتحانات، وحسب منهجه", async () => {
  await stud(10); await stud(11, "إنجليزي"); await stud(12); await stud(13);
  await order(10, "محاضرات الفصل الثالث", 1);
  assert.deepEqual((await myBooks(10)).map((b) => b.title), ["ثالث"]);
  await put("exam_access", { user_id: 11, chapter: "الفصل الثالث", created });
  assert.deepEqual((await myBooks(11)).map((b) => b.title), ["ثالث", "ثالث انكليزي"]);
  // الملغي واللي بعده ما انطبع والدفتر ما يفتحون
  await order(12, "محاضرات الفصل الثالث", 2);
  await order(12, "امتحانات الفصل الثالث", 0);
  await order(12, "دفتر محاضرات الفصل الثالث", 1);
  assert.deepEqual(await myBooks(12), []);
  // الفصلين اللي ينباعون سوية يفتحون الثنين
  await order(13, "امتحانات الفصل الرابع والخامس", 3);
  assert.ok((await ownedChapters(13)).includes("الفصل الرابع"));
  assert.ok((await ownedChapters(13)).includes("الفصل الخامس"));
});

test("الكتابة تنحفظ لكل طالب وحده، وملزمة غير فصله مرفوضة", async () => {
  await guardian(10); await guardian(11);
  const [b] = await myBooks(10);
  const ink = JSON.stringify({ items: [{ c: "#111111", w: 2, p: [0.1, 0.2, 0.3, 0.4] }] });
  await act(10, "save", { book: b.id, page: 2, ink });
  assert.equal((await act(10, "ink", { book: b.id, page: 2 })).ink, ink);
  assert.equal((await act(11, "ink", { book: b.id, page: 2 })).ink, "");
  await act(10, "save", { book: b.id, page: 2, ink: JSON.stringify({ items: [] }) });
  assert.equal(await one("note_ink", { user_id: 10, book_id: b.id, page: 2 }), null);
  await assert.rejects(act(10, "ink", { book: b.id, page: 9 }), /الصفحة/);
  await assert.rejects(act(10, "save", { book: b.id, page: 1, ink: "خربانة" }), /ما انحفظت/);
  const other = (await myBooks(1)).find((x) => x.title === "رابع")!;
  await assert.rejects(act(10, "ink", { book: other.id, page: 1 }), /مو ضمن فصولك/);
});

test("بدون تلگرام الموبايل، أو بدون ولي أمر، أو أثناء الامتحان: مقفولة", async () => {
  await assert.rejects(noteAction({ token: homeToken(10), device: dev(10), pf: "tdesktop", action: "list" }), /الموبايل/);
  await stud(14); await order(14, "محاضرات الفصل الثالث", 1);
  await assert.rejects(act(14, "list"), /ولي أمرك/);
  const exam = await insert("bank_exams", { slug: "ch3", chapter: "الفصل الثالث", ord: 1, title: "ا", minutes: 60 });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const { stamp } = await import("../lib/util.ts");
  const item = await insert("sched_items", { user_id: 10, exam_id: exam, at: stamp() || now, status: "started", started_at: stamp(), opened_at: stamp() });
  await assert.rejects(act(10, "list"), /امتحان مفتوح/);
  await assert.rejects(notePage(homeToken(10), 1, 1, "android"), /امتحان مفتوح/);
  await update("sched_items", { id: item }, { status: "done" });
  assert.equal((await act(10, "list")).books.length, 1);
});

test("صورة الصفحة: تطلع من صورة جاهزة وعليها علامة الطالب، مو نفس الأصل", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(700, 990); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 700, 990);
  const clean = Buffer.from(await c.encode("jpeg", 90));
  await files().write("notes/b1/p1.jpg", clean, "image/jpeg");
  const [b] = await myBooks(10);
  const out = await notePage(homeToken(10), b.id, 1, "android");
  assert.equal(out[0], 0xff);
  assert.notDeepEqual(out, clean);
});
