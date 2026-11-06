import { signupsAction } from "../../../lib/signups.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// الصوت يجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => await signupsAction((req.headers.get("content-type") ?? "").includes("multipart") ? await req.formData() : await req.json()));
