// صفحة باب الكادر (/store/door): الرابط الخاص + الرمز ← رابط جلسة لصفحاته، وتفعيل إشعاراته
import { doorState, doorTargets, makeDoorPin, openDoor, saveDoorSub, setDoorPin, verifyDoor } from "./doorLink.ts";
import { ensure, need } from "./webApi.ts";
import { homeToken, verifyHomeToken, verifyInitData } from "./webAuth.ts";

export async function doorAction(body: any) {
  await ensure();
  const uid = await verifyDoor(body?.d);
  need(uid !== null, "هذا الرابط انتهى أو انبطل. اطلب رابط جديد من صاحب البوت", 401);
  const a = String(body?.action ?? "state");
  if (a === "state") return { ...await doorState(uid!), vapid: process.env.VAPID_PUBLIC_KEY ?? "" };
  if (a === "makePin") { const pin = await makeDoorPin(uid!); return { pin, t: await openDoor(uid!, pin), ...await doorTargets(uid!) }; }
  if (a === "setPin") { await setDoorPin(uid!, body.pin, body.pin2); return { t: await openDoor(uid!, body.pin), ...await doorTargets(uid!) }; }
  // الجهاز يتذكر الدخول (طلبه 2026-11-27: «ليش يومياً أطلب رابط؟»): دخلته اللي قبل بعدها شغالة ← دخلة جديدة بدون رمز،
  // فما يكتب رمزه إلا إذا ما فتحها أسبوع كامل. إبطال رابطه يسد هذا هم (verifyDoor فوك)
  if (a === "resume") { need(verifyInitData(`tk:${String(body.t ?? "")}`) === uid, "اكتب رمزك", 401); return { t: homeToken(uid!), ...await doorTargets(uid!) }; }
  if (a === "open") return { t: await openDoor(uid!, body.pin), ...await doorTargets(uid!) };
  if (a === "pushSub") {
    need(verifyHomeToken(body.t) === uid, "اكتب رمزك مرة ثانية", 401);
    await saveDoorSub(uid!, body.sub);
    return { notice: "🔔 تفعّلت الإشعارات على هذا الجهاز" };
  }
  need(false, "أمر غير معروف");
  return {};
}
