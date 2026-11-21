// الصفحة الرئيسية للطالب، وإرسال طلب المتجر للسيرفر مباشرة
import { checkDevice } from "./deviceLock.ts";
import { openFor } from "./polls.ts";
import { getSession, one, put, setSession, type Row } from "./db.ts";
import { canAsk, childrenOf, guardianCopy, guardianLink, guardianOf, guardianText, logActivity, needsGuardian } from "./access.ts";
import { allowUpdate } from "./bot.ts";
import { BTN_ME } from "./config.ts";
import { hasExamMenu, student } from "./data.ts";
import { sendProfileCard } from "./documents.ts";
import { examsMenu } from "./exams.ts";
import { adminPageLink, homeLink, mainKb, regLink, storeLink } from "./keyboards.ts";
import { issuePassword } from "./password.ts";
import { hasBooks } from "./notes.ts";
import { SCHED_FIRST, needsSchedule, scheduleChapters } from "./schedApi.ts";
import { askStart, myQuestions } from "./questions.ts";
import { onStoreOrder, saveStudent, showMe, studentFromForm } from "./student.ts";
import { api, send } from "./telegram.ts";
import { loadTerms, termsRev } from "./terms.ts";
import { visibleTiles } from "./studentVis.ts";
import { stamp } from "./util.ts";
import { ensure, need } from "./webApi.ts";
import { isAppKey, verifyHomeToken } from "./webAuth.ts";

/** يسجل الطالب من الصفحة، ويرجع كلمة مروره ووين يروح بعد زر المتابعة */
async function registerFromPage(id: number, body: Row) {
  need(!await student(id), "معلوماتك محفوظة ومقفولة. لتغيير أي معلومة تواصل ويا قصي العميري.");
  need(body.rev === termsRev(await loadTerms()), "الشروط تغيرت. سكر الصفحة وافتح التسجيل من جديد.", 409);
  const { errs, r } = await studentFromForm(body.form ?? {}, false);
  need(!errs.length, errs.join("، "));
  need(r.gender, "اختار بنين لو بنات");
  need(r.birth, "اختار تاريخ ميلادك: اليوم والشهر والسنة");
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
  await checkDevice(id, body.device);
  const a = String(body.action ?? "");
  // البوت احتياط للتطبيق: المربع اللي ما فتحه صاحب البوت لهذا الطالب ما يشتغل (طلب المتجر يتبع المتجر)
  // من التطبيق كلشي مفتوح: الإخفاء لتليگرام بس
  const fromApp = typeof body.device === "string" && body.device.startsWith("app-") && isAppKey(id, body.device.slice(4));
  const shown = async () => (fromApp ? new Set(["shop", "ask", "myq", "me", "exams", "notes", "vote"]) : await visibleTiles(id));
  const tile = a === "order" || a === "stockWait" ? "shop" : a;
  if (["shop", "ask", "myq", "me", "exams", "notes", "vote"].includes(tile)) need((await shown()).has(tile as never), "هذا القسم مو مفتوح هسه", 403);
  // سلّم أول امتحان وبعده ما ربط ولي أمره: كلشي مقفول لحد ما يربطه
  if (a === "ask" || a === "exams" || a === "notes") need(!await needsGuardian(id), "🔒 اربط ولي أمرك أول، من القائمة الرئيسية");
  // بنين لو بنات والصف ناقصات (طالب قديم): بطاقتها فوك بالرئيسية، وامتحاناتي ما يرتبها لحد ما يختار
  const { missingBasics, setBasics } = await import("./basics.ts");
  if (a === "setBasics") { await setBasics(id, body); return { ok: true }; }
  // اشترى امتحانات وما اختار أوقاته: ما ينفتح شي غير امتحاناتي
  if (["shop", "order", "ask", "myq", "me", "notes", "vote"].includes(a)) need(!await needsSchedule(id), SCHED_FIRST, 409);
  // ولي الأمر ما استلم درجة من 3 أيام: المتجر والتصويت مقفولين (الدراسة لا)
  if (["shop", "order", "vote"].includes(a)) await (await import("./guardianLock.ts")).needNoOld(id);
  if (a === "list") {
    const s = await student(id);
    if (!s) {
      const kids = await childrenOf(id);
      if (kids.length) return { name: "", exams: false, ask: false, myq: false, children: await Promise.all(kids.map(async (k) => (await student(k.student_id))?.name ?? "—")) };
      return { name: "", exams: false, ask: true, myq: false, fresh: true, show: [...await shown()] };
    }
    const basics = missingBasics(s);
    // ورا أول امتحان: لازم يربط ولي أمره قبل كل شي
    const needLink = await needsGuardian(id);
    const needSched = await needsSchedule(id);
    return {
      // المربعات المفتوحة لهذا الطالب (البوت احتياط للتطبيق). قبل ما يختار أوقاته: امتحاناتي بس
      show: [...await shown()].filter((k) => !needSched || k === "exams"),
      needSched, basics,
      // من التطبيق: ولي الأمر يربط برمزه على هذا التلفون (صفحة «👨‍👧 ولي الأمر»)، مو برابط تليگرام
      appGuard: fromApp,
      // «عبد» وحدها ما تصير نداء: عبد الله تبقى كلمتين
      name: String(s.name).split(" ").slice(0, String(s.name).startsWith("عبد ") ? 2 : 1).join(" "), exams: await hasExamMenu(id) || (await scheduleChapters(id)).length > 0, ask: await canAsk(id), myq: !!await one("questions", { user_id: id }), notes: await hasBooks(id), vote: (await openFor(id)).length,
      link: needLink ? await guardianLink(id) : null,
      // نفس رسالة المحادثة بالضبط، باسمه الكامل
      linkText: needLink ? guardianText(String(s.name).trim()) : null,
      linkCopy: needLink ? guardianCopy(String(s.name).trim(), await guardianLink(id)) : null,
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
  if (a === "stockWait") {
    // «🔔 بلّغني لما يتوفر» من المتجر
    const s = await student(id);
    need(s, "سجل معلوماتك أول");
    const ok = await (await import("./stock.ts")).waitFor(id, Number(body.pid), s!.curr);
    return { notice: ok ? "🔔 تمام، أول ما يتوفر يوصلك خبر" : "✅ هذا متوفر هسه، تگدر تطلبه" };
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
  if (a === "exams" && (await scheduleChapters(id)).length) {
    await logActivity(id, "📝 فتح امتحاناتي");
    return { url: adminPageLink("myexams", id) };
  }
  if (a === "notes") return { url: adminPageLink("notes", id) };
  if (a === "vote") {
    // صفحة «🗳 التصويت»: نفسها بالتطبيق والبوت، يصوت منها
    await logActivity(id, "🗳 فتح التصويت");
    return { url: adminPageLink("vote", id) };
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
