// صفحة المصحح الآلي: صاحب البوت يشغله ويطفيه، ويحفظ خطوات حل كل سؤال ودرجة كل خطوة
import { count, find, type Row } from "./db.ts";
import { AI_GRADER, isAdmin } from "./data.ts";
import { aiLinked, aiOn, clearRubric, draftRubric, rubricOf, saveRubric, setAiOn } from "./aiGrade.ts";
import { EXAM_PERM } from "./examBank.ts";
import { ApiError, authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

async function listData(uid: number) {
  const exams = await find("bank_exams", {}, { order: ["slug"] });
  const versions = await find("bank_versions", {}, { order: ["model"] });
  const questions = await find("bank_questions", {}, { order: ["n"] });
  let ready = 0;
  const qOf = new Map<number, Row[]>();
  for (const q of questions) {
    const steps = await rubricOf(q.id);
    if (steps) ready++;
    qOf.set(q.version_id, [...(qOf.get(q.version_id) ?? []), { id: q.id, n: q.n, max: q.max_mark, q: q.q_file, a: JSON.parse(q.a_files || "[]"), steps }]);
  }
  const chapters: Row[] = [];
  for (const e of exams.sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord))) {
    let c = chapters.find((x) => x.slug === e.slug);
    if (!c) { c = { slug: e.slug, chapter: e.chapter, exams: [] }; chapters.push(c); }
    const vs = versions.filter((v) => v.exam_id === e.id).map((v) => ({ id: v.id, model: v.model, kind: v.kind, questions: qOf.get(v.id) ?? [] }));
    c.exams.push({ id: e.id, title: e.title, versions: vs, ready: vs.length > 0 && vs.every((v) => v.questions.length && v.questions.every((q: Row) => q.steps)) });
  }
  const graded = (await find("sched_items", { grader_id: AI_GRADER })).filter((p) => p.graded_at).length;
  return { on: await aiOn(), linked: aiLinked(), ready, total: await count("bank_questions"), graded, chapters, fileToken: fileToken(uid) };
}

export async function aiGradeAction(body: Row) {
  const uid = await authed(body?.initData, EXAM_PERM);
  need(await isAdmin(uid), "هاي الصفحة لصاحب البوت بس", 403);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  const fail = (e: unknown): never => { throw e instanceof ApiError ? e : new ApiError(400, e instanceof Error ? e.message : String(e)); };
  if (a === "list") return await listData(uid);
  if (a === "on") {
    need(aiLinked() || !body.on, "خدمة التصحيح مو مربوطة بعد بالسيرفر");
    await setAiOn(!!body.on);
    return { ...await listData(uid), notice: body.on ? "🤖 المصحح الآلي شغال" : "المصحح الآلي طافي" };
  }
  if (a === "draft") {
    need(aiLinked(), "خدمة التصحيح مو مربوطة بعد بالسيرفر");
    const steps = await draftRubric(id).catch(fail);
    return { ...await listData(uid), draft: { id, steps }, notice: "راجع الخطوات ودرجاتها، وبعدين دوس حفظ" };
  }
  if (a === "save") {
    await saveRubric(id, body.steps, uid).catch(fail);
    return { ...await listData(uid), notice: "✅ انحفظت الخطوات" };
  }
  if (a === "clear") {
    await clearRubric(id);
    return { ...await listData(uid), notice: "انمسحت الخطوات. هذا السؤال يصححه المصحح البشري" };
  }
  need(false, "أمر غير معروف");
}
