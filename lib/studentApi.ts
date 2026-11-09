// واجهة صفحة الطلاب: الأرقام، البحث، تعديل المعلومات، الحذف، وقوائم PDF
import { activeStop, liftStop, stopView } from "./checkpoints.ts";
import { deviceOf, unlockDevice } from "./deviceLock.ts";
import { find, one, remove, setSession, type Row } from "./db.ts";
import { activityOf, guardianOf, logActivity } from "./access.ts";
import { GOVS, GRADES, toLatinDigits } from "./config.ts";
import { areasWithCenters, centerName, isAdmin, placeOf, student } from "./data.ts";
import { listPdf } from "./documents.ts";
import { deliverPassword } from "./password.ts";
import { saveStudent, studentFromForm } from "./student.ts";
import { api } from "./telegram.ts";
import { esc } from "./util.ts";
import { openException, startNowForTest } from "./examRoom.ts";
import { TEST_STUDENTS, addTestPaper, addTestStudent, deleteTests, makeTests, startInPersonTest, startTestExam } from "./gradeApi.ts";
import { fileToken, homeToken } from "./webAuth.ts";
import { studentPapers } from "./studentPapers.ts";
import { aiWhyNot } from "./aiGrade.ts";
import { guardianState, whatsappOf } from "./guardianWatch.ts";
import { moveExam, retakeExam } from "./examMoves.ts";
import { prettyAt } from "./scheduleRules.ts";
import { resetSchedule, setPerDay, studentSchedule } from "./schedApi.ts";
import { authed, intOf, need } from "./webApi.ts";

export const STUDENTS_PERM = "students";
const RECENT = 100;

export async function studentsStats() {
  const rows = await find("students");
  const f = (col: string, v: string) => rows.filter((r) => r[col] === v).length;
  return { all: rows.length, g6: f("grade", GRADES[0]), g5: f("grade", GRADES[1]), in: f("exam", "حضوري"),
    on: f("exam", "إلكتروني"), ar: f("curr", "عربي"), en: f("curr", "إنجليزي") };
}
export async function sendStudentsPdf(chat: number, fifth: boolean) {
  const rows = fifth ? await find("students", { grade: GRADES[1] }, { order: ["name"] }) : await find("students", {}, { order: ["grade", "name"] });
  return await listPdf(chat, fifth ? "طلاب الخامس العلمي" : "كل الطلاب المسجلين", ["الاسم", "الصف", "المنهج", "المحافظة", "الهاتف 1", "الهاتف 2", "الامتحان"],
    await Promise.all(rows.map(async (r) => [r.name, r.grade, r.curr, placeOf(r), r.phone1, r.phone2, (r.exam ?? "") + (r.center_id ? " - " + await centerName(r.center_id) : "")])),
    fifth ? "students_5th" : "students_all");
}
const view = async (s: Row) => ({
  id: s.user_id, username: s.username ?? "", name: s.name, curr: s.curr, grade: s.grade, gov: s.gov, side: s.side ?? "", area: s.area,
  phone1: s.phone1, phone2: s.phone2, exam: s.exam ?? "", gender: s.gender ?? "", guardian: !!await guardianOf(s.user_id), gw: await guardianOf(s.user_id) ? await guardianState(s.user_id) : null, wa: whatsappOf(s.phone2), device: await deviceOf(s.user_id), stop: stopView(await activeStop(s.user_id)), centerId: s.center_id ?? 0, center: await centerName(s.center_id), created: s.created, updated: s.updated ?? "",
});

