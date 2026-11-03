import { CURRENCY } from "./config.ts";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export const money = (n: number | string) => `${Math.trunc(Number(n)).toLocaleString("en-US")} ${CURRENCY}`;

export const btn = (text: string, data: string) => ({ text, callback_data: data });

/** توقيت بغداد (UTC+3) */
export function nowIQ(): Date { return new Date(Date.now() + 3 * 3600 * 1000); }
const p2 = (n: number) => String(n).padStart(2, "0");
export function stamp(d: Date = nowIQ()) {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
export function todayStr(back = 0) {
  const d = new Date(nowIQ().getTime() - back * 86400000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function shiftDay(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export const b64urlEncode = (o: unknown) =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
export const b64urlDecode = <T = any>(s: string): T =>
  JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
