"use client";
// 🧾 مشترياتي (طلبه 2026-11-26): كل اللي اشتراه محفوظ هنا: من المكتبة ومن متجر البوت، كل وحدة ببطاقة بإطار ذهبي،
// ويا «🖼 الوصل الملون» نفس اللي وصله وقت الشراء. وفوگ: شنو عنده هسه (الفصول المفتوحة). وإلغاء الطلب اللي بعده ما تجهز
import { useEffect, useState } from "react";
import { deviceId } from "../shared";

type O = { id: number; at: string; items: { name: string; qty: number }[]; total: number; status: string; cancel: boolean; receipt?: boolean; where?: string };

export default function MyOrdersClient() {
  const [list, setList] = useState<O[] | null>(null);
  const [owned, setOwned] = useState<string[]>([]);
  const [ask, setAsk] = useState(0);
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function post(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/my", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URLSearchParams(location.search).get("t") ?? "", device: await deviceId(), ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); setAsk(0); }
  }
  async function call(body: Record<string, unknown>) {
    const j = await post(body);
    if (j) { setList(j.list); setOwned(j.owned ?? []); setNotice(j.notice ?? ""); }
  }
  useEffect(() => { void call({ action: "orders" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (list ?? []).filter((o) => !o.status.startsWith("❌")).reduce((s, o) => s + o.total, 0);
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>🧾 مشترياتي</h1></header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {notice && <div className="card"><div className="form"><div className="exhint">{notice}</div></div></div>}
        {!list && !error && <div className="empty">جاري التحميل...</div>}
        {owned.length > 0 && (
          <div className="card mo-card"><div className="form">
            <b>📚 اللي عندك هسه</b>
            <div className="mo-owned">{owned.map((c) => <span key={c}>✅ {c}</span>)}</div>
          </div></div>
        )}
        {list && !list.length && <div className="empty">ماكو مشتريات بعد. تگدر تشتري من 🛒 المتجر أو من المكتبة.</div>}
        {list && list.length > 0 && <div className="exhint mo-sum">كل مشترياتك: {list.length} · المجموع {sum.toLocaleString("en-US")} د.ع</div>}
        {list?.map((o) => (
          <div key={o.id} className="card mo-card"><div className="form">
            <div className="exline"><b>#{o.id}</b><span>{o.status}{o.where ? ` · ${o.where}` : ""}</span></div>
            <div className="exhint">📅 {o.at}</div>
            {o.items.map((i, k) => <div key={k}>• {i.name}{i.qty > 1 ? ` × ${i.qty}` : ""}</div>)}
            <div className="mo-total">💰 المجموع: {o.total.toLocaleString("en-US")} د.ع</div>
            {o.receipt && <button type="button" className="btn ghost" disabled={busy} onClick={async () => { const j = await post({ action: "receipt", id: o.id }); if (j?.img) setImg(j.img); }}>🖼 الوصل الملون</button>}
            {o.cancel && (ask === o.id
              ? <div className="seg"><button type="button" className="on" disabled={busy} onClick={() => void call({ action: "cancel", id: o.id })}>✅ إي، ألغيه</button><button type="button" onClick={() => setAsk(0)}>↩️ لا، خليه</button></div>
              : <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsk(o.id)}>❌ ألغي الطلب</button>)}
          </div></div>
        ))}
      </div>
      {img && (
        <div className="mo-view" onClick={() => setImg(null)}>
          <img src={img} alt="الوصل" />
          <button type="button" className="btn">✖ سد</button>
        </div>
      )}
      <style>{`
.mo-card{border:2px solid #F6C94A;box-shadow:0 0 0 3px rgba(246,201,74,.15)}
.mo-owned{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.mo-owned span{background:rgba(246,201,74,.14);color:#F6C94A;border-radius:10px;padding:4px 10px;font-weight:700}
.mo-total{font-weight:800;color:#F6C94A;margin-top:4px}
.mo-sum{text-align:center;margin:6px 0}
.mo-view{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
.mo-view img{max-width:100%;max-height:80vh;border-radius:12px}
`}</style>
    </>
  );
}
