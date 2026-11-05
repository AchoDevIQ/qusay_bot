"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل عرض الجهاز: ورقة الطالب كبيرة، والدرجات بشريط ثابت جوة
import { useEffect, useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import PdfPages from "../PdfPages";

type Row = { id: number; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type Q = { n: number; max: number; image: string; answers: string[]; mark: number | null };
type Paper = Row & { answerPdf: string | null; whole: string[]; questions: Q[] };
type Data = { waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
type FullApp = { isVersionAtLeast?(v: string): boolean; requestFullscreen?(): void; exitFullscreen?(): void; isFullscreen?: boolean };
const tgApp = () => (window as unknown as { Telegram?: { WebApp?: FullApp } }).Telegram?.WebApp;

/** الورقة تاخذ كل الشاشة: عرض كامل، وملء الشاشة بتليجرام إذا يدعمه */
function useWide(on: boolean) {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add("grwide");
    const w = tgApp();
    try { if (w?.isVersionAtLeast?.("8.0") && !w.isFullscreen) w.requestFullscreen?.(); } catch { /* نسخة قديمة */ }
    return () => { document.body.classList.remove("grwide"); };
  }, [on]);
}

export default function GradeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/grade", "✍️ التصحيح");
  const [paper, setPaper] = useState<Paper | null>(null);
  useWide(!!paper);
  const act: Call = async (b) => { const r = await call(b); if (r?.paper) setPaper(r.paper); return r; };
  const url = (ref: string) => `/api/grade/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  return (
    <>
      {!paper && <AdminHeader title="✍️ التصحيح" />}
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && paper && <Sheet key={paper.id} paper={paper} busy={busy} act={act} url={url} close={() => { setPaper(null); void call({ action: "list" }); }} />}
        {data && !paper && <List data={data} busy={busy} act={act} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={paper ? "" : data?.notice} />
    </>
  );
}

function List({ data, busy, act }: { data: Data; busy: boolean; act: Call }) {
  return (
    <>
      {data.owner && (
        <div className="card expad adform">
          <div className="exlabel">🧪 أوراق تجربة</div>
          <div className="exhint">5 أوراق عشوائية بدون طلاب حقيقيين، وما توصل رسالة لأحد. ورقة "الطالب" بيها هي الحل النموذجي للنسخة، حتى تجرب التصحيح على ورقة محلولة.</div>
          <div className="exline">
            <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "makeTests" })}>🧪 سوي أوراق تجربة</button>
            {data.hasTests && <Confirm label="🗑 امسح أوراق التجربة" disabled={busy} onYes={() => void act({ action: "deleteTests" })} />}
          </div>
        </div>
      )}
      <div className="card">
        <h2>📥 تنتظر التصحيح: {data.waiting.length}</h2>
        {data.waiting.length ? (
          <table className="extable"><tbody>
            {data.waiting.map((p) => (
              <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "open", id: p.id }); }}>
                <td><b>{p.name}</b>{p.test && <span className="adentag">تجربة</span>}<small className="pdmode">{p.chapter} · {p.title} · نسخة {p.model}</small></td>
                <td className="p"><span className="exbtn">صحح</span></td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="empty">✅ ماكو أوراق تنتظر.</div>}
      </div>
      {!!data.done.length && (
        <div className="card">
          <h2>✅ صححتها أخيراً</h2>
          <table className="extable"><tbody>
            {data.done.map((p) => <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "open", id: p.id }); }}><td><b>{p.name}</b><small className="pdmode">{p.title} · {p.graded}</small></td><td className="p">{p.total}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </>
  );
}

const isPdf = (f: string) => /\.pdf$/i.test(f);
function Sheet({ paper, busy, act, url, close }: { paper: Paper; busy: boolean; act: Call; url: (r: string) => string; close: () => void }) {
  const firstOpen = paper.questions.find((q) => q.mark === null)?.n ?? paper.questions[0]?.n ?? 0;
  const [at, setAt] = useState(firstOpen);
  const [view, setView] = useState<"student" | "model">("student");
  const [showQ, setShowQ] = useState(false);
  const q = paper.questions.find((x) => x.n === at);
  const total = paper.questions.reduce((s, x) => s + (x.mark ?? 0), 0);
  const left = paper.questions.filter((x) => x.mark === null).length;
  const locked = !!paper.graded;
  const file = (f: string) => isPdf(f) ? <PdfPages key={f} url={url(f)} outside={false} /> : <img key={f} className="eximg" src={url(f)} alt="ورقة الطالب" />;
  function pick(n: number) {
    setAt(n); setShowQ(false);
    // إذا الطالب دز جواب لكل سؤال، تنزل الصفحة لجوابه
    document.getElementById(`gr-q${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function press(mark: number) {
    if (!await act({ action: "mark", id: paper.id, q: at, mark })) return;
    const i = paper.questions.findIndex((x) => x.n === at);
    if (i + 1 < paper.questions.length) pick(paper.questions[i + 1].n);
  }
  const perQuestion = paper.questions.some((x) => x.answers.length);
  return (
    <>
      <div className="grtop">
        <button type="button" className="exbtn" onClick={close}>⬅️ رجوع للقائمة</button>
        <div><b>{paper.name}{paper.test ? " (تجربة)" : ""}</b> <small className="pdmode">{paper.title} · نسخة {paper.model}</small></div>
        <span className="grsum">{total} من 100</span>
      </div>
      <div className="chips extabs">
        <button type="button" className={view === "student" ? "on" : ""} onClick={() => setView("student")}>📝 ورقة الطالب</button>
        <button type="button" className={view === "model" ? "on" : ""} onClick={() => setView("model")}>📘 الجواب النموذجي</button>
      </div>
      <div className="grpaper">
        {view === "model" && (paper.answerPdf ? <PdfPages url={url(paper.answerPdf)} outside={false} /> : <div className="empty">ماكو جواب نموذجي مرفوع لهذي النسخة.</div>)}
        {view === "student" && (
          <>
            {paper.whole.map(file)}
            {perQuestion && paper.questions.map((x) => (
              <div key={x.n} id={`gr-q${x.n}`}>
                <span className="grqtag">جواب س{x.n}</span>
                {x.answers.length ? x.answers.map(file) : <div className="exbad">⚠️ الطالب ما دز جواب لهذا السؤال.</div>}
              </div>
            ))}
            {!paper.whole.length && !perQuestion && <div className="empty">⚠️ الطالب ما دز أي جواب.</div>}
          </>
        )}
      </div>
      <div className="grbar">
        <div className="chips">
          {paper.questions.map((x) => <button type="button" key={x.n} className={x.n === at ? "on" : ""} onClick={() => pick(x.n)}>س{x.n}{x.mark !== null ? ` · ${x.mark}` : ""}</button>)}
        </div>
        {q && (
          <>
            <div className="exline">
              <b>السؤال {q.n} · من {q.max}</b>
              <button type="button" className="exbtn" onClick={() => setShowQ(!showQ)}>{showQ ? "إخفاء السؤال" : "👁 شوف السؤال"}</button>
              <span className="exhint">{left ? `باقي ${left}` : "كلها مصححة"}</span>
            </div>
            {showQ && <div className="grq"><img className="eximg" src={url(q.image)} alt={`السؤال ${q.n}`} /></div>}
            {!locked && <div className="grmarks">
              {Array.from({ length: q.max + 1 }, (_, m) => <button type="button" key={m} className={q.mark === m ? "on" : ""} disabled={busy} onClick={() => void press(m)}>{m}</button>)}
            </div>}
          </>
        )}
        {!locked ? (
          <div className="exline">
            <Confirm label={`✅ خلصت: ${total} من 100`} disabled={busy || left > 0} onYes={async () => { if (await act({ action: "finish", id: paper.id })) close(); }} />
            <Confirm label="↩️ رجعها للقائمة" disabled={busy} onYes={async () => { if (await act({ action: "release", id: paper.id })) close(); }} />
          </div>
        ) : <div className="exhint">✅ هذي الورقة مصححة: {paper.total} من 100</div>}
      </div>
    </>
  );
}
