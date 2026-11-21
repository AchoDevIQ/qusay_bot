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
/** علامة حمرة على صورة الورقة (x و y من 0 لـ 1000): ✓ صح، ✗ غلط، نص درجة، ودرجة السؤال بدائرة */
export type PaperMark = { x: number; y: number; kind: "ok" | "half" | "bad" | "score"; text: string; note?: string };
export type MarkedPageT = { ref: string; marks: PaperMark[] };
export type AiQ = { n: number; score: number; max: number; note: string; photos: string[]; steps: AiStep[]; by?: "qusay"; marked?: MarkedPageT[] };

const Tick = () => <svg viewBox="0 0 44 32" width="34" height="25" aria-hidden><path d="M3 17 Q9 21 15 29 Q24 11 41 3" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Cross = () => <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden><path d="M5 5 Q16 15 27 28 M27 4 Q15 16 5 27" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" /></svg>;
/** صورة ورقة الطالب وعليها تصحيح بقلم أحمر مثل المدرس: ✓ و✗ يم كل خطوة، ودرجة السؤال بدائرة، وملاحظة قصيرة بخط اليد */
export function MarkedPage({ src, marks }: { src: string; marks: PaperMark[] }) {
  return (
    <div className="mkpage">
      <img src={src} alt="ورقة الطالب" />
      {marks.map((m, i) => (
        <div key={i} className={"mk mk-" + m.kind} style={{ left: `${m.x / 10}%`, top: `${m.y / 10}%` }}>
          {m.kind === "score" ? <span className="mkscore">{m.text}</span> : <>
            {m.kind === "bad" ? <Cross /> : <Tick />}
            {m.text && <b className="mkhalf">{m.text}</b>}
          </>}
          {m.note && <span className={"mknote" + (m.x > 500 ? " mkleft" : "")}><Inline text={m.note} /></span>}
        </div>
      ))}
    </div>
  );
}

/** كلام عربي ويا رياضيات مكتوبة بدون $ (x/2 ، pi): كل قطعة مو عربية بيها حرف أو رقم تنرسم رياضيات
 *  (الكسر أفقي، والباي π)، والعربي يبقى كلام مثل ما هو */
function Mixed({ text }: { text: string }) {
  const parts = text.split(/([^؀-ۿ]+)/);
  return <>{parts.map((p, i) => {
    const t = p.trim();
    const plainNum = /^[\d\s.,:()-]+$/.test(t);
    if (!t || /[؀-ۿ]/.test(p) || !/[A-Za-z0-9π√]/.test(t) || plainNum) return <span key={i}>{p}</span>;
    const lead = /^\s*/.exec(p)![0], tail = /\s*$/.exec(p)![0];
    return <span key={i}>{lead}<span dir="ltr" className="aiinl" dangerouslySetInnerHTML={{ __html: mathHtml(t) }} />{tail}</span>;
  })}</>;
}


/** خطوة رياضيات: كل سطر (مفصول بـ ;) ينكتب مثل الكتاب. السطر اللي بيه كلام عربي ينكتب نص.
 *  ما يطلع شريط سحب: السطر الطويل ينزل سطر جديد عند «⇒» أو «→»، والقطعة اللي ما تساع تنكسر عند = و+ و- */
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
  if (!String(text ?? "").includes("$")) return <Mixed text={String(text ?? "")} />;
  const parts = String(text ?? "").split(/(\$[^$]+\$)/);
  // «$» بلا شريك ما ينكتب: ما يطلع للطالب علامة دولار وحيدة
  return <>{parts.map((p, i) => (p.startsWith("$") && p.endsWith("$") && p.length > 2
    ? <span key={i} dir="ltr" className="aiinl" dangerouslySetInnerHTML={{ __html: mathHtml(p.slice(1, -1)) }} />
    : <span key={i}>{p.replace(/\$/g, "")}</span>))}</>;
}

