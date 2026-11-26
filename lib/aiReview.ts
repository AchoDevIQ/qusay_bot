// 🤖 مراجعة تصحيح الذكاء (طلبه 2026-11-26): كل أوراق مجموعة وحدة (امتحان + مكان + يوم وساعة) بصفحة وحدة طويلة،
// طالب ورا طالب: اسمه، ودرجته، وصفحات ورقته ويا علامات الذكاء الحمرة، ودرجة كل سؤال يگدر يبدلها ويحفظ بنفس المكان.
// والإعداد: درجات الذكاء توصل للطالب «مباشرة» (ويراجعها بعدين، والتعديل يوصل «تعديل درجة»)، لو «بعد ما أراجعها»:
// الورقة تنحجز وتنتظره، ويوصله «المجموعة جاهزة»، ومن يوافق توصل كلها. إذا ما راجعها خلال المدة اللي يحددها، توصل وحدها.
import { find, kvGet, kvSet, one, put, update, type Row } from "./db.ts";
import { AI_GRADER, QUSAY_GRADER, can, centerName, staffIds, student } from "./data.ts";
import { addMinutes } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const REVIEW_PERM = "aireview";
export type ReviewCfg = { mode: "after" | "before"; hours: number };
const CFG = "ai_review_cfg";
const DEF: ReviewCfg = { mode: "after", hours: 24 };
const HOLD = "ai_review_hold";   // { itemId: وقت الحجز }
const SEEN = "ai_review_seen";   // المجموعات اللي راجعها
const TOLD = "ai_review_told";   // المجموعات اللي انبلغ إنها جاهزة
const DAYS = 21;                 // المجموعات اللي تطلع: آخر 3 أسابيع

const readJson = async <T>(k: string, d: T): Promise<T> => { try { return JSON.parse((await kvGet(k)) ?? "") as T; } catch { return d; } };
export async function reviewCfg(): Promise<ReviewCfg> {
  const c = await readJson<Partial<ReviewCfg>>(CFG, {});
  return { mode: c.mode === "before" ? "before" : "after", hours: Math.min(168, Math.max(1, Number(c.hours) || DEF.hours)) };
}
export const heldMap = () => readJson<Record<string, string>>(HOLD, {});
const isAi = (it: Row) => it.grader_id === AI_GRADER || it.grader_id === QUSAY_GRADER;

/** المجموعة: الامتحان، والمكان (مركزه أو الإلكتروني)، والموعد */
async function placeOf(it: Row): Promise<{ key: string; label: string }> {
  const st = await student(it.user_id);
  if (it.catch_place === "online" || st?.exam !== "حضوري") return { key: "on", label: "💻 إلكتروني" };
  return { key: `c${st?.center_id ?? 0}`, label: `🏫 ${(await centerName(st?.center_id)) || "مركز"}` };
}
const groupKey = (it: Row, place: string) => `${it.exam_id}|${place}|${String(it.at ?? "").slice(0, 16)}`;
/** 🧪 أوراق طلاب التجربة: كلها بمجموعة وحدة، حتى يشوف شكل الصفحة ويجرب التعديل (طلبه 2026-11-26) */
const TEST_KEY = "0|test|";
const keyOf = async (it: Row) => (it.user_id < 0 ? TEST_KEY : groupKey(it, (await placeOf(it)).key));

/** بدل إنهاء الورقة مباشرة (من نظام التصحيح AI و«تصحيح قصي»): بوضع «بعد ما أراجعها» تنحجز وتنتظر */
export async function aiFinish(finish: (uid: number, itemId: number) => Promise<unknown>, uid: number, itemId: number) {
  const cfg = await reviewCfg();
  const it = await one("sched_items", { id: itemId });
  if (cfg.mode !== "before" || !it || it.user_id <= 0) return finish(uid, itemId);
  const held = await heldMap();
  held[String(itemId)] = stamp();
  await kvSet(HOLD, JSON.stringify(held));
  await tellReady(it).catch((e) => console.error("ai review ready", e));
  return "held";
}

