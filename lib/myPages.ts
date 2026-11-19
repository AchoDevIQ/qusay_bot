// صفحات الطالب بالتطبيق بدل صفحات التطبيق القديمة: «👤 معلوماتي» و«📦 طلباتي» (طلبات متجر البوت)
import { find, one, type Row } from "./db.ts";
import { checkDevice } from "./deviceLock.ts";
import { profileText, student } from "./data.ts";
import { itemLabel } from "./orderRules.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

const STATUS = (o: Row) => ({ 1: "📦 تجهز وانسلم للتوصيل", 2: "❌ ملغي", 3: "🏪 اشتريته من المكتبة" } as Record<number, string>)[Number(o.printed)] ?? "⏳ يتجهز";

async function myOrders(uid: number) {
  const rows = (await find("orders", { user_id: uid })).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 50);
  return rows.map((o) => {
    let items: { name: string; qty: number }[] = [];
    try { items = (JSON.parse(String(o.items || "[]")) as Row[]).map((i) => ({ name: itemLabel(i), qty: Number(i.qty ?? 1) })); } catch { items = []; }
    return { id: Number(o.id), at: String(o.created ?? "").slice(0, 16), items, total: Number(o.total ?? 0), status: STATUS(o), cancel: !Number(o.printed) };
  });
}

export async function myAction(body: Row) {
  await ensure();
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. سد الصفحة وافتحها من جديد", 401);
  await checkDevice(uid!, body.device);
  const a = String(body.action ?? "");
  if (a === "me") {
    const s = await student(uid!);
    need(s, "ما لگينا معلوماتك", 404);
    return { name: String(s!.name ?? ""), html: await profileText(s!), note: "🔒 لتغيير أي معلومة تواصل ويا قصي العميري." };
  }
  if (a === "cancel") {
    const o = await one("orders", { id: Number(body.id), user_id: uid! });
    need(o, "الطلب غير موجود", 404);
    need(!Number(o!.printed), Number(o!.printed) === 1 ? "الطلب تجهز وانسلم للتوصيل، فما يمكن إلغاؤه" : Number(o!.printed) === 2 ? "الطلب ملغي من قبل" : "هذا مشترى من المكتبة");
    const { cancelOrder } = await import("./student.ts");
    need(await cancelOrder(uid!, o!), "الطلب تجهز هسه، فما يمكن إلغاؤه");
    return { list: await myOrders(uid!), notice: `❌ انلغى طلبك #${o!.id}` };
  }
  need(a === "orders", "أمر غير معروف");
  return { list: await myOrders(uid!), notice: "" };
}
