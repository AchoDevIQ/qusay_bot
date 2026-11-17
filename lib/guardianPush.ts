// ولي الأمر على تلفونه هو (ببلاش، بدون تليگرام ولا رسائل): من صفحة ولي الأمر بتلفون ابنه ياخذ رابط/رمز QR خاص بيه،
// يفتحه بمتصفح تلفونه (برمزه دايماً)، ويفعّل إشعارات المتصفح. كل رسالة توصل لصفحته (درجة جديدة) يوصله إشعار.
// الرابط ينبطل وحده إذا صاحب البوت صفّر الرمز
import { createHmac, timingSafeEqual } from "node:crypto";
import { find, insert, one, remove, type Row } from "./db.ts";
import { TOKEN } from "./config.ts";
import { siteBase } from "./keyboards.ts";
import { GUARD_BASE } from "./guardianPin.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

const sig = (sid: number, ver: string) => createHmac("sha256", createHmac("sha256", "QMathGuardDevice").update(TOKEN).digest()).update(`${sid}.${ver}`).digest("base64url").slice(0, 32);
const verOf = async (sid: number) => String((await one("guardian_pins", { user_id: sid }))?.created ?? "").replace(/\D/g, "");

/** رابط صفحة ولي الأمر لتلفونه */
export async function deviceLink(sid: number) {
  const ver = await verOf(sid);
  need(ver, "ولي الأمر بعده ما حط رمزه", 409);
  return `${siteBase()}/store/guardian?d=d${sid}.${ver}.${sig(sid, ver)}`;
}
/** رقم الطالب من رابط تلفون ولي الأمر، أو null */
export async function verifyDeviceKey(k: unknown): Promise<number | null> {
  if (typeof k !== "string" || !k.startsWith("d") || !TOKEN) return null;
  const [s, ver, h] = k.slice(1).split(".");
  const sid = Number(s);
  if (!Number.isSafeInteger(sid) || !ver || !h || ver !== await verOf(sid)) return null;
  const want = Buffer.from(sig(sid, ver)), got = Buffer.from(h);
  return want.length === got.length && timingSafeEqual(want, got) ? sid : null;
}

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
export async function saveSub(sid: number, raw: unknown) {
  const s = raw as Sub;
  need(s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth, "ما گدرنا نفعّل الإشعارات", 400);
  await remove("guardian_push", { user_id: sid, endpoint: s.endpoint });
  await insert("guardian_push", { user_id: sid, endpoint: s.endpoint, keys: JSON.stringify(s.keys), created: stamp() });
}
export const vapidPublic = () => process.env.VAPID_PUBLIC_KEY ?? "";

/** رسالة جديدة لصفحة ولي الأمر: إشعار لكل تلفون مفعّل عنده. الاشتراك اللي انتهى (410/404) ينشال */
export async function notifyGuardian(gid: number, text: string) {
  if (gid < GUARD_BASE || !process.env.VAPID_PRIVATE_KEY || !vapidPublic()) return 0;
  const sid = gid - GUARD_BASE;
  const subs = await find("guardian_push", { user_id: sid });
  if (!subs.length) return 0;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(siteBase() || "https://qmath.app", vapidPublic(), process.env.VAPID_PRIVATE_KEY);
  const plain = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140) || "رسالة جديدة";
  const link = await deviceLink(sid).catch(() => "");
  let ok = 0;
  for (const r of subs as Row[]) {
    try {
      await webpush.sendNotification({ endpoint: String(r.endpoint), keys: JSON.parse(String(r.keys)) }, JSON.stringify({ title: "👨‍👧 قصي العميري", body: plain, url: link }), { TTL: 86400 });
      ok++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await remove("guardian_push", { user_id: sid, endpoint: r.endpoint });
      else console.error("guardian push", e?.statusCode ?? e);
    }
  }
  return ok;
}
