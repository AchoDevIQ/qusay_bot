// 🛤 مساري: حالة المسار، وفتح محاضرة (بس إذا مفتوحة إله)
import { pathFor, pathOpen } from "../../../lib/pathApi.ts";
import { ApiError, ensure, need } from "../../../lib/webApi.ts";
import { verifyHomeToken } from "../../../lib/webAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const b = await req.json().catch(() => ({}));
    const uid = verifyHomeToken(b.t);
    need(uid !== null, "الرابط انتهى. افتح مساري من جديد", 401);
    const out = b.action === "open" ? await pathOpen(uid!, b.lec) : await pathFor(uid!, b.ch, b.env);
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error("path", e);
    return Response.json({ error: e instanceof ApiError ? e.message : "صار خطأ" }, { status: e instanceof ApiError ? e.status : 500 });
  }
}
