// غرفة الامتحان للطالب الإلكتروني: الدخول بوقته، النسخة، صور الأسئلة، ورفع الأجوبة بدون أي كود
import { photosAllowed } from "./inPerson.ts";
import { notifyGraders } from "./graderPay.ts";
import { activeStop, checkStopped } from "./checkpoints.ts";
import { checkDevice, checkPhone } from "./deviceLock.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { find, insert, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { STORE_URL } from "./config.ts";
import { AI_GRADER, can, student } from "./data.ts";
import { files } from "./files.ts";
import { adminPageLink } from "./keyboards.ts";
import { addMinutes, answersClose, itemState, pickMandatory, type SchedSettings } from "./scheduleRules.ts";
import { send, sendMany } from "./telegram.ts";
import { stamp } from "./util.ts";
import { gradedPages } from "./gradeApi.ts";
import { studentPapers } from "./studentPapers.ts";
import { aiPartialOf, aiResultOf, rubricOf } from "./aiGrade.ts";
import { ApiError, ensure, need } from "./webApi.ts";
import { cronKey, verifyHomeToken } from "./webAuth.ts";

export const LATE_TEXT = "فات وقت الدخول لهذا الامتحان. إذا عندك عذر اطلب فتحه من زر «📨 عندي عذر» بجدول امتحاناتك.";
export const CLOSED_TEXT = "انتهى وقت الامتحان المحدد، وأعطيناك وقت إضافي، ولم ترسل الإجابة.";
const MAX_UPLOAD = 15 * 1024 * 1024;

