import { myExamAction, schedSettings } from "../../../lib/schedApi.ts";
import { uploadAnswer } from "../../../lib/examRoom.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return { room: await uploadAnswer(await req.formData(), await schedSettings()) };
  return await myExamAction(await req.json().catch(() => ({})));
});
