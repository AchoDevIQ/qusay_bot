// باب الكادر بدون تليگرام (قرار الأستاذ 2026-11-17): صاحب البوت والمساعدين والمصححين وصاحب المكتبة يدخلون صفحاتهم
// من أي متصفح (آيباد، تلفون، حاسبة) برابط خاص + رمز سري من 4 أرقام، بدل تليگرام المحظور.
// الصفحات نفسها ما تتغير (التصحيح، اللوحة، المكتبة...)، بس الباب. رسائلهم تنحفظ بمحادثتهم وتوصلهم إشعارات ببلاش.
// صاحب البوت يبطل الرابط بدوسة، والرابط القديم ما يشتغل بعدها
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { find, insert, kvGet, kvSet, one, put, remove } from "./db.ts";
import { ADMIN_IDS, TOKEN } from "./config.ts";
import { siteBase } from "./keyboards.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

/** مساعد جديد بدون تليگرام ياخذ رقم من هنا وفوك */
export const STAFF_BASE = 600_000_000_000_000;
const MAX_FAILS = 5, LOCK_MIN = 30;

const sig = (uid: number, ver: string) => createHmac("sha256", createHmac("sha256", "QMathDoor").update(TOKEN).digest()).update(`${uid}.${ver}`).digest("base64url").slice(0, 32);
const hashPin = (pin: string, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
function pinOk(pin: string, stored: string) {
  const [salt, h] = stored.split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(scryptSync(pin, salt, 32).toString("hex")), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}
const cleanPin = (v: unknown) => String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();

const urlOf = (uid: number, ver: string) => `${siteBase()}/store/door?d=k${uid}.${ver}.${sig(uid, ver)}`;
/** رابط دخوله الثابت (طلبه 2026-11-28: «ليش يومياً رابط جديد؟»): إذا عنده رابط، يرجع نفسه وما ينبطل شي.
 *  fresh: «🔄 رابط جديد» بس (الرابط انسرب أو نسى رمزه): يسوي واحد جديد ويبطل القديم ويطلب رمز جديد */
export async function makeDoor(uid: number, label: string, fresh = false) {
  const had = await one("door_links", { user_id: uid });
  if (had && !fresh) {
    if (label && had.label !== label) await put("door_links", { ...had, label });
    return urlOf(uid, String(had.ver));
  }
  const ver = `${Date.now()}${randomBytes(3).toString("hex")}`;
  await put("door_links", { user_id: uid, ver, hash: null, fails: 0, locked_until: null, label, created: stamp() });
  return urlOf(uid, ver);
}
export const revokeDoor = async (uid: number) => { await remove("door_links", { user_id: uid }); };
export const hasDoor = async (uid: number) => !!await one("door_links", { user_id: uid });

/** رقم الحساب من الرابط، أو null */
export async function verifyDoor(d: unknown): Promise<number | null> {
  if (typeof d !== "string" || !d.startsWith("k") || !TOKEN) return null;
  const [u, ver, h] = d.slice(1).split(".");
  const uid = Number(u);
  if (!Number.isSafeInteger(uid) || !ver || !h) return null;
  const r = await one("door_links", { user_id: uid });
  if (!r || String(r.ver) !== ver) return null;
  const want = Buffer.from(sig(uid, ver)), got = Buffer.from(h);
  return want.length === got.length && timingSafeEqual(want, got) ? uid : null;
}

export async function doorState(uid: number) {
  const r = await one("door_links", { user_id: uid });
  return { hasPin: !!r?.hash, label: String(r?.label ?? "") };
}
/** أول مرة على جهازه: يحط رمزه */
export async function setDoorPin(uid: number, pin: unknown, pin2: unknown) {
  const r = await one("door_links", { user_id: uid });
  need(r, "هذا الرابط انتهى", 401);
  need(!r!.hash, "رمزك محطوط من قبل. إذا نسيته، صاحب البوت يسويلك رابط جديد", 409);
  const p = cleanPin(pin);
  need(/^\d{4}$/.test(p), "الرمز 4 أرقام");
  need(p === cleanPin(pin2), "الرمزين مو نفس الشي، اكتبه مرة ثانية");
  need(!/^(\d)\1{3}$/.test(p) && !["1234", "4321", "0123", "9876"].includes(p), "هذا الرمز سهل كلش، اختار غيره");
  await put("door_links", { ...r!, hash: hashPin(p) });
}
/** رمز صعب من 4 أرقام (بلا 1111 ولا 1234 ولا تكرار رقم 3 مرات) */
export function strongPin() {
  for (;;) {
    const p = String(randomBytes(4).readUInt32BE(0) % 10000).padStart(4, "0");
    const d = [...p].map(Number), step = d[1] - d[0];
    if (new Set(d).size < 3) continue;                       // 1121، 1122، 1111
    if (d.every((x, i) => i === 0 || x - d[i - 1] === step)) continue; // 1234، 9876، 2468
    if (p.slice(0, 2) === p.slice(2)) continue;              // 1212
    return p;
  }
}
/** أول مرة على جهازه: النظام يسويله رمزه ويگله إياه (طلبه 2026-11-26: «خليه يصنعله باسورد») */
export async function makeDoorPin(uid: number) {
  const p = strongPin();
  await setDoorPin(uid, p, p);
  return p;
}
/** يفتح برمزه: يرجع رابط جلسة لصفحاته (لوحة التحكم تقبله أسبوع) */
export async function openDoor(uid: number, pin: unknown) {
  const r = await one("door_links", { user_id: uid });
  need(r?.hash, "حط رمزك أول", 409);
  need(!r!.locked_until || Number(r!.locked_until) < Date.now(), `الرمز انقفل لأن انكتب غلط هواية. جرب بعد ${LOCK_MIN} دقيقة`, 423);
  if (!pinOk(cleanPin(pin), String(r!.hash))) {
    const fails = Number(r!.fails ?? 0) + 1;
    const lock = fails >= MAX_FAILS ? String(Date.now() + LOCK_MIN * 60_000) : null;
    await put("door_links", { ...r!, fails: lock ? 0 : fails, locked_until: lock });
    need(false, lock ? `الرمز انقفل نص ساعة لأن انكتب غلط ${MAX_FAILS} مرات` : `الرمز غلط. باقي ${MAX_FAILS - fails} محاولات`, 403);
  }
  if (r!.fails || r!.locked_until) await put("door_links", { ...r!, fails: 0, locked_until: null });
  const { homeToken } = await import("./webAuth.ts");
  // نفس رابط صفحات البوت: لوحة التحكم تقبله أسبوع من يوم انعمل، وبعدها يكتب رمزه مرة ثانية
  return homeToken(uid);
}

/** وين يروح: اللوحة للمدير والمساعدين، والمكتبة لصاحبها */
export async function doorTargets(uid: number) {
  const { isStaff, myOffice } = await import("./data.ts");
  const admin = ADMIN_IDS.includes(uid) || await isStaff(uid), office = !!await myOffice(uid);
  // طالب (رابط طوارئ بالمتصفح): قائمته ومحادثته وإشعاراته
  const { student } = await import("./data.ts");
  return { admin, office, student: !admin && !office && !!await student(uid) };
}

/** مساعد جديد ما عنده تليگرام: رقم جديد ثابت */
export async function newStaffId() {
  return await (async () => {
    const n = Number((await kvGet("staff_uid_seq")) ?? 0) + 1;
    await kvSet("staff_uid_seq", String(n));
    return STAFF_BASE + n;
  })();
}

// ---------- إشعارات الكادر على جهازه (مثل ولي الأمر)
export async function saveDoorSub(uid: number, raw: unknown) {
  const s = raw as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  need(s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth, "ما گدرنا نفعّل الإشعارات", 400);
  await remove("door_push", { user_id: uid, endpoint: s.endpoint });
  await insert("door_push", { user_id: uid, endpoint: s.endpoint, keys: JSON.stringify(s.keys), created: stamp() });
}
export async function notifyDoor(uid: number, text: string) {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) return 0;
  const subs = await find("door_push", { user_id: uid });
  if (!subs.length) return 0;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(siteBase() || "https://qmath.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const plain = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140) || "رسالة جديدة";
  let ok = 0;
  for (const r of subs) {
    try {
      await webpush.sendNotification({ endpoint: String(r.endpoint), keys: JSON.parse(String(r.keys)) }, JSON.stringify({ title: "قصي العميري", body: plain, url: "/store/door" }), { TTL: 86400 });
      ok++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await remove("door_push", { user_id: uid, endpoint: r.endpoint });
      else console.error("door push", e?.statusCode ?? e);
    }
  }
  return ok;
}
