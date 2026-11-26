// صفحات الطالب بالتطبيق بدل صفحات التطبيق القديمة: «👤 معلوماتي» و«🧾 مشترياتي» (كل اللي اشتراه: المتجر والمكتبة، طلبه 2026-11-26)
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
    return { id: Number(o.id), at: String(o.created ?? "").slice(0, 16), items, total: Number(o.total ?? 0), status: STATUS(o), cancel: !Number(o.printed), receipt: Number(o.printed) === 3 || Number(o.printed) === 1, where: Number(o.printed) === 3 ? String(o.gov ?? "") : "" };
  });
}
/** شنو عنده هسه (الفصول اللي انفتحتله، من المكتبة لو المتجر لو التطبيق) */
async function myOwned(uid: number) {
  const { ownedChapters } = await import("./notes.ts");
  return await ownedChapters(uid).catch(() => [] as string[]);
}
const listOut = async (uid: number, notice = "") => ({ list: await myOrders(uid), owned: await myOwned(uid), notice });

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
    return await listOut(uid!, `❌ انلغى طلبك #${o!.id}`);
  }
  if (a === "receipt") {
    // 🖼 الوصل الملون مال مشترى من مشترياته (نفس اللي وصله وقت الشراء)
    const o = await one("orders", { id: Number(body.id), user_id: uid! });
    need(o && (Number(o.printed) === 3 || Number(o.printed) === 1), "الوصل غير موجود", 404);
    const { receiptImageFile } = await import("./documents.ts");
    const { orderItems } = await import("./data.ts");
    const p = await receiptImageFile(o!, orderItems(o!));
    need(p, "ما گدرنا نسوي الوصل، حاول مرة ثانية", 500);
    const fs = await import("node:fs");
    return { img: `data:image/png;base64,${fs.readFileSync(p!).toString("base64")}` };
  }
  need(a === "orders", "أمر غير معروف");
  return await listOut(uid!);
}
