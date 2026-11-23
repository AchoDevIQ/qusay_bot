// صفحة «🧠 تصحيح قصي»: صاحب البوت (أو المساعد اللي عنده صلاحيته) يشغله ويطفيه، يجربه بالسر على أوراق صححها
// مصحح ويقارن، يختار المواضيع اللي يصححها صدگ، ويشوف شگد صرف. ما بيها شي من صفحة نظام التصحيح AI مال مؤمل
import { find, one, type Row } from "./db.ts";
import { can } from "./data.ts";
import { aiSettings } from "./aiGrade.ts";
import { hasKey } from "./booklets.ts";
import {
  IQD, QG_PERM, STYLE_MAX, clearTrialQueue, examStyle, setExamStyle, forgetTrial, pendingBatches, qgLog, qgOn, qgResultOf, qgRetry, qgSettings, queueTrial,
  humanMark, marksByPage, addInk, inkFor, inkList, removeInk, marksWaiting, qgMarksOf, queueMarks, saveQgSettings, sendSaved, setQgOn, spentFrom, trialCandidates, trialQueue, versionWhyNot, stepsIn, hiddenMarks, hideMark, dropHidden, pmap, pickCandidates, lessonsOf, teach, forgetLesson, shownResult, type QgResult,
} from "./qusayGrade.ts";
import { stamp } from "./util.ts";
import { docxNotes, notesKind } from "./notesFile.ts";
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
  // كل القراءات سوة مو وحدة ورا وحدة: الصفحة چانت تاخذ دقايق تحمل (طلبه 2026-11-23)
  const results = new Map<number, QgResult>();
  await pmap(items, 40, async (it) => { const r = await qgResultOf(it.id); if (r) results.set(it.id, r); });
  const queued = new Set(await trialQueue());
  const chapters: { slug: string; chapter: string; exams: Row[] }[] = [];
  for (const e of exams) if (!chapters.some((x) => x.slug === e.slug)) chapters.push({ slug: e.slug, chapter: e.chapter ?? e.slug, exams: [] });
  const rows = await pmap(exams, 8, async (e) => {
    const vs = versions.filter((v) => v.exam_id === e.id);
    let why: string | null = vs.length ? null : "ماكو نماذج";
    const whys = await Promise.all(vs.map((v) => versionWhyNot(v.id)));
    const bad = vs.findIndex((_, k) => whys[k]);
    if (bad >= 0) why = `نموذج ${vs[bad].model}: ${whys[bad]}`;
    const trials = items.filter((it) => it.exam_id === e.id && results.get(it.id)?.kind === "trial");
    // درجة المصحح من الورقة هسه: الورقة الجديدة اللي تجربت قبل ما يصححها، درجته تطلع من يصححها
    const both = trials.filter((it) => humanMark(it) !== null).map((it) => ({ ...results.get(it.id)!, human: humanMark(it) }));
    const gaps = both.map((r) => Math.abs(r.total - Number(r.human)));
    const tried = (id: number) => results.has(id);
    return { slug: e.slug, row: {
      id: e.id, title: e.title, why, live: s.live.includes(e.id), mu: mu.has(e.id),
      human: pickCandidates(items, tried, queued, e.id).length, fresh: pickCandidates(items, tried, queued, e.id, true).length, trials: trials.length, waiting: trials.length - both.length,
      gap: gaps.length ? r1(gaps.reduce((t, g) => t + g, 0) / gaps.length) : null,
      close: gaps.length ? Math.round((gaps.filter((g) => g <= 3).length / gaps.length) * 100) : null,
      unsure: both.filter((r) => !r.sure).length,
      style: await examStyle(e.id),
      lessons: (await lessonsOf(e.id)).map((x) => ({ id: x.id, at: x.at, q: x.q, step: x.step, from: x.from, to: x.to, max: x.max, why: x.why })),
    } };
  });
  for (const r of rows) chapters.find((x) => x.slug === r.slug)!.exams.push(r.row);
  const titles = new Map(exams.map((e) => [e.id as number, String(e.title ?? "")]));
  const trialRows = [];
  trialRows.push(...await pmap(items.filter((x) => results.get(x.id)?.kind === "trial").sort((a, b) => String(results.get(b.id)!.at).localeCompare(String(results.get(a.id)!.at))).slice(0, SHOW), 20, async (it) => {
    const r = results.get(it.id)!;
    return { id: it.id, name: await nameOf(it), exam: titles.get(it.exam_id) ?? "", human: humanMark(it), qusay: r.total, sure: r.sure, iqd: iqd(r.usd), at: r.at };
  }));
  const paid = [...results.values()].slice(-100);
  return {
    on: await qgOn(), key: hasKey(), settings: s, fileToken: fileToken(uid), objStaff: await objStaff(),
    spent: { today: iqd(spentFrom(log, day)), month: iqd(spentFrom(log, day.slice(0, 7))), all: iqd(spentFrom(log, "")), capIqd: iqd(s.cap) },
    perPaper: paid.length ? r1(paid.reduce((t, r) => t + r.usd, 0) / paid.length * IQD) : null,
    sent: log.filter((r) => r.kind === "sent").length, unsure: log.filter((r) => r.kind === "unsure").length,
    trialLeft: (await trialQueue()).length, batches: await pendingBatches(),
    chapters, trials: trialRows,
    // «✅ ابعث درجته»: الورقة اللي رجعها للمصححين ودرجتها محفوظة وبعدها ما انصححت
    log: await Promise.all(log.slice(-SHOW).reverse().map(async (r) => {
      let canSend = false;
      if (r.kind === "unsure" && r.item) { const res = await qgResultOf(r.item); const it = await one("sched_items", { id: r.item }); canSend = !!res && !res.sent && !!it && !it.graded_at && !it.grader_id; }
      return { ...r, iqd: r.usd ? iqd(r.usd) : null, usd: undefined, canSend };
    })),
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
  // 🖍 العلامات على الورقة: من التصحيح نفسه إذا كانت شغالة، وإلا من «🖍 جرب العلامات» إذا سواها
  // «🖍 جرب العلامات» الأحدث يطلع هو (قبل: الورقة اللي إلها علامات قديمة چانت تعرض القديم وتتجاهل الجديد، طلبه 2026-11-23)
  const { demo, fresh } = await shownResult(id);
  const mk = fresh ?? (r!.pages?.length ? { qs: r!.qs, pages: r!.pages } : null);
  const raw = fresh ? fresh.qs : r!.qs;
  // كله بالعربي حتى بصفحتك (طلبه 2026-11-23): خطواتك الإنجليزية تنعرض مترجمة بكلمات الكتاب
  const flat = await stepsIn("ar", raw.flatMap((q) => q.steps.map((st) => st.text)));
  let k = 0;
  const shown = raw.map((q) => ({ ...q, steps: q.steps.map((st) => ({ ...st, text: flat[k++] })) }));
  const ink = mk ? await inkFor(Number(it!.exam_id)) : [];
  const hidden = await hiddenMarks(id);
  return {
    id, name: await nameOf(it!), exam: String((await one("bank_exams", { id: it!.exam_id }))?.title ?? ""), kind: r!.kind, human: r!.kind === "trial" ? humanMark(it!) : r!.human ?? null,
    total: fresh && it!.user_id < 0 ? fresh.total : r!.total, sure: r!.sure, iqd: iqd(r!.usd), batch: r!.batch, sent: !!r!.sent,
    qs: shown.map((q) => ({ ...q, human: r!.kind === "trial" && humanMark(it!) !== null && marks.has(q.n) ? marks.get(q.n)! : null,
      marked: mk ? dropHidden(marksByPage(mk.qs, mk.pages, q.n, answers.filter((a) => Number(a.q) === q.n).map((a) => String(a.file)), ink), hidden) : null })),
    photos: answers.map((a) => ({ q: Number(a.q) || 0, ref: String(a.file) })),
    demo: demo ? { at: demo.at, total: demo.total, iqd: iqd(demo.usd) } : null, demoWaiting: await marksWaiting(id),
  };
}

