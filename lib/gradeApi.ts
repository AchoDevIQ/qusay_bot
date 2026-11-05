// صفحة التصحيح: أول مصحح يفتح الورقة تصير إله، يضغط درجة كل سؤال، والبوت يجمع ويبلغ الطالب وولي أمره
import { find, insert, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { guardianOf, logActivity } from "./access.ts";
import { isAdmin, staffName, student } from "./data.ts";
import { send } from "./telegram.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

export const GRADE_PERM = "grade";
const TEST_PAPERS = 5;
const isTest = (it: Row) => it.user_id < 0;
const MAX_INK = 400_000;
/** الأخطاء الشائعة: تعليقات كل مصحح يحفظها حتى يعيدها بضغطة */
const errKey = (uid: number) => `grade_errors_${uid}`;
async function errorsOf(uid: number): Promise<string[]> { try { const j = JSON.parse(await kvGet(errKey(uid)) ?? "[]"); return Array.isArray(j) ? j.map(String) : []; } catch { return []; } }
const nameOf = async (it: Row) => (isTest(it) ? `طالب تجربة ${-it.user_id}` : (await student(it.user_id))?.name ?? "طالب");

async function paperRow(it: Row) {
  const e = await one("bank_exams", { id: it.exam_id });
  const v = it.version_id ? await one("bank_versions", { id: it.version_id }) : null;
  return { id: it.id, name: await nameOf(it), title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", model: v?.model ?? "", submitted: it.submitted_at ?? "", total: it.total ?? null, graded: it.graded_at ?? "", test: isTest(it), grader: it.grader_id ? await staffName(it.grader_id) : "" };
}
async function listData(uid: number) {
  const papers = await find("sched_items", { status: "done" }, { order: ["submitted_at"] });
  const waiting = papers.filter((p) => !p.graded_at && (!p.grader_id || p.grader_id === uid));
  const mine = papers.filter((p) => p.graded_at && (p.grader_id === uid)).slice(-30).reverse();
  return {
    waiting: await Promise.all(waiting.map(paperRow)), done: await Promise.all(mine.map(paperRow)),
    owner: await isAdmin(uid), hasTests: papers.some(isTest), fileToken: fileToken(uid),
    errors: await errorsOf(uid),
    today: papers.filter((p) => p.grader_id === uid && String(p.graded_at ?? "").startsWith(stamp().slice(0, 10))).length,
  };
}
async function paperView(it: Row) {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
  const v = await one("bank_versions", { id: it.version_id });
  const ink: Record<number, string> = {};
  for (const r of await find("paper_ink", { item_id: it.id })) ink[r.page] = r.ink;
  return {
    ink,
    ...await paperRow(it), answerPdf: v?.answer_pdf ?? null,
    whole: answers.filter((a) => !a.q).map((a) => a.file),
    questions: qs.map((q) => ({ n: q.n, max: q.max_mark, image: q.q_file, answers: answers.filter((a) => a.q === q.n).map((a) => a.file), mark: marks.get(q.n) ?? null })),
  };
}
/** الورقة لازم تكون لهذا المصحح، حتى ما يكتب اثنين على نفس الورقة */
async function myPaper(uid: number, raw: unknown) {
  const it = await one("sched_items", { id: Number(raw) });
  need(it?.status === "done", "الورقة غير موجودة");
  need(it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
  return it!;
}
/** أوراق تجربة بدون طلاب حقيقيين: الجواب صورة السؤال نفسه، حتى تنجرب الشاشة وما توصل رسالة لأحد */
async function makeTests() {
  // عشوائية: كل مرة امتحانات مختلفة، ونسخة وحدة من كل امتحان
  // الأفضل نسخ عدها ملف حلول، حتى تبين الورقة مثل ورقة طالب حل
  const versions = (await find("bank_versions", { kind: "mandatory", ok: 1 })).map((v) => ({ v, r: Math.random() - (v.answer_pdf ? 1 : 0) })).sort((a, b) => a.r - b.r).map((x) => x.v);
  const seen = new Set<number>();
  const last = Math.min(0, ...(await find("sched_items", { status: "done" })).filter(isTest).map((i) => i.user_id));
  let made = 0;
  for (const v of versions) {
    if (made >= TEST_PAPERS) break;
    if (seen.has(v.exam_id)) continue;
    seen.add(v.exam_id);
    const qs = await find("bank_questions", { version_id: v.id }, { order: ["n"] });
    if (!qs.length || !qs.every((q) => q.q_file)) continue;
    const id = await insert("sched_items", { user_id: last - made - 1, exam_id: v.exam_id, at: stamp(), status: "done", version_id: v.id, started_at: stamp(), submitted_at: stamp() });
    if (v.answer_pdf) await insert("exam_answers", { item_id: id, q: 0, file: v.answer_pdf, created: stamp() });
    else for (const q of qs) await insert("exam_answers", { item_id: id, q: q.n, file: q.q_file, created: stamp() });
    made++;
  }
  return made;
}
async function deleteTests() {
  for (const it of (await find("sched_items", { status: "done" })).filter(isTest)) {
    await remove("exam_answers", { item_id: it.id });
    await remove("question_marks", { item_id: it.id });
    await remove("paper_ink", { item_id: it.id });
    await remove("sched_items", { id: it.id });
  }
}

export async function gradeAction(body: Row) {
  const uid = await authed(body?.initData, GRADE_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  let paper: Row | null = null;
  if (a === "ink") {
    // رسم القلم على صفحة وحدة: ينحفظ وحده أثناء التصحيح، فيرجع بسرعة بدون القائمة
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    const page = Number(body.page);
    need(Number.isInteger(page) && page >= 0 && page < 500, "صفحة غير معروفة");
    const ink = String(body.ink ?? "");
    need(ink.length <= MAX_INK, "الرسم كبير هواية على هذي الصفحة");
    try { need(Array.isArray(JSON.parse(ink || "[]").items ?? []), "رسم غير مفهوم"); } catch { need(false, "رسم غير مفهوم"); }
    await put("paper_ink", { item_id: it.id, page, ink });
    return { ok: true };
  }
  if (a === "saveError" || a === "delError") {
    const text = String(body.text ?? "").trim().slice(0, 300);
    need(text, "اكتب التعليق");
    const list = (await errorsOf(uid)).filter((x) => x !== text);
    if (a === "saveError") list.unshift(text);
    await kvSet(errKey(uid), JSON.stringify(list.slice(0, 100)));
    return { ...await listData(uid), paper: null, notice: a === "saveError" ? "✅ انحفظ بالأخطاء الشائعة" : "" };
  }
  if (a === "open") {
    const it = await one("sched_items", { id: Number(body.id) });
    need(it?.status === "done", "الورقة غير موجودة");
    need(!it!.grader_id || it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
    if (!it!.grader_id) await update("sched_items", { id: it!.id }, { grader_id: uid });
    paper = await paperView((await one("sched_items", { id: it!.id }))!);
  } else if (a === "mark") {
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    const q = await one("bank_questions", { version_id: it.version_id, n: Number(body.q) });
    need(q, "السؤال غير موجود");
    const mark = Number(body.mark);
    need(Number.isInteger(mark) && mark >= 0 && mark <= q!.max_mark, `الدرجة من 0 إلى ${q!.max_mark}، رقم كامل`);
    await put("question_marks", { item_id: it.id, q: q!.n, mark });
    paper = await paperView(it);
  } else if (a === "release") {
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    await remove("question_marks", { item_id: it.id });
    await remove("paper_ink", { item_id: it.id });
    await update("sched_items", { id: it.id }, { grader_id: null });
    notice = "↩️ رجعت الورقة للقائمة";
  } else if (a === "finish") {
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    const view = await paperView(it);
    const left = view.questions.filter((q) => q.mark === null).map((q) => q.n);
    need(!left.length, `باقي درجة الأسئلة: ${left.join("، ")}`);
    const total = view.questions.reduce((s, q) => s + (q.mark as number), 0);
    await update("sched_items", { id: it.id }, { total, graded_at: stamp() });
    if (!isTest(it)) {
      const text = `📝 <b>انصحح امتحان ${view.title}</b>\nالدرجة: <b>${total}</b> من 100`;
      await send(it.user_id, text);
      const g = await guardianOf(it.user_id);
      if (g) await send(g.guardian_id, `${text}\nالطالب: ${view.name}`);
      await logActivity(it.user_id, `📝 انصحح امتحان ${view.title}: ${total} من 100`);
    }
    notice = `✅ انحفظت الدرجة ${total} من 100`;
  } else if (a === "makeTests" || a === "deleteTests") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    if (a === "makeTests") {
      const made = await makeTests();
      need(made, "ماكو نسخة إجبارية جاهزة بيها صور أسئلة");
      notice = `🧪 انضافت ${made} أوراق تجربة`;
    } else {
      await deleteTests();
      notice = "🗑 انمسحت أوراق التجربة";
    }
  } else need(a === "list", "أمر غير معروف");
  return { ...await listData(uid), paper, notice };
}
export const waitingPapers = async (uid: number) => (await find("sched_items", { status: "done" })).filter((p) => !p.graded_at && (!p.grader_id || p.grader_id === uid)).length;
