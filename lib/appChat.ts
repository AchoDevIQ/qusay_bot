// «محادثة» البوت داخل تطبيق قصي: تليگرام محظور بالعراق، فكل رسالة يدزها البوت لطالب التطبيق تنحفظ هنا وتطلع
// بصفحة /store/chat بأزرارها، والطالب يرد منها بالكتابة أو بصورة أو بالأزرار، والبوت يستلمها كأنها من تليگرام.
// طالب التطبيق بس (رقم من 10^13) ما عنده تليگرام: رسائله هنا بس. المربوط بتليگرام: توصله بالاثنين.
// السيرفر نفسه (برا العراق) يحچي ويا تليگرام عادي، فالصور اللي يدزها الطالب ترتفع لتليگرام حتى ياخذ رقمها
import { find, insert, kvGet, kvSet, one, update, type Row } from "./db.ts";
import { files } from "./files.ts";
import { stamp } from "./util.ts";

const APP_UID_BASE = 10_000_000_000_000;
const SENDS = new Set(["sendMessage", "sendPhoto", "sendDocument", "sendVideo", "sendAnimation", "sendVoice", "sendAudio", "sendVideoNote", "sendSticker", "sendMediaGroup", "copyMessage", "forwardMessage"]);
const MEDIA: Record<string, string> = { sendPhoto: "photo", sendDocument: "document", sendVideo: "video", sendAnimation: "animation", sendVoice: "voice", sendAudio: "audio", sendVideoNote: "video_note", sendSticker: "sticker" };
export type Media = { t: string; f?: string; s?: string; u?: string; n?: string };

/** «app» بس بالتطبيق، «both» تليگرام والتطبيق، «tg» تليگرام بس */
const modeCache = new Map<number, { m: "app" | "both" | "tg"; at: number }>();
export async function chatMode(chat: unknown): Promise<"app" | "both" | "tg"> {
  const id = Number(chat);
  if (!Number.isSafeInteger(id) || id <= 0) return "tg";
  if (id >= APP_UID_BASE) return "app";
  const c = modeCache.get(id);
  if (c && Date.now() - c.at < 60_000) return c.m;
  // طالب مربوط بالتطبيق، أو كادر عنده باب بدون تليگرام: رسائله توصله بالاثنين
  const m = (await one("app_links", { uid: id }).catch(() => null)) || (await one("door_links", { user_id: id }).catch(() => null)) ? "both" : "tg";
  modeCache.set(id, { m, at: Date.now() });
  return m;
}
export const forgetMode = (uid: number) => modeCache.delete(uid);

const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

/** رسالة طالعة: تنحفظ، والكيبورد السفلي (إذا بيها) يصير كيبورد الصفحة */
async function saveOut(uid: number, method: string, p: Row, tg: number | null, media: Media[] = []): Promise<number> {
  const rm = parse(p.reply_markup) as Row | null;
  if (rm?.keyboard) await kvSet(`app_kb_${uid}`, JSON.stringify(rm.keyboard));
  else if (rm?.remove_keyboard) await kvSet(`app_kb_${uid}`, "[]");
  const kind = MEDIA[method];
  if (kind && !media.length) {
    const v = p[kind];
    if (typeof v === "string") media = [/^https?:/.test(v) ? { t: kind, u: v } : { t: kind, f: v }];
  }
  if (method === "sendMediaGroup") for (const m of (parse(p.media) as Row[] | null) ?? []) if (typeof m.media === "string" && !m.media.startsWith("attach://")) media.push({ t: String(m.type), f: m.media });
  const text = String(p.text ?? p.caption ?? (method === "sendMediaGroup" ? (parse(p.media) as Row[] | null)?.[0]?.caption ?? "" : ""));
  const html = String(p.parse_mode ?? (method === "sendMediaGroup" ? (parse(p.media) as Row[] | null)?.[0]?.parse_mode ?? "" : "")) === "HTML" ? 1 : 0;
  const id = Number(await insert("app_msgs", {
    uid, dir: "out", text, html, kb: rm?.inline_keyboard ? JSON.stringify(rm.inline_keyboard) : null, media: media.length ? JSON.stringify(media) : null, tg, created: stamp(), del: 0,
  }));
  if (tg === null) await update("app_msgs", { id }, { tg: id });
  // صفحة ولي الأمر: إشعار لتلفونه إذا مفعّل
  // كادر بباب بدون تليگرام: إشعار لجهازه
  if (uid < 500_000_000_000_000 || uid >= 600_000_000_000_000) void one("door_links", { user_id: uid }).then((r) => r ? import("./doorLink.ts").then((m) => m.notifyDoor(uid, text)) : 0).catch((e) => console.error("door push", e));
  if (uid >= 500_000_000_000_000 && uid < 600_000_000_000_000) void import("./guardianPush.ts").then((m) => m.notifyGuardian(uid, text)).catch((e) => console.error("guardian push", e));
  return tg ?? id;
}
const fakeResult = (uid: number, mid: number, p: Row) => ({ message_id: mid, chat: { id: uid, type: "private" }, date: Math.floor(Date.now() / 1000), text: p.text });

