import { studentAction, studentUpload } from "../../../lib/studentApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  // ورقة تجربة من صور حقيقية
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return await studentUpload(await req.formData());
  return await studentAction(await req.json());
});
