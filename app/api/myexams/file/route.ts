import { roomFile } from "../../../../lib/examRoom.ts";
import { ApiError } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const { body, type } = await roomFile(q.get("t"), q.get("item"), q.get("ref"), q.get("pf"), q.get("d"));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof ApiError ? e.message : "error", { status: e instanceof ApiError ? e.status : 500 });
  }
}
