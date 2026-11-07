import { aiGradeAction } from "../../../lib/aiGradeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// تطليع الخطوات من صورة الحل ياخذ وقت
export const maxDuration = 120;

export const POST = (req: Request) => apiResponse(async () => (await aiGradeAction(await req.json()))!);
