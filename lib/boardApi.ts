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
/** app: الشرح نازل كملحق بمحاضرة بتطبيق قصي (env، رقم المحاضرة، رقم الملحق)، lt: عنوان المحاضرة */
type Sent = { id: string; ref: string; title: string; chapter: number; at: string; pages: number; topic?: string; lecture?: number; lt?: string; app?: { env: "staging" | "prod"; lecture: string; att: string; more?: { lecture: string; att: string }[] } };
const listKey = (uid: number) => `board_list_${uid}`;
const SENT = "board_sent";
const lessonRef = (uid: number, id: string) => `boards/${uid}/${id}.json`;
const solveRef = (uid: number, lec: string) => `boards/${uid}/solve/${lec}.json`;
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
    inbox: teacher ? [] : (await inboxOf(uid)).map((x) => ({ id: x.id, title: x.title, at: x.at, pages: x.pages, chapter: x.chapter, topic: x.topic ?? "", lecture: x.lecture ?? 0, lt: x.lt ?? "" })),
    sent: teacher ? (await sentList()).slice(-50).reverse().map((x) => ({ id: x.id, title: x.title, at: x.at, chapter: x.chapter, topic: x.topic ?? "", lecture: x.lecture ?? 0, lt: x.lt ?? "", app: x.app ? x.app.env : "" })) : [],
    appEnv: teacher ? (await (await import("./boardAttach.ts")).boardAppEnv()) ?? "" : "",
    lqCount: teacher ? await (async () => { const BA = await import("./boardAttach.ts"); const e = await BA.boardAppEnv(); return e ? await BA.lectureAttCount(e) : 0; })() : 0,
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
  // 📎 من ملحقات المحاضرة بالتطبيق: الأستاذ، أو طالب شاري محاضرات هذا الفصل (بالبوت أو بالتطبيق)
  if (a === "att") {
    const x = (await sentList()).find((y) => y.id === String(body.id ?? ""));
    need(x, "هذا الشرح انسحب", 404);
    if (!teacher) {
      const { lectureChapters } = await import("./access.ts");
      const { appChapters, chapterOf } = await import("./appLink.ts");
      const ok = (await lectureChapters(uid)).includes(x!.chapter) || (await appChapters(uid)).includes(chapterOf(x!.chapter));
      need(ok, `هذا الشرح لطلاب محاضرات الفصل ${ORD[x!.chapter]}`, 403);
    }
    return { lesson: await readLesson(x!.ref), title: x!.title };
  }
  // ---------- 📘✍️ أسئلة المحاضرة (ملحقات التطبيق): القائمة، وحل الطالب على ورقة A4 (إله بس)
  // 🎬 تبويبات المحاضرة: الأسئلة موجودة؟ وشروحات السبورة، وأسئلة الطالب بهاي المحاضرة
  if (a === "lecTabs") return await (await import("./lecTabs.ts")).lecTabsFor(uid, body.lec);
  if (a === "lq") {
    const { lectureFor } = await import("./lectureQs.ts");
    return await lectureFor(uid, body.lec, true);
  }
  if (a === "solveGet") {
    const { lectureFor } = await import("./lectureQs.ts");
    const lec = await lectureFor(uid, body.lec);
    const raw = await files().read(solveRef(uid, lec.id));
    const lesson = raw ? cleanLesson(JSON.parse(raw.toString("utf8"))) : null;
    return { lec, lesson };
  }
  if (a === "solvePut") {
    const { lectureFor } = await import("./lectureQs.ts");
    const lec = await lectureFor(uid, body.lec);
    const raw = JSON.stringify(body.lesson ?? null);
    need(raw.length <= MAX_JSON, "الحل كبير كلش");
    const l = cleanLesson(body.lesson);
    need(l, "الحل خربان");
    await saveJson(solveRef(uid, lec.id), l!);
    return { ok: true };
  }
  // الأستاذ: يحط زرين «الملزمة» و«حلّي» بكل محاضرات التطبيق اللي إلها أسئلة، أو يشيلهن
  if (a === "lqSync" || a === "lqClear") {
    need(teacher, "بس الأستاذ", 403);
    const BA = await import("./boardAttach.ts");
    const env = await BA.boardAppEnv();
    need(env, "أول اختار «تجربة» لو «إي، بالتطبيق» من «📋 الشروح اللي دزيتها»");
    if (a === "lqClear") { const n = await BA.clearLectureAtts(env!); return { ...await state(), notice: `🗑 انشالت أزرار الأسئلة من ${n} محاضرة` }; }
    const { siteBase } = await import("./keyboards.ts");
    const r = await BA.syncLectureAtts(env!, siteBase());
    return { ...await state(), notice: `✅ انضافت «📘 الملزمة» و«✍️ حلّي» لـ ${r.added} محاضرة${r.already ? `، و${r.already} كانت بيها من قبل` : ""}${r.none ? `، و${r.none} محاضرة ما لگيت إلها أسئلة بالملازم` : ""}${env === "staging" ? " (داتا التجربة)" : ""}` };
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
  // ---------- الأستاذ بس: يدز شرحه لطلاب محاضرات الفصل، ويختار الموضوع والمحاضرة اللي ينزل وياها (طلبه 2026-11-25)
  if (a === "targets") {
    need(teacher, "بس الأستاذ يدز", 403);
    // ينزل بملحقات محاضرات التطبيق: يختار من محاضرات التطبيق نفسها
    const BA = await import("./boardAttach.ts");
    const env = await BA.boardAppEnv();
    if (env) return { app: env, chapters: await BA.appLectures(env) };
    const { chapters } = await import("./data.ts");
    const topics = await find("topics", { active: 1 }, { order: ["ord"] });
    return {
      chapters: (await chapters()).filter((c) => Number(c.ord) >= 1 && Number(c.ord) <= 5).map((c) => ({
        ch: Number(c.ord), name: String(c.ar ?? ""),
        topics: topics.filter((t) => Number(t.chapter_id) === Number(c.id)).map((t) => ({ id: Number(t.id), name: String(t.ar ?? ""), lectures: Math.max(0, Number(t.lectures) || 0) })),
      })),
    };
  }
  // الأستاذ: ينزل الشرح بملحقات التطبيق؟ مطفي / تجربة / الحقيقي
  if (a === "appmode") {
    need(teacher, "بس الأستاذ", 403);
    const BA = await import("./boardAttach.ts");
    await BA.setBoardAppEnv(body.env);
    const env = await BA.boardAppEnv();
    return { ...await state(), notice: env === "prod" ? "✅ الشرح ينزل بملحقات محاضرات التطبيق" : env === "staging" ? "✅ الشرح ينزل بملحقات محاضرات التطبيق (داتا التجربة بس)" : "✅ الشرح يوصل برسالة بس، بلا ملحقات التطبيق" };
  }
  // الأستاذ يسحب شرح دزه: ينشال من شروحات الطلاب ومن ملحقات المحاضرة بالتطبيق (نسخ الطلاب اللي حفظوها تبقى إلهم)
  if (a === "unsend") {
    need(teacher, "بس الأستاذ", 403);
    const all = await sentList();
    const x = all.find((y) => y.id === String(body.id ?? ""));
    need(x, "مو موجود", 404);
    if (x!.app) {
      const { removeBoardAttachment } = await import("./boardAttach.ts");
      for (const a of [x!.app, ...(x!.app.more ?? [])]) await removeBoardAttachment(x!.app.env, a.att);
    }
    await kvSet(SENT, JSON.stringify(all.filter((y) => y.id !== x!.id)));
    return { ...await state(), notice: "🗑 انسحب الشرح" };
  }
  if (a === "count") {
    need(teacher, "بس الأستاذ يدز", 403);
    const ch = Number(body.chapter);
    need(ch >= 1 && ch <= 5, "اختار الفصل");
    return { count: (await lectureBuyers(ch)).length };
  }
  if (a === "send") {
    need(teacher, "بس الأستاذ يدز", 403);
    // محاضرة من التطبيق: الفصل منها هي
    const BA = await import("./boardAttach.ts");
    // محاضرة وحدة، أو ثنتين (العربي والانگليزي) إذا الشرح يشملهم
    const raw: unknown[] = Array.isArray(body.appLecture) ? body.appLecture : body.appLecture ? [body.appLecture] : [];
    const ids = [...new Set(raw.map((v) => String(v)))].slice(0, 2);
    const env = ids.length ? await BA.boardAppEnv() : null;
    need(!ids.length || env, "الإرسال لملحقات التطبيق مطفي");
    const als = env ? await Promise.all(ids.map((i) => BA.appLecture(env, i))) : [];
    const al = als[0] ?? null;
    need(als.every((x) => x.ch === al?.ch), "المحاضرتين لازم من نفس الفصل");
    const ch = al ? al.ch : Number(body.chapter);
    need(ch >= 1 && ch <= 5, "اختار الفصل");
    const id = String(body.id ?? "");
    const meta = (await myList(uid)).find((x) => x.id === id);
    need(meta, "احفظ الشرح أول، وبعدين دزه");
    // نسخة ثابتة: إذا عدّل شرحه بعدين، اللي انبعث ما يتغير
    const l = await readLesson(lessonRef(uid, id));
    const sid = randomUUID(), ref = `boards/sent/${sid}.json`;
    await saveJson(ref, l);
    // الموضوع والمحاضرة اللي ينزل وياها الشرح (اختياري)
    const tp = Number(body.topic) ? (await find("topics", { id: Number(body.topic) }))[0] : null;
    const lec = Math.max(0, Math.round(Number(body.lecture) || 0));
    let row: Sent = { id: sid, ref, title: meta!.title, chapter: ch, at: stamp(), pages: l.pages.length, ...(tp ? { topic: String(tp.ar ?? "") } : {}), ...(tp && lec ? { lecture: lec } : {}) };
    if (al && env) {
      // الملحق أول: إذا ما انضاف (ماكو إذن، نت)، ما يندز شي
      const { siteBase } = await import("./keyboards.ts");
      const lt = als.map((x) => `${x.title}${x.track === "english" ? " (English)" : ""}`).join(" + ");
      const done: { lecture: string; att: string }[] = [];
      try {
        for (const x of als) done.push({ lecture: x.id, att: await BA.addBoardAttachment(env, x.id, `${siteBase()}/store/board?att=${sid}`, `📝 ${meta!.title}`, x.count) });
      } catch (e) {
        // الثانية ما انضافت: نشيل الأولى حتى ما يبقى نص
        for (const d of done) await BA.removeBoardAttachment(env, d.att).catch(() => {});
        throw e;
      }
      const topic = [...new Set(als.map((x) => x.topic))].join(" / ");
      row = { id: sid, ref, title: meta!.title, chapter: ch, at: row.at, pages: row.pages, topic, lt, app: { env, ...done[0], ...(done.length > 1 ? { more: done.slice(1) } : {}) } };
    }
    const where = [`الفصل ${ORD[ch]}`, row.topic, row.lt || (row.lecture ? `المحاضرة ${row.lecture}` : "")].filter(Boolean).join(" · ");
    await kvSet(SENT, JSON.stringify([...(await sentList()), row].slice(-500)));
    // نزل بملحقات المحاضرة بالتطبيق: الطالب يلگاه جوه المحاضرة، فماكو رسالة (طلبه 2026-11-26: «ليش يوصل اشعار؟»)
    const to = row.app ? [] : await lectureBuyers(ch);
    const { send } = await import("./telegram.ts");
    const { adminPageLink } = await import("./keyboards.ts");
    let n = 0;
    for (const u of to) {
      try {
        await send(u, `📝 <b>شرح جديد على السبورة</b>\n${meta!.title}\n${where}\n\nافتحه واكتب عليه بسبورتك.`, { kb: [[{ text: "📝 افتح الشرح", web_app: { url: `${adminPageLink("board", u)}&inbox=${sid}` } }]] });
        n++;
      } catch (e) { console.error("board send", u, e); }
    }
    return { ...await state(), notice: row.app ? `✅ نزل بملحقات «${row.topic} · ${row.lt}» بالتطبيق${row.app.env === "staging" ? " (التجربة)" : ""}. الطلاب يلگوه جوه المحاضرة.` : `✅ انبعث لـ ${n} طالب من طلاب محاضرات الفصل ${ORD[ch]}` };
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
