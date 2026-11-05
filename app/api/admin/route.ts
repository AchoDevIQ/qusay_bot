import { adminHomeAction } from "../../../lib/adminHomeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await adminHomeAction(await req.json()));
