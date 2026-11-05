"use client";
// الصفحة الرئيسية للطالب: مربعات بإطارات وألوان QMath
import { useEffect, useState, type ReactNode } from "react";
import { closeApp, haptic, openOutside } from "../shared";

type List = { name: string; exams: boolean; ask: boolean; myq: boolean; fresh?: boolean; link?: string | null; children?: string[] };
type Reply = List & { url?: string; close?: boolean; error?: string };

const svg = (body: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>;
const ICONS: Record<string, ReactNode> = {
  shop: svg(<><path d="M3 4h2.2l2.3 11.2h10.4L20 7.5H6" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="16.5" cy="19.5" r="1.3" /></>),
  ask: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1.1-1.3 2" /><path d="M12 17h.01" /></>),
  myq: svg(<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19.500H5A1.500 1.500 0 0 1 3.500 18z" />),
  me: svg(<><circle cx="12" cy="8.500" r="3.700" /><path d="M4.500 20c1-3.700 4-5.200 7.500-5.200s6.500 1.500 7.500 5.200" /></>),
  pass: svg(<><circle cx="8" cy="15.500" r="4.200" /><path d="M11 12.500l8.500-8.500M16 7.500l2.500 2.500M13.500 10l1.800 1.800" /></>),
  exams: svg(<><path d="M7 3.500h7.500L19 8v12.500H7a1.500 1.500 0 0 1-1.500-1.500V5A1.500 1.500 0 0 1 7 3.500z" /><path d="M14.500 3.500V8H19" /><path d="M9 12.500h6M9 16h6" /></>),
};

/** اشترى محاضرات أو امتحانات: يدز الرابط لولي أمره، وولي الأمر يضغطه ويضغط Start بس */
function GuardianGate({ link, name, recheck, busy }: { link: string; name: string; recheck: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = `السلام عليكم، آني ${name}. هذا رابط متابعة درجاتي بالتليجرام: اضغط الرابط، وبعدها اضغط زر Start (ابدأ)، وبس.`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`;
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(`${text}\n${link}`); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="card">
      <h2>👨‍👧 خطوة أخيرة: اربط ولي أمرك</h2>
      <div className="hmlink">
        <div>حتى تنفتح لك الأسئلة والامتحانات، لازم ولي أمرك يتابع درجاتك.</div>
        <ol className="hmsteps">
          <li>دز الرابط لولي أمرك من الأزرار جوة.</li>
          <li>ولي أمرك يضغط الرابط، وبعدها يضغط <b>Start</b> بس.</li>
          <li>ارجع هنا واضغط «تأكدت».</li>
        </ol>
        <button type="button" className="btn" onClick={() => openOutside(wa)}>🟢 دز الرابط بالواتساب</button>
        <button type="button" className="btn ghost" onClick={() => openOutside(tgShare)}>✈️ دز الرابط بالتليجرام</button>
        <button type="button" className="btn ghost" onClick={() => void copy()}>{copied ? "✅ انتسخ" : "📋 نسخ الرابط"}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={recheck}>{busy ? "جاري التأكد..." : "🔄 ولي أمري ضغط Start، تأكدت"}</button>
      </div>
    </div>
  );
}

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
  async function recheck() {
    setBusy("check");
    const r = await call("list");
    if (r) {
      setData(r);
      if (r.link) setError("لسه ولي أمرك ما ضغط Start. دز له الرابط مرة ثانية.");
    }
    setBusy("");
  }
  const tiles = [
    { key: "shop", title: "المتجر", note: "المحاضرات والملازم والامتحانات", main: true },
    // السؤال والامتحانات يطلعون بس بعد شراء يفتحهم
    ...(data?.ask ? [{ key: "ask", title: "سؤال علمي" }] : []),
    ...(data?.myq ? [{ key: "myq", title: "أسئلتي" }] : []),
    { key: "me", title: "معلوماتي" },
    ...(data?.exams ? [{ key: "exams", title: "امتحاناتي" }] : []),
    // مربع «طلب كلمة مرور جديدة» (key: "pass") مخفي لحد ما نربط التطبيق، بطلب المستخدم
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
        {data?.children && (
          <div className="card">
            <h2>👨‍👧 متابعة الدرجات</h2>
            <div className="who">أنت ولي أمر: <b>{data.children.join("، ")}</b><br />الدرجات راح توصلك هنا بالمحادثة.</div>
          </div>
        )}
        {data?.link && <GuardianGate link={data.link} name={data.name} recheck={() => void recheck()} busy={busy === "check"} />}
        {data && !data.link && !data.children && (
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
