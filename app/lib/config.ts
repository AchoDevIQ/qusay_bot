// الإعدادات: من متغيرات البيئة (.env.local) أو من ملف settings.txt القديم
import fs from "node:fs";
import path from "node:path";

export const AR_DIGITS: Record<string, string> = {};
"٠١٢٣٤٥٦٧٨٩".split("").forEach((c, i) => (AR_DIGITS[c] = String(i)));
"۰۱۲۳۴۵۶۷۸۹".split("").forEach((c, i) => (AR_DIGITS[c] = String(i)));
export const toLatinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (c) => AR_DIGITS[c] ?? c);

export function parseSettingsText(text: string) {
  let token = "", admins: number[] = [], url = "";
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toUpperCase();
    const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").trim();
    if (k === "TOKEN") token = v;
    else if (["ADMIN", "ADMIN_ID", "ADMIN_IDS"].includes(k))
      admins = (toLatinDigits(v).match(/\d+/g) ?? []).map(Number);
    else if (["STORE", "STORE_URL"].includes(k)) url = v.startsWith("https://") ? v : "";
  }
  return { token, admins, url };
}

function load() {
  let { token, admins, url } = { token: "", admins: [] as number[], url: "" };
  const legacy = process.env.SETTINGS_FILE ?? path.join(process.cwd(), "settings.txt");
  if (fs.existsSync(legacy)) ({ token, admins, url } = parseSettingsText(fs.readFileSync(legacy, "utf8")));
  if (process.env.TOKEN) token = process.env.TOKEN;
  if (process.env.ADMIN) admins = (toLatinDigits(process.env.ADMIN).match(/\d+/g) ?? []).map(Number);
  if (process.env.STORE_URL) url = process.env.STORE_URL;
  return { token, admins, url };
}

const s = load();
export const TOKEN = s.token;
export const ADMIN_IDS = s.admins;
export const STORE_URL = s.url;
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
export const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "store.db");

export const DEFAULT_FEE = 5000;
export const CURRENCY = "د.ع";
export const AGREE_TIMES = 3;
export const GOVS = ["بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "بابل", "الأنبار", "ديالى",
  "ذي قار", "ميسان", "المثنى", "القادسية", "واسط", "صلاح الدين", "كركوك", "دهوك", "السليمانية"];
export const SIDES = ["الرصافة", "الكرخ"];
export const CURRS = ["عربي", "إنجليزي"];
