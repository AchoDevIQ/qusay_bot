"use client";
// إعدادات جدول الامتحانات: كل المدد بيد الإدارة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Slot = { d: number; t: string };
type Row = { exam: number; chapter: string; title: string; date: string; versions: Record<string, number>; models: { id: number; model: string }[] };
type Data = { window: number; extra: number; excWindow: number; perDay: number; gap: number; holidayStart: string; holidayDays: number; blockedHours: number[]; excluded: string[]; places: { id: number; name: string }[]; center: number; slots: Slot[]; students: number; rows: Row[]; canLoad: boolean; canLoadDates: boolean; week: { i: number; name: string }[]; schedules: number; notice: string };
type Act = (b: Record<string, unknown>) => Promise<Data | null>;

export default function ScheduleClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/schedule", "🗓 جدول الامتحانات");
  const act: Act = (b) => call({ center: data?.center ?? 0, ...b });
  return (
    <>
      <AdminHeader title="🗓 إعدادات جدول الامتحانات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Place d={data} busy={busy} act={act} />}
        {data && <Form key={JSON.stringify([data.window, data.extra, data.excWindow, data.perDay, data.gap, data.holidayStart, data.holidayDays, data.blockedHours, data.excluded])} d={data} busy={busy} save={(b) => void act({ action: "save", ...b })} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Form({ d, busy, save }: { d: Data; busy: boolean; save: (b: Record<string, unknown>) => void }) {
  const [window, setWindow] = useState(String(d.window));
  const [extra, setExtra] = useState(String(d.extra));
  const [excWindow, setExcWindow] = useState(String(d.excWindow));
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
        <label>وقت إضافي للطالب الإلكتروني فوق وقت الامتحان (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <label>وقت الدخول بعد ما تفتح امتحان باستثناء (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={excWindow} onChange={(e) => setExcWindow(e.target.value)} />
        <label>أكثر عدد امتحانات باليوم بالجدول الخاص</label>
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
        <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => save({ window, extra, excWindow, perDay, gap, holidayStart, holidayDays, excluded, blockedHours: blocked })}>حفظ</button>
      </div>
    </div>
  );
}

function Place({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  return (
    <div className="card">
      <h2>👥 الجدول العام (ويا الطلاب)</h2>
      <div className="form">
        {d.canLoad && <button type="button" className="btn agbtn" disabled={busy} onClick={() => void act({ action: "loadPlaces" })}>📥 أدخل أوقات الأماكن والعطلة</button>}
        {d.canLoadDates && <Confirm label="📥 أدخل تواريخ كل الامتحانات" disabled={busy || d.canLoad} onYes={() => void act({ action: "loadOldDates" })} />}
        <label>المكان</label>
        <select value={d.center} disabled={busy} onChange={(e) => void act({ action: "list", center: Number(e.target.value) })}>
          {d.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="exhint">{d.students} طالب ويا الطلاب بهذا المكان. كل طالب يختار وقت لكل يوم بكيفه.</div>
        <Slots key={`${d.center}|${JSON.stringify(d.slots)}`} d={d} busy={busy} act={act} />
        <Dates key={`${d.center}|${JSON.stringify(d.rows)}|${JSON.stringify(d.slots)}`} d={d} busy={busy} act={act} />
      </div>
    </div>
  );
}

function Slots({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  const [slots, setSlots] = useState(d.slots);
  return (
    <div className="exfoot">
      <div className="exlabel">⏰ الأيام وأوقاتها</div>
      {slots.map((x, i) => (
        <div className="exadd" key={i}>
          <select aria-label="اليوم" value={x.d} onChange={(e) => setSlots(slots.map((y, j) => (j === i ? { ...y, d: Number(e.target.value) } : y)))}>{d.week.map((w) => <option key={w.i} value={w.i}>{w.name}</option>)}</select>
          <input type="time" className="ltr" aria-label="الوقت" value={x.t} onChange={(e) => setSlots(slots.map((y, j) => (j === i ? { ...y, t: e.target.value } : y)))} />
          <button type="button" className="exbtn" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>🗑</button>
        </div>
      ))}
      <div className="exline">
        <button type="button" className="exbtn" onClick={() => setSlots([...slots, { d: slots.at(-1)?.d ?? d.week[0].i, t: slots.at(-1)?.t ?? "16:00" }])}>➕ وقت</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "saveSlots", slots })}>حفظ الأوقات</button>
      </div>
    </div>
  );
}

function Dates({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  const [rows, setRows] = useState(d.rows);
  const [start, setStart] = useState("");
  const chapters = [...new Set(rows.map((r) => r.chapter))];
  const set = (exam: number, o: Partial<Row>) => setRows(rows.map((r) => (r.exam === exam ? { ...r, ...o } : r)));
  const timesOf = (date: string) => { if (!date) return []; const w = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7; return d.slots.filter((x) => x.d === w).map((x) => x.t).sort(); };
  const allTimes = [...new Set(d.slots.map((x) => x.t))].sort();
  // نسخة وحدة لكل الفصل بهذا الوقت، وتتبدل بأي وقت
  const fill = (chapter: string, time: string, model: string) => setRows(rows.map((r) => {
    if (r.chapter !== chapter) return r;
    const id = r.models.find((m) => m.model === model)?.id;
    const versions = { ...r.versions };
    if (id) versions[time] = id; else delete versions[time];
    return { ...r, versions };
  }));
  return (
    <div className="exfoot">
      <div className="exlabel">🗓 وزع امتحانات الكتاب بالترتيب من تاريخ</div>
      <div className="exadd">
        <input type="date" className="ltr" aria-label="تاريخ البداية" value={start} onChange={(e) => setStart(e.target.value)} />
        <Confirm label="🗓 وزعها" disabled={busy || !start} onYes={() => void act({ action: "fillDates", start })} />
      </div>
      <div className="exhint">كل يوم من أيام المكان ياخذ امتحان، وتتخطى العطلة. بعدها تگدر تغير أي تاريخ أو نسخة.</div>
      {chapters.map((c) => (
        <div key={c}>
          <div className="adgroup">{c}</div>
          <ChapterFill chapter={c} times={allTimes} models={[...new Set(rows.filter((r) => r.chapter === c).flatMap((r) => r.models.map((m) => m.model)))].sort()} fill={fill} />
          {rows.filter((r) => r.chapter === c).map((r) => (
            <div className="adexamrow" key={r.exam}>
              <b>{r.title}</b>
              <div className="adexamcells">
                <input type="date" className="ltr" aria-label={`تاريخ ${r.title}`} value={r.date} onChange={(e) => set(r.exam, { date: e.target.value })} />
                {timesOf(r.date).map((t) => (
                  <label className="adtimev" key={t}><small>{t}</small>
                    <select aria-label={`نسخة ${r.title} الساعة ${t}`} value={r.versions[t] ?? 0} onChange={(e) => set(r.exam, { versions: { ...r.versions, [t]: Number(e.target.value) } })}>
                      <option value={0}>أول نسخة جاهزة</option>
                      {r.models.map((m) => <option key={m.id} value={m.id}>نسخة {m.model}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void act({ action: "saveDates", rows: rows.map((r) => ({ exam: r.exam, date: r.date, versions: r.versions })) })}>حفظ المواعيد والنسخ</button>
    </div>
  );
}

function ChapterFill({ chapter, times, models, fill }: { chapter: string; times: string[]; models: string[]; fill: (c: string, t: string, m: string) => void }) {
  const [time, setTime] = useState(times[0] ?? "");
  if (!times.length || !models.length) return null;
  return (
    <div className="exline">
      <span className="exhint">نسخة لكل الفصل:</span>
      <select className="exnum" aria-label={`وقت ${chapter}`} value={time} onChange={(e) => setTime(e.target.value)}>{times.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      <select className="exnum" aria-label={`نسخة ${chapter}`} value="" onChange={(e) => { if (e.target.value) fill(chapter, time, e.target.value === "-" ? "" : e.target.value); }}>
        <option value="">اختار</option><option value="-">أول جاهزة</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}
