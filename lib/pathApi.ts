// 🛤 «مساري» (طلبه 2026-11-25): المحاضرات والامتحانات والسيطرة بمكان واحد، بترتيب الجدول.
// كل موضوع لحاله (مثل فورمة): محاضراته بالترتيب، وكل امتحان بعد آخر محاضرة يشملها (من اسمه: «قبل x & y المحاضرة (1 & 2)»).
// امتحان باسم الموضوع بس (شامل) بعد كل محاضرات موضوعه، ونصف الفاينل والفاينل بمكانهم بترتيب الجدول.
// المحاضرة الجاية ما تنفتح إلا يكمل اللي قبلها كاملة. الامتحان ما يفتح ولا يقفل محاضرات، والقفل الحقيقي «🚦 السيطرة».
// المحاضرات نفسها محاضرات تطبيق قصي (داتا التطبيق)، والامتحانات والسيطرة من البوت.
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { chapterOf, type AppEnv } from "./appLink.ts";
import { lecNumber } from "./lectureQs.ts";
import type { AppChapter } from "./boardAttach.ts";
import { need } from "./webApi.ts";

/** «كاملة»: لآخرها. 99 لأن الفيديو أحياناً يوقف قبل آخر ثانية فالنسبة تطلع 99 */
export const DONE_PCT = 99;
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];

export const norm = (s: string) => s.replace(/[ة]/g, "ه").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
const STOP = new Set(["المحاضره", "محاضره", "شامل", "فقط", "الفصل", "على", "والقيمه"]);
// كلمات الاسم: «و» العطف و«ال» تنشال («وارجاند» = «ارجاند»، «المكافئ» = «مكافئ»)، وكلمات بنفس المعنى وحدة
const SYN: Record<string, string> = { ساين: "دائريه", كوساين: "دائريه", جيب: "دائريه", اشتقاق: "مشتقه", مشتقات: "مشتقه" };
const words = (s: string) => s.replace(/[ة]/g, "ه").replace(/[أإآ]/g, "ا").split(/[^\p{L}\p{N}]+/u)
  .map((w) => w.toLowerCase().replace(/^و(?=\S{4})/, "").replace(/^ال(?=\S{3})/, ""))
  .map((w) => SYN[w] ?? w).filter((w) => w.length >= 3 && !STOP.has(w) && !STOP.has(`ال${w}`));
/** الامتحان على أي موضوع (ti، أو -1 عام مثل نصف فاينل) وأي محاضرات (أرقامها) */
export function examPlace(title: string, topics: string[]): { ti: number; nums: number[] } {
  const t = norm(title);
  // الفاينل ونصف الفاينل والإعادات ونصف السنة: امتحانات عامة، لحالها بمكانها بالجدول حتى لو مكتوب بيها مواضيع
  if (/فاينل|final|اعاده|نصفالسنه/.test(t)) return { ti: -1, nums: [] };
  const tw = new Set(words(title));
  const score = topics.map((name) => {
    const k = norm(name);
    if (k && t.includes(k)) return 1000 + k.length;
    return words(name).filter((w) => tw.has(w)).length;
  });
  let ti = -1, best = 0;
  score.forEach((s, i) => { if (s > best) { best = s; ti = i; } });
  // الأرقام بعد اسم الموضوع: «(1 & 2)»، «1&2&3»، «(3)»، «محاضرة 1 فقط»
  const nums = [...title.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n < 40);
  // بلا أرقام ويذكر موضوع بعده هم («ديموافر وارجاند»): ينحط بعد آخر موضوع مذكور
  // (بكلمة مو موجودة باسم موضوعه هو، حتى «التربيعية» ما تودي «الجذور التربيعية» لـ«المعادلة التربيعية»)
  if (ti >= 0 && !nums.length) {
    const own = new Set(words(topics[ti]));
    topics.forEach((name, i) => { if (i > ti && words(name).some((w) => tw.has(w) && !own.has(w))) ti = i; });
  }
  return { ti, nums };
}

