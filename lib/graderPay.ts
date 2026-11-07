// تعويض المصححين: لكل مصحح أجر للورقة الإجبارية وأجر للاختيارية، وخصم لكل اعتراض انقبل على ورقته.
// الرصيد هو اللي ما انحاسب بعد، والتسوية تصفره وتنحفظ بالأرشيف. أوراق التجربة ما تنحسب
import { find, insert, kvGet, kvSet, one, put, update, type Row } from "./db.ts";
import { isAdmin, staffName } from "./data.ts";
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
  return { mandatory: r?.mandatory ?? 0, optional: r?.optional ?? 0, deduct: r?.deduct ?? 0 };
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
export async function gradeScope(uid: number) {
  const mine = await chaptersOf(uid), off = new Set(await examsOffOf(uid)), pl = await placesOf(uid);
  const chapter = new Map((await find("bank_exams")).map((e) => [e.id, e.chapter]));
  const sched = new Map((await find("schedules")).map((s) => [s.user_id, s]));
  const keys = new Set(pl.keys);
  const isGeneral = (p: Row) => sched.get(p.user_id)?.mode === "general";
  return {
    isGeneral,
    can: (p: Row) => {
      if (mine.length && !mine.includes(chapter.get(p.exam_id))) return false;
      if (off.has(p.exam_id)) return false;
      if (p.user_id < 0 || p.kind === "optional") return true;   // التجربة والاختياري ما إلهم مكان
      if (!isGeneral(p)) return pl.private;
      if (pl.all) return true;
      const c = Number(sched.get(p.user_id)?.center_id ?? 0), s = slotOf(p.at);
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
  const objs = (await find("objections", { status: "accepted" })).filter((o) => ids.has(o.item_id) && !o.paid_id);
  const mand = papers.filter((p) => p.kind !== "optional").length, opt = papers.length - mand;
  // الاعتراض ينحسب على الورقة: سؤال واحد انقبل أو خمسة، يبقى اعتراض واحد على المصحح
  const obj = new Set(objs.map((o) => o.item_id)).size;
  return {
    rate, mand, opt, obj,
    amount: mand * rate.mandatory + opt * rate.optional - obj * rate.deduct,
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
  return { id: uid, name: await staffName(uid), chapters: await chaptersOf(uid), off: await examsOffOf(uid), places: await placesOf(uid), rate: b.rate, mand: b.mand, opt: b.opt, obj: b.obj, amount: b.amount, archive: await archiveOf(uid) };
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
    await put("grader_pay", { user_id: id, mandatory: money(body.mandatory, "أجر الإجباري"), optional: money(body.optional, "أجر الاختياري"), deduct: money(body.deduct, "خصم الاعتراض"), chapters: JSON.stringify(chapters.length === all.length ? [] : chapters), exams_off: JSON.stringify(off), places });
    return "✅ انحفظ";
  }
  const b = await balanceOf(id);
  need(b.paperIds.length || b.objIds.length, "ماكو شي ينحاسب");
  // صاحب البوت يختار: يخصم الاعتراضات اللي انقبلت، لو يسامحه بيها
  const forgive = !!body.forgive && b.obj > 0;
  const amount = forgive ? b.amount + b.obj * b.rate.deduct : b.amount;
  const sid = await insert("grader_settlements", { user_id: id, n_mand: b.mand, n_opt: b.opt, n_obj: b.obj, amount, forgiven: forgive ? 1 : 0, created: stamp(), by_id: uid });
  for (const p of b.paperIds) await update("sched_items", { id: p }, { paid_id: sid });
  for (const o of b.objIds) await update("objections", { id: o }, { paid_id: sid });
  const parts = [b.mand ? `${b.mand} ورقة إجبارية` : "", b.opt ? `${b.opt} ورقة اختيارية` : "", b.obj ? (forgive ? `${b.obj} اعتراض انقبل وما انخصم` : `خصم ${b.obj} اعتراض انقبل`) : ""].filter(Boolean).join("، ");
  await send(id, `💵 <b>قصي العميري دفعلك ${amount.toLocaleString("en")} دينار</b>\nعن تصحيح: ${parts}.\nرصيدك هسه صفر.`);
  return `✅ انحاسب ${await staffName(id)}: ${amount.toLocaleString("en")} دينار${forgive ? "، بدون خصم الاعتراضات" : ""}`;
}

// ---------- خبر للمصحح: من توصل أوراق جديدة من فصوله، أكثر شي مرة كل نص ساعة حتى ما تكثر الرسائل
const PING_GAP = 30;
export async function notifyGraders() {
  const papers = (await find("sched_items", { status: "done" })).filter((p) => !p.graded_at);
  if (!papers.length) return 0;
  const now = stamp().slice(0, 16);
  let sent = 0;
  for (const g of await graders()) {
    const scope = await gradeScope(g);
    const list = papers.filter((p) => (!p.grader_id || p.grader_id === g) && scope.can(p));
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
