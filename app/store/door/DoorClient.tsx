"use client";
// باب الكادر بدون تليگرام: الرابط الخاص (ينحفظ بالجهاز) + رمز سري ← لوحة التحكم، أو المكتبة، والرسائل، والإشعارات
import { useEffect, useRef, useState } from "react";

type State = { hasPin: boolean; label: string; vapid: string };
type Open = { t: string; admin: boolean; office: boolean; student?: boolean; pin?: string };

const T_KEY = "qm_door_t";
export default function DoorClient() {
  const [d, setD] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  /** دخل: ينحفظ بالجهاز حتى المرة الجاية ما يطلب الرمز */
  const keep = (r: Open) => {
    try { localStorage.setItem(T_KEY, r.t); } catch { /* */ }
    setOpen(r);
    // ?go=board: أيقونة «سبورة قصي العميري» باللابتوب تفتح نافذة لحالها (بلا رابط، وبيها زر تصغير الويندوز) وتدخل للسبورة على طول.
    // بس إذا هذي أول مرة يطلعله رمزه (r.pin) يبقى هنا حتى يحفظه
    const g = new URLSearchParams(location.search).get("go");
    if (g === "board" && r.admin && !r.pin) location.replace(`/store/board?t=${encodeURIComponent(r.t)}`);
  };

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
    if (!k) { setNoLink(true); return; }
    void call({ action: "state" }, k).then(async (r) => {
      if (!r) return;
      // هذا الجهاز دخل قبل: يكمل بدون رمز (الدخول يتجدد كل ما يفتحها)
      let t = ""; try { t = localStorage.getItem(T_KEY) ?? ""; } catch { /* */ }
      if (r.hasPin && t) {
        const j = await fetch("/api/door", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d: k, action: "resume", t }) }).then((x) => x.ok ? x.json() : null).catch(() => null);
        if (j?.t) { keep(j); setSt(r); return; }
        try { localStorage.removeItem(T_KEY); } catch { /* */ }
      }
      setSt(r);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ماكو رابط محفوظ (مثل تطبيق جهاز البيع أول مرة): يلصق الرابط أو يصور رمزه المربع
  const [noLink, setNoLink] = useState(false);
  const [paste, setPaste] = useState("");
  const [cam, setCam] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  function takeLink(text: string) {
    const m = /[?&]d=([^&\s#]+)/.exec(text.trim()) ?? /^(k[\w.-]+)$/.exec(text.trim());
    if (!m) { setError("هذا مو رابط الدخول. انسخ الرابط كامل من صاحب البوت"); return false; }
    const g = new URLSearchParams(location.search).get("go");
    location.href = `/store/door?d=${m[1]}${g ? `&go=${encodeURIComponent(g)}` : ""}`;
    return true;
  }
  useEffect(() => {
    if (!cam) return;
    let stop = false, stream: MediaStream | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current!; v.srcObject = stream; await v.play();
        const jsQR = (await import("jsqr")).default;
        const c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true })!;
        while (!stop) {
          if (v.videoWidth) {
            c.width = v.videoWidth; c.height = v.videoHeight; g.drawImage(v, 0, 0);
            const r = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
            if (r?.data && takeLink(r.data)) { stop = true; break; }
          }
          await new Promise((ok) => setTimeout(ok, 250));
        }
      } catch { setError("الكاميرا ما اشتغلت. الصق الرابط بداله"); setCam(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {noLink && !st && (
          <div className="card"><div className="form">
            <div className="exhint">أول مرة على هذا الجهاز: صوّر الرمز المربع اللي دزه إلك صاحب البوت، أو الصق الرابط.</div>
            {cam ? <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 12, background: "#000" }} />
              : <button type="button" className="btn" onClick={() => { setError(""); setCam(true); }}>📷 صوّر الرمز</button>}
            <label>أو الصق الرابط</label>
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="الرابط" dir="ltr" />
            <button type="button" className="btn ghost" disabled={!paste.trim()} onClick={() => takeLink(paste)}>➡️ ادخل بالرابط</button>
          </div></div>
        )}
        {st && !open && !st.hasPin && (
          <div className="card"><div className="form">
            <div className="exhint">أول مرة على هذا الجهاز: دوس الزر، ويطلعلك رمزك السري (4 أرقام). تفتح بيه صفحاتك كل مرة.</div>
            <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "makePin" }).then((r) => { if (r) keep(r); })}>🔐 اعطيني رمزي السري</button>
          </div></div>
        )}
        {st && !open && st.hasPin && (
          <div className="card"><div className="form">
            <label>رمزك السري</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
            <button type="button" className="btn" disabled={busy || pin.length !== 4} onClick={() => void call({ action: "open", pin }).then((r) => { if (r) { keep(r); setPin(""); } })}>🔓 ادخل</button>
          </div></div>
        )}
        {open?.pin && (
          <div className="card"><div className="form" style={{ textAlign: "center" }}>
            <div className="exhint">🔐 هذا رمزك السري. اكتبه بورقة لو صوّره واحفظه. كل مرة تدخل تكتبه:</div>
            <div dir="ltr" style={{ fontSize: 44, fontWeight: 900, letterSpacing: 12, color: "#F6C94A" }}>{open.pin}</div>
            <div className="exhint">إذا نسيته، گول لقصي العميري يسويلك رابط جديد.</div>
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
            <div className="exhint">هذا الجهاز يبقى داخل: الرابط ثابت، وما يطلب رمزك مرة ثانية إلا إذا ما فتحته أسبوع كامل (أو انمسحت بيانات المتصفح). بالآيفون والآيباد: «مشاركة» ← «إضافة للشاشة الرئيسية»، وافتحها من هناك.</div>
          </div></div>
        )}
      </div>
    </>
  );
}
