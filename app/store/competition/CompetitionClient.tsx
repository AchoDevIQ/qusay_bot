"use client";
// المنافسة لصاحب البوت: مجاميع الطلاب (اللي تنتظر الموافقة أول) وترتيب كل مجموعة، وترتيب كل مركز امتحاني كامل
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type M = { id: number; name: string; avg: number | null; exams: number; rank: number };
type G = { id: number; name: string; kind: string; status: string; created: string; members: M[] };
type C = { id: number; name: string; students: (M & { gender: string })[] };
type Data = { groups: G[]; centers: C[]; min: number; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const STATUS: Record<string, string> = { pending: "⏳ تنتظر موافقتك", approved: "✅ مقبولة", open: "👥 بعدها تتجمع" };

export default function CompetitionClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/competition", "🏆 المنافسة");
  const [tab, setTab] = useState<"groups" | "centers">("groups");
  return (
    <>
      <AdminHeader title="🏆 المنافسة" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="seg">
              <button type="button" className={tab === "groups" ? "on" : ""} onClick={() => setTab("groups")}>👥 مجاميع الطلاب ({data.groups.length})</button>
              <button type="button" className={tab === "centers" ? "on" : ""} onClick={() => setTab("centers")}>🏫 ترتيب المراكز ({data.centers.length})</button>
            </div>
            {tab === "groups" && (
              <>
                <div className="exhint tmhint">الطالب يسوي مجموعة ويدز رابطها لأصدقائه، وكل صديق يوافق بنفسه. من توصل {data.min} طلاب يوصلك طلبها. المعدل من كل امتحاناته، والغياب صفر.</div>
                {!data.groups.length && <div className="empty">بعد ماكو مجاميع.</div>}
                {data.groups.map((g) => <GroupCard key={g.id} g={g} min={data.min} busy={busy} call={call} />)}
              </>
            )}
            {tab === "centers" && (
              <>
                <div className="exhint tmhint">كل طالب بالمركز امتحن، من أعلى معدل. الطالب يشوف ترتيبه هو بس إذا من أول 100 بمركزه.</div>
                {!data.centers.length && <div className="empty">بعد ماكو درجات بالمراكز.</div>}
                {data.centers.map((c) => (
                  <details key={c.id} className="card cpch">
                    <summary><b>🏫 {c.name}</b> <span className="cpcount">{c.students.length} طالب</span></summary>
                    <Ranking rows={c.students} />
                  </details>
                ))}
              </>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function GroupCard({ g, min, busy, call }: { g: G; min: number; busy: boolean; call: Call }) {
  return (
    <details className="card cpch" open={g.status === "pending"}>
      <summary><b>{g.name}</b> <span className="cpcount">{STATUS[g.status] ?? g.status} · {g.members.length} طالب · {g.kind}</span></summary>
      {g.status === "open" && <div className="exhint expad">تحتاج {Math.max(0, min - g.members.length)} طلاب بعد حتى يوصلك طلبها.</div>}
      <Ranking rows={g.members} />
      <div className="exline expad pdactions">
        {g.status === "pending" && <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "approve", id: g.id })}>✅ موافق</button>}
        {g.status === "pending" && <Confirm label="❌ رفض" disabled={busy} onYes={() => void call({ action: "reject", id: g.id })} />}
        <Confirm label="🗑 شيل المجموعة" disabled={busy} onYes={() => void call({ action: "delete", id: g.id })} />
      </div>
    </details>
  );
}

function Ranking({ rows }: { rows: M[] }) {
  return (
    <table className="extable"><tbody>
      {rows.map((r) => (
        <tr key={r.id}>
          <td><b>{r.rank <= 3 && r.avg !== null ? ["🥇", "🥈", "🥉"][r.rank - 1] : `${r.rank}.`} {r.name}</b><small className="pdmode">{r.exams ? `${r.exams} امتحان` : "بعده ما امتحن"}</small></td>
          <td className="p"><b>{r.avg ?? "—"}</b></td>
        </tr>
      ))}
    </tbody></table>
  );
}