/** review: محاضرة مراجعة («مراجعه رسم الدوال 1»): مو من المحاضرات المرقمة، فالامتحانات ما تنحسب عليها */
export type PathLec = { id: string; title: string; n: number; review?: boolean };
export type PathTopic = { name: string; lectures: PathLec[] };
export type PathExam = { id: number; title: string };
export type Step =
  | { kind: "lec"; id: string; title: string; n: number; state: "done" | "open" | "locked" | "buy"; pct: number }
  | { kind: "exam"; id: number; title: string; state: string; at?: string; total?: number | null; self?: SelfTest; since?: number; from?: string; cp?: { min: number; absent: number; honor: { min: number; bday?: boolean; addr?: boolean } | null; stopImg?: string; topImg?: string } | null }
  | { kind: "cp"; exam: number; min: number; absent: number; count: number; title?: string };
export type Section = { name: string; general?: boolean; steps: Step[] };
/** 🧪 الاختبار الذاتي تحت الامتحان: open يگدر يدخله، locked يكمل محاضراته أول، used اختبر نفسه (total درجته، null ينتظر التصحيح) */
export type SelfTest = { state: "open" | "locked" | "used"; total?: number | null; going?: boolean; item?: number };

/** يرتب محاضرات الفصل (بالمواضيع) وامتحاناته (بترتيب الجدول) بمسار واحد، كل موضوع قسم لحاله */
export function buildPath(topics: PathTopic[], exams: PathExam[]): { sections: { name: string; general?: boolean; items: ({ kind: "lec"; lec: PathLec } | { kind: "exam"; exam: PathExam })[] }[] } {
  const flat: { ti: number; lec: PathLec }[] = topics.flatMap((t, ti) => t.lectures.map((lec) => ({ ti, lec })));
  const names = topics.map((t) => t.name);
  // مكان كل امتحان: بعد أي محاضرة (رقمها بالقائمة الكلية، -1 = قبل كل المحاضرات). ما يرجع لورا عن اللي قبله
  let prev = -1;
  const placed = exams.map((exam) => {
    const { ti, nums } = examPlace(exam.title, names);
    let at = prev;
    if (ti >= 0) {
      const mine = flat.map((x, i) => ({ ...x, i })).filter((x) => x.ti === ti);
      if (mine.length) {
        // المراجعات ما تنحسب: «رسم الدوال 1&2» بعد المحاضرة 2، و«رسم الدوال شامل» بعد آخر محاضرة (قبل المراجعات)
        const main = mine.filter((x) => !x.lec.review);
        const base = main.length ? main : mine;
        if (nums.length) {
          const max = Math.max(...nums);
          const upto = base.filter((x) => x.lec.n <= max);
          at = (upto.length ? upto[upto.length - 1] : base[0]).i;
        } else at = base[base.length - 1].i;
      }
    }
    at = Math.max(at, prev);
    prev = at;
    return { exam, ti, at };
  });
  const out: { name: string; general?: boolean; items: ({ kind: "lec"; lec: PathLec } | { kind: "exam"; exam: PathExam })[] }[] = [];
  const general = (list: typeof placed) => { for (const p of list) out.push({ name: p.exam.title, general: true, items: [{ kind: "exam", exam: p.exam }] }); };
  // امتحانات قبل كل المحاضرات
  general(placed.filter((p) => p.at < 0));
  let i = 0;
  topics.forEach((t, ti) => {
    const sec = { name: t.name, items: [] as ({ kind: "lec"; lec: PathLec } | { kind: "exam"; exam: PathExam })[] };
    const after: typeof placed = [];
    for (const lec of t.lectures) {
      sec.items.push({ kind: "lec", lec });
      for (const p of placed.filter((x) => x.at === i)) {
        if (p.ti === ti) sec.items.push({ kind: "exam", exam: p.exam }); else after.push(p);
      }
      i++;
    }
    if (sec.items.length) out.push(sec);
    general(after);
  });
  return { sections: out };
}

// ---------- محاضرات التطبيق (من داتا التطبيق، تنحفظ عدنا حتى إذا التطبيق ما رد يبقى المسار يشتغل)
const memo = new Map<AppEnv, { at: number; chs: AppChapter[] }>();
async function appChs(env: AppEnv): Promise<AppChapter[]> {
  const hit = memo.get(env);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.chs;
  try {
    const { appLectures } = await import("./boardAttach.ts");
    const chs = await appLectures(env);
    memo.set(env, { at: Date.now(), chs });
    await kvSet(`path_lec_${env}`, JSON.stringify(chs));
    return chs;
  } catch (e) {
    console.error("path lectures", e);
    try { return JSON.parse((await kvGet(`path_lec_${env}`)) ?? "[]"); } catch { return []; }
  }
}