/** اللي يگدرون يردون على الاعتراضات: المساعدين اللي عندهم صلاحية «الاعتراضات» */
async function objStaff() {
  const { find: f } = await import("./db.ts");
  const { staffName } = await import("./data.ts");
  return Promise.all((await f("staff")).filter((x) => String(x.perms ?? "").split(",").includes("objections")).map(async (x) => ({ id: Number(x.user_id), name: await staffName(Number(x.user_id)) })));
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
    if (body.model === "haiku" || body.model === "sonnet" || body.model === "opus") p.model = body.model;
    if (typeof body.batch === "boolean") p.batch = body.batch;
    if (typeof body.carry === "boolean") p.carry = body.carry;
    if (body.unsure === "send" || body.unsure === "graders") p.unsure = body.unsure;
    if (typeof body.marks === "boolean") p.marks = body.marks;
    if (typeof body.style === "string") p.style = body.style.slice(0, STYLE_MAX);
    if (body.cap !== undefined) { const c = Number(body.cap); need(c > 0 && c <= 100, "الحد اليومي بين 0.1 و 100 دولار"); p.cap = c; }
    if (body.obj === "qusay" || body.obj === "person") p.obj = body.obj;
    if (body.objTo !== undefined) { const to = Number(body.objTo) || 0; need(to === 0 || (await objStaff()).some((x) => x.id === to), "هذا ما عنده صلاحية الاعتراضات"); p.objTo = to; }
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
  if (a === "tidy") {
    const r = await (await import("./qusayGrade.ts")).tidyNotes(String(body.text ?? ""));
    return await out(`🪄 رتبته (${Math.max(1, Math.round(r.usd * IQD))} دينار). اقراه وصلّح اللي تريده، وبعدين احفظ`, { tidy: r.text });
  }
  // «📄 ارفع ملف»: Word ببلاش (المعادلات تصير x² و 3/x²)، PDF لو صورة يقراه الذكاء حرف بحرف. يرجع النص للمربع، والحفظ بـ 💾
  if (a === "notesFile") {
    const name = String(body.name ?? "");
    const kind = notesKind(name);
    need(kind, "ارفع ملف Word (docx) لو PDF لو صورة");
    const buf = Buffer.from(String(body.b64 ?? ""), "base64");
    need(buf.length > 100, "الملف فارغ");
    need(buf.length <= 15 * 1024 * 1024, "الملف أكبر من 15 ميگا، قسمه");
    if (kind === "docx") {
      let text = "";
      try { text = docxNotes(buf); } catch (e) { fail(e); }
      return await out("📄 انقرا الملف (ببلاش). تأكد من المعادلات تحت المربع، وبعدين 💾 احفظ العبارات", { tidy: text.slice(0, STYLE_MAX) });
    }
    const r = await (await import("./qusayGrade.ts")).readNotesScan(kind as "pdf" | "image", name, buf.toString("base64"));
    return await out(`📄 انقرا الملف (${Math.max(1, Math.round(r.usd * IQD))} دينار). تأكد منه، وبعدين 💾 احفظ العبارات`, { tidy: r.text });
  }
  if (a === "examStyle") {
    need(await one("bank_exams", { id: exam }), "اختار الموضوع");
    await setExamStyle(exam, String(body.style ?? ""));
    return await out("✅ انحفظت عبارات هذا الموضوع");
  }
  if (a === "trialClear") { await clearTrialQueue(); return await out("انمسحت الأوراق اللي تنتظر التجربة"); }
  if (a === "forget") { const n = await forgetTrial(exam); return await out(`انمسحت نتائج ${n} تجربة بهذا الموضوع، تگدر تعيدها`); }
  if (a === "paper") return await out("", { paper: await paperDetail(Number(body.id)) });
  // «✏️ صلّح وعلّمه»: درجة الخطوة الصح وليش. جوابه يصير قاعدة بهذا الموضوع
  if (a === "teach") {
    let r: Awaited<ReturnType<typeof teach>> = { official: null, n: 0 };
    try { r = await teach(Number(body.id), Number(body.q), Number(body.i), Number(body.mark), String(body.why ?? "")); } catch (e) { fail(e); }
    // درجته وصلت: تتغير الرسمية، ويوصله هو وولي أمره (مثل الاعتراض المقبول)
    const fx = r.official ? await (await import("./gradeApi.ts")).ownerFixMark(Number(body.id), r.official.q, r.official.mark) : null;
    return await out(`🧠 تعلمها: من هسه يصحح هيچ بهذا الموضوع (${r.n} قاعدة من تصحيحاتك).${fx ? ` ودرجة الطالب صارت ${fx.total} من 100، ووصله هو وولي أمره.` : ""}`, { paper: await paperDetail(Number(body.id)) });
  }
  if (a === "hideMark") {
    try { await hideMark(Number(body.id), String(body.key ?? "")); } catch (e) { fail(e); }
    return await out("🗑 انشالت العلامة من الورقة، والدرجة مثل ما هي", { paper: await paperDetail(Number(body.id)) });
  }
    // ⚖️ قارن: نفس الأوراق يصححها مؤمل وقصي بالسر، وتنقارن بدرجة المصحح البشري
  if (a === "compare" || a === "compareView" || a === "compareClear" || a === "compareRedoQ") {
    need(await one("bank_exams", { id: exam }), "اختار الموضوع");
    const Q = await import("./qusayGrade.ts");
    let notice = "";
    if (a === "compare") {
      const n = await Q.queueCompare(exam, Number(body.n));
      need(n > 0, "ماكو أوراق جاهزة بهذا الموضوع (صححها مصحح، لو أوراق طلاب تجربة) وبعدها ما انقارنت");
      notice = `⚖️ ${n} ورقة تنتظر المقارنة. كل دقيقة ورقتين: الاثنين يصححوها بالسر${(await qgOn()) ? "" : ". شغّل «تصحيح قصي» حتى تبدي"}. بعدها دوس 📊 شوف النتائج.`;
    }
    if (a === "compareRedoQ") notice = `🔁 قصي يعيد ${await Q.redoQusayCompare(exam)} ورقة (مؤمل يبقى مثل ما هو). بعد كم دقيقة دوس 📊 شوف النتائج.`;
        if (a === "compareClear") notice = `🗑 انمسحت نتائج ${await Q.clearCompare(exam)} ورقة`;
    return await out(notice, { cmp: { exam, rows: await Q.compareRows(exam, nameOf) } });
  }
  if (a === "lessonDel") { await forgetLesson(exam, Number(body.lesson)); return await out("🗑 انمسحت هاي القاعدة"); }
  if (a === "sendSaved") {
    const { finishByAi } = await import("./gradeApi.ts");
    try { await sendSaved(Number(body.id), finishByAi); } catch (e) { fail(e); }
    return await out("✅ انبعثت درجته، ووصلت بطاقة الدرجة");
  }
  if (a === "marks") {
    try { await queueMarks(Number(body.id)); } catch (e) { fail(e); }
    return await out(`🖍 تنتظر. خلال دقيقة لو دقيقتين يعيد تصحيحها ويرسم العلامات على الورقة (⚡ هسه، كلفة ورقة وحدة)${(await qgOn()) ? "" : ". شغّل «تصحيح قصي» أول حتى يبدي"}. درجتها الأصلية ما تتغير. بعدها دوس 🔄 حدّث وافتح 👁 مرة ثانية.`, { paper: await paperDetail(Number(body.id)) });
  }
  // «✍️ خط إيدي»: العام (exam=0) أو الخاص بموضوع
  // 🖋 خذ خطي من الأوراق اللي صححتها بإيدي بهذا الموضوع
  if (a === "harvestExam") {
    const ex = Number(body.exam) || 0;
    need(ex > 0 && await one("bank_exams", { id: ex }), "اختار الموضوع");
    const { queueExam, examplesOf } = await import("./inkHarvest.ts");
    const n = await queueExam(ex);
    return await out(n ? `🖋 ${n} ورقة صححتها بإيدك تنقرا (ورقتين كل دقيقة): علاماتك وملاحظاتك تنضاف لخطك بهذا الموضوع، ودرجاتك تصير أمثلة لتصحيح قصي.` : `ماكو أوراق جديدة صححتها بإيدك بالقلم بهذا الموضوع. عنده هسه ${(await examplesOf(ex)).length} ورقة من تصحيحك.`, { inkOf: { exam: ex, items: await inkList(ex) } });
  }
  if (a === "inkList" || a === "inkAdd" || a === "inkDel") {
    const ex = Number(body.exam) || 0;
    if (ex) need(await one("bank_exams", { id: ex }), "الموضوع غير موجود");
    let notice = "";
    if (a === "inkAdd") { try { await addInk(ex, body.item); } catch (e) { fail(e); } notice = "✅ انرفعت بخطك"; }
    if (a === "inkDel") { await removeInk(ex, Number(body.id)); notice = "🗑 انمسحت"; }
    return await out(notice, { inkOf: { exam: ex, items: await inkList(ex) } });
  }
  if (a === "retry") { try { await qgRetry(Number(body.id)); } catch (e) { fail(e); } return await out("🔁 يعيد يجربها بالدكة الجاية"); }
  throw new ApiError(400, "أمر غير معروف");
}
