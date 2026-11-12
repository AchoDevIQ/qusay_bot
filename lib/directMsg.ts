// رسالة مباشرة بالبوت: كتابة، أو فويس ويا الكتابة تحته. محمية ما تنحول ولا تنحفظ.
// يستعملها المصحح (رسالة للطالب ورد الاعتراض)، وصفحة الطلاب (رسالة للطالب أو لولي أمره)
import { send, upload } from "./telegram.ts";
import { need } from "./webApi.ts";

export const VOICE_MAX = 20 * 1024 * 1024;
type UrlKb = { inline_keyboard: { text: string; url: string }[][] };

/** الفويس من الفورم، إذا موجود */
export function voiceOf(form: FormData): Blob | null {
  const v = form.get("voice");
  if (!(v instanceof Blob) || !v.size) return null;
  need(v.size <= VOICE_MAX, "التسجيل طويل هواية");
  return v;
}

/** يدز الرسالة: إذا بيها فويس، النص ينكتب تحته */
export async function deliverMsg(to: number, caption: string, voice: Blob | null, kb?: UrlKb) {
  if (!voice) { await send(to, caption, { extra: { protect_content: true, ...(kb ? { reply_markup: kb } : {}) } }); return; }
  const type = voice.type || "";
  // تلگرام يشغلها كرسالة صوتية إذا m4a أو ogg أو mp3، وإلا تنرسل كملف صوت
  const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /mpeg|mp3/.test(type) ? "mp3" : "webm";
  const method = ext === "webm" ? "sendDocument" : "sendVoice";
  const fields: Record<string, string> = { chat_id: String(to), caption, parse_mode: "HTML", protect_content: "true" };
  if (kb) fields.reply_markup = JSON.stringify(kb);
  const ok = await upload(method, fields, method === "sendVoice" ? "voice" : "document", Buffer.from(await voice.arrayBuffer()), `voice.${ext}`, type || "audio/ogg");
  need(ok, "ما وصلت الرسالة الصوتية، جرب مرة ثانية");
}
