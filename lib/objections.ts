// الاعتراضات: الطالب يعترض على درجة سؤال أو أكثر، بكتابة أو بصوت. الاعتراض يروح لمصحح الورقة،
// وإذا غير الدرجة ينقبل وحده، وإذا ما غيرها لازم يضغط رفض. كل سؤال ينعترض عليه مرة وحدة
import { checkDevice } from "./deviceLock.ts";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ADMIN_IDS } from "./config.ts";
import { find, insert, one, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { can, isAdmin, student } from "./data.ts";
import { files } from "./files.ts";
import { adminPageLink } from "./keyboards.ts";
import { send, type Kb } from "./telegram.ts";
import { stamp } from "./util.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const OBJ_PERM = "objections";
const VOICE_MAX = 20 * 1024 * 1024;
const TEXT_MAX = 1500;
export const AUDIO: Record<string, string> = { ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".webm": "audio/webm" };
export const audioExt = (type: string) => (/mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /mpeg|mp3/.test(type) ? "mp3" : "webm");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** زر الاعتراض اللي يوصل ويا الدرجة: يفتح امتحاناتي على هذا الامتحان */
export const objectButton = (uid: number, item: number): Kb => [[{ text: "✋ اعتراض على الدرجة", web_app: { url: `${adminPageLink("myexams", uid)}&obj=${item}` } }]];

/** منو يگدر يرد على اعتراضات هذي الورقة: مصححها إذا عنده الصلاحية، وصاحب البوت دائماً */
export async function canHandle(uid: number, it: Row) {
  if (await isAdmin(uid)) return true;
  return it.grader_id === uid && await can(uid, OBJ_PERM);
}
export const openObjections = (itemId: number) => find("objections", { item_id: itemId, status: "open" });

const view = (o: Row) => ({ q: o.q, text: o.text ?? "", voice: !!o.voice, status: o.status, old: o.old_mark, mark: o.new_mark, reason: o.reason ?? "", at: o.created });

async function gradedItem(uid: number, raw: unknown) {
  const it = await one("sched_items", { id: Number(raw), user_id: uid });
  need(it, "الامتحان غير موجود");
  need(it!.graded_at, "هذا الامتحان لسه ما انصحح");
  return it!;
}

/** درجات أسئلة الامتحان المصحح، والاعتراضات اللي عليه */
export async function objectionInfo(uid: number, raw: unknown) {
  const it = await gradedItem(uid, raw);
  const e = await one("bank_exams", { id: it.exam_id });
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
  const objs = new Map((await find("objections", { item_id: it.id })).map((o) => [o.q, o]));
  return {
    id: it.id, title: e?.title ?? "امتحان", total: it.total,
    questions: qs.map((q) => ({ n: q.n, max: q.max_mark, mark: marks.get(q.n) ?? 0, obj: objs.has(q.n) ? view(objs.get(q.n)!) : null })),
  };
}

/** الطالب يدز اعتراضه: لكل سؤال يختاره كتابة أو صوت أو الثنين */
export async function submitObjection(form: FormData) {
  await ensure();
  const uid = verifyHomeToken(form.get("token"));
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  await checkDevice(uid!, form.get("device"));
  const it = await gradedItem(uid!, form.get("item"));
  const qs = new Map((await find("bank_questions", { version_id: it.version_id })).map((q) => [q.n as number, q]));
  const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
  const done = new Set((await find("objections", { item_id: it.id })).map((o) => o.q));
  const picked = [...new Set(String(form.get("qs") ?? "").split(",").map(Number).filter(Boolean))];
  need(picked.length, "اختار السؤال اللي تعترض عليه");
  const rows: Row[] = [];
  for (const n of picked) {
    need(qs.has(n), "السؤال غير موجود");
    need(!done.has(n), `اعترضت على السؤال ${n} من قبل`);
    need(Number(marks.get(n) ?? 0) < Number(qs.get(n)!.max_mark), `السؤال ${n} أخذت درجته الكاملة`);
    const text = String(form.get(`text_${n}`) ?? "").trim().slice(0, TEXT_MAX);
    const v = form.get(`voice_${n}`);
    const hasVoice = v instanceof Blob && v.size > 0;
    need(text || hasVoice, `اكتب سبب اعتراضك على السؤال ${n} أو سجله بصوتك`);
    if (hasVoice) need((v as Blob).size <= VOICE_MAX, "التسجيل طويل هواية");
    rows.push({ n, text, voice: hasVoice ? v as Blob : null });
  }
  for (const r of rows) {
    let voice: string | null = null;
    if (r.voice) {
      const ext = audioExt((r.voice as Blob).type || "");
      voice = path.posix.join("objections", String(uid), String(it.id), `q${r.n}_${randomUUID()}.${ext}`);
      await files().write(voice, Buffer.from(await (r.voice as Blob).arrayBuffer()), AUDIO[`.${ext}`]);
    }
    await insert("objections", { item_id: it.id, user_id: uid, q: r.n, text: r.text, voice, status: "open", old_mark: marks.get(r.n) ?? 0, new_mark: null, reason: null, created: stamp(), decided_at: null, decided_by: null });
  }
  const e = await one("bank_exams", { id: it.exam_id });
  const list = rows.map((r) => r.n).join("، ");
  await logActivity(uid!, `✋ اعترض على درجة امتحان ${e?.title ?? ""}: السؤال ${list}`);
  await tellGraders(it, `✋ <b>اعتراض جديد</b>\nالطالب: ${esc((await student(uid!))?.name ?? "")}\nالامتحان: ${esc(e?.title ?? "")}\nعلى السؤال: ${list}`);
  return { obj: await objectionInfo(uid!, it.id), notice: "✅ وصل اعتراضك للمصحح، والرد يوصلك بالبوت" };
}

/** خبر الاعتراض: لصاحب البوت دائماً (صفحة الاعتراضات)، ولمصحح الورقة إذا اختاريته يتابع اعتراضاته */
async function tellGraders(it: Row, text: string) {
  for (const id of new Set(ADMIN_IDS)) await send(id, text, { kb: [[{ text: "✋ افتح الاعتراضات", web_app: { url: adminPageLink("objections") } }]] });
  if (it.grader_id && !ADMIN_IDS.includes(it.grader_id) && await can(it.grader_id, OBJ_PERM) && !await isAdmin(it.grader_id)) {
    await send(it.grader_id, text, { kb: [[{ text: "✍️ افتح الاعتراضات", web_app: { url: adminPageLink("grade") } }]] });
  }
}

/** للتجربة: صاحب البوت يسوي اعتراض على ورقة تجربة مصححة، كأن طالب اعترض */
export async function testObjection(it: Row) {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
  const taken = new Set((await find("objections", { item_id: it.id })).map((o) => o.q));
  const free = qs.filter((q) => !taken.has(q.n)).sort(() => Math.random() - 0.5).slice(0, 2);
  need(free.length, "كل أسئلة هذي الورقة انعترض عليها");
  const texts = ["🧪 اعتراض تجربة: حليت السؤال بطريقة ثانية وجوابي النهائي صحيح.", "🧪 اعتراض تجربة: نسيت أصحح الخطوة الثانية، هي موجودة بالصفحة الثانية."];
  for (const [i, q] of free.entries()) await insert("objections", { item_id: it.id, user_id: it.user_id, q: q.n, text: texts[i], voice: null, status: "open", old_mark: marks.get(q.n) ?? 0, new_mark: null, reason: null, created: stamp(), decided_at: null, decided_by: null });
  return free.length;
}
