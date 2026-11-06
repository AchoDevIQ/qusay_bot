import { sweepCheckpoints } from "../../../lib/checkpoints.ts";
import { notifyGraders } from "../../../lib/graderPay.ts";
import { notifyStarted } from "../../../lib/examRoom.ts";
import { schedSettings } from "../../../lib/schedApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// مؤقت من برا يطلب هذا الرابط كل دقيقة، حتى توصل رسالة «بدأ الامتحان»، وكل نص ساعة تنحسب السيطرات
export const GET = (req: Request) => apiResponse(async () => {
  const r = await notifyStarted(new URL(req.url).searchParams.get("key"), await schedSettings());
  return { ...r, checked: await sweepCheckpoints(), graders: await notifyGraders() };
});
