// «🔎 حلول الذكاء» (طلب الأستاذ 2026-11-23): كل سؤال علمي حله الذكاء ينضاف لقائمة الأستاذ. يشوف السؤال (والصورة)
// والحل، ويأشر ✅ صح، لو يصلّحه: يحچي بالفويس شنو الغلط والذكاء يعيد كتابة الحل على كلامه، لو يكتب الحل بنفسه.
// الحل المصلّح: يوصل للطالب، ويصير ببلاش لكل طالب يسأل نفس السؤال (بصمة السؤال)، وسبب التصليح يصير قاعدة بموضوعه
// يمشي عليها الذكاء بالحلول الجاية
import { createHash } from "node:crypto";
import { kvGet, kvSet, one } from "./db.ts";
import { authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

export const QR_PERM = "qareview";
export const AI_SOURCES: string[] = ["lecture", "topic", "ai"];
export type QaRev = { id: string; at: string; uid: number; tid: number; source: string; q: string; state?: "ok" | "fixed" };
const LIST = "qa_ai_list", MAX = 600;
const readJson = async <T>(k: string, def: T): Promise<T> => { try { return (JSON.parse((await kvGet(k)) ?? "null") as T) ?? def; } catch { return def; } };

export const revList = async () => { const l = await readJson<QaRev[]>(LIST, []); return Array.isArray(l) ? l : []; };
export async function indexAnswer(r: QaRev) { await kvSet(LIST, JSON.stringify([...(await revList()), r].slice(-MAX))); }
async function setState(id: string, state: QaRev["state"]) { await kvSet(LIST, JSON.stringify((await revList()).map((x) => (x.id === id ? { ...x, state } : x)))); }

/** بصمة السؤال: نفس الموضوع ونفس اللغة ونفس النص (بدون فرق بالمسافات والحروف الكبيرة) */
export const fixKey = (tid: number, lang: string, text: string) => createHash("sha256").update(`${tid}|${lang}|${text.replace(/\s+/g, " ").trim().toLowerCase()}`).digest("hex").slice(0, 40);
export const fixedFor = async (fk: string) => { const j = await readJson<{ solution?: string } | null>(`qa_fixed_${fk}`, null); return j?.solution ? String(j.solution) : null; };

// قواعد الأستاذ من تصليحاته، لكل موضوع: تنضاف قبل شرح الملزمة بكل حل جديد
type Lesson = { at: string; q: string; why: string };
const lessonKey = (tid: number) => `qa_lessons_${tid}`;
export const lessonsOf = async (tid: number) => { const l = await readJson<Lesson[]>(lessonKey(tid), []); return Array.isArray(l) ? l : []; };
export async function lessonsCtx(tid: number) {
  const l = await lessonsOf(tid);
  return l.length ? `### قواعد الأستاذ من تصليحاته لحلول هذا الموضوع (لازم تمشي عليها بكل حل)\n${l.map((x) => `- سؤال: ${x.q}\n  الأستاذ گال: ${x.why}`).join("\n")}\n\n` : "";
}

const REWRITE = `You correct a math solution that was written for an Iraqi 6th-preparatory student in the teacher's (Qusay's) way.
The teacher read it and dictated by voice what is wrong (speech recognition may have changed some words: read them by their mathematical meaning).
Rewrite the WHOLE solution applying his correction exactly. Keep every correct part as it was, in the same format and line layout as the original (math between $ signs exactly like the original), in Iraqi Arabic with the Iraqi book's terms (نقطة نهاية عظمى محلية, never قصوى).
Return only the corrected solution.`;

async function view(id: string) {
  need(/^[a-f0-9]{16}$/.test(id), "الحل غير موجود", 404);
  const a = await readJson<any>(`qa_ans_${id}`, null);
  need(a, "الحل غير موجود", 404);
  return a;
}
async function listData(uid: number, show: string) {
  const all = (await revList()).slice().reverse();
  const rows = all.filter((x) => (show === "all" ? true : show === "done" ? !!x.state : !x.state)).slice(0, 150);
  const names = new Map<number, string>(), topics = new Map<number, string>();
  for (const r of rows) {
    if (!names.has(r.uid)) names.set(r.uid, String((await one("students", { user_id: r.uid }))?.name ?? (r.uid < 0 ? `طالب تجربة ${-r.uid}` : "طالب")));
    if (r.tid && !topics.has(r.tid)) topics.set(r.tid, String((await one("topics", { id: r.tid }))?.ar ?? ""));
  }
  return {
    rows: rows.map((r) => ({ ...r, name: names.get(r.uid) ?? "", topic: topics.get(r.tid) ?? "" })),
    counts: { wait: all.filter((x) => !x.state).length, ok: all.filter((x) => x.state === "ok").length, fixed: all.filter((x) => x.state === "fixed").length },
    fileToken: fileToken(uid),
  };
}

export async function qaReviewAction(body: Record<string, any>) {
  const uid = await authed(body?.initData, QR_PERM);
  const a = String(body.action ?? "list");
  const show = ["wait", "done", "all"].includes(body.show) ? String(body.show) : "wait";
  const out = async (notice = "", extra: Record<string, unknown> = {}) => ({ ...await listData(uid, show), notice, ...extra });
  if (a === "list") return await out();
  const id = String(body.id ?? "");
  if (a === "view") {
    const x = await view(id);
    return await out("", { open: { id, question: x.question ?? "", asked: x.asked ?? "", photo: x.photo ?? "", where: x.where ?? "", source: x.source, solution: x.solution ?? "", fixed: !!x.fixed, at: x.at, lang: x.lang } });
  }
  if (a === "ok") { await view(id); await setState(id, "ok"); return await out("✅ تأشر إنه صح"); }
  if (a === "rewrite") {
    // يعيد كتابة الحل على كلامه (بالفويس لو كتابة)، وما ينحفظ لحد ما يشوفه ويدوس 💾
    const x = await view(id);
    const note = String(body.note ?? "").trim().slice(0, 3000);
    need(note.length >= 4, "گول شنو الغلط بالحل");
    const { aiWrite } = await import("./qusayGrade.ts");
    const draft = await aiWrite(REWRITE, `السؤال:\n${x.asked || x.question || "(بالصورة)"}\n\nالحل:\n${x.solution}\n\nتصليح الأستاذ:\n${note}`, "qa");
    return await out("✍️ هذا الحل المصلّح. اقراه، وإذا صح دوس 💾 احفظ وابعثه للطالب", { open: { id, question: x.question ?? "", asked: x.asked ?? "", photo: x.photo ?? "", where: x.where ?? "", source: x.source, solution: x.solution ?? "", fixed: !!x.fixed, at: x.at, lang: x.lang }, draft });
  }
  if (a === "save") {
    const x = await view(id);
    const solution = String(body.solution ?? "").trim().slice(0, 20000);
    need(solution.length >= 10, "الحل فارغ");
    const why = String(body.why ?? "").trim().slice(0, 1500);
    await kvSet(`qa_ans_${id}`, JSON.stringify({ ...x, solution, fixed: true, old: x.old ?? x.solution, fixedAt: new Date().toISOString() }));
    // نفس السؤال لطالب ثاني: حل الأستاذ ببلاش
    if (x.fk) await kvSet(`qa_fixed_${x.fk}`, JSON.stringify({ solution, at: new Date().toISOString(), from: id }));
    if (why && Number(x.tid)) {
      const l = await lessonsOf(Number(x.tid));
      await kvSet(lessonKey(Number(x.tid)), JSON.stringify([...l, { at: new Date().toISOString().slice(0, 10), q: String(x.asked || x.question || "").slice(0, 200), why }].slice(-60)));
    }
    await setState(id, "fixed");
    // يوصل للطالب: حله تصلّح، ويا زر يفتحه
    let told = false;
    if (body.notify !== false && Number(x.uid) > 0) {
      const { send } = await import("./telegram.ts");
      const { adminPageLink } = await import("./keyboards.ts");
      const en = x.lang === "en";
      try {
        await send(Number(x.uid), en ? "✏️ <b>The teacher corrected the solution of your question</b>\nTap the button to see the new solution." : "✏️ <b>الأستاذ صلّح حل سؤالك</b>\nدوس الزر تشوف الحل الجديد.",
          { kb: [[{ text: en ? "📘 Open the solution" : "📘 افتح الحل", web_app: { url: `${adminPageLink("answer", Number(x.uid))}&a=${id}` } }]] });
        told = true;
      } catch (e) { console.error("qa fix notify", e); }
    }
    return await out(`💾 انحفظ${told ? " ووصل للطالب" : ""}.${x.fk ? " وأي طالب يسأل نفس السؤال ياخذ حلك ببلاش." : ""}${why ? " وسبب التصليح صار قاعدة بهذا الموضوع." : ""}`);
  }
  need(false, "أمر غير معروف");
  return await out();
}
