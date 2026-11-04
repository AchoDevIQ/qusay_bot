// عميل Telegram Bot API
import fs from "node:fs";
import path from "node:path";
import { TOKEN } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";

const base = () => `https://api.telegram.org/bot${TOKEN}/`;

export async function api<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(base() + method, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      signal: AbortSignal.timeout(70_000),
    });
    const j: any = await r.json().catch(() => ({ ok: false, description: "bad json" }));
    if (!j.ok && !String(j.description ?? "").includes("message is not modified")) {
      console.error("Telegram error:", method, j.description);
    }
    return j.ok ? (j.result as T) : null;
  } catch (e) {
    console.error("Connection problem:", method, e);
    return null;
  }
}

/** رفع ملف (صورة/PDF) */
export async function upload(method: string, fields: Record<string, string>, fileField: string,
  file: string | Buffer, fname = typeof file === "string" ? path.basename(file) : "file", ctype = "application/octet-stream") {
  const fd = new FormData();
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
