// صفحة التصحيح: أول مصحح يفتح الورقة تصير إله، يضغط درجة كل سؤال، والبوت يجمع ويبلغ الطالب وولي أمره
import path from "node:path";
import { find, insert, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { guardianOf, logActivity } from "./access.ts";
import { isAdmin, staffName, student } from "./data.ts";
import { send, sendAlbum, upload } from "./telegram.ts";
import { pickComment } from "./commentsApi.ts";
import { canHandle, objectButton, openObjections, testObjection } from "./objections.ts";
import { chaptersOf, payAction, payData } from "./graderPay.ts";
import { files } from "./files.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

export const GRADE_PERM = "grade";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return { id: it.id, exam: it.exam_id, optional: it.kind === "optional", name: await nameOf(it), title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", model: v?.model ?? "", submitted: it.submitted_at ?? "", total: it.total ?? null, graded: it.graded_at ?? "", test: isTest(it), grader: it.grader_id ? await staffName(it.grader_id) : "" };
}
/** الأوراق اللي يگدر يصححها: ما انصححت، وما أخذها غيره، ومن فصوله */
async function waitingFor(uid: number, papers: Row[]) {
  const mine = await chaptersOf(uid);
  const chapter = new Map((await find("bank_exams")).map((e) => [e.id, e.chapter]));
  return papers.filter((p) => !p.graded_at && (!p.grader_id || p.grader_id === uid) && (!mine.length || mine.includes(chapter.get(p.exam_id))));
}
/** الامتحانات اللي بيها أوراق تنتظر: المصحح يختار امتحان، مو طالب */
async function examGroups(waiting: Row[]) {
  const exams = new Map((await find("bank_exams")).map((e) => [e.id, e]));
  const groups = new Map<number, { exam: number; title: string; chapter: string; count: number; tests: number; order: number }>();
  for (const p of waiting) {
    const e = exams.get(p.exam_id);
    const g = groups.get(p.exam_id) ?? { exam: p.exam_id, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", count: 0, tests: 0, order: (e?.pos ?? 0) * 1000 + (e?.ord ?? 0) };
    g.count++; if (isTest(p)) g.tests++;
    groups.set(p.exam_id, g);
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
    errors: await errorsOf(uid),
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
  const st = isTest(it) ? null : await student(it.user_id);
  return { slug: e?.slug ?? "", info: e?.info ?? "", lang: st?.curr === "إنجليزي" ? "en" : "ar", sid: isTest(it) ? 0 : it.user_id };
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
    ink,
    objections: objs.sort((a, b) => a.q - b.q).map((o) => ({ q: o.q, text: o.text ?? "", voice: o.voice ?? null, old: o.old_mark })),
    ...await paperRow(it), answerPdf: v?.answer_pdf ?? null, ...await headerInfo(it),
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
    await remove("objections", { item_id: it.id });
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
    const list = (await errorsOf(uid)).filter((x) => x !== text);
    if (a === "saveError") list.unshift(text);
    await kvSet(errKey(uid), JSON.stringify(list.slice(0, 100)));
    return { ...await listData(uid), paper: null, notice: a === "saveError" ? "✅ انحفظ بالأخطاء الشائعة" : "" };
  }
  if (a === "open") {
    const it = await one("sched_items", { id: Number(body.id) });
    need(it?.status === "done", "الورقة غير موجودة");
    need(!it!.grader_id || it!.grader_id === uid, "هذي الورقة أخذها مصحح ثاني", 409);
    if (!it!.graded_at) need((await waitingFor(uid, [it!])).length, "هذا الفصل مو من فصولك", 403);
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
  } else if (a === "release") {
    const it = await myPaper(uid, body.id);
    need(!it.graded_at, "الورقة مخلصة");
    await remove("question_marks", { item_id: it.id });
    await remove("paper_ink", { item_id: it.id });
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
    const c = await pickComment(isTest(it) ? uid : it.user_id, total, !isTest(it));
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
    return { ...await listData(uid), paper: null, notice: "", history: await historyOf(uid, Number(body.page) || 0) };
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
    : photos.length ? null : await pickComment(isTest(it) ? uid : it.user_id, total, !isTest(it));
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
  if (isTest(it)) {
    // أوراق التجربة: الصور توصل للمصحح نفسه حتى يشوف شنو يوصل للطالب
    if (photos.length) await deliver(uid, `🧪 <b>هيچ توصل للطالب</b>\n${text}`);
  } else {
    await deliver(it.user_id, text);
    await send(it.user_id, "✋ إذا تشوف درجة سؤال مو صحيحة، تگدر تعترض عليها بالكتابة أو بصوتك.", { kb: objectButton(it.user_id, it.id) });
    const g = await guardianOf(it.user_id);
    if (g) await deliver(g.guardian_id, `${text}\nالطالب: ${view.name}`);
    await logActivity(it.user_id, `📝 انصحح امتحان ${view.title}: ${total} من 100`);
  }
  return `✅ انحفظت الدرجة ${total} من 100`;
}

/** الحفظ ويا صور الورقة المصححة اللي ركبتها صفحة التصحيح */
export async function gradeUpload(form: FormData) {
  const uid = await authed(form.get("initData"), GRADE_PERM);
  if (form.get("action") === "message") return await messageStudent(uid, form);
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
  if (isTest(it)) await deliver(uid, `🧪 <b>هيچ يوصل للطالب</b>\n${text}`);
  else {
    await deliver(it.user_id, text);
    const g = accepted ? await guardianOf(it.user_id) : null;
    if (g) await deliver(g.guardian_id, `${text}\nالطالب: ${view.name}`);
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
  const to = isTest(it) ? uid : it.user_id;
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
  if (!isTest(it)) await logActivity(it.user_id, `📩 وصلته رسالة من المصحح بخصوص ${view.title}`);
  return { ok: true, notice: isTest(it) ? "🧪 وصلتك الرسالة إنت لأنها ورقة تجربة" : "✅ وصلت الرسالة للطالب" };
}

export const waitingPapers = async (uid: number) => (await waitingFor(uid, await find("sched_items", { status: "done" }))).length;

const PAGE = 40;
/** سجل التصحيح: المصحح يشوف أوراقه، وصاحب البوت يشوف كل الأوراق ومنو صححها، ويا حالة الاعتراضات */
async function historyOf(uid: number, page: number) {
  const owner = await isAdmin(uid);
  const all = (await find("sched_items", { status: "done" })).filter((p) => p.graded_at && (owner || p.grader_id === uid))
    .sort((a, b) => String(b.graded_at).localeCompare(String(a.graded_at)));
  const rows = all.slice(page * PAGE, page * PAGE + PAGE);
  const objs = await find("objections", {});
  return {
    page, pages: Math.max(1, Math.ceil(all.length / PAGE)), count: all.length, owner,
    rows: await Promise.all(rows.map(async (p) => {
      const mine = objs.filter((o) => o.item_id === p.id);
      return { ...await paperRow(p), objOpen: mine.filter((o) => o.status === "open").length, objOk: mine.filter((o) => o.status === "accepted").length, objNo: mine.filter((o) => o.status === "rejected").length };
    })),
  };
}
