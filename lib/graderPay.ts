// تعويض المصححين: لكل مصحح أجر للورقة الإجبارية وأجر للاختيارية، وخصم لكل اعتراض انقبل على ورقته.
// الرصيد هو اللي ما انحاسب بعد، والتسوية تصفره وتنحفظ بالأرشيف. أوراق التجربة ما تنحسب
import { aiHeld, aiPartialOf, graderShare } from "./aiGrade.ts";
import { find, insert, kvGet, kvSet, one, put, update, type Row } from "./db.ts";
import { AI_GRADER, QUSAY_GRADER, isAdmin, staffIds, staffName } from "./data.ts";
import { ADMIN_IDS } from "./config.ts";
import { send } from "./telegram.ts";
import { addMinutes } from "./scheduleRules.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

const money = (v: unknown, what: string) => {
  const n = Number(v ?? 0);
  need(Number.isInteger(n) && n >= 0 && n <= 1_000_000, `${what} لازم رقم كامل بالدينار`);
  return n;
};
export async function rateOf(uid: number) {
  const r = await one("grader_pay", { user_id: uid });
  return { mandatory: r?.mandatory ?? 0, optional: r?.optional ?? 0, deduct: r?.deduct ?? 0, fine: r?.fine ?? 0, weight: Number(r?.weight) > 0 ? Number(r!.weight) : 1 };
}

