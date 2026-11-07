// نظام التصحيح AI: يصحح الأوراق وحده بخوارزمية Math-Grading (مجلد grading-ai، خدمة Python لحالها).
// صاحب البوت يختار المواضيع اللي يصححها، وكل سؤال يحتاج «خطوات الحل ودرجة كل خطوة».
// الورقة اللي هو مو متأكد منها تروح للمصحح اللي صاحب البوت اختاره لفصلها، بدون ما توصل للطالب.
// الورقة اللي ما يگدر عليها (سؤال بدون خطوات، جواب ملف كامل، الخدمة عطلانة) تبقى للمصححين مثل قبل.
import { find, kvGet, kvSet, one, put, remove, update, type Row } from "./db.ts";
import { AI_GRADER } from "./data.ts";
import { files } from "./files.ts";
import { api, send } from "./telegram.ts";
import { TOKEN } from "./config.ts";
import { stamp } from "./util.ts";

export type RubricStep = { text: string; points: number };
export type Usage = { model: string; calls: number; input: number; output: number };
export type Price = { in: number; out: number };
/** المواضيع اللي يصححها، ولكل فصل المصحح اللي توصله الأوراق اللي مو متأكد منها */
export type AiSettings = { exams: number[]; unsure: Record<string, number> };
/** سطر بسجل نظام التصحيح: ورقة صححها، أو ورقة حولها لمصحح، أو خطوات طلعها من صورة حل */
export type LogRow = { at: string; kind: "sent" | "unsure" | "rubric"; item?: number; sid?: number; name?: string; exam?: string; total?: number; to?: number | null; q?: number; usage: Usage[] };

const rubricKey = (qid: number) => `ai_rubric_q_${qid}`;
const resultKey = (itemId: number) => `ai_result_${itemId}`;
const triesKey = (itemId: number) => `ai_try_${itemId}`;
const ON_KEY = "ai_grade_on", SET_KEY = "ai_settings", LOG_KEY = "ai_log", PRICE_KEY = "ai_prices";
const MAX_TRIES = 2;
const PER_TICK = 3;
const LOG_MAX = 5000;
/** أسعار الموديلات بالدولار لكل مليون توكن (داخل / طالع). صاحب البوت يگدر يغيرها من الصفحة */
export const DEFAULT_PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5": { in: 1.25, out: 10 },
};

const svcUrl = () => (process.env.GRADING_AI_URL ?? "").trim().replace(/\/+$/, "");
const svcKey = () => (process.env.GRADING_AI_KEY ?? "").trim();
/** الخدمة مربوطة: رابطها ومفتاحها بأسرار السيرفر */
export const aiLinked = () => !!svcUrl() && !!svcKey();
export const aiOn = async () => (await kvGet(ON_KEY)) === "1";
export const setAiOn = (on: boolean) => kvSet(ON_KEY, on ? "1" : "0");

const readJson = async <T>(k: string, def: T): Promise<T> => { try { return JSON.parse((await kvGet(k)) ?? "null") ?? def; } catch { return def; } };
export async function aiSettings(): Promise<AiSettings> {
  const s = await readJson<Partial<AiSettings>>(SET_KEY, {});
  return { exams: Array.isArray(s.exams) ? s.exams.map(Number) : [], unsure: s.unsure && typeof s.unsure === "object" ? s.unsure : {} };
}
/** مواضيع فصل وحد: اللي يصححها، ومنو توصله أوراقه اللي مو متأكد منها */
export async function setChapterScope(slug: string, examIds: number[], grader: number) {
  const s = await aiSettings();
  const inChapter = new Set((await find("bank_exams", { slug })).map((e) => e.id as number));
  const pick = examIds.map(Number).filter((id) => inChapter.has(id));
  s.exams = [...s.exams.filter((id) => !inChapter.has(id)), ...pick];
  if (grader) s.unsure[slug] = grader; else delete s.unsure[slug];
  await kvSet(SET_KEY, JSON.stringify(s));
}
export async function prices(): Promise<Record<string, Price>> {
  return { ...DEFAULT_PRICES, ...await readJson<Record<string, Price>>(PRICE_KEY, {}) };
}
export async function setPrice(model: string, p: Price) {
  const all = await readJson<Record<string, Price>>(PRICE_KEY, {});
  all[model] = { in: Math.max(0, Number(p.in) || 0), out: Math.max(0, Number(p.out) || 0) };
  await kvSet(PRICE_KEY, JSON.stringify(all));
}
/** كلفة سطر بالدولار. موديل بدون سعر ينحسب صفر، والصفحة تنبه عليه */
export const costOf = (usage: Usage[], p: Record<string, Price>) =>
  usage.reduce((t, u) => t + ((p[u.model]?.in ?? 0) * u.input + (p[u.model]?.out ?? 0) * u.output) / 1e6, 0);
