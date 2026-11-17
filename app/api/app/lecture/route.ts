// التطبيق يبلغ: الطالب فتح محاضرة، أو وصل لنسبة منها (id = رمز دخوله بالتطبيق)
import { lectureView } from "../../../../lib/appLink.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const f = await req.formData();
    const ok = await lectureView({ id: f.get("id"), lecture: f.get("lecture"), title: f.get("title"), subject: f.get("subject"), ev: f.get("ev"), percent: f.get("percent") });
    return Response.json({ ok }, { status: ok ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("lecture view failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
