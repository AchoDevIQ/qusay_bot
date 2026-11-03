// نقطة دخول كل رسالة/ضغطة زر من تليجرام. المراحل القادمة تضيف الميزات هنا.
import { initDb } from "./db.ts";
import { send } from "./telegram.ts";

let ready = false;
export async function handleUpdate(u: any) {
  if (!ready) { initDb(); ready = true; }
  try {
    if (u.message?.text === "/start") {
      await send(u.message.chat.id, "أهلاً بك 👋 (نسخة Next.js قيد البناء)");
    }
  } catch (e) {
    console.error("handleUpdate error", e);
  }
}