/** مسار الطالب بفصل: الأقسام بحالة كل محاضرة وامتحان وسيطرة */
export async function pathFor(uid: number, chArg?: unknown, envArg?: unknown) {
  const { student, isAdmin } = await import("./data.ts");
  const st = await student(uid);
  const admin = await isAdmin(uid);
  need(st || admin, "مساري للطلاب المسجلين", 403);
  const link = await one("app_links", { uid });
  const env: AppEnv = envArg === "staging" || envArg === "prod" ? envArg : link?.env === "staging" ? "staging" : "prod";
  const lang = st?.curr === "إنجليزي" ? "english" : "arabic";
  const { lectureChapters } = await import("./access.ts");
  const { ownedChapters } = await import("./notes.ts");
  const owned = admin ? [1, 2, 3, 4, 5].map(chapterOf) : await ownedChapters(uid);
  const lecCh = admin ? [1, 2, 3, 4, 5] : await lectureChapters(uid);
  const { appChapters } = await import("./appLink.ts");
  const appCh = await appChapters(uid);
  const chs = [1, 2, 3, 4, 5].filter((c) => owned.includes(chapterOf(c)));
  need(chs.length, "بعدك ما شاري فصل. من المتجر اشتري المحاضرات أو الامتحانات، وبعدها يطلعلك مسارك");
  const ch = chs.includes(Number(chArg)) ? Number(chArg) : chs[0];
  const lecturesBought = lecCh.includes(ch) || appCh.includes(chapterOf(ch));
  // المحاضرات
  const appCh2 = (await appChs(env)).find((c) => c.ch === ch);
  const topics: PathTopic[] = (appCh2?.topics ?? []).map((t) => ({
    name: t.name,
    lectures: t.lectures.filter((l) => l.track === lang && !l.draft).map((l, k) => ({ id: l.id, title: l.title, n: lecNumber(l.title) || k + 1, ...(/مراجع|review/i.test(l.title) ? { review: true } : {}) })),
  })).filter((t) => t.lectures.length);
  // الامتحانات بترتيب الجدول (اللي تدخل الجدول بس)
  const { bookExams, loadCfg, cpImageUrl } = await import("./checkpoints.ts");
  const exams: PathExam[] = ((await bookExams()).get(chapterOf(ch)) ?? []).map((e) => ({ id: Number(e.id), title: String(e.title ?? "") }));
  const { sections } = buildPath(topics, exams);
  // حالة الطالب
  const views = new Map((await find("lecture_views", { user_id: uid })).map((v) => [String(v.lecture), Number(v.percent ?? 0)]));
  const items = new Map<number, Row>();
  for (const it of await find("sched_items", { user_id: uid })) {
    if (it.kind === "optional") continue; // الاختبار الذاتي لحاله، ما ياخذ مكان الرسمي
    const old = items.get(Number(it.exam_id));
    if (!old || String(it.at) > String(old.at)) items.set(Number(it.exam_id), it);
  }
  const { schedSettings } = await import("./schedApi.ts");
  const { itemState } = await import("./scheduleRules.ts");
  const { stamp } = await import("./util.ts");
  const s = await schedSettings(), now = stamp();
  const cfg = await loadCfg();
  const { selfTests } = await import("./schedApi.ts");
  const self = admin ? { open: new Set<number>(), done: new Map<number, Row>() } : await selfTests(uid);
  const { scheduleChapters } = await import("./schedApi.ts");
  const { labelChapters } = await import("./scheduleRules.ts");
  const examsBought = admin || (await scheduleChapters(uid)).flatMap((l) => labelChapters(l)).includes(chapterOf(ch));
  let blocked = false, since = 0, from = "";
  const out: Section[] = sections.map((sec) => ({
    name: sec.name, general: sec.general,
    steps: sec.items.flatMap((x): Step[] => {
      if (x.kind === "lec") {
        const pct = views.get(x.lec.id) ?? 0;
        const done = pct >= DONE_PCT;
        const state = !lecturesBought ? "buy" : done ? "done" : blocked ? "locked" : "open";
        if (lecturesBought && !done) blocked = true;
        return [{ kind: "lec", id: x.lec.id, title: x.lec.title, n: x.lec.n, state, pct }];
      }
      since++;
      if (since === 1) from = x.exam.title;
      const it = items.get(x.exam.id);
      let state = examsBought ? "nodate" : "buy", at: string | undefined, total: number | null | undefined;
      if (it && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(String(it.at ?? ""))) {
        at = String(it.at).slice(0, 16);
        const k = itemState(String(it.status), at, s.window, now);
        state = it.status === "done" ? (it.total !== null && it.total !== undefined ? "graded" : "done") : k;
        total = it.total === null || it.total === undefined ? null : Number(it.total);
      }
      const own = cfg.rules[String(x.exam.id)];
      // الأستاذ: كل امتحان بيه «＋ إنشاء سيطرة»، ويعرف كم امتحان تشمل (من بعد السيطرة اللي قبلها)
      const teach = admin ? { since, from, cp: own ? { min: own.min, absent: own.absent, honor: own.honor ?? null, stopImg: cpImageUrl(own.stopImg ?? null), topImg: cpImageUrl(own.topImg ?? null) } : null } : {};
      // 🧪 اختبر نفسك قبل الرسمي: مرة وحدة، وينفتح بعد ما يكمل المحاضرات اللي قبله
      const tried = self.done.get(x.exam.id);
      const selfTest: SelfTest | undefined = tried
        ? { state: "used", item: Number(tried.id), total: tried.total === null || tried.total === undefined ? null : Number(tried.total), ...(tried.status === "started" ? { going: true } : {}) }
        : self.open.has(x.exam.id) ? { state: lecturesBought && blocked ? "locked" : "open" } : undefined;
      const steps: Step[] = [{ kind: "exam", id: x.exam.id, title: x.exam.title, state, at, total, ...(selfTest ? { self: selfTest } : {}), ...teach }];
      const rule = cfg.mode === "percent" ? (own ? { min: Math.ceil(cfg.pct.min * since), absent: cfg.pct.absent } : null) : own;
      if (rule) { steps.push({ kind: "cp", exam: x.exam.id, min: rule.min, absent: rule.absent, count: since, title: x.exam.title }); since = 0; }
      return steps;
    }),
  }));
  const { activeStop } = await import("./checkpoints.ts");
  const stop = admin ? null : await activeStop(uid);
  // ما اختار أوقات امتحاناته: أول خطوة بمساري
  const { needsSchedule } = await import("./schedApi.ts");
  const pickTimes = admin ? false : await needsSchedule(uid);
  return { ch, chapters: chs.map((c) => ({ ch: c, name: `الفصل ${ORD[c]}` })), env, lang, lecturesBought, sections: out, stopped: !!stop, pickTimes, teacher: admin };
}

/** قبل ما تنفتح محاضرة من المسار: لازم تكون مفتوحة إله (كمّل اللي قبلها) */
export async function pathOpen(uid: number, lec: unknown) {
  const id = String(lec ?? "");
  need(/^[0-9a-f-]{32,36}$/i.test(id), "المحاضرة مو موجودة");
  for (const ch of [1, 2, 3, 4, 5]) {
    let p;
    try { p = await pathFor(uid, ch); } catch { continue; }
    if (p.ch !== ch) continue;
    for (const sec of p.sections) for (const st of sec.steps) {
      if (st.kind !== "lec" || st.id !== id) continue;
      need(!p.stopped, "⛔ المنصة موقوفة عليك هسه. حتى ترجع، لازم يحضر ولي أمرك إلى المعهد بأيامه وأوقاته (مكتوبة برسالة السيطرة بالمحادثة)", 423);
      need(st.state !== "buy", "اشتري محاضرات هذا الفصل حتى تنفتح", 403);
      need(st.state !== "locked", "🔒 كمّل المحاضرة اللي قبلها للآخر، وبعدها تنفتح هاي", 403);
      return { ok: true };
    }
  }
  need(false, "المحاضرة مو بمسارك", 404);
}
