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
/** c: لون الكتابة (من ألوان «✍️ خط إيدي»)، wd: السمك 1 رفيع، 2 وسط، 3 ثخين (طلب الأستاذ 2026-11-22). القديمة بدونهم: أحمر ووسط */
export type InkShape = { w: number; h: number; s: number[][]; c?: string; wd?: 1 | 2 | 3 };
/** ألوان القلم، الأحمر أول (الأصل) */
export const INK_COLORS: { c: string; t: string }[] = [
  { c: "#d40000", t: "أحمر" }, { c: "#1d4ed8", t: "أزرق" }, { c: "#15803d", t: "أخضر" },
  { c: "#111111", t: "أسود" }, { c: "#7e22ce", t: "بنفسجي" }, { c: "#ea580c", t: "برتقالي" },
];
/** سمك الخط على ورقة الطالب (بكسل)، لكل اختيار */
export const INK_WIDTH: Record<1 | 2 | 3, number> = { 1: 1.7, 2: 2.6, 3: 3.8 };
/** sym ✓/✗، word المدح، hand الملاحظة: بخط إيد الأستاذ إذا كاتبها بـ «✍️ خط إيدي» */
export type PaperMark = { x: number; y: number; kind: "ok" | "half" | "bad" | "score" | "good" | "miss"; text: string; big?: boolean; box?: { y0: number; y1: number }; col?: string; q?: number; i?: number; note?: string; sym?: InkShape; word?: InkShape; hand?: InkShape; rot?: number; sc?: number };
export type MarkedPageT = { ref: string; marks: PaperMark[] };
export type AiQ = { n: number; score: number; max: number; note: string; photos: string[]; steps: AiStep[]; by?: "qusay"; marked?: MarkedPageT[] };

