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

// الصفحة تكبر وتصغر كلها وياها الأيقونات، والحجم يبقى محفوظ على نفس الجهاز
const ZOOMS = [0.85, 1, 1.15, 1.3, 1.5, 1.75];
const ZOOM_KEY = "pageZoom";
type FullApp = { isFullscreen?: boolean; isVersionAtLeast?(v: string): boolean; requestFullscreen?(): void; exitFullscreen?(): void; onEvent?(n: string, f: () => void): void; offEvent?(n: string, f: () => void): void };
export function PageTools() {
  const [zoom, setZoom] = useState(1);
  const [canFull, setCanFull] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(ZOOM_KEY));
      if (ZOOMS.includes(saved)) setZoom(saved);
    } catch { /* المتصفح مانع الحفظ */ }
    let off = () => {};
    let tries = 0;
    const t = setInterval(() => {
      const w = tg() as unknown as FullApp | undefined;
      if (w?.isVersionAtLeast) {
        clearInterval(t);
        if (!w.isVersionAtLeast("8.0") || !w.requestFullscreen) return;
        const changed = () => setFull(!!w.isFullscreen);
        w.onEvent?.("fullscreenChanged", changed);
        off = () => w.offEvent?.("fullscreenChanged", changed);
        setFull(!!w.isFullscreen);
        setCanFull(true);
      } else if (++tries > 25) clearInterval(t);
    }, 200);
    return () => { clearInterval(t); off(); };
  }, []);
  useEffect(() => { (document.documentElement.style as unknown as { zoom: string }).zoom = String(zoom); }, [zoom]);
  function step(d: number) {
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + d))];
    setZoom(next);
    try { localStorage.setItem(ZOOM_KEY, String(next)); } catch { /* المتصفح مانع الحفظ */ }
  }
  const w = () => tg() as unknown as FullApp | undefined;
  return (
    <div className="ptools" role="group" aria-label="حجم الصفحة">
      <button type="button" aria-label="تكبير" disabled={zoom === ZOOMS.at(-1)} onClick={() => step(1)}>A+</button>
      <button type="button" aria-label="تصغير" disabled={zoom === ZOOMS[0]} onClick={() => step(-1)}>A−</button>
      {canFull && <button type="button" aria-label={full ? "تصغير الشاشة" : "ملء الشاشة"} onClick={() => (full ? w()?.exitFullscreen?.() : w()?.requestFullscreen?.())}>{full ? "↙️" : "⛶"}</button>}
    </div>
  );
}

export function haptic() {
  try { tg()?.HapticFeedback?.selectionChanged(); } catch { /* مو مدعوم */ }
}
/** يفتح رابط واتساب أو تليجرام خارج الصفحة */
export function openOutside(url: string) {
  const w = tg() as unknown as { openLink?(u: string): void; openTelegramLink?(u: string): void } | undefined;
  try {
    if (url.startsWith("https://t.me/") && w?.openTelegramLink) return w.openTelegramLink(url);
    if (w?.openLink) return w.openLink(url);
  } catch { /* نسخة قديمة */ }
  window.open(url, "_blank");
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

/** رقم هذا الجهاز: ينحفظ بذاكرة تلگرام على الجهاز نفسه (DeviceStorage)، وإذا ما موجودة بذاكرة الصفحة.
 *  صفحات الطالب تدزه ويا كل طلب، والسيرفر يقفل الحساب على أول جهاز */
type Store = { getItem(k: string, cb: (err: unknown, v?: string | null) => void): void; setItem(k: string, v: string, cb?: (err: unknown) => void): void };
let devicePromise: Promise<string> | null = null;
export function deviceId(): Promise<string> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    const KEY = "qm_device";
    const ds = (window as unknown as { Telegram?: { WebApp?: { DeviceStorage?: Store } } }).Telegram?.WebApp?.DeviceStorage;
    const fromDs = await new Promise<string>((ok) => {
      if (!ds) return ok("");
      const t = setTimeout(() => ok(""), 1500);
      try { ds.getItem(KEY, (err, v) => { clearTimeout(t); ok(!err && v ? String(v) : ""); }); } catch { clearTimeout(t); ok(""); }
    });
    let local = "";
    try { local = localStorage.getItem(KEY) ?? ""; } catch { /* بدون ذاكرة */ }
    const id = fromDs || local || (crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
    try { if (!fromDs) ds?.setItem(KEY, id, () => undefined); } catch { /* نسخة قديمة */ }
    try { if (local !== id) localStorage.setItem(KEY, id); } catch { /* بدون ذاكرة */ }
    return id;
  })();
  return devicePromise;
}
