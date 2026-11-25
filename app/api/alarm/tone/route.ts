// 🎵 ملف نغمة ضافها الأستاذ (WAV): الصفحة تسمعها، والتطبيق ينزلها للموبايل حتى المنبه يرن بيها. نفس الملف لكل الطلاب
import { toneFile } from "../../../../lib/examAlarm.ts";
import { ensure } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensure();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^c[0-9a-f]{10}$/.test(id)) return new Response("no", { status: 404 });
  const body = await toneFile(id);
  if (!body) return new Response("no", { status: 404 });
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