/** قبل تليگرام: طالب التطبيق بس ما ينرسله شي لتليگرام. يرجع null إذا لازم يروح لتليگرام */
export async function beforeTelegram(method: string, p: Row): Promise<{ result: unknown } | null> {
  if (method === "answerCallbackQuery" && String(p.callback_query_id ?? "").startsWith("app:")) {
    answers.set(String(p.callback_query_id), String(p.text ?? ""));
    return { result: true };
  }
  const copied = await copyForApp(method, p);
  if (copied) return copied;
  if (p.chat_id === undefined) return null;
  const uid = Number(p.chat_id);
  const mode = await chatMode(uid);
  if (mode === "tg") return null;
  if (mode === "both") return null;   // يروح لتليگرام وبعدين ينحفظ (afterTelegram)
  if (SENDS.has(method)) return { result: fakeResult(uid, await saveOut(uid, method, p, null), p) };
  if (await applyEdit(uid, method, p)) return { result: method === "deleteMessage" ? true : fakeResult(uid, Number(p.message_id), p) };
  return { result: method === "getChat" ? { id: uid, type: "private" } : true };
}
/** بعد تليگرام للمربوط: نفس الرسالة تنحفظ بالتطبيق برقمها بتليگرام */
export async function afterTelegram(method: string, p: Row, result: any) {
  if (p.chat_id === undefined || await chatMode(p.chat_id) !== "both") return;
  const uid = Number(p.chat_id);
  if (SENDS.has(method)) {
    const list = Array.isArray(result) ? result : [result];
    if (!result) await saveOut(uid, method, p, -Date.now());   // تليگرام رفض (محظور): يوصله بالتطبيق
    else await saveOut(uid, method, p, Number(list[0]?.message_id ?? -Date.now()), mediaOfResult(list));
  } else await applyEdit(uid, method, p);
}
const mediaOfResult = (list: any[]): Media[] => list.flatMap((r) => {
  if (r?.photo) return [{ t: "photo", f: r.photo.at(-1).file_id }];
  for (const k of ["document", "video", "animation", "voice", "audio", "video_note", "sticker"]) if (r?.[k]?.file_id) return [{ t: k, f: r[k].file_id, n: r[k].file_name }];
  return [];
});

async function applyEdit(uid: number, method: string, p: Row) {
  const row = await one("app_msgs", { uid, tg: Number(p.message_id) });
  if (!row) return method.startsWith("edit") || method === "deleteMessage";
  if (method === "deleteMessage") { await update("app_msgs", { id: row.id }, { del: 1 }); return true; }
  const rm = parse(p.reply_markup) as Row | null;
  const patch: Row = { edited: stamp() };
  if (method === "editMessageText" || method === "editMessageCaption") { patch.text = String(p.text ?? p.caption ?? ""); patch.html = p.parse_mode === "HTML" ? 1 : 0; }
  if (method.startsWith("edit")) patch.kb = rm?.inline_keyboard ? JSON.stringify(rm.inline_keyboard) : null;
  await update("app_msgs", { id: row.id }, patch);
  return true;
}

