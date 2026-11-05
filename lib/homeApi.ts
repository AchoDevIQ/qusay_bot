// الصفحة الرئيسية للطالب، وإرسال طلب المتجر للسيرفر مباشرة
import { setSession, type Row } from "./db.ts";
import { allowUpdate } from "./bot.ts";
import { hasExamMenu, student } from "./data.ts";
import { examsMenu } from "./exams.ts";
import { storeLink } from "./keyboards.ts";
import { askStart, myQuestions } from "./questions.ts";
import { onStoreOrder, showMe, startReg } from "./student.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

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
  if (a === "shop") {
    if (!await student(id)) {
      await startReg(id, id, "shop");
      return { close: true };
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
  if (a === "ask") {
    await setSession(id, "", {});
    await askStart(id, id);
  } else if (a === "myq") await myQuestions(id, id);
  else if (a === "me") await showMe(id, id);
  else if (a === "exams") await examsMenu(id, id);
  else need(false, "أمر غير معروف");
  return { close: true };
}
