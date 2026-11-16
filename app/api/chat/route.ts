import { chatAction, chatUpload } from "../../../lib/appChatApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// الصور والتسجيلات تجي FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => (req.headers.get("content-type") ?? "").includes("multipart") ? await chatUpload(await req.formData()) : await chatAction(await req.json()));
