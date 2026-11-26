// 📘✍️ أسئلة المحاضرة بملحقات محاضرات تطبيق قصي (طلبه 2026-11-25). كل محاضرة إلها ثلاث أزرار:
//   📘 الملزمة: أسئلة المحاضرة من الوزاري والإثرائي (والكتاب بعدين)، كل سؤال وراه حله
//   ✍️ حلّي: السبورة ورقة A4، كل سؤال فوك صفحة والطالب يحل تحته (حله إله بس)
//   📝 السبورة: حل الأستاذ بالمحاضرة، بس إذا نشره (boardApi)
// الأسئلة تنقرا من نفس ملازم «📚 ملازمي» (صفحات «حلي» و«الحل النموذجي»)، فإذا بدّل ملزمة تتبدل هنا وحدها.
// المحاضرة تنربط بصفحاتها من فهرس الملزمة: نفس ترتيب المواضيع بالتطبيق، ونفس رقم المحاضرة.
// معلومات المحاضرة تنحفظ عدنا (kv) وقت ما ينضاف الملحق، فالطالب ما يحتاج داتا التطبيق.
import { kvGet, kvSet, type Row } from "./db.ts";
import { chapterOf, type AppEnv } from "./appLink.ts";
import { bookToc } from "./noteToc.ts";
import { groupsOf, lectureNo, pairGroups } from "./noteSpot.ts";
import { need } from "./webApi.ts";

/** المحاضرة: فصلها ومنهجها، ومواضيع فصلها بالتطبيق بالترتيب، ومكان موضوعها، ورقمها */
export type LecInfo = { id: string; env: AppEnv; ch: number; lang: "ar" | "en"; topics: string[]; ti: number; lec: number; title: string; topic: string };
/** sec book: صفحات دفتر الكتاب (أمثلة وأسئلة الكتاب) كاملة، بلا حل منفصل */
export type QRef = { book: number; page: number; sec: "book" | "wz" | "ith" };
const infoKey = (id: string) => `lq_${id}`;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export async function lecInfo(id: unknown): Promise<LecInfo | null> {
  if (!UUID.test(String(id ?? ""))) return null;
  try { return JSON.parse((await kvGet(infoKey(String(id)))) ?? "null"); } catch { return null; }
}
export const saveLecInfo = (i: LecInfo) => kvSet(infoKey(i.id), JSON.stringify(i));

/** رقم المحاضرة من عنوانها بالتطبيق: «المحاضره 2» أو «Lecture 2» أو «2» */
export function lecNumber(title: string): number {
  const m = /([0-9٠-٩]+|الأولى|الاولى|الثانية|الثانيه|الثالثة|الثالثه|الرابعة|الرابعه|الخامسة|الخامسه|السادسة|السابعة|الثامنة|التاسعة|العاشرة)\s*$/.exec(title.trim());
  return m ? lectureNo(m[1]) : 0;
}

/** صفحات المحاضرة بملزمة وحدة: من بداية المحاضرة لحد اللي بعدها (أي موضوع) */
export async function lecturePages(b: Row, info: Pick<LecInfo, "topics" | "ti" | "lec">): Promise<number[]> {
  const groups = groupsOf(await bookToc(b));
  if (!groups.length || info.ti < 0) return [];
  const to = pairGroups(info.topics.map((name) => ({ name, spots: [] })), groups);
  const g = to[info.ti];
  if (g === undefined || g < 0) return [];
  const mine = groups[g].spots;
  // الموضوع بلا محاضرات (كله وحدة): المحاضرة الأولى تاخذه كله
  const start = mine.find((s) => s.lec === info.lec) ?? (info.lec <= 1 && mine.every((s) => !s.lec) ? mine[0] : undefined);
  if (!start) return [];
  const after = groups.flatMap((x) => x.spots).filter((s) => s.p > start.p).sort((a, b) => a.p - b.p)[0];
  const end = Math.min(Number(b.pages) || 0, after ? after.p - 1 : Number(b.pages) || 0);
  const out: number[] = [];
  for (let p = start.p; p <= end; p++) out.push(p);
  return out;
}

/** أسئلة المحاضرة من ملازم الطالب (بس فصوله ومنهجه), بترتيبه: أمثلة وأسئلة الكتاب، بعدها الوزاري، بعدها الإثرائي.
 * withBook: صفحات الكتاب للملزمة بس (حلّي بعده بلا الكتاب لحد ما تنطلع أسئلته سؤال سؤال) */
export async function lectureQs(books: Row[], info: LecInfo, withBook = false): Promise<QRef[]> {
  const { hasSol, sectionOf } = await import("./notes.ts");
  const out: QRef[] = [];
  for (const sec of (withBook ? ["book", "wz", "ith"] : ["wz", "ith"]) as ("book" | "wz" | "ith")[]) {
    for (const b of books.filter((x) => sectionOf(x) === sec && (sec === "book" || hasSol(x)) && x.chapter === chapterOf(info.ch) && (x.lang === info.lang || x.lang === "all"))) {
      for (const page of await lecturePages(b, info)) out.push({ book: Number(b.id), page, sec });
    }
  }
  return out;
}

/** للطالب (أو الأستاذ): المحاضرة وأسئلتها. ما اشترى الفصل؟ ما تنفتح */
export async function lectureFor(uid: number, id: unknown, withBook = false) {
  // ما انحفظت معلوماتها (ما داس «حط الملزمة»): من نسخة محاضرات التطبيق
  const info = (await lecInfo(id)) ?? (UUID.test(String(id ?? "")) ? await (await import("./lecTabs.ts")).ensureLecInfo(String(id)) : null);
  need(info, "هذي المحاضرة بعد ما إلها أسئلة", 404);
  const { myBooks, ownedChapters } = await import("./notes.ts");
  const { isAdmin } = await import("./data.ts");
  const admin = await isAdmin(uid);
  need(admin || (await ownedChapters(uid)).includes(chapterOf(info!.ch)), `أسئلة ${chapterOf(info!.ch)} لطلابه بس`, 403);
  const items = await lectureQs(await myBooks(uid), info!, withBook);
  need(items.length, "ما لگينا أسئلة لهاي المحاضرة بالملازم", 404);
  return { id: info!.id, title: info!.title, topic: info!.topic, ch: info!.ch, lang: info!.lang, items };
}
