import { noteAction } from "../../../lib/notes.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await noteAction(await req.json().catch(() => ({}))));