const Tick = () => <svg viewBox="0 0 44 32" width="34" height="25" aria-hidden><path d="M3 17 Q9 21 15 29 Q24 11 41 3" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Cross = () => <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden><path d="M5 5 Q16 15 27 28 M27 4 Q15 16 5 27" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" /></svg>;
/** حجم خط الإيد على الورقة: سطر الكتابة بصفحة «✍️ خط إيدي» (120) يصير 30 بكسل، فكل شي بحجمه مثل ما كتبه */
export const INK_PX = 0.25;
/** الخط الناعم: منتصف كل نقطتين، نفس قلم الآيباد */
export function inkPath(p: number[]) {
  if (p.length <= 2) return `M${p[0]} ${p[1]}l0.1 0`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) d += `Q${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`;
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}
/** كتابة الأستاذ بالأحمر، مقصوصة على حجمها (بدون فراغ المربع) وخلفيتها شفافة */
export function InkSvg({ sh, k = INK_PX, color = "currentColor", width, cap, fill }: { sh: InkShape; k?: number; color?: string; width?: number; cap?: number; fill?: boolean }) {
  // لونه وسمكه اللي اختارهم الأستاذ وهو يكتب. الخط القديم بدونهم: لون العلامة وسمك وسط
  const stroke = INK_COLORS.some((x) => x.c === sh.c) ? sh.c! : color, sw = width ?? INK_WIDTH[sh.wd ?? 2] ?? 2.6;
  const all = sh.s.flat();
  const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
  if (!xs.length) return null;
  const pad = 8, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
  // fill: تنمد على المكان كله (الصح الكبيرة على عرض الصفحة)، وخطها أثخن
  if (fill) return (
    <svg className="mkink" viewBox={`${x0} ${y0} ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
      {sh.s.map((p, i) => <path key={i} d={inkPath(p)} fill="none" stroke={stroke} strokeWidth={Math.max(sw, 5)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
  return (
    // cap: أكبر عرض كنسبة من عرض الورقة (cqw)، حتى الصح ما يطلع أكبر من سطر الطالب بالشاشة الصغيرة (طلبه 2026-11-23)
    <svg className="mkink" viewBox={`${x0} ${y0} ${w} ${h}`} width={w * k} height={h * k} aria-hidden
      style={cap ? { width: `min(${w * k}px, ${cap}cqw)`, height: `min(${h * k}px, ${(cap * h / w).toFixed(2)}cqw)` } : undefined}>
      {sh.s.map((p, i) => <path key={i} d={inkPath(p)} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
/** صورة ورقة الطالب وعليها تصحيح بقلم أحمر مثل المدرس: ✓ و✗ يم كل خطوة، ودرجة السؤال بدائرة، وملاحظة قصيرة بخط اليد */
/** onTap: صاحب البوت يدوس على العلامة حتى يشيلها لو يصلحها (طلبه 2026-11-23) */
export function MarkedPage({ src, marks, onTap, picked }: { src: string; marks: PaperMark[]; onTap?: (m: PaperMark, k: number) => void; picked?: number }) {
  return (
    <div className="mkpage">
      <img src={src} alt="ورقة الطالب" />
      {marks.map((m, i) => m.big && m.box ? (
        // ✓ الكبيرة: على عرض الصفحة كلها، من الزاوية اليسرى جوة للزاوية اليمنى فوك
        <div key={i} className={"mkfull" + (onTap ? " mktap" : "") + (picked === i ? " mkpicked" : "")} style={{ top: `${m.box.y0 / 10}%`, height: `${(m.box.y1 - m.box.y0) / 10}%`, ...(m.col ? { color: m.col } : {}) }}
          onClick={onTap ? () => onTap(m, i) : undefined}>
          {m.sym ? <InkSvg sh={m.sym} fill /> : <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden><path d="M3 62 Q14 74 26 96 Q55 40 97 4" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>}
        </div>
      ) : m.big && m.kind === "miss" ? (
        // «الحل ناقص» كبيرة وحدة بخطه (لو بالرقعة إذا ما كاتبها) بدل «ما كتبتها» على كل خطوة
        <div key={i} className={"mk mkshort" + (onTap ? " mktap" : "") + (picked === i ? " mkpicked" : "")} style={{ left: `${m.x / 10}%`, top: `${m.y / 10}%`, ...(m.col ? { color: m.col } : {}) }}
          onClick={onTap ? () => onTap(m, i) : undefined}>
          {m.hand ? <InkSvg sh={m.hand} cap={60} width={4} /> : <b style={m.col ? { color: m.col } : undefined}>{m.note || "الحل ناقص"}</b>}
        </div>
      ) : (
        <div key={i} className={"mk mk-" + m.kind + (onTap ? " mktap" : "") + (picked === i ? " mkpicked" : "")} style={{ left: `${m.x / 10}%`, top: `${m.y / 10}%`, ...(m.col ? { color: m.col } : {}) }}
          onClick={onTap ? () => onTap(m, i) : undefined}>
          {m.kind === "score" ? <span className="mkscore">{m.text}</span> : (
            // خط إيده يميل ويكبر ويصغر شوية بكل علامة، حتى ما تبين نسخة وحدة
            <span className="mkjit" style={m.rot || m.sc ? { transform: `rotate(${m.rot ?? 0}deg) scale(${m.sc ?? 1})` } : undefined}>
              {m.sym ? <InkSvg sh={m.sym} cap={m.big ? 20 : 9} /> : m.kind === "good" ? null : m.kind === "bad" ? <Cross /> : m.kind === "miss" ? <b className="mkask">؟</b> : m.big ? <span className="mkbig"><Tick /></span> : <Tick />}
              {m.word ? <InkSvg sh={m.word} cap={30} /> : m.text && <b className={m.kind === "good" ? "mkgood" : "mkhalf"}>{m.text}</b>}
            </span>
          )}
          {/* الملاحظة بآخر الصفحة تنكتب فوك العلامة، لا تنزل برة الورقة وتنخفي (طلبه 2026-11-23) */}
          {m.hand ? <span className={"mknote mkhand" + (m.x > 500 ? " mkleft" : "") + (m.y > 740 ? " mkup" : "")}><InkSvg sh={m.hand} cap={45} /></span>
            : m.note && <span className={"mknote" + (m.x > 500 ? " mkleft" : "") + (m.y > 740 ? " mkup" : "")} style={m.col ? { color: m.col } : undefined}><Inline text={m.note} /></span>}
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
  // التفصيل مثل مؤمل (طلبه 2026-11-24): «✍️ حلك» شنو كاتب الطالب بكل خطوة، وتحته ليش نقص. تصحيح قصي القديم بدون كتابة الطالب: الملاحظة بس
  const typed = q.by !== "qusay" || q.steps.some((s) => s.student);
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
          {/* صورة الجواب صغيرة فوك، تندس وتكبر: مثل مؤمل لكل المصححين (طلب الأستاذ 2026-11-24، بدال طلب 2026-11-21) */}
          {!!q.photos.length && (
            <div className="aicthumbs">
              {q.photos.map((p) => <button type="button" key={p} onClick={() => setBig(p)}><img src={fileUrl(p)} alt="جوابك" /></button>)}
              <small>اضغط على الصورة حتى تكبر</small>
            </div>
          )}
          {q.note && <div className="exhint">💬 <Inline text={q.note} /></div>}
          <div className="aicgrid">
            <div className="aiccol">📐 الحل النموذجي</div>
            <div className="aiccol">{typed ? "✍️ حلك" : "📝 التصحيح"}</div>
            {q.steps.map((s, i) => (
              <div key={i} className="aicrow">
                <div className="aiccell"><MathText text={s.expected} /></div>
                <div className={"aiccell " + mark(s)}>
                  {!typed ? (s.reason ? <div dir="auto"><Inline text={s.reason} /></div> : mark(s) === "ok" ? <span className="aicok">✓</span> : <span className="aicmiss">—</span>) : s.failed || (s.student && !canRender(s.student))
                    ? <div className="aicfail">⚠️ {s.message || FAIL_TEXT}</div>
                    : s.student ? <MathText text={s.student} /> : <span className="aicmiss">ما مكتوب</span>}
                  <div className="aicmark">{mark(s) === "ok" ? "✅" : mark(s) === "bad" ? "❌" : "🟡"} {s.awarded} / {s.possible}</div>
                  {typed && mark(s) !== "ok" && !s.failed && s.reason && <small><Inline text={s.reason} /></small>}
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
