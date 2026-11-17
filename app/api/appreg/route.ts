// تسجيل الطالب الجديد من التطبيق بطريقة البوت (قبل ما يكون عنده حساب)
import { appRegAction } from "../../../lib/appReg.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await appRegAction(await req.json()));
// التطبيق يسأل: التسجيل الجديد من البوت لو القديم؟
export async function GET() {
  try {
    const { ensure } = await import("../../../lib/webApi.ts");
    const { appRegOn } = await import("../../../lib/appReg.ts");
    await ensure();
    return Response.json({ bot: await appRegOn() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ bot: false }, { headers: { "Cache-Control": "no-store" } }); }
}
