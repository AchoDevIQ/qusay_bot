"use client";
// أعياد ميلاد الطلاب: اليوم والأيام الجاية، ويا معدل كل واحد. اللي معدله فوق الحد ينعزل فوك حتى ينطوله هدية
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type B = { id: number; name: string; age: number; exams: number; avg: number | null; phone: string; exam: string };
type Data = { date: string; days: { d: string; n: number }[]; list: B[]; min: number; owner: boolean; notice: string };

export default function BirthdaysClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/birthdays", "🎂 أعياد الميلاد");
  return (
    <>
      <AdminHeader title="🎂 أعياد ميلاد الطلاب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Body data={data} busy={busy} call={call} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Body({ data, busy, call }: { data: Data; busy: boolean; call: (b: Record<string, unknown>) => Promise<Data | null> }) {
  const [min, setMin] = useState(String(data.min));
  const top = data.list.filter((s) => s.avg !== null && s.avg >= data.min), rest = data.list.filter((s) => !(s.avg !== null && s.avg >= data.min));
  const row = (s: B) => (
    <tr key={s.id}>
      <td><b>{s.name}</b><small className="pdmode">{s.age} سنة · {s.exam} · <span dir="ltr">{s.phone}</span></small></td>
      <td className="p">{s.avg === null ? <small>ما امتحن</small> : <><b>{s.avg}</b><small className="pdmode">{s.exams} امتحان</small></>}</td>
    </tr>
  );
  return (
    <>
      <div className="exhint tmhint">كل يوم الساعة 8 الصبح توصلك رسالة بالبوت بأعياد ميلاد اليوم. المعدل من الامتحانات المصححة لحد هسه.</div>
      <div className="gkdays">
        {data.days.map((x, i) => (
          <button type="button" key={x.d} className={x.d === data.date ? "on" : ""} disabled={busy} onClick={() => void call({ action: "list", date: x.d })}>
            <b>{i === 0 ? "اليوم" : i === 1 ? "باچر" : x.d.slice(5)}</b><small>{x.n ? `🎂 ${x.n}` : "—"}</small>
          </button>
        ))}
      </div>
      {!data.list.length && <div className="empty">ماكو أعياد ميلاد بهذا اليوم.</div>}
      {!!top.length && <div className="card"><h2>⭐ معدلهم {data.min} فما فوق ({top.length})</h2><table className="extable"><tbody>{top.map(row)}</tbody></table></div>}
      {!!rest.length && <div className="card"><h2>🎂 {top.length ? "الباقين" : "عيد ميلادهم"} ({rest.length})</h2><table className="extable"><tbody>{rest.map(row)}</tbody></table></div>}
      {data.owner && (
        <div className="card expad">
          <div className="exlabel">⭐ معدل الهدية</div>
          <div className="exhint">الطلاب اللي معدلهم هالقد فما فوق يطلعون بقائمة لحالهم فوك.</div>
          <div className="exadd">
            <input className="exnum" inputMode="numeric" aria-label="معدل الهدية" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} />
            <button type="button" className="exbtn" disabled={busy || !min || min === String(data.min)} onClick={() => void call({ action: "save", min: Number(min), date: data.date })}>💾 حفظ</button>
          </div>
        </div>
      )}
    </>
  );
}
