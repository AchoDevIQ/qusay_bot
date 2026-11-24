import { answerToTeacher, answerView, qaExplain } from "../../../lib/qaBank.ts";
import { apiResponse, ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «🤔 ما فهمت خطوة»: action explain، وإلا الحل نفسه
export const POST = (req: Request) => apiResponse(async () => { await ensure(); const b = await req.json(); return b?.action === "explain" ? await qaExplain(b) : b?.action === "teacher" ? await answerToTeacher(b) : await answerView(b); });