/** كل أوراق المجموعة انصححت: يوصل لصاحب البوت (ولصاحب الصلاحية) مرة وحدة */
async function tellReady(it: Row) {
  const place = await placeOf(it);
  const key = groupKey(it, place.key);
  const told = await readJson<string[]>(TOLD, []);
  if (told.includes(key)) return;
  const at = String(it.at ?? "").slice(0, 16);
  const same = (await find("sched_items", { exam_id: it.exam_id })).filter((x) => x.user_id > 0 && String(x.at ?? "").slice(0, 16) === at && x.kind !== "optional");
  for (const x of same) if (x.status === "done" && !x.graded_at && (await placeOf(x)).key === place.key && !(await heldMap())[String(x.id)]) return; // بعد بيها أوراق تنتظر التصحيح
  await kvSet(TOLD, JSON.stringify([...told, key].slice(-500)));
  const exam = await one("bank_exams", { id: it.exam_id });
  const { hours } = await reviewCfg();
  const text = `🤖 <b>تصحيح الذكاء خلص مجموعة</b>\n${esc(String(exam?.title ?? "امتحان"))}\n${esc(place.label)} · ${at}\n\nراجعها من ⚙️ لوحة التحكم ← «🤖 مراجعة تصحيح الذكاء». إذا ما راجعتها، توصل للطلاب وحدها بعد ${hours} ساعة.`;
  const { ADMIN_IDS } = await import("./config.ts");
  for (const id of new Set([...ADMIN_IDS, ...await staffIds(REVIEW_PERM)])) await send(id, text).catch(() => undefined);
}

/** توصل الورقة المحجوزة للطالب (موافقة، أو خلصت المدة) */
async function release(itemId: number) {
  const held = await heldMap();
  if (!held[String(itemId)]) return false;
  delete held[String(itemId)];
  await kvSet(HOLD, JSON.stringify(held));
  const it = await one("sched_items", { id: itemId });
  if (!it || it.graded_at || !isAi(it)) return false;
  const { finishByAi } = await import("./gradeApi.ts");
  await finishByAi(Number(it.grader_id), itemId);
  return true;
}
/** كل دقيقة: المحجوزة اللي خلصت مدتها توصل وحدها */
export async function releaseTick(now = stamp()) {
  const { hours } = await reviewCfg();
  let n = 0;
  for (const [id, at] of Object.entries(await heldMap())) if (addMinutes(at.slice(0, 16), hours * 60) <= now.slice(0, 16)) { if (await release(Number(id)).catch((e) => { console.error("ai review release", id, e); return false; })) n++; }
  return n;
}

/** المجموعات: آخر 3 أسابيع، الأحدث أول */
async function groups() {
  const held = await heldMap();
  const since = addMinutes(stamp().slice(0, 16), -DAYS * 24 * 60);
  const seen = new Set(await readJson<string[]>(SEEN, []));
  const exams = new Map((await find("bank_exams")).map((e) => [Number(e.id), e]));
  const map = new Map<string, { key: string; exam: number; title: string; chapter: string; place: string; at: string; count: number; held: number }>();
  for (const it of await find("sched_items", { status: "done" })) {
    if (!isAi(it)) continue;
    const h = !!held[String(it.id)];
    if (!h && !(it.graded_at && (it.user_id < 0 || String(it.graded_at) >= since))) continue;
    const key = await keyOf(it);
    const e = exams.get(Number(it.exam_id));
    const g = map.get(key) ?? (key === TEST_KEY
      ? { key, exam: 0, title: "🧪 أوراق التجربة", chapter: "طلاب التجربة، كل الامتحانات", place: "تجربة", at: "", count: 0, held: 0 }
      : { key, exam: Number(it.exam_id), title: String(e?.title ?? "امتحان"), chapter: String(e?.chapter ?? ""), place: (await placeOf(it)).label, at: String(it.at ?? "").slice(0, 16), count: 0, held: 0 });
    g.count++; if (h) g.held++;
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({ ...g, seen: seen.has(g.key) })).sort((a, b) => (a.key === TEST_KEY ? 1 : 0) - (b.key === TEST_KEY ? 1 : 0) || b.at.localeCompare(a.at));
}

