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
  assert.equal(E.FRAMES.length, 34, "21 مزخرفة + 13 القديمة");
  assert.ok(E.BOARDS.length >= 40, "ألوان بطن السبورة هواية");
  assert.equal(E.topOf("d-navy"), 0, "المزخرف بلا ضلع فوك: الفوك للهيدر");
  assert.equal(E.topOf("oak"), E.FRAME);
  assert.deepEqual(E.areaOf("d-navy", 1920), { x: 40, y: 0, w: 1840, h: 1040 });
  assert.equal(E.FRAMES.filter((f) => f.deco).length, 21);
  assert.equal(E.DEFAULT_FRAME, "d-navy", "بلا خشب من البداية");
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
  const l = E.cleanLesson({ w: 1920, board: "red", frame: "x", pages: [{ items: [{ k: "ink", c: "red", w: 5, p: [1, 2, 3, 4] }, { k: "evil" }], bg: "boards/1/bg/a.jpg" }] });
  assert.ok(l);
  assert.equal(l!.board, E.DEFAULT_BOARD);
  assert.equal(E.cleanLesson({ board: "#a1b2c3", pages: [{ items: [] }] })!.board, "#A1B2C3", "أي لون يختاره من «لون ثاني» يبقى");
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
  // يختار الفصل والموضوع والمحاضرة اللي ينزل وياها
  const ch1 = await insert("chapters", { ord: 1, ar: "الأعداد المركبة", active: 1 });
  const tp = await insert("topics", { chapter_id: ch1, ord: 1, ar: "ديموافر", lectures: 3, active: 1 });
  const tg = await boardAction({ t: T, action: "targets" });
  assert.deepEqual(tg.chapters.flatMap((c: any) => c.topics).find((x: any) => x.id === tp), { id: tp, name: "ديموافر", lectures: 3 });
  const r = await boardAction({ t: T, action: "send", id: saved.id, chapter: 1, topic: tp, lecture: 2 });
  assert.match(r.notice, /2 طالب/);
  assert.ok(sent.every((m) => m.text.includes("ديموافر · المحاضرة 2")), "الرسالة بيها الموضوع والمحاضرة");
  const to = sent.map((m) => m.chat);
  assert.ok(to.includes("501") && to.includes("503"));
  assert.ok(!to.includes("502") && !to.includes("504"));
  assert.ok(sent.every((m) => m.kb.includes("/store/board") && m.kb.includes("inbox=")));

  // الطالب: يشوفه بشروحات الأستاذ ويفتحه. اللي ما اشترى محاضرات ما يوصله
  const st = await boardAction({ t: homeToken(501), action: "state" });
  assert.equal(st.teacher, false);
  assert.equal(st.inbox.length, 1);
  assert.deepEqual([st.inbox[0].topic, st.inbox[0].lecture], ["ديموافر", 2]);
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

test("✋ التحريك: دوسة تختار، مربع يختار، والحركة والتكبير نسخة جديدة. الصورة ما تنمسح بالممحاة. والهيدرات 10", () => {
  const a: any = { k: "ink", c: "#FFFFFF", w: 4, p: [100, 100, 300, 100] };
  const t: any = { k: "text", c: "#FFFFFF", s: 40, x: 900, y: 50, t: "مرحبا", bw: 120, bh: 54 };
  const img: any = { k: "img", r: "boards/1/bg/x.jpg", x: 400, y: 400, w: 200, h: 100 };
  const items = [a, t, img];
  assert.equal(E.hitItem(items, 200, 104), a, "دوسة قريبة من الخط");
  assert.equal(E.hitItem(items, 850, 70), t);
  assert.equal(E.hitItem(items, 500, 450), img);
  assert.equal(E.hitItem(items, 700, 700), null);
  assert.deepEqual(E.inRect(items, { x0: 0, y0: 0, x1: 320, y1: 200 }), [a]);
  const m: any = E.moved(a, 10, 20);
  assert.deepEqual(m.p, [110, 120, 310, 120]);
  assert.deepEqual(a.p, [100, 100, 300, 100], "الأصل ما يتغير (للتراجع)");
  const big: any = E.scaled(img, 400, 400, 2);
  assert.deepEqual([big.w, big.h, big.x, big.y], [400, 200, 400, 400]);
  assert.ok(E.eraseAlong(items, [500, 450], [500, 450], 80).items.includes(img), "الممحاة ما تشيل الصورة");
  assert.equal(E.HEADS.filter((h) => h.id !== "none").length, 20);
  assert.equal(E.HEADS.filter((h) => h.id.startsWith("nb-")).length, 10, "هيدرات الدفتر عشرة");
  assert.equal(E.headOf("nb-wine"), "nb-wine");
  assert.equal(E.cleanLesson({ pages: [{ items: [img] }], head: "gold" })!.head, "gold");
  assert.equal(E.cleanLesson({ pages: [{ items: [] }], head: "x" })!.head, "none");
});

