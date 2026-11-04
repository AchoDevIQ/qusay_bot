import { ApiError, examAction, examUpload } from "../../../lib/examApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const isForm = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const data = isForm ? await examUpload(await req.formData()) : await examAction(await req.json());
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "صار خطأ، حاول مرة ثانية" }, { status: 500 });
  }
}
