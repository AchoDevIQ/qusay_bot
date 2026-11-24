// «تصحيح قصي» (طلب الأستاذ 2026-11-21): مصحح ثاني رخيص بصفحته، بعيد عن نظام التصحيح AI مال مؤمل.
// الذكاء هنا وهمي: نفحص شنو ينبعث إله، وشنو يسوي البوت بجوابه. ولا فلس ينصرف
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-qusay-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.GRADING_AI_URL;
delete process.env.ANTHROPIC_API_KEY;
fs.mkdirSync(path.join(tmp, "ans"), { recursive: true });
fs.writeFileSync(path.join(tmp, "ans", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
const tg: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  // الصور (FormData): الكتابة والأزرار تنقرا هم
  const p = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].filter(([, v]: any) => typeof v === "string").map(([k, v]: any) => [k, k === "reply_markup" ? JSON.parse(v) : v])) : JSON.parse(init?.body ?? "{}");
  tg.push({ method: String(url).split("/").pop()!, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const Q = await import("../lib/qusayGrade.ts");
const { qusayAction } = await import("../lib/qusayGradeApi.ts");
const { finishByAi, gradeAction } = await import("../lib/gradeApi.ts");
const { QUSAY_GRADER, staffName } = await import("../lib/data.ts");
const { initDb, insert, one, find, put, kvSet } = await import("../lib/db.ts");
const { stamp } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};

// الذكاء الوهمي: يرجع الجواب اللي نحدده، ويحفظ الطلبات
const sent: any[] = [];
let reply: (req: any) => any = () => ({ questions: [] });
const msg = (j: any, usage = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, output_tokens: 800 }) =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(j) }], usage }) as any;
const batches = new Map<string, { reqs: any[]; ended: boolean }>();
Q.setQgApi({
  create: async (req) => { sent.push(req); return msg(reply(req)); },
  batchCreate: async (reqs) => { const id = `b${batches.size + 1}`; batches.set(id, { reqs, ended: false }); return id; },
  batchGet: async (id) => {
    const b = batches.get(id)!;
    return { ended: b.ended, results: b.ended ? b.reqs.map((r) => ({ id: r.custom_id, msg: msg(reply(r.params)) })) : [] };
  },
});

const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 60, pos: 1 });
const ex2 = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 2, title: "الجذور", minutes: 60, pos: 2 });
const ver = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
const ver2 = await insert("bank_versions", { exam_id: ex2, model: "A", kind: "mandatory", ok: 1 });
const q1 = await insert("bank_questions", { version_id: ver, n: 1, max_mark: 60, q_text: "حل المعادلة", a_files: "[]" });
const q2 = await insert("bank_questions", { version_id: ver, n: 2, max_mark: 40, q_text: "برهن", a_files: "[]" });
await insert("bank_questions", { version_id: ver2, n: 1, max_mark: 100, q_text: "س", a_files: "[]" });
// خطوات الأستاذ (نفس المحفوظة لنظام التصحيح AI، ينقراها بس)
await kvSet(`ai_rubric_q_${q1}`, JSON.stringify({ steps: [{ text: "التعويض", points: 20 }, { text: "التبسيط", points: 40 }], alts: [] }));
await kvSet(`ai_rubric_q_${q2}`, JSON.stringify({ steps: [{ text: "البرهان", points: 40 }], alts: [] }));
await put("students", { user_id: 90, name: "طالب أول", exam: "إلكتروني", created: "2026-01-01 00:00" });
await put("staff", { user_id: 41, name: "مصحح", perms: "grade" });
const paper = async (qs: number[], x: object = {}, exam = ex, v = ver) => {
  const id = await insert("sched_items", { user_id: 90, exam_id: exam, at: "2026-11-20 10:00", status: "done", version_id: v, started_at: stamp(), submitted_at: stamp(), ...x });
  for (const q of qs) await insert("exam_answers", { item_id: id, q, file: "ans/a.jpg", created: stamp() });
  return id;
};
const good = { questions: [
  { n: 1, answered: true, method: 1, steps: [{ i: 1, awarded: 20, note: "صح" }, { i: 2, awarded: 99, note: "زايد" }], score: 999, sure: true, reason: "زين" },
  { n: 2, answered: true, method: 1, steps: [{ i: 1, awarded: 25.3, note: "نص" }], score: 25, sure: true, reason: "ناقص" },
] };

test("طافي من البداية وما يصرف شي، وبالأصل بالدفعة والزايد عن الحد لباچر", async () => {
  const d0 = await Q.qgSettings();
  assert.deepEqual([d0.batch, d0.carry], [true, true]);
  // إعدادات قديمة محفوظة «هسه» قبل هذا التغيير: تصير بالدفعة
  await kvSet("qg_settings", JSON.stringify({ live: [], effort: "medium", batch: false, cap: 2 }));
  assert.equal((await Q.qgSettings()).batch, true);
  // الفحوصات الجاية «هسه» إلا اللي تجرب الدفعة
  await Q.saveQgSettings({ batch: false });
  assert.equal((await Q.qgSettings()).batch, false);
  assert.deepEqual(await Q.qusayTick(finishByAi), { off: true });
  assert.equal(sent.length, 0);
  assert.equal(await staffName(QUSAY_GRADER), "🧠 تصحيح قصي");
});

test("التجربة بالسر: يصحح ورقة صححها مصحح، ودرجتها وطالبها ما يتغيرون", async () => {
  const id = await paper([1, 2], { grader_id: 41, graded_at: "2026-11-20 12:00", total: 70 });
  await put("question_marks", { item_id: id, q: 1, mark: 40 });
  await Q.setQgOn(true);
  reply = () => good;
  const r: any = await qusayAction({ initData: sign(1), action: "trial", exam: ex, n: 5 });
  assert.match(r.notice, /1 ورقة/);
  tg.length = 0;
  await Q.qusayTick(finishByAi);
  const res = await Q.qgResultOf(id);
  assert.equal(res!.kind, "trial");
  // الخطوة ما تعدي درجتها، والدرجة من الخطوات مو من رقم الذكاء، وتتقرب لدرجة صحيحة (بدون نص)
  assert.deepEqual(res!.qs.map((q) => q.score), [60, 25]);
  assert.equal(res!.total, 85);
  assert.equal(res!.human, 70);
  const it = await one("sched_items", { id });
  assert.deepEqual([it!.total, it!.grader_id], [70, 41]);
  assert.equal((await one("question_marks", { item_id: id, q: 1 }))!.mark, 40);
  assert.equal(tg.filter((m) => m.method.startsWith("send")).length, 0, "ما يوصل شي للطالب");
  // الطلب: مادة النموذج أول وعليها الكاش، وبعدها الصور، وموديل Haiku
  const req = sent.at(-1);
  assert.equal(req.model, "claude-haiku-5-5");
  const content = req.messages[0].content;
  const cacheAt = content.findIndex((b: any) => b.cache_control);
  const firstImg = content.findIndex((b: any) => b.type === "image");
  assert.ok(cacheAt >= 0 && cacheAt < firstImg, "الكاش على الخطوات قبل صور الطالب");
  assert.match(content.slice(0, cacheAt + 1).map((b: any) => b.text ?? "").join("\n"), /\[20 points\] التعويض/);
  const page: any = await qusayAction({ initData: sign(1), action: "list" });
  const e = page.chapters[0].exams.find((x: any) => x.id === ex);
  assert.deepEqual([e.trials, e.gap, e.close], [1, 15, 0]);
  assert.equal(page.trials[0].human, 70);
  const d: any = await qusayAction({ initData: sign(1), action: "paper", id });
  assert.equal(d.paper.qs[0].human, 40);
});

test("🆕 التجربة على ورقة جديدة ما مصححة: تبقى عند المصححين، ودرجة المصحح تطلع جنبها من يصححها", async () => {
  const id = await paper([1, 2]);
  reply = () => good;
  let page: any = await qusayAction({ initData: sign(1), action: "list" });
  assert.equal(page.chapters[0].exams.find((x: any) => x.id === ex).fresh, 1);
  const r: any = await qusayAction({ initData: sign(1), action: "trial", exam: ex, n: 3, fresh: true });
  assert.match(r.notice, /1 ورقة جديدة/);
  tg.length = 0;
  await Q.qusayTick(finishByAi);
  const res = await Q.qgResultOf(id);
  assert.equal(res!.kind, "trial");
  assert.equal(res!.total, 85);
  const it = await one("sched_items", { id });
  assert.deepEqual([it!.graded_at ?? null, it!.grader_id ?? null], [null, null], "ما انحجزت ولا انصححت");
  assert.equal(tg.filter((m) => m.method.startsWith("send")).length, 0, "ما يوصل شي للطالب");
  assert.equal((await Q.qusayHeld([it!])).has(id), false, "ما يحجبها عن المصححين");
  page = await qusayAction({ initData: sign(1), action: "list" });
  assert.equal(page.trials.find((t: any) => t.id === id).human, null);
  assert.equal(page.chapters[0].exams.find((x: any) => x.id === ex).waiting, 1);
  // المصحح صححها: درجته تطلع جنبها وحدها
  await put("sched_items", { ...it, grader_id: 41, graded_at: stamp(), total: 80 });
  await put("question_marks", { item_id: id, q: 1, mark: 50 });
  page = await qusayAction({ initData: sign(1), action: "list" });
  assert.equal(page.trials.find((t: any) => t.id === id).human, 80);
  const d: any = await qusayAction({ initData: sign(1), action: "paper", id });
  assert.equal(d.paper.human, 80);
  assert.equal(d.paper.qs[0].human, 50);
});

test("يصحح صدگ: يحجز الورقة ويحفظ الدرجة ويوصلها للطالب باسمه", async () => {
  await qusayAction({ initData: sign(1), action: "live", exam: ex, on: true });
  const id = await paper([1]);   // السؤال 2 ما جاوبه: صفر بدون ما يسأل عنه
  reply = () => ({ questions: [{ n: 1, answered: true, method: 1, steps: [{ i: 1, awarded: 20, note: "" }, { i: 2, awarded: 10, note: "" }], score: 30, sure: true, reason: "" }] });
  // قبل الدكة: ما تطلع للمصححين
  assert.equal((((await gradeAction({ initData: sign(41), action: "list" })) as any).waiting ?? []).length, 0);
  tg.length = 0;
  const r: any = await Q.qusayTick(finishByAi);
  assert.equal(r.graded, 1);
  const it = await one("sched_items", { id });
  assert.equal(it!.grader_id, QUSAY_GRADER);
  assert.equal(it!.total, 30);
  assert.ok(it!.graded_at);
  assert.deepEqual((await find("question_marks", { item_id: id })).map((m) => [m.q, m.mark]).sort(), [[1, 30], [2, 0]]);
  assert.ok(tg.some((m) => m.method === "sendPhoto" || m.method === "sendMessage"), "الدرجة وصلت للطالب");
  assert.doesNotMatch(sent.at(-1).messages[0].content.map((b: any) => b.text ?? "").join(" "), /answer to question 2:/);
  assert.equal((await Q.qgResultOf(id))!.sent, true);
});

