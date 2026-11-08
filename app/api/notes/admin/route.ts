import { noteAdmin } from "../../../../lib/notes.ts";
import { apiResponse } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = (req: Request) => apiResponse(async () => await noteAdmin((req.headers.get("content-type") ?? "").includes("multipart") ? await req.formData() : await req.json()));
