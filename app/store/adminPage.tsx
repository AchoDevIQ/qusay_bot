"use client";
// المشترك بين صفحات لوحة التحكم
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type Tg = { Telegram?: { WebApp?: {
  initData?: string; expand?: () => void;
} } };
// الصفحة ممكن تكون داخل تبويب بصفحة «أكثر من صفحة»: توقيع تليجرام يبقى بالصفحة الأم
const webApp = () => {
  const own = (window as unknown as Tg).Telegram?.WebApp;
  if (own?.initData) return own;
  try { return (window.parent as unknown as Tg).Telegram?.WebApp ?? own; } catch { return own; }
};

// زر أسفل المحادثة ما يعطي توقيع تليجرام، فرابطه يحمل رمز موقع. يبقى محفوظ لما ينتقل بين الصفحات
const TOKEN_KEY = "qmathPageToken";
function pageToken() {
  const t = new URLSearchParams(location.search).get("t");
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    return t ?? sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch { return t ?? ""; }
}
export const pageAuth = () => { const t = pageToken(); return t ? `tk:${t}` : webApp()?.initData ?? ""; };

/** يتصل بواجهة الصفحة بتوقيع تليجرام. يرجع الجواب، أو null إذا صار خطأ */
export function useAdminApi<T>(url: string, button: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(body: Record<string, unknown> | FormData): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const initData = pageAuth();
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
      if (pageAuth()) { clearInterval(t); webApp()?.expand?.(); void call({ action: "list" }); }
      else if (++tries > 25) { clearInterval(t); setError(`افتح هاي الصفحة من زر «${button}» داخل البوت.`); }
    }, 200);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, busy, call };
}

/** رأس صفحة الإدارة، وزر الرجوع للوحة التحكم */
export function AdminHeader({ title, home }: { title: string; home?: boolean }) {
  return (
    <header className="adhead">
      {!home && <Link className="adback" href="/store/admin">⬅️ لوحة التحكم</Link>}
      <img src="/logo.png" alt="" />
      <h1>قصي العميري</h1>
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
