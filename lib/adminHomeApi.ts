// الصفحة الرئيسية للوحة التحكم: الأقسام حسب صلاحية كل واحد
import { stoppedCount } from "./checkpoints.ts";
import { birthdaysToday } from "./birthdays.ts";
import { POLL_PERM, openPolls } from "./polls.ts";
import { pendingGroups } from "./competition.ts";
import { count, find, setSession, sumOf, type Row } from "./db.ts";
import { ADMIN_IDS } from "./config.ts";
import { can, isAdmin, isStaff, newOrdersCount, setGraderView, setStudentView, staffRow, viewedStaff, viewingAsGrader } from "./data.ts";
import { GRADER_TRY_TEXT, adminMenuFor } from "./admin.ts";
import { EXAM_PERM } from "./examBank.ts";
import { objectionsWaiting, waitingPapers } from "./gradeApi.ts";
import { mainKb } from "./keyboards.ts";
import { passRequestsCount } from "./passApi.ts";
import { send } from "./telegram.ts";
import { todayStr } from "./util.ts";
import { VIS_PERM, visRules } from "./studentVis.ts";
import { NOTICE_PERM } from "./notices.ts";
import { ensure, need } from "./webApi.ts";
import { verifyInitData } from "./webAuth.ts";

type Tile = { page: string; icon: string; title: string; note?: string; hot?: boolean };
const openTiles = async () => Object.entries(await visRules()).filter(([k, r]) => k !== "voice" && r.mode !== "off").length;
async function homeData(uid: number) {
  const groups: { title: string; tiles: Tile[] }[] = [];
  const shop: Tile[] = [], people: Tile[] = [], setup: Tile[] = [];
  const orders = await can(uid, "orders"), company = await can(uid, "company");
  if (orders || company) {
    const n = orders ? await newOrdersCount() : 0;
    shop.push({ page: "orders", icon: "🖨", title: "طلبات التوصيل", note: !orders ? "حساب الشركة" : n ? `عندك ${n} طلب جديد` : "ماكو جديد", hot: n > 0 });
  }
  if (await can(uid, "sales")) {
    const sold = await find("orders", { printed: 3 }, { where: (o) => o.office_id === null && String(o.created).startsWith(todayStr()) });
    shop.push({ page: "sales", icon: "💵", title: "البيع المباشر", note: `اليوم: ${sold.length} بيعة` });
  }
  if (await can(uid, "products")) shop.push({ page: "products", icon: "🛒", title: "المنتجات والأقسام" });
  if (await can(uid, "fees")) shop.push({ page: "fees", icon: "🚚", title: "أسعار التوصيل" });
  if (await can(uid, "online")) shop.push({ page: "online", icon: "💻", title: "فصول إلكترونية فقط" });
  if (await can(uid, EXAM_PERM)) people.push({ page: "exams", icon: "📝", title: "الامتحانات" });
  // صاحب البوت: كل الاعتراضات بمربع لحاله
  if (await isAdmin(uid)) { const o = await objectionsWaiting(uid); people.push({ page: "objections", icon: "✋", title: "الاعتراضات", note: o ? `${o} تنتظر رد` : "ماكو اعتراضات", hot: o > 0 }); }
  if (await can(uid, "grade")) {
    const n = await waitingPapers(uid), o = await objectionsWaiting(uid);
    const note = [n ? `${n} ورقة تنتظر` : "", o ? `${o} اعتراض` : ""].filter(Boolean).join(" · ") || "ماكو أوراق";
    people.push({ page: "grade", icon: "✍️", title: "التصحيح", note, hot: n + o > 0 });
  }
  // الملازم والجواب الآلي: صاحب البوت بس
  if (await isAdmin(uid)) people.push({ page: "booklets", icon: "📚", title: "الملازم والجواب الآلي" });
  if (await isAdmin(uid)) people.push({ page: "aigrade", icon: "🤖", title: "نظام التصحيح AI", note: "المواضيع والخطوات والسجل" });
  // 🤖 مراجعة تصحيح الذكاء: أوراق كل مجموعة بصفحة وحدة. «⏳» إذا بيها درجات تنتظر موافقته
  if (await isAdmin(uid) || await can(uid, "aireview")) { const n = Object.keys(await (await import("./aiReview.ts")).heldMap()).length; people.push({ page: "aireview", icon: "🗂", title: "مراجعة تصحيح الذكاء", note: n ? `⏳ ${n} درجة تنتظرك` : "أوراق كل مجموعة بصفحة وحدة", hot: n > 0 }); }
  // 🔎 حلول الذكاء للأسئلة العلمية: يشوفها ويصلحها (طلبه 2026-11-23)
  if (await can(uid, "qareview")) { const { revList } = await import("./qaReview.ts"); const n = (await revList()).filter((x) => !x.state).length; people.push({ page: "qareview", icon: "🔎", title: "حلول الذكاء", note: n ? `${n} حل ما شفته` : "شفت كل الحلول", hot: n > 0 }); }
  // 💰 الصرفية بالمجمل وكل شي لحاله (طلبه 2026-11-23)
  if (await isAdmin(uid) || await can(uid, "spend")) people.push({ page: "spend", icon: "💰", title: "الصرفية", note: "شگد صرف الذكاء: الأسئلة العلمية والامتحانات" });
  // 📝 السبورة: يكتب ويشرح، ويدز شرحه لطلاب محاضرات الفصل (طلبه 2026-11-25)
  if (await can(uid, "board")) people.push({ page: "board", icon: "📝", title: "السبورة", note: "اكتب واشرح، ودز شرحك لطلاب المحاضرات" });
  if (await can(uid, "qusay")) people.push({ page: "qusay", icon: "🧠", title: "تصحيح قصي", note: "مصححك الثاني الرخيص: جربه بالسر وقارن" });
  if (await can(uid, "competition")) { const n = await pendingGroups(); people.push({ page: "competition", icon: "🏆", title: "المنافسة", note: n ? `${n} مجموعة تنتظر موافقتك` : "المجاميع وترتيب المراكز", hot: n > 0 }); }
  if (await can(uid, "birthdays")) { const n = await birthdaysToday(); people.push({ page: "birthdays", icon: "🎂", title: "أعياد الميلاد", note: n ? `اليوم: ${n}` : "ماكو اليوم", hot: n > 0 }); }
  if (await can(uid, POLL_PERM)) { const n = await openPolls(); people.push({ page: "polls", icon: "🗳", title: "التصويت", note: n ? `${n} مفتوح هسه` : "سوي تصويت للطلاب" }); }
  if (await can(uid, "signups")) {
    const n = (await find("exam_access")).filter((r) => String(r.created ?? "").startsWith(todayStr())).length;
    people.push({ page: "signups", icon: "📊", title: "تسجيلات الفصول", note: `اليوم: ${n}` });
  }
  if (await can(uid, "schedule")) people.push({ page: "schedule", icon: "🗓", title: "جدول الامتحانات" });
  if (await can(uid, NOTICE_PERM)) people.push({ page: "announce", icon: "🔔", title: "إشعارات الطلاب", note: "مؤقت يختفي بعد القراءة، أو دائمي لحد ما تمسحه" });
  if (await can(uid, VIS_PERM)) { const n = await openTiles(); people.push({ page: "visibility", icon: "👁", title: "شنو يشوف الطالب بالبوت", note: n ? `${n} مربع مفتوح للطلاب` : "كل المربعات مخفية", hot: n > 0 }); }
  if (await can(uid, "students")) people.push({ page: "students", icon: "🎓", title: "الطلاب", note: `${await count("students")} مسجل` });
  if (!await can(uid, "attend") && await can(uid, "camup")) people.push({ page: "attend", icon: "📷", title: "تصوير أوراق الحضوري", note: "صور ورقة الطالب سؤال سؤال" });
  if (await can(uid, "attend")) people.push({ page: "attend", icon: "🎫", title: "الحضوري", note: "الحضور والطباعة والسكانر" });
  else if (!await can(uid, "camup") && await can(uid, "station")) people.push({ page: "attend", icon: "🖨", title: "طباعة الليبل", note: "رابط المحطة لمتصفح Bluefy" });
  if (await can(uid, "centers")) people.push({ page: "centers", icon: "🏫", title: "المراكز الامتحانية" });
  // الطلاب ما يگدرون يطلبون هسه، فالمربع يطلع بس إذا بقى طلب قديم. يرجع مع ربط التطبيق
  if (await can(uid, "students")) {
    const n = await passRequestsCount();
    if (n) people.push({ page: "passwords", icon: "🔑", title: "طلبات كلمة المرور", note: `${n} طلب`, hot: true });
  }
  if (await can(uid, "q")) {
    const n = await count("questions", { status: "open" });
    people.push({ page: "questions", icon: "❓", title: "الأسئلة", note: n ? `${n} تنتظر جواب` : "ماكو أسئلة", hot: n > 0 });
  }
  if (await isAdmin(uid)) {
    const sold = await find("orders", { printed: 3 }, { where: (o) => o.office_id !== null && String(o.created).startsWith(todayStr()) });
    setup.push({ page: "libs", icon: "🏬", title: "المكتبات", note: `اليوم: ${sold.length} بيعة · ${sumOf(sold, "total").toLocaleString("en-US")}` },
      { page: "staff", icon: "👥", title: "المساعدين والصلاحيات" }, { page: "hours", icon: "⏰", title: "أوقات الأسئلة ومجموعتها" }, { page: "curriculum", icon: "📚", title: "الفصول والمواضيع" }, { page: "terms", icon: "📜", title: "شروط التسجيل" }, { page: "upload", icon: "📤", title: "رفع الفصول" }, { page: "comments", icon: "💬", title: "تعليقات الدرجات" }, { page: "stickers", icon: "🖼", title: "مكتبة الملصقات" });
    const stopped = await stoppedCount();
    people.push({ page: "lectures", icon: "📺", title: "محاضرات الامتحانات", note: "السكة: المحاضرات قبل كل امتحان" });
    people.push({ page: "rent", icon: "🏢", title: "المراكز: الحضور والإيجار", note: "المدراء والتقرير الشهري والدفع" });
    people.push({ page: "alarm", icon: "⏰", title: "منبه الامتحانات", note: "يرن وحده بموبايل الطالب قبل كل امتحان وبوقته" });
    people.push({ page: "path", icon: "🛤", title: "مساري والسيطرة", note: "مسار كل فصل مثل الطالب، و«＋ إنشاء سيطرة» تحت كل امتحان" });
    // السيطرة صارت جوه «مساري» (طلبه 2026-11-25): «＋ إنشاء سيطرة» تحت كل امتحان. المربع يبقى بس إذا أكو موقوفين
    if (stopped) people.push({ page: "checkpoints", icon: "⛔", title: "الموقوفين بالسيطرة", note: `${stopped} طالب موقوف`, hot: true });
  }
  if (await isAdmin(uid)) setup.unshift({ page: "tests", icon: "✅", title: "تست التطبيق", note: "الصح والباقي والمشاكل" });
  if (await isAdmin(uid)) setup.unshift({ page: "fulltest", icon: "🧭", title: "التست الكامل", note: "كل التطبيق من الطول للطول، خطوة خطوة" });
  if (await isAdmin(uid)) setup.unshift({ page: "guide", icon: "📖", title: "دليل البوت", note: "شرح كل قسم، وترسله للمساعدين" });
  if (await isAdmin(uid)) setup.unshift({ page: "features", icon: "✨", title: "مميزات التطبيق", note: "كل شي يسويه التطبيق، حسب الشخص" });
  if (shop.length) groups.push({ title: "المتجر", tiles: shop });
  if (people.length) groups.push({ title: "الطلاب والامتحانات", tiles: people });
  if (setup.length) groups.push({ title: "الإدارة", tiles: setup });
  // يشوف مثل مساعد معين: اسمه يطلع بالشريط فوك
  const as = await viewedStaff(uid);
  const asName = as ? String((await staffRow(uid))?.name ?? "").replace(/^صاحب البوت \(يشوف مثل (.*)\)$/, "$1") : "";
  return { groups, owner: await isAdmin(uid), asGrader: await viewingAsGrader(uid), asStaff: asName, asStudent: await can(uid, "asstudent") };
}

