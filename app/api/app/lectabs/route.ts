// 🎬 التطبيق: شنو تبويبات هاي المحاضرة (الأسئلة؟ سبورة الشرح؟ كم سؤال سأل؟). الطالب من رمز دخوله بالتطبيق
import { lecTabsFor } from "../../../../lib/lecTabs.ts";
import { one } from "../../../../lib/db.ts";
import { verifyAppIdToken } from "../../../../lib/appLink.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const f = await req.formData();
    const fu = await verifyAppIdToken(f.get("id"));
    const link = fu ? await one("app_links", { fu }) : null;
    if (!link) return Response.json({ qs: false, board: 0, myq: 0 });
    const t = await lecTabsFor(Number(link.uid), f.get("lec"));
    return Response.json({ qs: t.qs, board: t.board.length, myq: t.myq.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("lectabs", e);
    return Response.json({ qs: false, board: 0, myq: 0 });
  }
}
