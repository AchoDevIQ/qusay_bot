// ولي الأمر على تلفون ابنه (قرار الأستاذ 2026-11-17): بدل تليگرام، ولي الأمر يحط رمز سري من 4 أرقام بتطبيق ابنه.
// ينربط كأنه ولي أمر عادي برقم وهمي (GUARD_BASE + رقم الطالب)، فكل نظام ولي الأمر القديم يشتغل مثل ما هو:
// الدرجة توصله ويا «✅ استلمت»، والدرجات الجاية تنتظر استلامه، وتنبيهات صاحب البوت. رسائله تنحفظ بمحادثة التطبيق
// (رقمه فوك 10^13) وتطلع بصفحة «👨‍👧 ولي الأمر» بس بعد ما يكتب رمزه
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { one, put, remove, type Row } from "./db.ts";
import { TOKEN } from "./config.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const GUARD_BASE = 500_000_000_000_000;
export const pinGuardian = (sid: number) => GUARD_BASE + sid;
export const isPinGuardian = (gid: number) => gid >= GUARD_BASE;
const MAX_FAILS = 5, LOCK_MIN = 30;

const hashPin = (pin: string, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
function pinOk(pin: string, stored: string) {
  const [salt, h] = stored.split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(scryptSync(pin, salt, 32).toString("hex")), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}
const cleanPin = (v: unknown) => String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();

export async function pinState(sid: number) {
  const r = await one("guardian_pins", { user_id: sid });
  return { hasPin: !!r, hasFace: !!r?.face, method: r ? String(r.method ?? "pin") : "" };
}

/** أول مرة: ولي الأمر يحط رمزه. تغييره بس من صاحب البوت (يصفّره من ملف الطالب) */
export async function setPin(sid: number, pin: unknown, pin2: unknown) {
  need(!await one("guardian_pins", { user_id: sid }), "رمز ولي الأمر محطوط من قبل. لتغييره تواصل ويا الإدارة", 409);
  const p = cleanPin(pin);
  need(/^\d{4}$/.test(p), "الرمز 4 أرقام");
  need(p === cleanPin(pin2), "الرمزين مو نفس الشي، اكتبه مرة ثانية");
  need(!/^(\d)\1{3}$/.test(p) && !["1234", "4321", "0123", "9876"].includes(p), "هذا الرمز سهل كلش، اختار غيره");
  const gid = pinGuardian(sid);
  await put("guardian_pins", { user_id: sid, hash: hashPin(p), method: "pin", fails: 0, locked_until: null, created: stamp() });
  // ولي أمر تليگرام قديم يبقى، وهذا ينضاف وياه
  await put("guardians", { guardian_id: gid, student_id: sid, created: stamp() });
  const { logActivity } = await import("./access.ts");
  await logActivity(sid, "👨‍👧 ولي الأمر حط رمزه السري على تطبيق ابنه");
  // الدرجات اللي كانت تنتظر ولي أمر توصله هسه
  try { const { releaseHeld } = await import("./gradeApi.ts"); await releaseHeld(sid); } catch (e) { console.error(e); }
  return gid;
}

/** يفتح صفحة ولي الأمر: يرجع رمز جلسة لنص ساعة. 5 محاولات غلط تقفلها نص ساعة */
export async function openWithPin(sid: number, pin: unknown) {
  const r = await one("guardian_pins", { user_id: sid });
  need(r, "ولي أمرك بعده ما حط رمزه", 404);
  need(!r!.locked_until || Number(r!.locked_until) < Date.now(), `الرمز انقفل لأن انكتب غلط هواية. جرب بعد ${LOCK_MIN} دقيقة`, 423);
  if (!pinOk(cleanPin(pin), String(r!.hash))) {
    const fails = Number(r!.fails ?? 0) + 1;
    const lock = fails >= MAX_FAILS ? String(Date.now() + LOCK_MIN * 60_000) : null;
    await put("guardian_pins", { ...r!, fails: lock ? 0 : fails, locked_until: lock });
    need(false, lock ? `الرمز انقفل نص ساعة لأن انكتب غلط ${MAX_FAILS} مرات` : `الرمز غلط. باقي ${MAX_FAILS - fails} محاولات`, 403);
  }
  if (r!.fails || r!.locked_until) await put("guardian_pins", { ...r!, fails: 0, locked_until: null });
  return guardToken(sid);
}

const sig = (sid: number, exp: number) => createHmac("sha256", createHmac("sha256", "QMathGuard").update(TOKEN).digest()).update(`${sid}.${exp}`).digest("hex");
export function guardToken(sid: number, now = Date.now() / 1000) {
  const exp = Math.floor(now) + 1800;
  return `g${sid}.${exp}.${sig(sid, exp)}`;
}
/** رقم الطالب من رمز جلسة ولي الأمر، أو null */
export function verifyGuardToken(t: unknown, now = Date.now() / 1000): number | null {
  if (typeof t !== "string" || !t.startsWith("g") || !TOKEN) return null;
  const [s, e, h] = t.slice(1).split(".");
  const sid = Number(s), exp = Number(e);
  if (!Number.isSafeInteger(sid) || !(exp > now) || !h) return null;
  const want = Buffer.from(sig(sid, exp)), got = Buffer.from(h);
  return want.length === got.length && timingSafeEqual(want, got) ? sid : null;
}

/** صاحب البوت يصفّر الرمز: ولي الأمر يحط رمز جديد، ورسائله القديمة تبقى */
export async function resetPin(sid: number) {
  await remove("guardian_pins", { user_id: sid });
  await remove("guardians", { guardian_id: pinGuardian(sid), student_id: sid });
}
export type PinRow = Row;

// ---------- التوقيع بالوجه: بصمة الوجه (128 رقم، ما تنرجع صورة) تنحفظ مشفرة. التطابق يصير بالسيرفر حتى ما ينغش من التلفون.
// صورة كل توقيع تنحفظ مشفرة حتى صاحب البوت يراجعها، وتنمسح وحدها ورا 30 يوم
export const FACE_MATCH = 0.5;
const PHOTO_DAYS = 30;
function descriptor(v: unknown): number[] {
  need(Array.isArray(v) && v.length === 128 && v.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 5), "ما گدرنا نقرا الوجه، جرب مرة ثانية بضوء أحسن", 400);
  return v as number[];
}
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
async function savePhoto(sid: number, photo: unknown, kind: "set" | "sign") {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(photo ?? ""));
  if (!m || m[1].length > 2_000_000) return;
  const { seal } = await import("./secretBox.ts");
  const { files } = await import("./files.ts");
  const store = files();
  await store.write(`guardface/${sid}/${Date.now()}-${kind}.sealed`, Buffer.from(seal(Buffer.from(m[1], "base64"))), "application/octet-stream");
  // اللي عمره أكثر من 30 يوم ينمسح (مخزن الملفات ما بيه مسح، فنكتب فوگه فارغ)
  const cut = Date.now() - PHOTO_DAYS * 86400_000;
  for (const ref of await store.list(`guardface/${sid}/`, true)) {
    const t = Number(ref.split("/").pop()?.split("-")[0]);
    if (t && t < cut) await store.write(ref, Buffer.alloc(0), "application/octet-stream");
  }
}
/** آخر صور توقيع ولي الأمر (مفكوكة) لصاحب البوت */
export async function signPhotos(sid: number, max = 6) {
  const { unseal } = await import("./secretBox.ts");
  const { files } = await import("./files.ts");
  const store = files();
  const refs = (await store.list(`guardface/${sid}/`, true)).sort().reverse().slice(0, max);
  const out: { at: string; kind: string; src: string }[] = [];
  for (const ref of refs) {
    const b = await store.read(ref);
    const img = b && b.length ? unseal(b.toString()) : null;
    if (!img) continue;
    const [t, k] = (ref.split("/").pop() ?? "").split("-");
    out.push({ at: new Date(Number(t) + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " "), kind: k?.startsWith("set") ? "تسجيل الوجه" : "توقيع", src: `data:image/jpeg;base64,${img.toString("base64")}` });
  }
  return out;
}
/** ولي الأمر (فاتح برمزه) يسجل وجهه */
export async function setFace(sid: number, desc: unknown, photo: unknown) {
  const d = descriptor(desc);
  const r = await one("guardian_pins", { user_id: sid });
  need(r, "حط رمزك أول", 409);
  const { seal } = await import("./secretBox.ts");
  await put("guardian_pins", { ...r!, face: seal(JSON.stringify(d.map((x) => Math.round(x * 1e5) / 1e5))), face_at: stamp() });
  await savePhoto(sid, photo, "set");
  const { logActivity } = await import("./access.ts");
  await logActivity(sid, "📸 ولي الأمر سجل وجهه للتوقيع");
}
/** يفتح صفحة ولي الأمر بوجهه: يرجع رمز جلسة، والغلط ينحسب ويا محاولات الرمز */
export async function openWithFace(sid: number, desc: unknown, photo: unknown) {
  const d = descriptor(desc);
  const r = await one("guardian_pins", { user_id: sid });
  need(r?.face, "ولي أمرك بعده ما سجل وجهه", 404);
  need(!r!.locked_until || Number(r!.locked_until) < Date.now(), `انقفل لأن فشل هواية. جرب بعد ${LOCK_MIN} دقيقة`, 423);
  const { unseal } = await import("./secretBox.ts");
  const saved = JSON.parse(unseal(String(r!.face))?.toString() ?? "[]") as number[];
  await savePhoto(sid, photo, "sign");
  if (saved.length !== 128 || distance(d, saved) > FACE_MATCH) {
    const fails = Number(r!.fails ?? 0) + 1;
    const lock = fails >= MAX_FAILS ? String(Date.now() + LOCK_MIN * 60_000) : null;
    await put("guardian_pins", { ...r!, fails: lock ? 0 : fails, locked_until: lock });
    need(false, lock ? "انقفل نص ساعة لأن الوجه ما تطابق هواية مرات. افتح بالرمز" : "الوجه ما تطابق. جرب بضوء أحسن، أو افتح بالرمز", 403);
  }
  if (r!.fails || r!.locked_until) await put("guardian_pins", { ...r!, fails: 0, locked_until: null });
  return guardToken(sid);
}
