import { stickerFile } from "../../../lib/commentsApi.ts";
import { ApiError } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { body, type } = await stickerFile(new URL(req.url).searchParams.get("id"));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof ApiError ? e.message : "error", { status: e instanceof ApiError ? e.status : 500 });
  }
}
