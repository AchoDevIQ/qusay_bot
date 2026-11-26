// 📄 كشف اليوم، كشف المحاسبة، والوصل الملون: ينفتحن بالصفحة نفسها (جهاز البيع بلا تليگرام) بدل ما يروحن لمحادثة البوت
import fs from "node:fs";
import { withPrintBar } from "../../../../lib/documents.ts";
import { salesFile } from "../../../../lib/orderApi.ts";
import { ensure } from "../../../../lib/webApi.ts";
import { verifyInitData } from "../../../../lib/webAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensure();
  const u = new URL(req.url);
  const no = (m: string, s = 403) => new Response(`<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:24px">${m}</body>`, { status: s, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const uid = verifyInitData(`tk:${u.searchParams.get("t") ?? ""}`);
  if (uid === null) return no("هذا الرابط انتهى. افتح الصفحة من جديد", 401);
  try {
    const f = await salesFile(uid, u.searchParams);
    const page = (h: string) => new Response(h, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    // الوصل الملون: صورة بصفحة ويا زر طباعة
    if (f.type === "image/png") {
      const b64 = fs.readFileSync(f.path).toString("base64");
      return page(withPrintBar(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0B1424"><img src="data:image/png;base64,${b64}" style="display:block;width:100%;max-width:760px;margin:0 auto"></body></html>`, "🖨 اطبع الوصل"));
    }
    // الكشف: الصفحة نفسها (تطبيق قصي العميري ما يفتح PDF)، ويا «اطبع»: يختار الطابعة الكبيرة أو «حفظ PDF»
    const html = f.path.replace(/\.pdf$/, ".html");
    if (fs.existsSync(html)) return page(withPrintBar(fs.readFileSync(html, "utf8").replace("<head>", '<head><meta name="viewport" content="width=device-width,initial-scale=1">'), "🖨 اطبع لو احفظ PDF"));
    return new Response(new Uint8Array(fs.readFileSync(f.path)), { headers: { "Content-Type": f.type, "Content-Disposition": `inline; filename="${f.name}"`, "Cache-Control": "no-store" } });
  } catch (e) { return no(`⚠️ ${(e as Error).message || "صار خطأ"}`, Number((e as { status?: number }).status) || 400); }
}