type Filters = { curr?: string; grade?: string; exam?: string; gov?: string };
/** البحث والفلاتر سوية. يرجع كل المطابقين، والصفحة تعرض أولهم */
async function matching(q: string, f: Filters) {
  const s = toLatinDigits(q.trim()).toLowerCase();
  const has = (v: unknown) => v !== null && String(v).toLowerCase().includes(s);
  return await find("students", {}, {
    where: (r) => (!s || has(r.name) || has(r.phone1) || has(r.phone2)) && (!f.curr || r.curr === f.curr) && (!f.grade || r.grade === f.grade) && (!f.exam || r.exam === f.exam) && (!f.gov || r.gov === f.gov),
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
  const items = await find("sched_items");
  return (await find("students")).filter((x) => x.user_id < 0).sort((a, b) => b.user_id - a.user_id).map((x) => {
    const mine = items.filter((i) => i.user_id === x.user_id);
    return { id: x.user_id as number, name: x.name as string, papers: mine.length, graded: mine.filter((i) => i.graded_at).length, link: `/store/myexams?t=${homeToken(x.user_id)}` };
  });
}
async function pageData(q: string, f: Filters, uid = 0) {
  const found = await matching(q, f);
  const rows = found.slice(0, RECENT);
  const centers = await find("centers", { active: 1 }, { order: ["id"] });
  return {
    stats: await studentsStats(), results: await Promise.all(rows.map(view)), found: found.length, limit: RECENT, govs: GOVS,
    areas: (await areasWithCenters()).map((a) => ({ id: a.id, gov: a.gov, name: a.name, centers: centers.filter((c) => c.area_id === a.id).map((c) => ({ id: c.id, name: c.name })) })),
    tests: uid && await isAdmin(uid) ? await testStudents() : null,
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
const TEST_MAX_PICS = 6, TEST_MAX_BYTES = 12 * 1024 * 1024;
/** رفع ورقة تجربة من صور حقيقية (صور جواب كل سؤال) */
export async function studentUpload(form: FormData) {
  const uid = await authed(form.get("initData"), STUDENTS_PERM);
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
  const who = form.get("who") === "me" ? "me" : "ai";
  if (who === "ai") {
    const v = await one("bank_versions", { id: Number(form.get("vid")) });
    const why = v ? await aiWhyNot(v.exam_id, v.id) : null;
    need(!why, `نظام التصحيح AI ما راح ياخذها: ${why}`);
  }
  await addTestPaper(uid, Number(form.get("sid")), Number(form.get("vid")), byQ, who);
  const name = (await student(Number(form.get("sid"))))?.name ?? "";
  return { ...await pageData("", filtersOf({}), uid), notice: who === "ai" ? `🧪 انرفعت ورقة ${name}. نظام التصحيح AI ياخذها خلال دقيقة (إذا موضوعها مأشر وخطواته جاهزة وهو شغال)` : `🧪 انرفعت ورقة ${name}، وتنتظرك بـ ✍️ التصحيح` };
}

export async function studentAction(body: Row) {
  const uid = await authed(body?.initData, STUDENTS_PERM);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let notice = "";
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
  } else if (a === "papers") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, papers: { id, list: await studentPapers(id), fileToken: fileToken(uid) } };
  } else if (a === "sched") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id) } };
  } else if (a === "examException") {
    await openException(uid, body.item);
    notice = "🔓 انفتح الامتحان للطالب، ووصله الخبر";
  } else if (a === "examRetake") {
    notice = `🔁 انحطت الإعادة ${prettyAt(await retakeExam(uid, body.item, body.at))}، ووصل الطالب خبر`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id) } };
  } else if (a === "examMove") {
    notice = `⏩ صار موعده ${prettyAt(await moveExam(uid, body.item, body.at))}، ووصل الطالب خبر`;
    return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice, sched: { id, ...await studentSchedule(id) } };
  } else if (a === "makeTests" || a === "deleteTests") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    if (a === "makeTests") { const n = await makeTests(); need(n, "ماكو نسخة إجبارية جاهزة بيها صور أسئلة"); notice = `🧪 انضافوا ${TEST_STUDENTS} طلاب تجربة، و${n} ورقة تنتظر التصحيح`; }
    else { await deleteTests(); notice = "🗑 انمسحوا طلاب التجربة وأوراقهم"; }
  } else if (a === "addTest") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    notice = `➕ انضاف طالب تجربة ${await addTestStudent()}`;
  } else if (a === "tryInPerson") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const k = await startInPersonTest(Number(body.center), Number(body.vid), !!body.late);
    notice = `🎫 طالب حضوري تجريبي ${k} جاهز${body.late ? "، وموعده بعد 3 ساعات" : ""}. اكتب الرقم ${k} بالمحطة أو بصفحة 🎫 الحضوري`;
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
  } else if (a === "unlink") {
    await remove("guardians", { student_id: id });
    await logActivity(id, "👨‍👧 الإدارة فكت ربط ولي الأمر");
    notice = "✅ انفك الربط. الطالب يگدر يدز الرابط لولي أمر ثاني";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(String(body.q ?? ""), filtersOf(body.filters), uid), notice };
}
