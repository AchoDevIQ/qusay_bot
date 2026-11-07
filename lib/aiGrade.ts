// المصحح الآلي: يصحح الأوراق وحده بخوارزمية Math-Grading (مجلد grading-ai، خدمة Python لحالها).
// كل سؤال يحتاج «خطوات الحل ودرجة كل خطوة» يحفظها صاحب البوت. الورقة اللي ما يگدر عليها
// (سؤال بدون خطوات، جواب ملف كامل، الخدمة عطلانة) تبقى للمصححين مثل قبل.
import { find, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { AI_GRADER } from "./data.ts";
import { files } from "./files.ts";
import { api } from "./telegram.ts";
import { TOKEN } from "./config.ts";

export type RubricStep = { text: string; points: number };
const rubricKey = (qid: number) => `ai_rubric_q_${qid}`;
const resultKey = (itemId: number) => `ai_result_${itemId}`;
const triesKey = (itemId: number) => `ai_try_${itemId}`;
const ON_KEY = "ai_grade_on";
const MAX_TRIES = 2;
const PER_TICK = 3;

const svcUrl = () => (process.env.GRADING_AI_URL ?? "").trim().replace(/\/+$/, "");
const svcKey = () => (process.env.GRADING_AI_KEY ?? "").trim();
/** الخدمة مربوطة: رابطها ومفتاحها بأسرار السيرفر */
export const aiLinked = () => !!svcUrl() && !!svcKey();
export const aiOn = async () => (await kvGet(ON_KEY)) === "1";
export const setAiOn = (on: boolean) => kvSet(ON_KEY, on ? "1" : "0");

export async function rubricOf(qid: number): Promise<RubricStep[] | null> {
  try {
    const j = JSON.parse((await kvGet(rubricKey(qid))) ?? "null");
    return Array.isArray(j?.steps) && j.steps.length ? j.steps : null;
  } catch { return null; }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
export async function saveRubric(qid: number, raw: unknown, by: number) {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const steps: RubricStep[] = (Array.isArray(raw) ? raw : []).map((s: any) => ({ text: String(s?.text ?? "").trim().slice(0, 2000), points: Number(s?.points) }))
    .filter((s) => s.text);
  if (!steps.length) throw new Error("اكتب خطوة وحدة على الأقل");
  if (steps.some((s) => !Number.isFinite(s.points) || s.points < 0)) throw new Error("درجة الخطوة لازم رقم");
  const sum = steps.reduce((t, s) => t + s.points, 0);
  if (!near(sum, Number(q.max_mark))) throw new Error(`مجموع الخطوات ${sum} ولازم يساوي درجة السؤال ${q.max_mark}`);
  await kvSet(rubricKey(qid), JSON.stringify({ steps, at: new Date().toISOString(), by }));
  return steps;
}
export const clearRubric = (qid: number) => kvSet(rubricKey(qid), "null");

/** صورة من مخزن الملفات، أو من تليجرام إذا انرفعت بالمحادثة */
async function readRef(ref: string): Promise<Buffer | null> {
  if (ref.startsWith("tg:")) {
    const info: any = await api("getFile", { file_id: ref.slice(3) });
    if (!info?.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  return await files().read(ref);
}
const isImage = (ref: string) => ref.startsWith("tg:") || /\.(jpe?g|png|webp)$/i.test(ref);

async function svc(route: string, body: object, ms = 120_000): Promise<any> {
  if (!aiLinked()) throw new Error("المصحح الآلي مو مربوط");
  const res = await fetch(svcUrl() + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Key": svcKey() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`خدمة التصحيح ردت ${res.status}`);
  return await res.json();
}

/** يطلع خطوات من صور حل المدرس، وصاحب البوت يعدلها قبل الحفظ */
export async function draftRubric(qid: number): Promise<RubricStep[]> {
  const q = await one("bank_questions", { id: qid });
  if (!q) throw new Error("السؤال غير موجود");
  const refs: string[] = JSON.parse(q.a_files || "[]");
  const imgs = (await Promise.all(refs.filter(isImage).map(readRef))).filter((b): b is Buffer => !!b);
  if (!imgs.length) throw new Error("هذا السؤال ما بيه صورة حل");
  const r = await svc("/bot/rubric", { max_points: Number(q.max_mark), images: imgs.map((b) => b.toString("base64")) });
  return (r.steps ?? []).map((s: any) => ({ text: String(s.text ?? ""), points: Number(s.points) || 0 }));
}

export type AiQuestion = { n: number; score: number; max: number; review: boolean; reason: string; lines: string[]; steps: { status: string; awarded: number; possible: number; reason: string; expected: string; student: string }[] };
export async function aiResultOf(itemId: number): Promise<AiQuestion[] | null> {
  try { const j = JSON.parse((await kvGet(resultKey(itemId))) ?? "null"); return Array.isArray(j) ? j : null; } catch { return null; }
}

/** يصحح ورقة وحدة: يرجع درجة كل سؤال، أو يرمي خطأ إذا ما يگدر */
async function gradePaper(it: Row): Promise<AiQuestion[]> {
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  if (!qs.length) throw new Error("ماكو أسئلة");
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["id"] });
  if (answers.some((a) => !a.q)) throw new Error("الجواب ملف كامل");
  if (answers.some((a) => !isImage(a.file))) throw new Error("الجواب مو صورة");
  return await Promise.all(qs.map(async (q): Promise<AiQuestion> => {
    const steps = await rubricOf(q.id);
    if (!steps) throw new Error(`سؤال ${q.n} بدون خطوات`);
    const max = Number(q.max_mark);
    const mine = answers.filter((a) => a.q === q.n);
    // ما جاوب: صفر بدون ما نسأل الخدمة
    if (!mine.length) return { n: q.n, score: 0, max, review: false, reason: "ما جاوب", lines: [], steps: [] };
    const imgs = await Promise.all(mine.map((a) => readRef(a.file)));
    if (imgs.some((b) => !b)) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
    const r = await svc("/bot/grade", {
      max_points: max,
      steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
      images: imgs.map((b) => b!.toString("base64")),
    });
    const score = Math.max(0, Math.min(max, Math.round(Number(r.score) || 0)));
    return { n: q.n, score, max, review: !!r.requires_review, reason: String(r.review_reason ?? ""), lines: r.student_lines ?? [], steps: r.steps ?? [] };
  }));
}

/** الأوراق اللي يگدر عليها: مسلمة، ما انصححت، ما أخذها مصحح، وكل أسئلتها إلها خطوات */
async function canTake(it: Row) {
  if (it.graded_at || it.grader_id || !it.version_id) return false;
  if ((Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES) return false;
  const qs = await find("bank_questions", { version_id: it.version_id });
  if (!qs.length) return false;
  for (const q of qs) if (!await rubricOf(q.id)) return false;
  return true;
}

/** دكة المؤقت: ياخذ كم ورقة ويصححها ويدزها للطالب. الورقة اللي تفشل ترجع للمصححين */
export async function aiGradeTick(finish: (uid: number, itemId: number) => Promise<unknown>, limit = PER_TICK) {
  if (!aiLinked() || !await aiOn()) return { off: true };
  const picked: Row[] = [];
  for (const it of await find("sched_items", { status: "done" }, { order: ["id"] })) {
    if (picked.length >= limit) break;
    if (!await canTake(it)) continue;
    await update("sched_items", { id: it.id }, { grader_id: AI_GRADER });
    // مصحح أخذها بنفس اللحظة: نتركها إله
    if ((await one("sched_items", { id: it.id }))?.grader_id !== AI_GRADER) continue;
    picked.push(it);
  }
  let graded = 0, failed = 0;
  await Promise.all(picked.map(async (it) => {
    try {
      const res = await gradePaper(it);
      for (const q of res) await put("question_marks", { item_id: it.id, q: q.n, mark: q.score });
      await kvSet(resultKey(it.id), JSON.stringify(res));
      await finish(AI_GRADER, it.id);
      graded++;
    } catch (e) {
      console.error("ai grade", it.id, e);
      failed++;
      await kvSet(triesKey(it.id), String((Number(await kvGet(triesKey(it.id))) || 0) + 1));
      const now = await one("sched_items", { id: it.id });
      if (now && !now.graded_at && now.grader_id === AI_GRADER) {
        await update("sched_items", { id: it.id }, { grader_id: null });
        await remove("question_marks", { item_id: it.id });
      }
    }
  }));
  return { graded, failed };
}
