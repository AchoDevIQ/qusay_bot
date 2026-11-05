"use client";
// الأسئلة اللي تنتظر جواب. الجواب نفسه يصير بمجموعة الأسئلة
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Data = { group: boolean; questions: { id: number; name: string; where: string; created: string; link: string | null }[] };

export default function QuestionsClient() {
  const { data, error, busy } = useAdminApi<Data>("/api/questions", "❓ الأسئلة");
  return (
    <>
      <AdminHeader title="❓ الأسئلة اللي تنتظر جواب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <div className="card">
            <h2>تنتظر جواب: {data.questions.length}</h2>
            {data.questions.length ? (
              <table className="extable"><tbody>
                {data.questions.map((q) => (
                  <tr key={q.id}>
                    <td><b>#{q.id} {q.name}</b><small className="pdmode">{q.where}{q.created ? ` · ${q.created}` : ""}</small></td>
                    <td className="p">{q.link ? <a className="exbtn" href={q.link} target="_blank" rel="noreferrer">افتح</a> : "—"}</td>
                  </tr>
                ))}
              </tbody></table>
            ) : <div className="empty">✅ ماكو أسئلة تنتظر جواب.</div>}
            {!data.group && <div className="expad exbad adtop">⚠️ مجموعة الأسئلة مو مربوطة بعد.</div>}
          </div>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
