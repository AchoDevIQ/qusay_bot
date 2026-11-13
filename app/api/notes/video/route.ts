// الفيديو التوضيحي يشتغل جوّا الملزمة. المتصفح يطلبه قطع (Range)، والآيفون ما يشغله بدونها
import { noteVideo } from "../../../../lib/notes.ts";
import { ApiError } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const buf = await noteVideo(q.get("t"), q.get("book"), q.get("mark"), q.get("pf"), q.get("d"));
    const size = buf.length;
    const head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" };
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (!r || (!r[1] && !r[2])) return new Response(new Uint8Array(buf), { headers: { ...head, "Content-Length": String(size) } });
    let start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
    let end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${size}` } });
    start = Math.max(0, start); end = Math.max(start, end);
    return new Response(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { ...head, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error("note video:", e);
    return new Response(e instanceof ApiError ? e.message : "error", { status: e instanceof ApiError ? e.status : 500 });
  }
}
