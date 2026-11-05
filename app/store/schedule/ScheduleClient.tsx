"use client";
// إعدادات جدول الامتحانات: كل المدد بيد الإدارة
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Data = { window: number; perDay: number; gap: number; holidayStart: string; holidayDays: number; blockedHours: number[]; excluded: string[]; schedules: number; notice: string };

export default function ScheduleClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/schedule", "🗓 جدول الامتحانات");
  return (
    <>
      <AdminHeader title="🗓 إعدادات جدول الامتحانات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Form key={JSON.stringify(data)} d={data} busy={busy} save={(b) => void call({ action: "save", ...b })} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Form({ d, busy, save }: { d: Data; busy: boolean; save: (b: Record<string, unknown>) => void }) {
  const [window, setWindow] = useState(String(d.window));
  const [perDay, setPerDay] = useState(String(d.perDay));
  const [gap, setGap] = useState(String(d.gap));
  const [holidayStart, setHolidayStart] = useState(d.holidayStart);
  const [holidayDays, setHolidayDays] = useState(String(d.holidayDays));
  const [excluded, setExcluded] = useState(d.excluded.join("\n"));
  const [blocked, setBlocked] = useState(d.blockedHours);
  return (
    <div className="card">
      <h2>🗓 الجداول المثبتة: {d.schedules}</h2>
      <div className="form">
        <label>وقت الدخول بعد بداية الامتحان (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={window} onChange={(e) => setWindow(e.target.value)} />
        <label>أكثر عدد امتحانات باليوم</label>
        <input className="ltr" inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        <label>الفاصل بين امتحانين بنفس اليوم (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value)} />
        <label>بداية عطلة نصف السنة</label>
        <input type="date" className="ltr" value={holidayStart} onChange={(e) => setHolidayStart(e.target.value)} />
        <label>عدد أيام العطلة</label>
        <input className="ltr" inputMode="numeric" value={holidayDays} onChange={(e) => setHolidayDays(e.target.value)} />
        <label>أيام مستثناة من كل الجداول (كل يوم بسطر، مثل 2027-03-21)</label>
        <textarea className="pdtext ltr" rows={3} value={excluded} onChange={(e) => setExcluded(e.target.value)} />
        <label>ساعات ممنوعة</label>
        <div className="chips adflat">
          {Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 6).map((h) => (
            <button type="button" key={h} className={blocked.includes(h) ? "on" : ""} onClick={() => setBlocked(blocked.includes(h) ? blocked.filter((x) => x !== h) : [...blocked, h])}>{String(h).padStart(2, "0")}:00</button>
          ))}
        </div>
        <div className="exhint">⚠️ إذا غيرت العطلة أو الأيام المستثناة، جداول الطلاب تنعاد من باجر، وكل طالب يوصله الخبر.</div>
        <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => save({ window, perDay, gap, holidayStart, holidayDays, excluded, blockedHours: blocked })}>حفظ</button>
      </div>
    </div>
  );
}
