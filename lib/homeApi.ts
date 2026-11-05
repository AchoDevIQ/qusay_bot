// الصفحة الرئيسية للطالب، وإرسال طلب المتجر للسيرفر مباشرة
import { getSession, one, put, setSession, type Row } from "./db.ts";
import { boughtCourse, canAsk, childrenOf, guardianLink, guardianOf, logActivity } from "./access.ts";
import { allowUpdate } from "./bot.ts";
import { BTN_ME } from "./config.ts";
import { hasExamMenu, student } from "./data.ts";
import { sendProfileCard } from "./documents.ts";
import { examsMenu } from "./exams.ts";
import { homeLink, mainKb, regLink, storeLink } from "./keyboards.ts";
import { issuePassword } from "./password.ts";
import { askStart, myQuestions } from "./questions.ts";
import { onStoreOrder, saveStudent, showMe, studentFromForm } from "./student.ts";
import { api, send } from "./telegram.ts";
import { loadTerms, termsRev } from "./terms.ts";
import { stamp } from "./util.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

/** يسجل الطالب من الصفحة، ويرجع كلمة مروره ووين يروح بعد زر المتابعة */
async function registerFromPage(id: number, body: Row) {
  need(!await student(id), "معلوماتك محفوظة ومقفولة. لتغيير أي معلومة تواصل ويا قصي العميري.");
  need(body.rev === termsRev(await loadTerms()), "الشروط تغيرت. سكر الصفحة وافتح التسجيل من جديد.", 409);
  const { errs, r } = await studentFromForm(body.form ?? {}, false);
  need(!errs.length, errs.join("، "));
  // الصفحة ما تعرف معرف تليجرام، وإذا ما وصلنا التسجيل يكمل بدونه
  const username = await api("getChat", { chat_id: id }).then((c: any) => c?.username ?? "").catch(() => "");
  const { state, data } = await getSession(id);
  const next = state.startsWith("r:") ? data.next : null;
  await saveStudent(id, username, r, null);
  const password = await issuePassword(id);
  await logActivity(id, "📝 سجل بالبوت");
  await setSession(id, "", {});
  // التسجيل انحفظ، فخطأ برسائل المحادثة ما يضيع كلمة المرور على الطالب
  try {
    await sendProfileCard(id, r, "✅ تم حفظ معلوماتك", `✅ <b>تم تسجيلك بنجاح</b>\nتگدر تشوف معلوماتك بأي وقت من زر «${BTN_ME}».`, await mainKb(id));
    if (next === "ask") await askStart(id, id);
  } catch (e) { console.error(e); }
  if (next === "ask") return { password, close: true };
  if (next === "shop") await setSession(id, "store", {});
  return { password, url: next === "shop" ? await storeLink(id) : homeLink(id) };
}

export async function homeAction(body: Row) {
  await ensure();
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. اكتب /start بالبوت وافتح القائمة من جديد", 401);
  const id = uid!;
  need(allowUpdate(id), "ضغطت هوايا، انتظر شوية", 429);
  const a = String(body.action ?? "");
  if (a === "ask" || a === "exams") need(!await boughtCourse(id) || await guardianOf(id), "اربط ولي أمرك أول، من القائمة الرئيسية");
  if (a === "list") {
    const s = await student(id);
    if (!s) {
      const kids = await childrenOf(id);
      if (kids.length) return { name: "", exams: false, ask: false, myq: false, children: await Promise.all(kids.map(async (k) => (await student(k.student_id))?.name ?? "—")) };
      return { name: "", exams: false, ask: true, myq: false, fresh: true };
    }
    // اشترى محاضرات أو امتحانات: لازم يربط ولي أمره قبل كل شي
    const needLink = await boughtCourse(id) && !await guardianOf(id);
    return {
      // «عبد» وحدها ما تصير نداء: عبد الله تبقى كلمتين
      name: String(s.name).split(" ").slice(0, String(s.name).startsWith("عبد ") ? 2 : 1).join(" "), exams: await hasExamMenu(id), ask: await canAsk(id), myq: !!await one("questions", { user_id: id }),
      link: needLink ? await guardianLink(id) : null,
    };
  }
  if (a === "regInfo") {
    const terms = await loadTerms();
    return { terms, rev: termsRev(terms), registered: !!await student(id) };
  }
  if (a === "register") return await registerFromPage(id, body);
  if (a === "shop") {
    if (!await student(id)) {
      await setSession(id, "r:form", { next: "shop", edit: false });
      return { url: await regLink(id) };
    }
    await setSession(id, "store", {});
    await logActivity(id, "🛒 فتح المتجر");
    return { url: await storeLink(id) };
  }
  if (a === "order") {
    need(body.order && typeof body.order === "object", "الطلب ناقص");
    // الردود توصل بالمحادثة مثل كل طلب، والصفحة تتسكر
    await onStoreOrder(id, id, JSON.stringify(body.order), { username: (await student(id))?.username ?? "" });
    return { close: true };
  }
  if (a === "pass") {
    // الطلب ينتظر الإدارة، وتكراره ما يسوي طلب ثاني
    if (!await student(id)) {
      await setSession(id, "r:form", { next: null, edit: false });
      return { url: await regLink(id) };
    }
    await put("pass_requests", { user_id: id, created: stamp() });
    await send(id, "✅ وصل طلبك. راح توصلك كلمة المرور الجديدة هنا بالمحادثة لمن توافق الإدارة.");
    return { close: true };
  }
  // غير المسجل: كل المربعات تفتح التسجيل، بدون رسائل
  if (!await student(id)) {
    await setSession(id, "r:form", { next: a === "ask" ? "ask" : null, edit: false });
    return { url: await regLink(id) };
  }
  if (a === "ask") {
    await setSession(id, "", {});
    await askStart(id, id);
  } else if (a === "myq") await myQuestions(id, id);
  else if (a === "me") await showMe(id, id);
  else if (a === "exams") await examsMenu(id, id);
  else need(false, "أمر غير معروف");
  await logActivity(id, { ask: "❓ فتح سؤال علمي", myq: "📂 فتح أسئلتي", me: "👤 فتح معلوماتي", exams: "📝 فتح امتحاناتي" }[a] ?? a);
  return { close: true };
}
