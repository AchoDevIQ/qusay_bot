"use client";
// حل السؤال العلمي: من ملزمة الأستاذ أو محلول على طريقته، والرياضيات مكتوبة مثل الكتاب، كل خطوة بسطر.
// طالب المنهج الإنگليزي يشوف الصفحة كلها بالإنگليزي
import { useEffect, useState } from "react";
import { Inline, MathText } from "../myexams/AiCompare";

type Ans = { question: string; where: string; source: "lecture" | "topic" | "ai"; solution: string; lang?: "ar" | "en"; error?: string };

const TXT = {
  ar: { title: "📘 حل سؤالك", q: "❓ سؤالك", photo: "📷 سؤالك بالصورة اللي دزيتها", ai: "🤖 الحل على طريقة الأستاذ", book: "📘 حل الأستاذ من الملزمة", aiNote: "هذا السؤال ما موجود بالملزمة، فانحل بنفس طريقة الأستاذ.", help: "إذا بعدك ما فهمت، ارجع للبوت ودوس «❓ بعدني ما فهمت» ويوصل سؤالك للأستاذ.", loading: "جاري التحميل...", net: "ماكو اتصال، حاول مرة ثانية", err: "صار خطأ" },
  en: { title: "📘 Your solution", q: "❓ Your question", photo: "📷 Your question is in the photo you sent", ai: "🤖 Solved the teacher's way", book: "📘 The teacher's solution from the booklet", aiNote: "This question is not in the booklet, so it was solved with the teacher's method.", help: "Still not clear? Go back to the bot and tap «❓ Still not clear» to send your question to the teacher.", loading: "Loading...", net: "No connection, try again", err: "Something went wrong" },
};

/** سطر الحل: إذا كله رياضيات بدون $ ينكتب معادلة، وإذا بيه كلام وبين $ $ رياضيات ينكتب جملة */
function Line({ text, rtl }: { text: string; rtl: boolean }) {
  if (text.includes("$") || /[؀-ۿ]/.test(text) || /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text)) return <div className="ansline" dir={rtl ? "rtl" : "ltr"}><Inline text={text} /></div>;
  return <div className="ansline"><MathText text={text} /></div>;
}

export default function AnswerClient() {
  const [a, setA] = useState<Ans | null>(null);
  const [error, setError] = useState("");
  const t = TXT[a?.lang === "en" ? "en" : "ar"];
  const rtl = a?.lang !== "en";
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    void (async () => {
      try {
        const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "" }) });
        const j = await res.json();
        if (!res.ok) setError(j.error ?? TXT.ar.err); else setA(j);
      } catch { setError(TXT.ar.net); }
    })();
  }, []);
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>{t.title}</p>
      </header>
      <div className="wrap" dir={rtl ? "rtl" : "ltr"}>
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!a && !error && <div className="empty">{t.loading}</div>}
        {a && (
          <>
            <div className="card">
              <h2>{t.q}</h2>
              <div className="expad">
                {a.where && <div className="exhint">{a.where}</div>}
                {a.question ? <div className="ansq">{a.question}</div> : <div className="exhint">{t.photo}</div>}
              </div>
            </div>
            <div className="card">
              <h2>{a.source === "ai" ? t.ai : t.book}</h2>
              <div className="expad anssol">
                {a.solution.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <Line key={i} text={l} rtl={rtl} />)}
              </div>
              {a.source === "ai" && <div className="expad exhint">{t.aiNote}</div>}
            </div>
            <div className="exhint" style={{ textAlign: "center", margin: "6px 0 18px" }}>{t.help}</div>
          </>
        )}
      </div>
    </>
  );
}
