import { myExamAction } from "../../../lib/schedApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await myExamAction(await req.json().catch(() => ({}))));
