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
// كل طالب مختار أوقاته (جدول ويا الطلاب)، حتى قفل «اختار أوقاتك أول» ما يدخل بهاي الفحوصات
const stud = async (id: number, curr = "عربي") => { await put("students", { user_id: id, name: "طالب " + id, curr, exam: "إلكتروني", created }); await put("schedules", { user_id: id, mode: "general", center_id: 0, picks: "{}", created }); };
const order = (u: number, name: string, printed: number) => insert("orders", { user_id: u, items: JSON.stringify([{ name, qty: 1 }]), printed, created: "2026-02-01 10:00:00" });
const guardian = (u: number) => put("guardians", { guardian_id: 1000 + u, student_id: u, created });

await insert("note_books", { title: "ثالث", chapter: "الفصل الثالث", lang: "all", file: "b1", pages: 3, created });
await insert("note_books", { title: "ثالث انكليزي", chapter: "الفصل الثالث", lang: "en", file: "b2", pages: 2, created });
await insert("note_books", { title: "رابع", chapter: "الفصل الرابع", lang: "ar", file: "b3", pages: 2, created });

test("الملازم تطلع للي استلم الفصل، محاضرات أو امتحانات، وحسب منهجه", async () => {
  await stud(10); await stud(11, "إنجليزي"); await stud(12); await stud(13);
  // التوصيل: ينطبع الطلب وما تنفتح، لحد ما الطالب يقرا كود الوصل
  const oid = await order(10, "محاضرات الفصل الثالث", 1);
  await insert("order_codes", { code: "111111", order_id: oid, chapters: "[]" });
  assert.deepEqual(await myBooks(10), []);
  await update("order_codes", { code: "111111" }, { used_at: created });
  assert.deepEqual((await myBooks(10)).map((b) => b.title), ["ثالث"]);
  await put("exam_access", { user_id: 11, chapter: "الفصل الثالث", created });
  assert.deepEqual((await myBooks(11)).map((b) => b.title), ["ثالث", "ثالث انكليزي"]);
  // الملغي واللي بعده ما انطبع والدفتر ما يفتحون
  await order(12, "محاضرات الفصل الثالث", 2);
  await order(12, "امتحانات الفصل الثالث", 0);
  await order(12, "دفتر محاضرات الفصل الثالث", 1);
  assert.deepEqual(await myBooks(12), []);
  // الفصلين اللي ينباعون سوية يفتحون الثنين
  await order(13, "امتحانات الفصل الرابع والخامس", 3);   // المكتبة: تنفتح فوراً
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
  await stud(14); await order(14, "محاضرات الفصل الثالث", 3);
  await assert.rejects(act(14, "list"), /ولي أمرك/);
  const exam = await insert("bank_exams", { slug: "ch3", chapter: "الفصل الثالث", ord: 1, title: "ا", minutes: 60 });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const { stamp } = await import("../lib/util.ts");
  const item = await insert("sched_items", { user_id: 10, exam_id: exam, at: stamp() || now, status: "started", started_at: stamp(), opened_at: stamp() });
  await assert.rejects(act(10, "list"), /امتحان مفتوح/);
  await assert.rejects(notePage(homeToken(10), 1, 1, "android", dev(10)), /امتحان مفتوح/);
  await update("sched_items", { id: item }, { status: "done" });
  assert.equal((await act(10, "list")).books.length, 1);
});

test("صورة الصفحة: تطلع من صورة جاهزة وعليها علامة الطالب، مو نفس الأصل", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(700, 990); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 700, 990);
  const clean = Buffer.from(await c.encode("jpeg", 90));
  await files().write("notes/b1/p1.jpg", clean, "image/jpeg");
  const [b] = await myBooks(10);
  await assert.rejects(notePage(homeToken(10), b.id, 1, "android", "dev-another-device-000"), (e: any) => e.status === 423);
  const out = await notePage(homeToken(10), b.id, 1, "android", dev(10));
  assert.equal(out[0], 0xff);
  assert.notDeepEqual(out, clean);
});

test("طلب محاضرات بالتوصيل: ينطيه كود، والكود يفتح الملازم بس بعد ما ينطبع الطلب", async () => {
  const sent: string[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body); sent.push(String(p.text ?? p.caption ?? "")); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }) as typeof fetch;
  const { createOrderCode, redeemCode, readyExtras } = await import("../lib/exams.ts");
  await stud(15); await guardian(15);
  const items = [{ name: "محاضرات الفصل الثالث", qty: 1 }];
  const oid = await order(15, items[0].name, 0);
  const code = (await createOrderCode(oid, items))!;
  assert.match(code, /^\d{6}$/);
  assert.equal(await createOrderCode(oid + 1000, [{ name: "ملزمة الفصل الثالث", qty: 1 }]), null);
  await redeemCode(15, 15, code);
  assert.deepEqual(await myBooks(15), []);          // بعده ما انطبع
  await update("orders", { id: oid }, { printed: 1 });
  assert.match((await readyExtras(oid)).text, /ملازمك/);
  assert.deepEqual(await myBooks(15), []);          // انطبع بس بعده ما وصل
  await redeemCode(15, 15, code);
  assert.ok(sent.some((t) => t.includes("انفتحت ملازمك")));
  assert.deepEqual((await myBooks(15)).map((b) => b.title), ["ثالث"]);
  assert.equal(await one("exam_access", { user_id: 15 }), null);   // ما يفتح امتحانات
});

