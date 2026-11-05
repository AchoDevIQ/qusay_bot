"use client";
// امتحاناتي: الطالب يرتب جدوله مرة وحدة، وبعدها يشوف مواعيده
import { useEffect, useState } from "react";
import { prettyAt } from "../../../lib/scheduleRules.ts";
import { haptic } from "../shared";

type Item = { id: number; title: string; chapter: string; minutes: number; at: string; state: "locked" | "open" | "missed" | "done" | "center" | "past" | "notbought" };
type GroupPreview = { id: number; name: string; items: { title: string; at: string; locked: boolean }[]; waiting: number };
type Preview = { items: { title: string; at: string }[]; days: number; maxPerDay: number; perWeek: number };
type Info = {
  inPerson: boolean; place: string; mode: string | null; groupName: string; needsChoice: boolean; late: { title: string; at: string }[]; groups: { id: number; name: string; hour: number; label: string }[]; groupPreview?: GroupPreview;
  name: string; remaining: number; needsBuild: boolean; schedule: { start: string; end: string; weekdays: number[]; hour: number } | null; items: Item[];
  today: string; minStart: string; window: number; perDay: number; week: { i: number; name: string }[]; hours: number[]; holiday: { start: string; days: number } | null;
  preview?: Preview; notice?: string; error?: string;
};
const STATE: Record<Item["state"], string> = { locked: "🔒 مقفول لحد وقته", open: "🟢 بدا هسه", missed: "⛔ فات وقته", done: "✅ مخلص", center: "🏫 بالمركز", past: "انتهى موعده", notbought: "🔒 ما مشتري" };
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
        {info && info.late.length > 0 && <LateAsk info={info} busy={busy} call={call} />}
        {info?.needsChoice && <Choice info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && info.needsBuild && <Build info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && !info.needsBuild && !info.items.length && <div className="empty">{info.mode === "general" ? "مواعيد مجموعتك لسه ما نزلت." : "ماكو امتحانات بعد لفصولك."}</div>}
        {info && !!info.items.length && <List info={info} />}
      </div>
    </>
  );
}

/** اشترى متأخر وبعض مواعيد مجموعته فاتت */
function LateAsk({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  return (
    <div className="card">
      <h2>⏰ بعض الامتحانات فات موعدها</h2>
      <div className="hmlink">
        <div>هاي الامتحانات فات موعدها ويا مجموعتك:</div>
        <ul className="hmsteps">{info.late.map((e) => <li key={e.title}>{e.title} <small>{prettyAt(e.at)}</small></li>)}</ul>
        <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "latePrivate" })}>👤 أحولها لجدول خاص بأيامي</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "lateKeep" })}>👥 أبقى ويا الطلاب، وهاي تنحسب فايتة</button>
      </div>
    </div>
  );
}

/** أول مرة: ويا الطلاب بمجموعة ثابتة، لو جدول خاص */
function Choice({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const [way, setWay] = useState<"" | "group" | "private">(info.groups.length ? "" : "private");
  const [seen, setSeen] = useState<GroupPreview | null>(null);
  if (way === "private") {
    return (
      <>
        {!!info.groups.length && <button type="button" className="exbtn adtop" onClick={() => setWay("")}>⬅️ رجوع</button>}
        <Build info={info} busy={busy} call={call} />
      </>
    );
  }
  if (way === "group") {
    return (
      <div className="card">
        <h2>👥 مجاميع {info.place}</h2>
        <div className="form">
          <button type="button" className="exbtn" onClick={() => { setWay(""); setSeen(null); }}>⬅️ رجوع</button>
          <label>اختار الوقت اللي يناسبك</label>
          <div className="seg wrap2">
            {info.groups.map((g) => (
              <button type="button" key={g.id} className={seen?.id === g.id ? "on" : ""} disabled={busy} onClick={async () => { haptic(); const r = await call({ action: "groupPreview", group: g.id }); if (r?.groupPreview) setSeen(r.groupPreview); }}>{g.name}<small className="pdmode">{g.label}</small></button>
            ))}
          </div>
          {seen && (
            <>
              {seen.items.length ? <table className="extable adtop"><tbody>{seen.items.map((i) => <tr key={i.title + i.at} className={i.locked ? "mxlocked" : ""}><td>{i.locked ? "🔒 " : ""}{i.title}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table> : <div className="hint adtop">مواعيد هذي المجموعة لسه ما نزلت.</div>}
              {seen.waiting > 0 && !!seen.items.length && <div className="hint adtop">و{seen.waiting} امتحان موعده ينزل بعدين.</div>}
              <div className="rgalert adtop">⚠️ بعد التثبيت ما تتغير مجموعتك إلا عن طريق الإدارة.</div>
              <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void call({ action: "joinGroup", group: seen.id })}>✅ ثبتني ويا {seen.name}</button>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>🗓 شلون تمتحن؟</h2>
      <div className="hmlink">
        <div>عندك <b>{info.remaining}</b> امتحان · {info.place}</div>
        <button type="button" className="btn" onClick={() => { haptic(); setWay("group"); }}>👥 ويا الطلاب (جدول عام)</button>
        <div className="hint">مواعيد ثابتة، تختار بس الوقت اللي يناسبك.</div>
        <button type="button" className="btn ghost" onClick={() => { haptic(); setWay("private"); }}>👤 بدون الطلاب (جدول خاص)</button>
        <div className="hint">إنت تختار أيامك وساعتك.</div>
      </div>
    </div>
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
            <table className="extable"><tbody>{shown.items.map((i) => <tr key={i.title + i.at}><td>{i.title}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table>
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
      <div className="who adnopad expad adtop">{info.place} · {info.mode === "general" ? `ويا الطلاب: ${info.groupName}` : "جدول خاص"}</div>
      <table className="extable"><tbody>
        {info.items.map((i) => (
          <tr key={i.id} className={i.state === "open" ? "sel" : i.state === "notbought" ? "mxlocked" : ""}>
            <td><b>{i.title}</b><small className="pdmode">{i.chapter} · {i.minutes} دقيقة<br />{STATE[i.state]}</small></td>
            <td className="adphone">{prettyAt(i.at)}</td>
          </tr>
        ))}
      </tbody></table>
      {!info.inPerson && <div className="expad exhint adtop">تگدر تدخل الامتحان خلال {info.window} دقيقة من موعده. الامتحان اللي يفوت وقته ما يرجع.</div>}
    </div>
  );
}
