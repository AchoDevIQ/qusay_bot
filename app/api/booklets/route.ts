import { bookletAction } from "../../../lib/booklets.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// الملفات تجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => await bookletAction((req.headers.get("content-type") ?? "").includes("multipart") ? await req.formData() : await req.json()));
