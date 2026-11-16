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
  const m = (await one("app_links", { uid: id }).catch(() => null)) ? "both" : "tg";
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
  return tg ?? id;
}
const fakeResult = (uid: number, mid: number, p: Row) => ({ message_id: mid, chat: { id: uid, type: "private" }, date: Math.floor(Date.now() / 1000), text: p.text });

/** قبل تليگرام: طالب التطبيق بس ما ينرسله شي لتليگرام. يرجع null إذا لازم يروح لتليگرام */
export async function beforeTelegram(method: string, p: Row): Promise<{ result: unknown } | null> {
  if (method === "answerCallbackQuery" && String(p.callback_query_id ?? "").startsWith("app:")) {
    answers.set(String(p.callback_query_id), String(p.text ?? ""));
    return { result: true };
  }
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
    kb, last: rows.reduce((m, r) => Math.max(m, Number(r.id)), after),
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
