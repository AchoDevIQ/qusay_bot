"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل الشاشة مثل النظام القديم (Grader)
import { useEffect, useRef, useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import Grader, { type Paper } from "./Grader";

type Row = { id: number; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type Data = { waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string; today: number };
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
  const [allDone, setAllDone] = useState(false);
  const skipped = useRef(new Set<number>());
  useWide(!!paper || allDone);
  const act: Call = async (b) => { const r = await call(b); if (r?.paper) setPaper(r.paper); return r; };
  const url = (ref: string) => `/api/grade/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  /** بعد ما تخلص أو تتخطى، تنفتح الورقة اللي بعدها وحدها */
  async function next(r: Data | null) {
    const p = r?.waiting.find((x) => !skipped.current.has(x.id));
    setPaper(null);
    if (p) await act({ action: "open", id: p.id });
    else setAllDone(true);
  }
  return (
    <>
      {!paper && !allDone && <AdminHeader title="✍️ التصحيح" />}
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && paper && (
          <Grader key={paper.id} paper={paper} url={url} busy={busy} act={act} today={data.today} left={data.waiting.filter((x) => x.id !== paper.id).length}
            onClose={() => { setPaper(null); void call({ action: "list" }); }}
            onSkip={async () => { skipped.current.add(paper.id); await next(await call({ action: "release", id: paper.id })); }}
            onFinish={async () => { const r = await call({ action: "finish", id: paper.id }); if (r) await next(r); }} />
        )}
        {data && !paper && allDone && (
          <div className="gk gk-done">
            <div className="gk-check">✓</div>
            <b>انتهت الأوراق المتاحة</b>
            <span>ماكو أوراق ثانية تنتظر التصحيح هسه.</span>
            <button type="button" className="gk-finish" onClick={() => { setAllDone(false); skipped.current.clear(); void call({ action: "list" }); }}>إغلاق</button>
          </div>
        )}
        {data && !paper && !allDone && <List data={data} busy={busy} act={act} />}
      </div>
      {!paper && !allDone && <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />}
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