test("رابط لوحة التحكم يشتغل أسبوع بس، ورابط الطالب يبقى", async () => {
  const { verifyInitData, verifyHomeToken } = await import("../lib/webAuth.ts");
  const now = Date.now() / 1000, t = homeToken(1, now);
  assert.equal(verifyInitData(`tk:${t}`, now + 6 * 86400), 1);
  assert.equal(verifyInitData(`tk:${t}`, now + 8 * 86400), null);
  assert.equal(verifyHomeToken(t, now + 8 * 86400), 1);
});

test("📝 الراصد: صفحته عليها اسم الطالب بالهدر، وزر «الحل النموذجي» يجيب حل نفس الصفحة، والملزمة العادية ما بيها حل", async () => {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const page = async (color: string) => { const c = createCanvas(700, 990); const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 700, 990); return Buffer.from(await c.encode("jpeg", 90)); };
  await insert("note_books", { title: "الراصد (رصد جميع الأسئلة الوزارية للفصل الثالث)", chapter: "الفصل الثالث", lang: "all", file: "r1", pages: 2, kind: "rasid", created: "2026-11-14 10:00" });
  const r = (await myBooks(10)).find((b) => b.kind === "rasid")!;
  assert.equal((await act(10, "list")).books.find((b: any) => b.id === r.id).kind, "rasid");
  await files().write("notes/r1/p1.jpg", await page("#26282c"), "image/jpeg");
  await files().write("notes/r1/s1.jpg", await page("#ffffff"), "image/jpeg");
  const mine = await loadImage(await notePage(homeToken(10), r.id, 1, "android", dev(10)));
  const sol = await loadImage(await notePage(homeToken(10), r.id, 1, "android", dev(10), true));
  const px = async (im: any) => { const c = createCanvas(im.width, im.height); const g = c.getContext("2d"); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
  const a = await px(mine), b = await px(sol);
  // الصفحة غامقة بس الاسم أبيض بزاوية الهدر، والحل صفحة بيضة
  let white = 0; for (let y = 4; y < 45; y++) for (let x = 25; x < 250; x++) if (a[(y * 700 + x) * 4] > 200) white++;
  assert.ok(white > 50, "اسم الطالب مكتوب بالهدر");
  assert.ok(b[(500 * 700 + 350) * 4] > 200, "الحل النموذجي من ملف الحلول");
  const [book] = (await myBooks(10)).filter((x) => x.kind !== "rasid");
  await assert.rejects(notePage(homeToken(10), book.id, 1, "android", dev(10), true), (e: any) => e.status === 404);
});

test("📚 ملازمي: أقسام الفصل الأربعة بترتيبها، والقديمة بلا قسم تطلع بعدها", async () => {
  const { SECTIONS, sectionOf } = await import("../lib/notes.ts");
  assert.deepEqual(SECTIONS.map((s) => s.title), ["دفتر المحاضرات (أسئلة وأمثلة الكتاب)", "دفتر المحاضرات (الأسئلة الوزارية)", "دفتر المحاضرات (الأسئلة الإثرائية)", "الدفتر الامتحاني (الراصد)"]);
  assert.equal(sectionOf({ kind: "rasid" }), "rasid");
  assert.equal(sectionOf({ kind: "book", section: "wz" }), "wz");
  assert.equal(sectionOf({ kind: "book", section: null }), "");
  await insert("note_books", { title: "ر", chapter: "الفصل الخامس", lang: "ar", file: "s4", pages: 1, kind: "rasid", created });
  await insert("note_books", { title: "إ", chapter: "الفصل الخامس", lang: "ar", file: "s3", pages: 1, kind: "book", section: "ith", created });
  await insert("note_books", { title: "ك", chapter: "الفصل الخامس", lang: "ar", file: "s1", pages: 1, kind: "book", section: "book", created });
  await insert("note_books", { title: "قديمة", chapter: "الفصل الخامس", lang: "ar", file: "s0", pages: 1, kind: "book", created });
  await insert("note_books", { title: "و", chapter: "الفصل الخامس", lang: "ar", file: "s2", pages: 1, kind: "book", section: "wz", created });
  const fifth = (await myBooks(1)).filter((b) => b.chapter === "الفصل الخامس").map((b) => b.title);
  assert.deepEqual(fifth, ["ك", "و", "إ", "ر", "قديمة"]);
});

