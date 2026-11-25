// إشعار على شاشة تلفون الطالب (طلب الأستاذ 2026-11-17): طالب التجربة اللي يستعمل التطبيق، من يوصله بالبوت
// رسالة بالمحادثة أو إشعار جديد، يطلعله إشعار على تلفونه مثل الواتساب، حتى لو التطبيق مسدود.
// التطبيق يدز رمز تلفونه للبوت ويا سؤال «حالتي» (/api/app/state)، والبوت يدز الإشعار من مشروع التطبيق (qmath-iq)
// بحساب البوت (صاحب التطبيق أعطاه صلاحية الإشعارات 2026-11-17).
// - المحادثة: إذا الطالب هسه داخل المحادثة (فاتحها بآخر دقيقتين) ما يطلعله، ورسائل ورا بعض تطلع إشعار واحد
// - الإشعار ينضغط: المحادثة تفتح المحادثة، والإشعار يفتح «الإشعارات»
import { kvGet, kvSet, remove } from "./db.ts";

const PROJECT = "qmath-iq";
const key = (uid: number) => `app_push_${uid}`;
const lastInKey = (uid: number) => `app_lastin_${uid}`;
export type PushType = "bot_chat" | "bot_notice" | "bot_exam";
export type PushMsg = { title: string; body: string; type: PushType };
type Sender = (token: string, m: PushMsg) => Promise<"ok" | "gone" | "fail">;

/** رمز تلفون الطالب من التطبيق. ينحفظ بس إذا تبدل */
export async function savePushToken(uid: number, token: unknown) {
  const t = typeof token === "string" ? token.trim() : "";
  if (t.length < 20 || t.length > 4096 || /\s/.test(t)) return false;
  if ((await kvGet(key(uid))) !== t) await kvSet(key(uid), t);
  return true;
}
export const hasPushToken = async (uid: number) => !!(await kvGet(key(uid)));

/** الكتابة بدون علامات HTML، قصيرة تناسب الإشعار */
export function plain(s: string, max = 180) {
  const t = s.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------- الإرسال (الفحوصات تبدله)
let sender: Sender | null = null;
export const setPushSender = (s: Sender | null) => { sender = s; };
let auth: { getAccessToken(): Promise<string | null | undefined> } | null = null;
async function fcmSend(token: string, m: PushMsg): Promise<"ok" | "gone" | "fail"> {
  if (!auth) { const { GoogleAuth } = await import("google-auth-library"); auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] }); }
  const at = await auth.getAccessToken().catch(() => null);
  if (!at) return "fail";
  const message = {
    token,
    notification: { title: m.title, body: m.body },
    data: { type: m.type },
    android: { priority: "high", notification: { channel_id: "student_app_default", tag: m.type, sound: "default", ...(m.type === "bot_exam" ? { notification_priority: "PRIORITY_MAX", visibility: "PUBLIC" } : {}) } },
    apns: { headers: { "apns-collapse-id": m.type, "apns-priority": "10" }, payload: { aps: { sound: "default", "thread-id": m.type, ...(m.type === "bot_exam" ? { "interruption-level": "time-sensitive" } : {}) } } },
  };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` }, body: JSON.stringify({ message }),
  }).catch(() => null);
  if (!r) return "fail";
  if (r.ok) return "ok";
  const err = await r.text().catch(() => "");
  // التطبيق انمسح أو الرمز قديم: ننساه، والتطبيق يدز الجديد أول ما ينفتح
  if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(err)) return "gone";
  console.error("app push", r.status, err.slice(0, 300));
  return "fail";
}

/** يدز إشعار لتلفون الطالب إذا عنده رمز. ما يوقف شي إذا فشل (3 ثواني أكثر شي) */
export async function pushApp(uid: number, m: PushMsg): Promise<boolean> {
  const t = await kvGet(key(uid)).catch(() => null);
  if (!t) return false;
  const send = sender ?? fcmSend;
  const r = await Promise.race([send(t, m).catch(() => "fail" as const), new Promise<"fail">((ok) => setTimeout(() => ok("fail"), 3000))]);
  if (r === "gone" && (await kvGet(key(uid))) === t) await remove("kv", { k: key(uid) });
  return r === "ok";
}

// ---------- المحادثة
/** الطالب فاتح المحادثة (يقرا أو يكتب أو يدوس زر): هسه داخلها. ينكتب مرة كل نص دقيقة أكثر شي */
const wroteIn = new Map<number, number>();
export async function noteChatIn(uid: number) {
  const now = Date.now();
  if (now - (wroteIn.get(uid) ?? 0) < 30_000) return;
  wroteIn.set(uid, now);
  await kvSet(lastInKey(uid), String(now));
}
const recent = new Map<number, number>();
/** رسالة جديدة من البوت للطالب بالتطبيق */
export async function chatPush(uid: number, text: string) {
  if (!(await kvGet(key(uid)).catch(() => null))) return false;
  const { isPilot } = await import("./appLink.ts");
  if (!await isPilot(uid)) return false;
  const now = Date.now();
  if (now - Number((await kvGet(lastInKey(uid))) ?? 0) < 120_000) return false;
  if (now - (recent.get(uid) ?? 0) < 20_000) return false;
  recent.set(uid, now);
  return pushApp(uid, { title: "💬 رسالة جديدة", body: plain(text) || "وصلتك رسالة جديدة بالمحادثة", type: "bot_chat" });
}

/** 🟢 بدأ الامتحان (طلبه 2026-11-25): يوصل دائماً، حتى لو هسه فاتح المحادثة أو التطبيق، بأولوية عالية،
 * ومن يدوسه تنفتح «امتحاناتي». ينطلب قبل رسالة المحادثة، فإشعار المحادثة العادي ما يتكرر وياه */
export async function examPush(uid: number, title: string, minutes: number) {
  if (!(await kvGet(key(uid)).catch(() => null))) return false;
  const { isPilot } = await import("./appLink.ts");
  if (!await isPilot(uid)) return false;
  recent.set(uid, Date.now());
  return pushApp(uid, { title: `🟢 بدأ امتحانك${title ? `: ${plain(title, 60)}` : ""}`, body: `ادخل عليه خلال ${minutes} دقيقة. دوس هنا حتى تفتح امتحاناتي.`, type: "bot_exam" });
}

/** ⏰ امتحانك بعد 10 دقايق: نفس الإشعار المستعجل (يفتح «امتحاناتي») */
export async function examSoonPush(uid: number, title: string, minutes: number) {
  if (!(await kvGet(key(uid)).catch(() => null))) return false;
  const { isPilot } = await import("./appLink.ts");
  if (!await isPilot(uid)) return false;
  recent.set(uid, Date.now());
  return pushApp(uid, { title: `⏰ امتحانك بعد ${minutes} دقيقة`, body: `${title ? `${plain(title, 60)}. ` : ""}جهز نفسك، وأول ما يبدي يوصلك إشعار.`, type: "bot_exam" });
}

/** إشعار جديد: لطلاب التجربة اللي يوصلهم وعدهم رمز تلفون. يرجع عدد اللي وصلهم */
export async function noticePush(text: string, forUid: (uid: number) => Promise<boolean>) {
  const { pilotIds } = await import("./appLink.ts");
  const ids: number[] = [];
  for (const uid of await pilotIds()) if (await hasPushToken(uid) && await forUid(uid)) ids.push(uid);
  let sent = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const r = await Promise.all(ids.slice(i, i + 10).map((uid) => pushApp(uid, { title: "🔔 إشعار جديد", body: plain(text), type: "bot_notice" })));
    sent += r.filter(Boolean).length;
  }
  return sent;
}
