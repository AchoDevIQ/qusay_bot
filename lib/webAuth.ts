// التحقق إن الطلب جاي من صفحة انفتحت داخل تليجرام، ومن منو: تليجرام يوقع البيانات بتوكن البوت
import { createHmac, timingSafeEqual } from "node:crypto";
import { TOKEN } from "./config.ts";

const MAX_AGE_S = 24 * 3600;
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** يرجع رقم حساب المستخدم، أو null إذا التوقيع غلط أو قديم */
export function verifyInitData(raw: unknown, now = Date.now() / 1000): number | null {
  if (typeof raw !== "string" || !raw || !TOKEN) return null;
  // الصفحة المفتوحة من زر أسفل المحادثة ترسل رمزها الموقع بدل توقيع تليجرام
  if (raw.startsWith("tk:")) {
    // هذا الرمز يدخل لوحة التحكم، فيشتغل أسبوع بس من يوم انعمل. بعدها /start يجدده
    const uid = verifyHomeToken(raw.slice(3), now);
    const age = HOME_TTL_S - (Number(raw.slice(3).split(".")[1]) - now);
    return uid !== null && age <= PANEL_TTL_S ? uid : null;
  }
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
const PANEL_TTL_S = 7 * 24 * 3600;
const homeSig = (uid: number, exp: number) => hmac(hmac("QMathHome", TOKEN), `${uid}.${exp}`).toString("hex");
// «👁 شوف جدوله مثل ما يشوفه»: رابط عرض بس لصفحة امتحانات الطالب، ساعة وحدة، ما يحسب جهاز الطالب ولا يغير شي
const VIEW_TTL_S = 3600;
const viewSig = (uid: number, exp: number) => hmac(hmac("QMathView", TOKEN), `${uid}.${exp}`).toString("hex");
export function viewToken(uid: number, now = Date.now() / 1000) {
  const exp = Math.floor(now) + VIEW_TTL_S;
  return `v${uid}.${exp}.${viewSig(uid, exp)}`;
}
export function verifyViewToken(t: unknown, now = Date.now() / 1000): number | null {
  if (typeof t !== "string" || !TOKEN || !t.startsWith("v")) return null;
  const [u, e, sig] = t.slice(1).split(".");
  const uid = Number(u), exp = Number(e);
  if (!Number.isSafeInteger(uid) || !Number.isFinite(exp) || exp < now || !sig) return null;
  const want = Buffer.from(viewSig(uid, exp), "hex"), got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want) ? uid : null;
}
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

// رابط ولي الأمر: رقم الطالب وتوقيعه، حتى ما ينربط أحد بطالب غيره بتخمين الرقم
const parentSig = (sid: number) => hmac(hmac("QMathParent", TOKEN), String(sid)).toString("hex").slice(0, 20);
export const guardianCode = (sid: number) => `${sid}_${parentSig(sid)}`;
export function verifyGuardianCode(c: unknown): number | null {
  if (typeof c !== "string" || !TOKEN) return null;
  const [s, sig] = c.split("_");
  const sid = Number(s);
  return Number.isSafeInteger(sid) && sig === parentSig(sid) ? sid : null;
}

/** مفتاح رابط المؤقت: مشتق من توكن البوت، فما يحتاج سر جديد بالسيرفر */
export const cronKey = () => hmac(hmac("QMathCron", TOKEN), "cron").toString("hex").slice(0, 32);

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
