"use client";
// طلبات كلمة المرور: زر لكل طالب، وزر واحد للكل. الكلمة توصل للطالب بالبوت
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Req = { id: number; name: string; grade: string; phone: string; created: string };
type Data = { requests: Req[]; notice: string };

export default function PasswordsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/passwords", "🔑 طلبات كلمة المرور");
  const list = data?.requests ?? [];
  return (
    <>
      <AdminHeader title="🔑 طلبات كلمة المرور" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
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
                    <td><b>{r.name}</b><small className="pdmode">{r.grade} · {r.phone} · {r.created}</small></td>
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
