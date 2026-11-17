// صفحة المحادثة بالتطبيق: تجيب رسائل البوت، وتوصّل كتابة الطالب وصوره ودوسات الأزرار للبوت كأنها من تليگرام.
// بس من التطبيق (مفتاح التطبيق ويا رابط الطالب)
import { ADMIN_IDS } from "./config.ts";
import { one } from "./db.ts";
import { FAKE_MID, chatList, markChatSeen, mediaRow, saveIn, takeAnswer, voiceAllowed, type Media } from "./appChat.ts";
import { handleUpdate } from "./bot.ts";
import { groupId, student } from "./data.ts";
import { files } from "./files.ts";
import { api, upload } from "./telegram.ts";
import { TOKEN } from "./config.ts";
import { ensure, need } from "./webApi.ts";
import { isAppKey, verifyHomeToken } from "./webAuth.ts";

function who(token: unknown, app: unknown) {
  const uid = verifyHomeToken(token);
  need(uid !== null, "هذا الرابط قديم. سد الصفحة وافتحها من جديد", 401);
  need(isAppKey(uid!, app) || doorUsers.has(uid!), "هاي الصفحة تنفتح من التطبيق بس", 403);
  return uid!;
}
/** الكادر اللي دخل من بابه (بدون تليگرام) يشوف رسائله هنا هم */
const doorUsers = new Set<number>();
async function allowDoor(token: unknown) {
  const uid = verifyHomeToken(token);
  if (uid !== null && await one("door_links", { user_id: uid })) doorUsers.add(uid); else if (uid !== null) doorUsers.delete(uid);
}
async function from(uid: number) {
  const name = String((await student(uid))?.name ?? "طالب").split(" ")[0];
  return { id: uid, is_bot: false, first_name: name };
}
const chat = (uid: number) => ({ id: uid, type: "private" });
let seq = Date.now();

/** صورة من الطالب: ترتفع لتليگرام (لمجموعة الأسئلة أو لصاحب البوت بصمت، وتنمسح فوراً) حتى ياخذ البوت رقمها */
async function telegramFileId(b: Buffer, name: string, type: string, kind: "photo" | "voice" | "audio" | "document") {
  const to = (await groupId()) ?? ADMIN_IDS[0];
  need(to, "ما گدرنا نرفع الصورة هسه", 503);
  const method = kind === "photo" ? "sendPhoto" : kind === "voice" ? "sendVoice" : kind === "audio" ? "sendAudio" : "sendDocument";
  const r: any = await upload(method, { chat_id: String(to), disable_notification: "true", protect_content: "false" }, kind, b, name, type);
  need(r, "ما ارتفعت الصورة، حاول مرة ثانية", 502);
  void api("deleteMessage", { chat_id: to, message_id: r.message_id });
  return kind === "photo" ? r.photo : r[kind];
}

export async function chatAction(body: any) {
  await ensure();
  await allowDoor(body?.token);
  const uid = who(body?.token, body?.app);
  await import("./appPush.ts").then((m) => m.noteChatIn(uid)).catch(() => 0);
  const a = String(body?.action ?? "list");
  if (a === "list") { const r = await chatList(uid, Number(body.after) || 0); await markChatSeen(uid, r.last); return r; }
  const now = Math.floor(Date.now() / 1000);
  if (a === "text") {
    const text = String(body.text ?? "").trim();
    need(text && text.length <= 4000, "اكتب رسالتك");
    const inId = body.hidden ? 0 : await saveIn(uid, text);
    await handleUpdate({ update_id: ++seq, message: { message_id: inId ? FAKE_MID + inId : ++seq, from: await from(uid), chat: chat(uid), date: now, text } });
  } else if (a === "cb") {
    const id = `app:${uid}:${++seq}`;
    await handleUpdate({ update_id: ++seq, callback_query: { id, from: await from(uid), chat_instance: "app", data: String(body.data ?? ""), message: { message_id: Number(body.mid), chat: chat(uid), date: now, text: "" } } });
    return { ...await chatList(uid, Number(body.after) || 0), answer: takeAnswer(id) };
  } else need(false, "أمر غير معروف");
  return await chatList(uid, Number(body.after) || 0);
}

/** صورة أو تسجيل صوتي من الطالب (FormData) */
export async function chatUpload(f: FormData) {
  await ensure();
  await allowDoor(f.get("token"));
  const uid = who(f.get("token"), f.get("app"));
  await import("./appPush.ts").then((m) => m.noteChatIn(uid)).catch(() => 0);
  const file = f.get("file");
  need(file instanceof File && file.size > 0, "اختار صورة");
  need((file as File).size <= 15_000_000, "الملف كبير، أكثر شي 15 ميگا");
  const type = (file as File).type || "image/jpeg";
  // الفويس: تليگرام ياخذ ogg فويس، وغيره (تسجيل الآيفون mp4) ملف صوت
  const kind = type.startsWith("image/") ? "photo" : type.includes("ogg") ? "voice" : type.startsWith("audio/") ? "audio" : "document";
  if (kind === "voice" || kind === "audio") need(await voiceAllowed(uid), "الرسائل الصوتية مو مفتوحة إلك", 403);
  const b = Buffer.from(await (file as File).arrayBuffer());
  const caption = String(f.get("caption") ?? "").trim().slice(0, 1000);
  const got = await telegramFileId(b, (file as File).name || "photo.jpg", type, kind);
  const fid = kind === "photo" ? got.at(-1).file_id : got.file_id;
  const ref = `appchat/${uid}/in-${Date.now()}-${kind}`;
  await files().write(ref, b, type);
  const media: Media[] = [{ t: kind, s: ref, f: fid }];
  const inId = await saveIn(uid, caption, media);
  const now = Math.floor(Date.now() / 1000);
  const msg: any = { message_id: FAKE_MID + inId, from: await from(uid), chat: chat(uid), date: now, ...(caption ? { caption } : {}) };
  msg[kind] = got;
  await handleUpdate({ update_id: ++seq, message: msg });
  return await chatList(uid, Number(f.get("after")) || 0);
}

/** ملف رسالة (صورة، PDF، فويس) للصفحة */
export async function chatFile(url: URL): Promise<Response> {
  await ensure();
  await allowDoor(url.searchParams.get("t"));
  const uid = who(url.searchParams.get("t"), url.searchParams.get("app"));
  const m = await mediaRow(uid, Number(url.searchParams.get("m")), Number(url.searchParams.get("k")) || 0);
  if (!m) return new Response("not found", { status: 404 });
  const type = m.t === "photo" ? "image/jpeg" : m.t === "voice" ? "audio/ogg" : m.t === "video" || m.t === "video_note" || m.t === "animation" ? "video/mp4" : "application/octet-stream";
  const headers = { "Content-Type": type, "Cache-Control": "private, max-age=86400" };
  if (m.s) { const b = await files().read(m.s); return b ? new Response(new Uint8Array(b), { headers }) : new Response("gone", { status: 404 }); }
  if (m.u) return Response.redirect(m.u, 302);
  const info: any = m.f ? await api("getFile", { file_id: m.f }) : null;
  if (!info?.file_path) return new Response("gone", { status: 404 });
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
  if (!r.ok) return new Response("gone", { status: 404 });
  return new Response(r.body, { headers });
}
