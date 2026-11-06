import { checkpointsAction } from "../../../lib/checkpoints.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await checkpointsAction(await req.json()));
