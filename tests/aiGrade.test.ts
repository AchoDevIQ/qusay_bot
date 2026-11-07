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

const { aiGradeTick, saveRubric, rubricOf, setAiOn, aiResultOf } = await import("../lib/aiGrade.ts");
const { finishByAi, gradeAction } = await import("../lib/gradeApi.ts");
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
  ? { score: body.max_points === 60 ? 47.6 : 99, requires_review: false, review_reason: "", student_lines: ["x=2"], steps: [{ status: "correct", awarded: 30, possible: 30, reason: "صح", expected: "", student: "x=2" }] }
  : { steps: [{ text: "a+bi = 1+2i", points: 30 }, { text: "x = 2", points: 30 }] });

test("الخطوات لازم مجموعها يساوي درجة السؤال", async () => {
  await assert.rejects(saveRubric(q1, [{ text: "x=1", points: 10 }], 1), /لازم يساوي درجة السؤال 60/);
  await assert.rejects(saveRubric(q1, [], 1), /خطوة وحدة/);
  await saveRubric(q1, [{ text: "a+bi = 1+2i", points: 20 }, { text: "x=2", points: 40 }], 1);
  assert.equal((await rubricOf(q1))!.length, 2);
});

test("طافي، أو سؤال بدون خطوات: ما يمس الورقة", async () => {
  const p = await paper(90, [1, 2]);
  assert.deepEqual(await aiGradeTick(finishByAi), { off: true });
  await setAiOn(true);
  ai.length = 0;
  assert.deepEqual(await aiGradeTick(finishByAi), { graded: 0, failed: 0 });
  assert.equal(ai.length, 0);
  assert.equal((await one("sched_items", { id: p }))!.grader_id, null);
});

test("يصحح وحده: الدرجة تنحفظ وتوصل للطالب، والسؤال اللي ما جاوبه صفر بدون ما يسأل الخدمة", async () => {
  await saveRubric(q2, [{ text: "y = 1", points: 40 }], 1);
  const p = await paper(90, [1]);
  aiReply = gradeOk;
  ai.length = 0; tg.length = 0;
  const r = await aiGradeTick(finishByAi);
  // الورقة اللي قبل (س1 وس2) وهاي (س1 بس)
  assert.deepEqual(r, { graded: 2, failed: 0 });
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
  assert.equal(await staffName(AI_GRADER), "🤖 المصحح الآلي");
});

test("الخدمة عطلانة: الورقة ترجع للمصححين، وبعد محاولتين يبطل يحاول عليها", async () => {
  const p = await paper(90, [1, 2]);
  aiReply = () => new Response("boom", { status: 500 });
  assert.deepEqual(await aiGradeTick(finishByAi), { graded: 0, failed: 1 });
  let row = (await one("sched_items", { id: p }))!;
  assert.deepEqual([row.grader_id, row.graded_at], [null, null]);
  assert.equal((await find("question_marks", { item_id: p })).length, 0);
  await aiGradeTick(finishByAi);
  ai.length = 0;
  assert.deepEqual(await aiGradeTick(finishByAi), { graded: 0, failed: 0 });
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