// ---------- حصة كل مصحح باليوم وغرامته (طلب الأستاذ 2026-11-22)
// حصة المصحح من امتحان بيوم = أوراق الامتحان بذاك اليوم ÷ المصححين اللي يگدرون يصححوه (بالعدد، مو نسبة).
// «قدرته»: مصحح ×1.5 ياخذ مرة ونص من غيره (مثلاً 1000 ورقة و10 مصححين: هو 143 والباقين 95 تقريباً).
// بالأصل يكمل بعد حصته حتى يعوض البطيئين، وبكل امتحان صاحب البوت يگدر يخليه «يوقف من يوصل حصته».
// الغرامة: يوم ما وصل بيه حصته، والأوراق بعدها ما خلصت بنهاية اليوم (إذا غيره عوض عنه، ماكو غرامة)
const STOP_KEY = "grade_quota_stop";
export async function quotaStop(): Promise<number[]> { try { const j = JSON.parse((await kvGet(STOP_KEY)) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; } }
export async function setQuotaStop(exam: number, on: boolean) {
  const l = new Set(await quotaStop());
  if (on) l.add(exam); else l.delete(exam);
  await kvSet(STOP_KEY, JSON.stringify([...l]));
}
/** يوم الورقة: يوم امتحانها */
export const dayOf = (p: Row) => String(p.at ?? p.submitted_at ?? "").slice(0, 10);
/** أوراق المصححين (مو التجربة ولا اللي صححها الذكاء) */
const humanPaper = (p: Row) => p.user_id > 0 && p.status === "done" && p.grader_id !== AI_GRADER && p.grader_id !== QUSAY_GRADER;
export const humanGraders = async () => (await staffIds("grade")).filter((id) => !ADMIN_IDS.includes(id));
export type DayQuota = { target: number; done: number; open: number; exams: Map<number, { target: number; done: number; n: number; graders: number }> };
/** حصص يوم: لكل مصحح، شگد لازم يصحح وشگد صحح، وكم ورقة من امتحاناته بقت ما مصححة بنهاية اليوم */
// حصص اليوم تنحسب مرة بالدقيقة (صفحة الحساب تطلبها لكل مصحح ولكل يوم)
const quotaCache = new Map<string, { at: number; q: Map<number, DayQuota> }>();
export async function dayQuotas(day: string, papersAll?: Row[]): Promise<Map<number, DayQuota>> {
  const hit = quotaCache.get(day);
  if (hit && Date.now() - hit.at < 60_000) return hit.q;
  const q = await computeQuotas(day, papersAll);
  quotaCache.set(day, { at: Date.now(), q });
  return q;
}
export const clearQuotaCache = () => quotaCache.clear();
async function computeQuotas(day: string, papersAll?: Row[]): Promise<Map<number, DayQuota>> {
  const papers = (papersAll ?? await find("sched_items", { status: "done" })).filter((p) => humanPaper(p) && dayOf(p) === day);
  const ids = await humanGraders();
  const scopes = new Map(await Promise.all(ids.map(async (id) => [id, await gradeScope(id)] as const)));
  const byExam = new Map<number, Row[]>();
  for (const p of papers) byExam.set(p.exam_id, [...byExam.get(p.exam_id) ?? [], p]);
  const out = new Map<number, DayQuota>(ids.map((id) => [id, { target: 0, done: 0, open: 0, exams: new Map() }]));
  for (const [exam, list] of byExam) {
    const can = ids.filter((id) => list.some((p) => scopes.get(id)!.can(p)));
    if (!can.length) continue;
    const w = new Map(await Promise.all(can.map(async (id) => [id, (await rateOf(id)).weight] as const)));
    const sum = can.reduce((t, id) => t + w.get(id)!, 0);
    const open = list.filter((p) => !p.graded_at || String(p.graded_at).slice(0, 10) > day).length;
    for (const id of can) {
      const share = Math.ceil(list.length * w.get(id)! / sum);
      const q = out.get(id)!;
      const done = list.filter((p) => p.grader_id === id && p.graded_at).length;
      q.exams.set(exam, { target: share, done, n: list.length, graders: can.length });
      q.target += share; q.done += done; q.open += open;
    }
  }
  return out;
}
/** الأيام اللي عليه بيها غرامة وما انحاسبت: ما وصل حصته والأوراق ما خلصت. من يوم انحطت الغرامة، لحد البارحة */
export async function fineDays(uid: number, papersAll?: Row[]) {
  const r = await one("grader_pay", { user_id: uid });
  if (!r?.fine || !r.fine_from) return [];
  const paid = new Set<string>((await find("grader_settlements", { user_id: uid })).flatMap((s) => { try { return JSON.parse(String(s.fine_days ?? "[]")) as string[]; } catch { return []; } }));
  const today = stamp().slice(0, 10);
  const papers = papersAll ?? await find("sched_items", { status: "done" });
  const days = [...new Set(papers.filter(humanPaper).map(dayOf))].filter((d) => d && d >= String(r.fine_from) && d < today && !paid.has(d)).sort();
  const out: { day: string; target: number; done: number }[] = [];
  for (const d of days) {
    const q = (await dayQuotas(d, papers)).get(uid);
    if (q && q.target > 0 && q.done < q.target && q.open > 0) out.push({ day: d, target: q.target, done: q.done });
  }
  return out;
}
/** الفصول اللي يصححها المصحح. فارغة يعني كل الفصول. صاحب البوت يصحح كلشي */
export async function chaptersOf(uid: number): Promise<string[]> {
  if (await isAdmin(uid)) return [];
  try { const j = JSON.parse((await one("grader_pay", { user_id: uid }))?.chapters || "[]"); return Array.isArray(j) ? j.map(String) : []; } catch { return []; }
}
/** المواضيع (الامتحانات) اللي صاحب البوت شالها من المصحح داخل فصوله */
export async function examsOffOf(uid: number): Promise<number[]> {
  if (await isAdmin(uid)) return [];
  try { const j = JSON.parse((await one("grader_pay", { user_id: uid }))?.exams_off || "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; }
}
// ---------- أماكن المصحح: للجدول العام يتحدد بالمنطقة والمركز والوقت، وللجدول الخاص بالفصول والمواضيع
export type Places = { all: boolean; keys: string[]; private: boolean };
const ALL_PLACES: Places = { all: true, keys: [], private: true };
export async function placesOf(uid: number): Promise<Places> {
  if (await isAdmin(uid)) return ALL_PLACES;
  try {
    const j = JSON.parse((await one("grader_pay", { user_id: uid }))?.places || "null");
    return j ? { all: j.all !== false, keys: Array.isArray(j.keys) ? j.keys.map(String) : [], private: j.private !== false } : ALL_PLACES;
  } catch { return ALL_PLACES; }
}
/** اليوم (0 = الاثنين) والساعة من موعد الامتحان */
const slotOf = (at: string) => { const d = new Date(String(at).slice(0, 10) + "T00:00:00Z"); return { d: (d.getUTCDay() + 6) % 7, t: String(at).slice(11, 16) }; };
/** شنو يگدر يصحح هذا المصحح: فصوله ومواضيعه، والجدول العام بأماكنه وأوقاته، والخاص إذا مسموح إله */
// «هذا الامتحان لهذول المصححين بس»: صاحب البوت يختار امتحان ومصححين، ولحد وقت يحدده (أو لحد ما يشيلها).
// الباقين ما تطلعلهم أوراق هذا الامتحان، وبعد الوقت يرجع مثل قبل
export type GradeOnly = Record<string, { ids: number[]; until: string }>;
const ONLY_KEY = "grade_only";
export async function gradeOnly(): Promise<GradeOnly> {
  let all: GradeOnly = {};
  try { all = JSON.parse((await kvGet(ONLY_KEY)) ?? "{}") ?? {}; } catch { /* خربانة */ }
  const now = stamp();
  return Object.fromEntries(Object.entries(all).filter(([, r]) => !r.until || r.until > now));
}
export async function setGradeOnly(exam: number, ids: number[], until: string) {
  const all = await gradeOnly();
  if (ids.length) all[exam] = { ids, until }; else delete all[exam];
  await kvSet(ONLY_KEY, JSON.stringify(all));
}
// ---------- أوراق الاستثناء والتعويض (طلب الأستاذ 2026-11-20): كل امتحان مو ويا الطلاب بوقتهم
// (الإدارة فتحتله، إعادة، تقديم موعد، تعويض، جا للمركز بغير وقته) يروح للمصححين اللي يختارهم صاحب البوت:
// مصححين لكل الفصول، ولكل فصل مصححين غيرهم إذا يريد. إذا ما اختار أحد: تروح حسب مركز الطالب (بدون ما يطابق الوقت)
export type OutCfg = { ids: number[]; chapters: Record<string, number[]> };
const OUT_KEY = "grade_out";
export const outOf = (p: Row) => p.kind === "catchup" || p.kind === "early" || !!p.retake_of || !!p.exc_by || p.fixed === "moved";
export async function outCfg(): Promise<OutCfg> {
  try {
    const j = JSON.parse((await kvGet(OUT_KEY)) ?? "{}") ?? {};
    const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter(Boolean))] : []);
    return { ids: ids(j.ids), chapters: Object.fromEntries(Object.entries(j.chapters ?? {}).map(([c, v]) => [c, ids(v)]).filter(([, v]) => (v as number[]).length)) };
  } catch { return { ids: [], chapters: {} }; }
}
export const setOutCfg = async (c: OutCfg) => await kvSet(OUT_KEY, JSON.stringify(c));
/** مصححين أوراق الاستثناء لهذا الفصل: مصححين الفصل إذا محددين، وإلا مصححين كل الفصول */
export const outGraders = (c: OutCfg, chapter: unknown) => c.chapters[String(chapter ?? "")] ?? c.ids;

