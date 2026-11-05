// الصفحة الرئيسية للطالب، وإرسال طلب المتجر للسيرفر مباشرة
import { getSession, put, setSession, type Row } from "./db.ts";
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
  if (a === "list") {
    const s = await student(id);
    return { name: s ? String(s.name).split(" ")[0] : "", exams: await hasExamMenu(id) };
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
  if (a === "ask") {
    await setSession(id, "", {});
    await askStart(id, id);
  } else if (a === "myq") await myQuestions(id, id);
  else if (a === "me") await showMe(id, id);
  else if (a === "exams") await examsMenu(id, id);
  else need(false, "أمر غير معروف");
  return { close: true };
}
