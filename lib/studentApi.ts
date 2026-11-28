// واجهة صفحة الطلاب: الأرقام، البحث، تعديل المعلومات، الحذف، وقوائم PDF
import { activeStop, liftStop, stopView } from "./checkpoints.ts";
import { deviceOf, unlockDevice } from "./deviceLock.ts";
import { find, one, remove, setSession, update, type Row, kvGet, kvSet } from "./db.ts";
import { activityOf, guardianOf, logActivity } from "./access.ts";
import { GOVS, GRADES, toLatinDigits } from "./config.ts";
import { areasWithCenters, can, centerName, isAdmin, placeOf, staffName, student } from "./data.ts";
import { deliverMsg, voiceOf } from "./directMsg.ts";
import { listPdf } from "./documents.ts";
import { deliverPassword } from "./password.ts";
import { saveStudent, studentFromForm } from "./student.ts";
import { api } from "./telegram.ts";
import { esc } from "./util.ts";
import { openException, startNowForTest } from "./examRoom.ts";
import { TEST_STUDENTS, addTestPaper, addTestStudent, giveTestChapter, deleteTests, inPersonTests, makeInPersonOne, makeInPersonSet, makeTests, startInPersonTest, startTestExam } from "./gradeApi.ts";
import { fileToken, homeToken, viewToken } from "./webAuth.ts";
import { studentPapers } from "./studentPapers.ts";
import { studentFile } from "./studentFile.ts";
import { aiWhyNot } from "./aiGrade.ts";
import { guardianState, whatsappOf } from "./guardianWatch.ts";
import { moveExam, retakeExam } from "./examMoves.ts";
import { prettyAt } from "./scheduleRules.ts";
import { studentCode } from "./inPerson.ts";
import QRCode from "qrcode";
import { SCHED_PERM, movePick, resetSchedule, setPerDay, setStudentHoliday, studentSchedule } from "./schedApi.ts";
import { authed, intOf, need } from "./webApi.ts";

export const STUDENTS_PERM = "students";
/** رسالة لطالب واحد أو لولي أمره من صفحة الطلاب */
export const MSG_PERM = "msg";
const RECENT = 100;

// 🧪 حسابات التجربة (طلبه 2026-11-26: «تنظف لي لوحة الطلاب، التجريبي يكون وحده»): طلاب التجربة (رقمهم سالب)
// والحسابات الحقيقية اللي أشّرها «🧪 حساب تجربة» (مثل رقمه 901) ما تطلع بالقائمة ولا البحث ولا الإحصاء ولا الطباعة،
// تطلع بس جوه «🧪 التجريب» آخر الصفحة
const TEST_ACCTS = "test_accounts";
export async function testAccountIds(): Promise<number[]> { try { const l = JSON.parse((await kvGet(TEST_ACCTS)) ?? "[]"); return Array.isArray(l) ? l.map(Number) : []; } catch { return []; } }
export async function isTestAccount(uid: number) { return uid < 0 || (await testAccountIds()).includes(uid); }
async function realStudents(): Promise<Row[]> { const t = new Set(await testAccountIds()); return (await find("students")).filter((r) => r.user_id > 0 && !t.has(Number(r.user_id))); }