export default function AiCompare({ qs, fileUrl }: { qs: AiQ[]; fileUrl: (ref: string) => string }) {
  const [at, setAt] = useState(0);
  const hasMarks = (x: AiQ | undefined) => !!x?.marked?.some((p) => p.marks.length);
  const [view, setView] = useState<"grade" | "paper" | "marked">(hasMarks(qs[0]) ? "marked" : "grade");
  const [big, setBig] = useState<string | null>(null);
  const q = qs[Math.min(at, qs.length - 1)];
  if (!q) return null;
  const marked = hasMarks(q);
  const mark = (s: AiStep) => (s.awarded >= s.possible && s.possible > 0 ? "ok" : s.awarded <= 0 ? "bad" : "half");
  return (
    <div className="card aic">
      {/* «تصحيح قصي»: مثل ورقة صححها المدرس، بدون روبوت (طلب الأستاذ 2026-11-21) */}
      <h2>{q.by === "qusay" ? "✍️ تصحيح ورقتك" : "🤖 تصحيح كل سؤال"}</h2>
      <div className="aictabs">
        {qs.map((x, i) => <button type="button" key={x.n} className={i === at ? "on" : ""} onClick={() => { setAt(i); setView(hasMarks(x) ? "marked" : "grade"); }}>س{x.n} · {x.score}/{x.max}</button>)}
      </div>
      <div className="aichead"><b>السؤال {q.n}</b><span className={q.score >= q.max ? "aigood" : ""}><b>{q.score}</b> / {q.max}</span></div>
      <div className="aicview">
        {marked && <button type="button" className={view === "marked" ? "on" : ""} onClick={() => setView("marked")}>🖍 ورقتي مصححة</button>}
        <button type="button" className={view === "grade" ? "on" : ""} onClick={() => setView("grade")}>{marked ? "📝 التفصيل" : "📝 التصحيح"}</button>
        {!marked && <button type="button" className={view === "paper" ? "on" : ""} onClick={() => setView("paper")}>📷 ورقتي</button>}
      </div>
      {view === "marked" && marked ? (
        <div className="expad">{q.marked!.map((p) => <MarkedPage key={p.ref} src={fileUrl(p.ref)} marks={p.marks} />)}</div>
      ) : view === "paper" ? (
        <div className="expad">{q.photos.map((p) => <img key={p} className="eximg" src={fileUrl(p)} alt={`جواب السؤال ${q.n}`} />)}</div>
      ) : (
        <div className="expad">
          {/* «تصحيح قصي»: صورة الجواب بس بزر «📷 ورقتي»، مو جوة التصحيح (طلب الأستاذ 2026-11-21) */}
          {!!q.photos.length && q.by !== "qusay" && (
            <div className="aicthumbs">
              {q.photos.map((p) => <button type="button" key={p} onClick={() => setBig(p)}><img src={fileUrl(p)} alt="جوابك" /></button>)}
              <small>اضغط على الصورة حتى تكبر</small>
            </div>
          )}
          {q.note && <div className="exhint">💬 <Inline text={q.note} /></div>}
          <div className="aicgrid">
            <div className="aiccol">📐 الحل النموذجي</div>
            <div className="aiccol">{q.by === "qusay" ? "📝 التصحيح" : "✍️ حلك"}</div>
            {q.steps.map((s, i) => (
              <div key={i} className="aicrow">
                <div className="aiccell"><MathText text={s.expected} /></div>
                <div className={"aiccell " + mark(s)}>
                  {q.by === "qusay" ? (s.student ? <div dir="rtl"><Inline text={s.student} /></div> : <span className="aicmiss">—</span>) : s.failed || (s.student && !canRender(s.student))
                    ? <div className="aicfail">⚠️ {s.message || FAIL_TEXT}</div>
                    : s.student ? <MathText text={s.student} /> : <span className="aicmiss">ما مكتوب</span>}
                  <div className="aicmark">{mark(s) === "ok" ? "✅" : mark(s) === "bad" ? "❌" : "🟡"} {s.awarded} / {s.possible}</div>
                  {q.by !== "qusay" && mark(s) !== "ok" && !s.failed && s.reason && <small><Inline text={s.reason} /></small>}
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
