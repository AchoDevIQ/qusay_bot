// التطبيق يسأل: الطالب لازم يختار أوقات امتحاناته قبل ما ينفتحله شي؟ (id = رمز دخوله بالتطبيق)
import { appState } from "../../../../lib/appLink.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const f = await req.formData();
    const s = await appState({ id: f.get("id") });
    return Response.json(s ?? { error: "bad token" }, { status: s ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("app state failed", e instanceof Error ? e.message : e);
    return Response.json({ needSchedule: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
