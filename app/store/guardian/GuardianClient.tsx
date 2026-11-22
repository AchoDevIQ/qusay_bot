"use client";
// صفحة ولي الأمر على تلفون ابنه: أول مرة يحط رمز سري، وبعدين يفتحها برمزه ويشوف الدرجات ويدوس «✅ استلمت»
import { useEffect, useRef, useState } from "react";
import { appKey } from "../shared";
import { CHAT_CSS, safeHtml } from "../chat/ChatClient";
import FaceCheck from "./FaceCheck";

type Btn = { text: string; callback_data?: string };
type Msg = { id: number; mid: number; dir: string; text: string; html: boolean; kb: Btn[][] | null; media: { t: string }[]; at: string };
type List = { msgs: Msg[]; last: number; answer?: string };

export default function GuardianClient() {
  const [state, setState] = useState<{ hasPin: boolean; hasFace?: boolean; name: string; own?: boolean; vapid?: string } | null>(null);
  const [face, setFace] = useState<"" | "set" | "open">("");
  const [notice, setNotice] = useState("");
  const [g, setG] = useState("");
  const [pin, setPin] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [toast, setToast] = useState("");
  const last = useRef(0);
  // تلفون ولي الأمر نفسه: رابطه الخاص (d) ينحفظ بالتلفون، حتى لو فتحها من الشاشة الرئيسية
  const auth = (): Record<string, string> => {
    let d = "";
    try { d = new URLSearchParams(location.search).get("d") ?? ""; if (d) localStorage.setItem("qm_gd", d); else if (!new URLSearchParams(location.search).get("t")) d = localStorage.getItem("qm_gd") ?? ""; } catch { /* */ }
    if (d) return { d };
    return { token: new URLSearchParams(location.search).get("t") ?? sessionStorage.getItem("qm_t") ?? "", app: appKey() };
  };
  const [link, setLink] = useState<{ link: string; qr: string } | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/guardian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...auth(), ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); if (res.status === 401 && body.gtoken) setG(""); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  function merge(r: List) {
    setMsgs((old) => { const m = new Map(old.map((x) => [x.id, x])); for (const x of r.msgs) m.set(x.id, x); return [...m.values()].sort((a, b) => a.id - b.id); });
    if (r.last > last.current) last.current = r.last;
    if (r.answer) { setToast(r.answer); setTimeout(() => setToast(""), 3000); }
  }
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("t");
    if (t) sessionStorage.setItem("qm_t", t);
    void call({ action: "state" }).then((r) => r && setState(r));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!g) return;
    void call({ action: "list", gtoken: g }).then((r) => r && merge(r));
    const iv = setInterval(() => { if (!document.hidden) void fetch("/api/guardian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...auth(), action: "list", gtoken: g, after: last.current }) }).then((r) => r.ok ? r.json() : null).then((r) => r && merge(r)).catch(() => undefined); }, 5000);
    return () => clearInterval(iv);
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enablePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !state?.vapid) { setError("تلفونك ما يدعم الإشعارات هنا. بالآيفون ضيف الصفحة للشاشة الرئيسية أول"); return; }
      const reg = await navigator.serviceWorker.register("/guardian-sw.js");
      if ((await Notification.requestPermission()) !== "granted") { setError("لازم تسمح بالإشعارات"); return; }
      const key = Uint8Array.from(atob(state.vapid.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (state.vapid.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      const r = await call({ action: "pushSub", gtoken: g, sub: sub.toJSON() });
      if (r) setNotice(r.notice);
    } catch { setError("ما گدرنا نفعّل الإشعارات، جرب مرة ثانية"); }
  }
  const fileUrl = (m: Msg, k: number) => `/api/guardian/file?g=${encodeURIComponent(g)}&m=${m.id}&k=${k}`;
  const digits = (v: string) => v.replace(/[^\d٠-٩]/g, "").slice(0, 4);

  return (
    <div className="chatpage">
      <style>{CHAT_CSS}</style>
      <header style={{ padding: "16px 14px" }}><h1 style={{ fontSize: 24 }}>👨‍👧 ولي الأمر</h1>{state?.name && <p>درجات {state.name.split(" ").slice(0, 2).join(" ")}</p>}</header>
      {!state && !error && <div className="empty">جاري التحميل...</div>}
      {error && <div className="chaterr">⚠️ {error}</div>}
      {/* الرمز ينطيه الأستاذ لولي الأمر بس (قراره 2026-11-22): الطالب ما يگدر يحط رمز من هنا */}
      {state && !state.hasPin && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">هاي الصفحة لولي الأمر بس. الدرجات توصل هنا، وولي الأمر يفتحها بـ<b>رمز سري من 4 أرقام</b> ينطيه الأستاذ لولي الأمر نفسه.</div>
          <div className="exhint">🔑 بعده ما انطى رمز. ولي الأمر يطلبه من الإدارة، وبعدها يكتبه هنا.</div>
        </div></div></div>
      )}
      {face && (
        <div className="wrap"><FaceCheck onCancel={() => setFace("")} onDone={(r) => {
          const mode = face; setFace("");
          if (mode === "set") void call({ action: "faceSet", gtoken: g, ...r }).then((x) => { if (x) { setState({ ...state!, hasFace: true }); setNotice(x.notice); } });
          else void call({ action: "faceOpen", ...r }).then((x) => { if (x) setG(x.gtoken); });
        }} /></div>
      )}
      {notice && <div className="wrap"><div className="card"><div className="form"><div className="exhint">{notice}</div></div></div></div>}
      {state?.hasPin && !g && !face && (
        <div className="wrap"><div className="card"><div className="form">
          {state.hasFace && <button type="button" className="btn" disabled={busy} onClick={() => setFace("open")}>📸 افتح بوجهي</button>}
          <div className="exhint">ولي الأمر يكتب الرمز اللي انطاه الأستاذ حتى يشوف الدرجات ويستلمها.</div>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
          <button type="button" className="btn" disabled={busy || pin.length !== 4} onClick={() => void call({ action: "open", pin }).then((r) => { if (r) { setG(r.gtoken); setPin(""); } })}>🔓 افتح</button>
        </div></div></div>
      )}
      {g && !face && state && !state.own && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">📱 ولي الأمر يگدر يستلم الدرجات على تلفونه هو، ببلاش وبدون تليگرام: صوّر رمز QR بكاميرة تلفونه، أو دزله الرابط.</div>
          {!link ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "deviceLink", gtoken: g }).then((r) => r && setLink(r))}>📱 استلم الدرجات على تلفوني</button> : (
            <div style={{ textAlign: "center" }}>
              <img src={link.qr} alt="" style={{ width: 220, background: "#fff", borderRadius: 12 }} />
              <button type="button" className="btn ghost" onClick={() => { if (navigator.share) void navigator.share({ title: "ولي الأمر", url: link.link }).catch(() => undefined); else void navigator.clipboard?.writeText(link.link); }}>📤 دز الرابط</button>
            </div>
          )}
        </div></div></div>
      )}
      {g && !face && state?.own && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">🔔 فعّل الإشعارات حتى يوصلك إشعار بكل درجة. بالآيفون: أول شي دوس «مشاركة» ← «إضافة للشاشة الرئيسية»، وافتحها من هناك.</div>
          <button type="button" className="btn" disabled={busy} onClick={() => void enablePush()}>🔔 فعّل الإشعارات</button>
        </div></div></div>
      )}
      {g && !face && state && !state.hasFace && !state.own && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">تگدر تسجّل وجهك، حتى تفتح الصفحة بوجهك بدل الرمز. الأحسن تسجّله بحضور المساعد بالمركز. صورة كل توقيع تنحفظ مشفرة، والإدارة بس تشوفها.</div>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setFace("set")}>📸 سجّل وجهي للتوقيع</button>
        </div></div></div>
      )}
      {g && !face && (
        <div className="chatlist">
          {!msgs.length && <div className="empty">ماكو درجات بعد. كل درجة جديدة تطلع هنا.</div>}
          {msgs.map((m) => (
            <div key={m.id} className={"chatrow " + (m.dir === "in" ? "in" : "out")}>
              <div className="bubble">
                {m.media.map((x, k) => x.t === "photo" ? <img key={k} src={fileUrl(m, k)} alt="" /> : null)}
                {m.text && (m.html ? <div className="txt" dangerouslySetInnerHTML={{ __html: safeHtml(m.text) }} /> : <div className="txt">{m.text}</div>)}
                <small>{m.at.slice(0, 16)}</small>
              </div>
              {m.kb && <div className="inkb">{m.kb.map((row, i) => <div key={i} className="inrow">{row.map((b, j) => <button type="button" key={j} disabled={busy || !b.callback_data} onClick={() => void call({ action: "cb", gtoken: g, mid: m.mid, data: b.callback_data, after: last.current }).then((r) => r && merge(r))}>{b.text}</button>)}</div>)}</div>}
            </div>
          ))}
        </div>
      )}
      {toast && <div className="chattoast">{toast}</div>}
    </div>
  );
}
