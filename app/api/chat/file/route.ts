import { chatFile } from "../../../../lib/appChatApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (req: Request) => {
  try { return await chatFile(new URL(req.url)); } catch { return new Response("no", { status: 403 }); }
};
