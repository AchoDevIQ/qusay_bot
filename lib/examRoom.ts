// غرفة الامتحان للطالب الإلكتروني: الدخول بوقته، النسخة، صور الأسئلة، ورفع الأجوبة بدون أي كود
import { randomUUID } from "node:crypto";
import path from "node:path";
import { find, insert, one, put, remove, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { STORE_URL, WEBHOOK_SECRET } from "./config.ts";
import { can, student } from "./data.ts";
import { files } from "./files.ts";
import { adminPageLink } from "./keyboards.ts";
import { addMinutes, answersClose, itemState, pickMandatory, type SchedSettings } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { stamp } from "./util.ts";
import { ApiError, ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const LATE_TEXT = "فات وقت الدخول لهذا الامتحان. إذا عندك عذر تواصل ويا قصي العميري.";
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
async function versionOf(it: Row, e: Row) {
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
async function roomView(it: Row, s: SchedSettings) {
  const e = (await one("bank_exams", { id: it.exam_id }))!;
  const v = (await one("bank_versions", { id: it.version_id }))!;
  const st = await student(it.user_id);
  const qs = await find("bank_questions", { version_id: v.id }, { order: ["n"] });
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  return {
    id: it.id, title: e.title, model: v.model, closeAt: closeOf(it, e.minutes ?? 75, s), now: stamp(), minutes: e.minutes ?? 75, extra: s.extra,
    pages: await pagesOf(e, v, st?.curr ?? ""),
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
  need((await student(uid))?.exam !== "حضوري", "امتحانك حضوري، ينقدم بالمركز");
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
}
const kindOf = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : b.subarray(0, 4).toString("latin1") === "\x89PNG" ? "png" : null);
/** صورة جواب سؤال واحد. الجواب ينحفظ باسم الطالب والامتحان والسؤال تلقائياً */
export async function uploadAnswer(form: FormData, s: SchedSettings) {
  await ensure();
  const uid = verifyHomeToken(form.get("token"));
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  const it = await liveRoom(uid!, form.get("item"), s);
  const q = Number(form.get("q"));
  need(await one("bank_questions", { version_id: it.version_id, n: q }), "السؤال غير موجود");
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0 && f.size <= MAX_UPLOAD, "الصورة لازم أصغر من 15 ميگا");
  const buf = Buffer.from(await (f as Blob).arrayBuffer());
  const kind = kindOf(buf);
  need(kind, "لازم صورة");
  const ref = path.posix.join("student_answers", String(uid), String(it.id), `q${q}_${randomUUID()}.${kind}`);
  await files().write(ref, buf, kind === "png" ? "image/png" : "image/jpeg");
  await insert("exam_answers", { item_id: it.id, q, file: ref, created: stamp() });
  return await roomView(it, s);
}
/** صور الأسئلة والأجوبة: بس لصاحب الامتحان، وبس ملفات امتحانه */
export async function roomFile(token: unknown, itemId: unknown, ref: unknown) {
  await ensure();
  const uid = verifyHomeToken(token);
  need(uid !== null, "الرابط انتهى", 401);
  const it = await one("sched_items", { id: Number(itemId), user_id: uid! });
  need(it?.version_id, "ما عندك صلاحية", 403);
  const e = (await one("bank_exams", { id: it!.exam_id }))!;
  const v = (await one("bank_versions", { id: it!.version_id }))!;
  const st = await student(uid!);
  const allowed = [...await pagesOf(e, v, st?.curr ?? ""), ...(await find("exam_answers", { item_id: it!.id })).map((a) => a.file as string)];
  need(typeof ref === "string" && allowed.includes(ref), "ما عندك صلاحية", 403);
  const body = await files().read(ref as string);
  need(body, "الملف غير موجود", 404);
  return { body: body!, type: /\.png$/i.test(ref as string) ? "image/png" : "image/jpeg" };
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
export async function notifyStarted(key: unknown, s: SchedSettings) {
  await ensure();
  if (!WEBHOOK_SECRET || key !== WEBHOOK_SECRET) throw new ApiError(401, "no");
  const now = stamp();
  let sent = 0;
  for (const it of await find("sched_items", { status: "waiting", notified: null })) {
    if (itemState("waiting", it.at, s.window, now) !== "open") continue;
    const st = await student(it.user_id);
    await update("sched_items", { id: it.id }, { notified: now });
    if (st?.exam === "حضوري") continue;
    const e = await one("bank_exams", { id: it.exam_id });
    await send(it.user_id, `🟢 <b>بدأ امتحانك: ${e?.title ?? ""}</b>\nادخل عليه خلال ${s.window} دقيقة.`, { kb: roomButton(it.user_id) });
    sent++;
  }
  return { sent };
}
