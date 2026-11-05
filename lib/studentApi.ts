// واجهة صفحة الطلاب: الأرقام، البحث، تعديل المعلومات، الحذف، وقوائم PDF
import { find, one, remove, setSession, type Row } from "./db.ts";
import { GOVS, GRADES } from "./config.ts";
import { areasWithCenters, centerName, placeOf, searchStudents, student } from "./data.ts";
import { listPdf } from "./documents.ts";
import { saveStudent, studentFromForm } from "./student.ts";
import { api } from "./telegram.ts";
import { esc } from "./util.ts";
import { authed, need } from "./webApi.ts";

export const STUDENTS_PERM = "students";
const RECENT = 15;

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
  phone1: s.phone1, phone2: s.phone2, exam: s.exam ?? "", centerId: s.center_id ?? 0, center: await centerName(s.center_id), created: s.created, updated: s.updated ?? "",
});

async function pageData(q: string) {
  const s = q.trim();
  const rows = s ? await searchStudents(s) : await find("students", {}, { order: ["-created"], limit: RECENT });
  const centers = await find("centers", { active: 1 }, { order: ["id"] });
  return {
    stats: await studentsStats(), results: await Promise.all(rows.map(view)), limit: RECENT, govs: GOVS,
    areas: (await areasWithCenters()).map((a) => ({ id: a.id, gov: a.gov, name: a.name, centers: centers.filter((c) => c.area_id === a.id).map((c) => ({ id: c.id, name: c.name })) })),
  };
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
    notice = "✅ انحفظت معلومات الطالب";
    if (r.center_id && r.center_id !== old!.center_id) {
      // الطالب يعرف بمركزه الجديد. إذا حاظر البوت، التعديل يبقى محفوظ
      try { await api("sendMessage", { chat_id: id, parse_mode: "HTML", text: `ℹ️ تم تغيير مركزك الامتحاني إلى: <b>${esc(await centerName(r.center_id))}</b>` }); } catch (e) { console.error(e); }
    }
  } else if (a === "del") {
    need(await one("students", { user_id: id }), "الطالب غير موجود");
    await remove("students", { user_id: id });
    await setSession(id, "", {});
    notice = "🗑 انحذف تسجيله. لمن يفتح البوت يسجل من جديد، وطلباته القديمة باقية";
  } else if (a === "pdf") {
    need(await sendStudentsPdf(uid, body.kind === "fifth"), "ما گدرت أرسل الملف، حاول مرة ثانية");
    notice = "✅ الملف وصلك بمحادثة البوت";
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(String(body.q ?? "")), notice };
}
