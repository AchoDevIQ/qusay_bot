"use client";
// دليل البوت: كل قسم بخطواته، وأزرار ترسله للمساعد بالتليگرام أو الواتساب
import { useState } from "react";
import { GUIDE, type GuideSection } from "../../../lib/guide.ts";
import { AdminHeader } from "../adminPage";
import { openOutside } from "../shared";

const linkOf = (id: string) => `${location.origin}/guide/${id}`;
const textOf = (s: { title: string }) => `📖 شرح: ${s.title}`;

function Send({ id, title }: { id: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => linkOf(id);
  const text = textOf({ title });
  return (
    <div className="exline adtop">
      <button type="button" className="exbtn" onClick={() => openOutside(`https://t.me/share/url?url=${encodeURIComponent(url())}&text=${encodeURIComponent(text)}`)}>✈️ تليگرام</button>
      <button type="button" className="exbtn" onClick={() => openOutside(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url()}`)}`)}>🟢 واتساب</button>
      <button type="button" className="exbtn" onClick={() => void navigator.clipboard.writeText(url()).then(() => setCopied(true)).catch(() => alert(url()))}>{copied ? "✅ انتسخ" : "📋 نسخ الرابط"}</button>
    </div>
  );
}

const hay = (s: GuideSection) => [s.title, s.who, s.intro, ...s.blocks.flatMap((b) => [b.h ?? "", ...(b.steps ?? []), ...(b.notes ?? [])])].join(" ");

export default function GuideClient() {
  const [q, setQ] = useState("");
  const t = q.trim();
  const list = t ? GUIDE.filter((s) => hay(s).includes(t)) : GUIDE;
  return (
    <>
      <AdminHeader title="📖 دليل البوت" />
      <div className="wrap">
        <div className="card expad">
          <div className="exhint">شرح كل قسم بالخطوات. دوس على القسم حتى تقراه، وأزرار الإرسال تدز شرح القسم للمساعد، وينفتح عنده بدون تسجيل.</div>
          <input className="exinput adtop" placeholder="🔍 دور بالدليل، مثلاً ليبل" value={q} onChange={(e) => setQ(e.target.value)} />
          <Send id="all" title="دليل البوت كامل" />
        </div>
        {list.map((s) => (
          <details key={s.id} className="card cpch" open={!!t}>
            <summary><b>{s.icon} {s.title}</b> <small className="pdmode">{s.who}</small></summary>
            <div className="expad">
              <div className="exhint">{s.intro}</div>
              {s.blocks.map((b, i) => (
                <div key={i}>
                  {b.h && <div className="exlabel adtop">{b.h}</div>}
                  {b.steps && <ol style={{ paddingInlineStart: 22, margin: "6px 0" }}>{b.steps.map((x, j) => <li key={j} style={{ margin: "5px 0" }}>{x}</li>)}</ol>}
                  {b.notes?.map((x, j) => <div key={j} className="exhint">💡 {x}</div>)}
                </div>
              ))}
              <Send id={s.id} title={s.title} />
            </div>
          </details>
        ))}
        {!list.length && <div className="empty">ما لگيت شي بهذي الكلمة.</div>}
      </div>
    </>
  );
}
