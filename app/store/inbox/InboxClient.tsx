"use client";
// 🔔 إشعارات الطالب: المؤقت يختفي بعد ما يقراه (يبقى ظاهر لحد ما يطلع من الصفحة)، والدائمي يبقى لحد ما ينمسح
import { useEffect, useState } from "react";
import { deviceId } from "../shared";

type N = { id: number; kind: string; text: string; img: boolean; at: string; read: boolean };

export default function InboxClient() {
  const [list, setList] = useState<N[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");
  const token = () => new URLSearchParams(location.search).get("t") ?? "";

  async function call(body: Record<string, unknown>) {
    setError("");
    try {
      const res = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; }
  }
  useEffect(() => { void call({ action: "list" }).then((r) => r && setList(r.list)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function show(n: N) {
    setOpen(open === n.id ? null : n.id);
    if (!n.read) {
      setList((l) => l?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
      void call({ action: "read", id: n.id });
    }
  }
  const unread = list?.filter((n) => !n.read).length ?? 0;
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>🔔 الإشعارات</h1>{!!unread && <p>{unread} ما قريتها</p>}</header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!list && !error && <div className="empty">جاري التحميل...</div>}
        {list && !list.length && <div className="empty">ماكو إشعارات هسه.</div>}
        {list?.map((n) => (
          <div key={n.id} className="card" onClick={() => show(n)} style={{ cursor: "pointer" }}>
            <div className="form">
              <div className="exhint">{n.read ? "" : "🔵 جديد · "}{n.kind === "keep" ? "📌 " : ""}{n.at.slice(0, 16)}</div>
              <div style={{ whiteSpace: "pre-wrap", ...(open === n.id ? {} : { maxHeight: "3.2em", overflow: "hidden" }) }}>{n.text}</div>
              {open === n.id && n.img && <img src={`/api/inbox?id=${n.id}&t=${encodeURIComponent(token())}`} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />}
              {open !== n.id && <div className="exhint">اضغط حتى تقراه{n.img ? " وتشوف الصورة" : ""}</div>}
              {open === n.id && n.kind === "temp" && <div className="exhint">⏳ هذا الإشعار يختفي بعد ما تطلع من الصفحة.</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
