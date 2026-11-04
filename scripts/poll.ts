// تشغيل البوت من الجهاز بدون سيرفر وبدون webhook: يسحب الرسائل من تليجرام مثل bot.py القديم
import { STORE_URL, TOKEN } from "../lib/config.ts";
import { enqueueUpdate } from "../lib/bot.ts";
import { api } from "../lib/telegram.ts";

if (!/^\d+:/.test(TOKEN)) {
  console.error("Bot token not found. Put TOKEN in .env.local or settings.txt");
  process.exit(1);
}
await api("deleteWebhook", { drop_pending_updates: false });
const me: any = await api("getMe");
console.log("Bot is running:", me ? "@" + me.username : "(no connection yet)");
console.log("Pages:", STORE_URL || "(no https link: forms work through chat buttons only)");
console.log("Keep this window open. Close it to stop the bot.");

let offset = 0;
for (;;) {
  const ups: any[] | null = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
  if (!ups) { await new Promise((r) => setTimeout(r, 5000)); continue; }
  for (const u of ups) {
    offset = u.update_id + 1;
    enqueueUpdate(u);
  }
}
