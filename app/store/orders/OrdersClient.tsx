"use client";
// الطلبات: حساب شركة التوصيل، الجديدة للطباعة، والمطبوعة
import { useState } from "react";
import { addParts, partsLine, priceReport, type MoneyParts, type PriceLine } from "../../../lib/orderRules.ts";
import { AdminHeader, Confirm, MoneyBreakdown, PriceReport, StatusBar, useAdminApi } from "../adminPage";

type Order = {
  id: number; created: string; name: string; curr: string; place: string; area: string; phone1: string; phone2: string; username: string; userId: number;
  items: { name: string; qty: number; price: number }[]; subtotal: number; fee: number; total: number; printedBy: string; settled: boolean;
};
type Company = { open: { id: number; total: number; fee: number; parts: MoneyParts; items: { name: string; qty: number; price: number }[] }[]; archive: { id: number; from: number; to: number; n: number; gross: number; fees: number; net: number; created: string; parts: MoneyParts | null }[] };
type Data = { fresh: Order[]; printed: Order[]; owner: boolean; company: Company | null; notice: string; allPrices?: PriceLine[] | null };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function OrdersClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/orders", "🖨 الطلبات");
  const [tab, setTab] = useState<"fresh" | "printed">("fresh");
  const [sel, setSel] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const fresh = data?.fresh ?? [];
  const list = tab === "fresh" ? fresh : data?.printed ?? [];
  const live = sel.filter((i) => list.some((o) => o.id === i));
  const toggle = (id: number) => setSel(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(`📋 انتسخ: ${label}`); } catch { setCopied("ما انتسخ. اضغط مطولاً على النص"); }
  }
  const pickTab = (t: "fresh" | "printed") => { setTab(t); setOpen(null); setSel([]); };
  return (
    <>
      <AdminHeader title="🖨 طلبات التوصيل" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            {data.company && <CompanyCard c={data.company} all={data.allPrices ?? null} busy={busy} call={call} />}
            <div className="chips adtabs">
              <button type="button" className={tab === "fresh" ? "on" : ""} onClick={() => pickTab("fresh")}>🖨 الجديدة ({fresh.length})</button>
              <button type="button" className={tab === "printed" ? "on" : ""} onClick={() => pickTab("printed")}>🗂 {data.owner ? "المطبوعة" : "اللي طبعتها"}</button>
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
            {!!list.length && (
              <div className="exline adorderbtns">
                <button type="button" className="exbtn" onClick={() => setSel(live.length === list.length ? [] : list.map((o) => o.id))}>{live.length === list.length ? "⬜️ إلغاء التحديد" : "☑️ تحديد الكل"}</button>
                {tab === "fresh" ? (
                  <>
                    <button type="button" className="exbtn" disabled={busy || !live.length} onClick={() => void call({ action: "pdf", ids: live })}>🖨 PDF للمحدد ({live.length})</button>
                    <button type="button" className="exbtn" disabled={busy || !live.length} onClick={async () => { if (await call({ action: "done", ids: live })) setSel([]); }}>✅ تم الطباعة ({live.length})</button>
                  </>
                ) : <button type="button" className="exbtn" disabled={busy || !live.length} onClick={() => void call({ action: "reprint", ids: live })}>🖨 إعادة طباعة المحدد ({live.length})</button>}
              </div>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice || copied} />
    </>
  );
}

