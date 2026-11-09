import { testPlanAction } from "../../../lib/testPlanApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await testPlanAction(await req.json()));
