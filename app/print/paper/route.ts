import { paperHtml, verifyPrintToken } from "../../../lib/inPerson.ts";
import { ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ورقة الامتحان: باسم الطالب، أو نسخة للاستنساخ. تنفتح برا تليجرام وتطبع وحدها
export async function GET(req: Request) {
  await ensure();
  const t = verifyPrintToken(new URL(req.url).searchParams.get("k"));
  if (!t || t.kind === "l") return new Response("الرابط انتهى، اطبعه من البوت مرة ثانية", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try { return new Response(await paperHtml(t.kind, t.id), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
  catch (e) { return new Response(e instanceof Error ? e.message : "خطأ", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
}
