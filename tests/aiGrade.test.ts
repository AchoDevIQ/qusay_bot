// المصحح الآلي: يصحح الورقة وحده بخدمة Math-Grading ويدزها للطالب.
// الخدمة هنا مزيفة: نفحص شنو البوت يدزلها، وشنو يسوي بجوابها
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-ai-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"), GRADING_AI_URL: "https://ai.test/", GRADING_AI_KEY: "secret-k" });
delete process.env.FIREBASE_STORAGE_BUCKET;
fs.mkdirSync(path.join(tmp, "ans"), { recursive: true });
fs.writeFileSync(path.join(tmp, "ans", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
fs.writeFileSync(path.join(tmp, "ans", "sol.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]));

const tg: { method: string; p: any }[] = [];
const ai: { route: string; key: string | null; body: any }[] = [];
let aiReply: (route: string, body: any) => Response = () => Response.json({});
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.startsWith("https://ai.test")) {
    const route = u.slice("https://ai.test".length);
    const body = JSON.parse(init.body);
    ai.push({ route, key: init.headers["X-Bot-Key"] ?? null, body });
    return aiReply(route, body);
  }
  const method = u.split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  tg.push({ method, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { aiGradeTick, saveRubric, rubricOf, setAiOn, aiResultOf, setChapterScope } = await import("../lib/aiGrade.ts");
const { finishByAi, paperName, gradeAction } = await import("../lib/gradeApi.ts");
const tick = () => aiGradeTick(finishByAi, paperName);
const { aiGradeAction } = await import("../lib/aiGradeApi.ts");
const { AI_GRADER, staffName } = await import("../lib/data.ts");
const { initDb, insert, one, find, put } = await import("../lib/db.ts");
const { stamp, todayStr } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};

const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 60, pos: 1 });
const ver = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
const q1 = await insert("bank_questions", { version_id: ver, n: 1, max_mark: 60, q_file: "none/q1.png", a_files: JSON.stringify(["ans/sol.png"]) });
const q2 = await insert("bank_questions", { version_id: ver, n: 2, max_mark: 40, q_file: "none/q2.png", a_files: "[]" });
await put("students", { user_id: 90, name: "طالب أول", exam: "إلكتروني", created: "2026-01-01 00:00" });
await put("staff", { user_id: 41, name: "مصحح", perms: "grade" });
const paper = async (uid: number, qs: number[]) => {
  const id = await insert("sched_items", { user_id: uid, exam_id: ex, at: `${todayStr()} 10:00`, status: "done", version_id: ver, started_at: stamp(), submitted_at: stamp() });
  for (const q of qs) await insert("exam_answers", { item_id: id, q, file: "ans/a.jpg", created: stamp() });
  return id;
};
const gradeOk = (route: string, body: any) => Response.json(route === "/bot/grade"
  ? { score: body.max_points === 60 ? 47.6 : 99, requires_review: false, review_reason: "", student_lines: ["x=2"], steps: [{ status: "correct", awarded: 30, possible: 30, reason: "صح", expected: "", student: "x=2" }], usage: [{ model: "gpt-4o-mini", calls: 2, input: 1_000_000, output: 0 }] }
  : { steps: [{ text: "a+bi = 1+2i", points: 30 }, { text: "x = 2", points: 30 }], usage: [{ model: "gpt-5-mini", calls: 1, input: 0, output: 1_000_000 }] });

test("الخطوات لازم مجموعها يساوي درجة السؤال", async () => {
  await assert.rejects(saveRubric(q1, [{ text: "x=1", points: 10 }], 1), /لازم يساوي درجة السؤال 60/);
  await assert.rejects(saveRubric(q1, [], 1), /خطوة وحدة/);
  await saveRubric(q1, [{ text: "a+bi = 1+2i", points: 20 }, { text: "x=2", points: 40 }], 1);
  assert.equal((await rubricOf(q1))!.length, 2);
});

test("طافي، أو موضوع مو مأشر، أو سؤال بدون خطوات: ما يمس الورقة", async () => {
  const p = await paper(90, [1, 2]);
  assert.deepEqual(await tick(), { off: true });
  await setAiOn(true);
  ai.length = 0;
  assert.deepEqual(await tick(), { graded: 0, unsure: 0, failed: 0 });
  await setChapterScope("c1", [ex], 0);
  assert.deepEqual(await tick(), { graded: 0, unsure: 0, failed: 0 });
  assert.equal(ai.length, 0);
  assert.equal((await one("sched_items", { id: p }))!.grader_id, null);
});

test("يصحح وحده: الدرجة تنحفظ وتوصل للطالب، والسؤال اللي ما جاوبه صفر بدون ما يسأل الخدمة", async () => {
  await saveRubric(q2, [{ text: "y = 1", points: 40 }], 1);
  const p = await paper(90, [1]);
  aiReply = gradeOk;
  ai.length = 0; tg.length = 0;
  const r = await tick();
  // الورقة اللي قبل (س1 وس2) وهاي (س1 بس)
  assert.deepEqual(r, { graded: 2, unsure: 0, failed: 0 });
  assert.ok(ai.every((c) => c.key === "secret-k" && c.route === "/bot/grade"));
  const call = ai.find((c) => c.body.max_points === 60)!;
  assert.deepEqual(call.body.steps.map((s: any) => s.points), [20, 40]);
  assert.equal(call.body.images.length, 1);
  const row = (await one("sched_items", { id: p }))!;
  assert.equal(row.grader_id, AI_GRADER);
  // 47.6 تصير 48، وس2 ما جاوبه فصفر
  assert.equal(row.total, 48);
  const marks = await find("question_marks", { item_id: p });
  assert.deepEqual(marks.map((m) => [m.q, m.mark]).sort(), [[1, 48], [2, 0]]);
  assert.ok(tg.some((c) => c.method === "sendMessage" && String(c.p.chat_id) === "90" && /الدرجة: <b>48<\/b>/.test(c.p.text)));
  assert.equal((await aiResultOf(p))![0].steps[0].reason, "صح");
  assert.equal(await staffName(AI_GRADER), "🤖 نظام التصحيح AI");
});

test("الخدمة عطلانة: الورقة ترجع للمصححين، وبعد محاولتين يبطل يحاول عليها", async () => {
  const p = await paper(90, [1, 2]);
  aiReply = () => new Response("boom", { status: 500 });
  assert.deepEqual(await tick(), { graded: 0, unsure: 0, failed: 1 });
  let row = (await one("sched_items", { id: p }))!;
  assert.deepEqual([row.grader_id, row.graded_at], [null, null]);
  assert.equal((await find("question_marks", { item_id: p })).length, 0);
  await tick();
  ai.length = 0;
  assert.deepEqual(await tick(), { graded: 0, unsure: 0, failed: 0 });
  assert.equal(ai.length, 0);
  // المصحح البشري يشوفها ويگدر ياخذها
  const open = await gradeAction({ initData: sign(41), action: "open", id: p }) as any;
  assert.equal(open.paper.id, p);
  row = (await one("sched_items", { id: p }))!;
  assert.equal(row.grader_id, 41);
});

test("صفحة المصحح الآلي: لصاحب البوت بس، وتطلع الخطوات من صورة الحل بدون ما تحفظها", async () => {
  await assert.rejects(aiGradeAction({ initData: sign(41), action: "list" }), /صلاحية|صاحب البوت/);
  aiReply = gradeOk;
  ai.length = 0;
  const d = await aiGradeAction({ initData: sign(1), action: "draft", id: q1 }) as any;
  assert.equal(ai[0].route, "/bot/rubric");
  assert.equal(ai[0].body.max_points, 60);
  assert.equal(ai[0].body.images.length, 1);
  assert.equal(d.draft.steps.length, 2);
  // ما انحفظت: الخطوات القديمة باقية
  assert.equal((await rubricOf(q1))![0].points, 20);
  const saved = await aiGradeAction({ initData: sign(1), action: "save", id: q1, steps: d.draft.steps }) as any;
  assert.equal(saved.ready, 2);
  await assert.rejects(aiGradeAction({ initData: sign(1), action: "save", id: q1, steps: [{ text: "x", points: 5 }] }), /لازم يساوي/);
  const off = await aiGradeAction({ initData: sign(1), action: "on", on: false }) as any;
  assert.equal(off.on, false);
});

test("ما متأكد: الورقة ما توصل للطالب، تروح للمصحح اللي اختاره صاحب البوت لهذا الفصل وتوصله رسالة", async () => {
  // الفحص اللي قبل طفاه من الصفحة
  await setAiOn(true);
  await setChapterScope("c1", [ex], 41);
  const p = await paper(90, [1, 2]);
  // قبل لا يجربها نظام التصحيح: ما تطلع للمصحح حتى ما ياخذها قبله
  const before = await gradeAction({ initData: sign(41), action: "list" }) as any;
  assert.ok(!JSON.stringify(before.groups).includes(`"id":${p},`));
  assert.equal(before.waiting?.some?.((w: any) => w.id === p) ?? false, false);
  aiReply = (route, body) => body.max_points === 40
    ? Response.json({ score: 10, requires_review: true, review_reason: "الخط ما ينقرا", steps: [], usage: [] })
    : gradeOk(route, body);
  tg.length = 0;
  assert.deepEqual(await tick(), { graded: 0, unsure: 1, failed: 0 });
  const row = (await one("sched_items", { id: p }))!;
  assert.deepEqual([row.grader_id, row.graded_at, row.total], [41, null, null]);
  assert.equal((await find("question_marks", { item_id: p })).length, 0);
  assert.ok(!tg.some((c) => String(c.p.chat_id) === "90"));
  const msg = tg.find((c) => c.method === "sendMessage" && String(c.p.chat_id) === "41")!;
  assert.match(msg.p.text, /حوّلك ورقة/);
  assert.match(msg.p.text, /طالب أول/);
  assert.match(msg.p.text, /: 2$/m);
  // المصحح يفتحها ويشوف شنو انطى نظام التصحيح
  const open = await gradeAction({ initData: sign(41), action: "open", id: p }) as any;
  assert.equal(open.paper.ai.find((q: any) => q.n === 2).review, true);
  // ما يرجع ياخذها
  ai.length = 0;
  await tick();
  assert.equal(ai.length, 0);
});

test("السجل والفلوس: كل ورقة وكلفتها حسب أسعار الموديلات", async () => {
  const d = await aiGradeAction({ initData: sign(1), action: "list" }) as any;
  assert.equal(d.money.all.unsure, 1);
  assert.ok(d.money.all.sent >= 2);
  // ورقة بسؤال واحد جاوبه: مليون توكن داخل بـ gpt-4o-mini = 0.15 دولار
  const one1 = d.log.find((r: any) => r.kind === "sent" && r.total === 48);
  assert.equal(one1.cost, 0.15);
  // خطوات من صورة الحل: مليون توكن طالع بـ gpt-5-mini = 2 دولار
  assert.equal(d.log.find((r: any) => r.kind === "rubric").cost, 2);
  assert.equal(d.log.find((r: any) => r.kind === "unsure").toName, "مصحح");
  const changed = await aiGradeAction({ initData: sign(1), action: "price", model: "gpt-4o-mini", in: 0.3, out: 1 }) as any;
  assert.equal(changed.log.find((r: any) => r.kind === "sent" && r.total === 48).cost, 0.3);
  assert.equal(d.chapters[0].grader, 41);
  assert.equal(d.chapters[0].exams[0].on, true);
  await assert.rejects(aiGradeAction({ initData: sign(1), action: "scope", slug: "c1", exams: [ex], grader: 90 }), /صلاحية التصحيح/);
});

test("صفحة الطلاب: أوراق الطالب ودرجاته وصورها محفوظة يم صاحب البوت", async () => {
  const { studentAction } = await import("../lib/studentApi.ts");
  const r = await studentAction({ initData: sign(1), action: "papers", id: 90 }) as any;
  assert.equal(r.papers.id, 90);
  const graded = r.papers.list.find((p: any) => p.total === 48);
  assert.equal(graded.ai, true);
  assert.equal(graded.grader, "🤖 نظام التصحيح AI");
  assert.deepEqual(graded.marks.map((m: any) => [m.n, m.mark, m.max]), [[1, 48, 60], [2, 0, 40]]);
  // نظام التصحيح ما يرسم على الورقة، فتنعرض صور جوابه
  assert.equal(graded.gradedPages, false);
  assert.deepEqual(graded.pages, ["ans/a.jpg"]);
  assert.ok(r.papers.list.some((p: any) => p.total === null));
  await assert.rejects(studentAction({ initData: sign(41), action: "papers", id: 90 }), /صلاحية/);
});

test("🧪 تجربة على جواب حقيقي: يرجع الدرجة والخطوات بس، ما يحفظ درجة ولا يدز رسالة، والكلفة بالسجل", async () => {
  const { aiGradeUpload } = await import("../lib/aiGradeApi.ts");
  const form = (uid: number, id: number, n = 1) => {
    const f = new FormData();
    f.set("initData", sign(uid)); f.set("action", "try"); f.set("id", String(id));
    for (let i = 0; i < n; i++) f.append("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "a.jpg", { type: "image/jpeg" }));
    return f;
  };
  await assert.rejects(aiGradeUpload(form(41, q1)), (e: any) => e.status === 403);
  await assert.rejects(aiGradeUpload(form(1, q1, 0)), /اختار صورة الجواب/);
  aiReply = gradeOk;
  ai.length = 0; tg.length = 0;
  const marks = (await find("question_marks")).length;
  const r: any = await aiGradeUpload(form(1, q1, 2));
  assert.equal(ai.length, 1);
  assert.equal(ai[0].route, "/bot/grade");
  assert.equal(ai[0].body.images.length, 2);
  assert.equal(ai[0].body.max_points, 60);
  assert.deepEqual([r.trial.id, r.trial.result.score, r.trial.result.max, r.trial.result.review], [q1, 48, 60, false]);
  assert.equal(r.trial.result.steps[0].status, "correct");
  assert.equal(tg.length, 0);
  assert.equal((await find("question_marks")).length, marks);
  assert.ok(r.log.some((x: any) => x.kind === "try" && x.cost > 0));
});

test("ورقة تجربة من صور حقيقية: طالب تجربة 1 يصححها نظام التصحيح AI، وطالب تجربة 2 تروح لصاحب البوت وما يمسها", async () => {
  const { studentUpload } = await import("../lib/studentApi.ts");
  await put("students", { user_id: -1, name: "طالب تجربة 1", exam: "إلكتروني", created: stamp() });
  await put("students", { user_id: -2, name: "طالب تجربة 2", exam: "إلكتروني", created: stamp() });
  const form = (sid: number, who: string) => {
    const f = new FormData();
    f.set("initData", sign(1)); f.set("action", "testPaper"); f.set("sid", String(sid)); f.set("vid", String(ver)); f.set("who", who);
    for (const q of [1, 2]) f.append(`q_${q}`, new File([new Uint8Array([0xff, 0xd8, 0xff, q])], "a.jpg", { type: "image/jpeg" }));
    return f;
  };
  await assert.rejects(studentUpload(form(90, "ai")), /اختار طالب تجربة/);
  await studentUpload(form(-1, "ai"));
  const r: any = await studentUpload(form(-2, "me"));
  assert.match(r.notice, /تنتظرك/);
  const a = (await find("sched_items", { user_id: -1 }))[0], b = (await find("sched_items", { user_id: -2 }))[0];
  assert.equal((await find("exam_answers", { item_id: a.id })).length, 2);
  assert.deepEqual([a.grader_id, b.grader_id], [null, 1]);
  // تعيد الرفع: الورقة القديمة تتبدل
  await studentUpload(form(-1, "ai"));
  assert.equal((await find("sched_items", { user_id: -1 })).length, 1);
  aiReply = gradeOk;
  for (let i = 0; i < 5; i++) await tick();
  const a2 = (await find("sched_items", { user_id: -1 }))[0];
  assert.equal(a2.grader_id, AI_GRADER);
  assert.ok(a2.graded_at);
  const b2 = (await one("sched_items", { id: b.id }))!;
  assert.deepEqual([b2.grader_id, b2.graded_at], [1, null]);
});

test("«طلّع واحفظ خطوات كل أسئلة الموضوع»: كل سؤال بيه صورة حل وما إله خطوات تنحفظ خطواته مباشرة", async () => {
  const e2 = await insert("bank_exams", { slug: "c9", chapter: "الجذور", ord: 1, title: "الجذور التربيعية", minutes: 60, pos: 1 });
  const va = await insert("bank_versions", { exam_id: e2, model: "A", kind: "mandatory", ok: 1 });
  const vb = await insert("bank_versions", { exam_id: e2, model: "B", kind: "mandatory", ok: 1 });
  const qa = await insert("bank_questions", { version_id: va, n: 1, max_mark: 20, q_file: "none/q.png", a_files: JSON.stringify(["ans/sol.png"]) });
  const qb = await insert("bank_questions", { version_id: vb, n: 1, max_mark: 20, q_file: "none/q.png", a_files: JSON.stringify(["ans/sol.png"]) });
  const qn = await insert("bank_questions", { version_id: vb, n: 2, max_mark: 20, q_file: "none/q.png", a_files: "[]" });
  aiReply = (route, body) => Response.json({ steps: [{ text: "x^2 - y^2 = 7", points: body.max_points / 2 }, { text: "x = 4", points: body.max_points / 2 }], usage: [] });
  ai.length = 0;
  const r: any = await aiGradeAction({ initData: sign(1), action: "draftAll", id: e2 });
  assert.equal(ai.filter((x) => x.route === "/bot/rubric").length, 2);
  assert.match(r.notice, /انحفظت خطوات 2 سؤال[\s\S]*1 سؤال بدون صورة حل/);
  assert.equal((await rubricOf(qa))!.length, 2);
  assert.equal((await rubricOf(qb))![1].points, 10);
  assert.equal(await rubricOf(qn), null);
  // مرة ثانية ما يعيد اللي انحفظ
  ai.length = 0;
  await aiGradeAction({ initData: sign(1), action: "draftAll", id: e2 });
  assert.equal(ai.length, 0);
});

test("«خطوات الفصل كله»: المواضيع المأشرة تدخل بالدور، والمؤقت يحفظها 8 بالدقيقة، واللي يفشل مرتين ينكتب", async () => {
  const { draftQueueTick } = await import("../lib/aiGrade.ts");
  const e3 = await insert("bank_exams", { slug: "c8", chapter: "فصل كبير", ord: 1, title: "موضوع 1", minutes: 60, pos: 1 });
  const e4 = await insert("bank_exams", { slug: "c8", chapter: "فصل كبير", ord: 2, title: "موضوع 2", minutes: 60, pos: 2 });
  const v3 = await insert("bank_versions", { exam_id: e3, model: "A", kind: "mandatory", ok: 1 });
  const v4 = await insert("bank_versions", { exam_id: e4, model: "A", kind: "mandatory", ok: 1 });
  const ids: number[] = [];
  for (let n = 1; n <= 10; n++) ids.push(await insert("bank_questions", { version_id: v3, n, max_mark: 10, q_file: "none/q.png", a_files: JSON.stringify(["ans/sol.png"]) }));
  const skip = await insert("bank_questions", { version_id: v4, n: 1, max_mark: 10, q_file: "none/q.png", a_files: JSON.stringify(["ans/sol.png"]) });
  aiReply = (route, body) => Response.json({ steps: [{ text: "x = 1", points: body.max_points }], usage: [] });
  const r: any = await aiGradeAction({ initData: sign(1), action: "draftChapter", exams: [e3] });
  assert.match(r.notice, /انحطت 10 سؤال بالدور/);
  assert.equal(r.draftQueue.left, 10);
  // الخدمة تفشل مرتين: السؤال يرجع لآخر الدور ويكمل
  const realReply = aiReply;
  let calls = 0;
  aiReply = (route, body) => { calls++; return calls === 1 || calls === 10 ? new Response("", { status: 500 }) : realReply(route, body); };
  const t1: any = await draftQueueTick(1);
  assert.equal(t1.done, 7);
  for (let i = 0; i < 4; i++) await draftQueueTick(1);
  const st: any = await aiGradeAction({ initData: sign(1), action: "list" });
  assert.equal(st.draftQueue.left, 0);
  assert.equal(await rubricOf(skip), null);
  const saved = (await Promise.all(ids.map((id) => rubricOf(id)))).filter(Boolean).length;
  assert.ok(saved >= 9, `انحفظ ${saved}`);
});
