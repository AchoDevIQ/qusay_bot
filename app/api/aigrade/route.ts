import { aiGradeAction, aiGradeUpload } from "../../../lib/aiGradeApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// تطليع الخطوات من صورة الحل ياخذ وقت
export const maxDuration = 120;

export const POST = (req: Request) => apiResponse(async () => {
  // تجربة على جواب حقيقي: صور
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return await aiGradeUpload(await req.formData());
  return (await aiGradeAction(await req.json()))!;
});
