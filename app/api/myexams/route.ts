import { myExamAction, schedSettings } from "../../../lib/schedApi.ts";
import { uploadAnswer } from "../../../lib/examRoom.ts";
import { submitObjection } from "../../../lib/objections.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    if (form.get("action") === "object") return await submitObjection(form);
    return { room: await uploadAnswer(form, await schedSettings()) };
  }
  return await myExamAction(await req.json().catch(() => ({})));
});
