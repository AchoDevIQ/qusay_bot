"use client";
// 👤 معلوماتي: معلومات الطالب المسجلة بالبوت (بدل الملف الشخصي القديم بالتطبيق)
import { useEffect, useState } from "react";
import { deviceId } from "../shared";
import { safeHtml } from "../chat/ChatClient";

export default function MyInfoClient() {
  const [d, setD] = useState<{ name: string; html: string; note: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/my", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URLSearchParams(location.search).get("t") ?? "", device: await deviceId(), action: "me" }) });
        const j = await res.json();
        if (!res.ok) setError(j.error ?? "صار خطأ"); else setD(j);
      } catch { setError("ماكو اتصال، حاول مرة ثانية"); }
    })();
  }, []);
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>👤 معلوماتي</h1>{d?.name && <p>{d.name}</p>}</header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!d && !error && <div className="empty">جاري التحميل...</div>}
        {d && <div className="card"><div className="form"><div style={{ whiteSpace: "pre-line", lineHeight: 2 }} dangerouslySetInnerHTML={{ __html: safeHtml(d.html) }} /><div className="exhint">{d.note}</div></div></div>}
      </div>
    </>
  );
}
