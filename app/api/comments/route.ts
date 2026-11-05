import { commentsAction, stickerUpload } from "../../../lib/commentsApi.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => {
  const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  return isForm ? await stickerUpload(await req.formData()) : await commentsAction(await req.json().catch(() => ({})));
});
