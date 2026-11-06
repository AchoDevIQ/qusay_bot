import { cronTick } from "../../../lib/cronTick.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// مؤقت من برا يطلب هذا الرابط كل دقيقة، حتى توصل رسالة «بدأ الامتحان»، وكل نص ساعة تنحسب السيطرات
export const GET = (req: Request) => apiResponse(() => cronTick(new URL(req.url).searchParams.get("key")));
