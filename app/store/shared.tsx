"use client";
// المشترك بين صفحات المتجر: قراءة البيانات من الرابط، والإرسال للبوت عن طريق Telegram WebApp
import Script from "next/script";
import { useEffect, useState } from "react";

type TgWebApp = {
  ready(): void; expand(): void; setHeaderColor(c: string): void; setBackgroundColor(c: string): void;
  sendData(s: string): void; HapticFeedback?: { selectionChanged(): void };
  isVersionAtLeast?(v: string): boolean;
  showScanQrPopup?(p: { text?: string }, cb: (text: string) => boolean | void): void;
};
const tg = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** يفتح كاميرا تليجرام لقراءة QR. يرجع false إذا الجهاز ما يدعمها */
export function scanQr(text: string, onText: (t: string) => boolean | void) {
  const w = tg();
  if (!w?.showScanQrPopup || !w.isVersionAtLeast?.("6.4")) return false;
  try { w.showScanQrPopup({ text }, onText); return true; } catch { return false; }
}

export function TelegramInit() {
  return (
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => {
      const w = tg();
      try { w?.ready(); w?.expand(); w?.setHeaderColor("#101929"); w?.setBackgroundColor("#101929"); } catch { /* نسخة تليجرام قديمة */ }
    }} />
  );
}

export function haptic() {
  try { tg()?.HapticFeedback?.selectionChanged(); } catch { /* مو مدعوم */ }
}
export function closeApp() {
  try { (tg() as unknown as { close?: () => void } | undefined)?.close?.(); } catch { /* مو مدعوم */ }
}
export function sendToBot(o: unknown) {
  const s = JSON.stringify(o);
  const w = tg();
  if (w?.sendData) w.sendData(s); else alert(s);
}

function readData<T>(): T | null {
  try {
    const d = new URLSearchParams(location.search).get("d")!;
    const b = atob(d.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  } catch { return null; }
}
/** البيانات تجي من البوت داخل الرابط، وتتقرأ بالمتصفح بعد التحميل */
export function useBotData<T>(fallback: T): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => { setD(readData<T>() ?? fallback); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return d;
}

export const fmt = (n: number) => n.toLocaleString("en-US") + " د.ع";
const AR_DIGIT = /[٠-٩۰-۹]/;
export const AR_NAME_ERR = "اكتب اسمك الرباعي (أربع كلمات على الأقل) بالحروف العربية فقط";
export function nameOk(name: string) {
  const words = name ? name.split(" ") : [];
  return words.length >= 4 && words.every((w) => /^[ء-ْٰ-ۓ]+$/.test(w));
}
export const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");
export const cleanPhone = (s: string) => s.replace(/[\s-]/g, "");
export function phoneErr(v: string) {
  if (!v) return "اكتب رقم الهاتف";
  if (AR_DIGIT.test(v)) return "اكتب الرقم بالأرقام الإنجليزية مو العربية (مثل 07701234567)";
  if (!/^07\d{9}$/.test(v)) return "الرقم لازم يكون 11 رقم ويبدأ بـ 07";
  return "";
}
export const liveDigitErr = (v: string) => (AR_DIGIT.test(v) ? "اكتب الرقم بالأرقام الإنجليزية مو العربية" : "");
export type Errs = Record<string, string>;
/** ينزل لأول خطأ بالفورمة. يرجع true إذا أكو أخطاء */
export function scrollToFirst(e: Errs) {
  const first = Object.keys(e)[0];
  if (!first) return false;
  requestAnimationFrame(() => document.getElementById("e_" + first)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  return true;
}

export function Err({ id, errs }: { id: string; errs: Errs }) {
  return <div className="err" id={"e_" + id}>{errs[id] ?? ""}</div>;
}
export function Seg({ options, value, onPick, disabled, wrap }: {
  options: { v: string; label: string }[]; value: string; onPick: (v: string) => void; disabled?: boolean; wrap?: boolean;
}) {
  return (
    <div className={"seg" + (wrap ? " wrap2" : "")}>
      {options.map((o) => (
        <button key={o.v} type="button" disabled={disabled} className={value === o.v ? "on" : ""} onClick={() => { haptic(); onPick(o.v); }}>{o.label}</button>
      ))}
    </div>
  );
}
export const CURR_OPTS = [{ v: "عربي", label: "عربي" }, { v: "إنجليزي", label: "إنجليزي" }];
export const SIDE_OPTS = [{ v: "الرصافة", label: "الرصافة" }, { v: "الكرخ", label: "الكرخ" }];

export function PhoneInput({ id, value, onChange, errs, setErrs }: {
  id: string; value: string; onChange: (v: string) => void; errs: Errs; setErrs: (f: (e: Errs) => Errs) => void;
}) {
  return (
    <>
      <input className="ltr" inputMode="tel" maxLength={13} placeholder="07XXXXXXXXX" autoComplete="off" value={value}
        onChange={(ev) => { onChange(ev.target.value); const msg = liveDigitErr(ev.target.value); setErrs((e) => ({ ...e, [id]: msg })); }} />
      <Err id={id} errs={errs} />
    </>
  );
}
