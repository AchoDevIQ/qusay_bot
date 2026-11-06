// قفل الجهاز: صفحات الطالب تشتغل على أول جهاز يفتحها بس. جهاز ثاني ينرفض لحد ما الإدارة تفك القفل من صفحة الطالب.
// الجهاز يتعرف برقم عشوائي تحفظه الصفحة بذاكرة تلگرام على الجهاز (DeviceStorage). الكادر وأولياء الأمور بدون قفل
import { one, put, remove } from "./db.ts";
import { logActivity } from "./access.ts";
import { isStaff, student } from "./data.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const LOCKED_TEXT = "🔒 حسابك مفتوح على جهاز ثاني. الحساب يشتغل على جهاز واحد بس. إذا بدلت جهازك تواصل ويا قصي العميري حتى يفك القفل.";
const DEVICE_RE = /^[A-Za-z0-9-]{16,64}$/;

export async function checkDevice(uid: number, raw: unknown) {
  if (await isStaff(uid) || !await student(uid)) return;
  const dev = String(raw ?? "").trim();
  need(DEVICE_RE.test(dev), "حدّث تلگرام وافتح الصفحة من جديد", 400);
  const row = await one("student_devices", { user_id: uid });
  if (!row) { await put("student_devices", { user_id: uid, device: dev, at: stamp(), tried: null }); return; }
  if (row.device === dev) return;
  // نسجل المحاولة مرة وحدة باليوم حتى الإدارة تشوفها بسجل الطالب
  const today = stamp().slice(0, 10);
  if (!String(row.tried ?? "").startsWith(today)) {
    await put("student_devices", { ...row, tried: stamp() });
    await logActivity(uid, "🔒 حاول يفتح صفحاته من جهاز ثاني وانرفض");
  }
  need(false, LOCKED_TEXT, 423);
}

export async function deviceOf(uid: number) {
  const row = await one("student_devices", { user_id: uid });
  return row ? { at: row.at as string, tried: (row.tried ?? "") as string } : null;
}
export async function unlockDevice(uid: number) {
  await remove("student_devices", { user_id: uid });
  await logActivity(uid, "🔓 الإدارة فكت قفل الجهاز، وأول جهاز يفتح الصفحات ينقفل عليه");
}
