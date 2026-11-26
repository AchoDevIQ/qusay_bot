"use client";
// 🎬 تبويب من تبويبات المحاضرة بالتطبيق (تحت الفيديو). view: q الأسئلة · sol الحل النموذجي · solve سبورة الحل · board سبورة الشرح · myq أسئلتي.
// الأزرار اللي تفتح السبورة أو صفحة الحل تنفتح بشاشة كاملة بالتطبيق (qmath://open)، وبالمتصفح بنفس الصفحة
import { useEffect, useState } from "react";
import QBookClient from "../qbook/QBookClient";

type Board = { id: string; title: string; pages: number; at: string };
type MyQ = { kind: "ai"; id: string; q: string; at: string } | { kind: "teacher"; id: number; status: string; at: string };
type Tabs = { qs: boolean; board: Board[]; myq: MyQ[]; info: { title: string; topic: string; ch: number } | null };

const q = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const inApp = () => !!q().get("app");
/** يفتح صفحة ثانية: بالتطبيق بشاشة كاملة، وبالمتصفح بنفس النافذة */
const open = (page: string, extra: Record<string, string>) => {
  if (inApp()) { location.href = `qmath://open?${new URLSearchParams({ page, ...extra })}`; return; }
  location.href = `/store/${page}?${new URLSearchParams({ ...extra, t: q().get("t") ?? "" })}`;
};

export default function LecClient() {
  const [view] = useState(() => q().get("view") ?? "q");
  if (view === "q" || view === "sol") return <QBookClient mode={view} embedded />;
  return <Extras view={view} />;
}

function Extras({ view }: { view: string }) {
  const [d, setD] = useState<Tabs | null>(null);
  const [err, setErr] = useState("");
  const lec = q().get("lec") ?? "";
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: q().get("t") ?? "", action: "lecTabs", lec }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "صار خطأ");
        setD(j);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [lec]);
  return (
    <div className="lx" dir="rtl">
      <style>{CSS}</style>
      {err && <div className="lx-msg">{err}</div>}
      {!d && !err && <div className="lx-msg">جاري التحميل...</div>}
      {d && view === "solve" && <section>
        <h2>✍️ سبورة الحل</h2>
        <p>ورقة A4: كل سؤال من أسئلة المحاضرة فوك صفحة، وإنت تحل تحته بالقلم. حلك ينحفظ إلك بس، وترجعله وقت ما تريد.</p>
        {d.qs ? <button type="button" className="lx-go" onClick={() => open("board", { solve: lec })}>✍️ افتح سبورة الحل</button>
          : <p className="lx-note">هاي المحاضرة بعد ما إلها أسئلة بالملزمة.</p>}
      </section>}
      {d && view === "board" && <section>
        <h2>📝 سبورة الشرح</h2>
        {!d.board.length && <p className="lx-note">الأستاذ بعده ما دز شرح سبورة لهاي المحاضرة.</p>}
        {d.board.map((b) => (
          <button type="button" key={b.id} className="lx-row" onClick={() => open("board", { att: b.id })}>
            <b>📝 {b.title}</b><small>{b.pages} صفحة · دوس تفتحه وتكتب عليه</small>
          </button>
        ))}
      </section>}
      {d && view === "myq" && <section>
        <h2>❓ أسئلتي بهاي المحاضرة</h2>
        {!d.myq.length && <p className="lx-note">ما سألت ولا سؤال بهاي المحاضرة. الأسئلة اللي تسألها من «❓ سؤال علمي» وتختار هاي المحاضرة تطلع هنا، حتى ترجعلها من تراجع.</p>}
        {d.myq.map((m) => m.kind === "ai" ? (
          <button type="button" key={m.id} className="lx-row" onClick={() => open("answer", { a: m.id })}>
            <b>{m.q || "سؤالك"}</b><small>{m.at} · دوس تشوف الحل</small>
          </button>
        ) : (
          <div key={m.id} className="lx-row">
            <b>سؤالك رقم #{m.id}</b><small>{m.at} · {m.status === "open" ? "🟡 ينتظر جواب الأستاذ" : "🟢 جاوبك الأستاذ، الجواب وصلك بالمحادثة"}</small>
          </div>
        ))}
      </section>}
    </div>
  );
}

const CSS = `
.lx{min-height:100vh;background:#F5F6FA;color:#141F33;font-family:QAppAr,Cairo,Tahoma,sans-serif;padding:12px 16px 40px}
.lx section{max-width:900px;margin:0 auto}
.lx h2{margin:4px 0 8px;font-size:18px}
.lx p{margin:0 0 12px;color:#5C667A;line-height:1.8}
.lx-note{background:#fff;border:1px solid #E6E9F0;border-radius:12px;padding:12px}
.lx-go{width:100%;min-height:54px;border:0;border-radius:14px;background:#141F33;color:#F6C94A;font:inherit;font-size:18px;font-weight:800}
.lx-row{display:flex;flex-direction:column;gap:2px;width:100%;text-align:right;margin-top:8px;padding:12px 14px;border-radius:12px;border:1px solid #E6E9F0;border-right:5px solid #F6C94A;background:#fff;color:#141F33;font:inherit}
.lx-row b{font-size:15px}.lx-row small{color:#5C667A}
.lx-msg{margin:40px auto;text-align:center;font-size:17px}
`;
