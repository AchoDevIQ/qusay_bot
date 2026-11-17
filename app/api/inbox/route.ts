import { inboxAction, noticeImage } from "../../../lib/notices.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await inboxAction(await req.json()));
export const GET = (req: Request) => noticeImage(new URL(req.url));