export async function studentsStats() {
  const rows = await realStudents();
  const f = (col: string, v: string) => rows.filter((r) => r[col] === v).length;
  return { all: rows.length, g6: f("grade", GRADES[0]), g5: f("grade", GRADES[1]), in: f("exam", "حضوري"),
    on: f("exam", "إلكتروني"), ar: f("curr", "عربي"), en: f("curr", "إنجليزي") };
}
export async function sendStudentsPdf(chat: number, fifth: boolean) {
  const real = await realStudents();
  const rows = (fifth ? real.filter((r) => r.grade === GRADES[1]) : real).sort((a, b) => (fifth ? 0 : String(a.grade).localeCompare(String(b.grade))) || String(a.name).localeCompare(String(b.name), "ar"));
  return await listPdf(chat, fifth ? "طلاب الخامس العلمي" : "كل الطلاب المسجلين", ["الاسم", "الصف", "المنهج", "المحافظة", "الهاتف 1", "الهاتف 2", "الامتحان"],
    await Promise.all(rows.map(async (r) => [r.name, r.grade, r.curr, placeOf(r), r.phone1, r.phone2, (r.exam ?? "") + (r.center_id ? " - " + await centerName(r.center_id) : "")])),
    fifth ? "students_5th" : "students_all");
}
const view = async (s: Row, admin = false) => ({
  // رمز ولي الأمر يشوفه صاحب البوت بس
  gcode: admin ? await (await import("./guardianPin.ts")).issuedCode(s.user_id) : "",
  id: s.user_id, username: s.username ?? "", name: s.name, curr: s.curr, grade: s.grade, gov: s.gov, side: s.side ?? "", area: s.area,
  phone1: s.phone1, phone2: s.phone2, exam: s.exam ?? "", gender: s.gender ?? "", guardian: !!await guardianOf(s.user_id), pilot: await (await import("./appLink.ts")).isPilot(s.user_id), sos: (await (await import("./studentVis.ts")).sosIds()).includes(s.user_id), door: !!await one("door_links", { user_id: s.user_id }), app: !!await one("app_links", { uid: s.user_id }), pin: !!await one("guardian_pins", { user_id: s.user_id }) && !!await (await import("./guardianPin.ts")).issuedCode(s.user_id), gw: await guardianOf(s.user_id) ? await guardianState(s.user_id) : null, wa: whatsappOf(s.phone2), device: await deviceOf(s.user_id), stop: stopView(await activeStop(s.user_id)), centerId: s.center_id ?? 0, center: await centerName(s.center_id), created: s.created, updated: s.updated ?? "",
});

