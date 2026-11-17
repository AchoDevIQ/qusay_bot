"use client";
// باب الكادر بدون تليگرام: الرابط الخاص (ينحفظ بالجهاز) + رمز سري ← لوحة التحكم، أو المكتبة، والرسائل، والإشعارات
import { useEffect, useState } from "react";

type State = { hasPin: boolean; label: string; vapid: string };
type Open = { t: string; admin: boolean; office: boolean; student?: boolean };

export default function DoorClient() {
  const [d, setD] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [pin, setPin] = useState(""), [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");

  async function call(body: Record<string, unknown>, key = d) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/door", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d: key, ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  useEffect(() => {
    let k = new URLSearchParams(location.search).get("d") ?? "";
    try { if (k) localStorage.setItem("qm_door", k); else k = localStorage.getItem("qm_door") ?? ""; } catch { /* */ }
    setD(k);
    if (!k) { setError("افتح الرابط اللي دزه إلك صاحب البوت"); return; }
    void call({ action: "state" }, k).then((r) => r && setSt(r));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const digits = (v: string) => v.replace(/[^\d٠-٩]/g, "").slice(0, 4);
  const go = (page: string) => { if (open) location.href = `/store/${page}?t=${encodeURIComponent(open.t)}`; };
  async function enablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !st?.vapid) { setError("جهازك ما يدعم الإشعارات هنا. بالآيفون والآيباد ضيف الصفحة للشاشة الرئيسية أول"); return; }
      const reg = await navigator.serviceWorker.register("/guardian-sw.js");
      if ((await Notification.requestPermission()) !== "granted") { setError("لازم تسمح بالإشعارات"); return; }
      const key = Uint8Array.from(atob(st.vapid.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (st.vapid.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      const r = await call({ action: "pushSub", t: open?.t, sub: sub.toJSON() });
      if (r) setNotice(r.notice);
    } catch { setError("ما گدرنا نفعّل الإشعارات، جرب مرة ثانية"); }
  }

  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>قصي العميري</h1>{st?.label && <p>{st.label}</p>}</header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {notice && <div className="card"><div className="form"><div className="exhint">{notice}</div></div></div>}
        {st && !open && !st.hasPin && (
          <div className="card"><div className="form">
            <div className="exhint">أول مرة: حط رمز سري من 4 أرقام، تفتح بيه صفحاتك من هذا الجهاز بدون تليگرام.</div>
            <label>الرمز</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
            <label>اكتب الرمز مرة ثانية</label>
            <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} placeholder="••••" />
            <button type="button" className="btn" disabled={busy || pin.length !== 4 || pin2.length !== 4} onClick={() => void call({ action: "setPin", pin, pin2 }).then((r) => { if (r) { setOpen(r); setPin(""); setPin2(""); } })}>🔐 احفظ رمزي وادخل</button>
          </div></div>
        )}
        {st && !open && st.hasPin && (
          <div className="card"><div className="form">
            <label>رمزك السري</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
            <button type="button" className="btn" disabled={busy || pin.length !== 4} onClick={() => void call({ action: "open", pin }).then((r) => { if (r) { setOpen(r); setPin(""); } })}>🔓 ادخل</button>
          </div></div>
        )}
        {open && (
          <div className="card"><div className="form">
            {open.admin && <button type="button" className="btn" onClick={() => go("admin")}>⚙️ لوحة التحكم</button>}
            {open.office && <button type="button" className="btn" onClick={() => go("sales")}>🏪 مكتبتي</button>}
            {open.student && <button type="button" className="btn" onClick={() => go("home")}>🏠 قائمتي</button>}
            {open.student && <button type="button" className="btn ghost" onClick={() => go("inbox")}>🔔 الإشعارات</button>}
            <button type="button" className="btn ghost" onClick={() => go("chat")}>💬 {open.student ? "المحادثة" : "رسائلي"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void enablePush()}>🔔 فعّل الإشعارات على هذا الجهاز</button>
            <div className="exhint">الدخول يبقى أسبوع، وبعدها تكتب رمزك مرة ثانية. بالآيفون والآيباد: «مشاركة» ← «إضافة للشاشة الرئيسية»، وافتحها من هناك.</div>
          </div></div>
        )}
      </div>
    </>
  );
}
