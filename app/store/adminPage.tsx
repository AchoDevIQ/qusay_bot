"use client";
// المشترك بين صفحات لوحة التحكم
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type TgEvent = (e?: { error?: string }) => void;
type Tg = { Telegram?: { WebApp?: {
  initData?: string; expand?: () => void; platform?: string; isFullscreen?: boolean;
  isVersionAtLeast?: (v: string) => boolean; requestFullscreen?: () => void; exitFullscreen?: () => void;
  onEvent?: (name: string, fn: TgEvent) => void; offEvent?: (name: string, fn: TgEvent) => void; showAlert?: (text: string) => void;
} } };
const webApp = () => (window as unknown as Tg).Telegram?.WebApp;

/** يتصل بواجهة الصفحة بتوقيع تليجرام. يرجع الجواب، أو null إذا صار خطأ */
export function useAdminApi<T>(url: string, button: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(body: Record<string, unknown> | FormData): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const initData = webApp()?.initData ?? "";
      let res: Response;
      if (body instanceof FormData) {
        body.set("initData", initData);
        res = await fetch(url, { method: "POST", body });
      } else {
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData }) });
      }
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      setData(j);
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  // سكربت تليجرام يتحمل بعد الصفحة، فننتظره شوية
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      if (webApp()?.initData) { clearInterval(t); webApp()?.expand?.(); void call({ action: "list" }); }
      else if (++tries > 25) { clearInterval(t); setError(`افتح هاي الصفحة من زر «${button}» داخل البوت.`); }
    }, 200);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, busy, call };
}

// تليجرام هو اللي يحدد حجم النافذة، ويسمح للصفحة بس بملء الشاشة أو الرجوع منه.
// الموبايل تنفتح بيه الصفحة كبيرة أصلاً، فالزر للكمبيوتر فقط
const DESKTOP = ["tdesktop", "macos"];
function FullscreenButton() {
  const [show, setShow] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    let off = () => {};
    let tries = 0;
    const t = setInterval(() => {
      const w = webApp();
      if (w?.initData) {
        clearInterval(t);
        if (!DESKTOP.includes(w.platform ?? "") || !w.isVersionAtLeast?.("8.0") || !w.requestFullscreen) return;
        const changed: TgEvent = () => setFull(!!webApp()?.isFullscreen);
        const failed: TgEvent = (e) => { if (e?.error !== "ALREADY_FULLSCREEN") webApp()?.showAlert?.("ما گدر تليجرام يكبر الصفحة. حدث تليجرام وجرب مرة ثانية."); };
        w.onEvent?.("fullscreenChanged", changed);
        w.onEvent?.("fullscreenFailed", failed);
        off = () => { w.offEvent?.("fullscreenChanged", changed); w.offEvent?.("fullscreenFailed", failed); };
        setFull(!!w.isFullscreen);
        setShow(true);
      } else if (++tries > 25) clearInterval(t);
    }, 200);
    return () => { clearInterval(t); off(); };
  }, []);
  if (!show) return null;
  return <button type="button" className="adscreen" onClick={() => (full ? webApp()?.exitFullscreen?.() : webApp()?.requestFullscreen?.())}>{full ? "↙️ تصغير الشاشة" : "↗️ ملء الشاشة"}</button>;
}

/** رأس صفحة الإدارة، وزر الرجوع للوحة التحكم */
export function AdminHeader({ title, home }: { title: string; home?: boolean }) {
  return (
    <header className="adhead">
      {!home && <Link className="adback" href="/store/admin">⬅️ لوحة التحكم</Link>}
      <FullscreenButton />
      <img src="/logo.png" alt="" />
      <h1 className="plain">QMath</h1>
      <p>{title}</p>
    </header>
  );
}
/** شريط أسفل الشاشة: جاري الحفظ، الخطأ، أو تم */
export function StatusBar({ busy, error, notice, children }: { busy: boolean; error?: string; notice?: string; children?: ReactNode }) {
  if (!busy && !error && !notice && !children) return null;
  return (
    <div className="bar"><div className="in">
      <div className="sum">
        {busy ? <small>جاري التنفيذ...</small> : error ? <small className="exbad">⚠️ {error}</small> : notice ? <small className="fdok">{notice}</small> : null}
      </div>
      {children}
    </div></div>
  );
}

/** زر فيه خطوة تأكيد داخل الصفحة */
export function Confirm({ label, onYes, disabled }: { label: string; onYes: () => void; disabled?: boolean }) {
  const [ask, setAsk] = useState(false);
  return ask
    ? <button type="button" className="exbtn danger" disabled={disabled} onClick={() => { setAsk(false); onYes(); }}>⚠️ متأكد؟ اضغط مرة ثانية</button>
    : <button type="button" className="exbtn" disabled={disabled} onClick={() => setAsk(true)}>{label}</button>;
}