/** آخر وقت لرفع الأجوبة. الاستثناء يبدي من لحظة دخوله، والباقي من موعد الامتحان حتى الكل ينتهي سوية */
export function closeOf(item: Row, minutes: number, s: SchedSettings) {
  return answersClose(item.opened_at ? item.started_at || item.opened_at : item.at, minutes, s.extra);
}
/** يسد الامتحانات اللي انتهى وقتها: اللي دز جواب مخلص، واللي ما دز فايت */
export async function closeFinished(uid: number, s: SchedSettings) {
  const now = stamp();
  for (const it of await find("sched_items", { user_id: uid, status: "started" })) {
    const e = await one("bank_exams", { id: it.exam_id });
    if (now < closeOf(it, e?.minutes ?? 75, s)) continue;
    const sent = (await find("exam_answers", { item_id: it.id })).length > 0;
    await update("sched_items", { id: it.id }, { status: sent ? "done" : "missed", submitted_at: sent ? now : null });
    if (sent) try { await notifyGraders(); } catch (x) { console.error(x); }
  }
  for (const it of await find("sched_items", { user_id: uid, status: "exception" })) {
    if (now >= addMinutes(it.opened_at, s.excWindow)) await update("sched_items", { id: it.id }, { status: "missed" });
  }
}
/** حالة الامتحان بعين الطالب */
export function roomState(it: Row, s: SchedSettings, now = stamp()) {
  if (it.status === "started" || it.status === "exception") return "open";
  if (it.status === "missed") return "missed";
  return itemState(it.status, it.at, s.window, now);
}
export async function versionOf(it: Row, e: Row) {
  const sc = await one("schedules", { user_id: it.user_id });
  let wanted: number | null = null;
  if (sc?.mode === "general") {
    const d = await one("place_dates", { center_id: sc.center_id, exam_id: e.id });
    wanted = JSON.parse(d?.versions || "{}")[String(it.at).slice(11)] ?? null;
  } else wanted = JSON.parse(e.group_versions || "{}").private ?? null;
  return pickMandatory(await find("bank_versions", { exam_id: e.id }) as { id: number; kind: string; ok: unknown }[], wanted);
}
/** صور صفحات نسخة الطالب بمنهجه */
async function pagesOf(e: Row, v: Row, curr: string) {
  const langs = curr === "إنجليزي" ? ["en", "ar"] : ["ar"];
  for (const lang of langs) {
    const custom: string[] = JSON.parse(v["pages_" + lang] || "[]");
    if (custom.length) return custom;
    const dir = `${e.slug}/e${e.ord}/${v.model}/`;
    const re = new RegExp(`student_${lang}_(\\d+)\\.png$`);
    const found = (await files().list(dir)).filter((f) => re.test(f)).sort((a, b) => Number(re.exec(a)![1]) - Number(re.exec(b)![1]));
    if (found.length) return found;
  }
  return [];
}
// القسم: قبل ما تنفتح الأسئلة، الطالب يرتب جملة «أني الطالب (اسمه الرباعي) أقسم بالله أنني لن أغش في هذا الامتحان»
const oathKey = (item: number) => `oath_${item}`;
export const oathSentence = (name: string) => `أني الطالب ${String(name ?? "").replace(/\s+/g, " ").trim()} أقسم بالله أنني لن أغش في هذا الامتحان`;
export async function takeOath(uid: number, id: unknown, s: SchedSettings) {
  const it = await liveRoom(uid, id, s);
  if (!await kvGet(oathKey(it.id))) {
    await kvSet(oathKey(it.id), stamp());
    const e = await one("bank_exams", { id: it.exam_id });
    await logActivity(uid, `🤲 رتب جملة القسم إنه ما غش بامتحان ${e?.title ?? ""}`);
  }
  return await roomView(it, s);
}
async function roomView(it: Row, s: SchedSettings) {
  const e = (await one("bank_exams", { id: it.exam_id }))!;
  const v = (await one("bank_versions", { id: it.version_id }))!;
  const st = await student(it.user_id);
  const qs = await find("bank_questions", { version_id: v.id }, { order: ["n"] });
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  return {
    id: it.id, sid: it.user_id, title: e.title, model: v.model, oath: oathSentence(st?.name ?? ""), sworn: !!await kvGet(oathKey(it.id)), gallery: s.gallery, closeAt: closeOf(it, e.minutes ?? 75, s), now: stamp(), minutes: e.minutes ?? 75, extra: s.extra,
    // صور الأسئلة ما توصل للصفحة أصلاً قبل القسم
    pages: await kvGet(oathKey(it.id)) ? await pagesOf(e, v, st?.curr ?? "") : [],
    questions: qs.map((q) => ({ n: q.n, answers: answers.filter((a) => a.q === q.n).map((a) => ({ id: a.id, file: a.file })) })),
  };
}
async function ownItem(uid: number, id: unknown) {
  const it = await one("sched_items", { id: Number(id), user_id: uid });
  need(it, "الامتحان غير موجود");
  return it!;
}
/** يدخل الطالب: أول مرة تنحدد نسخته ويبدي وقته */
export async function openRoom(uid: number, id: unknown, s: SchedSettings) {
  need((await student(uid))?.exam !== "حضوري" || await photosAllowed(uid), "امتحانك حضوري، ينقدم بالمركز");
  await closeFinished(uid, s);
  let it = await ownItem(uid, id);
  const state = roomState(it, s);
  need(state !== "locked", "الامتحان لسه ما بدا");
  need(state !== "done", "سلمت هذا الامتحان");
  need(state !== "missed", it.started_at ? CLOSED_TEXT : LATE_TEXT);
  if (it.status === "waiting" || it.status === "exception") {
    const e = await one("bank_exams", { id: it.exam_id });
    const version = e ? await versionOf(it, e) : null;
    need(version, "أسئلة هذا الامتحان لسه ما جاهزة. تواصل ويا قصي العميري");
    await update("sched_items", { id: it.id }, { status: "started", version_id: version, started_at: stamp() });
    await logActivity(uid, `📝 دخل امتحان ${e!.title}`);
    it = await ownItem(uid, id);
  }
  return await roomView(it, s);
}
async function liveRoom(uid: number, id: unknown, s: SchedSettings) {
  await closeFinished(uid, s);
  const it = await ownItem(uid, id);
  need(it.status === "started", it.status === "done" ? "سلمت هذا الامتحان" : CLOSED_TEXT, 403);
  return it;
}
export async function deleteAnswer(uid: number, item: unknown, answer: unknown, s: SchedSettings) {
  const it = await liveRoom(uid, item, s);
  await remove("exam_answers", { id: Number(answer), item_id: it.id });
  return await roomView(it, s);
}
export async function submitRoom(uid: number, item: unknown, s: SchedSettings) {
  const it = await liveRoom(uid, item, s);
  need((await find("exam_answers", { item_id: it.id })).length, "ما دزيت ولا جواب");
  await update("sched_items", { id: it.id }, { status: "done", submitted_at: stamp() });
  const e = await one("bank_exams", { id: it.exam_id });
  await logActivity(uid, `✅ سلم امتحان ${e?.title ?? ""}`);
  try { await notifyGraders(); } catch (x) { console.error(x); }
  // أول امتحان: لازم يربط ولي أمره، فتوصله رسالة بزر «حوّل لولي أمرك»
  try { const { guardianOf, sendGuardianAsk } = await import("./access.ts"); if (!await guardianOf(uid)) await sendGuardianAsk(uid); } catch (x) { console.error(x); }
}
const kindOf = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : b.subarray(0, 4).toString("latin1") === "\x89PNG" ? "png" : null);
/** صورة جواب سؤال واحد. الجواب ينحفظ باسم الطالب والامتحان والسؤال تلقائياً */
export async function uploadAnswer(form: FormData, s: SchedSettings) {
  await ensure();
  const uid = verifyHomeToken(form.get("token"));
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  await checkDevice(uid!, form.get("device"));
  await checkPhone(uid!, form.get("pf"));
  await checkStopped(uid!);
  const it = await liveRoom(uid!, form.get("item"), s);
  need(await kvGet(oathKey(it.id)), "رتب جملة القسم أول، وبعدها تنفتح الكاميرا");
  const q = Number(form.get("q"));
  need(await one("bank_questions", { version_id: it.version_id, n: q }), "السؤال غير موجود");
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0 && f.size <= MAX_UPLOAD, "الصورة لازم أصغر من 15 ميگا");
  const buf = Buffer.from(await (f as Blob).arrayBuffer());
  const kind = kindOf(buf);
  need(kind, "لازم صورة");
  const ref = path.posix.join("student_answers", String(uid), String(it.id), `q${q}_${randomUUID()}.${kind}`);
  await files().write(ref, buf, kind === "png" ? "image/png" : "image/jpeg");
  // صورة وحدة لكل سؤال: الجديدة تبدل القديمة
  await remove("exam_answers", { item_id: it.id, q });
  await insert("exam_answers", { item_id: it.id, q, file: ref, created: stamp() });
  return await roomView(it, s);
}
/** صور الأسئلة والأجوبة: بس لصاحب الامتحان، وبس ملفات امتحانه */
export async function roomFile(token: unknown, itemId: unknown, ref: unknown, pf?: unknown, device?: unknown) {
  await ensure();
  const uid = verifyHomeToken(token);
  need(uid !== null, "الرابط انتهى", 401);
  await checkPhone(uid!, pf);
  await checkDevice(uid!, device);
  const it = await one("sched_items", { id: Number(itemId), user_id: uid! });
  need(it?.version_id, "ما عندك صلاحية", 403);
  const e = (await one("bank_exams", { id: it!.exam_id }))!;
  const v = (await one("bank_versions", { id: it!.version_id }))!;
  const st = await student(uid!);
  const allowed = [...await pagesOf(e, v, st?.curr ?? ""), ...(await find("exam_answers", { item_id: it!.id })).map((a) => a.file as string), ...await gradedPages(it!.id), ...(it!.graded_at && v.answer_pdf ? [String(v.answer_pdf)] : [])];
  need(typeof ref === "string" && allowed.includes(ref), "ما عندك صلاحية", 403);
  const body = await files().read(ref as string);
  need(body, "الملف غير موجود", 404);
  return { body: body!, type: /\.png$/i.test(ref as string) ? "image/png" : /\.pdf$/i.test(ref as string) ? "application/pdf" : "image/jpeg" };
}

