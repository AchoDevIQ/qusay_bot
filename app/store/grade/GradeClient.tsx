"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل الشاشة مثل النظام القديم (Grader)
import { useEffect, useRef, useState } from "react";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import Grader, { type Paper, type Prepared, type Sticker } from "./Grader";

type Row = { id: number; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type ObjRow = Row & { qs: number[] };
type Data = { objections: ObjRow[]; waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string; today: number; errors?: string[]; stickers?: Sticker[] };
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
  const saving = useRef(new Set<number>());
  const [savedNow, setSavedNow] = useState(0);
  const [bgErr, setBgErr] = useState("");
  const [savingLeft, setSavingLeft] = useState(0);
  useWide(!!paper || allDone);
  const act: Call = async (b) => { const r = await call(b); if (r?.paper) setPaper(r.paper); return r; };
  const url = (ref: string) => `/api/grade/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  /** الحفظ بالخلفية: المصحح ما ينتظر، تنفتح الورقة الجاية والدرجة توصل للطالب وراها */
  function saveInBackground(p: Paper, inkSaved: Promise<void>, compose: (x: Prepared) => Promise<Blob[]>, decide?: { rejects: Record<number, string>; accepted: number }) {
    saving.current.add(p.id);
    setSavingLeft(saving.current.size);
    setSavedNow((n) => n + 1);
    void (async () => {
      try {
        await inkSaved;
        const post = async (body: BodyInit, json: boolean) => {
          const res = await fetch("/api/grade", { method: "POST", ...(json ? { headers: { "Content-Type": "application/json" } } : {}), body });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error ?? "");
          return j;
        };
        const prep: Prepared = await post(JSON.stringify({ initData: pageAuth(), action: "prepare", id: p.id }), true);
        if (decide) {
          // رد الاعتراض: إذا انقبل شي توصل الورقة من جديد بالدرجة الجديدة
          let photos: Blob[] = [];
          if (decide.accepted) { try { photos = await compose(prep); } catch { photos = []; } }
          const fd = new FormData();
          fd.set("initData", pageAuth()); fd.set("action", "decide"); fd.set("id", String(p.id)); fd.set("rejects", JSON.stringify(decide.rejects));
          photos.forEach((b, i) => fd.append("photo", b, `p${i}.jpg`));
          await post(fd, false);
          return;
        }
        // الصفحة تركب صور الورقة المصححة، وإذا ما گدرت توصل الدرجة كرسالة بس
        let photos: Blob[] = [];
        try { photos = await compose(prep); } catch { photos = []; }
        if (photos.length) {
          const fd = new FormData();
          fd.set("initData", pageAuth()); fd.set("action", "finish"); fd.set("id", String(p.id)); fd.set("comment", String(prep.sent));
          photos.forEach((b, i) => fd.append("photo", b, `p${i}.jpg`));
          await post(fd, false);
        } else await post(JSON.stringify({ initData: pageAuth(), action: "finish", id: p.id, comment: prep.sent }), true);
      } catch (e) {
        setSavedNow((n) => n - 1);
        setBgErr(`⚠️ ورقة ${p.name} ما انحفظت${(e as Error).message ? `: ${(e as Error).message}` : ""}. افتحها من القائمة واحفظها مرة ثانية.`);
      } finally {
        saving.current.delete(p.id); setSavingLeft(saving.current.size);
        if (decide) void call({ action: "list" });
      }
    })();
    if (decide) {
      // بعد الرد تنفتح الورقة الجاية اللي عليها اعتراض، وإذا ماكو يرجع للقائمة
      const nextObj = data?.objections.find((x) => x.id !== p.id && !saving.current.has(x.id));
      setPaper(null);
      if (nextObj) void act({ action: "openObj", id: nextObj.id });
      return;
    }
    const nextPaper = data?.waiting.find((x) => x.id !== p.id && !skipped.current.has(x.id) && !saving.current.has(x.id));
    setPaper(null);
    if (nextPaper) void act({ action: "open", id: nextPaper.id });
    else setAllDone(true);
  }
  /** بعد ما تتخطى، تنفتح الورقة اللي بعدها وحدها */
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
        {data && paper && bgErr && <div className="gk-bgerr" onClick={() => setBgErr("")}>{bgErr} ✕</div>}
        {data && paper && (
          <Grader key={paper.id} paper={paper} url={url} busy={busy} act={act} today={data.today + savedNow} errors={data.errors ?? []} stickers={data.stickers ?? []} left={data.waiting.filter((x) => x.id !== paper.id && !saving.current.has(x.id)).length}
            onClose={() => { setPaper(null); setSavedNow(0); void call({ action: "list" }); }}
            onSkip={async () => { skipped.current.add(paper.id); await next(await call({ action: "release", id: paper.id })); }}
            onSave={(inkSaved, compose) => saveInBackground(paper, inkSaved, compose)}
            onDecide={(inkSaved, compose, rejects, accepted) => saveInBackground(paper, inkSaved, compose, { rejects, accepted })} />
        )}
        {data && !paper && allDone && (
          <div className="gk gk-done">
            <div className="gk-check">✓</div>
            <b>انتهت الأوراق المتاحة</b>
            <span>ماكو أوراق ثانية تنتظر التصحيح هسه.</span>
            {savingLeft > 0 && <span className="gk-err">⏳ جاري حفظ {savingLeft} ورقة وإرسالها للطلاب. لا تسد الصفحة لحد ما تخلص.</span>}
            {bgErr && <span className="gk-err">{bgErr}</span>}
            <button type="button" className="gk-finish" onClick={() => { setAllDone(false); skipped.current.clear(); setSavedNow(0); void call({ action: "list" }); }}>رجوع للقائمة</button>
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
      {!!data.objections.length && (
        <div className="card">
          <h2>✋ اعتراضات تنتظر ردك: {data.objections.length}</h2>
          <table className="extable"><tbody>
            {data.objections.map((p) => (
              <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "openObj", id: p.id }); }}>
                <td><b>{p.name}</b>{p.test && <span className="adentag">تجربة</span>}<small className="pdmode">{p.title} · الدرجة {p.total} · على السؤال {p.qs.join("، ")}{p.grader ? ` · صححها ${p.grader}` : ""}</small></td>
                <td className="p"><span className="exbtn">رد</span></td>
              </tr>
            ))}
          </tbody></table>
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
            {data.done.map((p) => (
              <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "open", id: p.id }); }}>
                <td><b>{p.name}</b>{p.test && <span className="adentag">تجربة</span>}<small className="pdmode">{p.title} · {p.graded}</small>
                  {p.test && data.owner && <button type="button" className="exbtn adtop" disabled={busy} onClick={(e) => { e.stopPropagation(); void act({ action: "testObj", id: p.id }); }}>🧪 سوي اعتراض تجربة</button>}
                </td>
                <td className="p">{p.total}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}