type Filters = { curr?: string; grade?: string; exam?: string; gov?: string };
/** البحث والفلاتر سوية. يرجع كل المطابقين، والصفحة تعرض أولهم */
async function matching(q: string, f: Filters) {
  const s = toLatinDigits(q.trim()).toLowerCase();
  const has = (v: unknown) => v !== null && String(v).toLowerCase().includes(s);
  const test = new Set(await testAccountIds());
  return await find("students", {}, {
    where: (r) => r.user_id > 0 && !test.has(Number(r.user_id)) && (!s || has(r.name) || has(r.phone1) || has(r.phone2)) && (!f.curr || r.curr === f.curr) && (!f.grade || r.grade === f.grade) && (!f.exam || r.exam === f.exam) && (!f.gov || r.gov === f.gov),
    order: s || f.curr || f.grade || f.exam || f.gov ? ["name"] : ["-created"],
  });
}
const filtersOf = (raw: unknown): Filters => { const f = (raw ?? {}) as Row; return { curr: f.curr || "", grade: f.grade || "", exam: f.exam || "", gov: f.gov || "" }; };
async function sendPicked(chat: number, title: string, rows: Row[]) {
  return await listPdf(chat, title, ["الاسم", "الصف", "المنهج", "المحافظة", "الهاتف 1", "الهاتف 2", "الامتحان"],
    await Promise.all(rows.map(async (r) => [r.name, r.grade, r.curr, placeOf(r), r.phone1, r.phone2, (r.exam ?? "") + (r.center_id ? " - " + await centerName(r.center_id) : "")])), "students");
}
/** طلاب التجربة: كل واحد ويا رابط يفتح صفحة امتحاناته كأنه هو */
async function testStudents() {
  const items = await find("sched_items"), access = await find("exam_access");
  return (await find("students")).filter((x) => x.user_id < 0).sort((a, b) => b.user_id - a.user_id).map((x) => {
    const mine = items.filter((i) => i.user_id === x.user_id);
    // الفصول اللي «مشتريها» من 📚، حتى صاحب البوت يعرف منو جاهز يجرب الجدول الخاص
    const chapters = access.filter((r) => r.user_id === x.user_id).map((r) => String(r.chapter));
    return { id: x.user_id as number, name: x.name as string, curr: String(x.curr ?? "عربي"), papers: mine.length, graded: mine.filter((i) => i.graded_at).length, chapters, link: `/store/myexams?t=${homeToken(x.user_id)}&owner=1` };
  });
}
async function pageData(q: string, f: Filters, uid = 0) {
  const found = await matching(q, f);
  const rows = found.slice(0, RECENT);
  const centers = await find("centers", { active: 1 }, { order: ["id"] });
  return {
    stats: await studentsStats(), results: await Promise.all(rows.map(async (r) => view(r, !!uid && await isAdmin(uid)))), found: found.length, limit: RECENT, govs: GOVS,
    areas: (await areasWithCenters()).map((a) => ({ id: a.id, gov: a.gov, name: a.name, centers: centers.filter((c) => c.area_id === a.id).map((c) => ({ id: c.id, name: c.name })) })),
    tests: uid && await isAdmin(uid) ? await testStudents() : null,
    // حسابات حقيقية أشّرها «🧪 حساب تجربة»: تطلع بس جوه «🧪 التجريب»
    testAccts: await Promise.all((await testAccountIds()).map((i) => one("students", { user_id: i })).map(async (p) => { const r = await p; return r ? await view(r, !!uid && await isAdmin(uid)) : null; })).then((l) => l.filter(Boolean)),
    canMsg: uid ? await can(uid, MSG_PERM) : false,
    testVersions: uid && await isAdmin(uid) ? await testVersions() : null,
  };
}
/** الامتحانات ونماذجها، حتى صاحب البوت يرفع عليها ورقة تجربة من صور حقيقية */
async function testVersions() {
  // مرتبة حسب الفصل، وداخل الفصل حسب ترتيب المواضيع
  const list = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)) || (a.pos ?? a.ord) - (b.pos ?? b.ord));
  const exams = new Map(list.map((e) => [e.id, e]));
  const order = [...exams.keys()];
  const qs = await find("bank_questions");
  return (await find("bank_versions", { kind: "mandatory" })).filter((v) => exams.has(v.exam_id))
    .sort((a, b) => order.indexOf(a.exam_id) - order.indexOf(b.exam_id) || String(a.model).localeCompare(String(b.model)))
    .map((v) => ({ id: v.id as number, exam: v.exam_id as number, slug: String(exams.get(v.exam_id)!.slug ?? ""), title: exams.get(v.exam_id)!.title as string, chapter: (exams.get(v.exam_id)!.chapter ?? "") as string, model: v.model as string,
      qs: qs.filter((q) => q.version_id === v.id).sort((a, b) => a.n - b.n).map((q) => ({ n: q.n as number, max: q.max_mark as number })) }))
    .filter((v) => v.qs.length);
}
/** «📩 رسالة»: كتابة أو فويس أو الاثنين، للطالب نفسه أو لولي أمره المربوط بالبوت. محمية ما تنحول */
async function messageAction(uid: number, form: FormData) {
  need(await can(uid, MSG_PERM), "ما عندك صلاحية الرسائل", 403);
  const id = Number(form.get("id"));
  const st = await student(id);
  need(st, "الطالب غير موجود");
  const toGuardian = form.get("to") === "guardian";
  const text = String(form.get("text") ?? "").trim().slice(0, 3000);
  const voice = voiceOf(form);
  need(text || voice, "اكتب رسالة أو سجل صوت");
  const g = toGuardian ? await guardianOf(id) : null;
  need(!toGuardian || g, "ولي أمره مو مربوط بالبوت. تگدر تراسله بالواتساب");
  const head = toGuardian ? `📩 <b>رسالة من قصي العميري</b>
بخصوص الطالب: <b>${esc(st!.name)}</b>` : "📩 <b>رسالة من قصي العميري</b>";
  await deliverMsg(toGuardian ? g!.guardian_id : id, `${head}${text ? `

${esc(text)}` : ""}`, voice);
  const by = await isAdmin(uid) ? "صاحب البوت" : await staffName(uid);
  const what = `${voice ? "فويس" : "رسالة"}${voice && text ? " ويا كتابة" : ""}`;
  await logActivity(id, toGuardian ? `📩 وصل ${what} لولي أمره من ${by}` : `📩 وصله ${what} من ${by}`);
  let f: Row = {};
  try { f = JSON.parse(String(form.get("filters") ?? "{}")); } catch { /* بدون فلاتر */ }
  return { ...await pageData(String(form.get("q") ?? ""), filtersOf(f), uid), notice: `✅ وصلت الرسالة ${toGuardian ? "لولي أمر" : "لـ"} ${st!.name}${id < 0 ? " (طالب تجربة، فوصلتك إنت)" : ""}` };
}
const TEST_MAX_PICS = 6, TEST_MAX_BYTES = 12 * 1024 * 1024;
/** رفع ورقة تجربة من صور حقيقية (صور جواب كل سؤال) */
export async function studentUpload(form: FormData) {
  const uid = await authed(form.get("initData"), STUDENTS_PERM);
  if (form.get("action") === "message") return await messageAction(uid, form);
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  need(form.get("action") === "testPaper", "أمر غير معروف");
  const byQ = new Map<number, Buffer[]>();
  for (const [k, v] of form.entries()) {
    const m = /^q_(\d+)$/.exec(k);
    if (!m || !(v instanceof File) || !v.size) continue;
    need(v.size <= TEST_MAX_BYTES, "صورة كبيرة هواية");
    const list = byQ.get(Number(m[1])) ?? [];
    need(list.length < TEST_MAX_PICS, `أكثر شي ${TEST_MAX_PICS} صور لكل سؤال`);
    list.push(Buffer.from(await v.arrayBuffer()));
    byQ.set(Number(m[1]), list);
  }
  const who = form.get("who") === "me" ? "me" : form.get("who") === "qusay" ? "qusay" : "ai";
  if (who === "qusay") {
    const Q = await import("./qusayGrade.ts");
    need(await Q.qgOn(), "«🧠 تصحيح قصي» طافي. شغله من صفحته أول");
    const why = await Q.versionWhyNot(Number(form.get("vid")));
    need(!why, `«🧠 تصحيح قصي» ما يگدر يصححها: ${why}`);
  }
  // ورقة تجربة لمؤمل: يصححها بأي موضوع (مثل قصي)، حتى لو الموضوع مو مأشر بصفحته. لازم بس خطوات الحل وخدمته شغالة (طلبه 2026-11-24)
  if (who === "ai") {
    const v = await one("bank_versions", { id: Number(form.get("vid")) });
    const why = v ? await aiWhyNot(v.exam_id, v.id) : null;
    need(!why || /مو مأشر/.test(why), `نظام التصحيح AI ما راح ياخذها: ${why}`);
  }
  const paperId = await addTestPaper(uid, Number(form.get("sid")), Number(form.get("vid")), byQ, who);
  // «⚡ هسه» لو «🌙 بالدفعة»: صاحب البوت يختار لكل ورقة تجربة
  const fast = who === "qusay" && form.get("now") !== "0";
  if (fast) await (await import("./qusayGrade.ts")).markNow([paperId]);
  const name = (await student(Number(form.get("sid"))))?.name ?? "";
  return { ...await pageData("", filtersOf({}), uid), notice: who === "qusay" ? `🧪 انرفعت ورقة ${name}. «🧠 تصحيح قصي» يصححها ${fast ? "خلال دقيقة أو دقيقتين" : "🌙 بالدفعة بنص الكلفة، خلال ساعة تقريباً (أكثر شي يوم)"}، ودرجتها توصلك بالبوت مثل ما توصل للطالب` : who === "ai" ? `🧪 انرفعت ورقة ${name}. نظام التصحيح AI ياخذها خلال دقيقة (إذا موضوعها مأشر وخطواته جاهزة وهو شغال)` : `🧪 انرفعت ورقة ${name}، وتنتظرك بـ ✍️ التصحيح` };
}

