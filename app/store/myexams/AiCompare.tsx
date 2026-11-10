"use client";
// تصحيح نظام التصحيح AI مثل ورقة التصحيح: لكل سؤال صفحة، فوك صورة جواب الطالب صغيرة (تكبر بالضغط)،
// وتحتها عمودين: الحل النموذجي وحل الطالب خطوة خطوة، والخطوة الغلط حمرة. والصفحة الثانية صورة ورقته كاملة
import "katex/dist/katex.min.css";
import { useState } from "react";
import { canRender, mathHtml } from "./mathTex";
export { toTex } from "./mathTex";

export type AiStep = { status: string; awarded: number; possible: number; expected: string; student?: string; reason: string; failed?: boolean; message?: string };

/** الخطوة اللي نظام التصحيح ما گدر يحللها، أو كتابتها ما تنرسم: الطالب يشوف هاي الرسالة بدل كتابة ما تنقرا */
export const FAIL_TEXT = "تعذّر تحليل هذه الخطوة، أرسل صورة ثانية أوضح.";
export type AiQ = { n: number; score: number; max: number; note: string; photos: string[]; steps: AiStep[] };


/** خطوة رياضيات: كل سطر (مفصول بـ ;) ينكتب مثل الكتاب. السطر اللي بيه كلام عربي ينكتب نص.
 *  السطر الطويل ما ينقطع بنص المعادلة: ينزل سطر جديد بس عند «⇒» أو «→»، وكل قطعة كاملة بسطرها */
const ARROW = /\s*(?:=>|⇒|⟹|->|→|\\Rightarrow|\\to)\s*/;
export function MathText({ text }: { text: string }) {
  const parts = String(text ?? "").split(/\s*;\s*/).filter(Boolean);
  return (
    <div className="aimath" dir="ltr">
      {parts.map((p, i) => {
        if (/[\u0600-\u06FF]/.test(p)) return <div key={i} dir="rtl"><Inline text={p} /></div>;
        const pieces = p.split(ARROW).filter((x) => x.trim());
        return (
          <div key={i} className="aichain">
            {pieces.map((x, j) => <span key={j} className="aipiece" dangerouslySetInnerHTML={{ __html: (j ? mathHtml("\\Rightarrow") + " " : "") + mathHtml(x) }} />)}
          </div>
        );
      })}
    </div>
  );
}
/** جملة عربية بيها رياضيات بين $ $: الرياضيات تنكتب مثل الكتاب */
export function Inline({ text }: { text: string }) {
  const parts = String(text ?? "").split(/(\$[^$]+\$)/);
  // «$» بلا شريك ما ينكتب: ما يطلع للطالب علامة دولار وحيدة
  return <>{parts.map((p, i) => (p.startsWith("$") && p.endsWith("$") && p.length > 2
    ? <span key={i} dir="ltr" className="aiinl" dangerouslySetInnerHTML={{ __html: mathHtml(p.slice(1, -1)) }} />
    : <span key={i}>{p.replace(/\$/g, "")}</span>))}</>;
}

export default function AiCompare({ qs, fileUrl }: { qs: AiQ[]; fileUrl: (ref: string) => string }) {
  const [at, setAt] = useState(0);
  const [view, setView] = useState<"grade" | "paper">("grade");
  const [big, setBig] = useState<string | null>(null);
  const q = qs[Math.min(at, qs.length - 1)];
  if (!q) return null;
  const mark = (s: AiStep) => (s.awarded >= s.possible && s.possible > 0 ? "ok" : s.awarded <= 0 ? "bad" : "half");
  return (
    <div className="card aic">
      <h2>🤖 تصحيح كل سؤال</h2>
      <div className="aictabs">
        {qs.map((x, i) => <button type="button" key={x.n} className={i === at ? "on" : ""} onClick={() => { setAt(i); setView("grade"); }}>س{x.n} · {x.score}/{x.max}</button>)}
      </div>
      <div className="aichead"><b>السؤال {q.n}</b><span className={q.score >= q.max ? "aigood" : ""}><b>{q.score}</b> / {q.max}</span></div>
      <div className="aicview">
        <button type="button" className={view === "grade" ? "on" : ""} onClick={() => setView("grade")}>📝 التصحيح</button>
        <button type="button" className={view === "paper" ? "on" : ""} onClick={() => setView("paper")}>📷 ورقتي</button>
      </div>
      {view === "paper" ? (
        <div className="expad">{q.photos.map((p) => <img key={p} className="eximg" src={fileUrl(p)} alt={`جواب السؤال ${q.n}`} />)}</div>
      ) : (
        <div className="expad">
          {!!q.photos.length && (
            <div className="aicthumbs">
              {q.photos.map((p) => <button type="button" key={p} onClick={() => setBig(p)}><img src={fileUrl(p)} alt="جوابك" /></button>)}
              <small>اضغط على الصورة حتى تكبر</small>
            </div>
          )}
          {q.note && <div className="exhint">💬 <Inline text={q.note} /></div>}
          <div className="aicgrid">
            <div className="aiccol">📐 الحل النموذجي</div>
            <div className="aiccol">✍️ حلك</div>
            {q.steps.map((s, i) => (
              <div key={i} className="aicrow">
                <div className="aiccell"><MathText text={s.expected} /></div>
                <div className={"aiccell " + mark(s)}>
                  {s.failed || (s.student && !canRender(s.student))
                    ? <div className="aicfail">⚠️ {s.message || FAIL_TEXT}</div>
                    : s.student ? <MathText text={s.student} /> : <span className="aicmiss">ما مكتوب</span>}
                  <div className="aicmark">{mark(s) === "ok" ? "✅" : mark(s) === "bad" ? "❌" : "🟡"} {s.awarded} / {s.possible}</div>
                  {mark(s) !== "ok" && !s.failed && s.reason && <small><Inline text={s.reason} /></small>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {big && <div className="aicbig" onClick={() => setBig(null)}><img src={fileUrl(big)} alt="جوابك" /><span>✕</span></div>}
    </div>
  );
}
