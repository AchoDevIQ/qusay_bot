// رابط التصويت اللي ينحط بقناة التليگرام: يفتح التطبيق على التصويت، أو البوت. الصفحة نفسها ما بيها أي معلومة عن الطالب ولا النتيجة.
// التطبيق يفتح بس روابط qmath://loginToken (أندرويد: intent-filter بيه host=loginToken، فـ qmath://vote ما يفتحه)، فالتصويت يمشي عليه بـ ?vote=رقم.
// التطبيق مثل ما هو هسه (بدون تحديث) ينفتح على الرئيسية بس، والتصويت يلگاه ببطاقة «🗳 تصويت ينتظر صوتك» وبالمحادثة
import { kvGet } from "../../../lib/db.ts";
import { ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_PKG = "com.achodev.qmath";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("not found", { status: 404 });
  await ensure();
  const bot = (await kvGet("bot_username")) || "Qusay_Alomairi_Bot";
  const ios = `qmath://loginToken?vote=${id}`;
  const android = `intent://loginToken?vote=${id}#Intent;scheme=qmath;package=${APP_PKG};end`;
  const tg = `https://t.me/${bot}?start=vote_${id}`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>🗳 التصويت</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#1c2333;margin:0;padding:32px 16px;text-align:center;line-height:1.8}
.box{max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:24px 18px;box-shadow:0 2px 12px #0001}
a.b{display:block;margin:12px 0;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:17px}
.app{background:#1f6feb;color:#fff}.tg{background:#e8eef9;color:#1f3b73}small{color:#667}
@media (prefers-color-scheme:dark){body{background:#11151c;color:#e6e9ef}.box{background:#1b212b}.tg{background:#263041;color:#cfe0ff}small{color:#9aa4b2}}</style></head>
<body><div class="box"><h2>🗳 تصويت</h2>
<p>اضغط حتى تصوت من التطبيق.</p>
<a class="b app" id="app" href="${ios}">📱 افتح بالتطبيق</a>
<a class="b tg" href="${tg}">✈️ افتح بالبوت</a>
<p><small>إذا ما انفتح التصويت: افتح التطبيق، التصويت يطلعلك بيه (بالرئيسية «🗳 تصويت ينتظر صوتك»، وبالمحادثة).</small></p></div>
<script>(function(){var a=/android/i.test(navigator.userAgent),u=a?${JSON.stringify(android)}:${JSON.stringify(ios)};document.getElementById("app").href=u;try{location.href=u}catch(e){}})();</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
