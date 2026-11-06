// عميل Telegram Bot API
import fs from "node:fs";
import path from "node:path";
import { TOKEN } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";
import { isStaff } from "./data.ts";

const base = () => `https://api.telegram.org/bot${TOKEN}/`;

/** الحماية: كل شي يوصل للطلاب وأولياء الأمور ما ينحفظ وما ينعاد توجيهه. الكادر بدون حماية حتى يگدرون يحولون الطلبات.
 *  الرسالة اللي لازم تنسخ (مثل كلمة المرور) تنرسل بـ protect_content: false */
const SENDS = new Set(["sendMessage", "sendPhoto", "sendDocument", "sendVideo", "sendAnimation", "sendVoice", "sendAudio", "sendVideoNote", "sendMediaGroup", "sendSticker", "copyMessage", "forwardMessage", "sendLocation", "sendContact"]);
export async function shouldProtect(method: string, chat: unknown, given: unknown) {
  if (given !== undefined || !SENDS.has(method)) return false;
  const id = Number(chat);
  if (!Number.isInteger(id) || id <= 0) return false;   // المجموعات والقنوات مال الكادر
  try { return !await isStaff(id); } catch { return true; }
}

export async function api<T = any>(method: string, params: Record<string, unknown> = {}, tries = 2): Promise<T | null> {
  if (await shouldProtect(method, params.chat_id, params.protect_content)) params = { ...params, protect_content: true };
  try {
    const r = await fetch(base() + method, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      signal: AbortSignal.timeout(70_000),
    });
    const j: any = await r.json().catch(() => ({ ok: false, description: "bad json" }));
    // تليجرام يكول «هواية رسائل، انتظر»: ننتظر المدة اللي يكولها ونعيد مرة
    const wait = Number(j?.parameters?.retry_after);
    if (j?.error_code === 429 && wait > 0 && wait <= 30 && tries > 1) {
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      return api<T>(method, params, tries - 1);
    }
    if (!j.ok && !String(j.description ?? "").includes("message is not modified")) {
      console.error("Telegram error:", method, j.description);
    }
    return j.ok ? (j.result as T) : null;
  } catch (e) {
    console.error("Connection problem:", method, e);
    return null;
  }
}

/** رسائل هواية مرة وحدة (مثل «بدأ الامتحان» لآلاف الطلاب): دفعات بسرعة تليجرام المسموحة (بحدود 30 بالثانية)،
 *  وكل رسالة تفشل (طالب حاظر البوت) ما توگف الباقي */
export async function sendMany<T>(list: T[], one: (x: T) => Promise<unknown>, perSecond = 25) {
  let ok = 0;
  for (let i = 0; i < list.length; i += perSecond) {
    const started = Date.now();
    const r = await Promise.allSettled(list.slice(i, i + perSecond).map(one));
    ok += r.filter((x) => x.status === "fulfilled" && x.value != null).length;
    const left = 1000 - (Date.now() - started);
    if (i + perSecond < list.length && left > 0) await new Promise((done) => setTimeout(done, left));
  }
  return ok;
}

/** رفع ملف (صورة/PDF) */
export async function upload(method: string, fields: Record<string, string>, fileField: string,
  file: string | Buffer, fname = typeof file === "string" ? path.basename(file) : "file", ctype = "application/octet-stream") {
  const fd = new FormData();
  if (await shouldProtect(method, fields.chat_id, fields.protect_content)) fields = { ...fields, protect_content: "true" };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append(fileField, new Blob([typeof file === "string" ? fs.readFileSync(file) : new Uint8Array(file)], { type: ctype }), fname);
  try {
    const r = await fetch(base() + method, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
    const j: any = await r.json();
    if (!j.ok) console.error("Telegram error:", method, j.description);
    return j.ok ? j.result : null;
  } catch (e) { console.error("Connection problem:", method, e); return null; }
}

export type Kb = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; copy_text?: { text: string } }[][];

export const send = (chat: number | string, text: string, opts: { kb?: Kb; replyKb?: unknown; extra?: Record<string, unknown> } = {}) => {
  const p: Record<string, unknown> = { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts.extra };
  if (opts.kb) p.reply_markup = { inline_keyboard: opts.kb };
  else if (opts.replyKb) p.reply_markup = opts.replyKb;
  return api("sendMessage", p);
};

export const edit = (chat: number | string, mid: number, text: string, kb?: Kb) => {
  const p: Record<string, unknown> = { chat_id: chat, message_id: mid, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (kb) p.reply_markup = { inline_keyboard: kb };
  return api("editMessageText", p);
};

export const answerCb = (id: string, text?: string) =>
  api("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });

/** صورة من ملف: أول مرة ترفع، بعدين تستخدم file_id المحفوظ */
export async function sendImage(chat: number | string, filePath: string, key: string, caption: string, replyKb: unknown, fallback = caption) {
  if (!fs.existsSync(filePath)) return send(chat, fallback, { replyKb });
  const stamp = String(Math.floor(fs.statSync(filePath).mtimeMs / 1000));
  const fid = await kvGet(key + "_id");
  const text: Record<string, string> = caption ? { caption, parse_mode: "HTML" } : {};   // بدون نص: الصورة لوحدها
  if (fid && await kvGet(key + "_stamp") === stamp) {
    const r = await api("sendPhoto", { chat_id: chat, photo: fid, ...text, reply_markup: replyKb });
    if (r) return r;
  }
  const r: any = await upload("sendPhoto", {
    chat_id: String(chat), ...text, reply_markup: JSON.stringify(replyKb ?? {}),
  }, "photo", filePath, "image.jpg", "image/jpeg");
  if (r?.photo) { await kvSet(key + "_id", r.photo.at(-1).file_id); await kvSet(key + "_stamp", stamp); }
  else if (!r) await send(chat, fallback, { replyKb });
  return r;
}

/** ألبوم صور: كل 10 برسالة، والكلام على أول صورة. يرجع عدد الرسائل اللي وصلت */
export async function sendAlbum(chat: number | string, photos: Buffer[], caption: string, protect = true) {
  let sent = 0;
  for (let i = 0; i < photos.length; i += 10) {
    const part = photos.slice(i, i + 10);
    const withCaption = i === 0;
    const fd = new FormData();
    fd.append("chat_id", String(chat));
    if (protect) fd.append("protect_content", "true");
    const jpg = (b: Buffer) => new Blob([new Uint8Array(b)], { type: "image/jpeg" });
    let method = "sendMediaGroup";
    if (part.length === 1) {
      method = "sendPhoto";
      fd.append("photo", jpg(part[0]), "p.jpg");
      if (withCaption) { fd.append("caption", caption); fd.append("parse_mode", "HTML"); }
    } else {
      fd.append("media", JSON.stringify(part.map((_, k) => ({ type: "photo", media: `attach://p${k}`, ...(withCaption && k === 0 ? { caption, parse_mode: "HTML" } : {}) }))));
      part.forEach((b, k) => fd.append(`p${k}`, jpg(b), `p${k}.jpg`));
    }
    try {
      const r = await fetch(base() + method, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
      const j: any = await r.json();
      if (j.ok) sent++; else console.error("Telegram error:", method, j.description);
    } catch (e) { console.error("Connection problem: album", e); }
  }
  return sent;
}
