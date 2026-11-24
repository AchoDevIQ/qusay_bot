// وصل البيعة يفتح بالمتصفح ويطبع مباشرة (جهاز البيع بطابعته، بدون تليجرام): t = رابط صفحة المبيعات، id = البيعة
import { one } from "../../../lib/db.ts";
import { can, myOffice } from "../../../lib/data.ts";
import { receiptPage, receiptPng } from "../../../lib/documents.ts";
import { ensure } from "../../../lib/webApi.ts";
import { verifyInitData } from "../../../lib/webAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensure();
  const u = new URL(req.url);
  const uid = verifyInitData(`tk:${u.searchParams.get("t") ?? ""}`);
  const no = (m: string, s = 403) => new Response(`<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:24px">${m}</body>`, { status: s, headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (uid === null) return no("هذا الرابط انتهى. افتح صفحة المبيعات من جديد", 401);
  const off = await myOffice(uid);
  if (!off && !await can(uid, "sales")) return no("ما عندك صلاحية");
  const id = Number(u.searchParams.get("id"));
  const o = await one("orders", { id, printed: 3 });
  if (!o || (off && o.office_id !== off.id)) return no("البيعة غير موجودة", 404);
  // تطبيق جهاز البيع: الوصل صورة، يطبعها هو مباشرة
  if (u.searchParams.get("fmt") === "png") {
    const png = await receiptPng(id);
    return png ? new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } }) : no("ما گدرنا نسوي صورة الوصل", 500);
  }
  const html = await receiptPage(id, u.searchParams.get("kind") === "framed");
  return html ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }) : no("البيعة غير موجودة", 404);
}
