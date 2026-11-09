import { labelHtml, verifyPrintToken } from "../../../lib/inPerson.ts";
import { ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ليبل الطالب: ينفتح برا تليجرام ويطبع وحده
export async function GET(req: Request) {
  await ensure();
  const t = verifyPrintToken(new URL(req.url).searchParams.get("k"));
  if (!t || t.kind !== "l") return new Response("الرابط انتهى، اطبعه من البوت مرة ثانية", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try { return new Response(await labelHtml(t.id, /Android/i.test(req.headers.get("user-agent") ?? "")), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
  catch (e) { return new Response(e instanceof Error ? e.message : "خطأ", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
}