test("ما متأكد، بالأصل: يصححها ويبعث درجتها، والسبب بالسجل", async () => {
  assert.equal((await Q.qgSettings()).unsure, "send");
  const id = await paper([1, 2]);
  reply = () => ({ questions: [{ ...good.questions[0], sure: false, reason: "الخط ما ينقرا" }, good.questions[1]] });
  await Q.qusayTick(finishByAi);
  const it = await one("sched_items", { id });
  assert.ok(it!.graded_at, "انصححت");
  assert.equal(it!.total, 85);
  const row = (await Q.qgLog()).filter((l) => l.item === id).at(-1)!;
  assert.equal(row.kind, "sent");
  assert.match(row.note!, /ما متأكد.*الخط ما ينقرا/);
});

test("إذا اختار «ترجع للمصححين»: الورقة اللي يشك بيها ترجع وما ياخذها مرة ثانية، و«✅ ابعث درجته» يبعثها بدون صرف", async () => {
  await Q.saveQgSettings({ unsure: "graders" });
  const id = await paper([1, 2]);
  reply = () => ({ questions: [{ ...good.questions[0], sure: false, reason: "الخط ما ينقرا" }, good.questions[1]] });
  await Q.qusayTick(finishByAi);
  const it = await one("sched_items", { id });
  assert.equal(it!.grader_id, null);
  assert.equal(it!.graded_at, null);
  assert.equal((await find("question_marks", { item_id: id })).length, 0);
  assert.equal((await Q.qusayHeld([it!])).size, 0, "تطلع للمصححين");
  const n = sent.length;
  await Q.qusayTick(finishByAi);
  assert.equal(sent.length, n, "ما يعيدها");
  const log = await Q.qgLog();
  assert.match(log.at(-1)?.note ?? log.find((l) => l.kind === "unsure")!.note!, /الخط ما ينقرا/);
  // «✅ ابعث درجته»: يطلع زره بالسجل، ويبعث الدرجة المحفوظة بدون طلب جديد
  const page: any = await qusayAction({ initData: sign(1), action: "list" });
  assert.equal(page.log.find((r: any) => r.item === id && r.kind === "unsure").canSend, true);
  const n2 = sent.length;
  await qusayAction({ initData: sign(1), action: "sendSaved", id });
  assert.equal(sent.length, n2, "ما صرف مرة ثانية");
  const done = await one("sched_items", { id });
  assert.deepEqual([done!.grader_id, done!.total], [QUSAY_GRADER, 85]);
  await assert.rejects(qusayAction({ initData: sign(1), action: "sendSaved", id }));
  // 🔁 يعيدها على ورقة ثانية رجعت
  const id2 = await paper([1, 2]);
  reply = () => ({ questions: [{ ...good.questions[0], sure: false, reason: "مقطوعة" }, good.questions[1]] });
  await Q.qusayTick(finishByAi);
  const it2 = (await one("sched_items", { id: id2 }))!;
  await qusayAction({ initData: sign(1), action: "retry", id: id2 });
  assert.equal((await Q.qusayHeld([it2])).size, 1, "🔁 يعيد يجربها");
  reply = () => good;
  await Q.qusayTick(finishByAi);
  assert.equal((await one("sched_items", { id: id2 }))!.grader_id, QUSAY_GRADER);
  await Q.saveQgSettings({ unsure: "send" });
});

test("ورقة طالب التجربة ما ترجع للمصححين حتى لو مختار «ترجع»", async () => {
  const { addTestPaper } = await import("../lib/gradeApi.ts");
  await put("students", { user_id: -4, name: "طالب تجربة 4", exam: "إلكتروني", created: "2026-01-01 00:00" });
  await Q.saveQgSettings({ unsure: "graders" });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
  const id = await addTestPaper(1, -4, ver, new Map([[1, [jpg]], [2, [jpg]]]), "qusay");
  reply = () => ({ questions: [{ ...good.questions[0], sure: false, reason: "ما واضح" }, good.questions[1]] });
  await Q.qusayTick(finishByAi);
  assert.ok((await one("sched_items", { id }))!.graded_at, "انصححت وما رجعت");
  await Q.saveQgSettings({ unsure: "send" });
});

test("ما يلمس مواضيع وطلاب نظام التصحيح AI مال مؤمل", async () => {
  await kvSet("ai_settings", JSON.stringify({ exams: [ex2], students: [] }));
  await kvSet(`ai_rubric_q_${(await one("bank_questions", { version_id: ver2 }))!.id}`, JSON.stringify({ steps: [{ text: "x", points: 100 }], alts: [] }));
  await assert.rejects(qusayAction({ initData: sign(1), action: "live", exam: ex2, on: true }), /مؤمل/);
  // حتى لو انحفظ بالغلط
  await Q.saveQgSettings({ live: [ex, ex2] });
  const id = await paper([1], {}, ex2, ver2);
  await Q.qusayTick(finishByAi);
  assert.equal((await one("sched_items", { id }))!.grader_id, null);
  await kvSet("ai_settings", JSON.stringify({ exams: [], students: [90] }));
  assert.equal((await Q.qusayHeld([(await one("sched_items", { id }))!])).size, 0, "طالب اختاره مؤمل");
  await kvSet("ai_settings", "{}");
  await Q.saveQgSettings({ live: [ex] });
});

test("الحد اليومي: من يوصله يوگف والأوراق تبقى للمصححين", async () => {
  await Q.saveQgSettings({ cap: 0.0001 });
  const id = await paper([1, 2]);
  const r: any = await Q.qusayTick(finishByAi);
  assert.equal(r.cap, true);
  assert.equal((await one("sched_items", { id }))!.grader_id, null);
  assert.ok(tg.some((m) => /الحد/.test(m.p?.text ?? "")), "صاحب البوت يدري");
  await Q.saveQgSettings({ cap: 2 });
});

test("🌙 بالدفعة: الورقة تنحجز، وترجع درجتها لمن تخلص الدفعة بنص الكلفة", async () => {
  await Q.saveQgSettings({ batch: true });
  const id = (await find("sched_items", { status: "done" })).find((x) => !x.graded_at && !x.grader_id && x.exam_id === ex)!.id;
  reply = () => good;
  const r: any = await Q.qusayTick(finishByAi);
  assert.equal(r.batched, 1);
  assert.equal((await one("sched_items", { id }))!.grader_id, QUSAY_GRADER, "محجوزة لحد ما ترجع");
  assert.equal((await one("sched_items", { id }))!.graded_at, null);
  batches.get("b1")!.ended = true;
  await Q.qusayTick(finishByAi);
  const it = await one("sched_items", { id });
  assert.equal(it!.total, 85);
  const res = await Q.qgResultOf(id);
  assert.equal(res!.batch, true);
  assert.equal(res!.usd, Q.usdOf(res!.tokens, false) / 2);
  await Q.saveQgSettings({ batch: false });
});

test("ورقة تجربة «🧠 تصحيح قصي»: يصححها طبيعي حتى لو الموضوع مو مأشر، والدرجة توصل (لطالب التجربة)", async () => {
  const { addTestPaper } = await import("../lib/gradeApi.ts");
  await put("students", { user_id: -3, name: "طالب تجربة 3", exam: "إلكتروني", created: "2026-01-01 00:00" });
  await Q.saveQgSettings({ live: [] });
  const id = await addTestPaper(1, -3, ver, new Map([[1, [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])]], [2, [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])]]]), "qusay");
  assert.equal((await one("sched_items", { id }))!.grader_id, QUSAY_GRADER, "محجوزة إله من الرفع");
  reply = () => good;
  tg.length = 0;
  await Q.qusayTick(finishByAi);
  const it = await one("sched_items", { id });
  assert.equal(it!.total, 85);
  assert.ok(it!.graded_at);
  assert.equal((await Q.qgResultOf(id))!.sent, true);
  assert.ok(tg.some((m) => m.method.startsWith("send")), "بطاقة الدرجة طلعت");
  const d: any = await qusayAction({ initData: sign(1), action: "paper", id });
  assert.equal(d.paper.qs.length, 2);
  await Q.saveQgSettings({ live: [ex] });
});

test("بالدفعة بس التجربة «⚡ هسه»: هاي تتصحح هسه، والباقي يروح بالدفعة", async () => {
  await Q.saveQgSettings({ batch: true, live: [] });
  const a = await paper([1, 2], { grader_id: 41, graded_at: "2026-11-21 08:00", total: 50 });
  const b = await paper([1, 2], { grader_id: 41, graded_at: "2026-11-21 09:00", total: 60 });
  reply = () => good;
  await qusayAction({ initData: sign(1), action: "trial", exam: ex, n: 1, now: true });   // آخر وحدة تصححت أول (b)
  await qusayAction({ initData: sign(1), action: "trial", exam: ex, n: 1 });
  const before = batches.size;
  const r: any = await Q.qusayTick(finishByAi);
  assert.equal(r.graded, 1);
  assert.equal(r.batched, 1);
  assert.equal(batches.size, before + 1);
  assert.equal((await Q.qgResultOf(b))!.batch, false, "هسه");
  assert.equal(await Q.qgResultOf(a), null, "بالدفعة، تنتظر");
  batches.get(`b${batches.size}`)!.ended = true;
  await Q.qusayTick(finishByAi);
  assert.equal((await Q.qgResultOf(a))!.batch, true);
  await Q.saveQgSettings({ batch: false, live: [ex] });
});

test("وصل الحد: الزايد ينتظر لباچر وما يروح للمصححين، وإذا اختار يرجعون للمصححين", async () => {
  await Q.saveQgSettings({ cap: 0.0001, carry: true });
  const id = await paper([1, 2]);
  const p = (await one("sched_items", { id }))!;
  await Q.qusayTick(finishByAi);
  assert.equal((await one("sched_items", { id }))!.grader_id, null, "ما انحجزت ولا انصرف عليها");
  assert.equal((await Q.qusayHeld([p])).has(id), true, "محجوبة عن المصححين لباچر");
  await Q.saveQgSettings({ carry: false });
  assert.equal((await Q.qusayHeld([p])).has(id), false, "ترجع للمصححين");
  await Q.saveQgSettings({ cap: 2, carry: true });
});

test("الطالب يشوف تصحيح «تصحيح قصي» خطوة خطوة بورقته", async () => {
  const { myPaper } = await import("../lib/examRoom.ts");
  const id = await paper([1, 2]);
  reply = () => good;
  await Q.qusayTick(finishByAi);
  assert.ok((await one("sched_items", { id }))!.graded_at);
  const p: any = await myPaper(90, id);
  assert.equal(p.ai.length, 2);
  assert.equal(p.ai[0].note, "زين");
  assert.deepEqual(p.ai[0].steps.map((x: any) => [x.expected, x.awarded, x.possible]), [["التعويض", 20, 20], ["التبسيط", 40, 40]]);
  assert.equal(p.ai[1].steps[0].reason, "نص");
  assert.equal(p.ai[0].photos.length, 1);
});

