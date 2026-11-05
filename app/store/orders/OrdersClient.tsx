"use client";
// الطلبات: الجديدة للطباعة، والمطبوعة
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Order = {
  id: number; created: string; name: string; curr: string; place: string; area: string; phone1: string; phone2: string; username: string; userId: number;
  items: { name: string; qty: number; price: number }[]; subtotal: number; fee: number; total: number;
};
type Data = { fresh: Order[]; printed: Order[]; notice: string };
const fmt = (n: number) => n.toLocaleString("en-US");

export default function OrdersClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/orders", "🖨 الطلبات");
  const [tab, setTab] = useState<"fresh" | "printed">("fresh");
  const [sel, setSel] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const fresh = data?.fresh ?? [];
  const live = sel.filter((i) => fresh.some((o) => o.id === i));
  const toggle = (id: number) => setSel(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(`📋 انتسخ: ${label}`); } catch { setCopied("ما انتسخ. اضغط مطولاً على النص"); }
  }
  const list = tab === "fresh" ? fresh : data?.printed ?? [];
  return (
    <>
      <AdminHeader title="🖨 الطلبات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="chips adtabs">
              <button type="button" className={tab === "fresh" ? "on" : ""} onClick={() => { setTab("fresh"); setOpen(null); }}>🖨 الجديدة ({fresh.length})</button>
              <button type="button" className={tab === "printed" ? "on" : ""} onClick={() => { setTab("printed"); setOpen(null); }}>🗂 المطبوعة</button>
            </div>
            <div className="card">
              {list.length ? (
                <table className="extable"><tbody>
                  {list.map((o) => (
                    <Rows key={o.id} o={o} fresh={tab === "fresh"} picked={live.includes(o.id)} pick={() => toggle(o.id)} open={open === o.id} setOpen={() => setOpen(open === o.id ? null : o.id)}
                      busy={busy} back={() => void call({ action: "back", id: o.id })} copy={copy} />
                  ))}
                </tbody></table>
              ) : <div className="empty">{tab === "fresh" ? "✅ كل الطلبات مطبوعة." : "لا توجد طلبات مطبوعة بعد."}</div>}
            </div>
            {tab === "fresh" && !!fresh.length && (
              <div className="exline adorderbtns">
                <button type="button" className="exbtn" onClick={() => setSel(live.length === fresh.length ? [] : fresh.map((o) => o.id))}>{live.length === fresh.length ? "⬜️ إلغاء التحديد" : "☑️ تحديد الكل"}</button>
                <button type="button" className="exbtn" disabled={busy || !live.length} onClick={() => void call({ action: "pdf", ids: live })}>🖨 PDF للمحدد ({live.length})</button>
                <button type="button" className="exbtn" disabled={busy || !live.length} onClick={async () => { if (await call({ action: "done", ids: live })) setSel([]); }}>✅ تم الطباعة ({live.length})</button>
              </div>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice || copied} />
    </>
  );
}

function Rows({ o, fresh, picked, pick, open, setOpen, busy, back, copy }: {
  o: Order; fresh: boolean; picked: boolean; pick: () => void; open: boolean; setOpen: () => void; busy: boolean; back: () => void; copy: (l: string, v: string) => void;
}) {
  const items = o.items.map((i) => `${i.name} × ${i.qty}`).join("، ");
  const fields: [string, string][] = [["الاسم", o.name], ["المنهج", o.curr], ["المحافظة", o.place], ["المنطقة", o.area], ["الهاتف 1", o.phone1], ["الهاتف 2", o.phone2], ["المنتجات", items], ["المبلغ الكلي", fmt(o.total)]];
  return (
    <>
      <tr className={"exrow" + (picked || open ? " sel" : "")} onClick={setOpen}>
        {fresh && <td className="adpick" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${o.id}`} checked={picked} onChange={pick} /></td>}
        <td><b>#{o.id} {o.name}</b><small className="pdmode">{o.place} · {o.created}</small></td>
        <td className="p">{fmt(o.total)}</td>
      </tr>
      {open && (
        <tr><td colSpan={fresh ? 3 : 2} className="expanel">
          {fields.map(([l, v]) => (
            <button type="button" key={l} className="adfield" onClick={() => copy(l, v)}><small>{l}</small><span>{v || "—"}</span><i>📋</i></button>
          ))}
          <div className="exhint adtop">مجموع المنتجات {fmt(o.subtotal)} + التوصيل {fmt(o.fee)}{o.username ? ` · @${o.username}` : ""}</div>
          {!fresh && <button type="button" className="exbtn" disabled={busy} onClick={back}>↩️ إرجاع للطلبات الجديدة</button>}
        </td></tr>
      )}
    </>
  );
}
