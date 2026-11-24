// 📝 السبورة بالتطبيق (طلبه 2026-11-25): الأشكال والمجسمات، المسح اللي يقسم الخط، الكف، وإرسال الشرح بس لطلاب محاضرات الفصل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-board-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const sent: { chat: string; text: string; kb: string }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init?.body ?? "{}");
  if (String(url).endsWith("/sendMessage")) sent.push({ chat: String(p.chat_id), text: String(p.text ?? ""), kb: JSON.stringify(p.reply_markup ?? "") });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const E = await import("../lib/board/engine.ts");
const { boardAction } = await import("../lib/boardApi.ts");
const { lectureChapters } = await import("../lib/access.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
await initDb();

test("📝 الألوان: 98 لون، والأشكال والمجسمات كخطوط والمخفي متقطع", () => {
  assert.equal(E.palette().length, 98);
  assert.equal(E.FRAMES.length, 13);
  assert.equal(E.BOARDS.length, 8);
  const cube = E.buildShape("cube", [0, 0], [200, 200], 5);
  assert.equal(cube.solid.length, 3);
  assert.equal(cube.dashed.length, 2);
  const strokes = E.shapeStrokes("cube", [0, 0], [200, 200], "#FFFFFF", 5);
  assert.ok(strokes.length > 5, "المخفي ينقسم قطع");
  assert.ok(strokes.every((s) => s.fit === 0 && s.k === "ink"));
  assert.deepEqual(E.shapeStrokes("line", [0, 0], [2, 1], "#FFFFFF", 5), [], "دوسة بلا سحب ما ترسم شي");
  for (const k of [...E.SHAPES, ...E.SOLIDS]) assert.ok(E.shapeStrokes(k.id, [10, 10], [300, 260], "#FFFFFF", 5).length, k.t);
  assert.equal(E.hlWidth(3), 18);
  assert.equal(E.hlWidth(10), 50);
});

test("📝 الممحاة تقسم الخط بالنص، والنص ينمسح كله، والكف أكبر من الحد", () => {
  const line: any = { k: "ink", c: "#FFFFFF", w: 4, p: [0, 100, 400, 100] };
  const text: any = { k: "text", c: "#FFFFFF", s: 40, x: 900, y: 50, t: "مرحبا", bw: 120, bh: 54 };
  const r = E.eraseAlong([line, text], [200, 60], [200, 140], 40);
  assert.equal(r.removed.length, 1);
  assert.equal(r.added.length, 2, "الخط صار قطعتين");
  assert.ok(r.items.includes(text), "النص البعيد ما ينلمس");
  const r2 = E.eraseAlong(r.items, [850, 60], [850, 70], 40);
  assert.ok(!r2.items.includes(text), "النص ينمسح كله");
  assert.ok(E.isPalm(630, 730, 200) && !E.isPalm(60, 60, 200));
  assert.ok(E.isLight("#F8F8F4") && !E.isLight("#1F4E3D"));
});

test("📝 درس جاي من برا ينفحص: الغريب ينشال", () => {
  const l = E.cleanLesson({ w: 1920, board: "#123456", frame: "x", pages: [{ items: [{ k: "ink", c: "red", w: 5, p: [1, 2, 3, 4] }, { k: "evil" }], bg: "boards/1/bg/a.jpg" }] });
  assert.ok(l);
  assert.equal(l!.board, E.DEFAULT_BOARD);
  assert.equal(l!.pages[0].items.length, 1);
  assert.equal((l!.pages[0].items[0] as any).c, "#FFFFFF");
  assert.equal(E.cleanLesson({ pages: [] }), null);
});

test("📝 يدز شرحه بس لطلاب محاضرات الفصل، ويسأله قبل (العدد)، والطالب يفتح نسخته", async () => {
  const stamp = "2026-01-01 00:00";
  await put("students", { user_id: 501, name: "علي محاضرات", created: stamp });
  await put("students", { user_id: 502, name: "زينب امتحانات بس", created: stamp });
  await put("students", { user_id: 503, name: "حسن محاضرات وامتحانات", created: stamp });
  await put("students", { user_id: 504, name: "مريم الفصل الثاني", created: stamp });
  const order = (uid: number, name: string) => insert("orders", { user_id: uid, items: JSON.stringify([{ name, qty: 1, price: 1 }]), printed: 1, created: "2026-02-01 10:00" });
  await order(501, "الفصل الأول - محاضرات");
  await order(502, "الفصل الأول - امتحانات إلكترونية");
  await order(503, "الفصل الأول - محاضرات وامتحانات");
  await order(504, "الفصل الثاني - محاضرات");
  assert.deepEqual(await lectureChapters(501), [1]);
  assert.deepEqual(await lectureChapters(502), [], "الامتحانات بس ما تنحسب");

  const T = homeToken(1);
  const lesson = { ...E.emptyLesson(1920), pages: [{ items: [{ k: "ink", c: "#FFFFFF", w: 5, p: [10, 10, 50, 50] }] }] };
  const saved = await boardAction({ t: T, action: "save", title: "القطع المكافئ", lesson });
  assert.ok(saved.id);
  assert.equal((await boardAction({ t: T, action: "count", chapter: 1 })).count, 2);
  const r = await boardAction({ t: T, action: "send", id: saved.id, chapter: 1 });
  assert.match(r.notice, /2 طالب/);
  const to = sent.map((m) => m.chat);
  assert.ok(to.includes("501") && to.includes("503"));
  assert.ok(!to.includes("502") && !to.includes("504"));
  assert.ok(sent.every((m) => m.kb.includes("/store/board") && m.kb.includes("inbox=")));

  // الطالب: يشوفه بشروحات الأستاذ ويفتحه. اللي ما اشترى محاضرات ما يوصله
  const st = await boardAction({ t: homeToken(501), action: "state" });
  assert.equal(st.teacher, false);
  assert.equal(st.inbox.length, 1);
  const got = await boardAction({ t: homeToken(501), action: "inbox", id: st.inbox[0].id });
  assert.equal(got.lesson.pages[0].items.length, 1);
  assert.equal((await boardAction({ t: homeToken(502), action: "state" })).inbox.length, 0);
  await assert.rejects(boardAction({ t: homeToken(502), action: "inbox", id: st.inbox[0].id }), /مو إلك/);
  // الطالب ما يگدر يدز
  await assert.rejects(boardAction({ t: homeToken(501), action: "send", id: saved.id, chapter: 1 }), /بس الأستاذ/);
  // نسخة الطالب تنحفظ إله، وشرح الأستاذ ما يتغير
  const mine = await boardAction({ t: homeToken(501), action: "save", title: "حلي", lesson: got.lesson });
  assert.equal(mine.lessons.length, 1);
  assert.equal((await boardAction({ t: T, action: "get", id: saved.id })).lesson.pages[0].items.length, 1);
});
