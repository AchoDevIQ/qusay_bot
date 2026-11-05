import { notifyStarted } from "../../../lib/examRoom.ts";
import { schedSettings } from "../../../lib/schedApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// مؤقت من برا يطلب هذا الرابط كل دقيقة، حتى توصل رسالة «بدأ الامتحان»
export const GET = (req: Request) => apiResponse(async () => await notifyStarted(new URL(req.url).searchParams.get("key"), await schedSettings()));
