"use client";
// 📘 ملزمة المحاضرة (ملحق بمحاضرة التطبيق): أسئلة المحاضرة من الوزاري والإثرائي، كل سؤال وحله (صفحة «الحل النموذجي» بيها السؤال وحله).
// الصفحات نفسها مال «📚 ملازمي» (بنفس الحماية: اسمه عليها، جهازه، وقفل الامتحان)، فإذا بدّل الأستاذ ملزمة تتبدل هنا وحدها
import { useEffect, useState } from "react";
import { deviceId, deviceNow, platformNow } from "../shared";

type Q = { book: number; page: number; sec: "wz" | "ith" };
type Lec = { id: string; title: string; topic: string; ch: number; items: Q[] };
const SEC = { wz: "📗 وزاري", ith: "📙 إثرائي" } as const;
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
const token = () => new URLSearchParams(location.search).get("t") ?? "";
const src = (q: Q, sol: boolean) => `/api/notes/page?t=${encodeURIComponent(token())}&book=${q.book}&page=${q.page}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}${sol ? "&sol=1" : ""}`;

export default function QBookClient() {
  const [lec, setLec] = useState<Lec | null>(null);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useEffect(() => {
    void (async () => {
      try {
        await deviceId(); setReady(true);
        const q = new URLSearchParams(location.search);
        const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token(), action: "lq", lec: q.get("lec") }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "صار خطأ");
        setLec(j);
        // الملزمة كاملة: كل سؤال وحله ظاهر، ويگدر يخفي الحلول حتى يحاول بنفسه
        setOpen(Object.fromEntries((j.items as Q[]).map((_, i) => [i, true])));
      } catch (e) { setErr((e as Error).message); }
    })();
  }, []);
  const all = lec ? lec.items.every((_, i) => open[i]) : false;
  return (
    <div className="qq" dir="rtl">
      <style>{CSS}</style>
      <header>
        <img src="/app-logo.png" alt="" />
        <div><b>ملزمة المحاضرة</b>{lec && <small>الفصل {ORD[lec.ch]} · {lec.topic} · {lec.title} · {lec.items.length} سؤال</small>}</div>
        {lec && <button type="button" onClick={() => setOpen(all ? {} : Object.fromEntries(lec.items.map((_, i) => [i, true])))}>{all ? "اخفي الحلول" : "كل الحلول"}</button>}
      </header>
      {err && <div className="qq-msg">{err}</div>}
      {!err && !lec && <div className="qq-msg">جاري التحميل...</div>}
      {ready && lec?.items.map((q, i) => (
        <section key={`${q.book}-${q.page}`}>
          <div className="qq-tag">{SEC[q.sec]} · سؤال {i + 1}</div>
          {/* صفحة الحل بيها السؤال فوك وحله تحته. «اخفي الحلول»: يطلع السؤال بس حتى يحاول */}
          {open[i]
            ? <img className="qq-pg sol" src={src(q, true)} alt={`السؤال ${i + 1} وحله`} loading={i < 2 ? "eager" : "lazy"} />
            : <><img className="qq-pg" src={src(q, false)} alt={`سؤال ${i + 1}`} loading="lazy" />
              <button type="button" className="qq-sol" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}>📘 الحل</button></>}
        </section>
      ))}
    </div>
  );
}

const CSS = `
.qq{min-height:100vh;background:#F5F6FA;color:#141F33;font-family:QAppAr,Cairo,Tahoma,sans-serif;padding-bottom:40px}
.qq header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:#141F33;color:#fff;padding:10px 16px;border-bottom:3px solid #F6C94A}
.qq header img{width:44px;height:44px;object-fit:cover;object-position:52% 54%;transform:scale(1.5)}
.qq header div{flex:1;display:flex;flex-direction:column;min-width:0}
.qq header b{color:#F6C94A;font-size:19px}
.qq header small{color:#C9D1E0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq header button{background:#F6C94A;color:#141F33;border:0;border-radius:10px;padding:8px 12px;font:inherit;font-weight:700;min-height:44px}
.qq section{max-width:900px;margin:16px auto 0;padding:0 16px}
.qq-tag{font-weight:700;color:#8A6420;margin:0 4px 6px}
.qq-pg{display:block;width:100%;height:auto;background:#fff;border-radius:10px;box-shadow:0 1px 6px rgba(20,31,51,.12)}
.qq-pg.sol{border:2px solid #F6C94A}
.qq-sol{display:block;width:100%;margin-top:10px;min-height:52px;border:2px dashed #F6C94A;background:#fff;color:#141F33;border-radius:12px;font:inherit;font-size:17px;font-weight:700}
.qq-msg{max-width:600px;margin:40px auto;padding:0 16px;text-align:center;font-size:18px;line-height:1.8}
`;