/** ملف (صورة، PDF، ألبوم) طالع لطالب التطبيق بس: ينحفظ عدنا بدل تليگرام */
export async function uploadForApp(method: string, fields: Row, buffers: { b: Buffer; name: string; type: string; kind: string }[], alsoBoth = false): Promise<unknown | null> {
  if (fields.chat_id === undefined) return null;
  const mode = await chatMode(fields.chat_id);
  if (mode === "tg" || (mode === "both" && !alsoBoth)) return null;
  const uid = Number(fields.chat_id);
  const media: Media[] = [];
  for (const x of buffers) {
    const ref = `appchat/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${x.name.replace(/[^\w.-]/g, "_")}`;
    await files().write(ref, x.b, x.type);
    media.push({ t: x.kind, s: ref, n: x.name });
  }
  const mid = await saveOut(uid, method, fields, null, media);
  return fakeResult(uid, mid, fields);
}

// ---------- ردود الأزرار: البوت يرد على الدوسة (answerCallbackQuery) والصفحة تعرض رده
const answers = new Map<string, string>();
export const takeAnswer = (id: string) => { const a = answers.get(id) ?? ""; answers.delete(id); return a; };

// ---------- الصفحة
export async function chatList(uid: number, after = 0) {
  const rows = (await find("app_msgs", { uid })).filter((r) => !r.del && (Number(r.id) > after || (after && r.edited))).sort((a, b) => Number(a.id) - Number(b.id)).slice(-150);
  const kb = parse(await kvGet(`app_kb_${uid}`)) ?? [];
  return {
    msgs: rows.map((r) => ({ id: Number(r.id), mid: Number(r.tg), dir: r.dir, text: r.text ?? "", html: !!r.html, kb: parse(r.kb) ?? null, media: parse(r.media) ?? [], at: r.created, edited: r.edited ?? "" })),
    kb, last: rows.reduce((m, r) => Math.max(m, Number(r.id)), after), voice: await voiceAllowed(uid),
  };
}
/** رسالة الطالب نفسه تنحفظ حتى تطلع بالصفحة مثل المحادثة */
export async function saveIn(uid: number, text: string, media: Media[] = []) {
  return Number(await insert("app_msgs", { uid, dir: "in", text, html: 0, kb: null, media: media.length ? JSON.stringify(media) : null, tg: null, created: stamp(), del: 0 }));
}
export async function mediaRow(uid: number, id: number, k: number): Promise<Media | null> {
  const r = await one("app_msgs", { id });
  if (!r || Number(r.uid) !== uid) return null;
  return ((parse(r.media) as Media[] | null) ?? [])[k] ?? null;
}

/** ألبوم صور لطالب التطبيق: ينحفظ عدنا. يرجع وضع الطالب حتى sendAlbum يعرف يدزه لتليگرام لو لا */
export async function albumForApp(chat: unknown, photos: Buffer[], caption: string) {
  const mode = await chatMode(chat);
  if (mode === "tg") return mode;
  await uploadForApp("sendMediaGroup", { chat_id: chat, caption, parse_mode: "HTML" }, photos.map((b, i) => ({ b, name: `p${i}.jpg`, type: "image/jpeg", kind: "photo" })), true);
  return mode;
}

// ---------- نسخ الرسائل (copyMessage / forwardMessage) لطالب التطبيق ومنه
// رسائل الطالب من التطبيق ما موجودة بتليگرام، فأرقامها من FAKE وفوك (FAKE + رقمها بجدول المحادثة)
export const FAKE_MID = 2_000_000_000;
const raw = async () => (await import("./telegram.ts")).apiRaw;
async function storageChat() { const g = await kvGet("q_group"); return g ? Number(g) : Number(String(process.env.ADMIN ?? "").split(",")[0]) || 0; }

