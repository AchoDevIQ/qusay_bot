import { checkpointsAction } from "../../../lib/checkpoints.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// صور الشخصيات تجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => await checkpointsAction((req.headers.get("content-type") ?? "").includes("multipart") ? await req.formData() : await req.json()));
