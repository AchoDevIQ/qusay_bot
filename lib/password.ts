// كلمة مرور الطالب للدخول للتطبيق. تنحفظ مشفرة، فما أحد يگدر يقراها من قاعدة البيانات
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { put, remove } from "./db.ts";
import { send } from "./telegram.ts";
import { stamp } from "./util.ts";

// بدون الحروف والأرقام اللي تتشابه بالقراءة
const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";

export const newPassword = () => Array.from({ length: 8 }, () => LETTERS[randomInt(LETTERS.length)]).join("");
const scrypt = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scrypt(password, salt)}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, "hex"), got = Buffer.from(scrypt(password, salt), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
/**
 * يدز كلمة جديدة للطالب بالبوت. الكلمة القديمة تبقى إذا الرسالة ما وصلت،
 * حتى ما ينقفل حسابه بكلمة ما شافها. يرجع false إذا ما وصلت
 */
export async function deliverPassword(uid: number) {
  const password = newPassword();
  const sent = await send(uid, `🔑 <b>كلمة المرور الجديدة</b>\n\n<code>${password}</code>\n\nاضغط عليها حتى تنسخها، واستخدمها حتى تدخل للتطبيق. الكلمة القديمة ما تشتغل بعد.`, { extra: { protect_content: false } });
  if (!sent) return false;
  await put("student_pass", { user_id: uid, hash: hashPassword(password), created: stamp() });
  await remove("pass_requests", { user_id: uid });
  return true;
}
/** يسوي كلمة جديدة للطالب ويرجعها مرة وحدة، حتى تنعرض له */
export async function issuePassword(uid: number) {
  const password = newPassword();
  await put("student_pass", { user_id: uid, hash: hashPassword(password), created: stamp() });
  return password;
}
