"use client";
// بيع بالمكتب وسجل مبيعاته
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Sale = { id: number; time: string; name: string; total: number; seller: string; items: string };
type St = { id: number; name: string; phone: string; gov: string };
type Data = {
  today: string; day: string; prev: string; next: string | null; total: number; sales: Sale[]; sellers: { name: string; total: number }[];
  days: { day: string; n: number; total: number }[]; results: St[]; catalog: { name: string; items: { id: number; name: string; price: number }[] }[]; notice: string; soldId?: number;
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function SalesClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/sales", "🏪 بيع ومبيعات المكتب");
  const [tab, setTab] = useState<"sell" | "log">("sell");
  const day = data?.day;
  const act: Call = (b) => call({ day, ...b });
  return (
    <>
      <AdminHeader title="🏪 بيع ومبيعات المكتب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="chips adtabs">
              <button type="button" className={tab === "sell" ? "on" : ""} onClick={() => setTab("sell")}>🏪 بيع جديد</button>
              <button type="button" className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>📊 المبيعات</button>
            </div>
            {tab === "sell" ? <Sell data={data} busy={busy} call={act} /> : <Log data={data} busy={busy} call={act} />}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Sell({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<St | null>(null);
  const [cart, setCart] = useState<Record<number, number>>({});
  const all = data.catalog.flatMap((c) => c.items);
  const lines = Object.entries(cart).map(([id, n]) => ({ id: Number(id), n, p: all.find((x) => x.id === Number(id)) })).filter((x) => x.p);
  const total = lines.reduce((s, x) => s + x.p!.price * x.n, 0);
  const chg = (id: number, d: number) => setCart((c) => {
    const n = Math.max(0, (c[id] ?? 0) + d);
    const next = { ...c };
    if (n) next[id] = n; else delete next[id];
    return next;
  });
  if (!st) {
    return (
      <>
        <form className="exadd adsearch" onSubmit={(e) => { e.preventDefault(); void call({ action: "list", q }); }}>
          <input placeholder="🔍 اسم الطالب أو رقم هاتفه" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="exbtn" disabled={busy || !q.trim()}>بحث</button>
        </form>
        {data.results.map((s) => (
          <button type="button" key={s.id} className="adfield" onClick={() => { setSt(s); setCart({}); }}><small>👤</small><span>{s.name}</span><i>{s.phone}</i></button>
        ))}
        <div className="exhint">الطالب لازم يكون مسجل بالبوت حتى يوصله الوصل.</div>
      </>
    );
  }
  return (
    <>
      <div className="card">
        <h2>👤 {st.name}</h2>
        <div className="who">📞 {st.phone} · {st.gov} <button type="button" className="exbtn" onClick={() => setSt(null)}>تغيير الطالب</button></div>
      </div>
      {data.catalog.map((c) => (
        <div className="card" key={c.name}>
          <h2>📂 {c.name}</h2>
          <table><tbody>
            {c.items.map((p) => (
              <tr key={p.id} className={cart[p.id] ? "sel" : ""}>
                <td>{p.name}</td><td className="p">{fmt(p.price)}</td>
                <td className="q"><span className="qty">
                  <button type="button" onClick={() => chg(p.id, -1)}>−</button>
                  <b>{cart[p.id] ?? 0}</b>
                  <button type="button" className="add" onClick={() => chg(p.id, 1)}>+</button>
                </span></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ))}
      <div className="card expad adform">
        <div>💰 المجموع بدون توصيل: <b className="adcode">{fmt(total)}</b></div>
        <button type="button" className="btn" disabled={busy || !lines.length} onClick={async () => {
          if (await call({ action: "sale", sid: st.id, items: lines.map((x) => [x.id, x.n]) })) { setSt(null); setCart({}); setQ(""); }
        }}>✅ تم البيع</button>
      </div>
    </>
  );
}

function Log({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [showDays, setShowDays] = useState(false);
  return (
    <>
      <div className="card">
        <h2>📊 {data.day}{data.day === data.today ? " (اليوم)" : ""}</h2>
        <div className="exline expad adtop">
          <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "list", day: data.prev })}>◀️ السابق</button>
          {data.next && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "list", day: data.next })}>التالي ▶️</button>}
          <button type="button" className="exbtn" onClick={() => setShowDays(!showDays)}>📅 كل الأيام</button>
          <button type="button" className="exbtn" disabled={busy || !data.sales.length} onClick={() => void call({ action: "pdf", day: data.day })}>📄 PDF</button>
        </div>
        {showDays && (
          <div className="expad">
            {data.days.map((d) => (
              <button type="button" key={d.day} className="adfield" onClick={() => { setShowDays(false); void call({ action: "list", day: d.day }); }}><small>{d.n} بيعة</small><span>{d.day}</span><i>{fmt(d.total)}</i></button>
            ))}
            {!data.days.length && <div className="exhint">ما أكو مبيعات بعد.</div>}
          </div>
        )}
        <div className="adstats adstats2 adnopadtop">
          <div><b>{data.sales.length}</b>عدد المبيعات</div><div><b>{fmt(data.total)}</b>المجموع</div>
        </div>
        {!!data.sellers.length && <div className="expad exhint adtop">حسب البائع: {data.sellers.map((s) => `${s.name}: ${fmt(s.total)}`).join(" · ")}</div>}
        {data.sales.length ? (
          <table className="extable"><tbody>
            {data.sales.map((s) => (
              <tr key={s.id}>
                <td><b>#{s.id} {s.name}</b><small className="pdmode">{s.time} · {s.seller}<br />{s.items}</small></td>
                <td className="p">{fmt(s.total)}
                  <div className="adreceipts">
                    <button type="button" aria-label="وصل ملون" className="exbtn" disabled={busy} onClick={() => void call({ action: "receipt", id: s.id, kind: "color" })}>🖼</button>
                    <button type="button" aria-label="وصل للطباعة" className="exbtn" disabled={busy} onClick={() => void call({ action: "receipt", id: s.id, kind: "paper" })}>🖨</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="empty">ما أكو مبيعات بهذا اليوم.</div>}
      </div>
    </>
  );
}
