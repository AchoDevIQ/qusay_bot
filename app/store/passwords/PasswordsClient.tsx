"use client";
// طلبات كلمة المرور: زر لكل طالب، وزر واحد للكل. الكلمة توصل للطالب بالبوت
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Req = { id: number; name: string; grade: string; phone: string; created: string; app?: boolean };
type Shown = { id: number; name: string; phone: string; password: string };
type Data = { requests: Req[]; notice: string; shown?: Shown[] };
// واتساب الطالب برسالة بيها رمزه الجديد (07… ← 9647…)
const wa = (s: Shown) => `https://wa.me/964${s.phone.replace(/^0/, "")}?text=${encodeURIComponent(`رمزك السري الجديد لتطبيق قصي العميري: ${s.password}
ادخل بيه ويا رقمك ${s.phone}`)}`;

export default function PasswordsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/passwords", "🔑 طلبات كلمة المرور");
  const list = data?.requests ?? [];
  return (
    <>
      <AdminHeader title="🔑 طلبات كلمة المرور" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {!!data?.shown?.length && (
          <div className="card">
            <h2>🔑 الرموز الجديدة</h2>
            <div className="form">
              <div className="exhint">هاي تطلع هسه بس. دز كل رمز لطالبه من زر الواتساب، ووصله هم بمحادثة التطبيق.</div>
              {data.shown.map((s) => (
                <div key={s.id} className="exline">
                  <span>{s.name}: <b dir="ltr">{s.password}</b></span>
                  <a className="exbtn" href={wa(s)} target="_blank" rel="noreferrer">💬 دزه بالواتساب</a>
                </div>
              ))}
            </div>
          </div>
        )}
        {data && (
          <div className="card">
            <h2>الطلبات ({list.length})</h2>
            {list.length > 1 && (
              <div className="expad">
                <Confirm label={`🔑 دز كلمة جديدة للكل (${list.length})`} disabled={busy} onYes={() => void call({ action: "all" })} />
              </div>
            )}
            {list.length ? (
              <table className="extable"><tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><small className="pdmode">{r.app ? "📱 التطبيق · " : ""}{r.grade} · {r.phone} · {r.created}</small></td>
                    <td className="p"><button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "one", id: r.id })}>🔑 دز كلمة جديدة</button></td>
                  </tr>
                ))}
              </tbody></table>
            ) : <div className="empty">ماكو طلبات.</div>}
          </div>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}
