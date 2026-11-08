import { answerView } from "../../../lib/qaBank.ts";
import { apiResponse, ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => { await ensure(); return await answerView(await req.json()); });