/** «📂 ورقتي»: كل شي يخص امتحان سلمه الطالب: درجته، درجة كل سؤال، ورقته المصححة (أو جوابه إذا بعده ما انصحح)، والأسئلة */
export async function myPaper(uid: number, itemId: unknown) {
  const it = await one("sched_items", { id: Number(itemId), user_id: uid });
  need(it?.version_id && (it.submitted_at || it.status === "done"), "هذا الامتحان بعده ما مسلم", 404);
  const p = (await studentPapers(uid)).find((x) => x.id === it!.id);
  need(p, "ما لگينا ورقتك", 404);
  const e = (await one("bank_exams", { id: it!.exam_id }))!;
  const v = (await one("bank_versions", { id: it!.version_id }))!;
  return {
    id: p!.id, title: p!.title, chapter: p!.chapter, submitted: p!.submitted, graded: p!.graded, total: p!.total,
    marks: p!.marks, objections: p!.objections, pages: p!.pages, gradedPages: p!.gradedPages,
    questions: await pagesOf(e, v, (await student(uid))?.curr ?? ""),
    // صححها نظام التصحيح AI: الطالب يشوف كل خطوة صح لو غلط وليش
    ai: await aiShown(it!),
    // ملف الحلول الكامل بتقسيم الدرجات: بعد التصحيح بس، سواء صححها نظام التصحيح AI لو مصحح
    solutions: it!.graded_at && v.answer_pdf ? String(v.answer_pdf) : null,
  };
}
/** تصحيح نظام التصحيح AI اللي يشوفه الطالب: كل الورقة إذا هو صححها، أو بس أسئلته إذا حوّل الباقي لمصحح */
async function aiShown(it: Row) {
  if (!it.graded_at) return [];
  const part = await aiPartialOf(it.id);
  if (it.grader_id !== AI_GRADER && !part) return [];
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  const qs = new Map((await find("bank_questions", { version_id: it.version_id })).map((q) => [q.n as number, q.id as number]));
  return await Promise.all(((await aiResultOf(it.id)) ?? []).filter((q) => !part || !part.includes(q.n)).map(async (q) => {
    // عمود الحل النموذجي: خطواتك المحفوظة نفسها (مو صياغة الذكاء بالإنگليزي)
    const mine = qs.has(q.n) ? await rubricOf(qs.get(q.n)!) : null;
    const sameCount = !!mine && mine.length === q.steps.length;
    return {
      n: q.n, score: q.score, max: q.max, note: q.note ?? "",
      photos: answers.filter((a) => a.q === q.n).map((a) => a.file as string),
      steps: q.steps.map((st, i) => ({ status: st.status, awarded: st.awarded, possible: st.possible,
        expected: sameCount ? mine![i].text : st.expected, student: st.student_tex || st.student, reason: st.reason_ar || st.reason_en || st.reason,
        // خطوة ما انقرت: الطالب يشوف رسالة «أرسل صورة ثانية» بدل كتابة ما تنقرا
        failed: !!st.analysis_failed, message: st.student_message ?? "" })),
    };
  }));
}

