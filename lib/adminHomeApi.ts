// الصفحة الرئيسية للوحة التحكم: الأقسام حسب صلاحية كل واحد
import { stoppedCount } from "./checkpoints.ts";
import { birthdaysToday } from "./birthdays.ts";
import { count, find, setSession, sumOf, type Row } from "./db.ts";
import { can, isAdmin, isStaff, newOrdersCount, setStudentView } from "./data.ts";
import { EXAM_PERM } from "./examBank.ts";
import { objectionsWaiting, waitingPapers } from "./gradeApi.ts";
import { mainKb } from "./keyboards.ts";
import { passRequestsCount } from "./passApi.ts";
import { send } from "./telegram.ts";
import { todayStr } from "./util.ts";
import { ensure, need } from "./webApi.ts";
import { verifyInitData } from "./webAuth.ts";

type Tile = { page: string; icon: string; title: string; note?: string; hot?: boolean };
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
    shop.push({ page: "sales", icon: "🏪", title: "بيع ومبيعات المكتب", note: `اليوم: ${sold.length} بيعة` });
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
  if (await can(uid, "birthdays")) { const n = await birthdaysToday(); people.push({ page: "birthdays", icon: "🎂", title: "أعياد الميلاد", note: n ? `اليوم: ${n}` : "ماكو اليوم", hot: n > 0 }); }
  if (await can(uid, "signups")) {
    const n = (await find("exam_access")).filter((r) => String(r.created ?? "").startsWith(todayStr())).length;
    people.push({ page: "signups", icon: "📊", title: "تسجيلات الفصول", note: `اليوم: ${n}` });
  }
  if (await can(uid, "schedule")) people.push({ page: "schedule", icon: "🗓", title: "جدول الامتحانات" });
  if (await can(uid, "students")) people.push({ page: "students", icon: "🎓", title: "الطلاب", note: `${await count("students")} مسجل` });
  if (!await can(uid, "attend") && await can(uid, "camup")) people.push({ page: "attend", icon: "📷", title: "تصوير أوراق الحضوري", note: "صور ورقة الطالب سؤال سؤال" });
  if (await can(uid, "attend")) people.push({ page: "attend", icon: "🎫", title: "الحضوري", note: "الحضور والطباعة والسكانر" });
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
    people.push({ page: "checkpoints", icon: "🚦", title: "السيطرة", note: stopped ? `${stopped} طالب موقوف` : "ماكو موقوفين", hot: stopped > 0 });
  }
  if (shop.length) groups.push({ title: "المتجر", tiles: shop });
  if (people.length) groups.push({ title: "الطلاب والامتحانات", tiles: people });
  if (setup.length) groups.push({ title: "الإدارة", tiles: setup });
  return { groups };
}

export async function adminHomeAction(body: Row) {
  await ensure();
  const uid = verifyInitData(body?.initData);
  need(uid !== null, "افتح الصفحة من داخل البوت", 401);
  need(await isStaff(uid!), "ما عندك صلاحية", 403);
  if (body.action === "asStudent") {
    await setStudentView(uid!, true);
    await setSession(uid!, "", {});
    await send(uid!, "👁 <b>صرت تشوف البوت مثل الطالب.</b>\nكل الأزرار والرسائل مثله بالضبط. ولمن تخلص، اضغط زر الرجوع جوة.", { replyKb: await mainKb(uid!) });
    return { groups: [], closed: true };
  }
  need(body.action === "list", "أمر غير معروف");
  return await homeData(uid!);
}
