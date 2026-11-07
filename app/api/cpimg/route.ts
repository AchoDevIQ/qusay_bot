import { files } from "../../../lib/files.ts";
import { ensure } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// صور شخصيات السيطرة: نفس الصورة لكل الطلاب، فتنفتح بدون توقيع
const IMG = /^checkpoints\/[\w-]+\.(png|jpg|webp)$/;
export async function GET(req: Request) {
  await ensure();
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  if (!IMG.test(ref)) return new Response("no", { status: 404 });
  const body = await files().read(ref);
  if (!body) return new Response("no", { status: 404 });
  const ext = ref.split(".").pop();
  return new Response(new Uint8Array(body), { headers: { "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
