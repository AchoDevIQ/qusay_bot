"use client";
// الصفحة الرئيسية للطالب: مربعات بإطارات وألوان QMath
import { useEffect, useState, type ReactNode } from "react";
import { closeApp, haptic, openOutside, deviceId } from "../shared";
import BasicsCard, { type Basics } from "../BasicsCard";

type List = { name: string; exams: boolean; ask: boolean; myq: boolean; notes?: boolean; board?: boolean; vote?: number; fresh?: boolean; link?: string | null; linkText?: string | null; linkCopy?: string | null; children?: string[]; show?: string[]; needSched?: boolean; appGuard?: boolean; basics?: Basics | null };
type Reply = List & { url?: string; close?: boolean; error?: string };

const svg = (body: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>;
const ICONS: Record<string, ReactNode> = {
  shop: svg(<><path d="M3 4h2.2l2.3 11.2h10.4L20 7.5H6" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="16.5" cy="19.5" r="1.3" /></>),
  ask: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1.1-1.3 2" /><path d="M12 17h.01" /></>),
  myq: svg(<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19.500H5A1.500 1.500 0 0 1 3.500 18z" />),
  me: svg(<><circle cx="12" cy="8.500" r="3.700" /><path d="M4.500 20c1-3.700 4-5.200 7.500-5.200s6.500 1.500 7.500 5.200" /></>),
  pass: svg(<><circle cx="8" cy="15.500" r="4.200" /><path d="M11 12.500l8.500-8.500M16 7.500l2.500 2.500M13.500 10l1.800 1.800" /></>),
  notes: svg(<><path d="M12 6.500C10 5 7 4.500 4 5v14c3-.5 6 0 8 1.500 2-1.500 5-2 8-1.500V5c-3-.5-6 0-8 1.500z" /><path d="M12 6.500v14" /></>),
  guardian: svg(<><circle cx="9" cy="8" r="3.2" /><circle cx="16.5" cy="10" r="2.4" /><path d="M3.5 19c.8-3.2 3-4.8 5.5-4.8s4.7 1.6 5.5 4.8" /><path d="M14.5 15.2c.6-.3 1.3-.4 2-.4 2 0 3.5 1.3 4 4.2" /></>),
  vote: svg(<><path d="M4 13.500h16v7H4z" /><path d="M8.500 13.500V6.500l3-3 5 5-5 5" /><path d="M9.500 17h5" /></>),
  exams: svg(<><path d="M7 3.500h7.500L19 8v12.500H7a1.500 1.500 0 0 1-1.500-1.500V5A1.500 1.500 0 0 1 7 3.500z" /><path d="M14.500 3.500V8H19" /><path d="M9 12.500h6M9 16h6" /></>),
};

/** ورا أول امتحان: يحول الرابط لولي أمره، وولي الأمر يدوسه ويدوس START بس */
function GuardianGate({ link, text, copyText, recheck, busy }: { link: string; text: string; copyText: string; recheck: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(copyText); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="card">
      <h2>🔒 اربط ولي أمرك حتى ينفتح حسابك</h2>
      <div className="hmlink">
        <div>خلصت أول امتحان 👏 هسه لازم ولي أمرك يربط حتى توصله درجاتك. سهلة:</div>
        <ol className="hmsteps">
          <li>دوس <b>📤 حوّل لولي أمرك</b>، واختار ولي أمرك من قائمة التليجرام، ودوس إرسال.</li>
          <li>ولي أمرك يدوس الرابط الأزرق، وبعدها الزر الأزرق <b>START</b> (أو <b>ابدأ</b>) اللي يطلع جوة الشاشة. بس هذا، ما يكتب شي.</li>
          <li>ارجع هنا ودوس «تأكدت».</li>
        </ol>
        <button type="button" className="btn" onClick={() => openOutside(tgShare)}>📤 حوّل لولي أمرك</button>
        <button type="button" className="btn ghost" onClick={() => void copy()}>{copied ? "✅ انتسخت، الصقها عند ولي أمرك" : "📋 انسخ الرسالة والرابط"}</button>
        <div className="hint">ولي أمرك ما عنده تليجرام؟ لازم ينزله أول، لأن الدرجات توصله عليه.</div>
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

  async function call(action: string, extra: Record<string, unknown> = {}): Promise<Reply | null> {
    setError("");
    try {
      const t = token || new URLSearchParams(location.search).get("t") || "";
      const res = await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, action, ...extra, device: await deviceId() }) });
      const j: Reply = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ، حاول مرة ثانية"); return null; }
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; }
  }
  useEffect(() => {
    setToken(new URLSearchParams(location.search).get("t") ?? "");
    void call("list").then((r) => { if (r) setData(r); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // صفحة ولي الأمر (من التطبيق بس): برابط الطالب نفسه
  const guardHref = () => `/store/guardian?t=${encodeURIComponent(new URLSearchParams(location.search).get("t") ?? "")}`;
  async function open(action: string) {
    if (busy) return;
    if (action === "guardian") { location.href = guardHref(); return; }
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
    ...(data?.notes ? [{ key: "notes", title: "ملازمي" }] : []),
    // 📝 السبورة: يكتب عليها، وشروحات الأستاذ توصله هنا
    ...(data?.board ? [{ key: "board", title: "السبورة", note: "سبورتك خارج المحاضرات، وشروحات الأستاذ" }] : []),
    // التصويت يطلع بس إذا أكو تصويت مفتوح إله وبعده ما صوت
    ...(data?.vote ? [{ key: "vote", title: "التصويت", note: data.vote > 1 ? `${data.vote} تصويتات تنتظر صوتك` : "تصويت ينتظر صوتك" }] : []),
    // مربع «طلب كلمة مرور جديدة» (key: "pass") مخفي لحد ما نربط التطبيق، بطلب المستخدم
    ...(data?.appGuard ? [{ key: "guardian", title: "ولي الأمر", note: "درجاتك وتوقيع ولي أمرك" }] : []),
    // البوت احتياط للتطبيق: يطلع بس المربع اللي فتحه صاحب البوت لهذا الطالب
  ].filter((t) => t.key === "guardian" || !data?.show || data.show.includes(t.key)) as { key: string; title: string; note?: string; main?: boolean }[];

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        {data?.name && <p>أهلاً بك يا {data.name}</p>}
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
        {data?.link && data.appGuard && (
          <div className="card"><div className="form">
            <div className="who">🔒 <b>ولي أمرك لازم يربط حتى ينفتح حسابك.</b><br />خلي ولي أمرك يفتح صفحة «👨‍👧 ولي الأمر» على هذا التلفون ويحط رمزه السري. بعدها درجاتك توصله هناك.</div>
            <a className="btn" href={guardHref()}>👨‍👧 افتح صفحة ولي الأمر</a>
          </div></div>
        )}
        {data?.link && !data.appGuard && <GuardianGate link={data.link} text={data.linkText ?? ""} copyText={data.linkCopy ?? data.link} recheck={() => void recheck()} busy={busy === "check"} />}
        {data?.basics && <BasicsCard need={data.basics} busy={!!busy} save={(b) => { setBusy("basics"); void call("setBasics", b).then(async (r) => { if (r) { const l = await call("list"); if (l) setData(l); } setBusy(""); }); }} />}
        {data?.needSched && !data.link && (
          <div className="card warn"><div className="who">🗓 قبل كل شي اختار أوقات امتحاناتك من «امتحاناتي»، وبعدها ينفتحلك كلشي.</div></div>
        )}
        {data && !data.link && !data.children && !tiles.length && (
          <div className="card"><div className="who">📱 كل خدماتنا صارت بتطبيق قصي العميري. درجاتك توصلك هنا بالمحادثة.</div></div>
        )}
        {data && !data.link && !data.children && !!tiles.length && (
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
