// تقرير عطل من تطبيق الطلاب: انفتح، وصل للرئيسية، أو خطأ. رمز الدخول اختياري (التطبيق ممكن يوگع قبل الدخول)
import { appReport } from "../../../../lib/appCrash.ts";
import { verifyAppIdToken } from "../../../../lib/appLink.ts";
import { one } from "../../../../lib/db.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensure();
    const f = await req.formData();
    const s = (k: string) => String(f.get(k) ?? "");
    const fu = s("id") ? await verifyAppIdToken(s("id")).catch(() => null) : null;
    const uid = fu ? Number((await one("app_links", { fu }))?.uid) || null : null;
    const r = await appReport({ kind: s("kind"), install: s("install"), uid, model: s("model"), os: s("os"), ver: s("ver"), screen: s("screen"), error: s("error"), stack: s("stack"), fatal: s("fatal") === "1" });
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("app crash report failed", e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
