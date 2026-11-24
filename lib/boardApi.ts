// 📝 السبورة بالتطبيق (طلبه 2026-11-25): الأستاذ والطالب نفس السبورة ونفس الخيارات.
// كل واحد شروحه محفوظة إله. الأستاذ يدز شرحه بس من يريد («إرسال للطلاب» ويسأله تريد تدزه؟)، ويوصل بس للي اشتروا محاضرات ذاك الفصل.
// الطالب يفتح الشرح المستلم على سبورته ويكتب عليه: نسخته هو، وشرح الأستاذ ما يتغير
import { randomUUID } from "node:crypto";
import { find, kvGet, kvSet } from "./db.ts";
import { can, student } from "./data.ts";
import { files } from "./files.ts";
import { cleanLesson, type Lesson } from "./board/engine.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";
import { stamp } from "./util.ts";

export const BOARD_PERM = "board";
const MAX_JSON = 15 * 1024 * 1024, MAX_BG = 8 * 1024 * 1024, MAX_LESSONS = 300;
type Meta = { id: string; title: string; at: string; pages: number };
type Sent = { id: string; ref: string; title: string; chapter: number; at: string; pages: number };
const listKey = (uid: number) => `board_list_${uid}`;
const SENT = "board_sent";
const lessonRef = (uid: number, id: string) => `boards/${uid}/${id}.json`;
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];

const readJson = async <T>(k: string, d: T): Promise<T> => { try { const v = JSON.parse(await kvGet(k) ?? ""); return (v ?? d) as T; } catch { return d; } };
const myList = async (uid: number) => { const l = await readJson<Meta[]>(listKey(uid), []); return Array.isArray(l) ? l : []; };
const sentList = async () => { const l = await readJson<Sent[]>(SENT, []); return Array.isArray(l) ? l : []; };

async function who(token: unknown) {
  await ensure();
  const uid = verifyHomeToken(token);
  need(uid !== null, "الرابط انتهى. افتح السبورة من جديد", 401);
  const teacher = await can(uid!, BOARD_PERM);
  const s = teacher ? null : await student(uid!);
  need(teacher || s, "السبورة للطلاب المسجلين", 403);
  return { uid: uid!, teacher, s };
}

/** الطلاب اللي اشتروا محاضرات هذا الفصل */
export async function lectureBuyers(chapter: number): Promise<number[]> {
  const { lectureChapters } = await import("./access.ts");
  const out: number[] = [];
  for (const s of await find("students")) {
    const uid = Number(s.user_id);
    if (uid > 0 && (await lectureChapters(uid)).includes(chapter)) out.push(uid);
  }
  return out;
}
/** الشروح اللي وصلت هذا الطالب: من فصول اشترى محاضراتها */
async function inboxOf(uid: number) {
  const { lectureChapters } = await import("./access.ts");
  const mine = await lectureChapters(uid);
  return (await sentList()).filter((x) => mine.includes(x.chapter)).reverse();
}

const saveJson = (ref: string, l: Lesson) => files().write(ref, Buffer.from(JSON.stringify(l)), "application/json");
async function readLesson(ref: string): Promise<Lesson> {
  const b = await files().read(ref);
  need(b, "الشرح مو موجود", 404);
  const l = cleanLesson(JSON.parse(b!.toString("utf8")));
  need(l, "الشرح خربان", 500);
  return l!;
}

