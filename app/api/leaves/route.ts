import { leavesAction, leavesUpload } from "../../../lib/examLeaves.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  return isForm ? await leavesUpload(await req.formData()) : await leavesAction(await req.json().catch(() => ({})));
});
