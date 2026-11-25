// باب تطبيق قصي: التطبيق يفتح هنا بطلب POST (id = رمز دخول الطالب، env = staging أو prod، page = الصفحة)
// ونحوله لصفحة البوت باسمه. الرمز ما ينكتب بالرابط حتى ما يبقى بسجلات المتصفح
import { APP_ERR, enterFromApp } from "../../../../lib/appLink.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errPage = () => new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>قصي</title></head><body style="font-family:system-ui;padding:24px;line-height:1.8;text-align:center">${APP_ERR}</body></html>`, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    await ensure();
    const f = await req.formData();
    const to = await enterFromApp({ id: f.get("id"), env: f.get("env"), page: f.get("page"), poll: f.get("poll"), att: f.get("att"), lec: f.get("lec"), solve: f.get("solve") });
    if (!to) return errPage();
    return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("app enter failed", e instanceof Error ? e.message : e);
    return errPage();
  }
}
