// تشفير الأشياء الحساسة (بصمة وجه ولي الأمر وصور توقيعه): المفتاح مشتق من سر البوت، وهذا محفوظ بخزنة السيرفر مو بقاعدة البيانات.
// فإذا تسربت قاعدة البيانات أو الملفات أو نسخة احتياطية لوحدها، تطلع حروف ما تنقرا
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { TOKEN } from "./config.ts";

const key = () => createHmac("sha256", "QMathSeal").update(TOKEN).digest();

export function seal(data: Buffer | string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(typeof data === "string" ? Buffer.from(data, "utf8") : data), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
export function unseal(box: string): Buffer | null {
  try {
    const [v, iv, tag, body] = box.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]);
  } catch { return null; }
}