export async function gradeScope(uid: number) {
  const mine = await chaptersOf(uid), off = new Set(await examsOffOf(uid)), pl = await placesOf(uid);
  const only = await gradeOnly(), boss = await isAdmin(uid), out = await outCfg();
  const chapter = new Map((await find("bank_exams")).map((e) => [e.id, e.chapter]));
  const sched = new Map((await find("schedules")).map((s) => [s.user_id, s]));
  const keys = new Set(pl.keys);
  const isGeneral = (p: Row) => sched.get(p.user_id)?.mode === "general";
  return {
    isGeneral,
    can: (p: Row) => {
      if (p.user_id > 0 && outOf(p)) {
        const list = outGraders(out, chapter.get(p.exam_id));
        if (list.length) return boss || list.includes(uid);
      }
      if (mine.length && !mine.includes(chapter.get(p.exam_id))) return false;
      if (off.has(p.exam_id)) return false;
      if (!boss && only[p.exam_id] && !only[p.exam_id].ids.includes(uid)) return false;
      if (p.user_id < 0 || p.kind === "optional") return true;   // التجربة والاختياري ما إلهم مكان
      if (!isGeneral(p)) return pl.private;
      if (pl.all) return true;
      const c = Number(sched.get(p.user_id)?.center_id ?? 0), s = slotOf(p.at);
      // الاستثناء والتعويض بوقت غير أوقات المركز: لأي مصحح على هذا المركز
      if (outOf(p) && pl.keys.some((k) => k === `c${c}` || k.startsWith(`c${c}|`))) return true;
      return keys.has(`c${c}`) || keys.has(`c${c}|${s.d}|${s.t}`);
    },
  };
}
/** المناطق ومراكزها وأوقاتها، والإلكتروني، حتى صاحب البوت يأشر عليها */
export async function placeTree() {
  const slotsOf = async (cid: number) => (JSON.parse((await one("place_slots", { center_id: cid }))?.slots || "[]") as { d: number; t: string }[]).sort((a, b) => ((a.d + 2) % 7) - ((b.d + 2) % 7) || a.t.localeCompare(b.t));
  const areas = [{ id: 0, name: "💻 الإلكتروني", centers: [{ id: 0, name: "الإلكتروني", slots: await slotsOf(0) }] }];
  const centers = await find("centers", { active: 1 });
  for (const a of await find("areas", { active: 1 })) {
    const list = centers.filter((c) => c.area_id === a.id);
    if (list.length) areas.push({ id: a.id as number, name: a.name as string, centers: await Promise.all(list.map(async (c) => ({ id: c.id as number, name: c.name as string, slots: await slotsOf(c.id) }))) });
  }
  return areas;
}

