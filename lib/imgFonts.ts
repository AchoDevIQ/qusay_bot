// خطوط الصور اللي يسويها البوت (بطاقة الدرجة، الفقاعة، بطاقة المعلومات، الوصولات، الليبل، الأوراق المطبوعة).
// صاحب البوت يختار خط عربي وخط إنجليزي من «💬 تعليقات الدرجات ← ✍️ الخط»، وكلشي يتغير وياه
import fs from "node:fs";
import path from "node:path";
import { FONT } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";

type Font = { id: string; name: string; file: string; range?: string; noIraqi?: boolean };
const dir = (f: string) => path.join(process.cwd(), "assets", "fonts", f);
export const AR_RANGE = "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF";
export const LATIN_RANGE = "U+0000-024F,U+2000-206F,U+20AC,U+2122";
export const AR_FONTS: Font[] = [
  // Tajawal الأصلي ما بيه گ چ ژ ک ی، فانضافت إله من قطعه نفسها (tools/build_iraqi_font.py)، حتى الحرف يطلع ويا الكلمة
  { id: "tajawal", name: "Tajawal", file: dir("TajawalIQ-Bold.ttf") },
  { id: "almarai", name: "Almarai", file: dir("Almarai-Bold.ttf") },
  { id: "cairo", name: "Cairo", file: dir("Cairo-Bold.ttf") },
  { id: "ibmplex", name: "IBM Plex Sans Arabic", file: dir("IBMPlexSansArabic-SemiBold.ttf") },
  { id: "notokufi", name: "Noto Kufi Arabic", file: dir("NotoKufiArabic-SemiBold.ttf") },
  { id: "changa", name: "Changa", file: dir("Changa-SemiBold.ttf") },
  { id: "elmessiri", name: "El Messiri", file: dir("ElMessiri-Bold.ttf") },
  { id: "noto", name: "Noto Sans Arabic", file: dir("NotoSansArabic-Bold.ttf") },
  // خط «قصي العميري» القديم: يرسم گ چ پ ژ والأرقام فارغة، فتجي من الخط الاحتياطي
  { id: "boahmed", name: "خط قصي العميري القديم", file: FONT, range: "U+0600-065F,U+066A-067D,U+067F-0685,U+0687-0697,U+0699-06A3,U+06A5-06A8,U+06AA-06AE,U+06B0-06CB,U+06CD-06EF,U+FB50-FDFF,U+FE70-FEFF" },
];
export const EN_FONTS: Font[] = [
  { id: "nunito", name: "Nunito", file: dir("Nunito-Bold.ttf") },
  { id: "poppins", name: "Poppins", file: dir("Poppins-SemiBold.ttf") },
  { id: "montserrat", name: "Montserrat", file: dir("Montserrat-SemiBold.ttf") },
  { id: "inter", name: "Inter", file: dir("Inter-SemiBold.ttf") },
];
/** الحروف اللي ما بالخط العربي المختار (مثلاً گ و چ بـ Tajawal) تجي من هذا */
export const AR_FALLBACK = dir("NotoSansArabic-Bold.ttf");
export type FontChoice = { ar: string; en: string };
export const DEFAULT_FONTS: FontChoice = { ar: "tajawal", en: "nunito" };
const KEY = "img_fonts";

export async function fontChoice(): Promise<FontChoice> {
  try { const j = JSON.parse(await kvGet(KEY) ?? "{}"); return { ar: AR_FONTS.some((f) => f.id === j.ar) ? j.ar : DEFAULT_FONTS.ar, en: EN_FONTS.some((f) => f.id === j.en) ? j.en : DEFAULT_FONTS.en }; } catch { return DEFAULT_FONTS; }
}
export async function setFontChoice(c: Partial<FontChoice>) {
  const cur = await fontChoice();
  const next = { ar: AR_FONTS.some((f) => f.id === c.ar) ? c.ar! : cur.ar, en: EN_FONTS.some((f) => f.id === c.en) ? c.en! : cur.en };
  await kvSet(KEY, JSON.stringify(next));
  return next;
}
export const arFont = (c: FontChoice) => AR_FONTS.find((f) => f.id === c.ar) ?? AR_FONTS[0];
export const enFont = (c: FontChoice) => EN_FONTS.find((f) => f.id === c.en) ?? EN_FONTS[0];

/** نفس الخط ما ينقرا من القرص كل مرة */
const cache = new Map<string, string>();
const b64 = (f: string) => { if (!cache.has(f)) cache.set(f, fs.existsSync(f) ? fs.readFileSync(f).toString("base64") : ""); return cache.get(f)!; };
const face = (family: string, file: string, range: string) => (b64(file) ? `@font-face{font-family:${family};src:url(data:font/ttf;base64,${b64(file)});unicode-range:${range}}` : "");
/** خطوط الصفحة: الإنجليزي والأرقام، والعربي، والاحتياطي */
export function fontsCss(c: FontChoice = DEFAULT_FONTS) {
  const ar = arFont(c), en = enFont(c);
  return face("QLatin", en.file, LATIN_RANGE) + face("QAr", ar.file, ar.range ?? AR_RANGE) + face("QArFb", AR_FALLBACK, AR_RANGE);
}
/** كل كتابة الصور تستعمل هذا */
export const FONT_STACK = "QLatin,QAr,QArFb,'Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";
export const pageFonts = async () => fontsCss(await fontChoice());

/** خط صفحات التطبيق (الأزرار، العناوين، اسم «قصي العميري»): نفس الخط المختار للصور */
export async function appFontsCss() {
  const c = await fontChoice();
  const ar = arFont(c), en = enFont(c);
  // v: حجم الملف، فإذا تبدل الخط الموبايل ينزله من جديد بدل النسخة المخزنة
  const v = (f: Font) => { try { return fs.statSync(f.file).size; } catch { return 0; } };
  return `@font-face{font-family:QAppEn;src:url(/api/font?f=en-${en.id}&v=${v(en)}) format("truetype");font-display:swap;unicode-range:${LATIN_RANGE}}`
    + `@font-face{font-family:QAppAr;src:url(/api/font?f=ar-${ar.id}&v=${v(ar)}) format("truetype");font-display:swap;unicode-range:${ar.range ?? AR_RANGE}}`;
}
/** ملف الخط نفسه: «ar-tajawal» أو «en-nunito» */
export function appFontFile(f: string) {
  const [k, id] = f.split("-");
  const font = (k === "ar" ? AR_FONTS : k === "en" ? EN_FONTS : []).find((x) => x.id === id);
  return font && fs.existsSync(font.file) ? fs.readFileSync(font.file) : null;
}