// ---------- الإدارة
/** فتح امتحان فايت لطالب عنده عذر مقنع */
export async function openException(admin: number, itemId: unknown) {
  need(await can(admin, "exception"), "ما عندك صلاحية الاستثناء", 403);
  const it = await one("sched_items", { id: Number(itemId) });
  need(it?.status === "missed", "هذا الامتحان مو فايت");
  await update("sched_items", { id: it!.id }, { status: "exception", opened_at: stamp(), started_at: null });
  const e = await one("bank_exams", { id: it!.exam_id });
  await logActivity(it!.user_id, `🔓 الإدارة فتحت له امتحان ${e?.title ?? ""} باستثناء`);
  await send(it!.user_id, `🔓 <b>انفتح إلك امتحان ${e?.title ?? ""}</b>. ادخل عليه هسه من امتحاناتي.`, { kb: roomButton(it!.user_id) });
}
const roomButton = (uid: number) => (STORE_URL ? [[{ text: "📝 امتحاناتي", web_app: { url: adminPageLink("myexams", uid) } }]] : undefined);

/** للتجربة: صاحب البوت يخلي الامتحان يبدي هسه */
export async function startNowForTest(itemId: unknown) {
  const it = await one("sched_items", { id: Number(itemId) });
  need(it?.status === "waiting", "هذا الامتحان مو بالانتظار");
  await put("sched_items", { ...it!, at: stamp(), notified: "test" });
}

/** رسالة «بدأ الامتحان». يشغلها مؤقت من برا لأن السيرفر ينام: /api/cron?key=... */
export async function notifyStarted(key: unknown, s: SchedSettings, limit = 1200) {
  await ensure();
  if (key !== cronKey()) throw new ApiError(401, "no");
  const now = stamp();
  // ناخذ اللي بدأ وقتهم ونعلّمهم أول، وبعدين ندز بدفعات. إذا هواية (أكثر من limit) الباقي بالدقيقة الجاية
  const due = (await find("sched_items", { status: "waiting", notified: null }))
    .filter((it) => itemState("waiting", it.at, s.window, now) === "open").slice(0, limit);
  const exams = new Map<unknown, Row | null>();
  const jobs: { uid: number; title: string }[] = [];
  for (const it of due) {
    await update("sched_items", { id: it.id }, { notified: now });
    const st = await student(it.user_id);
    if (st?.exam === "حضوري" || await activeStop(it.user_id)) continue;
    if (!exams.has(it.exam_id)) exams.set(it.exam_id, await one("bank_exams", { id: it.exam_id }));
    jobs.push({ uid: it.user_id, title: String(exams.get(it.exam_id)?.title ?? "") });
  }
  const sent = await sendMany(jobs, (j) => send(j.uid, `🟢 <b>بدأ امتحانك: ${j.title}</b>
ادخل عليه خلال ${s.window} دقيقة.`, { kb: roomButton(j.uid) }));
  return { sent, due: jobs.length };
}