export async function adminHomeAction(body: Row) {
  await ensure();
  const uid = verifyInitData(body?.initData);
  need(uid !== null, "هذا الرابط انتهى. اكتب /start بالبوت وافتح الصفحة من جديد", 401);
  need(await isStaff(uid!), "ما عندك صلاحية", 403);
  if (body.action === "asGrader" || body.action === "endGrader") {
    need(ADMIN_IDS.includes(uid!), "هذا لصاحب البوت بس", 403);
    const on = body.action === "asGrader";
    await setStudentView(uid!, false);
    await setGraderView(uid!, on);
    await setSession(uid!, "", {});
    await send(uid!, on ? GRADER_TRY_TEXT : "✅ رجعت لحسابك الإداري.", { replyKb: await mainKb(uid!) });
    const [t, kb] = await adminMenuFor(uid!);
    await send(uid!, t, { kb });
    return await homeData(uid!);
  }
  if (body.action === "asStudent") {
    need(await can(uid!, "asstudent"), "ما عندك صلاحية «👁 شوف البوت كطالب»", 403);
    await setGraderView(uid!, false);
    await setStudentView(uid!, true);
    await setSession(uid!, "", {});
    await send(uid!, "👁 <b>صرت تشوف البوت مثل الطالب.</b>\nكل الأزرار والرسائل مثله بالضبط. ولمن تخلص، اضغط زر الرجوع جوة.", { replyKb: await mainKb(uid!) });
    return { groups: [], closed: true };
  }
  need(body.action === "list", "أمر غير معروف");
  return await homeData(uid!);
}
