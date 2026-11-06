"use client";
// الحضوري: المساعد يقرا كود الطالب فينسجل حضوره وتنفتح طباعة ليبله أو ورقته. وأوراق الاستنساخ، وإعدادات كل مركز
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { openOutside, scanQr } from "../shared";

type Card = { item: number; uid: number; name: string; exam: string; at: string; center: string; print: "label" | "paper"; attendedAt: string; label: string; paper: string; already: boolean };
type Center = { id: number; name: string; print: "label" | "paper"; photos: boolean };
type Exam = { id: number; title: string; chapter: string; versions: { model: string; token: string }[] };
type Data = { owner: boolean; centers: Center[]; exams: Exam[]; today: number; card?: Card; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const printUrl = (kind: "label" | "paper", k: string) => `${location.origin}/print/${kind}?k=${encodeURIComponent(k)}`;

export default function AttendClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/attend", "🎫 الحضوري");
  return (
    <>
      <AdminHeader title="🎫 الحضوري" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <Attend data={data} busy={busy} call={call} />
            <div className="card expad">
              <div className="exlabel">📤 أوراق السكانر</div>
              <div className="exhint">بعد الامتحان حط كل الأوراق بالسكانر، وارفع الصور كلها مرة وحدة. البوت يقرا الأكواد ويوزعها على الطلاب، وتروح للمصححين.</div>
              <a className="btn agbtn adtop" style={{ textDecoration: "none", display: "block", textAlign: "center" }} href={`/store/scanup${location.search}`}>📤 رفع أوراق السكانر</a>
            </div>
            <Copies exams={data.exams} />
            {data.owner && <Centers centers={data.centers} busy={busy} call={call} />}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Attend({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [num, setNum] = useState("");
  const c = data.card;
  async function go(code: string) {
    const r = await call({ action: "scan", code });
    // الطباعة تنفتح وحدها حسب المركز، حتى المساعد ما يدوس شي
    if (r?.card && !r.card.already) openOutside(printUrl(r.card.print, r.card.print === "label" ? r.card.label : r.card.paper));
    if (r) setNum("");
  }
  function camera() {
    const ok = scanQr("وجه الكاميرا على كود الطالب", (t) => { void go(t); return true; });
    if (!ok) alert("الكاميرا تشتغل بس من داخل تليجرام بالتلفون. اكتب رقم الطالب بدالها.");
  }
  return (
    <div className="card expad">
      <div className="exlabel">📷 تسجيل حضور</div>
      <div className="exhint">اليوم انسجل {data.today} حضور. اقرا كود الطالب من تلفونه، أو اكتب رقمه.</div>
      <button type="button" className="btn agbtn adtop" disabled={busy} onClick={camera}>📷 اقرا كود الطالب</button>
      <div className="atrow">
        <input className="exinput" inputMode="numeric" dir="ltr" aria-label="رقم الطالب" placeholder="رقم الطالب" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className="exbtn" disabled={busy || !num} onClick={() => void go(num)}>سجل</button>
      </div>
      {c && (
        <div className="atcard">
          <b>{c.name}</b> <span dir="ltr">#{c.uid}</span>
          <div className={c.already ? "exhint" : "exhint atok"}>{c.already ? `⚠️ كان مسجل حضوره من ${c.attendedAt.slice(11, 16)}` : "✅ انسجل حضوره"}</div>
          <div className="exhint">{c.exam} · {c.center} · {c.at.slice(11, 16)}</div>
          <div className="atrow">
            <button type="button" className={c.print === "label" ? "btn" : "exbtn"} onClick={() => openOutside(printUrl("label", c.label))}>🏷 اطبع الليبل</button>
            <button type="button" className={c.print === "paper" ? "btn" : "exbtn"} onClick={() => openOutside(printUrl("paper", c.paper))}>📄 اطبع ورقته كاملة</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** أوراق للاستنساخ: نسخة الامتحان بدون اسم، وعلى أول صفحة مكان الليبل */
function Copies({ exams }: { exams: Exam[] }) {
  const [id, setId] = useState(0);
  const e = exams.find((x) => x.id === id);
  return (
    <div className="card expad">
      <div className="exlabel">🖨 أوراق امتحان للاستنساخ</div>
      <div className="exhint">للمراكز اللي تشتغل بالليبل: اطبع النسخة واستنسخها. كل سؤال بصفحة، وعلى كل صفحة كود، والليبل ينلزگ على أول صفحة.</div>
      <select className="exinput adtop" aria-label="الامتحان" value={id} onChange={(x) => setId(Number(x.target.value))}>
        <option value={0}>اختار الامتحان</option>
        {exams.map((x) => <option key={x.id} value={x.id}>{x.chapter} · {x.title}</option>)}
      </select>
      {e && <div className="atrow">{e.versions.map((v) => <button type="button" key={v.model} className="exbtn" onClick={() => openOutside(printUrl("paper", v.token))}>📄 نسخة {v.model}</button>)}</div>}
    </div>
  );
}

function Centers({ centers, busy, call }: { centers: Center[]; busy: boolean; call: Call }) {
  return (
    <div className="card expad">
      <div className="exlabel">⚙️ المراكز</div>
      <div className="exhint">لكل مركز: بعد الحضور ينطبع ليبل تلزقه على الورقة المستنسخة، لو تنطبع ورقة الامتحان كاملة باسم الطالب. وتگدر تخلي طلابه يصورون أجوبتهم من تلفوناتهم.</div>
      {centers.map((c) => (
        <div key={c.id} className="cpexam">
          <b>{c.name}</b>
          <div className="seg wrap2 adtop">
            <button type="button" className={c.print === "label" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveCenter", center: c.id, print: "label", photos: c.photos })}>🏷 ليبل</button>
            <button type="button" className={c.print === "paper" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveCenter", center: c.id, print: "paper", photos: c.photos })}>📄 ورقة كاملة باسمه</button>
          </div>
          <label className="exhint adtop"><input type="checkbox" checked={c.photos} disabled={busy} onChange={(x) => void call({ action: "saveCenter", center: c.id, print: c.print, photos: x.target.checked })} /> الطلاب يگدرون يصورون أجوبتهم من التلفون</label>
        </div>
      ))}
    </div>
  );
}
