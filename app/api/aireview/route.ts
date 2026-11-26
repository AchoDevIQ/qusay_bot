// 🤖 مراجعة تصحيح الذكاء: المجموعات، أوراق المجموعة، حفظ الدرجات، الموافقة، والإعداد
import { aiReviewAction } from "../../../lib/aiReview.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await aiReviewAction(await req.json()));
