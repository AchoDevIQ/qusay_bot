// كلمة مرور الطالب للدخول للتطبيق. تنحفظ مشفرة، فما أحد يگدر يقراها من قاعدة البيانات
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { put } from "./db.ts";
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
/** يسوي كلمة جديدة للطالب ويرجعها مرة وحدة، حتى تنعرض له */
export async function issuePassword(uid: number) {
  const password = newPassword();
  await put("student_pass", { user_id: uid, hash: hashPassword(password), created: stamp() });
  return password;
}
