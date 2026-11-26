// 🎬 تبويبات المحاضرة بالتطبيق (طلبه 2026-11-26): تحت الفيديو، ويا «المرفقات»:
//   📘 الأسئلة (أسئلة المحاضرة من الملزمة) · ✍️ سبورة الحل (يحل تحت كل سؤال) · ✅ الحل النموذجي (حل الأستاذ)
//   📝 سبورة الشرح (بس إذا الأستاذ دز شرح لهاي المحاضرة) · ❓ أسئلتي (اللي سألها الطالب بهاي المحاضرة)
// كلها من البوت مباشرة (مو مرفقات لوحة التطبيق)، فإذا بدّل ملزمة أو دز شرح يتبدل وحده.
import { find, kvGet, type Row } from "./db.ts";
import { lecInfo, lecNumber, lectureQs, saveLecInfo, type LecInfo } from "./lectureQs.ts";
import { chapterOf, type AppEnv } from "./appLink.ts";

/** معلومات المحاضرة: المحفوظة، أو من نسخة محاضرات التطبيق اللي يحفظها «مساري» */
export async function ensureLecInfo(id: string): Promise<LecInfo | null> {
  const have = await lecInfo(id);
  if (have) return have;
  for (const env of ["prod", "staging"] as AppEnv[]) {
    let chs: { ch: number; topics: { name: string; lectures: { id: string; title: string; track: string }[] }[] }[] = [];
    try { chs = JSON.parse((await kvGet(`path_lec_${env}`)) ?? "[]"); } catch { continue; }
    for (const c of chs) {
      const topics = c.topics.map((t) => t.name);
      for (const [ti, t] of c.topics.entries()) {
        const l = t.lectures.find((x) => x.id === id);
        if (!l) continue;
        const k = t.lectures.filter((x) => x.track === l.track).indexOf(l);
        const info: LecInfo = { id, env, ch: c.ch, lang: l.track === "english" ? "en" : "ar", topics, ti, lec: lecNumber(l.title) || k + 1, title: l.title, topic: t.name };
        await saveLecInfo(info);
        return info;
      }
    }
  }
  return null;
}

/** اسم موضوع للمقارنة: بلا مسافات ولا «ال»، والهمزات والتاء المربوطة والياء وحدة */
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/(^|\s)ال/g, "$1").replace(/[^\p{L}\p{N}]/gu, "");
/** مواضيع البوت (الأسئلة العلمية) اللي تقابل موضوع محاضرة التطبيق */
async function botTopics(info: LecInfo): Promise<number[]> {
  const chap = (await find("chapters")).find((c) => Number(c.ord) === info.ch);
  if (!chap) return [];
  const want = norm(info.topic);
  return (await find("topics", { chapter_id: chap.id })).filter((t) => { const a = norm(String(t.ar ?? "")), e = norm(String(t.en ?? "")); return !!want && (a === want || e === want || (a && (a.includes(want) || want.includes(a)))); }).map((t) => Number(t.id));
}

export type BoardLesson = { id: string; title: string; pages: number; at: string };
export type MyQ = { kind: "ai"; id: string; q: string; at: string } | { kind: "teacher"; id: number; status: string; at: string };

/** شروحات السبورة اللي نزلت بهاي المحاضرة (بالعربي أو الانگليزي) */
async function boardFor(id: string): Promise<BoardLesson[]> {
  let sent: Row[] = [];
  try { sent = JSON.parse((await kvGet("board_sent")) ?? "[]"); } catch { /* */ }
  return sent.filter((r) => r.app && (r.app.lecture === id || (r.app.more ?? []).some((m: Row) => m.lecture === id)))
    .map((r) => ({ id: String(r.id), title: String(r.title ?? "شرح"), pages: Number(r.pages) || 0, at: String(r.at ?? "") })).reverse();
}

/** أسئلة الطالب بهاي المحاضرة: اللي جاوبها الذكاء (إلها صفحة حل)، واللي راحت للأستاذ */
async function myQuestions(uid: number, info: LecInfo): Promise<MyQ[]> {
  const tids = new Set(await botTopics(info));
  if (!tids.size) return [];
  let mine: Row[] = [];
  try { mine = JSON.parse((await kvGet(`qa_mine_${uid}`)) ?? "[]"); } catch { /* */ }
  const ai: MyQ[] = (Array.isArray(mine) ? mine : []).filter((m) => tids.has(Number(m.tid)) && (!m.lecture || Number(m.lecture) === info.lec))
    .map((m) => ({ kind: "ai", id: String(m.id), q: String(m.q ?? ""), at: String(m.at ?? "") }));
  const teacher: MyQ[] = (await find("questions", { user_id: uid })).filter((q) => tids.has(Number(q.topic_id)) && (!Number(q.lecture) || Number(q.lecture) === info.lec))
    .map((q) => ({ kind: "teacher", id: Number(q.id), status: String(q.status ?? ""), at: String(q.created ?? "") }));
  return [...ai, ...teacher].sort((a, b) => b.at.localeCompare(a.at));
}

/** كل اللي تحتاجه تبويبات المحاضرة. qs: بيها أسئلة بالملزمة (فتطلع «الأسئلة» و«سبورة الحل» و«الحل النموذجي») */
export async function lecTabsFor(uid: number, id: unknown) {
  const lid = String(id ?? "");
  if (!/^[0-9a-f-]{32,36}$/i.test(lid)) return { qs: false, board: [] as BoardLesson[], myq: [] as MyQ[], info: null };
  const info = await ensureLecInfo(lid);
  if (!info) return { qs: false, board: await boardFor(lid), myq: [] as MyQ[], info: null };
  const { myBooks, ownedChapters } = await import("./notes.ts");
  const { isAdmin } = await import("./data.ts");
  const owns = (await isAdmin(uid)) || (await ownedChapters(uid)).includes(chapterOf(info.ch));
  const qs = owns && (await lectureQs(await myBooks(uid), info, true)).length > 0;
  // sol: تبويب «الحل النموذجي» يطلع بس إذا مفتوح للطالب (شنو يشوف الطالب ← 📘 الحل النموذجي)
  const sol = qs && await (await import("./studentVis.ts")).solAllowed(uid);
  return { qs, sol, board: await boardFor(lid), myq: await myQuestions(uid, info), info: { title: info.title, topic: info.topic, ch: info.ch } };
}