test("🖍 العلامات طافية بالأصل: الطلب نفسه بدون أماكن", async () => {
  assert.equal((await Q.qgSettings()).marks, false);
  const id = await paper([1, 2]);
  reply = () => good;
  await Q.qusayTick(finishByAi);
  const req = sent.at(-1);
  assert.doesNotMatch(req.system[0].text, /PEN MARKS/);
  assert.ok(!JSON.stringify(req.output_config.format.schema).includes('"p"'));
  assert.ok(!req.messages[0].content.some((b: any) => /\[Image \d\]/.test(b.text ?? "")));
  assert.equal((await Q.qgResultOf(id))!.pages, undefined);
});

// الجواب مع أماكن الخطوات على صور الطالب
const withMarks = { questions: [
  { n: 1, answered: true, method: 1, p: 1, x: 900, y: 40, steps: [{ i: 1, awarded: 20, note: "صح", p: 1, x: 700, y: 200 }, { i: 2, awarded: 10, note: "غلط بالإشارة", p: 1, x: 650, y: 400 }], score: 30, sure: true, reason: "زين" },
  { n: 2, answered: true, method: 1, p: 9, x: 5000, y: 10, steps: [{ i: 1, awarded: 0, note: "ما برهن", p: 0, x: 0, y: 0 }], score: 0, sure: true, reason: "ناقص" },
] };

