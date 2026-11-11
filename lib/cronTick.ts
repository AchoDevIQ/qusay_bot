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
import { aiGradeTick, draftQueueTick } from "./aiGrade.ts";
import { examQueueTick } from "./qaBank.ts";
import { ADMIN_IDS } from "./config.ts";
import { finishByAi, paperName, aiObjectionsTick } from "./gradeApi.ts";
import { fillAllVersions, schedSettings } from "./schedApi.ts";
import { fixLectureTitles } from "./examBank.ts";
import { sweepMakeup } from "./makeup.ts";
import { ApiError, ensure } from "./webApi.ts";
import { cronKey } from "./webAuth.ts";

const LOCK = "cron_lock";
const STALE = 5 * 60 * 1000;
const AI_LOCK = "cron_ai_lock", AI_STALE = 6 * 60 * 1000;   // قفل أقدم من 5 دقايق يعني الدكة وگفت بنص الطريق

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
    await step("graders", () => notifyGraders());
    await step("sessions", () => sweepSessions());
    await step("signups", () => sweepSignups());
    await step("birthdays", () => sweepBirthdays());
    await step("lectureTitles", () => fixLectureTitles());
    await step("examTitlesEn", async () => (await import("./examTitlesEn.ts")).fillEnTitles());
    await step("versionsFill", () => fillAllVersions());
    await step("makeup", () => sweepMakeup());
  } finally {
    await kvSet(LOCK, "0");
  }
  // نظام التصحيح AI بقفل لحاله: شغله ياخذ دقايق (أوراق هواية سوا)، فما يأخر رسائل بدء الامتحانات بالدكة الجاية
  const aiHeld = Number(await kvGet(AI_LOCK)) || 0;
  if (aiHeld && Date.now() - aiHeld < AI_STALE) { out.aiBusy = true; return out; }
  await kvSet(AI_LOCK, String(Date.now()));
  try {
    await step("ai", () => aiGradeTick(finishByAi, paperName));
    await step("aiDraft", () => draftQueueTick(ADMIN_IDS[0] ?? 0));
    await step("qaExams", () => examQueueTick());
    await step("aiObjections", () => aiObjectionsTick());
  } finally {
    await kvSet(AI_LOCK, "0");
  }
  return out;
}
