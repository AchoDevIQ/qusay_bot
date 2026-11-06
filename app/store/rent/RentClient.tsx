"use client";
// المراكز: مدير كل مركز يوصله تقرير الحضور بعد كل امتحان. وبالشهر: كل طالب حضر ولو مرة × سعر المركز،
// والتقرير الشهري PDF يوصلك ويوصل للمدير، ومن تدفع ينسجل الاستلام باليوم والساعة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Center = { id: number; name: string; managers: number[]; price: number; students: number; boys: number; girls: number; amount: number; paid: { id: number; students: number; amount: number; created: string }[] };
type Data = { month: string; months: string[]; centers: Center[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function RentClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/rent", "🏢 المراكز: الحضور والإيجار");
  return (
    <>
      <AdminHeader title="🏢 المراكز: الحضور والإيجار" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">
              بعد كل امتحان بالمركز يوصل تقرير الحضور لمدير المركز وإلك. وبالشهر كل طالب حضر ولو مرة ينحسب، والمبلغ = عدد الطلاب × سعر المركز.
              التقرير الشهري PDF يوصلك ويوصل للمدير، ومن تدفع ينسجل الاستلام باليوم والساعة ويوصله خبر.
            </div>
            <div className="seg wrap2">
              {data.months.map((m) => <button type="button" key={m} className={m === data.month ? "on" : ""} disabled={busy} onClick={() => void call({ action: "list", month: m })}>{m}</button>)}
            </div>
            {!data.centers.length && <div className="empty">ماكو مراكز.</div>}
            {data.centers.map((c) => <CenterCard key={`${c.id}|${c.managers.join()}|${c.price}|${data.month}`} c={c} month={data.month} busy={busy} call={call} />)}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function CenterCard({ c, month, busy, call }: { c: Center; month: string; busy: boolean; call: Call }) {
  const [managers, setManagers] = useState(c.managers.join(" "));
  const [price, setPrice] = useState(String(c.price));
  const changed = managers.trim() !== c.managers.join(" ") || price !== String(c.price);
  return (
    <div className="card">
      <h2>🏫 {c.name}</h2>
      <div className="expad">
        <div className="adstats adstats2">
          <div><b>{c.students}</b>طالب حضر بالشهر</div>
          <div><b>{c.boys} · {c.girls}</b>بنين · بنات</div>
          <div><b>{fmt(c.price)}</b>سعر الطالب</div>
          <div><b>{fmt(c.amount)}</b>المبلغ (دينار)</div>
        </div>
        <div className="atrow">
          <button type="button" className="exbtn" disabled={busy || !c.students} onClick={() => void call({ action: "report", center: c.id, month })}>📄 التقرير الشهري PDF</button>
          {c.students > 0 && c.price > 0 && <Confirm label={`💵 دفع ${fmt(c.amount)} وتسجيل الاستلام`} disabled={busy} onYes={() => void call({ action: "pay", center: c.id, month })} />}
        </div>
        {!!c.paid.length && <div className="exhint adtop">{c.paid.map((p) => `✅ اندفع ${fmt(p.amount)} عن ${p.students} طالب، ${p.created.slice(0, 10)} الساعة ${p.created.slice(11, 16)}`).join(" · ")}</div>}
        <details className="sttopics adtop">
          <summary>⚙️ المدير والسعر {c.managers.length ? `(${c.managers.length} مدير)` : "(ماكو مدير)"}</summary>
          <label className="stfield">رقم حساب المدير بالتليجرام (إذا أكثر من واحد افصل بمسافة)
            <input className="ltr" inputMode="numeric" value={managers} onChange={(e) => setManagers(e.target.value.replace(/[^\d\s,]/g, ""))} />
          </label>
          <div className="exhint">المدير يفتح البوت ويكتب <code>/myid</code> وينطيك الرقم. لازم يكون فاتح البوت حتى توصله الرسائل.</div>
          <label className="stfield">سعر الطالب بالشهر (دينار)
            <input className="ltr" type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <button type="button" className="btn adsmallbtn" disabled={busy || !changed} onClick={() => void call({ action: "save", center: c.id, managers, price: Number(price) || 0, month })}>💾 حفظ</button>
        </details>
      </div>
    </div>
  );
}
