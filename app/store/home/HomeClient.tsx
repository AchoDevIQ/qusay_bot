"use client";
// الصفحة الرئيسية للطالب: مربعات بإطارات وألوان QMath
import { useEffect, useState, type ReactNode } from "react";
import { closeApp, haptic } from "../shared";

type List = { name: string; exams: boolean };
type Reply = List & { url?: string; close?: boolean; error?: string };

const svg = (body: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>;
const ICONS: Record<string, ReactNode> = {
  shop: svg(<><path d="M3 4h2.2l2.3 11.2h10.4L20 7.5H6" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="16.5" cy="19.5" r="1.3" /></>),
  ask: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1.1-1.3 2" /><path d="M12 17h.01" /></>),
  myq: svg(<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19.500H5A1.500 1.500 0 0 1 3.500 18z" />),
  me: svg(<><circle cx="12" cy="8.500" r="3.700" /><path d="M4.500 20c1-3.700 4-5.200 7.500-5.200s6.500 1.500 7.500 5.200" /></>),
  exams: svg(<><path d="M7 3.500h7.500L19 8v12.500H7a1.500 1.500 0 0 1-1.500-1.500V5A1.500 1.500 0 0 1 7 3.500z" /><path d="M14.500 3.500V8H19" /><path d="M9 12.500h6M9 16h6" /></>),
};

export default function HomeClient() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<List | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function call(action: string): Promise<Reply | null> {
    setError("");
    try {
      const t = token || new URLSearchParams(location.search).get("t") || "";
      const res = await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, action }) });
      const j: Reply = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ، حاول مرة ثانية"); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; }
  }
  useEffect(() => {
    setToken(new URLSearchParams(location.search).get("t") ?? "");
    void call("list").then((r) => { if (r) setData(r); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(action: string) {
    if (busy) return;
    haptic();
    setBusy(action);
    const r = await call(action);
    if (r?.url) { location.href = r.url; return; }
    if (r?.close) closeApp();
    setBusy("");
  }
  const tiles = [
    { key: "shop", title: "المتجر", note: "المحاضرات والملازم والامتحانات", main: true },
    { key: "ask", title: "سؤال علمي" },
    { key: "myq", title: "أسئلتي" },
    { key: "me", title: "معلوماتي" },
    ...(data?.exams ? [{ key: "exams", title: "امتحاناتي" }] : []),
  ] as { key: string; title: string; note?: string; main?: boolean }[];

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>{data?.name ? `أهلاً بك يا ${data.name}` : "الرياضيات · السادس الإعدادي"}</p>
      </header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <div className="hmgrid">
            {tiles.map((t) => (
              <button type="button" key={t.key} className={"hmtile" + (t.main ? " main" : "")} disabled={!!busy} onClick={() => void open(t.key)}>
                <span className="hmicon">{ICONS[t.key]}</span>
                <b>{busy === t.key ? "جاري الفتح..." : t.title}</b>
                {t.note && <small>{t.note}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
