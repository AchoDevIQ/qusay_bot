import { uploadAction, uploadFile } from "../../../lib/uploadApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return await uploadFile(await req.formData());
  return await uploadAction(await req.json().catch(() => ({})));
});