/** كل المواضيع مرتبة حسب الكتاب، حتى صاحب البوت يشيل منها */
export const allTopics = async () => (await find("bank_exams", {}, { order: ["pos", "ord"] })).filter((e) => e.chapter).map((e) => ({ id: e.id as number, title: e.title as string, chapter: e.chapter as string }));
export const allChapters = async () => [...new Set((await find("bank_exams", {}, { order: ["pos", "ord"] })).map((e) => e.chapter as string).filter(Boolean))];

/** اللي ما انحاسب: الأوراق اللي صححها، والاعتراضات اللي انقبلت على أوراقه */
export async function balanceOf(uid: number) {
  const rate = await rateOf(uid);
  const mine = await find("sched_items", { grader_id: uid });
  const papers = mine.filter((p) => p.graded_at && !p.paid_id);
  const ids = new Set(mine.map((p) => p.id));
  // الاعتراض على سؤال صححه نظام التصحيح AI ما ينحسب على المصحح
  const parts = new Map(await Promise.all([...ids].map(async (id) => [id, await aiPartialOf(id)] as const)));
  const objs = (await find("objections", { status: "accepted" })).filter((o) => ids.has(o.item_id) && !o.paid_id && (!parts.get(o.item_id) || parts.get(o.item_id)!.includes(o.q)));
  // الورقة اللي حوّلها نظام التصحيح AI بس كم سؤال منها: ينحسب منها على قد أسئلته (مثلاً 2 من 5 = 0.4 ورقة)
  const shares = await Promise.all(papers.map((p) => graderShare(p)));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const mand = round2(papers.reduce((t, p, i) => t + (p.kind !== "optional" ? shares[i] : 0), 0));
  const opt = round2(papers.reduce((t, p, i) => t + (p.kind === "optional" ? shares[i] : 0), 0));
  // الاعتراض ينحسب على الورقة: سؤال واحد انقبل أو خمسة، يبقى اعتراض واحد على المصحح
  const obj = new Set(objs.map((o) => o.item_id)).size;
  const fines = await fineDays(uid);
  return {
    rate, mand, opt, obj, fines,
    amount: Math.round(mand * rate.mandatory + opt * rate.optional - obj * rate.deduct - fines.length * rate.fine),
    paperIds: papers.map((p) => p.id as number), objIds: objs.map((o) => o.id as number),
  };
}

