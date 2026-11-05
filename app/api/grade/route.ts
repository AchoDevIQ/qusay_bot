import { gradeAction } from "../../../lib/gradeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await gradeAction(await req.json().catch(() => ({}))));
