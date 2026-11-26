"use client";
// 🤖 مراجعة تصحيح الذكاء: تختار مجموعة (امتحان + مكان + موعد)، وتنفتح أوراقها كلها بصفحة وحدة، طالب ورا طالب،
// ويا علامات الذكاء الحمرة ودرجة كل سؤال تگدر تبدلها وتحفظ بنفس المكان. وإعداد: الدرجات توصل مباشرة لو بعد ما تراجعها
import { useState } from "react";
import { MarkedPage, type MarkedPageT } from "../myexams/AiCompare";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Cfg = { mode: "after" | "before"; hours: number };
type Group = { key: string; exam: number; title: string; chapter: string; place: string; at: string; count: number; held: number; seen: boolean };
type Q = { n: number; max: number; mark: number; note: string; photos: string[]; marked: MarkedPageT[] | null };
type Paper = { id: number; name: string; held: boolean; total: number; questions: Q[] };
type Data = { cfg?: Cfg; owner?: boolean; groups?: Group[]; notice?: string; group?: Group | null; papers?: Paper[]; fileToken?: string; saved?: { changed: number; total: number } };

export default function AiReviewClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/aireview", "🤖 مراجعة تصحيح الذكاء");
  const [open, setOpen] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const c = cfg ?? data?.cfg ?? null;
  const openGroup = async (key: string) => { setOpen(key); window.scrollTo(0, 0); await call({ action: "group", key }, true); };
  const back = async () => { setOpen(null); await call({ action: "list" }); };
  const file = (ref: string) => `/api/aireview/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;

  if (open) {
    const g = data?.group;
    return (
      <>
        <AdminHeader title="🤖 مراجعة تصحيح الذكاء" />
        <div className="wrap">
          <div className="exline"><button type="button" className="exbtn" onClick={() => void back()}>⬅️ كل المجموعات</button></div>
          {g && <div className="card">
            <h2>{g.title}</h2>
            <div className="exhint">{g.chapter} · {g.place} · {g.at} · {g.count} ورقة</div>
            {g.held > 0 && <>
              <div className="exhint adtop">⏳ {g.held} درجة تنتظرك وما وصلت للطلاب. راجعها، وعدل اللي تريده، وبعدها:</div>
              <button type="button" className="btn adtop" disabled={busy} onClick={() => void call({ action: "approve", key: g.key }).then(() => openGroup(g.key))}>✅ وافقت، دزها للطلاب ({g.held})</button>
            </>}
          </div>}
          {!data?.papers && <div className="empty">جاري التحميل...</div>}
          {data?.papers?.map((p) => <PaperCard key={p.id} p={p} file={file} busy={busy} save={(marks) => call({ action: "save", item: p.id, marks }, true)} />)}
        </div>
        <style>{CSS}</style>
        <StatusBar busy={busy} error={error} notice={data?.notice} />
      </>
    );
  }

  return (
    <>
      <AdminHeader title="🤖 مراجعة تصحيح الذكاء" />
      <div className="wrap">
        {data?.owner && c && <div className="card">
          <h2>⚙️ درجات الذكاء توصل للطالب</h2>
          <label className="arv-opt"><input type="radio" checked={c.mode === "after"} onChange={() => setCfg({ ...c, mode: "after" })} /> <span><b>مباشرة، وأراجعها بعدين</b><small>إذا عدلت درجة، الطالب وولي أمره يوصلهم «تعديل درجة».</small></span></label>
          <label className="arv-opt"><input type="radio" checked={c.mode === "before"} onChange={() => setCfg({ ...c, mode: "before" })} /> <span><b>بعد ما أراجعها</b><small>الدرجات تنتظرك. توصلك رسالة من تخلص المجموعة، ومن توافق توصل كلها.</small></span></label>
          {c.mode === "before" && <div className="exline adtop"><span>إذا ما راجعتها، توصل وحدها بعد</span>
            <input className="exnum" style={{ width: 70 }} inputMode="numeric" value={c.hours} onChange={(e) => setCfg({ ...c, hours: Number(e.target.value.replace(/\D/g, "")) || 0 })} /><span>ساعة</span></div>}
          <button type="button" className="btn adtop" disabled={busy} onClick={() => void call({ action: "cfg", mode: c.mode, hours: c.hours }).then(() => setCfg(null))}>💾 حفظ</button>
        </div>}
        <div className="card">
          <h2>📋 المجموعات</h2>
          <div className="exhint">كل مجموعة: امتحان وحد، بمكان وحد، بنفس الموعد. دوسها تنفتح أوراقها كلها بصفحة وحدة.</div>
          {data?.groups && !data.groups.length && <div className="empty">ماكو أوراق صححها الذكاء بآخر 3 أسابيع.</div>}
          {data?.groups?.map((g) => (
            <button type="button" key={g.key} className={`arv-g${g.held ? " held" : ""}`} onClick={() => void openGroup(g.key)}>
              <b>{g.title}</b>
              <small>{g.chapter} · {g.place} · {g.at}</small>
              <span>{g.count} ورقة{g.held ? ` · ⏳ ${g.held} تنتظرك` : ""}{g.seen ? " · ✅ شفتها" : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <style>{CSS}</style>
      <StatusBar busy={busy} error={error} notice={data?.notice} />
    </>
  );
}

/** ورقة طالب: اسمه ودرجته، وكل سؤال بصفحاته وعلامات الذكاء، ومربع درجته */
function PaperCard({ p, file, busy, save }: { p: Paper; file: (ref: string) => string; busy: boolean; save: (marks: Record<number, number>) => Promise<Data | null> }) {
  const [marks, setMarks] = useState<Record<number, string>>(() => Object.fromEntries(p.questions.map((q) => [q.n, String(q.mark)])));
  const [total, setTotal] = useState(p.total);
  const changed = p.questions.filter((q) => marks[q.n] !== undefined && marks[q.n] !== String(q.mark));
  return (
    <div className="card arv-paper">
      <div className="arv-head"><b>👤 {p.name}</b><span className="arv-total">{total} من 100</span>{p.held && <span className="adentag">⏳ بعدها ما وصلت</span>}</div>
      {p.questions.map((q) => (
        <div key={q.n} className="arv-q">
          <div className="arv-qline">
            <b>س{q.n}</b>
            <input className="exnum" inputMode="decimal" value={marks[q.n] ?? ""} onChange={(e) => setMarks({ ...marks, [q.n]: e.target.value.replace(/[^\d.]/g, "") })} />
            <span>من {q.max}</span>
            {q.note && <small>{q.note}</small>}
          </div>
          {q.marked?.length ? q.marked.map((pg) => <MarkedPage key={pg.ref} src={file(pg.ref)} marks={pg.marks} />)
            : q.photos.map((ref) => <img key={ref} className="arv-img" src={file(ref)} alt="جواب الطالب" loading="lazy" />)}
        </div>
      ))}
      {!p.questions.length && <div className="exhint">ماكو تصحيح ذكاء محفوظ لهاي الورقة.</div>}
      <button type="button" className="btn adtop" disabled={busy || !changed.length} onClick={async () => {
        const r = await save(Object.fromEntries(changed.map((q) => [q.n, Number(marks[q.n])])));
        if (r?.saved) { setTotal(r.saved.total); for (const q of changed) q.mark = Number(marks[q.n]); setMarks({ ...marks }); }
      }}>{changed.length ? `💾 حفظ درجات ${p.name.split(" ")[0]}` : "ما غيرت شي"}</button>
    </div>
  );
}

const CSS = `
.arv-opt{display:flex;gap:10px;align-items:flex-start;margin-top:10px;cursor:pointer}.arv-opt input{width:20px;height:20px;margin-top:3px}
.arv-opt span{display:flex;flex-direction:column}.arv-opt small{opacity:.75;line-height:1.6}
.arv-g{display:flex;flex-direction:column;gap:2px;width:100%;text-align:right;margin-top:8px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:none;color:inherit;font:inherit;cursor:pointer}
.arv-g.held{border:2px solid #F6C94A}.arv-g small{opacity:.75}.arv-g span{font-weight:700;color:#F6C94A}
.arv-paper{border-right:5px solid #F6C94A}
.arv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:17px}.arv-total{margin-inline-start:auto;font-weight:800;color:#F6C94A}
.arv-q{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
.arv-qline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.arv-qline .exnum{width:64px}.arv-qline small{flex-basis:100%;opacity:.8}
.arv-img{width:100%;display:block;margin-top:8px;border-radius:8px;background:#fff}
`;
