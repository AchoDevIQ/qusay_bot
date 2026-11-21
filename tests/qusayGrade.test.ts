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
  const p = init?.body instanceof FormData ? {} : JSON.parse(init?.body ?? "{}");
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
  // الخطوة ما تعدي درجتها، والدرجة من الخطوات مو من رقم الذكاء، وتتقرب لنص درجة
  assert.deepEqual(res!.qs.map((q) => q.score), [60, 25.5]);
  assert.equal(res!.total, 85.5);
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
  assert.deepEqual([e.trials, e.gap, e.close], [1, 15.5, 0]);
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
  assert.equal(res!.total, 85.5);
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
  assert.equal(it!.total, 85.5);
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
  assert.deepEqual([done!.grader_id, done!.total], [QUSAY_GRADER, 85.5]);
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
  assert.equal(it!.total, 85.5);
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
  assert.equal(it!.total, 85.5);
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
  assert.equal(total, 85.5);
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
  assert.equal((await Q.qgResultOf(id))!.total, 85.5);
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
  assert.deepEqual(m1[0].marks.map((m: any) => [m.kind, m.text]), [["half", "10"]], "بس الغلط والناقص ينرسم، ودرجة السؤال ما تنكتب على الورقة");
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
});

test("🖍 العلامات شغالة: كل ورقة يصححها تنحفظ بأماكنها والطالب الحقيقي يشوفها", async () => {
  const { myPaper } = await import("../lib/examRoom.ts");
  await Q.saveQgSettings({ marks: true });
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
});

test("🖍 العلامة ما تطلع برة الصورة", () => {
  const q = { n: 1, max: 10, score: 5, answered: true, sure: true, reason: "", method: 1, steps: [{ text: "أ", points: 5, awarded: 5, note: "", at: { p: 1, x: 1000, y: 0 } }, { text: "ب", points: 5, awarded: 0, note: "غلط", at: { p: 1, x: 0, y: 1000 } }] };
  const [pg] = Q.marksByPage([q], ["a"]);
  assert.deepEqual(pg.marks.map((m) => [m.x, m.y]), [[50, 965]], "الصح ما ينرسم، والعلامة جوة الصورة");
  // السؤال الصح كله: ✓ وحدة و«أحسنت» بآخر خطوة
  const good = { ...q, score: 10, steps: q.steps.map((st) => ({ ...st, awarded: 5 })) };
  const [g] = Q.marksByPage([good], ["a"]);
  assert.deepEqual(g.marks.map((m) => [m.kind, m.text, m.x, m.y]), [["good", "أحسنت", 50, 965]]);
  // الطالب ما كتب الخطوات (مثل س5: 3 من 15): ✗ وملاحظاتها بآخر جوابه
  const miss = { n: 5, max: 15, score: 3, answered: true, sure: true, reason: "ناقص", method: 1, at: { p: 1, x: 600, y: 700 },
    steps: [{ text: "أ", points: 5, awarded: 3, note: "", at: undefined }, { text: "ب", points: 10, awarded: 0, note: "ما كملت الحل" }] };
  const [m5] = Q.marksByPage([miss], ["a"]);
  assert.deepEqual(m5.marks.map((m) => [m.kind, m.x, m.y, m.note]), [["bad", 600, 700, "ما كملت الحل"]]);
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