test("🖍 جرب العلامات: يعيد تصحيح ورقة طالب التجربة بالأماكن، ودرجتها الأصلية ما تتغير، وطالب التجربة يشوفها مرسومة", async () => {
  const { addTestPaper } = await import("../lib/gradeApi.ts");
  const { myPaper } = await import("../lib/examRoom.ts");
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
  const id = await addTestPaper(1, -3, ver, new Map([[1, [jpg]], [2, [jpg]]]), "qusay");
  reply = () => good;
  await Q.qusayTick(finishByAi);
  const total = (await one("sched_items", { id }))!.total;
  assert.equal(total, 85);
  await assert.rejects(qusayAction({ initData: sign(1), action: "marks", id: 999999 }));
  await qusayAction({ initData: sign(1), action: "settings", style: "المفروض تعوض بالدالة" });
  const ws: any = await qusayAction({ initData: sign(1), action: "examStyle", exam: ex, style: "اكتب الجذور بشكل أوميگا" });
  assert.equal(ws.chapters[0].exams.find((x: any) => x.id === ex).style, "اكتب الجذور بشكل أوميگا");
  const r: any = await qusayAction({ initData: sign(1), action: "marks", id });
  assert.equal(r.paper.demoWaiting, true);
  reply = () => withMarks;
  tg.length = 0;
  await Q.qusayTick(finishByAi);
  const req = sent.at(-1);
  assert.match(req.system[0].text, /PEN MARKS/);
  assert.match(req.system[0].text, /TEACHER'S VOICE/);
  assert.match(req.system[0].text, /المفروض تعوض بالدالة/, "طريقته بالكتابة");
  assert.match(req.system[0].text, /THIS TOPIC[^]*اكتب الجذور بشكل أوميگا/, "عبارات الموضوع");
  assert.ok(req.system[0].text.includes("$\\frac{23\\pi}{12}$"), "الرياضيات بشكل LaTeX صحيح");
  assert.ok(req.messages[0].content.some((b: any) => b.text === "[Image 2]"), "صور الطالب مرقمة");
  assert.ok(JSON.stringify(req.output_config.format.schema).includes('"p"'));
  // الأصلية ما تغيرت، ولا شي انبعث
  assert.equal((await one("sched_items", { id }))!.total, total);
  assert.equal((await Q.qgResultOf(id))!.total, 85);
  assert.equal(tg.filter((m) => m.method.startsWith("send")).length, 0);
  const demo = (await Q.qgMarksOf(id))!;
  assert.equal(demo.total, 30);
  assert.deepEqual(demo.qs[0].steps.map((s) => s.at), [{ p: 1, x: 700, y: 200 }, { p: 1, x: 650, y: 400 }]);
  assert.equal(demo.qs[1].at, undefined, "صورة مو موجودة ما تنرسم");
  assert.equal(demo.qs[1].steps[0].at, undefined, "الخطوة اللي ما مكتوبة ما تنرسم");
  // صفحة صاحب البوت: «🖍 على الورقة» بكل سؤال
  const d: any = await qusayAction({ initData: sign(1), action: "paper", id });
  assert.equal(d.paper.demo.total, 30);
  assert.equal(d.paper.demoWaiting, false);
  const m1 = d.paper.qs[0].marked;
  assert.deepEqual(m1[0].marks.map((m: any) => [m.kind, m.text]), [["bad", ""]], "✗ على الناقص بس، والصح بلا ✓، وبدون أرقام على الورقة");
  assert.equal(m1[0].marks[0].note, "غلط بالإشارة");
  assert.equal(d.paper.qs[1].marked[0].marks.length, 0, "صورة السؤال تطلع بدون رسم");
  // طالب التجربة يشوف ورقته مرسومة
  const p: any = await myPaper(-3, id);
  assert.ok(p.ai[0].marked[0].marks.length === 1);
  assert.match((await Q.qgLog()).at(-1)!.note!, /2 من 3 خطوة/);
  // صاحب البوت يفتح ورقة طالب التجربة مثل ما تطلعله (👁 عرض بس) ويشوف صورها
  const { viewToken } = await import("../lib/webAuth.ts");
  const { myExamAction } = await import("../lib/schedApi.ts");
  const { roomFile } = await import("../lib/examRoom.ts");
  const v: any = await myExamAction({ token: viewToken(-3), action: "paper", item: id });
  assert.equal(v.viewOnly, true);
  assert.equal(v.paper.ai[0].marked[0].marks.length, 1);
  const f = await roomFile(viewToken(-3), id, v.paper.ai[0].marked[0].ref);
  assert.ok(f.body.length > 0);
  await assert.rejects(myExamAction({ token: viewToken(-3), action: "submitExam", item: id }), /عرض بس/);
  // الورقة إلها علامات قديمة من التصحيح نفسه: «🖍 جرب العلامات» الأحدث هو اللي يطلع (قبل چان يطلع القديم، طلبه 2026-11-23)
  const old = (await Q.qgResultOf(id))!;
  await kvSet(`qg_res_${id}`, JSON.stringify({ ...old, at: "2026-01-01 00:00", pages: demo.pages, qs: old.qs.map((q) => ({ ...q, reason: "قديم", steps: q.steps.map((st) => ({ ...st, note: "قديم", at: { p: 1, x: 100, y: 100 } })) })) }));
  const d2: any = await qusayAction({ initData: sign(1), action: "paper", id });
  assert.equal(d2.paper.qs[0].marked[0].marks[0].note, "غلط بالإشارة", "الجديد مو القديم");
  assert.equal(d2.paper.total, 30, "طالب التجربة: درجة التصحيح الجديد");
  const p2: any = await myPaper(-3, id);
  assert.equal(p2.ai[0].marked[0].marks[0].note, "غلط بالإشارة");
  // 🗑 شيل هاي العلامة: تنشال من الورقة عنده وعند الطالب، والدرجة تبقى
  const key = `1:${d2.paper.qs[0].marked[0].marks[0].i}:bad`;
  const hd: any = await qusayAction({ initData: sign(1), action: "hideMark", id, key });
  assert.equal(hd.paper.qs[0].marked[0].marks.length, 0);
  assert.equal((await myPaper(-3, id) as any).ai[0].marked[0].marks.length, 0);
  await assert.rejects(qusayAction({ initData: sign(1), action: "hideMark", id, key: "<x>" }), /مو مفهومة/);
  await kvSet(`qg_hide_${id}`, "[]");
  // ✏️ صلّح وعلّمه (طلبه 2026-11-23): الدرجة الصح وليش ← تتصلح الورقة، وتصير قاعدة بالموضوع
  const st1 = d2.paper.qs[0].steps[1];
  await assert.rejects(qusayAction({ initData: sign(1), action: "teach", id, q: 1, i: 1, mark: st1.points, why: "" }), /اكتب ليش/);
  await assert.rejects(qusayAction({ initData: sign(1), action: "teach", id, q: 1, i: 1, mark: st1.points + 1, why: "لأن صح" }), /الدرجة من 0/);
  const tg2: any = await qusayAction({ initData: sign(1), action: "teach", id, q: 1, i: 1, mark: st1.points, why: "الإشارة مو مطلوبة هنا، تنحسب كاملة" });
  assert.match(tg2.notice, /تعلمها/);
  assert.equal(tg2.paper.qs[0].steps[1].awarded, st1.points);
  assert.equal(tg2.paper.qs[0].steps[1].note, "");
  assert.equal(tg2.paper.total, 30 - st1.awarded + st1.points);
  const exId = Number((await one("sched_items", { id }))!.exam_id);
  const exRow: any = tg2.chapters.flatMap((c: any) => c.exams).find((x: any) => x.id === exId);
  assert.equal(exRow.lessons.length, 1);
  assert.equal(exRow.lessons[0].why, "الإشارة مو مطلوبة هنا، تنحسب كاملة");
  assert.match(await Q.topicRules(exId), /QUSAY TAUGHT YOU[^]*corrected it to[^]*الإشارة مو مطلوبة هنا/, "يروح للتصحيح الجاي");
  await qusayAction({ initData: sign(1), action: "lessonDel", exam: exId, lesson: exRow.lessons[0].id });
  assert.equal((await Q.lessonsOf(exId)).length, 0);
});

test("🖍 العلامات شغالة: كل ورقة يصححها تنحفظ بأماكنها والطالب الحقيقي يشوفها", async () => {
  const { myPaper } = await import("../lib/examRoom.ts");
  await Q.saveQgSettings({ marks: true, wait: false });
  const id = await paper([1, 2]);
  reply = () => withMarks;
  await Q.qusayTick(finishByAi);
  const res = (await Q.qgResultOf(id))!;
  assert.deepEqual(res.pages, ["ans/a.jpg", "ans/a.jpg"]);
  assert.equal(res.total, 30);
  const p: any = await myPaper(90, id);
  assert.equal(p.ai[0].marked[0].marks.length, 1);
  // طالب حقيقي ما يشوف «🖍 جرب العلامات» (بس لطالب التجربة)، بس هاي من التصحيح نفسه
  await Q.saveQgSettings({ marks: false });
  assert.deepEqual(Q.marksByPage(res.qs, res.pages!, 2).length, 0);
  // ✏️ صلّح على طالب حقيقي وصلته درجته: الدرجة الرسمية تتغير ويوصله (طلبه 2026-11-23)
  assert.equal(res.sent, true);
  const st = res.qs[0].steps.findIndex((x) => x.awarded < x.points);
  const before = Number((await one("sched_items", { id }))!.total);
  const prev = tg.length;
  const t: any = await qusayAction({ initData: sign(1), action: "teach", id, q: 1, i: st, mark: res.qs[0].steps[st].points, why: "هاي الخطوة صح، الطالب كاتبها بطريقة ثانية" });
  const gain = res.qs[0].steps[st].points - res.qs[0].steps[st].awarded;
  assert.equal(Number((await one("sched_items", { id }))!.total), before + gain, "الدرجة الرسمية تغيرت");
  assert.equal(Number((await one("question_marks", { item_id: id, q: 1 }))!.mark), res.qs[0].score + gain);
  assert.match(t.notice, /درجة الطالب صارت/);
  assert.ok(tg.slice(prev).some((m) => m.p.chat_id === 90 && /الأستاذ راجع ورقتك/.test(m.p.text)), "وصل للطالب");
  assert.equal((await Q.qgResultOf(id))!.qs[0].score, res.qs[0].score + gain, "يشوف الخطوة متصلحة");
});

test("⏸ الورقة تنتظر خطه: بيها عبارة بعده ما كاتبها، فما تنبعث ويوصله تنبيه بزرين. يكتبها فتنبعث وحدها، لو «📤 دزها بالرقعة»", async () => {
  await Q.saveQgSettings({ marks: true, wait: true });
  const id = await paper([1, 2]);
  reply = () => withMarks;
  const prev = tg.length;
  await Q.qusayTick(finishByAi);
  const res = (await Q.qgResultOf(id))!;
  assert.equal(res.sent, undefined, "ما انبعثت");
  assert.equal((await one("sched_items", { id }))!.graded_at ?? null, null);
  assert.equal((await one("sched_items", { id }))!.grader_id, QUSAY_GRADER, "محجوزة، ما تروح للمصححين");
  const phrases = await Q.phrasesOf(res, Number((await one("sched_items", { id }))!.exam_id));
  assert.ok(phrases.length > 0);
  const note = tg.slice(prev).find((m) => /تنتظر خطك/.test(String(m.p.text ?? "")))!;
  assert.ok(note, "وصله تنبيه");
  const kb = note.p.reply_markup.inline_keyboard;
  assert.match(kb[0][0].web_app.url, /\/store\/qusay\?.*&ink=\d+$/);
  assert.match(kb[1][0].callback_data, /^qiw:\d+$/);
  // التنبيه ما يتكرر بنفس الدقيقة
  await Q.qusayTick(finishByAi);
  assert.equal(tg.slice(prev).filter((m) => /تنتظر خطك/.test(String(m.p.text ?? ""))).length, 1);
  // الصفحة: الموضوع وعباراته، ويكتبها وحدة وحدة
  const exam = Number((await one("sched_items", { id }))!.exam_id);
  const page: any = await qusayAction({ initData: sign(1), action: "list" });
  assert.deepEqual(page.inkWait.find((w: any) => w.exam === exam).phrases.map((x: any) => x.t), phrases);
  // ويا كل عبارة ورقة الطالب والعلامة نفسها، حتى يفهم شنو يقصد
  const ex = page.inkWait.find((w: any) => w.exam === exam).phrases[0].ex;
  assert.equal(ex.item, id);
  assert.equal(ex.ref, "ans/a.jpg");
  assert.equal(ex.marks[ex.k].note, phrases[0]);
  assert.ok(ex.q > 0);
  for (const [k, t] of phrases.entries()) {
    const r: any = await qusayAction({ initData: sign(1), action: "waitInk", exam, item: { text: t, w: 1000, h: 360, s: [[10, 10, 50, 50]], c: "#d40000", wd: 2 } });
    if (k < phrases.length - 1) assert.equal((await Q.qgResultOf(id))!.sent, undefined, "باقي عبارة");
    else assert.match(r.notice, /انبعثت 1 ورقة/);
  }
  assert.equal((await Q.qgResultOf(id))!.sent, true, "انبعثت بخطه");
  assert.ok((await one("sched_items", { id }))!.graded_at);
  // ورقة ثانية بنفس العبارات: صارت بخطه، فتنبعث على طول
  const id2 = await paper([1, 2]);
  await Q.qusayTick(finishByAi);
  assert.equal((await Q.qgResultOf(id2))!.sent, true);
  // عبارة جديدة: تنتظر، و«📤 دزها بالرقعة» يبعثها
  const { handleUpdate } = await import("../lib/bot.ts");
  const id3 = await paper([1, 2]);
  reply = () => JSON.parse(JSON.stringify(withMarks).replace("غلط بالإشارة", "عبارة جديدة ما مكتوبة"));
  await Q.qusayTick(finishByAi);
  assert.equal((await Q.qgResultOf(id3))!.sent, undefined);
  await handleUpdate({ update_id: 991, callback_query: { id: "c", from: { id: 1, is_bot: false, first_name: "x" }, chat_instance: "x", data: `qiw:${exam}`, message: { message_id: 5, chat: { id: 1, type: "private" }, date: 1, text: "" } } } as any);
  assert.equal((await Q.qgResultOf(id3))!.sent, true, "انبعثت بالرقعة");
  assert.equal((await qusayAction({ initData: sign(1), action: "list" }) as any).inkWait.length, 0);
  for (const x of await Q.inkList(exam)) await Q.removeInk(exam, x.id);
  await Q.saveQgSettings({ marks: false });
});

test("⏸ ويا كل عبارة صورة ورقة الطالب وثلاث خيارات: ✍️ بخطي، 🔤 بالرقعة، 🚫 لا تكتب شي", async () => {
  await Q.saveQgSettings({ marks: true, wait: true });
  const { handleUpdate } = await import("../lib/bot.ts");
  const say = (t: string) => { reply = () => JSON.parse(JSON.stringify(withMarks).replace("غلط بالإشارة", t)); };
  // ورقة بيها عبارة: يوصل ويا العبارة رسالة (صورة الورقة لو كتابة) بثلاث أزرار
  say("عبارة للخيارات");
  const prev = tg.length;
  const id = await paper([1, 2]);
  await Q.qusayTick(finishByAi);
  const exam = Number((await one("sched_items", { id }))!.exam_id);
  const p1 = (await Q.inkWaitList()).find((x) => x.exam === exam)!.phrases[0];
  assert.equal(p1.t, "عبارة للخيارات");
  const per = tg.slice(prev).filter((m) => /شلون تريدها/.test(String(m.p.caption ?? m.p.text ?? "")));
  assert.equal(per.length, 1);
  const kb = per[0].p.reply_markup.inline_keyboard;
  assert.match(kb[0][0].web_app.url, new RegExp(`&ink=${exam}&ph=${p1.h}$`));
  assert.deepEqual(kb[1].map((x: any) => x.callback_data), [`qip:${exam}:${p1.h}:r`, `qip:${exam}:${p1.h}:n`]);
  // 🚫 من البوت: الورقة تنبعث، والعلامة تبقى بلا كلام
  await handleUpdate({ update_id: 992, callback_query: { id: "c", from: { id: 1, is_bot: false, first_name: "x" }, chat_instance: "x", data: `qip:${exam}:${p1.h}:n`, message: { message_id: 5, chat: { id: 1, type: "private" }, date: 1, text: "" } } } as any);
  const res = (await Q.qgResultOf(id))!;
  assert.equal(res.sent, true);
  let marks = Q.marksByPage(res.qs, res.pages!, undefined, [], await Q.inkFor(exam)).flatMap((pg) => pg.marks);
  assert.ok(!marks.some((m) => m.note === p1.t), "ما انكتبت");
  assert.ok(marks.some((m) => m.kind === "bad"), "العلامة باقية");
  // 🔤 من الصفحة لعبارة ثانية
  say("عبارة ثانية للخيارات");
  const id2 = await paper([1, 2]);
  await Q.qusayTick(finishByAi);
  const p2 = (await Q.inkWaitList()).find((x) => x.exam === exam)!.phrases[0];
  const r: any = await qusayAction({ initData: sign(1), action: "waitDecide", exam, h: p2.h, d: "r" });
  assert.match(r.notice, /انبعثت 1 ورقة/);
  const res2 = (await Q.qgResultOf(id2))!;
  marks = Q.marksByPage(res2.qs, res2.pages!, undefined, [], await Q.inkFor(exam)).flatMap((pg) => pg.marks);
  assert.ok(marks.some((m) => m.note === p2.t && !m.hand), "بالرقعة");
  // ورقة جديدة بنفس العبارة: محسومة، فتنبعث على طول
  const id3 = await paper([1, 2]);
  await Q.qusayTick(finishByAi);
  assert.equal((await Q.qgResultOf(id3))!.sent, true);
  await kvSet(`qg_phr_${exam}`, "{}");
  await Q.saveQgSettings({ marks: false });
});

test("درجات صحيحة بس: النص يروح لصالح الطالب، وماكو 8.5", () => {
  const ans = () => ({ questions: [
    { n: 1, answered: true, method: 1, steps: [{ i: 1, w: "$y=-\frac{1}{2}$", awarded: 7.5, note: "" }, { i: 2, w: " ", awarded: 10.4, note: "" }], score: 17.9, sure: true, reason: "" },
    { n: 2, answered: true, method: 1, steps: [{ i: 1, awarded: 0.5, note: "" }], score: 0.5, sure: true, reason: "" },
  ] });
  const r = Q.readAnswer({ content: [{ type: "text", text: JSON.stringify(ans()) }], usage: { input_tokens: 1, output_tokens: 1 } } as any,
    { qs: [{ n: 1, max: 60, rubric: { steps: [{ text: "أ", points: 20 }, { text: "ب", points: 40 }], alts: [] }, qText: "", qImg: null, model: [] }, { n: 2, max: 40, rubric: { steps: [{ text: "ج", points: 40 }], alts: [] }, qText: "", qImg: null, model: [] }], pdf: null }, new Set(), false);
  assert.deepEqual(r.qs.map((q) => q.steps.map((s) => s.awarded)), [[8, 10], [1]]);
  assert.deepEqual(r.qs.map((q) => q.score), [18, 1]);
  assert.ok(r.qs.every((q) => Number.isInteger(q.score)));
  // شنو كاتب الطالب بكل خطوة ينحفظ للتفصيل (مثل مؤمل)، والفارغ ما ينحفظ
  assert.deepEqual(r.qs[0].steps.map((s) => s.w), ["$y=-\frac{1}{2}$", undefined]);
});

test("🖍 العلامة ما تطلع برة الصورة", () => {
  const q = { n: 1, max: 10, score: 5, answered: true, sure: true, reason: "", method: 1, steps: [{ text: "أ", points: 5, awarded: 5, note: "", at: { p: 1, x: 1000, y: 0 } }, { text: "ب", points: 5, awarded: 0, note: "غلط", at: { p: 1, x: 0, y: 1000 } }] };
  const [pg] = Q.marksByPage([q], ["a"]);
  assert.deepEqual(pg.marks.map((m) => [m.kind, m.x, m.y]), [["bad", 70, 940]], "✗ على الغلط بس، والعلامة جوة الصورة");
  // السؤال الصح كله: ✓ على كل خطوة و«أحسنت» بآخر خطوة (بيها ✓، فما تنعاد)
  const good = { ...q, score: 10, steps: q.steps.map((st) => ({ ...st, awarded: 5 })) };
  const [g] = Q.marksByPage([good], ["a"]);
  assert.deepEqual(g.marks.map((m) => [m.kind, m.text, m.big, m.word]), [["ok", "", true, undefined]], "السؤال الصح كله: ✓ وحدة كبيرة بس، بلا مدح وبلا ✓ على كل خطوة");
  assert.deepEqual([g.marks[0].x, g.marks[0].y], [500, 500], "بنص شغله");
  assert.deepEqual(g.marks[0].box, { y0: 0, y1: 1000 }, "✓ الكبيرة تنمد على شغل السؤال كله بالصفحة");
  // مؤمل: خطوة 0 من 0 بلا مكان وملاحظتها «صح»، والسؤال 20 من 20: ✓ كبيرة بس، مو «؟ الحل ناقص» (ورقة 289، 2026-11-24)
  const zero = { ...good, at: { p: 1, x: 500, y: 600 }, steps: [...good.steps, { text: "ج", points: 0, awarded: 0, note: "صح" }] };
  assert.deepEqual(Q.marksByPage([zero], ["a"])[0].marks.map((m) => [m.kind, m.big]), [["ok", true]]);
  // الطالب ما كتب الخطوات (مثل س5: 3 من 15): «؟» وملاحظاتها تحت آخر جوابه
  const miss = { n: 5, max: 15, score: 3, answered: true, sure: true, reason: "ناقص", method: 1, at: { p: 1, x: 600, y: 700 },
    steps: [{ text: "أ", points: 5, awarded: 3, note: "", at: undefined }, { text: "ب", points: 10, awarded: 0, note: "ما كملت الحل" }] };
  const [m5] = Q.marksByPage([miss], ["a"]);
  assert.deepEqual(m5.marks.map((m) => [m.kind, m.x, m.y, m.note]), [["miss", 600, 745, "ما كملت الحل"]]);
  // خطوتين أو أكثر ما كاتبها (س5 بطالب تجربة: «ما كتبتها» على كل خطوة): «الحل ناقص» كبيرة وحدة بخطه، والغلط المكتوب يبقى ✗ (طلبه 2026-11-24)
  const many = { n: 5, max: 20, score: 1, answered: true, sure: true, reason: "", method: 1, at: { p: 1, x: 600, y: 300 }, steps: [
    { text: "أ", points: 2, awarded: 1, note: "ناقص i", w: "$\sqrt{2-4\sqrt{2}}=x+yi$", at: { p: 1, x: 400, y: 200 } },
    { text: "ب", points: 3, awarded: 0, note: "ما كتبتها", at: { p: 1, x: 400, y: 400 } },
    { text: "ج", points: 2, awarded: 0, note: "ما كتبتها" }, { text: "د", points: 2, awarded: 0, note: "ما كتبتها" }] };
  const word = { id: 9, kind: "note" as const, text: "الحل ناقص", w: 1000, h: 360, s: [[1, 2, 3, 4]] };
  const [mm] = Q.marksByPage([many], ["a"], undefined, [], [word]);
  assert.deepEqual(mm.marks.map((m) => [m.kind, !!m.big, m.note ?? "", m.x, m.y, !!m.hand]), [["bad", false, "ناقص i", 400, 200, false], ["miss", true, "الحل ناقص", 500, 370, true]]);
  // جاب 100: «ممتاز» بخطه على أول سؤال بس، بلا ✓ يمها. وإذا مو 100 ماكو مدح
  const qa = { n: 1, max: 50, score: 50, answered: true, sure: true, reason: "", method: 1, steps: [{ text: "أ", points: 50, awarded: 50, note: "", at: { p: 1, x: 500, y: 300 } }] };
  const qb = { ...qa, n: 2, steps: [{ ...qa.steps[0], at: { p: 2, x: 500, y: 300 } }] };
  const praise = [{ id: 1, kind: "praise" as const, text: "أحسنت", w: 1000, h: 360, s: [[1, 1, 2, 2]] }, { id: 2, kind: "praise" as const, text: "ممتاز", w: 1000, h: 360, s: [[5, 5, 9, 9]] }];
  const pp = Q.marksByPage([qa, qb], ["a", "b"], undefined, [], praise);
  assert.deepEqual(pp.map((pg) => pg.marks.map((m) => [m.kind, m.text, m.word?.s[0][0] ?? null, !!m.sym])), [[["ok", "", null, false], ["good", "ممتاز", 5, false]], [["ok", "", null, false]]]);
  const p99 = Q.marksByPage([qa, { ...qb, score: 49, steps: [{ ...qb.steps[0], awarded: 49 }] }], ["a", "b"], undefined, [], praise);
  assert.ok(!p99.flatMap((pg) => pg.marks).some((m) => m.kind === "good"), "مو 100: ماكو مدح");
  // «الحل ناقص» اللي كتبها بمربع «؟ الحل ناقص» تنفع هم
  const [ma] = Q.marksByPage([many], ["a"], undefined, [], [{ ...word, kind: "ask" as const, text: "؟" }]);
  assert.ok(ma.marks.find((m) => m.big)!.hand, "بخطه من مربع ؟");
  // ماكو ولا ملاحظة: سبب السؤال
  const [m6] = Q.marksByPage([{ ...miss, steps: miss.steps.map((st) => ({ ...st, note: "" })) }], ["a"]);
  assert.equal(m6.marks[0].note, "ناقص");
  assert.equal(Q.ptOf({ p: 1, x1: 100, y1: 200, x2: 500, y2: 600 }, 1, new Map(), true)!.y, 575, "آخر الجواب");
});

test("🖍 العلامة بعد آخر سطر الخطوة وجوة الورقة، مو على الطاولة أو الشاشة اللي حواليها", () => {
  const papers = Q.papersOf({ papers: [{ p: 1, x1: 150, y1: 120, x2: 820, y2: 950 }] });
  // بعد السطر يمين، بنص ارتفاعه
  assert.deepEqual(Q.ptOf({ p: 1, x1: 200, y1: 300, x2: 500, y2: 340 }, 1, papers), { p: 1, x: 540, y: 320 });
  // السطر واصل لحافة الورقة: العلامة يسار السطر، مو برة الورقة
  assert.deepEqual(Q.ptOf({ p: 1, x1: 300, y1: 400, x2: 800, y2: 440 }, 1, papers), { p: 1, x: 260, y: 420 });
  // سطر فوك حافة الورقة: ينزل جوة
  assert.equal(Q.ptOf({ p: 1, x1: 200, y1: 50, x2: 400, y2: 90 }, 1, papers)!.y, 145);
  // خطوة ما مكتوبة، أو صورة مو موجودة
  assert.equal(Q.ptOf({ p: 0, x1: 0, y1: 0, x2: 0, y2: 0 }, 1, papers), undefined);
  assert.equal(Q.ptOf({ p: 2, x1: 1, y1: 1, x2: 50, y2: 50 }, 1, papers), undefined);
});

test("جواب انقطع: الطلب انحسب بالصرفية والسجل، وحد الكتابة صار 32 ألف", async () => {
  const id = await paper([1, 2]);
  const real = msg;
  Q.setQgApi({
    create: async (req) => { sent.push(req); return { ...real({ questions: [] }), stop_reason: "max_tokens" }; },
    batchCreate: async () => "x", batchGet: async () => ({ ended: false, results: [] }),
  });
  await Q.queueMarks((await find("sched_items", { status: "done" })).find((x) => x.grader_id === QUSAY_GRADER && x.graded_at)!.id);
  await Q.qusayTick(finishByAi);
  const fails = (await Q.qgLog()).filter((r) => r.kind === "failed").slice(-2);
  assert.ok(fails.some((r) => /طويل وانگطع/.test(r.note ?? "") && (r.usd ?? 0) > 0), "انحسبت كلفته");
  assert.equal(sent.at(-1).max_tokens, 32000);
  assert.equal((await one("sched_items", { id }))!.grader_id, null, "الورقة رجعت مثل ما چانت");
  Q.setQgApi({
    create: async (req) => { sent.push(req); return msg(reply(req)); },
    batchCreate: async (reqs) => { const bid = `b${batches.size + 1}`; batches.set(bid, { reqs, ended: false }); return bid; },
    batchGet: async (bid) => { const bb = batches.get(bid)!; return { ended: bb.ended, results: bb.ended ? bb.reqs.map((r) => ({ id: r.custom_id, msg: msg(reply(r.params)) })) : [] }; },
  });
});

test("الكلفة: الكاش يندفع عشره", () => {
  const t = { in: 1000, cw: 0, cr: 4000, out: 800 };
  assert.equal(Math.round(Q.usdOf(t, false) * 1e7) / 1e7, (1000 * 0.1 + 4000 * 0.01 + 800 * 0.5) / 1e6);
});

test("الصفحة بس لصاحب البوت واللي عنده الصلاحية", async () => {
  await assert.rejects(qusayAction({ initData: sign(41), action: "list" }), (e: any) => e.status === 403);
  await put("staff", { user_id: 42, name: "مساعد", perms: "qusay" });
  const r: any = await qusayAction({ initData: sign(42), action: "list" });
  assert.equal(r.on, true);
  const { adminHomeAction } = await import("../lib/adminHomeApi.ts");
  assert.ok(JSON.stringify(await adminHomeAction({ initData: sign(42), action: "list" })).includes('"qusay"'), "مربعه بلوحة التحكم");
});

test("✍️ خط إيدي: يرتفع (عام وخاص بموضوع)، وينرسم على الورقة بدل الخط، والملاحظة بخطه إذا الذكاء اختار رقمها", async () => {
  const shape = { w: 480, h: 360, s: [[10, 10, 50, 80, 120, 20]] };
  await assert.rejects(qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "note", text: "", ...shape } }), /اكتب شنو مكتوب/);
  await assert.rejects(qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "tick", w: 480, h: 360, s: [] } }), /ما كتبت شي/);
  const t: any = await qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "tick", ...shape, s: [[10, 10, 9999, -5]] } });
  assert.deepEqual(t.inkOf.items[0].s, [[10, 10, 480, 0]], "النقاط جوة المربع");
  assert.equal(t.inkOf.items[0].text, "✓");
  await qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "cross", ...shape } });
  await qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "praise", text: "ممتاز", w: 1000, h: 360, s: [[1, 2, 3, 4]] } });
  const ex = (await find("bank_exams", {}))[0].id;
  const n: any = await qusayAction({ initData: sign(1), action: "inkAdd", exam: ex, item: { kind: "note", text: "نسيت تعوض", w: 1000, h: 360, s: [[5, 5, 6, 6]] } });
  assert.equal(n.inkOf.exam, ex);
  const note = n.inkOf.items[0];
  const ink = await Q.inkFor(ex);
  assert.equal(ink.length, 4, "العام والخاص سوا");
  assert.equal((await Q.inkFor(0)).length, 3, "الخاص بس بموضوعه");
  const q = { n: 1, max: 10, score: 5, answered: true, sure: true, reason: "", method: 1,
    steps: [{ text: "أ", points: 5, awarded: 0, note: "نسيت تعوض", hw: note.id, at: { p: 1, x: 300, y: 300 } }, { text: "ب", points: 5, awarded: 2, note: "قريب", hw: 999, at: { p: 1, x: 400, y: 600 } }] };
  const [pg] = Q.marksByPage([q], ["a"], undefined, [], ink);
  assert.deepEqual(pg.marks[0].sym!.s, ink.find((x) => x.kind === "cross")!.s, "✗ بخطه");
  assert.deepEqual(pg.marks[0].hand!.s, note.s, "الملاحظة بخطه");
  assert.equal(pg.marks[1].hand, undefined, "رقم مو موجود: تنكتب بالخط");
  assert.deepEqual(pg.marks[1].sym!.s, ink.find((x) => x.kind === "cross")!.s, "الناقصة: ✗ بخطه، بدون رقم");
  assert.equal(pg.marks[1].text, "");
  const good = { ...q, score: 10, steps: q.steps.map((st) => ({ ...st, awarded: 5 })) };
  assert.ok(!Q.marksByPage([good], ["a"], undefined, [], ink)[0].marks.some((m) => m.kind === "good" || m.word), "ماكو مدح على الورقة حتى لو كاتبه بخطه");
  assert.equal(Q.marksByPage([q], ["a"])[0].marks[0].sym, undefined, "بدون خط إيد: مثل قبل");
  await qusayAction({ initData: sign(1), action: "inkDel", exam: ex, id: note.id });
  assert.equal((await Q.inkList(ex)).length, 0);
  // اللون والسمك: ينحفظون ويروحون للورقة. لون مو من القائمة يصير أحمر، والقديم بدونهم
  const b: any = await qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "praise", text: "أحسنت", w: 1000, h: 360, s: [[1, 2, 3, 4]], c: "#1d4ed8", wd: 3 } });
  const blue = b.inkOf.items.at(-1);
  assert.equal(blue.c, "#1d4ed8"); assert.equal(blue.wd, 3);
  const odd: any = await qusayAction({ initData: sign(1), action: "inkAdd", item: { kind: "praise", text: "بطل", w: 1000, h: 360, s: [[1, 2, 3, 4]], c: "url(x)", wd: 9 } });
  assert.equal(odd.inkOf.items.at(-1).c, "#d40000"); assert.equal(odd.inkOf.items.at(-1).wd, 2);

  // «ممتاز» مو نسخة ملزوگة (طلبه 2026-11-22): سؤالين كاملين بنفس الورقة ياخذون مدح مختلف، يتزحزح عن مكانه ويميل،
  // ونفس الورقة تطلع نفس الشكل كل ما تنفتح
  const praise = [{ ...blue, id: 1, s: [[1, 1, 9, 9]] }, { ...blue, id: 2, s: [[2, 2, 8, 8]] }];
  const two = [{ ...good, n: 1, at: { p: 1, x: 500, y: 300 } }, { ...good, n: 2, at: { p: 1, x: 500, y: 700 } }];
  // ماكو مدح بالورقة أبد (طلبه 2026-11-23): كل سؤال كامل ✓ كبيرة بس
  const tm = Q.marksByPage(two, ["a"], undefined, [], praise)[0].marks;
  assert.deepEqual(tm.map((m) => [m.kind, m.big, m.q]), [["ok", true, 1], ["ok", true, 2]]);
  // علامتين بنفس المكان ما يركبن فوك بعض
  const same = { ...q, steps: [{ text: "أ", points: 5, awarded: 0, note: "", at: { p: 1, x: 500, y: 500 } }, { text: "ب", points: 5, awarded: 0, note: "", at: { p: 1, x: 510, y: 505 } }] };
  const sm = Q.marksByPage([{ ...same, score: 0 }], ["a"])[0].marks;
  assert.ok(Math.abs(sm[0].x - sm[1].x) >= 55, "تزحزحت");
  assert.deepEqual(Q.marksByPage(two, ["a"], undefined, [], praise), Q.marksByPage(two, ["a"], undefined, [], praise), "ثابت لنفس الورقة");
});