export const aiLog = () => readJson<LogRow[]>(LOG_KEY, []);
async function addLog(row: LogRow) {
  const all = await aiLog();
  all.push(row);
  await kvSet(LOG_KEY, JSON.stringify(all.slice(-LOG_MAX)));
}
const sumUsage = (lists: Usage[][]): Usage[] => {
  const out = new Map<string, Usage>();
  for (const u of lists.flat()) {
    const r = out.get(u.model) ?? { model: u.model, calls: 0, input: 0, output: 0 };
    r.calls += Number(u.calls) || 0; r.input += Number(u.input) || 0; r.output += Number(u.output) || 0;
    out.set(u.model, r);
  }
  return [...out.values()];
};

export async function rubricOf(qid: number): Promise<RubricStep[] | null> {
  const j = await readJson<{ steps?: RubricStep[] } | null>(rubricKey(qid), null);
  return Array.isArray(j?.steps) && j!.steps.length ? j!.steps : null;
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
  if (!aiLinked()) throw new Error("نظام التصحيح AI مو مربوط");
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
  await addLog({ at: stamp(), kind: "rubric", q: qid, usage: sumUsage([r.usage ?? []]) });
  return (r.steps ?? []).map((s: any) => ({ text: String(s.text ?? ""), points: Number(s.points) || 0 }));
}

export type AiQuestion = { n: number; score: number; max: number; review: boolean; reason: string; lines: string[]; steps: { status: string; awarded: number; possible: number; reason: string; expected: string; student: string }[]; usage?: Usage[] };
export async function aiResultOf(itemId: number): Promise<AiQuestion[] | null> {
  const j = await readJson<AiQuestion[] | null>(resultKey(itemId), null);
  return Array.isArray(j) ? j : null;
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
    if (!mine.length) return { n: q.n, score: 0, max, review: false, reason: "ما جاوب", lines: [], steps: [], usage: [] };
    const imgs = await Promise.all(mine.map((a) => readRef(a.file)));
    if (imgs.some((b) => !b)) throw new Error(`صورة جواب سؤال ${q.n} مفقودة`);
    const r = await svc("/bot/grade", {
      max_points: max,
      steps: steps.map((s, i) => ({ text: s.text, points: s.points, objective: s.text || `Step ${i + 1}` })),
      images: imgs.map((b) => b!.toString("base64")),
    });
    const score = Math.max(0, Math.min(max, Math.round(Number(r.score) || 0)));
    return { n: q.n, score, max, review: !!r.requires_review, reason: String(r.review_reason ?? ""), lines: r.student_lines ?? [], steps: r.steps ?? [], usage: r.usage ?? [] };
  }));
}