export async function studentAction(body: Row) {
  const uid = await authed(body?.initData, STUDENTS_PERM);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let notice = "";
  let tryCode: { k: number; img: string } | undefined;
  let tryCodes: { k: number; kind: string; img: string }[] | undefined;
  if (a === "save") {
    const old = await student(id);
    need(old, "الطالب غير موجود");
    const { errs, r } = await studentFromForm(body.form ?? {}, true);
    need(!errs.length, errs.join("، "));
    await saveStudent(id, old!.username, r, old);
    await logActivity(id, "✏️ الإدارة عدلت معلوماته");
    notice = "✅ انحفظت معلومات الطالب";
    if (r.center_id && r.center_id !== old!.center_id) {
      // الطالب يعرف بمركزه الجديد. إذا حاظر البوت، التعديل يبقى محفوظ
      try { await api("sendMessage", { chat_id: id, parse_mode: "HTML", text: `ℹ️ تم تغيير مركزك الامتحاني إلى: <b>${esc(await centerName(r.center_id))}</b>` }); } catch (e) { console.error(e); }
    }
  } else if (a === "del") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    await remove("students", { user_id: id });
    await remove("student_pass", { user_id: id });
    await remove("pass_requests", { user_id: id });
    await remove("exam_access", { user_id: id });   // إذا رجع يسجل، يبدي مثل طالب جديد
    await remove("guardians", { student_id: id });
    await remove("schedules", { user_id: id });
    await remove("sched_items", { user_id: id });
    await logActivity(id, "🗑 انحذف تسجيله من الإدارة");
    await setSession(id, "", {});
    notice = "🗑 انحذف تسجيله. لمن يفتح البوت يسجل من جديد، وطلباته القديمة باقية";
  } else if (a === "pass") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    need(await deliverPassword(id), "ما وصلت الرسالة، يمكن الطالب حاظر البوت. كلمته القديمة باقية");
    notice = "✅ وصلت الكلمة الجديدة للطالب بالبوت";
  } else if (a === "pdf") {
    // الملف ما يوصل إلا بطلب: الكل، أو نتيجة البحث والفلاتر، أو المحددين
    let rows: Row[];
    if (body.kind === "picked") {
      const ids = new Set(Array.isArray(body.ids) ? (body.ids as unknown[]).map(Number) : []);
      need(ids.size, "حدد طالب واحد على الأقل");
      rows = await find("students", {}, { where: (r) => ids.has(r.user_id), order: ["name"] });
    } else rows = body.kind === "found" ? await matching(String(body.q ?? ""), filtersOf(body.filters)) : await find("students", {}, { order: ["grade", "name"] });
    need(rows.length, "ماكو طلاب بهذا الاختيار");
    need(await sendPicked(uid, `قائمة الطلاب (${rows.length})`, rows), "ما گدرت أرسل الملف، حاول مرة ثانية");
    notice = "✅ الملف وصلك بمحادثة البوت";
  } else if (a === "log") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, log: { id, rows: await activityOf(id) } };
  } else if (a === "file") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, file: { id, fileToken: fileToken(uid), canEdit: await can(uid, "editgrade") && await can(uid, "grade"), ...await studentFile(id) } };
  } else if (a === "papers") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, papers: { id, list: await studentPapers(id), fileToken: fileToken(uid) } };
  } else if (a === "sched") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id), view: `/store/myexams?t=${viewToken(id)}&view=1` } };
  } else if (a === "schedHol") {
    // الإدارة تغير عطلة طالب الجدول الخاص مباشرة، وجدوله ينعاد من باجر
    need(await isAdmin(uid) || await can(uid, SCHED_PERM), "ما عندك صلاحية الجدول", 403);
    const from = String(body.holFrom ?? ""), to = String(body.holTo ?? "");
    const t = await setStudentHoliday(id, { from, to });
    await (await import("./telegram.ts")).send(id, `🏖 <b>تغيرت عطلتك</b>: ${t}، وانعاد جدولك من باجر. افتح امتحاناتي وشوف المواعيد.`);
    notice = `🏖 تغيرت عطلته: ${t}`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id), view: `/store/myexams?t=${viewToken(id)}&view=1` } };
  } else if (a === "schedPick") {
    // الإدارة تغير وقت يوم من أيام طالب «ويا الطلاب» بأي وقت. إذا الوقت مكتمل، تنبيه وبعدها تگدر تثبته فوك العدد
    need(await isAdmin(uid) || await can(uid, SCHED_PERM), "ما عندك صلاحية الجدول", 403);
    const msg = await movePick(id, Number(body.d), String(body.time ?? ""), "owner", body.force === true);
    await (await import("./telegram.ts")).send(id, `🕐 <b>تغير وقت امتحاناتك</b>
${msg.replace("✅ ", "")}. افتح امتحاناتي وشوف المواعيد.`);
    notice = `${msg.replace("وقتك", "وقته").replace("امتحاناتك", "امتحاناته")}، ووصله خبر`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id), view: `/store/myexams?t=${viewToken(id)}&view=1` } };
  } else if (a === "examException") {
    await openException(uid, body.item);
    notice = "🔓 انفتح الامتحان للطالب، ووصله الخبر";
  } else if (a === "examRetake") {
    notice = `🔁 انحطت الإعادة ${prettyAt(await retakeExam(uid, body.item, body.at, body.where))}، ووصل الطالب خبر`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id), view: `/store/myexams?t=${viewToken(id)}&view=1` } };
  } else if (a === "examMove") {
    notice = `⏩ صار موعده ${prettyAt(await moveExam(uid, body.item, body.at))}، ووصل الطالب خبر`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id), view: `/store/myexams?t=${viewToken(id)}&view=1` } };
  } else if (a === "makeTests" || a === "deleteTests") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    if (a === "makeTests") { const n = await makeTests(); need(n, "ماكو نسخة إجبارية جاهزة بيها صور أسئلة"); notice = `🧪 انضافوا ${TEST_STUDENTS} طلاب تجربة، و${n} ورقة تنتظر التصحيح`; }
    else { await deleteTests(); notice = "🗑 انمسحوا طلاب التجربة وأوراقهم"; }
  } else if (a === "addTest") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const curr = body.curr === "إنجليزي" ? "إنجليزي" : "عربي";
    notice = `➕ انضاف طالب تجربة ${await addTestStudent(curr)} (منهج ${curr})`;
  } else if (a === "testCurr") {
    // يبدل منهج طالب التجربة: عربي ↔ إنجليزي
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const sid = Number(body.sid);
    need(sid < 0 && await one("students", { user_id: sid }), "اختار طالب تجربة");
    const curr = body.curr === "إنجليزي" ? "إنجليزي" : "عربي";
    await update("students", { user_id: sid }, { curr });
    notice = `✅ صار منهجه ${curr}`;
  } else if (a === "testChapter") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const sid = Number(body.sid), chapter = String(body.chapter ?? "");
    await giveTestChapter(sid, chapter);
    // جدوله ينفتح من جديد، حتى يختار الجدول الخاص ويرتبه ويا الفصل الجديد
    await resetSchedule(sid);
    notice = `📚 ${(await student(sid))?.name ?? "طالب التجربة"} صار مشتري ${chapter}، وجدوله مفتوح يرتبه. افتح امتحاناته كطالب (تنفتح صفحة «📝 امتحاناتي» مالته مباشرة)`;
  } else if (a === "tryInPerson") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const k = await startInPersonTest(Number(body.center), Number(body.vid), !!body.late);
    // كود حضوره مثل كود الطالب الحقيقي: يطلع على الشاشة، وكاميرا جهاز الحضور تقراه
    tryCode = { k, img: await QRCode.toDataURL(studentCode(-k), { margin: 2, width: 320 }) };
    notice = `🎫 طالب حضوري تجريبي ${k} جاهز${body.late ? "، وموعده بعد 3 ساعات" : ""}. اكتب الرقم ${k} بالمحطة أو بصفحة 🎫 الحضوري`;
  } else if (a === "tryInPersonKind" || a === "tryInPersonList") {
    // ✅ / ⏰ / 🚫: طالب جديد من النوع اللي يختاره، وبعدها كل طلاب التجربة بهذا المركز بأكوادهم
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    let made = 0;
    if (a === "tryInPersonKind") made = await makeInPersonOne(Number(body.center), Number(body.vid), String(body.kind) as "now" | "late" | "none" | "ipad");
    const list = await inPersonTests(Number(body.center), Number(body.vid));
    const { siteBase } = await import("./keyboards.ts");
    // 📱 طالب الآيباد: رابط صفحة امتحاناته (كأنه الطالب نفسه) حتى يفتحها صاحب البوت بالآيباد ويشوف الأسئلة تنفتح
    tryCodes = await Promise.all(list.map(async (x) => {
      const open = x.kind === "ipad" ? `${siteBase()}/store/myexams?t=${encodeURIComponent(homeToken(-x.k))}&owner=1` : "";
      return { ...x, img: await QRCode.toDataURL(studentCode(-x.k), { margin: 2, width: 480 }), ...(open ? { open, openImg: await QRCode.toDataURL(open, { margin: 2, width: 480 }) } : {}) };
    }));
    if (made) notice = `🎫 طالب حضوري تجريبي ${made} جاهز. دوس على اسمه تحت حتى يطلع كوده كبير، ووجه عليه الكاميرا`;
  } else if (a === "tryInPersonSet") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const list = await makeInPersonSet(Number(body.center), Number(body.vid));
    tryCodes = await Promise.all(list.map(async (x) => ({ ...x, img: await QRCode.toDataURL(studentCode(-x.k), { margin: 2, width: 320 }) })));
    notice = `👥 جاهزين ${list.length} طلاب حضوريين. وجه كاميرا 🎫 الحضوري على كود كل واحد`;
  } else if (a === "tryExam") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    await startTestExam(Number(body.sid), Number(body.vid));
    notice = "📝 بدا الامتحان";
  } else if (a === "examNow") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    await startNowForTest(body.item);
    notice = "▶️ الامتحان بدا هسه للتجربة";
  } else if (a === "schedReset") {
    await resetSchedule(id);
    notice = "✅ انفتح جدوله، والطالب يرتبه من جديد";
  } else if (a === "perDay") {
    await setPerDay(id, intOf(body.value, 0, 10, "اكتب رقم من 0 إلى 10"));
    notice = "✅ انحفظ حد الامتحانات باليوم لهذا الطالب";
  } else if (a === "liftStop") {
    await liftStop(id, uid);
    notice = "✅ انفك الإيقاف، ووصل الطالب خبر";
  } else if (a === "unlockDevice") {
    await unlockDevice(id);
    notice = "🔓 انفك قفل الجهاز. أول جهاز يفتح صفحاته ينقفل عليه";
  } else if (a === "pilot") {
    // يجرب التطبيق الجديد (البوت داخل التطبيق)، والباقين يبقى عدهم القديم
    const { setPilot } = await import("./appLink.ts");
    const n = await setPilot(id, !!body.on);
    await logActivity(id, body.on ? "🧪 صار يجرب التطبيق الجديد" : "🧪 رجع للتطبيق القديم");
    notice = body.on ? `🧪 صار يجرب التطبيق الجديد. يطلعله من يفتح التطبيق مرة ثانية. عدد اللي يجربون: ${n}` : `↩️ رجع للتطبيق القديم. عدد اللي يجربون: ${n}`;
  } else if (a === "sos") {
    // طوارئ لهذا الطالب بس: يشوف البوت كله
    const { setSos } = await import("./studentVis.ts");
    await setSos(id, !!body.on);
    await logActivity(id, body.on ? "🚨 انفتحله البوت كله (طوارئ)" : "🚨 انشالت الطوارئ عنه");
    notice = body.on ? "🚨 انفتحله البوت كله. بتليگرام إذا عنده، أو برابط المتصفح" : "✅ انشالت الطوارئ عنه";
  } else if (a === "doorMake") {
    // رابط بالمتصفح للطالب (بدل التطبيق إذا خربان عنده): يبطل القديم، ويفتحله البوت (طوارئ)
    const { makeDoor } = await import("./doorLink.ts");
    const { setSos } = await import("./studentVis.ts");
    const st = await student(id);
    need(st, "الطالب غير موجود", 404);
    const link = await makeDoor(id, String(st!.name ?? ""), body.fresh === true);
    await setSos(id, true);
    await logActivity(id, "🔗 انعمله رابط بالمتصفح");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice: "🔗 انعمل الرابط. انسخه ودزه للطالب (واتساب أو أي طريقة). أول مرة يفتحه يحط رمز سري من 4 أرقام.", doorLink: link, doorFor: id };
  } else if (a === "doorRevoke") {
    const { revokeDoor } = await import("./doorLink.ts");
    await revokeDoor(id);
    await logActivity(id, "🔗 انبطل رابطه بالمتصفح");
    notice = "⛔ انبطل الرابط، وما يشتغل بعد. الطوارئ تبقى مثل ما هي، شيلها إذا تريد";
  } else if (a === "signPhotos") {
    // صور توقيع ولي الأمر بوجهه (مشفرة)، لصاحب البوت يراجعها
    const { signPhotos } = await import("./guardianPin.ts");
    return { photos: await signPhotos(id) };
  } else if (a === "issuePin") {
    // رمز ولي الأمر: صاحب البوت بس يصنعه ويشوفه، وينطيه لولي الأمر
    need(await isAdmin(uid), "رمز ولي الأمر لصاحب البوت بس", 403);
    need(await student(id), "الطالب غير موجود");
    const { issuePin } = await import("./guardianPin.ts");
    const code = await issuePin(id);
    notice = `🔑 رمز ولي الأمر: ${code}. انطيه لولي الأمر بس. يفتح بيه «👨‍👧 ولي الأمر» بتطبيق ابنه. الرمز القديم بطل`;
  } else if (a === "resetPin") {
    const { resetPin } = await import("./guardianPin.ts");
    await resetPin(id);
    await logActivity(id, "🔐 الإدارة صفّرت رمز ولي الأمر");
    notice = "✅ انشال رمز ولي الأمر. حتى يرجع يفتح، اصنعله رمز جديد من «🔑 رمز ولي الأمر»";
  } else if (a === "unlink") {
    await remove("guardians", { student_id: id });
    await remove("guardian_pins", { user_id: id });
    await logActivity(id, "👨‍👧 الإدارة فكت ربط ولي الأمر");
    notice = "✅ انفك الربط. الطالب يگدر يدز الرابط لولي أمر ثاني";
  } else if (a === "testAcct") {
    // 🧪 «حساب تجربة»: يختفي من القائمة الحقيقية ويطلع جوه «🧪 التجريب»
    need(await isAdmin(uid), "بس صاحب البوت", 403);
    need(await student(id), "الطالب غير موجود");
    const list = (await testAccountIds()).filter((x) => x !== id);
    await kvSet(TEST_ACCTS, JSON.stringify(body.on ? [...list, id] : list));
    notice = body.on ? "🧪 صار حساب تجربة: ما يطلع بالقائمة، تلگاه جوه «🧪 التجريب» آخر الصفحة" : "✅ رجع حساب حقيقي";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, tryCode, tryCodes };
}