/** محتوى رسالة تليگرام كاملة: نصها وملفاتها */
function contentOf(m: any): { text: string; media: Media[] } {
  const text = String(m?.text ?? m?.caption ?? "");
  const media: Media[] = [];
  if (m?.photo) media.push({ t: "photo", f: m.photo.at(-1).file_id });
  for (const k of ["video", "animation", "voice", "audio", "video_note", "document", "sticker"]) if (m?.[k]?.file_id) media.push({ t: k, f: m[k].file_id, n: m[k].file_name });
  return { text, media };
}
/** رسالة كتبها الطالب بالتطبيق (رقمها وهمي)، لو null */
async function appInMessage(fromChat: unknown, mid: unknown) {
  const id = Number(mid) - FAKE_MID;
  if (!(id > 0) || await chatMode(fromChat) === "tg") return null;
  const r = await one("app_msgs", { id, uid: Number(fromChat), dir: "in" });
  return r ? { text: String(r.text ?? ""), media: (parse(r.media) as Media[] | null) ?? [] } : null;
}
/** يرجع نتيجة النسخ إذا انعالج هنا، أو null حتى يروح لتليگرام عادي */
export async function copyForApp(method: string, p: Row): Promise<{ result: unknown } | null> {
  if (method !== "copyMessage" && method !== "forwardMessage") return null;
  const toMode = await chatMode(p.chat_id);
  const fromApp = await appInMessage(p.from_chat_id, p.message_id);
  if (!fromApp && toMode !== "app") return null;
  // 1) رسالة من الطالب (التطبيق) لمجموعة الأسئلة أو لأي محادثة بتليگرام: ندزها من جديد بمحتواها
  if (fromApp && toMode !== "app") {
    const send = await raw();
    const base: Row = { chat_id: p.chat_id, ...(p.message_thread_id ? { message_thread_id: p.message_thread_id } : {}), ...(p.reply_markup ? { reply_markup: p.reply_markup } : {}) };
    const m = fromApp.media[0];
    const cap = fromApp.text ? { caption: fromApp.text } : {};
    let r: any = null;
    if (!m || !m.f) r = await send("sendMessage", { ...base, text: fromApp.text || "📎" });
    else if (m.t === "photo") r = await send("sendPhoto", { ...base, photo: m.f, ...cap });
    else if (m.t === "voice") r = await send("sendVoice", { ...base, voice: m.f, ...cap });
    else if (m.t === "audio") r = await send("sendAudio", { ...base, audio: m.f, ...cap });
    else r = await send("sendDocument", { ...base, document: m.f, ...cap });
    return { result: r ? { message_id: r.message_id } : null };
  }
  // 2) لطالب التطبيق بس: من تليگرام (جواب الأستاذ بالمجموعة، فيديو القناة) نجيب محتواها بتحويلها لمكان مخفي وتنمسح
  const uid = Number(p.chat_id);
  let content = fromApp;
  if (!content) {
    const send = await raw(), store = await storageChat();
    const fwd: any = store ? await send("forwardMessage", { chat_id: store, from_chat_id: p.from_chat_id, message_id: p.message_id, disable_notification: true }) : null;
    if (!fwd) return { result: null };
    void send("deleteMessage", { chat_id: store, message_id: fwd.message_id });
    content = contentOf(fwd);
  }
  const mid = await saveOut(uid, "copyMessage", { text: content.text, reply_markup: p.reply_markup }, null, content.media);
  return { result: { message_id: mid, chat: { id: uid, type: "private" } } };
}

/** الرسائل الصوتية بالمحادثة: صاحب البوت يفتحها لكل الطلاب أو لطلاب بأسمائهم (صفحة «شنو يشوف الطالب»). من البداية مسدودة */
export async function voiceAllowed(uid: number) {
  const { visRules, inRule } = await import("./studentVis.ts");
  const r = (await visRules()).voice;
  return !!r && await inRule(r, uid, await one("students", { user_id: uid }));
}