test("📎 الشرح ينزل بملحقات محاضرة التطبيق: يختار من محاضرات التطبيق، الملحق أول، والسحب يشيله", async () => {
  const BA = await import("../lib/boardAttach.ts");
  const calls: { q: string; v: any; write: boolean }[] = [];
  let fail = false;
  BA.setDcForTest(async (env, q, v, write) => {
    calls.push({ q, v, write });
    assert.equal(env, "staging");
    if (fail) throw new Error("ماكو إذن");
    if (q.includes("curricula")) return { curricula: [{ chapters_on_curriculum: [
      { orderPosition: 1, arabicTitle: "الاعداد المركبه", isTestChapter: false, subjects_on_chapter: [{ id: "s1", arabicTitle: "ديموافر", lectures_on_subject: [
        { id: "aaaaaaaabbbbccccddddeeeeeeeeeeee", title: "المحاضره 1", track: "arabic", state: "published" },
        { id: "l-en", title: "المحاضره 1", track: "english", state: "draft" }, { id: "x", title: "؟", track: "other", state: "published" }] }] },
      { orderPosition: 6, arabicTitle: "تجريبي 1", isTestChapter: false, subjects_on_chapter: [{ id: "s9", arabicTitle: "تجريبي", lectures_on_subject: [{ id: "t", title: "1", track: "arabic", state: "published" }] }] },
    ] }] };
    if (q.includes("lecture(id")) return { lecture: { id: v.id, title: "المحاضره 1", track: v.id.startsWith("e") ? "english" : "arabic", subject: { arabicTitle: "ديموافر", chapter: { orderPosition: 1 } }, lectureAttachments_on_lecture: [{ id: "1" }, { id: "2" }] } };
    if (q.includes("lectureAttachment_insert")) return { lectureAttachment_insert: { id: v.l.startsWith("e") ? "99992222333344445555666677778888" : "11112222333344445555666677778888" } };
    if (q.includes("lectureAttachment_delete")) return { lectureAttachment_delete: { id: v.id } };
    return {};
  });
  const T = homeToken(1);
  // مطفي: الاختيار من مواضيع البوت مثل قبل
  assert.ok(!(await boardAction({ t: T, action: "targets" })).app);
  await boardAction({ t: T, action: "appmode", env: "staging" });
  assert.equal((await boardAction({ t: T, action: "state" })).appEnv, "staging");
  const tg = await boardAction({ t: T, action: "targets" });
  assert.equal(tg.app, "staging");
  assert.deepEqual(tg.chapters.map((c: any) => c.ch), [1], "الفصول التجريبية ما تطلع");
  assert.deepEqual(tg.chapters[0].topics[0].lectures.map((l: any) => [l.track, l.draft]), [["arabic", false], ["english", true]]);

  const lesson = { ...E.emptyLesson(1920), pages: [{ items: [{ k: "ink", c: "#FFFFFF", w: 5, p: [1, 1, 9, 9] }] }] };
  const saved = await boardAction({ t: T, action: "save", title: "ديموافر الأول", lesson });
  // ماكو إذن: ما يندز شي
  fail = true; sent.length = 0;
  const before = (await boardAction({ t: T, action: "state" })).sent.length;
  await assert.rejects(boardAction({ t: T, action: "send", id: saved.id, appLecture: "aaaaaaaabbbbccccddddeeeeeeeeeeee" }));
  assert.equal((await boardAction({ t: T, action: "state" })).sent.length, before);
  assert.equal(sent.length, 0, "ولا رسالة");
  fail = false;
  const r = await boardAction({ t: T, action: "send", id: saved.id, appLecture: "aaaaaaaabbbbccccddddeeeeeeeeeeee" });
  assert.match(r.notice, /ملحقات «ديموافر · المحاضره 1» بالتطبيق \(التجربة\)/);
  const ins = calls.find((c) => c.q.includes("lectureAttachment_insert"))!;
  assert.ok(ins.write && ins.q.includes('type: "board"'));
  assert.equal(ins.v.l, "aaaaaaaabbbbccccddddeeeeeeeeeeee");
  assert.equal(ins.v.o, 3, "آخر ملحق");
  const row = r.sent[0];
  assert.equal(row.app, "staging");
  assert.ok(String(ins.v.u).endsWith(`/store/board?att=${row.id}`), ins.v.u);
  assert.ok(sent.every((m) => m.text.includes("ديموافر · المحاضره 1")));

  // الطالب يفتحه من الملحق: شاري محاضرات الفصل الأول يگدر، الامتحانات بس لا
  assert.equal((await boardAction({ t: homeToken(501), action: "att", id: row.id })).lesson.pages[0].items.length, 1);
  await assert.rejects(boardAction({ t: homeToken(502), action: "att", id: row.id }), /لطلاب محاضرات الفصل الأول/);
  // السحب: ينشال من التطبيق ومن الشروحات
  await boardAction({ t: T, action: "unsend", id: row.id });
  assert.ok(calls.some((c) => c.q.includes("lectureAttachment_delete") && c.v.id === "11112222333344445555666677778888"));
  await assert.rejects(boardAction({ t: homeToken(501), action: "att", id: row.id }), /انسحب/);
  await assert.rejects(boardAction({ t: homeToken(501), action: "unsend", id: row.id }), /بس الأستاذ/);

  // الاثنين: نفس الشرح بمحاضرة العربي ومحاضرة الانگليزي، والسحب يشيل الثنين
  calls.length = 0;
  const EN = "eeeeeeeebbbbccccddddeeeeeeeeeeee";
  const r2 = await boardAction({ t: T, action: "send", id: saved.id, appLecture: ["aaaaaaaabbbbccccddddeeeeeeeeeeee", EN] });
  assert.deepEqual(calls.filter((c) => c.q.includes("lectureAttachment_insert")).map((c) => c.v.l), ["aaaaaaaabbbbccccddddeeeeeeeeeeee", EN]);
  assert.match(r2.notice, /المحاضره 1 \+ المحاضره 1 \(English\)/);
  await boardAction({ t: T, action: "unsend", id: r2.sent[0].id });
  assert.deepEqual(calls.filter((c) => c.q.includes("lectureAttachment_delete")).map((c) => c.v.id), ["11112222333344445555666677778888", "99992222333344445555666677778888"]);
  // الثانية فشلت: الأولى تنشال وما يندز شي
  calls.length = 0;
  const realDc = calls;
  BA.setDcForTest(async (env, q, v) => {
    realDc.push({ q, v, write: true });
    if (q.includes("lecture(id")) return { lecture: { id: v.id, title: "م", track: "arabic", subject: { arabicTitle: "ديموافر", chapter: { orderPosition: 1 } }, lectureAttachments_on_lecture: [] } };
    if (q.includes("lectureAttachment_insert")) { if (v.l.startsWith("e")) throw new Error("نت"); return { lectureAttachment_insert: { id: "11112222333344445555666677778888" } }; }
    return {};
  });
  const n0 = (await boardAction({ t: T, action: "state" })).sent.length;
  await assert.rejects(boardAction({ t: T, action: "send", id: saved.id, appLecture: ["aaaaaaaabbbbccccddddeeeeeeeeeeee", EN] }));
  assert.ok(realDc.some((c) => c.q.includes("lectureAttachment_delete")), "الأولى انشالت");
  assert.equal((await boardAction({ t: T, action: "state" })).sent.length, n0);
  BA.setDcForTest(null);
});