test("📈 سؤال بيه خطوة رسم: PDF حل الأستاذ يروح ويا الخطوات حتى يقارن الرسم، وبدون رسم ما يروح", async () => {
  fs.writeFileSync(path.join(tmp, "ans", "model.pdf"), Buffer.from("%PDF-1.4\n%fake\n"));
  const exD = await insert("bank_exams", { slug: "c3", chapter: "الفصل الثالث", ord: 9, title: "رسم الدوال شامل", minutes: 60, pos: 9 });
  const verD = await insert("bank_versions", { exam_id: exD, model: "A", kind: "mandatory", ok: 1, answer_pdf: "ans/model.pdf" });
  const qD = await insert("bank_questions", { version_id: verD, n: 1, max_mark: 30, q_text: "ارسم الدالة", a_files: "[]" });
  await kvSet(`ai_rubric_q_${qD}`, JSON.stringify({ steps: [{ text: "المشتقة", points: 22 }, { text: "Graph of the function", points: 8 }], alts: [] }));
  await qusayAction({ initData: sign(1), action: "live", exam: exD, on: true });
  await paper([1], {}, exD, verD);
  reply = () => ({ questions: [{ n: 1, answered: true, method: 1, steps: [{ i: 1, awarded: 22, note: "" }, { i: 2, awarded: 4, note: "ناقص المحاذي" }], score: 26, sure: true, reason: "" }] });
  await Q.qusayTick(finishByAi);
  const req = sent.at(-1);
  assert.match(req.system[0].text, /DRAWINGS/);
  const head = req.messages[0].content;
  assert.ok(head.some((b: any) => b.type === "document"), "PDF الحل راح");
  assert.ok(head.some((b: any) => /drawing steps/.test(b.text ?? "")));
  // موضوع بلا خطوة رسم: نفس قبل، الـ PDF ما يروح
  const verN = await insert("bank_versions", { exam_id: exD, model: "B", kind: "mandatory", ok: 1, answer_pdf: "ans/model.pdf" });
  const qN = await insert("bank_questions", { version_id: verN, n: 1, max_mark: 30, q_text: "جد المشتقة", a_files: "[]" });
  await kvSet(`ai_rubric_q_${qN}`, JSON.stringify({ steps: [{ text: "Sign chart of f'(x)", points: 30 }], alts: [] }));
  await paper([1], {}, exD, verN);
  reply = () => ({ questions: [{ n: 1, answered: true, method: 1, steps: [{ i: 1, awarded: 30, note: "" }], score: 30, sure: true, reason: "" }] });
  await Q.qusayTick(finishByAi);
  assert.ok(!sent.at(-1).messages[0].content.some((b: any) => b.type === "document"));
  assert.ok(Q.DRAW_STEP.test("Drawing of the cylinder with r and h") && Q.DRAW_STEP.test("[7] الرسم") && Q.DRAW_STEP.test("Sketch of the ellipse") && !Q.DRAW_STEP.test("Table: x = 1, -1"));
});