/** أوراق المجموعة: طالب ورا طالب */
async function groupPapers(key: string, only?: number) {
  const [exam, place, at] = key.split("|");
  const test = key === TEST_KEY;
  const held = await heldMap();
  const { aiReviewShown } = await import("./examRoom.ts");
  const { itemTotal } = await import("./gradeApi.ts");
  const out = [];
  for (const it of await find("sched_items", test ? { status: "done" } : { exam_id: Number(exam) })) {
    if (it.status !== "done" || !isAi(it) || (only && Number(it.id) !== only)) continue;
    if (test ? it.user_id >= 0 || !it.graded_at : it.user_id <= 0 || String(it.at ?? "").slice(0, 16) !== at) continue;
    if (!it.graded_at && !held[String(it.id)]) continue;
    if (!test && (await placeOf(it)).key !== place) continue;
    const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [Number(m.q), Number(m.mark)]));
    const qs = await aiReviewShown(it);
    const max = new Map((await find("bank_questions", { version_id: it.version_id })).map((q) => [Number(q.n), Number(q.max_mark)]));
    out.push({
      id: Number(it.id), name: String((await student(it.user_id))?.name ?? "طالب") + (test ? ` · ${String((await one("bank_exams", { id: it.exam_id }))?.title ?? "")}` : ""), held: !!held[String(it.id)],
      by: it.grader_id === QUSAY_GRADER ? "🧠 تصحيح قصي" : "🤖 مؤمل",
      total: it.graded_at ? Number(it.total ?? 0) : await itemTotal(it),
      questions: qs.map((q) => ({ n: q.n, max: max.get(q.n) ?? q.max, mark: marks.get(q.n) ?? q.score, note: q.note ?? "", photos: q.photos, marked: (q as { marked?: unknown }).marked ?? null })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** يحفظ درجات أسئلة ورقة: المحجوزة تتعدل بصمت (لسه ما وصلت)، والواصلة توصل «تعديل درجة» للطالب وولي أمره */
/** درجة سؤال بورقة واصلة: تنحفظ ويتحدث المجموع، والدرجة القديمة تنحفظ حتى «📤 دز للطلاب» يگولهم كانت شگد */
async function quietMark(itemId: number, it: Row, q: number, mark: number) {
  const G = await import("./gradeApi.ts");
  const before = Number(it.total ?? 0);
  await put("question_marks", { item_id: itemId, q, mark });
  await update("sched_items", { id: itemId }, { total: await G.itemTotal(it) });
  await G.notePending(itemId, before);
}
async function saveMarks(itemId: number, raw: unknown) {
  const it = await one("sched_items", { id: itemId });
  need(it && isAi(it), "الورقة غير موجودة");
  const want = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const max = new Map((await find("bank_questions", { version_id: it!.version_id })).map((q) => [Number(q.n), Number(q.max_mark)]));
  const held = !!(await heldMap())[String(itemId)];
  const { itemTotal } = await import("./gradeApi.ts");
  let changed = 0;
  for (const [k, v] of Object.entries(want)) {
    const q = Number(k), mark = Number(v);
    need(max.has(q), `السؤال ${q} غير موجود`);
    need(Number.isFinite(mark) && mark >= 0 && mark <= max.get(q)!, `درجة السؤال ${q} لازم بين 0 و${max.get(q)}`);
    const old = await one("question_marks", { item_id: itemId, q });
    if (old && Number(old.mark) === mark) continue;
    // كلها بصمت (طلبه 2026-11-27): الورقة اللي وصلت تتحدث درجتها، والطالب يوصله «تعديل درجة» من «📤 دز للطلاب»
    if (!held && it!.graded_at) await quietMark(itemId, it!, q, mark);
    else await put("question_marks", { item_id: itemId, q, mark });
    changed++;
  }
  const now = (await one("sched_items", { id: itemId }))!;
  return { changed, total: now.graded_at ? Number(now.total ?? 0) : await itemTotal(now) };
}

export async function aiReviewAction(body: Row) {
  const { authed } = await import("./webApi.ts");
  const uid = await authed(body?.initData, REVIEW_PERM);
  const a = String(body.action ?? "list");
  const { isAdmin } = await import("./data.ts");
  const owner = await isAdmin(uid);
  let notice = "";
  if (a === "cfg") {
    need(owner, "الإعداد بس لصاحب البوت", 403);
    const mode = body.mode === "before" ? "before" : "after";
    const hours = Math.round(Number(body.hours));
    need(hours >= 1 && hours <= 168, "المدة من ساعة لحد 168 ساعة (أسبوع)");
    await kvSet(CFG, JSON.stringify({ mode, hours }));
    // رجع «مباشرة»: اللي محجوزة توصل هسه
    if (mode === "after") for (const id of Object.keys(await heldMap())) await release(Number(id));
    notice = "✅ انحفظ الإعداد";
  } else if (a === "group") {
    const key = String(body.key ?? "");
    need(key === TEST_KEY || /^\d+\|(on|c\d+)\|[\d -:]+$/.test(key), "المجموعة غير موجودة");
    const seen = await readJson<string[]>(SEEN, []);
    if (!seen.includes(key)) await kvSet(SEEN, JSON.stringify([...seen, key].slice(-1000)));
    const g = (await groups()).find((x) => x.key === key);
    const papers = await groupPapers(key);
    // تعديلات صامتة (✏️ صحح) تنتظر «📤 دز للطلاب»
    const pend = await (await import("./gradeApi.ts")).pendingEdits();
    const pending = papers.filter((p) => pend[String(p.id)] !== undefined).length;
    return { group: g ? { ...g, pending } : null, papers, fileToken: (await import("./webAuth.ts")).fileToken(uid) };
  } else if (a === "save") {
    const r = await saveMarks(Number(body.item), body.marks);
    return { saved: r, notice: r.changed ? `✅ انحفظ، الدرجة ${r.total}` : "ما تغير شي" };
  } else if (a === "markFix" || a === "markHide" || a === "markAdd" || a === "markDrop" || a === "markReset") {
    // ✏️ تعديل التصحيح نفسه على الورقة: تبديل علامة، شيلها، إضافة علامته، أو رجوع لتصحيح الذكاء
    const item = Number(body.item);
    const it = await one("sched_items", { id: item });
    need(it && isAi(it), "الورقة غير موجودة");
    const qg = await import("./qusayGrade.ts");
    try {
      if (a === "markFix") await qg.fixMark(item, String(body.key ?? ""), body.kind, body.note);
      if (a === "markHide") await qg.hideMark(item, String(body.key ?? ""));
      if (a === "markAdd") await qg.addMark(item, body.ref, body.x, body.y, body.kind, body.note);
      if (a === "markDrop") await qg.dropAdded(item, Number(body.n));
      if (a === "markReset") await qg.resetMarks(item);
    } catch (e) { need(false, (e as Error).message); }
    return { paper: (await groupPapers(String(body.key2 ?? ""), item))[0] ?? null, notice: a === "markReset" ? "↩️ رجعت لتصحيح الذكاء" : "✅ انحفظ التصحيح" };
  } else if (a === "approve") {
    const key = String(body.key ?? "");
    const papers = await groupPapers(key);
    let n = 0;
    for (const p of papers) if (p.held && await release(p.id)) n++;
    // والأوراق اللي وصلت قبل وعدلتها بصمت: «تعديل درجة» يوصل هسه
    const e = await (await import("./gradeApi.ts")).sendPendingEdits(papers.map((p) => p.id));
    notice = n || e ? `✅ وصلت للطلاب: ${n ? `${n} درجة` : ""}${n && e ? " و" : ""}${e ? `${e} تعديل درجة` : ""}` : "ماكو شي ينتظر بهاي المجموعة";
  } else need(a === "list", "أمر غير معروف");
  return { cfg: await reviewCfg(), owner, groups: await groups(), notice };
}
