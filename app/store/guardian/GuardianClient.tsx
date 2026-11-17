"use client";
// صفحة ولي الأمر على تلفون ابنه: أول مرة يحط رمز سري، وبعدين يفتحها برمزه ويشوف الدرجات ويدوس «✅ استلمت»
import { useEffect, useRef, useState } from "react";
import { appKey } from "../shared";
import { CHAT_CSS, safeHtml } from "../chat/ChatClient";

type Btn = { text: string; callback_data?: string };
type Msg = { id: number; mid: number; dir: string; text: string; html: boolean; kb: Btn[][] | null; media: { t: string }[]; at: string };
type List = { msgs: Msg[]; last: number; answer?: string };

export default function GuardianClient() {
  const [state, setState] = useState<{ hasPin: boolean; name: string } | null>(null);
  const [g, setG] = useState("");
  const [pin, setPin] = useState(""), [pin2, setPin2] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [toast, setToast] = useState("");
  const last = useRef(0);
  const auth = () => ({ token: new URLSearchParams(location.search).get("t") ?? sessionStorage.getItem("qm_t") ?? "", app: appKey() });

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

  const fileUrl = (m: Msg, k: number) => `/api/guardian/file?g=${encodeURIComponent(g)}&m=${m.id}&k=${k}`;
  const digits = (v: string) => v.replace(/[^\d٠-٩]/g, "").slice(0, 4);

  return (
    <div className="chatpage">
      <style>{CHAT_CSS}</style>
      <header style={{ padding: "16px 14px" }}><h1 style={{ fontSize: 24 }}>👨‍👧 ولي الأمر</h1>{state?.name && <p>درجات {state.name.split(" ").slice(0, 2).join(" ")}</p>}</header>
      {!state && !error && <div className="empty">جاري التحميل...</div>}
      {error && <div className="chaterr">⚠️ {error}</div>}
      {state && !state.hasPin && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">هاي الصفحة لولي الأمر بس. ولي الأمر يحط هنا <b>رمز سري من 4 أرقام</b> يعرفه هو بس، والطالب ما يشوفه. بعدها كل درجة توصل هنا، وولي الأمر يفتحها برمزه ويدوس «✅ استلمت». إذا نسيت الرمز، الإدارة تصفّره.</div>
          <label>الرمز</label>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
          <label>اكتب الرمز مرة ثانية</label>
          <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} placeholder="••••" />
          <button type="button" className="btn" disabled={busy || pin.length !== 4 || pin2.length !== 4} onClick={() => void call({ action: "setPin", pin, pin2 }).then((r) => { if (r) { setState({ ...state, hasPin: true }); setG(r.gtoken); setPin(""); setPin2(""); } })}>🔐 احفظ رمزي</button>
        </div></div></div>
      )}
      {state?.hasPin && !g && (
        <div className="wrap"><div className="card"><div className="form">
          <div className="exhint">ولي الأمر يكتب رمزه حتى يشوف الدرجات ويستلمها.</div>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" />
          <button type="button" className="btn" disabled={busy || pin.length !== 4} onClick={() => void call({ action: "open", pin }).then((r) => { if (r) { setG(r.gtoken); setPin(""); } })}>🔓 افتح</button>
        </div></div></div>
      )}
      {g && (
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