test("✋ الاعتراض على ورقة «تصحيح قصي»: بالأصل يروح لشخص، وإذا اختار «🧠 يراجعه» يعيد السؤال ويقبل أو يرفض، والدرجة ما تنزل", async () => {
  const { aiObjectionsTick } = await import("../lib/gradeApi.ts");
  const { canHandle } = await import("../lib/objections.ts");
  await Q.saveQgSettings({ live: [ex], obj: "person", objTo: 0 });
  const id = await paper([1, 2]);
  reply = () => good;
  await Q.qusayTick(finishByAi);
  const it = (await one("sched_items", { id }))!;
  assert.equal(it.grader_id, QUSAY_GRADER);
  const o1 = await insert("objections", { item_id: id, user_id: 90, q: 2, text: "البرهان كامل بالصفحة الثانية", voice: null, status: "open", old_mark: 25, new_mark: null, reason: null, created: stamp(), decided_at: null, decided_by: null });
  // «👤 لشخص»: ما يراجعه، ينتظر بالاعتراضات. والمساعد اللي ما مختار ما يرد
  sent.length = 0;
  await aiObjectionsTick();
  assert.equal(sent.length, 0);
  await put("staff", { user_id: 43, name: "مساعد الاعتراضات", perms: "objections" });
  assert.equal(await canHandle(43, it), false);
  await Q.saveQgSettings({ objTo: 43 });
  assert.equal(await canHandle(43, it), true, "المختار يرد");
  // «🧠 يراجعه»: الطلب بيه السؤال 2 بس وكلام الطالب، ويقبل لأن الدرجة صعدت
  await Q.saveQgSettings({ obj: "qusay" });
  reply = () => ({ accept: true, mark: 33.6, reason: "صح، البرهان كامل" });
  tg.length = 0;
  await aiObjectionsTick();
  const req = sent.at(-1);
  assert.match(req.system[0].text, /OBJECTION REVIEW/);
  const text = req.messages[0].content.map((b: any) => b.text ?? "").join(" ");
  assert.match(text, /question 2/); assert.match(text, /البرهان كامل بالصفحة الثانية/); assert.doesNotMatch(text, /Question 1 —/);
  const o = (await one("objections", { id: o1 }))!;
  assert.deepEqual([o.status, o.new_mark, o.decided_by], ["accepted", 34, QUSAY_GRADER]);
  assert.equal((await Q.qgResultOf(id))!.qs.find((q) => q.n === 2)!.score, 34, "تفصيل ورقته يطلع الجديدة");
  assert.match(tg.find((m) => String(m.p.chat_id) === "90")!.p.text, /رد على اعتراضك[\s\S]*البرهان كامل/);
  assert.equal((await Q.qgLog()).at(-1)!.kind, "obj");
  // يگول «اقبل» بس الدرجة ما صعدت: ينرفض، وما تنزل
  const o2 = await insert("objections", { item_id: id, user_id: 90, q: 1, text: "أستحق أكثر", voice: null, status: "open", old_mark: 60, new_mark: null, reason: null, created: stamp(), decided_at: null, decided_by: null });
  reply = () => ({ accept: true, mark: 40, reason: "خطوتك الثانية ناقصة" });
  await aiObjectionsTick();
  assert.deepEqual([(await one("objections", { id: o2 }))!.status, (await one("objections", { id: o2 }))!.new_mark], ["rejected", 60]);
  await Q.saveQgSettings({ live: [], obj: "person", objTo: 0 });
});