const archiveOf = async (uid: number) => (await find("grader_settlements", { user_id: uid }, { order: ["-id"], limit: 12 }))
  .map((s) => ({ id: s.id, mand: s.n_mand, opt: s.n_opt, obj: s.n_obj, forgiven: !!s.forgiven, amount: s.amount, created: s.created }));

/** المصححين: كل اللي عدهم صلاحية التصحيح، ويا أجورهم ورصيدهم */
export async function graders() {
  return (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes("grade")).map((s) => s.user_id as number);
}
export async function card(uid: number) {
  const b = await balanceOf(uid);
  return { id: uid, name: await staffName(uid), chapters: await chaptersOf(uid), off: await examsOffOf(uid), places: await placesOf(uid), rate: b.rate, mand: b.mand, opt: b.opt, obj: b.obj, fines: b.fines, amount: b.amount, archive: await archiveOf(uid), contract: await (await import("./graderContract.ts")).signedOf(uid) };
}

/** صفحة التعويض: صاحب البوت يشوف كل المصححين ويعدل أجورهم ويسوي تسوية، والمصحح يشوف حسابه بس */
export async function payData(uid: number) {
  if (await isAdmin(uid)) return { all: true, chapters: await allChapters(), topics: await allTopics(), places: await placeTree(), graders: await Promise.all((await graders()).map(card)) };
  return { all: false, chapters: [], topics: [], places: [], graders: [await card(uid)] };
}

export async function payAction(uid: number, body: Row) {
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  const id = Number(body.grader);
  need((await graders()).includes(id), "هذا مو مصحح");
  if (body.action === "setRate") {
    const all = await allChapters();
    const chapters = Array.isArray(body.chapters) ? [...new Set((body.chapters as unknown[]).map(String))] : [];
    need(chapters.every((c) => all.includes(c)), "فصل غير معروف");
    const topics = new Set((await allTopics()).map((t) => t.id));
    const old = await one("grader_pay", { user_id: id });
    // اللي ما انبعث يبقى مثل ما هو
    const off = Array.isArray(body.off) ? [...new Set((body.off as unknown[]).map(Number))] : await examsOffOf(id);
    need(off.every((x) => topics.has(x)), "موضوع غير معروف");
    let places = old?.places ?? null;
    if (body.places && typeof body.places === "object") {
      const pl = body.places as Row;
      const valid = new Set<string>();
      for (const a of await placeTree()) for (const c of a.centers) { valid.add(`c${c.id}`); for (const sl of c.slots) valid.add(`c${c.id}|${sl.d}|${sl.t}`); }
      const keys = Array.isArray(pl.keys) ? [...new Set((pl.keys as unknown[]).map(String))] : [];
      need(keys.every((k) => valid.has(k)), "مكان أو وقت غير معروف");
      places = JSON.stringify({ all: pl.all !== false, keys: pl.all === false ? keys : [], private: pl.private !== false });
    }
    // الغرامة تبدي تنحسب من يوم انحطت (مو على الأيام اللي قبلها)
    const fine = body.fine === undefined ? Number(old?.fine ?? 0) : money(body.fine, "غرامة اليوم");
    const weight = body.weight === undefined ? (Number(old?.weight) > 0 ? Number(old!.weight) : 1) : Number(body.weight);
    need(weight >= 0.2 && weight <= 5, "قدرة المصحح بين ×0.2 و ×5");
    const fine_from = fine ? (old?.fine && old?.fine_from ? old.fine_from : stamp().slice(0, 10)) : null;
    await put("grader_pay", { user_id: id, mandatory: money(body.mandatory, "أجر الإجباري"), optional: money(body.optional, "أجر الاختياري"), deduct: money(body.deduct, "خصم الاعتراض"), chapters: JSON.stringify(chapters.length === all.length ? [] : chapters), exams_off: JSON.stringify(off), places, fine, fine_from, weight: Math.round(weight * 100) / 100 });
    return "✅ انحفظ";
  }
  const b = await balanceOf(id);
  need(b.paperIds.length || b.objIds.length || b.fines.length, "ماكو شي ينحاسب");
  // صاحب البوت يختار: يخصم الاعتراضات اللي انقبلت، لو يسامحه بيها. ونفس الشي الغرامات
  const forgive = !!body.forgive && b.obj > 0;
  const forgiveFine = !!body.forgiveFine && b.fines.length > 0;
  const amount = b.amount + (forgive ? b.obj * b.rate.deduct : 0) + (forgiveFine ? b.fines.length * b.rate.fine : 0);
  const sid = await insert("grader_settlements", { user_id: id, n_mand: b.mand, n_opt: b.opt, n_obj: b.obj, amount, forgiven: forgive ? 1 : 0, created: stamp(), by_id: uid, fine_days: JSON.stringify(b.fines.map((f) => f.day)), fine_forgiven: forgiveFine ? 1 : 0 });
  for (const p of b.paperIds) await update("sched_items", { id: p }, { paid_id: sid });
  for (const o of b.objIds) await update("objections", { id: o }, { paid_id: sid });
  const parts = [b.mand ? `${b.mand} ورقة إجبارية` : "", b.opt ? `${b.opt} ورقة اختيارية` : "", b.obj ? (forgive ? `${b.obj} اعتراض انقبل وما انخصم` : `خصم ${b.obj} اعتراض انقبل`) : "",
    b.fines.length ? (forgiveFine ? `${b.fines.length} يوم ما وصلت بيه حصتك وما انغرمت` : `غرامة ${b.fines.length} يوم ما وصلت بيه حصتك (${b.fines.map((f) => `${f.day}: ${f.done} من ${f.target}`).join("، ")})`) : ""].filter(Boolean).join("، ");
  await send(id, `💵 <b>قصي العميري دفعلك ${amount.toLocaleString("en")} دينار</b>\nعن تصحيح: ${parts}.\nرصيدك هسه صفر.`);
  return `✅ انحاسب ${await staffName(id)}: ${amount.toLocaleString("en")} دينار${forgive ? "، بدون خصم الاعتراضات" : ""}`;
}

