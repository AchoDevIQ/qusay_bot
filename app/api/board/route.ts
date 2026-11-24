import { boardAction, boardUpload } from "../../../lib/boardApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 📝 السبورة: الصور (خلفية الصفحة) FormData، والباقي JSON
export const POST = (req: Request) => apiResponse(async () => (req.headers.get("content-type") ?? "").includes("multipart") ? await boardUpload(await req.formData()) : await boardAction(await req.json()));
