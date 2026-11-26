"use client";
// المشترك بين صفحات لوحة التحكم
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { partRows, sumParts, type MoneyParts, type PriceLine } from "../../lib/orderRules.ts";

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
/** جلسة جديدة لهذا التبويب (رابط «افتحها بمتصفح التلفون»). إذا المتصفح ما يحفظ، ترجع false */
export function setPageToken(t: string) { try { sessionStorage.setItem(TOKEN_KEY, t); return sessionStorage.getItem(TOKEN_KEY) === t; } catch { return false; } }
export function pageToken() {
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

  // merge: الجواب يضيف على البيانات اللي عندنا بدل ما يبدلها (مثل فتح ورقة بدون ما ترجع القائمة كلها)
  async function call(body: Record<string, unknown> | FormData, merge = false): Promise<T | null> {
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
      if (merge) setData((d) => ({ ...(d ?? {}), ...j }) as T); else setData(j);
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
/** المبلغ مقسم: الملازم والامتحانات والمحاضرات، وتحتها المجموع */
export function MoneyBreakdown({ parts, title, inset }: { parts: MoneyParts; title?: string; inset?: boolean }) {
  const rows = partRows(parts);
  if (!rows.length) return null;
  return (
    <div className={inset ? "adparts adpartsin" : "adparts"}>
      {title && <div className="adpartt">{title}</div>}
      {rows.map(([l, v]) => <div key={l} className="adpart"><span>{l}</span><b>{v.toLocaleString("en-US")}</b></div>)}
      <div className="adpart adpartsum"><span>المجموع</span><b>{sumParts(parts).toLocaleString("en-US")}</b></div>
    </div>
  );
}

/** كل منتج، وكم انباع بكل سعر */
export function PriceReport({ lines, title, open }: { lines: PriceLine[]; title: string; open?: boolean }) {
  if (!lines.length) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <details className="adparts" open={open}>
      <summary className="adpartt">💵 {title}</summary>
      {lines.map((l) => (
        <div key={l.name} className="adprice">
          <b>{l.name}</b>
          {l.prices.map((p) => <div key={p.price} className="adpart"><span>العدد {n(p.qty)} · السعر {n(p.price)}</span><b>{n(p.qty * p.price)}</b></div>)}
          <div className="adpart adpartsum"><span>المجموع · العدد {n(l.qty)}</span><b>{n(l.total)}</b></div>
        </div>
      ))}
      <div className="adpart adpartsum"><span>مجموع كل المنتجات</span><b>{n(lines.reduce((t, l) => t + l.total, 0))}</b></div>
    </details>
  );
}

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

/** رابط الدخول بدون تليگرام: مكتوب، ويا زر «📋 انسخ الرابط» بس، وهو يدزه بإيده (طلبه 2026-11-26: نافذة المشاركة مال ويندوز جانت تحيّره) */
export function DoorShare({ link }: { link: string }) {
  const [msg, setMsg] = useState("");
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8, justifyItems: "center" }}>
      <div dir="ltr" style={{ userSelect: "all", WebkitUserSelect: "all", wordBreak: "break-all", fontSize: 13, background: "rgba(255,255,255,.08)", borderRadius: 8, padding: 8, width: "100%" }}>{link}</div>
      <button type="button" className="exbtn" onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg("✅ انسخ الرابط. روح للواتساب، افتح محادثته، ودوس لصق (Ctrl و V) ودزه."), () => setMsg("⚠️ ما انسخ. ظلّل الرابط فوگ بالماوس وانسخه."))}>📋 انسخ الرابط</button>
      {msg && <div className="exhint">{msg}</div>}
    </div>
  );
}
