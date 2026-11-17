// صفحة طلبات كلمة المرور: الإدارة تضغط، والبوت يدز الكلمة للطالب
import { find, one, type Row } from "./db.ts";
import { student } from "./data.ts";
import { deliverPassword } from "./password.ts";
import { authed, need } from "./webApi.ts";

async function requests() {
  const rows = await find("pass_requests", {}, { order: ["created"] });
  const list = await Promise.all(rows.map(async (r) => {
    const s = await student(r.user_id);
    return s ? { id: r.user_id, name: s.name, grade: s.grade ?? "", phone: s.phone1 ?? "", created: r.created ?? "", app: !!await one("app_links", { uid: r.user_id }) } : null;
  }));
  return list.filter((x) => x !== null);
}
export const passRequestsCount = async () => (await requests()).length;

export async function passAction(body: Row) {
  await authed(body?.initData, "students");
  const a = String(body.action ?? "");
  let notice = "";
  // طالب التطبيق (نسى رمزه وما يگدر يدخل): الرمز يتغير بحساب التطبيق ويطلعلك هنا، تدزه إله بالواتساب
  const shown: { id: number; name: string; phone: string; password: string }[] = [];
  const { resetAppPassword } = await import("./appReg.ts");
  if (a === "one") {
    const id = Number(body.id);
    need(await one("pass_requests", { user_id: id }), "هذا الطلب مو موجود");
    if (await one("app_links", { uid: id })) { shown.push(await resetAppPassword(id)); notice = "✅ انعمل رمز جديد. دزه للطالب من زر الواتساب"; }
    else {
      need(await deliverPassword(id), "ما وصلت الرسالة، يمكن الطالب حاظر البوت. كلمته القديمة باقية");
      notice = "✅ وصلت الكلمة للطالب";
    }
  } else if (a === "all") {
    let ok = 0, bad = 0;
    for (const r of await requests()) {
      if (r.app) { try { shown.push(await resetAppPassword(r.id)); ok++; } catch { bad++; } }
      else if (await deliverPassword(r.id)) ok++; else bad++;
    }
    notice = `✅ وصلت لـ ${ok} طالب` + (bad ? ` · ⚠️ ما وصلت لـ ${bad}، طلباتهم باقية` : "");
  } else need(a === "list", "أمر غير معروف");
  return { requests: await requests(), notice, shown };
}
