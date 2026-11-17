"use client";
// 📦 طلباتي: طلبات متجر البوت وحالتها، وإلغاء الطلب اللي بعده ما تجهز
import { useEffect, useState } from "react";
import { deviceId } from "../shared";

type O = { id: number; at: string; items: { name: string; qty: number }[]; total: number; status: string; cancel: boolean };

export default function MyOrdersClient() {
  const [list, setList] = useState<O[] | null>(null);
  const [ask, setAsk] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function call(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/my", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URLSearchParams(location.search).get("t") ?? "", device: await deviceId(), ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return; }
      setList(j.list); setNotice(j.notice ?? "");
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); setAsk(0); }
  }
  useEffect(() => { void call({ action: "orders" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>📦 طلباتي</h1></header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {notice && <div className="card"><div className="form"><div className="exhint">{notice}</div></div></div>}
        {!list && !error && <div className="empty">جاري التحميل...</div>}
        {list && !list.length && <div className="empty">ماكو طلبات بعد. تگدر تطلب من 🛒 المتجر.</div>}
        {list?.map((o) => (
          <div key={o.id} className="card"><div className="form">
            <div className="exline"><b>طلب #{o.id}</b><span>{o.status}</span></div>
            <div className="exhint">{o.at}</div>
            {o.items.map((i, k) => <div key={k}>• {i.name}{i.qty > 1 ? ` × ${i.qty}` : ""}</div>)}
            <div><b>المجموع: {o.total.toLocaleString("en-US")} د.ع</b></div>
            {o.cancel && (ask === o.id
              ? <div className="seg"><button type="button" className="on" disabled={busy} onClick={() => void call({ action: "cancel", id: o.id })}>✅ إي، ألغيه</button><button type="button" onClick={() => setAsk(0)}>↩️ لا، خليه</button></div>
              : <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsk(o.id)}>❌ ألغي الطلب</button>)}
          </div></div>
        ))}
      </div>
    </>
  );
}
