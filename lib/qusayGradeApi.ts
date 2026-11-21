// صفحة «🧠 تصحيح قصي»: صاحب البوت (أو المساعد اللي عنده صلاحيته) يشغله ويطفيه، يجربه بالسر على أوراق صححها
// مصحح ويقارن، يختار المواضيع اللي يصححها صدگ، ويشوف شگد صرف. ما بيها شي من صفحة نظام التصحيح AI مال مؤمل
import { find, one, type Row } from "./db.ts";
import { can } from "./data.ts";
import { aiSettings } from "./aiGrade.ts";
import { hasKey } from "./booklets.ts";
import {
  IQD, QG_PERM, clearTrialQueue, forgetTrial, pendingBatches, qgLog, qgOn, qgResultOf, qgRetry, qgSettings, queueTrial,
  humanMark, saveQgSettings, setQgOn, spentFrom, trialCandidates, trialQueue, versionWhyNot, type QgResult,
} from "./qusayGrade.ts";
import { stamp } from "./util.ts";
import { ApiError, authed, need } from "./webApi.ts";
import { fileToken } from "./webAuth.ts";

const SHOW = 60;
const iqd = (usd: number) => Math.round(usd * IQD);
const nameOf = async (it: Row) => (await one("students", { user_id: it.user_id }))?.name ?? (it.user_id < 0 ? `طالب تجربة ${-it.user_id}` : "طالب");
const r1 = (x: number) => Math.round(x * 10) / 10;

async function listData(uid: number) {
  const s = await qgSettings();
  const mu = new Set((await aiSettings()).exams);
  const log = await qgLog();
  const day = stamp().slice(0, 10);
  const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord));
  const versions = await find("bank_versions");
  const items = await find("sched_items", { status: "done" });
  // نتائج «تصحيح قصي» لكل الأوراق المصححة أو اللي جربها
  const results = new Map<number, QgResult>();
  for (const it of items) { const r = await qgResultOf(it.id); if (r) results.set(it.id, r); }
  const chapters: { slug: string; chapter: string; exams: Row[] }[] = [];
  for (const e of exams) {
    let c = chapters.find((x) => x.slug === e.slug);
    if (!c) { c = { slug: e.slug, chapter: e.chapter ?? e.slug, exams: [] }; chapters.push(c); }
    const vs = versions.filter((v) => v.exam_id === e.id);
    let why: string | null = vs.length ? null : "ماكو نماذج";
    for (const v of vs) { const w = await versionWhyNot(v.id); if (w) { why = `نموذج ${v.model}: ${w}`; break; } }
    const trials = items.filter((it) => it.exam_id === e.id && results.get(it.id)?.kind === "trial");
    // درجة المصحح من الورقة هسه: الورقة الجديدة اللي تجربت قبل ما يصححها، درجته تطلع من يصححها
    const both = trials.filter((it) => humanMark(it) !== null).map((it) => ({ ...results.get(it.id)!, human: humanMark(it) }));
    const gaps = both.map((r) => Math.abs(r.total - Number(r.human)));
    c.exams.push({
      id: e.id, title: e.title, why, live: s.live.includes(e.id), mu: mu.has(e.id),
      human: (await trialCandidates(e.id)).length, fresh: (await trialCandidates(e.id, true)).length, trials: trials.length, waiting: trials.length - both.length,
      gap: gaps.length ? r1(gaps.reduce((t, g) => t + g, 0) / gaps.length) : null,
      close: gaps.length ? Math.round((gaps.filter((g) => g <= 3).length / gaps.length) * 100) : null,
      unsure: both.filter((r) => !r.sure).length,
    });
  }
  const titles = new Map(exams.map((e) => [e.id as number, String(e.title ?? "")]));
  const trialRows = [];
  for (const it of items.filter((x) => results.get(x.id)?.kind === "trial").sort((a, b) => String(results.get(b.id)!.at).localeCompare(String(results.get(a.id)!.at))).slice(0, SHOW)) {
    const r = results.get(it.id)!;
    trialRows.push({ id: it.id, name: await nameOf(it), exam: titles.get(it.exam_id) ?? "", human: humanMark(it), qusay: r.total, sure: r.sure, iqd: iqd(r.usd), at: r.at });
  }
  const paid = [...results.values()].slice(-100);
  return {
    on: await qgOn(), key: hasKey(), settings: s, fileToken: fileToken(uid),
    spent: { today: iqd(spentFrom(log, day)), month: iqd(spentFrom(log, day.slice(0, 7))), all: iqd(spentFrom(log, "")), capIqd: iqd(s.cap) },
    perPaper: paid.length ? r1(paid.reduce((t, r) => t + r.usd, 0) / paid.length * IQD) : null,
    sent: log.filter((r) => r.kind === "sent").length, unsure: log.filter((r) => r.kind === "unsure").length,
    trialLeft: (await trialQueue()).length, batches: await pendingBatches(),
    chapters, trials: trialRows,
    log: log.slice(-SHOW).reverse().map((r) => ({ ...r, iqd: r.usd ? iqd(r.usd) : null, usd: undefined })),
  };
}

