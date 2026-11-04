import { NextRequest, NextResponse } from "next/server";
import { WEBHOOK_SECRET } from "../../../lib/config.ts";
import { enqueueUpdate } from "../../../lib/bot.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // تليجرام يرسل هذا الهيدر إذا حددنا secret_token عند ضبط الـ webhook
  if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json();
  // نخلص الرسالة قبل الرد، لأن سيرفر Firebase ممكن يوقف المعالج بعد الرد
  await enqueueUpdate(update);
  return NextResponse.json({ ok: true });
}
