"use client";
// 🗳 التصويت للطالب: نفس الصفحة بالتطبيق والبوت. يختار، يطلعله «هل أنت متأكد؟»، يدوس نعم وصوته يتثبت وما يتغير.
// المنتهي اللي نتيجته انعرضت يطلع بالنسب بس. وإذا جاي من رابط القناة لتصويت مو إله يطلعله ليش
import { useEffect, useState } from "react";
import { deviceId } from "../shared";

type P = { id: number; question: string; options: string[]; open: boolean; mine: number | null; pct: number[] | null };
type Data = { list: P[]; focus: number; why: string; notice: string };

export default function VoteClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const qs = () => new URLSearchParams(location.search);

  async function call(body: Record<string, unknown>) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: qs().get("t") ?? "", p: Number(qs().get("p")) || 0, device: await deviceId(), ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      setData(j);
      return j as Data;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  useEffect(() => { void call({ action: "list" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = data ? [...data.list].sort((a, b) => Number(b.id === data.focus) - Number(a.id === data.focus)) : [];
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>🗳 التصويت</h1></header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data?.why && <div className="card warn exerr">⚠️ {data.why}</div>}
        {data?.notice && <div className="card expad">{data.notice}</div>}
        {data && !list.length && <div className="empty">ماكو تصويت إلك هسه.</div>}
        {list.map((p) => <Vote key={p.id} p={p} busy={busy} vote={(choice) => call({ action: "vote", id: p.id, choice })} />)}
      </div>
    </>
  );
}

function Vote({ p, busy, vote }: { p: P; busy: boolean; vote: (choice: number) => Promise<Data | null> }) {
  const [pick, setPick] = useState<number | null>(null);
  if (p.pct) {
    return (
      <div className="card expad">
        <h2>🗳 نتيجة التصويت</h2>
        <div style={{ whiteSpace: "pre-wrap" }}>{p.question}</div>
        {p.options.map((o, i) => (
          <div key={i} className="plres">
            <div className="plrow"><b>{o}</b><span><b>{p.pct![i]}%</b></span></div>
            <div className="plbar"><span style={{ width: `${p.pct![i]}%` }} /></div>
          </div>
        ))}
        {p.mine !== null && <div className="exhint">صوتك كان: {p.options[p.mine]}</div>}
      </div>
    );
  }
  return (
    <div className="card expad">
      <h2>🗳 تصويت</h2>
      <div style={{ whiteSpace: "pre-wrap" }}>{p.question}</div>
      {p.mine !== null ? (
        <div className="exhint">✅ انحسب صوتك: <b>{p.options[p.mine]}</b>. شكراً إلك.</div>
      ) : pick === null ? (
        <>
          <div className="exhint">👇 اختار جوابك. تگدر تصوت مرة وحدة بس.</div>
          {p.options.map((o, i) => <button type="button" key={i} className="btn" style={{ display: "block", width: "100%", marginTop: 8 }} disabled={busy} onClick={() => setPick(i)}>{o}</button>)}
        </>
      ) : (
        <>
          <div>اخترت: <b>{p.options[pick]}</b></div>
          <div className="exhint">❓ <b>هل أنت متأكد؟</b> بعد ما تأكد ما تگدر تغير صوتك.</div>
          <div className="exadd">
            <button type="button" className="btn" disabled={busy} onClick={() => void vote(pick).then((r) => { if (!r) setPick(null); })}>✅ نعم، متأكد</button>
            <button type="button" className="exbtn" disabled={busy} onClick={() => setPick(null)}>↩️ لا، ارجع للاختيارات</button>
          </div>
        </>
      )}
    </div>
  );
}