test("📚 نسخة جديدة صفحاتها تحركت: السطور تنلگى، والصفحات تمشي، وكتابة الطلاب ويا صفحتها وما تنمسح", async () => {
  const { alignLines, pageMap } = await import("../lib/noteMarks.ts");
  const { moveInk } = await import("../lib/notes.ts");
  const L = (page: number, ...t: string[]) => t.map((text, i) => ({ page, y: 0.1 + i * 0.1, text }));
  // القديمة: 3 صفحات. الجديدة: صفحة جديدة انضافت بعد الأولى، و«مثال :» يتكرر
  const oldL = [...L(1, "المحاضرة 1", "س1 / جد المشتقة", "مثال :"), ...L(2, "س2 / ارسم الدالة", "مثال :"), ...L(3, "س3 / اثبت ان", "مثال :")];
  const newL = [...L(1, "المحاضرة 1", "س1 / جد المشتقة", "مثال :"), ...L(2, "ملاحظة جديدة"), ...L(3, "س2 / ارسم الدالة", "مثال :"), ...L(4, "س3 / اثبت ان", "مثال :")];
  const idx = alignLines(oldL, newL);
  assert.deepEqual(idx.map((j) => (j < 0 ? -1 : newL[j].page)), [1, 1, 1, 3, 3, 4, 4]);
  const map = pageMap(oldL, newL, 3, 4, idx);
  assert.deepEqual([...map], [[1, 1], [2, 3], [3, 4]]);
  // كتابة طالب بصفحة 2 و3 تروح لـ 3 و4. الصفحة اللي وصلها تمشي هم
  const id = await insert("note_books", { title: "نقل", chapter: "الفصل السادس", lang: "ar", file: "mv", pages: 3, created });
  await put("note_ink", { user_id: 50, book_id: id, page: 2, ink: JSON.stringify({ items: [{ c: "#000", w: 2, p: [0.1, 0.1] }], notes: [] }) });
  await put("note_ink", { user_id: 50, book_id: id, page: 3, ink: JSON.stringify({ items: [{ c: "#f00", w: 2, p: [0.2, 0.2] }], notes: [] }) });
  await put("note_bookmarks", { user_id: 50, book_id: id, page: 3, at: created });
  await moveInk(id, map, 4);
  const { find } = await import("../lib/db.ts");
  assert.deepEqual((await find("note_ink", { book_id: id })).map((r) => [r.page, JSON.parse(r.ink).items[0].c]).sort(), [[3, "#000"], [4, "#f00"]]);
  assert.equal((await one("note_bookmarks", { user_id: 50, book_id: id }))?.page, 4);
  // صفحتين صاروا وحدة: الكتابتين سوية
  await moveInk(id, new Map([[1, 1], [2, 2], [3, 3], [4, 3]]), 3);
  const one3 = (await find("note_ink", { book_id: id })).find((r) => r.page === 3);
  assert.equal(JSON.parse(one3!.ink).items.length, 2);
});

test("📍 وصل لمحاضرة بالكتاب: الوزارية من نفس الفصل تنفتح على نفس المحاضرة، وإذا علامته بيها أحدث ما تتغير", async () => {
  const { spotFor } = await import("../lib/notes.ts");
  const ch = "الفصل التاسع";
  const bk = await insert("note_books", { title: "كتاب", chapter: ch, lang: "ar", file: "sp1", pages: 40, kind: "book", section: "book", created });
  const wz = await insert("note_books", { title: "وزاري", chapter: ch, lang: "ar", file: "sp2", pages: 30, kind: "book", section: "wz", sol: 1, created });
  const toc = (f: string, t: unknown) => files().write(`notes/${f}.toc2.json`, Buffer.from(JSON.stringify(t)), "application/json");
  await toc("sp1", [{ t: "Square roots", p: 1, items: [{ t: "Lecture 1", p: 1 }, { t: "Lecture 2", p: 10 }] }, { t: "x,y", p: 20, items: [{ t: "Lecture 1", p: 20 }] }]);
  await toc("sp2", [{ t: "Square roots · Lecture 1", p: 1 }, { t: "Square roots · Lecture 2", p: 5 }, { t: "x,y · Lecture 1", p: 12 }]);
  const b = (id: number) => one("note_books", { id });
  // صاحب البوت يشوف كل الملازم: نجربه بيه (رقم 1)
  await put("note_bookmarks", { user_id: 1, book_id: bk, page: 12, at: "2026-03-01T10:00:00.000Z" });
  assert.deepEqual(await spotFor(1, (await b(wz))!), { page: 5, where: "Square roots · المحاضرة 2", from: "كتاب" });
  // علامته بالوزارية بنفس المحاضرة (صفحة 7) وأقدم: يرجع لصفحته هو
  await put("note_bookmarks", { user_id: 1, book_id: wz, page: 7, at: "2026-02-01T10:00:00.000Z" });
  assert.equal((await spotFor(1, (await b(wz))!)).page, 7);
  // بالوزارية وصل لـ x,y بعدها: الكتاب ينفتح على x,y، والوزارية تبقى على علامتها
  await put("note_bookmarks", { user_id: 1, book_id: wz, page: 13, at: "2026-03-02T10:00:00.000Z" });
  assert.deepEqual(await spotFor(1, (await b(wz))!), {});
  assert.equal((await spotFor(1, (await b(bk))!)).page, 20);
});
