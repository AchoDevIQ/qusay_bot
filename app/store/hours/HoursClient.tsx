"use client";
// أوقات استقبال الأسئلة وحالة مجموعتها
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Data = { on: boolean; days: number[]; from: string; to: string; week: { i: number; name: string }[]; group: boolean };

export default function HoursClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/hours", "⏰ أوقات الأسئلة");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <AdminHeader title="⏰ أوقات الأسئلة ومجموعتها" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Form key={JSON.stringify(data)} data={data} busy={busy} onSave={async (b) => setSaved(!!await call({ action: "save", ...b }))} onEdit={() => setSaved(false)} />}
        {data && (
          <div className="card">
            <h2>🔗 مجموعة الأسئلة</h2>
            <div className="form">
              <div className={data.group ? "fdok" : "exbad"}>{data.group ? "✅ المجموعة مربوطة" : "⚠️ المجموعة مو مربوطة بعد"}</div>
              <ol className="adsteps">
                <li>سوي مجموعة تليجرام جديدة.</li>
                <li>من إعدادات المجموعة فعل Topics (المواضيع).</li>
                <li>ضيف البوت للمجموعة وخليه Admin ويه صلاحية Manage Topics.</li>
                <li>داخل المجموعة اكتب: <code>/setgroup</code></li>
              </ol>
            </div>
          </div>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={saved ? "✅ انحفظت الأوقات" : ""} />
    </>
  );
}

function Form({ data, busy, onSave, onEdit }: { data: Data; busy: boolean; onSave: (b: Record<string, unknown>) => void; onEdit: () => void }) {
  const [on, setOn] = useState(data.on);
  const [days, setDays] = useState(data.days);
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  return (
    <div className="card">
      <h2>⏰ استقبال الأسئلة</h2>
      <div className="form">
        <label className="adcheck adflat">
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); onEdit(); }} />
          <span>{on ? "🟢 الاستقبال شغال" : "🔴 الاستقبال متوقف"}</span>
        </label>
        <label>الأيام</label>
        <div className="chips adtabs">
          {data.week.map((d) => (
            <button type="button" key={d.i} className={days.includes(d.i) ? "on" : ""} onClick={() => { setDays(days.includes(d.i) ? days.filter((x) => x !== d.i) : [...days, d.i]); onEdit(); }}>{d.name}</button>
          ))}
        </div>
        <div className="adtwo">
          <div><label>من الساعة</label><input type="time" value={from} onChange={(e) => { setFrom(e.target.value); onEdit(); }} /></div>
          <div><label>إلى الساعة</label><input type="time" value={to} onChange={(e) => { setTo(e.target.value); onEdit(); }} /></div>
        </div>
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy} onClick={() => onSave({ on, days, from, to })}>حفظ</button>
        </div>
      </div>
    </div>
  );
}