function CompanyCard({ c, all, busy, call }: { c: Company; all: PriceLine[] | null; busy: boolean; call: Call }) {
  const first = c.open[0]?.id, last = c.open.at(-1)?.id;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [show, setShow] = useState(false);
  const a = Number(from || first), b = Number(to || last);
  const rows = c.open.filter((o) => o.id >= a && o.id <= b);
  const gross = rows.reduce((s, o) => s + o.total, 0), fees = rows.reduce((s, o) => s + o.fee, 0), net = gross - fees;
  return (
    <div className="card">
      <h2>💰 حساب شركة التوصيل</h2>
      {c.open.length ? (
        <div className="expad adtop">
          <div className="who adnopad">غير محاسب: من وصل <b>#{first}</b> إلى وصل <b>#{last}</b> ({c.open.length} طلب)</div>
          <div className="adtwo">
            <div><label>من وصل</label><input className="ltr" inputMode="numeric" placeholder={String(first)} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label>إلى وصل</label><input className="ltr" inputMode="numeric" placeholder={String(last)} value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="adstats adnopadtop adcompany">
            <div><b>{fmt(gross)}</b>المبلغ الكلي ({rows.length})</div>
            <div><b>{fmt(fees)}</b>توصيل (للشركة)</div>
            <div className="adnet"><b>{fmt(net)}</b>لازم يعطوك</div>
          </div>
          <MoneyBreakdown parts={addParts(rows.map((o) => o.parts))} title="اللي لازم يعطوك مقسم (بدون التوصيل)" />
          <PriceReport lines={priceReport(rows.map((o) => o.items))} title="هذا المدى حسب السعر" />
          <Confirm label={`✅ تم الحساب، استلمت ${fmt(net)}`} disabled={busy || !rows.length} onYes={async () => { if (await call({ action: "settle", from: a, to: b, net })) { setFrom(""); setTo(""); } }} />
        </div>
      ) : <div className="empty">✅ ماكو طلبات غير محاسب عليها ويا الشركة.</div>}
      <div className="expad">
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "allPrices" })}>💵 كل طلبات التوصيل حسب السعر</button>
        {all && (all.length ? <div className="adtop"><PriceReport lines={all} title="كل الطلبات اللي انسلمت للشركة" open /></div> : <div className="exhint adtop">ماكو طلبات مطبوعة بعد.</div>)}
      </div>
      {!!c.archive.length && (
        <div className="expad">
          <button type="button" className="exbtn" onClick={() => setShow(!show)}>🗂 الحسابات السابقة ({c.archive.length})</button>
          {show && c.archive.map((s) => <div key={s.id} className="adsale"><b>#{s.from} إلى #{s.to}</b> — استلمت {fmt(s.net)}<small>{s.created} · {s.n} طلب · الكلي {fmt(s.gross)} · التوصيل {fmt(s.fees)}{s.parts ? ` · ${partsLine(s.parts)}` : ""}</small></div>)}
        </div>
      )}
    </div>
  );
}

function Rows({ o, fresh, picked, pick, open, setOpen, busy, back, copy }: {
  o: Order; fresh: boolean; picked: boolean; pick: () => void; open: boolean; setOpen: () => void; busy: boolean; back: () => void; copy: (l: string, v: string) => void;
}) {
  const items = o.items.map((i) => `${i.name} × ${i.qty}`).join("، ");
  const fields: [string, string][] = [["الاسم", o.name], ["المنهج", o.curr], ["المحافظة", o.place], ["المنطقة", o.area], ["الهاتف 1", o.phone1], ["الهاتف 2", o.phone2], ["المنتجات", items], ["المبلغ الكلي", fmt(o.total)]];
  const en = o.curr === "إنجليزي";
  return (
    <>
      <tr className={"exrow" + (picked || open ? " sel" : "") + (en ? " adenrow" : "")} onClick={setOpen}>
        <td className="adpick" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${o.id}`} checked={picked} onChange={pick} /></td>
        <td><b>#{o.id} {o.name}</b>{en && <span className="adentag">ENGLISH</span>}<small className="pdmode">{o.place} · {o.created}{o.printedBy ? ` · طبعه: ${o.printedBy}` : ""}</small></td>
        <td className="p">{fmt(o.total)}</td>
      </tr>
      {open && (
        <tr><td colSpan={3} className="expanel">
          <button type="button" className="btn agbtn" onClick={() => copy("الطلب كله", fields.map(([l, v]) => `${l}: ${v}`).join("\n"))}>📋 نسخ الكل</button>
          {fields.map(([l, v]) => (
            <button type="button" key={l} className="adfield" onClick={() => copy(l, v)}><small>{l}</small><span>{v || "—"}</span><i>📋</i></button>
          ))}
          <div className="exhint adtop">مجموع المنتجات {fmt(o.subtotal)} + التوصيل {fmt(o.fee)}{o.username ? ` · @${o.username}` : ""}</div>
          {!fresh && !o.settled && <button type="button" className="exbtn" disabled={busy} onClick={back}>↩️ إرجاع للطلبات الجديدة</button>}
        </td></tr>
      )}
    </>
  );
}
