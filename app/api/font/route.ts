// خط صفحات التطبيق: ?f=css يرجع الخط المختار، و ?f=ar-tajawal يرجع ملف الخط نفسه
import { appFontFile, appFontsCss } from "../../../lib/imgFonts.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const f = new URL(req.url).searchParams.get("f") ?? "";
  try {
    if (f === "css") return new Response(await appFontsCss(), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60" } });
    const body = appFontFile(f);
    if (!body) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    console.error(e);
    return new Response("", { status: f === "css" ? 200 : 500, headers: { "Content-Type": "text/css" } });
  }
}