// ---------- خبر للمصحح: من توصل أوراق جديدة من فصوله، أكثر شي مرة كل نص ساعة حتى ما تكثر الرسائل
const PING_GAP = 30;
export async function notifyGraders() {
  const all = (await find("sched_items", { status: "done" })).filter((p) => !p.graded_at);
  // أوراق ينتظرها نظام التصحيح AI ما ينبلغ بيها أحد
  const held = await aiHeld(all);
  for (const id of await (await import("./qusayGrade.ts")).qusayHeld(all)) held.add(id);
  const papers = all.filter((p) => !held.has(p.id));
  if (!papers.length) return 0;
  const now = stamp().slice(0, 16);
  let sent = 0;
  for (const g of await graders()) {
    const scope = await gradeScope(g);
    const list = papers.filter((p) => p.grader_id === g || (!p.grader_id && scope.can(p)));
    let last: { at?: string; top?: string } = {};
    try { last = JSON.parse(await kvGet(`grader_ping_${g}`) ?? "{}"); } catch { /* خربانة */ }
    const top = list.reduce((m, p) => (String(p.submitted_at ?? "") > m ? String(p.submitted_at) : m), "");
    // ماكو ورقة جديدة من آخر خبر، أو لسه ما مر نص ساعة
    if (!list.length || top <= (last.top ?? "") || (last.at && now < addMinutes(last.at, PING_GAP))) continue;
    const gen = list.filter((p) => scope.isGeneral(p)).length;
    await send(g, `📥 <b>وصلتك أوراق للتصحيح</b>
عندك هسه <b>${list.length}</b> ورقة تنتظر: ${gen} من الجدول العام و${list.length - gen} من الجدول الخاص.

افتح لوحة التحكم ← ✍️ التصحيح.`);
    await kvSet(`grader_ping_${g}`, JSON.stringify({ at: now, top }));
    sent++;
  }
  return sent;
}
