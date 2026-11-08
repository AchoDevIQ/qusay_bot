"use client";
// حل السؤال العلمي: من ملزمة الأستاذ أو محلول على طريقته، والرياضيات مكتوبة مثل الكتاب، كل خطوة بسطر
import { useEffect, useState } from "react";
import { Inline, MathText } from "../myexams/AiCompare";

type Ans = { question: string; where: string; source: "lecture" | "topic" | "ai"; solution: string; error?: string };

/** سطر الحل: إذا كله رياضيات بدون $ ينكتب معادلة، وإذا بيه كلام وبين $ $ رياضيات ينكتب جملة */
function Line({ text }: { text: string }) {
  if (text.includes("$") || /[؀-ۿ]/.test(text)) return <div className="ansline" dir="rtl"><Inline text={text} /></div>;
  return <div className="ansline"><MathText text={text} /></div>;
}

export default function AnswerClient() {
  const [a, setA] = useState<Ans | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    void (async () => {
      try {
        const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "" }) });
        const j = await res.json();
        if (!res.ok) setError(j.error ?? "صار خطأ"); else setA(j);
      } catch { setError("ماكو اتصال، حاول مرة ثانية"); }
    })();
  }, []);
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>📘 حل سؤالك</p>
      </header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!a && !error && <div className="empty">جاري التحميل...</div>}
        {a && (
          <>
            <div className="card">
              <h2>❓ سؤالك</h2>
              <div className="expad">
                {a.where && <div className="exhint">{a.where}</div>}
                {a.question ? <div className="ansq">{a.question}</div> : <div className="exhint">📷 سؤالك بالصورة اللي دزيتها</div>}
              </div>
            </div>
            <div className="card">
              <h2>{a.source === "ai" ? "🤖 الحل على طريقة الأستاذ" : "📘 حل الأستاذ من الملزمة"}</h2>
              <div className="expad anssol">
                {a.solution.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <Line key={i} text={l} />)}
              </div>
              {a.source === "ai" && <div className="expad exhint">هذا السؤال ما موجود بالملزمة، فانحل بنفس طريقة الأستاذ.</div>}
            </div>
            <div className="exhint" style={{ textAlign: "center", margin: "6px 0 18px" }}>إذا بعدك ما فهمت، ارجع للبوت ودوس «❓ بعدني ما فهمت» ويوصل سؤالك للأستاذ.</div>
          </>
        )}
      </div>
    </>
  );
}
