import { gradeAction, gradeUpload } from "../../../lib/gradeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  return isForm ? await gradeUpload(await req.formData()) : await gradeAction(await req.json().catch(() => ({})));
});
