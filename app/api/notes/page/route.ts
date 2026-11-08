import { notePage } from "../../../../lib/notes.ts";
import { ApiError } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const body = await notePage(q.get("t"), q.get("book"), q.get("page"), q.get("pf"), q.get("d"));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof ApiError ? e.message : "error", { status: e instanceof ApiError ? e.status : 500 });
  }
}
