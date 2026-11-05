"use client";
// إعدادات جدول الامتحانات: كل المدد بيد الإدارة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Data = { window: number; perDay: number; gap: number; holidayStart: string; holidayDays: number; blockedHours: number[]; excluded: string[]; places: { id: number; name: string }[]; groups: G[]; detail: Detail | null; canLoadCenters: boolean; week: { i: number; name: string }[]; schedules: number; notice: string };
type G = { id: number; center: number; name: string; hour: number; gender: string; label: string; students: number };
type Row = { exam: number; chapter: string; title: string; date: string; time: string; version: number; versions: { id: number; model: string }[] };
type Detail = { id: number; name: string; hour: number; gender: string; slots: { d: number; t: string }[]; rows: Row[] };
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function ScheduleClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/schedule", "🗓 جدول الامتحانات");
  const [open, setOpen] = useState(0);
  const act = (b: Record<string, unknown>) => call({ open, ...b });
  return (
    <>
      <AdminHeader title="🗓 إعدادات جدول الامتحانات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Groups d={data} busy={busy} open={open} setOpen={(id) => { setOpen(id); void call({ action: "list", open: id }); }} act={act} />}
        {data && <Form key={JSON.stringify({ ...data, groups: 0, places: 0, detail: 0, notice: 0 })} d={data} busy={busy} save={(b) => void act({ action: "save", ...b })} />}
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

function Groups({ d, busy, open, setOpen, act }: { d: Data; busy: boolean; open: number; setOpen: (id: number) => void; act: (b: Record<string, unknown>) => Promise<Data | null> }) {
  const [center, setCenter] = useState(0);
  const [hour, setHour] = useState("20");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const list = d.groups.filter((g) => g.center === center);
  return (
    <div className="card">
      <h2>👥 مجاميع الطلاب المنتظمين</h2>
      <div className="form">
        <div className="exhint">الطالب يختار ويا الطلاب لو جدول خاص. إذا ويا الطلاب، يختار وحدة من مجاميع مكانه، وتطلعله مواعيدها اللي تكتبها هنا.</div>
        {d.canLoadCenters && <button type="button" className="btn agbtn" disabled={busy} onClick={() => void act({ action: "loadCenterGroups" })}>📥 أدخل مجاميع المراكز (زيونة، البنوك، الصليخ، المنصور)</button>}
        <label>المكان</label>
        <select value={center} onChange={(e) => { setCenter(Number(e.target.value)); setOpen(0); }}>
          {d.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {list.map((g) => (
          <div className="adsplit adsale" key={g.id}>
            <span>{g.name}{g.gender ? ` · ${g.gender}` : ""} · {g.students} طالب<small className="pdmode">{g.label}</small></span>
            <span className="exline"><button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(open === g.id ? 0 : g.id)}>🗓 المواعيد</button><Confirm label="🗑" disabled={busy} onYes={() => { if (open === g.id) setOpen(0); void act({ action: "delGroup", id: g.id, open: 0 }); }} /></span>
          </div>
        ))}
        {!list.length && <div className="exhint">ماكو مجاميع بهذا المكان، فطلابه يطلعلهم الجدول الخاص بس.</div>}
        <div className="exadd adtop">
          <input placeholder="اسم المجموعة، مثل: المجموعة الأولى" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="exnum" aria-label="ساعة المجموعة" value={hour} onChange={(e) => setHour(e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
          <select className="exnum" aria-label="بنين أو بنات" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">الكل</option><option value="بنين">بنين</option><option value="بنات">بنات</option>
          </select>
          <button type="button" className="exbtn" disabled={busy || !name.trim()} onClick={async () => { if (await act({ action: "addGroup", center, hour, name, gender })) setName(""); }}>➕ إضافة</button>
        </div>
        {d.detail && open === d.detail.id && <GroupDates key={JSON.stringify(d.detail)} g={d.detail} others={d.groups.filter((x) => x.id !== open)} week={d.week} busy={busy} act={act} />}
      </div>
    </div>
  );
}

function GroupDates({ g, others, week, busy, act }: { g: Detail; others: G[]; week: Data["week"]; busy: boolean; act: (b: Record<string, unknown>) => Promise<Data | null> }) {
  const [rows, setRows] = useState(g.rows);
  const set = (exam: number, o: Partial<Row>) => setRows(rows.map((r) => (r.exam === exam ? { ...r, ...o } : r)));
  const chapters = [...new Set(rows.map((r) => r.chapter))];
  const [name, setName] = useState(g.name);
  const [hour, setHour] = useState(String(g.hour));
  const [gender, setGender] = useState(g.gender);
  const [slots, setSlots] = useState(g.slots);
  const [start, setStart] = useState("");
  // نسخة وحدة لكل الفصل، وتتبدل بأي وقت. الطالب تتحدد نسخته لمن يفتح الامتحان
  const fillVersion = (chapter: string, model: string) => setRows(rows.map((r) => {
    if (r.chapter !== chapter) return r;
    return { ...r, version: model ? r.versions.find((v) => v.model === model)?.id ?? 0 : 0 };
  }));
  return (
    <div className="exfoot">
      <div className="exlabel">🗓 مواعيد {g.name}</div>
      <div className="exadd">
        <input aria-label="اسم المجموعة" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="exnum" aria-label="الساعة" value={hour} onChange={(e) => setHour(e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}</select>
        <select className="exnum" aria-label="بنين أو بنات" value={gender} onChange={(e) => setGender(e.target.value)}><option value="">الكل</option><option value="بنين">بنين</option><option value="بنات">بنات</option></select>
        <button type="button" className="exbtn" disabled={busy || !name.trim()} onClick={() => void act({ action: "editGroup", id: g.id, name, hour, gender, slots })}>حفظ المجموعة</button>
      </div>
      <div className="exlabel adtop">أوقاتها بالأسبوع</div>
      {slots.map((x, i) => (
        <div className="exadd" key={i}>
          <select aria-label="اليوم" value={x.d} onChange={(e) => setSlots(slots.map((y, j) => (j === i ? { ...y, d: Number(e.target.value) } : y)))}>{week.map((w) => <option key={w.i} value={w.i}>{w.name}</option>)}</select>
          <input type="time" className="ltr" aria-label="الساعة" value={x.t} onChange={(e) => setSlots(slots.map((y, j) => (j === i ? { ...y, t: e.target.value } : y)))} />
          <button type="button" className="exbtn" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>🗑</button>
        </div>
      ))}
      <button type="button" className="exbtn" onClick={() => setSlots([...slots, { d: week[0].i, t: hh(Number(hour)) }])}>➕ وقت</button>
      <div className="exhint adtop">بعد ما تغير الأوقات اضغط «حفظ المجموعة».</div>
      <div className="exlabel adtop">وزع امتحانات الكتاب بالترتيب على هاي الأوقات</div>
      <div className="exadd">
        <input type="date" className="ltr" aria-label="تاريخ البداية" value={start} onChange={(e) => setStart(e.target.value)} />
        <Confirm label="🗓 وزعها من هذا التاريخ" disabled={busy || !start} onYes={() => void act({ action: "fillGroup", id: g.id, start })} />
      </div>
      <div className="exhint">تتخطى العطلة والأيام المستثناة، وبعدها تگدر تعدل أي موعد من جوة.</div>
      {!!others.length && (
        <select className="adtop" aria-label="نسخ الأيام من مجموعة ثانية" disabled={busy} value="" onChange={(e) => { if (e.target.value) void act({ action: "copyGroup", id: g.id, from: Number(e.target.value) }); }}>
          <option value="">📋 انسخ الأيام من مجموعة ثانية</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {chapters.map((c) => (
        <div key={c}>
          <div className="adgroup adsplit"><span>{c}</span>
            <select className="exnum adwide" aria-label={`نسخة كل ${c}`} value="" onChange={(e) => fillVersion(c, e.target.value === "-" ? "" : e.target.value)}>
              <option value="">نسخة لكل الفصل</option>
              <option value="-">أول نسخة جاهزة</option>
              {[...new Set(rows.filter((r) => r.chapter === c).flatMap((r) => r.versions.map((v) => v.model)))].sort().map((m) => <option key={m} value={m}>نسخة {m}</option>)}
            </select>
          </div>
          {rows.filter((r) => r.chapter === c).map((r) => (
            <div className="adexamrow" key={r.exam}>
              <b>{r.title}</b>
              <div className="adexamcells">
                <input type="date" className="ltr" aria-label={`تاريخ ${r.title}`} value={r.date} onChange={(e) => set(r.exam, { date: e.target.value, time: r.time || hh(g.hour) })} />
                <input type="time" className="ltr" aria-label={`ساعة ${r.title}`} value={r.time || hh(g.hour)} onChange={(e) => set(r.exam, { time: e.target.value })} />
                <select aria-label={`نسخة ${r.title}`} value={r.version} onChange={(e) => set(r.exam, { version: Number(e.target.value) })}>
                  <option value={0}>أول نسخة جاهزة</option>
                  {r.versions.map((v) => <option key={v.id} value={v.id}>نسخة {v.model}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void act({ action: "saveGroup", id: g.id, rows: rows.map((r) => ({ exam: r.exam, date: r.date, time: r.time || hh(g.hour), version: r.version })) })}>حفظ المواعيد</button>
    </div>
  );
}