/** الورقة بموضوع يصححه نظام التصحيح، وكل أسئلتها إلها خطوات، وبعده ما خلص محاولاته */
async function makeTaker() {
  const active = aiLinked() && await aiOn();
  const s = await aiSettings();
  const scope = new Set(s.exams);
  const verReady = new Map<number, boolean>();
  return async (it: Row) => {
    if (!active || !scope.has(it.exam_id) || it.graded_at || it.grader_id || !it.version_id) return false;
    if ((Number(await kvGet(triesKey(it.id))) || 0) >= MAX_TRIES) return false;
    if (!verReady.has(it.version_id)) {
      const qs = await find("bank_questions", { version_id: it.version_id });
      let ok = qs.length > 0;
      for (const q of qs) if (ok && !await rubricOf(q.id)) ok = false;
      verReady.set(it.version_id, ok);
    }
    return verReady.get(it.version_id)!;
  };
}
/** أوراق ينتظرها نظام التصحيح: ما تطلع للمصححين لحد ما يجربها، حتى ما ياخذها مصحح قبله */
export async function aiHeld(papers: Row[]): Promise<Set<number>> {
  const take = await makeTaker();
  const out = new Set<number>();
  for (const p of papers) if (await take(p)) out.add(p.id);
  return out;
}

async function forward(it: Row, res: AiQuestion[], usage: Usage[], nameOf: (it: Row) => Promise<string>) {
  const e = await one("bank_exams", { id: it.exam_id });
  const to = e ? (await aiSettings()).unsure[e.slug] ?? 0 : 0;
  // ما ينحسب كمحاولة فاشلة، بس ما يرجع ياخذها
  await kvSet(triesKey(it.id), String(MAX_TRIES));
  await update("sched_items", { id: it.id }, { grader_id: to || null });
  const name = await nameOf(it);
  const qs = res.filter((q) => q.review).map((q) => q.n).join("، ");
  if (to) await send(to, `🤖 <b>نظام التصحيح AI حوّلك ورقة</b>\nما متأكد من تصحيحها، فصححها إنت.\nالطالب: <b>${name}</b>\nالامتحان: ${e?.title ?? ""}\nالأسئلة اللي ما متأكد منها: ${qs}\n\nافتح لوحة التحكم ← ✍️ التصحيح.`);
  await addLog({ at: stamp(), kind: "unsure", item: it.id, sid: it.user_id, name, exam: e?.title ?? "", to: to || null, usage });
}

/** دكة المؤقت: ياخذ كم ورقة ويصححها. الواثق منها توصل للطالب، واللي مو متأكد منها تروح لمصحح */
export async function aiGradeTick(finish: (uid: number, itemId: number) => Promise<unknown>, nameOf: (it: Row) => Promise<string>, limit = PER_TICK) {
  if (!aiLinked() || !await aiOn()) return { off: true };
  const take = await makeTaker();
  const picked: Row[] = [];
  for (const it of await find("sched_items", { status: "done" }, { order: ["id"] })) {
    if (picked.length >= limit) break;
    if (!await take(it)) continue;
    await update("sched_items", { id: it.id }, { grader_id: AI_GRADER });
    // مصحح أخذها بنفس اللحظة: نتركها إله
    if ((await one("sched_items", { id: it.id }))?.grader_id !== AI_GRADER) continue;
    picked.push(it);
  }
  let graded = 0, unsure = 0, failed = 0;
  await Promise.all(picked.map(async (it) => {
    try {
      const res = await gradePaper(it);
      const usage = sumUsage(res.map((q) => q.usage ?? []));
      await kvSet(resultKey(it.id), JSON.stringify(res));
      if (res.some((q) => q.review)) { await forward(it, res, usage, nameOf); unsure++; return; }
      for (const q of res) await put("question_marks", { item_id: it.id, q: q.n, mark: q.score });
      await finish(AI_GRADER, it.id);
      await addLog({ at: stamp(), kind: "sent", item: it.id, sid: it.user_id, name: await nameOf(it), exam: (await one("bank_exams", { id: it.exam_id }))?.title ?? "", total: res.reduce((t, q) => t + q.score, 0), usage });
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
  return { graded, unsure, failed };
}
