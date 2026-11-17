import { announceAction, noticeImage } from "../../../lib/notices.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// إشعار بصورة يجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => (req.headers.get("content-type") ?? "").includes("multipart") ? await announceAction(await req.formData()) : await announceAction(await req.json()));
export const GET = (req: Request) => noticeImage(new URL(req.url));
