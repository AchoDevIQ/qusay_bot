// يربط البوت بالرابط:  npm run set-webhook -- https://your-domain.com
import { api } from "../lib/telegram.ts";
import { WEBHOOK_SECRET } from "../lib/config.ts";

const domain = process.argv[2]?.replace(/\/$/, "");
if (!domain?.startsWith("https://") || !WEBHOOK_SECRET) {
  console.error("الاستخدام: npm run set-webhook -- https://your-domain.com   (ولازم WEBHOOK_SECRET بملف .env.local)");
  process.exit(1);
}
const r = await api("setWebhook", {
  url: domain + "/api/telegram", secret_token: WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: false,
});
console.log("setWebhook:", r);
console.log(await api("getWebhookInfo"));
