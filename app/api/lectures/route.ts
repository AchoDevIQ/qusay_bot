import { lectureFileUpload, lecturesAction } from "../../../lib/lectures.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ملف المحاضرة يجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => ((req.headers.get("content-type") ?? "").includes("multipart") ? await lectureFileUpload(await req.formData()) : await lecturesAction(await req.json())));
