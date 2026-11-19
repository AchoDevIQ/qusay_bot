// «🌐 افتحها بمتصفح التلفون»: المصحح (أو صاحب البوت) فاتح التصحيح داخل تليگرام، والدرجة بالصوت ما تشتغل هناك.
// الزر يسوي رابط يشتغل مرة وحدة ولمدة دقيقتين، ينفتح بمتصفح التلفون وهو داخل بنفس حسابه، بدون مساعد ولا رمز.
// بعد ما ينفتح، الصفحة تاخذ جلسة 12 ساعة بس (مو أسبوع مثل رابط اللوحة)، وتبقى بالتبويب نفسه
import { randomBytes } from "node:crypto";
import { kvGet, kvSet, remove, tx } from "./db.ts";

export const LINK_TTL_MS = 2 * 60_000;
const key = (code: string) => `browser_link:${code}`;

/** رابط جديد لهذا الحساب: يرجع الرمز اللي ينحط بالرابط */
export async function makeBrowserCode(uid: number, now = Date.now()) {
  const code = randomBytes(18).toString("base64url");
  await kvSet(key(code), JSON.stringify({ uid, exp: now + LINK_TTL_MS }));
  return code;
}

/** يستعمل الرمز: مرة وحدة بس (ينمسح بنفس اللحظة)، وإذا انتهى وقته ما يشتغل. يرجع رقم الحساب أو null */
export async function useBrowserCode(code: unknown, now = Date.now()): Promise<number | null> {
  if (typeof code !== "string" || !/^[\w-]{24}$/.test(code)) return null;
  const raw = await tx(async () => {
    const v = await kvGet(key(code));
    if (v === null) return null;
    await remove("kv", { k: key(code) });
    return v;
  });
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { uid?: unknown; exp?: unknown };
    return typeof j.exp === "number" && j.exp >= now && Number.isSafeInteger(j.uid) ? (j.uid as number) : null;
  } catch { return null; }
}
