import { guardianFile } from "../../../../lib/guardianApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (req: Request) => {
  try { return await guardianFile(new URL(req.url)); } catch { return new Response("no", { status: 403 }); }
};