export async function boardAction(body: any) {
  const { uid, teacher, s } = await who(body?.t);
  const a = String(body?.action ?? "");
  const state = async () => ({
    teacher, name: teacher ? "" : String(s?.name ?? ""),
    lessons: (await myList(uid)).slice().reverse(),
    inbox: teacher ? [] : (await inboxOf(uid)).map((x) => ({ id: x.id, title: x.title, at: x.at, pages: x.pages, chapter: x.chapter })),
    sent: teacher ? (await sentList()).slice(-50).reverse().map((x) => ({ id: x.id, title: x.title, at: x.at, chapter: x.chapter })) : [],
  });
  if (a === "state") return await state();
  if (a === "get") {
    const id = String(body.id ?? "");
    need(/^[\w-]{8,64}$/.test(id) && (await myList(uid)).some((x) => x.id === id), "الشرح مو موجود", 404);
    return { lesson: await readLesson(lessonRef(uid, id)) };
  }
  if (a === "inbox") {
    const x = (teacher ? await sentList() : await inboxOf(uid)).find((y) => y.id === String(body.id ?? ""));
    need(x, "هذا الشرح مو إلك", 404);
    return { lesson: await readLesson(x!.ref) };
  }
  if (a === "save") {
    const raw = JSON.stringify(body.lesson ?? null);
    need(raw.length <= MAX_JSON, "الشرح كبير كلش (أكثر من 15 ميگا)");
    const l = cleanLesson(body.lesson);
    need(l, "الشرح مو مفهوم");
    const title = String(body.title ?? l!.title ?? "").trim().slice(0, 120) || `شرح ${stamp().slice(0, 16)}`;
    l!.title = title;
    const list = await myList(uid);
    let id = String(body.id ?? "");
    if (!/^[\w-]{8,64}$/.test(id) || !list.some((x) => x.id === id)) { id = randomUUID(); need(list.length < MAX_LESSONS, "عندك شروح كثيرة، احذف القديمة أول"); }
    await saveJson(lessonRef(uid, id), l!);
    const meta: Meta = { id, title, at: stamp(), pages: l!.pages.length };
    await kvSet(listKey(uid), JSON.stringify([...list.filter((x) => x.id !== id), meta]));
    return { id, ...await state(), notice: "✅ انحفظ الشرح" };
  }
  if (a === "del") {
    const id = String(body.id ?? "");
    await kvSet(listKey(uid), JSON.stringify((await myList(uid)).filter((x) => x.id !== id)));
    return { ...await state(), notice: "🗑 انحذف" };
  }
  // ---------- الأستاذ بس: يدز شرحه لطلاب محاضرات الفصل
  if (a === "count") {
    need(teacher, "بس الأستاذ يدز", 403);
    const ch = Number(body.chapter);
    need(ch >= 1 && ch <= 5, "اختار الفصل");
    return { count: (await lectureBuyers(ch)).length };
  }
  if (a === "send") {
    need(teacher, "بس الأستاذ يدز", 403);
    const ch = Number(body.chapter);
    need(ch >= 1 && ch <= 5, "اختار الفصل");
    const id = String(body.id ?? "");
    const meta = (await myList(uid)).find((x) => x.id === id);
    need(meta, "احفظ الشرح أول، وبعدين دزه");
    // نسخة ثابتة: إذا عدّل شرحه بعدين، اللي انبعث ما يتغير
    const l = await readLesson(lessonRef(uid, id));
    const sid = randomUUID(), ref = `boards/sent/${sid}.json`;
    await saveJson(ref, l);
    const row: Sent = { id: sid, ref, title: meta!.title, chapter: ch, at: stamp(), pages: l.pages.length };
    await kvSet(SENT, JSON.stringify([...(await sentList()), row].slice(-500)));
    const to = await lectureBuyers(ch);
    const { send } = await import("./telegram.ts");
    const { adminPageLink } = await import("./keyboards.ts");
    let n = 0;
    for (const u of to) {
      try {
        await send(u, `📝 <b>شرح جديد على السبورة</b>\n${meta!.title}\n\nافتحه واكتب عليه بسبورتك.`, { kb: [[{ text: "📝 افتح الشرح", web_app: { url: `${adminPageLink("board", u)}&inbox=${sid}` } }]] });
        n++;
      } catch (e) { console.error("board send", u, e); }
    }
    return { ...await state(), notice: `✅ انبعث لـ ${n} طالب من طلاب محاضرات الفصل ${ORD[ch]}` };
  }
  need(false, "أمر غير معروف");
  return {};
}

/** صورة خلفية (صفحة PDF أو صورة) */
export async function boardUpload(form: FormData) {
  const { uid } = await who(form.get("t"));
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0 && f.size <= MAX_BG, "الصورة لازم أصغر من 8 ميگا");
  const b = Buffer.from(await (f as Blob).arrayBuffer());
  const png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8;
  need(png || jpg, "لازم صورة");
  const ref = `boards/${uid}/bg/${randomUUID()}.${png ? "png" : "jpg"}`;
  await files().write(ref, b, png ? "image/png" : "image/jpeg");
  return { ref };
}

/** الصور: أي واحد داخل بالسبورة يگدر يشوف خلفية بأسماء عشوائية (ما تنحزر) */
export async function boardFile(url: URL): Promise<Response> {
  await who(url.searchParams.get("t"));
  const ref = String(url.searchParams.get("ref") ?? "");
  need(/^boards\/\d+\/bg\/[\w-]+\.(png|jpg)$/.test(ref), "مو موجود", 404);
  const b = await files().read(ref);
  need(b, "مو موجود", 404);
  return new Response(new Uint8Array(b!), { headers: { "Content-Type": ref.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}

export const boardSentCount = async () => (await sentList()).length;
