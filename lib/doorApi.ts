// صفحة باب الكادر (/store/door): الرابط الخاص + الرمز ← رابط جلسة لصفحاته، وتفعيل إشعاراته
import { doorState, doorTargets, openDoor, saveDoorSub, setDoorPin, verifyDoor } from "./doorLink.ts";
import { ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export async function doorAction(body: any) {
  await ensure();
  const uid = await verifyDoor(body?.d);
  need(uid !== null, "هذا الرابط انتهى أو انبطل. اطلب رابط جديد من صاحب البوت", 401);
  const a = String(body?.action ?? "state");
  if (a === "state") return { ...await doorState(uid!), vapid: process.env.VAPID_PUBLIC_KEY ?? "" };
  if (a === "setPin") { await setDoorPin(uid!, body.pin, body.pin2); return { t: await openDoor(uid!, body.pin), ...await doorTargets(uid!) }; }
  if (a === "open") return { t: await openDoor(uid!, body.pin), ...await doorTargets(uid!) };
  if (a === "pushSub") {
    need(verifyHomeToken(body.t) === uid, "اكتب رمزك مرة ثانية", 401);
    await saveDoorSub(uid!, body.sub);
    return { notice: "🔔 تفعّلت الإشعارات على هذا الجهاز" };
  }
  need(false, "أمر غير معروف");
  return {};
}