/** تفاصيل ورقة: درجة «تصحيح قصي» لكل سؤال وكل خطوة وليش، جنب درجة المصحح، وصور جواب الطالب */
async function paperDetail(id: number) {
  const it = await one("sched_items", { id });
  need(it, "الورقة غير موجودة");
  const r = await qgResultOf(id);
  need(r, "«تصحيح قصي» بعده ما صحح هاي الورقة");
  const marks = new Map((await find("question_marks", { item_id: id })).map((m) => [Number(m.q), Number(m.mark)]));
  const answers = await find("exam_answers", { item_id: id }, { order: ["q", "id"] });
  return {
    id, name: await nameOf(it!), exam: String((await one("bank_exams", { id: it!.exam_id }))?.title ?? ""), kind: r!.kind, human: r!.kind === "trial" ? humanMark(it!) : r!.human ?? null,
    total: r!.total, sure: r!.sure, iqd: iqd(r!.usd), batch: r!.batch, sent: !!r!.sent,
    qs: r!.qs.map((q) => ({ ...q, human: r!.kind === "trial" && humanMark(it!) !== null && marks.has(q.n) ? marks.get(q.n)! : null })),
    photos: answers.map((a) => ({ q: Number(a.q) || 0, ref: String(a.file) })),
  };
}

export async function qusayAction(body: Row) {
  const uid = await authed(body?.initData, QG_PERM);
  need(await can(uid, QG_PERM), "ما عندك صلاحية «🧠 تصحيح قصي»", 403);
  const a = String(body.action ?? "list");
  const exam = Number(body.exam);
  const fail = (e: unknown): never => { throw e instanceof ApiError ? e : new ApiError(400, e instanceof Error ? e.message : String(e)); };
  const out = async (notice = "", extra: Row = {}) => ({ ...await listData(uid), notice, ...extra });
  if (a === "list") return await out();
  if (a === "on") {
    need(hasKey() || !body.on, "مفتاح الذكاء الاصطناعي مو محطوط بالسيرفر");
    await setQgOn(!!body.on);
    return await out(body.on ? "🧠 «تصحيح قصي» شغال" : "«تصحيح قصي» طافي، وما يصرف شي");
  }
  if (a === "live") {
    const e = await one("bank_exams", { id: exam });
    need(e, "الموضوع غير موجود");
    const s = await qgSettings();
    if (body.on) {
      need(!(await aiSettings()).exams.includes(exam), "هذا الموضوع يصححه نظام التصحيح AI مال مؤمل. شيله من صفحته أول");
      for (const v of await find("bank_versions", { exam_id: exam })) { const w = await versionWhyNot(v.id); need(!w, `نموذج ${v.model}: ${w}`); }
    }
    await saveQgSettings({ live: body.on ? [...new Set([...s.live, exam])] : s.live.filter((x) => x !== exam) });
    return await out(body.on ? `✅ «تصحيح قصي» يصحح «${e!.title}» صدگ` : `«${e!.title}» رجع للمصححين`);
  }
  if (a === "settings") {
    const p: Row = {};
    if (body.effort === "low" || body.effort === "medium") p.effort = body.effort;
    if (typeof body.batch === "boolean") p.batch = body.batch;
    if (typeof body.carry === "boolean") p.carry = body.carry;
    if (body.cap !== undefined) { const c = Number(body.cap); need(c > 0 && c <= 100, "الحد اليومي بين 0.1 و 100 دولار"); p.cap = c; }
    await saveQgSettings(p);
    return await out("✅ انحفظ");
  }
  if (a === "trial") {
    need(await one("bank_exams", { id: exam }), "اختار الموضوع");
    const fresh = body.fresh === true;
    const now = body.now === true;
    const n = await queueTrial(exam, Number(body.n), fresh, now);
    need(n > 0, fresh ? "ماكو أوراق جديدة سلمها الطلاب بهذا الموضوع وبعدها ما تصححت (أو باقي خطوات)" : "ماكو أوراق صححها مصحح بهذا الموضوع وبعدها ما تجربت (أو باقي خطوات)");
    const on = await qgOn();
    return await out(`🧪 ${n} ورقة ${fresh ? "جديدة " : ""}تنتظر التجربة.${fresh ? " تبقى عند المصححين مثل ما هي، ولا شي يوصل للطالب." : ""} ${!on ? "شغّل «تصحيح قصي» حتى تبدي." : now || !(await qgSettings()).batch ? "تبدي خلال دقيقة، وكل دقيقة 6 أوراق." : "🌙 بالدفعة: نص الكلفة، ونتيجتها تطلع خلال ساعة تقريباً (أكثر شي يوم)."}`);
  }
  if (a === "trialClear") { await clearTrialQueue(); return await out("انمسحت الأوراق اللي تنتظر التجربة"); }
  if (a === "forget") { const n = await forgetTrial(exam); return await out(`انمسحت نتائج ${n} تجربة بهذا الموضوع، تگدر تعيدها`); }
  if (a === "paper") return await out("", { paper: await paperDetail(Number(body.id)) });
  if (a === "retry") { try { await qgRetry(Number(body.id)); } catch (e) { fail(e); } return await out("🔁 يعيد يجربها بالدكة الجاية"); }
  throw new ApiError(400, "أمر غير معروف");
}
