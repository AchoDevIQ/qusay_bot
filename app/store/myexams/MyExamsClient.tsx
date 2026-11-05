"use client";
// امتحاناتي: الطالب يرتب جدوله مرة وحدة، وبعدها يشوف مواعيده
import { useEffect, useState } from "react";
import { haptic } from "../shared";

type Item = { id: number; title: string; chapter: string; minutes: number; at: string; state: "locked" | "open" | "missed" | "done" };
type Preview = { items: { title: string; at: string }[]; days: number; maxPerDay: number; perWeek: number };
type Info = {
  inPerson: boolean; name: string; remaining: number; needsBuild: boolean; schedule: { start: string; end: string; weekdays: number[]; hour: number } | null; items: Item[];
  today: string; minStart: string; window: number; perDay: number; week: { i: number; name: string }[]; hours: number[]; holiday: { start: string; days: number } | null;
  preview?: Preview; notice?: string; error?: string;
};
const STATE: Record<Item["state"], string> = { locked: "🔒 مقفول لحد وقته", open: "🟢 بدا هسه", missed: "⛔ فات وقته", done: "✅ مخلص" };
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function MyExamsClient() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(location.search).get("t") ?? "";
      const res = await fetch("/api/myexams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
      const j: Info = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ، حاول مرة ثانية"); return null; }
      setInfo(j);
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  useEffect(() => { void call({ action: "info" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>📝 امتحاناتي</p>
      </header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!info && !error && <div className="empty">جاري التحميل...</div>}
        {info?.inPerson && <div className="card warn exerr">🏫 امتحانك حضوري. موعده ومكانه يوصلك من الإدارة.</div>}
        {info && !info.inPerson && info.needsBuild && <Build info={info} busy={busy} call={call} />}
        {info && !info.inPerson && !info.needsBuild && !info.items.length && <div className="empty">ماكو امتحانات جاهزة بعد لفصولك.</div>}
        {info && !!info.items.length && <List info={info} />}
      </div>
    </>
  );
}

function Build({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const old = info.schedule;
  const [start, setStart] = useState(info.minStart);
  const [end, setEnd] = useState(old?.end ?? "");
  const [days, setDays] = useState<number[]>(old?.weekdays ?? []);
  const [hour, setHour] = useState(old && info.hours.includes(old.hour) ? old.hour : -1);
  const [shown, setShown] = useState<Preview | null>(null);
  const form = { start, end, weekdays: days, hour };
  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setShown(null); };
  const ready = !!start && !!end && days.length > 0 && hour >= 0;
  return (
    <div className="card">
      <h2>🗓 {old ? "رتب جدولك من جديد" : "رتب جدول امتحاناتك"}</h2>
      <div className="form">
        <div className="warn locked">عندك <b>{info.remaining}</b> امتحان. {old ? "اشتريت فصل جديد، فانعاد توزيع الامتحانات الباقية." : "اختار المدة والأيام والساعة، والبوت يوزعها."} وأكثر شي <b>{info.perDay}</b> باليوم.</div>
        {info.holiday && <div className="hint">🏖 العطلة من {info.holiday.start} لمدة {info.holiday.days} يوم، ما بيها امتحانات.</div>}
        <label>تبدي من تاريخ</label>
        <input type="date" className="ltr" min={info.minStart} value={start} onChange={(e) => change(setStart)(e.target.value)} />
        <label>تخلص بتاريخ{old ? " (تگدر تبقيه أو تغيره)" : ""}</label>
        <input type="date" className="ltr" min={start} value={end} onChange={(e) => change(setEnd)(e.target.value)} />
        <label>أيام الامتحان بالأسبوع</label>
        <div className="seg wrap2">
          {info.week.map((d) => (
            <button type="button" key={d.i} className={days.includes(d.i) ? "on" : ""} onClick={() => { haptic(); change(setDays)(days.includes(d.i) ? days.filter((x) => x !== d.i) : [...days, d.i]); }}>{d.name}</button>
          ))}
        </div>
        <label>الساعة</label>
        <select value={hour} onChange={(e) => change(setHour)(Number(e.target.value))}>
          <option value={-1}>اختار الساعة</option>
          {info.hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
        {!shown && <button type="button" className="btn agbtn adtop" disabled={busy || !ready} onClick={async () => { const r = await call({ action: "preview", ...form }); if (r?.preview) setShown(r.preview); }}>{busy ? "جاري الحساب..." : "شوف جدولي"}</button>}
        {shown && (
          <>
            <div className="warn locked adtop">📊 {shown.items.length} امتحان على {shown.days} يوم، بحدود {shown.perWeek} بالأسبوع، وأكثر شي {shown.maxPerDay} باليوم.</div>
            <table className="extable"><tbody>{shown.items.map((i) => <tr key={i.title + i.at}><td>{i.title}</td><td className="adphone">{i.at}</td></tr>)}</tbody></table>
            <div className="rgalert adtop">⚠️ بعد التثبيت ما يتغير الجدول إلا عن طريق الإدارة.</div>
            <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void call({ action: "confirm", ...form })}>✅ ثبت جدولي</button>
          </>
        )}
      </div>
    </div>
  );
}

function List({ info }: { info: Info }) {
  return (
    <div className="card">
      <h2>🗓 جدول امتحاناتك</h2>
      <table className="extable"><tbody>
        {info.items.map((i) => (
          <tr key={i.id} className={i.state === "open" ? "sel" : ""}>
            <td><b>{i.title}</b><small className="pdmode">{i.chapter} · {i.minutes} دقيقة<br />{STATE[i.state]}</small></td>
            <td className="adphone">{i.at}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="expad exhint adtop">تگدر تدخل الامتحان خلال {info.window} دقيقة من موعده. الامتحان اللي يفوت وقته ما يرجع.</div>
    </div>
  );
}
