// صفحة نظام التصحيح AI: صاحب البوت يشغله ويطفيه، يختار المواضيع اللي يصححها بكل فصل،
// ومنو توصله الأوراق اللي مو متأكد منها، ويحفظ خطوات حل كل سؤال، ويشوف سجله وفلوسه
import { ADMIN_IDS } from "./config.ts";
import { count, find, one, type Row } from "./db.ts";
import { AI_GRADER, isAdmin, staffIds, staffName } from "./data.ts";
import { aiLinked, aiLog, aiOn, aiPending, aiSettings, clearRubric, costOf, draftExam, draftQueueState, draftRubric, queueDrafts, prices, rubricOf, saveRubric, setAiOn, setChapterScope, setPrice, tryGrade } from "./aiGrade.ts";
import { EXAM_PERM } from "./examBank.ts";
import { stamp } from "./util.ts";
import { ApiError, authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

const LOG_SHOW = 60;
const round = (n: number) => Math.round(n * 10000) / 10000;

async function listData(uid: number) {
  const exams = await find("bank_exams", {}, { order: ["slug"] });
  const versions = await find("bank_versions", {}, { order: ["model"] });
  const questions = await find("bank_questions", {}, { order: ["n"] });
  const s = await aiSettings();
  const scope = new Set(s.exams);
  let ready = 0;
  const qOf = new Map<number, Row[]>();
  // كل الخطوات سوية مو وحدة وحدة، حتى الصفحة تفتح بسرعة
  const allSteps = await Promise.all(questions.map((q) => rubricOf(q.id)));
  questions.forEach((q, i) => {
    const steps = allSteps[i];
    if (steps) ready++;
    qOf.set(q.version_id, [...(qOf.get(q.version_id) ?? []), { id: q.id, n: q.n, max: q.max_mark, q: q.q_file, a: JSON.parse(q.a_files || "[]"), steps }]);
  });
  const chapters: Row[] = [];
  for (const e of exams.sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord))) {
    let c = chapters.find((x) => x.slug === e.slug);
    if (!c) { c = { slug: e.slug, chapter: e.chapter, grader: s.unsure[e.slug] ?? 0, exams: [] }; chapters.push(c); }
    const vs = versions.filter((v) => v.exam_id === e.id).map((v) => ({ id: v.id, model: v.model, kind: v.kind, questions: qOf.get(v.id) ?? [] }));
    c.exams.push({ id: e.id, title: e.title, on: scope.has(e.id), versions: vs, ready: vs.length > 0 && vs.every((v) => v.questions.length && v.questions.every((q: Row) => q.steps)) });
  }
  const graders = await Promise.all((await staffIds("grade")).map(async (id) => ({ id, name: ADMIN_IDS.includes(id) ? "إنت (صاحب البوت)" : await staffName(id) })));
  // السجل والفلوس: كل ورقة وكلفتها، ومجموع اليوم والشهر والكل
  const p = await prices();
  const log = await aiLog();
  const today = stamp().slice(0, 10), month = today.slice(0, 7);
  const sum = (rows: typeof log) => ({ sent: rows.filter((r) => r.kind === "sent").length, unsure: rows.filter((r) => r.kind === "unsure").length, cost: round(rows.reduce((t, r) => t + costOf(r.usage, p), 0)) });
  const models = [...new Set([...Object.keys(p), ...log.flatMap((r) => r.usage.map((u) => u.model))])];
  const toName = new Map(graders.map((g) => [g.id, g.name]));
  return {
    on: await aiOn(), linked: aiLinked(), draftQueue: await draftQueueState(), pending: await aiPending(async (it) => (await one("students", { user_id: it.user_id }))?.name ?? `طالب ${it.user_id}`, staffName), ready, total: await count("bank_questions"), chapters, graders, fileToken: fileToken(uid),
    graded: (await find("sched_items", { grader_id: AI_GRADER })).filter((x) => x.graded_at).length,
    money: { today: sum(log.filter((r) => r.at.startsWith(today))), month: sum(log.filter((r) => r.at.startsWith(month))), all: sum(log) },
    prices: models.map((m) => ({ model: m, in: p[m]?.in ?? 0, out: p[m]?.out ?? 0, missing: !p[m] })),
    log: log.slice(-LOG_SHOW).reverse().map((r) => ({ ...r, cost: round(costOf(r.usage, p)), toName: r.to ? toName.get(r.to) ?? "مصحح" : "", usage: undefined })),
  };
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
    return { ...await listData(uid), notice: body.on ? "🤖 نظام التصحيح AI شغال" : "نظام التصحيح AI طافي" };
  }
  if (a === "scope") {
    need(typeof body.slug === "string" && body.slug, "اختار الفصل");
    const grader = Number(body.grader) || 0;
    need(!grader || (await staffIds("grade")).includes(grader), "هذا الشخص ما عنده صلاحية التصحيح");
    await setChapterScope(body.slug as string, Array.isArray(body.exams) ? body.exams : [], grader);
    return { ...await listData(uid), notice: "✅ انحفظ" };
  }
  if (a === "price") {
    need(typeof body.model === "string" && body.model, "اسم الموديل");
    await setPrice(body.model as string, { in: Number(body.in), out: Number(body.out) });
    return { ...await listData(uid), notice: "✅ انحفظ السعر" };
  }
  if (a === "draft") {
    need(aiLinked(), "خدمة التصحيح مو مربوطة بعد بالسيرفر");
    const steps = await draftRubric(id).catch(fail);
    return { ...await listData(uid), draft: { id, steps }, notice: "راجع الخطوات ودرجاتها، وبعدين دوس حفظ" };
  }
  if (a === "draftChapter") {
    need(aiLinked(), "خدمة التصحيح مو مربوطة بعد بالسيرفر");
    const ids = (Array.isArray(body.exams) ? body.exams : []).map(Number).filter(Boolean);
    need(ids.length, "أشّر موضوع واحد على الأقل");
    const r = await queueDrafts(ids);
    return { ...await listData(uid), notice: r.added ? `⏳ انحطت ${r.added} سؤال بالدور. كل دقيقة يطلّع ويحفظ خطوات 8 أسئلة، وتگدر تسكر الصفحة${r.noSol ? ` · ${r.noSol} سؤال بدون صورة حل` : ""}` : `ماكو سؤال يحتاج خطوات بالمواضيع المأشرة${r.noSol ? ` · ${r.noSol} سؤال بدون صورة حل` : ""}` };
  }
  if (a === "draftAll") {
    need(aiLinked(), "خدمة التصحيح مو مربوطة بعد بالسيرفر");
    const r = await draftExam(id, uid);
    const parts = [r.done ? `✅ انحفظت خطوات ${r.done} سؤال من الحل النموذجي بدرجاته` : "ماكو سؤال جديد يحتاج خطوات"];
    if (r.failed.length) parts.push(`⚠️ ما طلعت: ${r.failed.join("، ")}. دوس الزر مرة ثانية`);
    if (r.noSol) parts.push(`${r.noSol} سؤال بدون صورة حل`);
    return { ...await listData(uid), notice: parts.join(" · ") };
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

const TRY_MAX_PICS = 6, TRY_MAX_BYTES = 12 * 1024 * 1024;
/** «🧪 جرّب على جواب حقيقي»: صور جواب سؤال واحد، والنتيجة ترجع للصفحة بس */
export async function aiGradeUpload(form: FormData) {
  const uid = await authed(form.get("initData"), EXAM_PERM);
  need(await isAdmin(uid), "هاي الصفحة لصاحب البوت بس", 403);
  need(form.get("action") === "try", "أمر غير معروف");
  need(aiLinked(), "خدمة التصحيح مو مربوطة بعد بالسيرفر");
  const id = Number(form.get("id"));
  const pics = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
  need(pics.length, "اختار صورة الجواب");
  need(pics.length <= TRY_MAX_PICS, `أكثر شي ${TRY_MAX_PICS} صور`);
  need(pics.every((f) => f.size <= TRY_MAX_BYTES), "صورة كبيرة هواية");
  const imgs = await Promise.all(pics.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const result = await tryGrade(id, imgs).catch((e: unknown): never => { throw e instanceof ApiError ? e : new ApiError(400, e instanceof Error ? e.message : String(e)); });
  return { ...await listData(uid), trial: { id, result }, notice: "🧪 خلص التصحيح. قارنه بتصحيحك" };
}
