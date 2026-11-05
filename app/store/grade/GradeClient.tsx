"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة: السؤال فوق جواب الطالب، وأزرار الدرجة
import { useEffect, useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Row = { id: number; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type Q = { n: number; max: number; image: string; answers: string[]; mark: number | null };
type Paper = Row & { answerPdf: string | null; questions: Q[] };
type Data = { waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

export default function GradeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/grade", "✍️ التصحيح");
  const [paper, setPaper] = useState<Paper | null>(null);
  const act: Call = async (b) => { const r = await call(b); if (r?.paper) setPaper(r.paper); return r; };
  const url = (ref: string) => `/api/grade/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  return (
    <>
      <AdminHeader title="✍️ التصحيح" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && paper && <Sheet key={paper.id} paper={paper} busy={busy} act={act} url={url} close={() => { setPaper(null); void call({ action: "list" }); }} />}
        {data && !paper && <List data={data} busy={busy} act={act} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function List({ data, busy, act }: { data: Data; busy: boolean; act: Call }) {
  return (
    <>
      {data.owner && (
        <div className="card expad adform">
          <div className="exlabel">🧪 أوراق تجربة</div>
          <div className="exhint">بدون طلاب حقيقيين وما توصل رسالة لأحد. جواب الطالب بيها هو صورة السؤال نفسه، بس حتى تجرب الشاشة.</div>
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

function Sheet({ paper, busy, act, url, close }: { paper: Paper; busy: boolean; act: Call; url: (r: string) => string; close: () => void }) {
  const firstOpen = paper.questions.find((q) => q.mark === null)?.n ?? paper.questions[0]?.n ?? 0;
  const [at, setAt] = useState(firstOpen);
  useEffect(() => { window.scrollTo(0, 0); }, [at]);
  const q = paper.questions.find((x) => x.n === at);
  const total = paper.questions.reduce((s, x) => s + (x.mark ?? 0), 0);
  const left = paper.questions.filter((x) => x.mark === null).length;
  const locked = !!paper.graded;
  async function press(mark: number) {
    await act({ action: "mark", id: paper.id, q: at, mark });
    // ينتقل للسؤال اللي بعده لوحده
    const i = paper.questions.findIndex((x) => x.n === at);
    if (i + 1 < paper.questions.length) setAt(paper.questions[i + 1].n);
  }
  return (
    <>
      <div className="card">
        <h2>{paper.name}{paper.test ? " (تجربة)" : ""}</h2>
        <div className="who">{paper.title} · نسخة {paper.model}<br />المجموع <b>{total}</b> من 100 · {left ? `باقي ${left} أسئلة` : "كل الأسئلة مصححة"}</div>
        <div className="expad exline">
          <button type="button" className="exbtn" onClick={close}>⬅️ رجوع للقائمة</button>
          {paper.answerPdf ? <a className="exbtn" href={url(paper.answerPdf)} target="_blank" rel="noreferrer">📄 الجواب النموذجي</a> : <span className="exhint">ماكو جواب نموذجي مرفوع</span>}
        </div>
      </div>
      <div className="chips adtabs">
        {paper.questions.map((x) => <button type="button" key={x.n} className={x.n === at ? "on" : ""} onClick={() => setAt(x.n)}>س{x.n}{x.mark !== null ? ` · ${x.mark}` : ""}</button>)}
      </div>
      {q && (
        <div className="card">
          <h2>السؤال {q.n} · من {q.max}</h2>
          <div className="expad adtop">
            <a href={url(q.image)} target="_blank" rel="noreferrer"><img className="eximg" src={url(q.image)} alt={`السؤال ${q.n}`} /></a>
            <div className="exlabel">جواب الطالب <small>(اضغط على الصورة حتى تكبر)</small></div>
            {q.answers.length ? q.answers.map((f) => <a key={f} href={url(f)} target="_blank" rel="noreferrer"><img className="eximg" src={url(f)} alt={`جواب ${q.n}`} /></a>) : <div className="exbad">⚠️ الطالب ما دز جواب لهذا السؤال.</div>}
            {!locked && <div className="grmarks">
              {Array.from({ length: q.max + 1 }, (_, m) => <button type="button" key={m} className={q.mark === m ? "on" : ""} disabled={busy} onClick={() => void press(m)}>{m}</button>)}
            </div>}
          </div>
        </div>
      )}
      {!locked && (
        <div className="exline adorderbtns">
          <Confirm label={`✅ خلصت: ${total} من 100`} disabled={busy || left > 0} onYes={async () => { if (await act({ action: "finish", id: paper.id })) close(); }} />
          <Confirm label="↩️ رجعها للقائمة" disabled={busy} onYes={async () => { if (await act({ action: "release", id: paper.id })) close(); }} />
        </div>
      )}
    </>
  );
}
