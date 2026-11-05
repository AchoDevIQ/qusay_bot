import { examAction, examUpload } from "../../../lib/examApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  return isForm ? await examUpload(await req.formData()) : await examAction(await req.json());
});
