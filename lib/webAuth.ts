// التحقق إن الطلب جاي من صفحة انفتحت داخل تليجرام، ومن منو: تليجرام يوقع البيانات بتوكن البوت
import { createHmac, timingSafeEqual } from "node:crypto";
import { TOKEN } from "./config.ts";

const MAX_AGE_S = 24 * 3600;
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** يرجع رقم حساب المستخدم، أو null إذا التوقيع غلط أو قديم */
export function verifyInitData(raw: unknown, now = Date.now() / 1000): number | null {
  if (typeof raw !== "string" || !raw || !TOKEN) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const want = hmac(hmac("WebAppData", TOKEN), check);
  const got = Buffer.from(hash, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const when = Number(params.get("auth_date"));
  if (!Number.isFinite(when) || now - when > MAX_AGE_S || when - now > 300) return null;
  try {
    const id = JSON.parse(params.get("user") ?? "null")?.id;
    return Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}

// زر أسفل المحادثة ما يعطي الصفحة توقيع تليجرام، فرابطه يحمل رمز موقع منا.
// الرمز يتجدد كل ما وصلت الأزرار، ولو انتهى الطالب يكتب /start
const HOME_TTL_S = 60 * 24 * 3600;
const homeSig = (uid: number, exp: number) => hmac(hmac("QMathHome", TOKEN), `${uid}.${exp}`).toString("hex");
export function homeToken(uid: number, now = Date.now() / 1000) {
  const exp = Math.floor(now) + HOME_TTL_S;
  return `${uid}.${exp}.${homeSig(uid, exp)}`;
}
export function verifyHomeToken(t: unknown, now = Date.now() / 1000): number | null {
  if (typeof t !== "string" || !TOKEN) return null;
  const [u, e, sig] = t.split(".");
  const uid = Number(u), exp = Number(e);
  if (!Number.isSafeInteger(uid) || !Number.isFinite(exp) || exp < now || !sig) return null;
  const want = Buffer.from(homeSig(uid, exp), "hex"), got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want) ? uid : null;
}

// الصور ما تكدر ترسل التوقيع، فتاخذ رمز قصير العمر مربوط بالمستخدم
const FILE_TTL_S = 3600;
const tokenSig = (uid: number, exp: number) => hmac(hmac("QMathFiles", TOKEN), `${uid}.${exp}`).toString("hex");
export function fileToken(uid: number, now = Date.now() / 1000) {
  const exp = Math.floor(now) + FILE_TTL_S;
  return `${uid}.${exp}.${tokenSig(uid, exp)}`;
}
export function verifyFileToken(t: unknown, now = Date.now() / 1000): number | null {
  if (typeof t !== "string" || !TOKEN) return null;
  const [u, e, sig] = t.split(".");
  const uid = Number(u), exp = Number(e);
  if (!Number.isSafeInteger(uid) || !Number.isFinite(exp) || exp < now || !sig) return null;
  const want = Buffer.from(tokenSig(uid, exp), "hex"), got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want) ? uid : null;
}
