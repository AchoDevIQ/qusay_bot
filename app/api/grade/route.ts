import { gradeAction, gradeBrowserOpen, gradeUpload } from "../../../lib/gradeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  if (isForm) return await gradeUpload(await req.formData());
  const body = await req.json().catch(() => ({}));
  // الرابط اللي ينفتح مرة وحدة بمتصفح التلفون: ما بي توقيع بعد، فيتحقق من الرمز نفسه
  return body?.action === "browserOpen" ? await gradeBrowserOpen(body) : await gradeAction(body);
});
