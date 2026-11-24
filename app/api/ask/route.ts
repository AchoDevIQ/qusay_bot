import { askFromPage, askInfo } from "../../../lib/questions.ts";
import { readForCheck } from "../../../lib/qaBank.ts";
import { verifyHomeToken } from "../../../lib/webAuth.ts";
import { apiResponse, ensure, need } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ❓ سؤال علمي من الصفحة: info شنو يگدر يختار، send السؤال (كتابة و/أو صورة)
export const POST = (req: Request) => apiResponse(async () => {
  await ensure();
  const form = (req.headers.get("content-type") ?? "").includes("multipart") ? await req.formData() : null;
  const b: Record<string, unknown> = form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await req.json();
  const uid = verifyHomeToken(b.token);
  need(uid !== null, "الرابط قديم. افتح القائمة من البوت مرة ثانية", 401);
  if (b.action !== "send" && b.action !== "read") return await askInfo(uid!);
  const f = form?.get("photo");
  const image = f && typeof f !== "string" && f.size > 0 ? Buffer.from(await f.arrayBuffer()) : null;
  need(!image || image.length <= 8_000_000, "الصورة كبيرة، صوّرها مرة ثانية");
  // «تأكد من سؤالك»: الصورة تنقرا هسه، وترجع بكتابة الموبايل حتى يصلّح الرقم الغلط
  if (b.action === "read") {
    need(image, "صوّر السؤال");
    const info = await askInfo(uid!);
    need("chapters" in info && info.chapters, ("closed" in info && info.closed) || "سجّل معلوماتك أول");
    return { phone: await readForCheck(image!, Number(b.tid)) };
  }
  return await askFromPage(uid!, b, image);
});
