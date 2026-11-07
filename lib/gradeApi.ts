// صفحة التصحيح: أول مصحح يفتح الورقة تصير إله، يضغط درجة كل سؤال، والبوت يجمع ويبلغ الطالب وولي أمره
import { runCheckpoints } from "./checkpoints.ts";
import path from "node:path";
import { find, insert, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { guardianOf, logActivity } from "./access.ts";
import { isAdmin, staffName, student } from "./data.ts";
import { send, sendAlbum, upload } from "./telegram.ts";
import { pickComment } from "./commentsApi.ts";
import { canHandle, objectButton, openObjections, testObjection } from "./objections.ts";
import { balanceOf, gradeScope, payAction, payData } from "./graderPay.ts";
import { files } from "./files.ts";
import { rescanPaper } from "./rescan.ts";
import { addVoice, clearPaperVoices, dropFromPaper, dropSaved, examVoices, paperVoices, sendPaperVoices, useVoice } from "./gradeVoices.ts";
import { aiHeld, aiResultOf } from "./aiGrade.ts";
import { stamp, todayStr } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

export const GRADE_PERM = "grade";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isTest = (it: Row) => it.user_id < 0;
const MAX_INK = 400_000;
/** الأخطاء الشائعة: تعليقات كل مصحح يحفظها حتى يعيدها بضغطة */
// الأخطاء الشائعة لكل امتحان (موضوع): كل المصححين يشوفونها من يصححون نفس الامتحان، وما تطلع بامتحان ثاني
const errKey = (examId: number) => `grade_errors_exam_${examId}`;
async function errorsOf(examId: number): Promise<string[]> { try { const j = JSON.parse(await kvGet(errKey(examId)) ?? "[]"); return Array.isArray(j) ? j.map(String) : []; } catch { return []; } }
const nameOf = async (it: Row) => (await student(it.user_id))?.name ?? (isTest(it) ? `طالب تجربة ${-it.user_id}` : "طالب");

async function paperRow(it: Row) {
  const e = await one("bank_exams", { id: it.exam_id });
  const v = it.version_id ? await one("bank_versions", { id: it.version_id }) : null;
  const general = (await one("schedules", { user_id: it.user_id }))?.mode === "general";
  return { id: it.id, exam: it.exam_id, general, optional: it.kind === "optional", name: await nameOf(it), title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", model: v?.model ?? "", submitted: it.submitted_at ?? "", total: it.total ?? null, graded: it.graded_at ?? "", test: isTest(it), grader: it.grader_id ? await staffName(it.grader_id) : "" };
}
/** الأوراق اللي يگدر يصححها: ما انصححت، وما أخذها غيره، ومن فصوله */
async function waitingFor(uid: number, papers: Row[]) {
  const scope = await gradeScope(uid);
  // أوراق ينتظرها نظام التصحيح AI ما تطلع. والورقة اللي حولها لهذا المصحح تطلعله حتى لو مو من فصوله
  const held = await aiHeld(papers);
  return papers.filter((p) => !p.graded_at && !held.has(p.id) && (p.grader_id === uid || (!p.grader_id && scope.can(p))));
}
/** الامتحانات اللي بيها أوراق تنتظر: المصحح يختار امتحان، مو طالب */
async function examGroups(waiting: Row[]) {
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const general = new Set((await find("schedules", { mode: "general" })).map((s) => s.user_id));
  // الجدول العام والخاص كل واحد بروحه، وداخلهم حسب الموضوع حتى يصحح طلاب الموضوع سوا
  const groups = new Map<string, { exam: number; general: boolean; title: string; chapter: string; count: number; tests: number; order: number }>();
  for (const p of waiting) {
    const e = exams.get(p.exam_id), gen = general.has(p.user_id), key = `${p.exam_id}|${gen}`;
    const g = groups.get(key) ?? { exam: p.exam_id, general: gen, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", count: 0, tests: 0, order: (e?.pos ?? 0) * 1000 + (e?.ord ?? 0) };
    g.count++; if (isTest(p)) g.tests++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
async function listData(uid: number) {
  const papers = await find("sched_items", { status: "done" }, { order: ["submitted_at"] });
  const waiting = await waitingFor(uid, papers);
  const mine = papers.filter((p) => p.graded_at && (p.grader_id === uid)).slice(-30).reverse();
  return {
    objections: await objectionPapers(uid),
    groups: await examGroups(waiting),
    waiting: await Promise.all(waiting.map(paperRow)), done: await Promise.all(mine.map(paperRow)),
    owner: await isAdmin(uid), hasTests: papers.some(isTest), fileToken: fileToken(uid),
    stickers: (await find("stickers", {})).sort((a, b) => a.lo - b.lo || a.id - b.id).map((s) => ({ id: s.id, name: s.name, lo: s.lo, hi: s.hi })),
    today: papers.filter((p) => p.grader_id === uid && String(p.graded_at ?? "").startsWith(stamp().slice(0, 10))).length,
  };
}
/** الأوراق اللي عليها اعتراض ينتظر رد هذا المصحح */
async function objectionPapers(uid: number) {
  const byItem = new Map<number, number[]>();
  for (const o of await find("objections", { status: "open" })) byItem.set(o.item_id, [...byItem.get(o.item_id) ?? [], o.q]);
  const out = [];
  for (const [id, qs] of byItem) {
    const it = await one("sched_items", { id });
    if (it && await canHandle(uid, it)) out.push({ ...await paperRow(it), qs: qs.sort((a, b) => a - b) });
  }
  return out;
}
export const objectionsWaiting = async (uid: number) => (await objectionPapers(uid)).length;
/** معلومات هدر الورقة المصححة: الفصل والمنهج */
async function headerInfo(it: Row) {
  const e = await one("bank_exams", { id: it.exam_id });
  const st = await student(it.user_id);
  return { slug: e?.slug ?? "", info: e?.info ?? "", lang: st?.curr === "إنجليزي" ? "en" : "ar", sid: it.user_id };
}
async function paperView(it: Row, withObj = false) {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
  // بالاعتراض: الدرجة اللي غيرها المصحح تبين، وما تنحفظ بالورقة لحد ما يحفظ الرد
  const objs = withObj ? await openObjections(it.id) : [];
  for (const o of objs) if (o.new_mark !== null) marks.set(o.q, o.new_mark);
  const v = await one("bank_versions", { id: it.version_id });
  const ink: Record<number, string> = {};
  for (const r of await find("paper_ink", { item_id: it.id })) ink[r.page] = r.ink;
  return {
    ink, errors: await errorsOf(it.exam_id), ...await voicesOf(it), ai: await aiResultOf(it.id), inPerson: (await student(it.user_id))?.exam === "حضوري",
    objections: objs.sort((a, b) => a.q - b.q).map((o) => ({ q: o.q, text: o.text ?? "", voice: o.voice ?? null, old: o.old_mark })),
    ...await paperRow(it), answerPdf: v?.answer_pdf ?? null, ...await headerInfo(it),
    whole: answers.filter((a) => !a.q).map((a) => a.file),
    questions: qs.map((q) => ({ n: q.n, max: q.max_mark, image: q.q_file, answers: answers.filter((a) => a.q === q.n).map((a) => a.file), mark: marks.get(q.n) ?? null })),
  };
}
const voicesOf = async (it: Row) => ({ voices: (await examVoices(it.exam_id)).map(({ id, name, ref }) => ({ id, name, ref })), myVoices: (await paperVoices(it.id)).map((v) => ({ name: v.name, ref: v.ref })) });
/** الورقة لازم تكون لهذا المصحح، حتى ما يكتب اثنين على نفس الورقة */
async function myPaper(uid: number, raw: unknown) {
  const it = await one("sched_items", { id: Number(raw) });
  need(it?.status === "done", "الورقة غير موجودة");
  need(it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
  return it!;
}
/** ورقة يشتغل عليها: قبل الدرجة لازم تكون لهذا المصحح، وبعدها بس إذا عليها اعتراض ينتظر وهو يگدر يرد عليه */
async function workPaper(uid: number, raw: unknown) {
  const it = await one("sched_items", { id: Number(raw) });
  need(it?.status === "done", "الورقة غير موجودة");
  if (it!.graded_at) {
    need((await openObjections(it!.id)).length, "الورقة مخلصة");
    need(await canHandle(uid, it!), "ما عندك صلاحية على هذي الورقة", 403);
    return { it: it!, obj: true };
  }
  need(it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
  return { it: it!, obj: false };
}
const sumMarks = (qs: { mark: number | null }[]) => qs.reduce((s, q) => s + (q.mark ?? 0), 0);
/** أوراق تجربة بدون طلاب حقيقيين: الجواب صورة السؤال نفسه، حتى تنجرب الشاشة وما توصل رسالة لأحد */
/** طلاب تجربة: 3 طلاب، لكل واحد ورقة مسلمة بكل امتحان جاهز (جوابها الحل النموذجي).
 *  مثل الطلاب الحقيقيين: صاحب البوت يفتح صفحتهم ويعترض كأنه الطالب. أرقامهم سالبة، فما توصلهم رسائل وما تنحسب بالأجور */
export const TEST_STUDENTS = 3;
const TEST_EXAMS = 8;
export async function makeTests() {
  await deleteTests();
  const versions = (await find("bank_versions", { kind: "mandatory", ok: 1 })).sort((x, y) => (y.answer_pdf ? 1 : 0) - (x.answer_pdf ? 1 : 0));
  const picked: Row[] = [];
  for (const v of versions) {
    if (picked.length >= TEST_EXAMS || picked.some((x) => x.exam_id === v.exam_id)) continue;
    const qs = await find("bank_questions", { version_id: v.id });
    if (qs.length && qs.every((q) => q.q_file)) picked.push(v);
  }
  if (!picked.length) return 0;
  let papers = 0;
  for (let k = 1; k <= TEST_STUDENTS; k++) {
    const uid = -k;
    await put("students", { user_id: uid, name: `طالب تجربة ${k}`, curr: "عربي", grade: "السادس العلمي", gov: "بغداد", area: "تجربة", phone1: "", phone2: "", exam: "إلكتروني", created: stamp() });
    for (const v of picked) {
      const id = await insert("sched_items", { user_id: uid, exam_id: v.exam_id, at: stamp(), status: "done", version_id: v.id, started_at: stamp(), submitted_at: stamp() });
      if (v.answer_pdf) await insert("exam_answers", { item_id: id, q: 0, file: v.answer_pdf, created: stamp() });
      else for (const q of await find("bank_questions", { version_id: v.id }, { order: ["n"] })) await insert("exam_answers", { item_id: id, q: q.n, file: q.q_file, created: stamp() });
      papers++;
    }
  }
  return papers;
}
export async function deleteTests() {
  for (const it of (await find("sched_items")).filter(isTest)) {
    await remove("exam_answers", { item_id: it.id });
    await remove("question_marks", { item_id: it.id });
    await remove("paper_ink", { item_id: it.id });
    await remove("objections", { item_id: it.id });
    await remove("sched_items", { id: it.id });
  }
  for (const st of (await find("students")).filter((x) => x.user_id < 0)) await remove("students", { user_id: st.user_id });
}

export async function gradeAction(body: Row) {
  const uid = await authed(body?.initData, GRADE_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  let paper: Row | null = null;
  if (a === "ink") {
    // رسم القلم على صفحة وحدة: ينحفظ وحده أثناء التصحيح، فيرجع بسرعة بدون القائمة
    const { it } = await workPaper(uid, body.id);
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
    const it = await one("sched_items", { id: Number(body.id) });
    need(it?.exam_id, "الورقة غير موجودة");
    const list = (await errorsOf(it!.exam_id)).filter((x) => x !== text);
    if (a === "saveError") list.unshift(text);
    await kvSet(errKey(it!.exam_id), JSON.stringify(list.slice(0, 100)));
    return { ...await listData(uid), paper: null, errors: list.slice(0, 100), notice: a === "saveError" ? "✅ انحفظ بالأخطاء الشائعة" : "" };
  }
  if (a === "voiceUse" || a === "voiceDrop") {
    const { it } = await workPaper(uid, body.id);
    if (a === "voiceUse") await useVoice(it.id, it.exam_id, body.vid); else await dropFromPaper(it.id, body.n);
    return { ok: true, ...await voicesOf(it) };
  }
  if (a === "voiceDel") {
    const it = await one("sched_items", { id: Number(body.id) });
    need(it?.exam_id, "الورقة غير موجودة");
    await dropSaved(it!.exam_id, body.vid);
    return { ok: true, ...await voicesOf(it!) };
  }
  if (a === "open") {
    const it = await one("sched_items", { id: Number(body.id) });
    need(it?.status === "done", "الورقة غير موجودة");
    need(!it!.grader_id || it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
    if (!it!.graded_at) need((await waitingFor(uid, [it!])).length, "هذا الموضوع مو من مواضيعك", 403);
    if (!it!.grader_id) await update("sched_items", { id: it!.id }, { grader_id: uid });
    paper = await paperView((await one("sched_items", { id: it!.id }))!);
  } else if (a === "openObj") {
    const { it, obj } = await workPaper(uid, body.id);
    need(obj, "ماكو اعتراض على هذي الورقة");
    paper = await paperView(it, true);
  } else if (a === "mark") {
    const { it, obj } = await workPaper(uid, body.id);
    const q = await one("bank_questions", { version_id: it.version_id, n: Number(body.q) });
    need(q, "السؤال غير موجود");
    const mark = Number(body.mark);
    need(Number.isInteger(mark) && mark >= 0 && mark <= q!.max_mark, `الدرجة من 0 إلى ${q!.max_mark}، رقم كامل`);
    if (obj) {
      // بالاعتراض تتغير بس درجة السؤال المعترض عليه
      const o = (await openObjections(it.id)).find((x) => x.q === q!.n);
      need(o, "الطالب ما اعترض على هذا السؤال");
      await update("objections", { id: o!.id }, { new_mark: mark });
    } else await put("question_marks", { item_id: it.id, q: q!.n, mark });
    paper = await paperView(it, obj);
  } else if (a === "rescan") {
    // السكنر طلع غلط: الورقة تنمسح وترجع للي رفعها حتى يعيدها
    const it = await myPaper(uid, body.id);
    const n = await rescanPaper(uid, it as never, stamp());
    notice = `🔁 انمسحت ورقة ${await nameOf(it)}، ووصلت رسالة لـ ${n} من اللي يرفعون السكنر حتى يعيدون رفعها`;
  } else if (a === "release") {
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    await remove("question_marks", { item_id: it.id });
    await remove("paper_ink", { item_id: it.id });
    await clearPaperVoices(it.id);
    await update("sched_items", { id: it.id }, { grader_id: null });
    notice = "↩️ رجعت الورقة للقائمة";
  } else if (a === "prepare") {
    // قبل الحفظ: المقولة والملصق حتى الصفحة تركب صورة الغلاف
    const { it, obj } = await workPaper(uid, body.id);
    if (obj) return { total: sumMarks((await paperView(it, true)).questions), comment: "", sticker: 0, sent: 0 };
    const view = await paperView(it);
    const left = view.questions.filter((q) => q.mark === null).map((q) => q.n);
    need(!left.length, `باقي درجة الأسئلة: ${left.join("، ")}`);
    const total = view.questions.reduce((s, q) => s + (q.mark as number), 0);
    const c = await pickComment(it.user_id, total);
    return { total, comment: c?.text ?? "", sticker: c?.sticker?.id ?? 0, sent: c?.id ?? 0 };
  } else if (a === "finish") {
    notice = await finishPaper(uid, body.id, [], Number(body.comment) || 0);
  } else if (a === "decide") {
    notice = await decidePaper(uid, body.id, [], body.rejects);
  } else if (a === "testObj") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const it = await one("sched_items", { id: Number(body.id) });
    need(it && isTest(it) && it.graded_at, "هذا بس لأوراق التجربة المصححة");
    notice = `🧪 انضاف ${await testObjection(it!)} اعتراض تجربة. تلگاه فوك بالاعتراضات`;
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
  } else if (a === "pay") {
    return { ...await listData(uid), paper: null, notice: "", pay: await payData(uid) };
  } else if (a === "setRate" || a === "settle") {
    return { ...await listData(uid), paper: null, notice: await payAction(uid, body), pay: await payData(uid) };
  } else if (a === "history") {
    return { ...await listData(uid), paper: null, notice: "", history: await historyOf(uid, body.day) };
  } else need(a === "list", "أمر غير معروف");
  return { ...await listData(uid), paper, notice };
}
/** حفظ الورقة: المجموع، وتوصل للطالب وولي أمره صور ورقته المصححة ويا المقولة. أوراق التجربة توصل للمصحح نفسه */
async function finishPaper(uid: number, raw: unknown, photos: Buffer[], commentId: number) {
  const it = await myPaper(uid, raw);
  need(!it.graded_at, "الورقة مخلصة");
  const view = await paperView(it);
  const left = view.questions.filter((q) => q.mark === null).map((q) => q.n);
  need(!left.length, `باقي درجة الأسئلة: ${left.join("، ")}`);
  const total = view.questions.reduce((s, q) => s + (q.mark as number), 0);
  await update("sched_items", { id: it.id }, { total, graded_at: stamp() });
  const head = `📝 <b>انصحح امتحان ${view.title}</b>\nالدرجة: <b>${total}</b> من 100`;
  const chosen = commentId ? await one("grade_comments", { id: commentId }) : null;
  const c = chosen ? { text: chosen.text as string, sticker: chosen.sticker_id ? await one("stickers", { id: chosen.sticker_id }) : null }
    : photos.length ? null : await pickComment(it.user_id, total);
  const text = c ? `${head}\n┈┈┈┈┈┈┈┈┈┈┈┈\n💬 «${esc(c.text)}»\n┈┈┈┈┈┈┈┈┈┈┈┈` : head;
  const pic = !photos.length && c?.sticker ? await files().read(c.sticker.file) : null;
  const deliver = async (chat: number, caption: string) => {
    if (photos.length && await sendAlbum(chat, photos, caption)) return;
    if (pic) {
      const gif = /\.gif$/i.test(c!.sticker!.file);
      if (await upload(gif ? "sendAnimation" : "sendPhoto", { chat_id: String(chat), caption, parse_mode: "HTML", protect_content: "true" }, gif ? "animation" : "photo", pic, path.basename(c!.sticker!.file))) return;
    }
    await send(chat, caption);
  };
  {
    await deliver(it.user_id, text);
    await sendPaperVoices(it.user_id, it.id);
    await send(it.user_id, "✋ إذا تشوف درجة سؤال مو صحيحة، تگدر تعترض عليها بالكتابة أو بصوتك.", { kb: objectButton(it.user_id, it.id) });
    const g = await guardianOf(it.user_id);
    if (g) await deliver(g.guardian_id, `${text}\nالطالب: ${view.name}`);
    await logActivity(it.user_id, `📝 انصحح امتحان ${view.title}: ${total} من 100`);
    try { await runCheckpoints(it.user_id); } catch (e) { console.error(e); }
  }
  return `✅ انحفظت الدرجة ${total} من 100`;
}

/** المصحح الآلي يحفظ الورقة مثل أي مصحح: الدرجة والمقولة توصل للطالب وولي أمره */
export const paperName = nameOf;
export const finishByAi = (uid: number, itemId: number) => finishPaper(uid, itemId, [], 0);

/** الحفظ ويا صور الورقة المصححة اللي ركبتها صفحة التصحيح */
export async function gradeUpload(form: FormData) {
  const uid = await authed(form.get("initData"), GRADE_PERM);
  if (form.get("action") === "message") return await messageStudent(uid, form);
  if (form.get("action") === "voice") {
    const { it } = await workPaper(uid, form.get("id"));
    await addVoice(it.id, it.exam_id, form.get("voice"), form.get("name"), form.get("keep") === "1");
    return { ok: true, ...await voicesOf(it) };
  }
  const act = form.get("action");
  need(act === "finish" || act === "decide", "أمر غير معروف");
  const photos: Buffer[] = [];
  for (const f of form.getAll("photo")) {
    need(f instanceof Blob && f.size <= 9_000_000, "صورة كبيرة");
    photos.push(Buffer.from(await (f as Blob).arrayBuffer()));
  }
  need(photos.length <= 40, "صور هواية");
  if (act === "decide") return { ok: true, notice: await decidePaper(uid, form.get("id"), photos, form.get("rejects")) };
  const notice = await finishPaper(uid, form.get("id"), photos, Number(form.get("comment")) || 0);
  return { ok: true, notice };
}

/** رد المصحح على الاعتراض: الدرجة اللي تغيرت تنقبل وحدها، واللي ما تغيرت لازم تنرفض. الطالب يوصله الرد،
 *  وإذا انقبل شي توصله ورقته من جديد ويا ولي أمره */
async function decidePaper(uid: number, raw: unknown, photos: Buffer[], rejectsRaw: unknown) {
  const { it, obj } = await workPaper(uid, raw);
  need(obj, "ماكو اعتراض على هذي الورقة");
  let rejects: Record<string, string> = {};
  try { const j = typeof rejectsRaw === "string" ? JSON.parse(rejectsRaw || "{}") : rejectsRaw ?? {}; if (j && typeof j === "object") rejects = j as Record<string, string>; } catch { /* بدون رفض */ }
  const open = (await openObjections(it.id)).sort((a, b) => a.q - b.q);
  const changed = (o: Row) => o.new_mark !== null && o.new_mark !== o.old_mark;
  const left = open.filter((o) => !changed(o) && !(String(o.q) in rejects)).map((o) => o.q);
  need(!left.length, `غير الدرجة أو ارفض اعتراض السؤال: ${left.join("، ")}`);
  const lines: string[] = [];
  let accepted = 0;
  for (const o of open) {
    if (changed(o)) {
      await put("question_marks", { item_id: it.id, q: o.q, mark: o.new_mark });
      await update("objections", { id: o.id }, { status: "accepted", decided_at: stamp(), decided_by: uid });
      lines.push(`✅ السؤال ${o.q}: انقبل اعتراضك، صارت درجته <b>${o.new_mark}</b> بدل ${o.old_mark}`);
      accepted++;
    } else {
      const reason = String(rejects[String(o.q)] ?? "").trim().slice(0, 500);
      await update("objections", { id: o.id }, { status: "rejected", new_mark: o.old_mark, reason: reason || null, decided_at: stamp(), decided_by: uid });
      lines.push(`❌ السؤال ${o.q}: انرفض اعتراضك وبقت درجته ${o.old_mark}${reason ? `\nالسبب: ${esc(reason)}` : ""}`);
    }
  }
  const total = (await find("question_marks", { item_id: it.id })).reduce((s, m) => s + (m.mark ?? 0), 0);
  await update("sched_items", { id: it.id }, { total });
  const view = await paperRow(it);
  const text = `✋ <b>رد المصحح على اعتراضك</b>\nامتحان: ${esc(view.title)}\n\n${lines.join("\n")}\n\nدرجتك${accepted ? " الجديدة" : ""}: <b>${total}</b> من 100`;
  const deliver = async (chat: number, caption: string) => {
    // تعليق الألبوم أكثر شي 1024 حرف، فالطويل يروح برسالة وراه
    if (accepted && photos.length) {
      const short = caption.length <= 1000;
      if (await sendAlbum(chat, photos, short ? caption : `📝 ورقتك بعد الاعتراض · الدرجة ${total} من 100`)) { if (!short) await send(chat, caption, { extra: { protect_content: true } }); return; }
    }
    await send(chat, caption, { extra: { protect_content: true } });
  };
  {
    await deliver(it.user_id, text);
    // ولي الأمر: الدرجة الجديدة بس، باسم الطالب الرباعي والامتحان، بدون تفاصيل الاعتراض
    const g = accepted ? await guardianOf(it.user_id) : null;
    if (g) await send(g.guardian_id, `📝 <b>تعديل درجة بعد اعتراض</b>\nدرجة الطالب <b>${esc(view.name)}</b> في امتحان <b>${esc(view.title)}</b> صارت <b>${total}</b> من 100.`, { extra: { protect_content: true } });
    await logActivity(it.user_id, `✋ رد المصحح على اعتراضه بامتحان ${view.title}: ${accepted} انقبل، ${open.length - accepted} انرفض. الدرجة ${total}`);
  }
  return `✅ انحفظ الرد: ${accepted} انقبل، ${open.length - accepted} انرفض. الدرجة ${total} من 100`;
}

const VOICE_MAX = 20 * 1024 * 1024;
/** رسالة من المصحح للطالب: كتابة، وتسجيل صوت، وزر يفتح محادثة تلگرام. ورقة التجربة توصل للمصحح نفسه */
async function messageStudent(uid: number, form: FormData) {
  const row = await one("sched_items", { id: Number(form.get("id")) });
  need(row?.status === "done", "الورقة غير موجودة");
  need(row!.grader_id === uid || (row!.graded_at && await canHandle(uid, row!)), "هذي الورقة أخذها مصحح ثاني", 409);
  const it = row!;
  const text = String(form.get("text") ?? "").trim().slice(0, 3000);
  const voice = form.get("voice");
  const hasVoice = voice instanceof Blob && voice.size > 0;
  need(text || hasVoice, "اكتب رسالة أو سجل صوت");
  if (hasVoice) need((voice as Blob).size <= VOICE_MAX, "التسجيل طويل هواية");
  const btnText = String(form.get("btnText") ?? "").trim().slice(0, 40);
  const user = String(form.get("btnUser") ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
  if (btnText || user) need(btnText && /^[A-Za-z0-9_]{4,32}$/.test(user), "الزر يحتاج نص واسم مستخدم تلگرام صحيح");
  const view = await paperRow(it);
  const to = it.user_id;
  const kb = btnText ? { inline_keyboard: [[{ text: btnText, url: `https://t.me/${user}` }]] } : undefined;
  const caption = `📩 <b>رسالة من المصحح</b>\nبخصوص امتحان: ${esc(view.title)}${text ? `\n\n${esc(text)}` : ""}`;
  if (hasVoice) {
    const type = (voice as Blob).type || "";
    // تلگرام يشغلها كرسالة صوتية إذا m4a أو ogg أو mp3، وإلا تنرسل كملف صوت
    const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /mpeg|mp3/.test(type) ? "mp3" : "webm";
    const method = ext === "webm" ? "sendDocument" : "sendVoice";
    const fields: Record<string, string> = { chat_id: String(to), caption, parse_mode: "HTML", protect_content: "true" };
    if (kb) fields.reply_markup = JSON.stringify(kb);
    const ok = await upload(method, fields, method === "sendVoice" ? "voice" : "document", Buffer.from(await (voice as Blob).arrayBuffer()), `voice.${ext}`, type || "audio/ogg");
    need(ok, "ما وصلت الرسالة الصوتية، جرب مرة ثانية");
  } else {
    await send(to, caption, { extra: { protect_content: true, ...(kb ? { reply_markup: kb } : {}) } });
  }
  await logActivity(it.user_id, `📩 وصلته رسالة من المصحح بخصوص ${view.title}`);
  return { ok: true, notice: isTest(it) ? "🧪 وصلت الرسالة إلك إنت، لأنه طالب تجربة" : "✅ وصلت الرسالة للطالب" };
}

export const waitingPapers = async (uid: number) => (await waitingFor(uid, await find("sched_items", { status: "done" }))).length;

/** سجل التصحيح: المصحح يشوف أوراقه، وصاحب البوت يشوف كل الأوراق ومنو صححها، ويا حالة الاعتراضات */
/** السجل يوم يوم: أول ما يفوت أوراق اليوم، وفوك أيام هذا الشهر يرجع بيها. والمصحح يشوف المبلغ اللي إله */
async function historyOf(uid: number, rawDay: unknown) {
  const owner = await isAdmin(uid);
  const today = todayStr();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDay ?? "")) && String(rawDay) <= today ? String(rawDay) : today;
  const mine = (await find("sched_items", { status: "done" })).filter((p) => p.graded_at && (owner || p.grader_id === uid));
  const all = mine.filter((p) => String(p.graded_at).startsWith(day)).sort((a, b) => String(b.graded_at).localeCompare(String(a.graded_at)));
  const rows = all;
  const objs = await find("objections", {});
  const month = day.slice(0, 7);
  const counts = new Map<string, number>();
  for (const p of mine) { const d = String(p.graded_at).slice(0, 10); if (d.startsWith(month)) counts.set(d, (counts.get(d) ?? 0) + 1); }
  // أيام الشهر لحد اليوم (إذا الشهر هو الحالي)، والأشهر اللي قبله تبين كلها
  const last = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(last - i).padStart(2, "0")}`).map((d) => ({ d, n: counts.get(d) ?? 0 }));
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const next = month < today.slice(0, 7) ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7) : "";
  const due = owner ? null : (await balanceOf(uid)).amount;
  return {
    day, days, prev: `${prev}-01`, next: next ? (next === today.slice(0, 7) ? today : `${next}-01`) : "", due,
    page: 0, pages: 1, count: all.length, owner,
    rows: await Promise.all(rows.map(async (p) => {
      const mine = objs.filter((o) => o.item_id === p.id);
      return { ...await paperRow(p), objOpen: mine.filter((o) => o.status === "open").length, objOk: mine.filter((o) => o.status === "accepted").length, objNo: mine.filter((o) => o.status === "rejected").length };
    })),
  };
}
