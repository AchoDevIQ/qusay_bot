// دكة المؤقت كل دقيقة: رسالة «بدأ الامتحان»، السيطرات، رسالة المصحح، وتقارير المراكز.
// إذا الدكة اللي قبلها بعدها تشتغل (رسائل هواية) هاي ما تبدي، حتى ما تتكرر الرسائل.
// وكل خطوة لحالها: إذا وحدة خربت الباقي يكمل
import { sweepSessions } from "./centerRent.ts";
import { sweepCheckpoints } from "./checkpoints.ts";
import { sweepSignups } from "./signups.ts";
import { sweepBirthdays } from "./birthdays.ts";
import { kvGet, kvSet } from "./db.ts";
import { notifyStarted } from "./examRoom.ts";
import { notifyGraders } from "./graderPay.ts";
import { aiGradeTick } from "./aiGrade.ts";
import { finishByAi } from "./gradeApi.ts";
import { schedSettings } from "./schedApi.ts";
import { ApiError, ensure } from "./webApi.ts";
import { cronKey } from "./webAuth.ts";

const LOCK = "cron_lock";
const STALE = 5 * 60 * 1000;   // قفل أقدم من 5 دقايق يعني الدكة وگفت بنص الطريق

export async function cronTick(key: unknown) {
  await ensure();
  if (key !== cronKey()) throw new ApiError(401, "no");
  const held = Number(await kvGet(LOCK)) || 0;
  if (held && Date.now() - held < STALE) return { busy: true };
  await kvSet(LOCK, String(Date.now()));
  const out: Record<string, unknown> = {};
  const step = async (name: string, f: () => Promise<unknown>) => {
    try { out[name] = await f(); } catch (e) { console.error("cron", name, e); out[name] = "error"; }
  };
  try {
    await step("started", async () => notifyStarted(key, await schedSettings()));
    await step("checked", () => sweepCheckpoints());
    await step("ai", () => aiGradeTick(finishByAi));
    await step("graders", () => notifyGraders());
    await step("sessions", () => sweepSessions());
    await step("signups", () => sweepSignups());
    await step("birthdays", () => sweepBirthdays());
  } finally {
    await kvSet(LOCK, "0");
  }
  return out;
}