test("سؤال رجع بلا خطوات: إذا درجته كاملة تنحسب كاملة، وإلا يتعاد، وما يصير صفر بالسكوت (طالب تجربة 9)", () => {
  const mat = { qs: [{ n: 1, max: 30, rubric: { steps: [{ text: "أ", points: 10 }, { text: "ب", points: 20 }], alts: [] }, qText: "", qImg: null, model: [] }], pdf: null };
  const m = (j: any) => ({ content: [{ type: "text", text: JSON.stringify(j) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" } as any);
  const full = Q.readAnswer(m({ questions: [{ n: 1, answered: true, method: 1, steps: [], score: 30, sure: true, reason: "ممتاز" }] }), mat as any, new Set(), false);
  assert.equal(full.qs[0].score, 30);
  assert.throws(() => Q.readAnswer(m({ questions: [{ n: 1, answered: true, method: 1, steps: [], score: 12, sure: true, reason: "" }] }), mat as any, new Set(), false), /بلا خطوات/);
});

test("؟ بخطه: الخطوات اللي ما كتبها الطالب تنرسم «؟» تحت آخر جوابه، مو ✗ على سطر صح", () => {
  const q = { n: 1, max: 10, score: 5, answered: true, sure: true, reason: "ناقص الرسم", method: 1, at: { p: 1, x: 500, y: 600 },
    steps: [{ text: "أ", points: 5, awarded: 5, note: "", at: { p: 1, x: 500, y: 500 } }, { text: "الرسم", points: 5, awarded: 0, note: "ما رسمت الدالة" }] };
  const ask = { id: 7, kind: "ask" as const, text: "؟", w: 480, h: 360, s: [[1, 2, 3, 4]] };
  const [pg] = Q.marksByPage([q], ["a"], undefined, [], [ask]);
  assert.deepEqual(pg.marks.map((x) => [x.kind, x.y]), [["miss", 645]]);
  assert.equal(pg.marks[0].note, "ما رسمت الدالة");
  assert.deepEqual(pg.marks[0].sym!.s, ask.s, "«؟» بخطه");
});

test("📄 ارفع ملف: Word ببلاش والمعادلات تصير x² و 3/x²، PDF يقراه الذكاء حرف بحرف", async () => {
  const name = Buffer.from("word/document.xml");
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">1. المجال </w:t></w:r><m:oMath><m:r><m:t>y=</m:t></m:r><m:f><m:num><m:r><m:t>3</m:t></m:r></m:num><m:den><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:den></m:f></m:oMath></w:p>' +
    '<w:p><w:r><w:t>2. عيوني ترى القانون ما كاتبه</w:t></w:r></w:p></w:body></w:document>';
  const data = Buffer.from(xml, "utf8");
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(crc(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(crc(data), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  const docx = Buffer.concat([local, name, data, cen, name, end]);
  const prev = sent.length;
  const r: any = await qusayAction({ initData: sign(1), action: "notesFile", name: "شرحي.docx", b64: docx.toString("base64") });
  assert.equal(r.tidy, "1. المجال y=3/x²\n2. عيوني ترى القانون ما كاتبه");
  assert.equal(sent.length, prev, "الـ Word ما يروح للذكاء");
  assert.match(r.notice, /ببلاش/);
  reply = () => "1. المجال y=3/x²";
  const pdf: any = await qusayAction({ initData: sign(1), action: "notesFile", name: "شرحي.pdf", b64: Buffer.from("%PDF-1.4 " + "x".repeat(200)).toString("base64") });
  assert.equal(sent.length, prev + 1);
  assert.equal(sent.at(-1).messages[0].content[0].type, "document");
  assert.match(sent.at(-1).system, /EXACTLY as written/);
  assert.ok(pdf.tidy.includes("y=3/x²"));
  await assert.rejects(qusayAction({ initData: sign(1), action: "notesFile", name: "a.txt", b64: "aGVsbG8=" }), /Word/);
});

test("معادلات Word تصير كتابة موبايل", async () => {
  const { texToPhone } = await import("../lib/notesFile.ts");
  const B = String.raw;
  assert.equal(texToPhone(B`\frac{6x}{{\left({x}^{2}+3\right)}^{2}}`), "6x/(x²+3)²");
  assert.equal(texToPhone(B`{f}^{''}\left(x\right)=6x`), "f''(x)=6x");
  assert.equal(texToPhone(B`\sqrt{x+1}`), "√(x+1)");
  assert.equal(texToPhone(B`{e}^{x+1}`), "e^(x+1)");
  // ملفه الحقيقي: «R \ {0}» بمعادلة Word چانت تطلع «R 0» (طلبه 2026-11-22)
  assert.equal(texToPhone(B`R\setminus  \{0\}`), B`R\{0}`);
  const { toTex } = await import("../app/store/myexams/mathTex.ts");
  assert.equal(toTex(B`R\{0}`), B`R\setminus\{0\}`, "ينرسم R∖{0} مو R{0}");
  // فحص كل ملفات Word عنده (707 ألف معادلة): ∛ ، الأس الطويل بقوس، ومسافة بعد الأس
  assert.equal(texToPhone(B`\sqrt[3]{{\left(3x-1\right)}^{2}}`), "∛((3x-1)²)");
  assert.equal(toTex("∛((3x-1)²)"), B`\sqrt[3]{(3x-1)^2}`);
  assert.equal(texToPhone(B`{e}^{-x}dx`), "e^(-x)dx");
  assert.equal(texToPhone(B`{e}^{x}\cos {e}^{x}`), "e^x cos e^x");
  assert.equal(texToPhone(B`{\left(-1{)}^{6}`), "(-1)⁶");
  const { docxMath } = await import("../lib/docxText.ts");
  const mk = (math: string) => {
    const name = Buffer.from("word/document.xml");
    const data = Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><m:oMath>${math}</m:oMath></w:p></w:body></w:document>`, "utf8");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
    return texToPhone(docxMath(Buffer.concat([local, name, data, cen, name, end]))[0].tex);
  };
  const r = (t: string) => `<m:r><m:t xml:space="preserve">${t}</m:t></m:r>`;
  assert.equal(mk(r("R") + r(" \\ {0}")), B`R\{0}`, "ملفه: «R \\ {0}»");
  assert.equal(mk(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub/><m:sup/><m:e>${r("hiMi")}</m:e></m:nary>`), "∑ hiMi", "∑ ما يضيع اللي بعده");
  assert.equal(mk(r("F1(2,0) &amp; F2(-2,0)")), "F1(2,0) & F2(-2,0)");
});

test("ألفاظ الأستاذ بس: «قصوى» تصير «عظمى» و«دنيا» تصير «صغرى»", () => {
  assert.equal(Q.bookWords("ما كتبت إنها نقطة قصوى محلية"), "ما كتبت إنها نقطة نهاية عظمى محلية");
  assert.equal(Q.bookWords("نهاية قصوى ونقطة دنيا"), "نهاية عظمى ونقطة نهاية صغرى");
  assert.equal(Q.bookWords("نقطة نهاية عظمى محلية"), "نقطة نهاية عظمى محلية");
});

test("🪄 رتّب كلامي: يرجع الكلام مرتب، وينحسب بالصرفية", async () => {
  reply = () => "1. بالنسخة B: ...";
  const prev = sent.length;
  const r: any = await qusayAction({ initData: sign(1), action: "tidy", text: "سرك Respect واي X" });
  assert.equal(sent.length, prev + 1);
  assert.match(sent.at(-1).system, /speech recognition/i);
  assert.equal(typeof r.tidy, "string");
  await assert.rejects(qusayAction({ initData: sign(1), action: "tidy", text: "  " }), /ماكو كلام/);
});

test("الذكاء اللي يصحح يتبدل (Haiku / Sonnet / Opus)، وكل واحد بسعره", async () => {
  const t = { in: 1_000_000, cw: 0, cr: 0, out: 0 };
  assert.equal(Q.usdOf(t, false), 0.1);
  assert.equal(Q.usdOf({ ...t, m: "claude-sonnet-5-5" }, false), 2);
  assert.equal(Q.usdOf({ ...t, m: "claude-opus-5-5" }, true), 2, "الدفعة نص");
  const r: any = await qusayAction({ initData: sign(1), action: "settings", model: "sonnet" });
  assert.equal(r.settings.model, "sonnet");
  assert.equal(Q.QG_MODELS[(await Q.qgSettings()).model].id, "claude-sonnet-5-5");
  await qusayAction({ initData: sign(1), action: "settings", model: "nonsense" });
  assert.equal((await Q.qgSettings()).model, "sonnet", "قيمة غلط ما تنحفظ");
  await qusayAction({ initData: sign(1), action: "settings", model: "haiku" });
});

test("خطوات الحل بلغة منهج الطالب: الإنجليزي يصير عربي لطالب عربي، وتنحفظ وما تنعاد", async () => {
  reply = () => ({ items: ["أوسع مجال: $x^2=0$ → $x=0$"] });
  const prev = sent.length;
  const a = await Q.stepsIn("ar", ["Domain: x^2=0 → x=0", "f''(x)=6x", "اوسع مجال للدالة هو R"]);
  assert.deepEqual(a, ["أوسع مجال: $x^2=0$ → $x=0$", "f''(x)=6x", "اوسع مجال للدالة هو R"], "بس اللي بيه كلام إنجليزي يترجم");
  assert.equal(sent.length, prev + 1);
  assert.match(sent.at(-1).system, /نقطة نهاية عظمى محلية/);
  const b = await Q.stepsIn("ar", ["Domain: x^2=0 → x=0"]);
  assert.equal(b[0], "أوسع مجال: $x^2=0$ → $x=0$");
  assert.equal(sent.length, prev + 1, "محفوظة، ما يسأل مرة ثانية");
  assert.deepEqual(await Q.stepsIn("en", ["f''(x)=6x"]), ["f''(x)=6x"]);
});

test("⚖️ قارن: نفس الورقة يصححها مؤمل وقصي بالسر، وتطلع جنب درجة المصحح، وولا شي يتغير بالورقة", async () => {
  const id = await paper([1, 2]);
  const it = (await one("sched_items", { id }))!;
  await put("sched_items", { ...it, graded_at: "2026-11-23 10:00", grader_id: 55, total: 40 });
  await put("question_marks", { item_id: id, q: 1, mark: 20 });
  await put("question_marks", { item_id: id, q: 2, mark: 20 });
  const n: any = await qusayAction({ initData: sign(1), action: "compare", exam: it.exam_id, n: 3 });
  assert.match(n.notice, /تنتظر المقارنة/);
  const row = n.cmp.rows.find((r: any) => r.id === id);
  assert.ok(row.waiting);
  assert.equal(row.ref.total, 40, "درجة المصحح هي المرجع");
  // مؤمل (خدمته وهمية) وقصي يصححون بالدكة
  const A = await import("../lib/aiGrade.ts");
  const before = tg.length;
  reply = () => withMarks;
  await Q.qusayTick(finishByAi);
  const c = (await Q.cmpOf(id))!;
  assert.ok(c.qg, "قصي صحح");
  assert.ok(c.mu || c.muErr, "مؤمل صحح لو كتب ليش ما گدر");
  assert.equal(Number((await one("sched_items", { id }))!.total), 40, "درجة الورقة ما تغيرت");
  assert.equal(tg.slice(before).filter((m) => m.method.startsWith("send") && m.p.chat_id !== 1).length, 0, "ولا شي وصل للطالب");
  const v: any = await qusayAction({ initData: sign(1), action: "compareView", exam: it.exam_id });
  assert.equal(v.cmp.rows.find((r: any) => r.id === id).qg.total, c.qg!.total);
  // ⚖️ الأوراق جنب بعض: صفحات الورقة ويا رسم المصحح، ومؤمل خطوة خطوة، وقصي بعلاماته على الورقة
  await put("paper_ink", { item_id: id, page: 0, ink: JSON.stringify({ rot: 0, items: [{ t: "s", c: "#d40000", w: 4, p: [0.1, 0.1, 0.2, 0.2] }] }) });
  const sd: any = await qusayAction({ initData: sign(1), action: "compareSide", exam: it.exam_id });
  const sr = sd.side.rows.find((r: any) => r.id === id);
  assert.equal(sr.ref.total, 40);
  assert.ok(sr.pages.length >= 1 && sr.pages[0].ink.includes("#d40000"), "رسمه على صفحته");
  assert.ok(Array.isArray(sr.qg.marked), "علامات قصي على الورقة");
  assert.ok(sd.on !== undefined, "باقي بيانات الصفحة ما تضيع");
  const ra: any = await qusayAction({ initData: sign(1), action: "compareRedoAll", exam: it.exam_id });
  assert.match(ra.notice, /الاثنين يعيدون/);
  const cl: any = await qusayAction({ initData: sign(1), action: "compareClear", exam: it.exam_id });
  assert.match(cl.notice, /انمسحت/);
  assert.equal(await Q.cmpOf(id), null);
  void A;
});

test("🖋 خطي من أوراقي: علامات الأستاذ بالقلم تنقرا وتنضاف لخط إيده بموضوعها، ودرجاته وملاحظاته تصير أمثلة لتصحيح قصي", async () => {
  const H = await import("../lib/inkHarvest.ts");
  const id = await paper([1, 2]);
  const it = (await one("sched_items", { id }))!;
  await put("sched_items", { ...it, graded_at: "2026-11-23 11:00", grader_id: 1, total: 25 });
  await put("question_marks", { item_id: id, q: 1, mark: 10 });
  await put("question_marks", { item_id: id, q: 2, mark: 15 });
  // صفحة 0 (س1): ✓ يسار فوك. صفحة 1 (س2): ملاحظة بعيدة
  const tick = { t: "s", c: "#d40000", w: 5, p: [0.1, 0.1, 0.12, 0.13, 0.16, 0.06] };
  const note = [{ t: "s", c: "#d40000", w: 5, p: [0.5, 0.7, 0.6, 0.72] }, { t: "s", c: "#d40000", w: 5, p: [0.61, 0.7, 0.7, 0.71] }];
  await put("paper_ink", { item_id: id, page: 0, ink: JSON.stringify({ rot: 0, items: [tick] }) });
  await put("paper_ink", { item_id: id, page: 1, ink: JSON.stringify({ rot: 0, items: note }) });
  assert.equal(await H.queueHarvest(id), true);
  assert.equal(await H.queueHarvest(id), true, "مرة وحدة بالطابور");
  const reqs: any[] = [];
  // الذكاء يشوف الصفحة كاملة ويرجع كل علامة بمربعها (0 لـ 1000)
  const create = async (r: any) => {
    reqs.push(r);
    const items = reqs.length === 1 ? [{ kind: "tick", text: "✓", box: [90, 50, 170, 140] }] : [{ kind: "note", text: "نسيت تعوض", box: [490, 690, 710, 730] }, { kind: "other", text: "", box: [0, 0, 10, 10] }];
    return { content: [{ type: "text", text: JSON.stringify({ items }) }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: "end_turn", model: "claude-sonnet-5-5" } as any;
  };
  assert.equal(await H.harvestTick(create, "claude-sonnet-5-5"), 1);
  assert.equal(reqs.length, 2, "طلب لكل صفحة بيها كتابة");
  assert.equal(reqs[0].messages[0].content[0].type, "image");
  const ink = await Q.inkList(Number(it.exam_id));
  assert.ok(ink.some((x) => x.kind === "tick"), "✓ بخطه");
  assert.ok(ink.some((x) => x.kind === "note" && x.text === "نسيت تعوض"), "ملاحظته بخطه ويا نصها");
  const ex = await H.examplesOf(Number(it.exam_id));
  const mine = ex.find((e) => e.item === id)!;
  assert.deepEqual(mine.qs.map((q) => [q.n, q.mark, q.notes]), [[1, 10, []], [2, 15, ["نسيت تعوض"]]]);
  assert.match(await Q.topicRules(Number(it.exam_id)), /HOW QUSAY HIMSELF GRADED[^]*Q2 15\/\d+ \(he wrote: «نسيت تعوض»\)/);
  assert.equal(await H.queueHarvest(id), false, "الورقة انقرت، ما تنعاد");
  const r: any = await qusayAction({ initData: sign(1), action: "harvestExam", exam: it.exam_id });
  assert.match(r.notice, /ماكو أوراق جديدة/);
});

test("سؤال جاوبه الطالب والذكاء ما رجع درجته: الورقة تتعاد، ما ينحسب صفر (طالب تجربة 31)، والملاحظة بلا كلام الذكاء لنفسه", () => {
  const mat = { qs: [{ n: 1, max: 30, rubric: null, qText: "", qImg: null, model: [] }, { n: 2, max: 35, rubric: null, qText: "", qImg: null, model: [] }], pdf: null };
  const m = (j: any) => ({ content: [{ type: "text", text: JSON.stringify(j) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" } as any);
  assert.throws(() => Q.readAnswer(m({ questions: [{ n: 1, answered: true, method: 1, steps: [], score: 24, sure: true, reason: "" }] }), mat as any, new Set(), false), /ناقص \(السؤال 2/);
  assert.equal(Q.readAnswer(m({ questions: [{ n: 1, answered: true, method: 1, steps: [], score: 24, sure: true, reason: "" }] }), mat as any, new Set([2]), false).qs[1].reason, "ما جاوب", "اللي ما جاوبه الطالب عادي");
  assert.equal(Q.cleanNote("الجدول غلط والرسم ناقص. ضعيف التأكد من وضوح الرسم. ملاحظة: الدرجة تقديرية"), "الجدول غلط والرسم ناقص.");
  assert.equal(Q.cleanNote("والرسم ناقص شوية بالفرع الأيسر.}],"), "والرسم ناقص شوية بالفرع الأيسر.");
});

test("🖍 تصحيح مؤمل على الورقة: طلب صغير يلگى مكان كل خطوة، والطالب يشوف علاماته بالأحمر مثل قصي", async () => {
  const { myPaper } = await import("../lib/examRoom.ts");
  const { AI_GRADER } = await import("../lib/data.ts");
  const id = await paper([1, 2]);
  const it = (await one("sched_items", { id }))!;
  await put("sched_items", { ...it, graded_at: "2026-11-24 10:00", grader_id: AI_GRADER, total: 25 });
  await kvSet(`ai_result_${id}`, JSON.stringify([
    { n: 1, score: 10, max: 10, review: false, reason: "", lines: [], steps: [{ status: "ok", awarded: 10, possible: 10, reason: "", expected: "أ", student: "" }] },
    { n: 2, score: 15, max: 20, review: false, reason: "", lines: [], steps: [{ status: "ok", awarded: 10, possible: 10, reason: "", expected: "ب", student: "" }, { status: "wrong", awarded: 5, possible: 10, reason: "", reason_ar: "الإشارة غلط", expected: "ج", student: "" }] },
  ]));
  Q.setQgApi({ create: async () => ({ content: [{ type: "text", text: JSON.stringify({ questions: [
    { n: 1, at: { p: 1, x: 500, y: 300 }, steps: [{ i: 1, p: 1, x: 500, y: 250 }] },
    { n: 2, at: { p: 2, x: 600, y: 700 }, steps: [{ i: 1, p: 2, x: 400, y: 300 }, { i: 2, p: 2, x: 420, y: 500 }] },
  ] }) }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: "end_turn", model: "claude-haiku-5-5" }) } as any);
  const mk = (await Q.muMarksFor(id))!;
  Q.setQgApi(null);
  assert.equal(mk.qs[1].steps[1].note, "الإشارة غلط");
  const p: any = await myPaper(it.user_id, id);
  const q2 = p.ai.find((q: any) => q.n === 2);
  assert.ok(q2.marked.some((pg: any) => pg.marks.some((m: any) => m.kind === "bad" && m.note === "الإشارة غلط")), "✗ ويا ملاحظة مؤمل على الغلط");
  const q1 = p.ai.find((q: any) => q.n === 1);
  assert.ok(q1.marked.some((pg: any) => pg.marks.some((m: any) => m.big)), "السؤال الكامل ✓ كبيرة");
});

test("✍️ حلك: كل خطوة كتبها الطالب بسطر، والفارزة جوة الأقواس تبقى (طلبه 2026-11-24)", () => {
  assert.equal(Q.wLines("$x^2+4x+4+4y-6x=-3$, $(x-1)^2=|y-6|-1$"), "x^2+4x+4+4y-6x=-3 ; (x-1)^2=|y-6|-1");
  assert.equal(Q.wLines("$h=1, p=\frac{1}{4}, k=6$، الرأس $(1,6)$"), "h=1 ; p=\frac{1}{4} ; k=6 ; الرأس (1,6)");
  assert.equal(Q.wLines("$F(1, \frac{37}{4})$"), "F(1, \frac{37}{4})");
  assert.equal(Q.wLines("$x=1, y$"), "x=1, y", "قطعة بلا = ترجع ويا اللي قبلها");
  assert.equal(Q.wLines(""), "");
});

test("🎨 الورقة كلها بلون واحد: اللون اللي كاتب بيه أكثر شي، حتى لو قسم من خطه بلون ثاني، والمطبوع هم (طلبه 2026-11-24)", () => {
  const box = { w: 480, h: 360, s: [[1, 1, 9, 9]] };
  const ink = [
    { id: 1, kind: "cross" as const, text: "✗", c: "#d40000", ...box }, { id: 2, kind: "cross" as const, text: "✗", c: "#d40000", ...box },
    { id: 3, kind: "ask" as const, text: "؟", c: "#7e22ce", ...box },
  ];
  const q = { n: 1, max: 10, score: 0, answered: true, sure: true, reason: "", method: 1, at: { p: 1, x: 500, y: 600 }, steps: [
    { text: "أ", points: 5, awarded: 0, note: "غلط", w: "x=1", at: { p: 1, x: 400, y: 200 } },
    { text: "ب", points: 3, awarded: 0, note: "ما كتبتها" }, { text: "ج", points: 2, awarded: 0, note: "ما كتبتها" }] };
  const marks = Q.marksByPage([q], ["a"], undefined, [], ink)[0].marks;
  const colors = marks.flatMap((m) => [m.sym?.c, m.hand?.c, m.word?.c]).filter(Boolean);
  assert.ok(colors.length >= 2);
  assert.deepEqual([...new Set(colors)], ["#d40000"], "البنفسجي صار أحمر مثل الباقي");
  assert.ok(marks.every((m) => !m.col), "الأحمر هو الأصل");
  // أكثر خطه بنفسجي: الورقة كلها بنفسجي، والمطبوع هم
  const purple = ink.map((x) => ({ ...x, c: x.id === 1 ? "#d40000" : "#7e22ce" }));
  const pm = Q.marksByPage([q], ["a"], undefined, [], purple)[0].marks;
  assert.ok(pm.every((m) => m.col === "#7e22ce" && (!m.sym || m.sym.c === "#7e22ce")));
});
