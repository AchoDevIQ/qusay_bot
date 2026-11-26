"use client";
// 🤖 مراجعة تصحيح الذكاء: تختار مجموعة (امتحان + مكان + موعد)، وتنفتح أوراقها كلها بصفحة وحدة، طالب ورا طالب،
// ويا علامات الذكاء الحمرة ودرجة كل سؤال تگدر تبدلها وتحفظ بنفس المكان. وإعداد: الدرجات توصل مباشرة لو بعد ما تراجعها
import { useState } from "react";
import { MarkedPage, type MarkedPageT, type PaperMark } from "../myexams/AiCompare";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Cfg = { mode: "after" | "before"; hours: number };
type Group = { key: string; exam: number; title: string; chapter: string; place: string; at: string; count: number; held: number; seen: boolean };
type Q = { n: number; max: number; mark: number; note: string; photos: string[]; marked: MarkedPageT[] | null };
type Paper = { id: number; name: string; held: boolean; total: number; by: string; questions: Q[] };
type Data = { cfg?: Cfg; owner?: boolean; groups?: Group[]; notice?: string; group?: Group | null; papers?: Paper[]; fileToken?: string; saved?: { changed: number; total: number }; paper?: Paper | null };
type Call = (b: Record<string, unknown>, merge?: boolean) => Promise<Data | null>;
const markKey = (m: PaperMark) => m.fixed ?? `${m.q}:${m.i ?? -1}:${m.kind}`;
const KINDS: { k: "ok" | "half" | "bad" | "good"; t: string }[] = [{ k: "ok", t: "✓ صح" }, { k: "half", t: "½ نص" }, { k: "bad", t: "✗ غلط" }, { k: "good", t: "👍 ممتاز" }];

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
          {data?.papers?.map((p, i) => <PaperCard key={p.id} p={p} n={i + 1} of={data.papers!.length} file={file} busy={busy} gkey={open} call={call} save={(marks) => call({ action: "save", item: p.id, marks }, true)} />)}
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
/** ورقة طالب. n: رقمه بالمجموعة: الطلاب يتناوبون باللون (إطار أزرق وجوه ذهبي، والجاي بالعكس) حتى تبين وين تخلص ورقة وتبدي اللي بعدها (طلبه 2026-11-27) */
function PaperCard({ p: start, n, of, file, busy, save, gkey, call }: { p: Paper; n: number; of: number; file: (ref: string) => string; busy: boolean; save: (marks: Record<number, number>) => Promise<Data | null>; gkey: string; call: Call }) {
  const [p, setP] = useState(start);
  // ✏️ أدوات التصحيح مخفية: كل سؤال يطلع بدرجته وورقته بس، ودوسة «✏️» تطلع أدواته (الدرجة، العلامات، ضيف علامة)
  const [edit, setEdit] = useState<Record<number, boolean>>({});
  const [marks, setMarks] = useState<Record<number, string>>(() => Object.fromEntries(start.questions.map((q) => [q.n, String(q.mark)])));
  // ✏️ تعديل التصحيح على الورقة: علامة مختارة، أو «➕ ضيف علامة» ينتظر دوسة على الصفحة
  const [tap, setTap] = useState<{ ref: string; m: PaperMark } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [spot, setSpot] = useState<{ ref: string; x: number; y: number } | null>(null);
  const markCall = async (b: Record<string, unknown>) => { const r = await call({ ...b, item: p.id, key2: gkey }, true); if (r?.paper) setP(r.paper); setTap(null); setSpot(null); setAdding(null); };
  const pick = (e: React.MouseEvent<HTMLDivElement>, ref: string) => {
    if (adding !== ref) return;
    const img = e.currentTarget.querySelector("img");
    if (!img) return;
    const b = img.getBoundingClientRect();
    e.preventDefault(); e.stopPropagation();
    setSpot({ ref, x: Math.round(((e.clientX - b.left) / b.width) * 1000), y: Math.round(((e.clientY - b.top) / b.height) * 1000) });
  };
  const [total, setTotal] = useState(p.total);
  const changed = p.questions.filter((q) => marks[q.n] !== undefined && marks[q.n] !== String(q.mark));
  return (
    <div className={"card arv-paper " + (n % 2 ? "arv-a" : "arv-b")}>
      <div className="arv-start">👤 الطالب {n} من {of}: <b>{p.name}</b></div>
      <div className="arv-head"><span className="arv-by">{p.by}</span><span className="arv-total">{total} من 100</span>{p.held && <span className="adentag">⏳ بعدها ما وصلت</span>}</div>
      {p.questions.map((q) => (
        <div key={q.n} className="arv-q">
          <div className="arv-qline">
            <b>س{q.n}</b>
            {edit[q.n]
              ? <><input className="exnum" inputMode="decimal" value={marks[q.n] ?? ""} onChange={(e) => setMarks({ ...marks, [q.n]: e.target.value.replace(/[^\d.]/g, "") })} /><span>من {q.max}</span></>
              : <span className="arv-mark">{marks[q.n] ?? q.mark} من {q.max}</span>}
            <button type="button" className={"arv-pen" + (edit[q.n] ? " on" : "")} aria-label="تعديل" title="تعديل" onClick={() => { setEdit({ ...edit, [q.n]: !edit[q.n] }); setTap(null); setSpot(null); setAdding(null); }}>{edit[q.n] ? "✔ خلصت" : "✏️"}</button>
            {q.note && <small>{q.note}</small>}
          </div>
          {(q.marked?.length ? q.marked : q.photos.map((ref) => ({ ref, marks: [] as PaperMark[] }))).map((pg) => (
            <div key={pg.ref} className={adding === pg.ref ? "arv-adding" : ""} onClickCapture={(e) => pick(e, pg.ref)}>
              <MarkedPage src={file(pg.ref)} marks={spot?.ref === pg.ref ? [...pg.marks, { x: spot.x, y: spot.y, kind: "miss", text: "", note: "" }] : pg.marks}
                onTap={adding || !edit[q.n] ? undefined : (m) => setTap({ ref: pg.ref, m })} picked={tap?.ref === pg.ref ? pg.marks.indexOf(tap.m) : undefined} />
              {edit[q.n] && <div className="exline arv-tools">
                {adding === pg.ref ? <span className="arv-hint">👆 دوس المكان اللي تريد تحط بيه علامتك</span>
                  : <button type="button" className="exbtn" disabled={busy} onClick={() => { setAdding(pg.ref); setTap(null); setSpot(null); }}>➕ ضيف علامة</button>}
                {adding === pg.ref && <button type="button" className="exbtn" onClick={() => { setAdding(null); setSpot(null); }}>إلغاء</button>}
                <a className="exbtn" style={{ textDecoration: "none" }} href={`/store/grade?edit=${p.id}`}>🖊 القلم والمساحة (شاشة التصحيح)</a>
              </div>}
              {edit[q.n] && !tap && !spot && adding !== pg.ref && <div className="arv-hint" style={{ marginTop: 4 }}>👆 دوس أي علامة على الورقة حتى تعدلها أو تشيلها</div>}
              {tap?.ref === pg.ref && <EditBox key={markKey(tap.m) + String(tap.m.added ?? "")} start={tap.m} busy={busy}
                save={async (kind, note) => {
                  if (tap.m.added !== undefined) { const m = tap.m; await markCall({ action: "markDrop", n: m.added }); await markCall({ action: "markAdd", ref: pg.ref, x: m.x, y: m.y, kind, note }); }
                  else await markCall({ action: "markFix", key: markKey(tap.m), kind, note });
                }}
                drop={() => void markCall(tap.m.added !== undefined ? { action: "markDrop", n: tap.m.added } : { action: "markHide", key: markKey(tap.m) })} close={() => setTap(null)} />}
              {spot?.ref === pg.ref && <EditBox key={`${spot.x}-${spot.y}`} busy={busy} save={(kind, note) => markCall({ action: "markAdd", ref: pg.ref, x: spot.x, y: spot.y, kind, note })} close={() => { setSpot(null); setAdding(null); }} />}
            </div>
          ))}
        </div>
      ))}
      {!p.questions.length && <div className="exhint">ماكو تصحيح ذكاء محفوظ لهاي الورقة.</div>}
      {!!p.questions.length && <button type="button" className="exbtn adtop" disabled={busy} onClick={() => { if (confirm("ترجع العلامات مثل ما صححها الذكاء؟ تعديلاتك عليها تنمسح (الدرجات تبقى)")) void markCall({ action: "markReset" }); }}>↩️ رجّع علامات الذكاء</button>}
      <button type="button" className="btn adtop" disabled={busy || !changed.length} onClick={async () => {
        const r = await save(Object.fromEntries(changed.map((q) => [q.n, Number(marks[q.n])])));
        if (r?.saved) { setTotal(r.saved.total); for (const q of changed) q.mark = Number(marks[q.n]); setMarks({ ...marks }); }
      }}>{changed.length ? `💾 حفظ درجات ${p.name.split(" ")[0]}` : "ما غيرت شي"}</button>
      <div className="arv-end">— نهاية أوراق {p.name} —</div>
    </div>
  );
}

/** صندوق العلامة: نوعها (✓ ½ ✗ 👍) وملاحظتك، وحفظ أو شيلها */
function EditBox({ start, busy, save, drop, close }: { start?: PaperMark; busy: boolean; save: (kind: string, note: string) => Promise<unknown>; drop?: () => void; close: () => void }) {
  const first = start && ["ok", "half", "bad", "good"].includes(start.kind) ? start.kind : "ok";
  const [kind, setKind] = useState<string>(first);
  const [note, setNote] = useState(start?.note ?? "");
  return (
    <div className="arv-box">
      <b>{start ? "✏️ بدّل هاي العلامة" : "➕ علامتك هنا"}</b>
      <div className="exline">{KINDS.map((x) => <button type="button" key={x.k} className={kind === x.k ? "btn" : "exbtn"} style={{ width: "auto" }} onClick={() => setKind(x.k)}>{x.t}</button>)}</div>
      <input className="tmtext" style={{ minHeight: 44 }} placeholder="ملاحظتك (اختياري)، مثلاً: نسيت الإشارة" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="exline">
        <button type="button" className="btn" style={{ width: "auto" }} disabled={busy} onClick={() => void save(kind, note)}>💾 حفظ</button>
        {drop && <button type="button" className="exbtn" disabled={busy} onClick={drop}>🗑 شيلها</button>}
        <button type="button" className="exbtn" onClick={close}>إلغاء</button>
      </div>
    </div>
  );
}

const CSS = `
.arv-opt{display:flex;gap:10px;align-items:flex-start;margin-top:10px;cursor:pointer}.arv-opt input{width:20px;height:20px;margin-top:3px}
.arv-opt span{display:flex;flex-direction:column}.arv-opt small{opacity:.75;line-height:1.6}
.arv-g{display:flex;flex-direction:column;gap:2px;width:100%;text-align:right;margin-top:8px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:none;color:inherit;font:inherit;cursor:pointer}
.arv-g.held{border:2px solid #F6C94A}.arv-g small{opacity:.75}.arv-g span{font-weight:700;color:#F6C94A}
.arv-paper{border:4px solid #2F6FD6;margin-bottom:26px}
.arv-a{border-color:#2F6FD6;background:linear-gradient(rgba(246,201,74,.10),rgba(246,201,74,.10)),var(--ink2,#162238)}
.arv-b{border-color:#F6C94A;background:linear-gradient(rgba(47,111,214,.16),rgba(47,111,214,.16)),var(--ink2,#162238)}
.arv-start{margin:-1px -1px 10px;padding:10px 14px;font-size:18px;font-weight:800;color:#fff}
.arv-a .arv-start{background:#2F6FD6}.arv-b .arv-start{background:#F6C94A;color:#141F33}
.arv-end{margin-top:14px;text-align:center;font-weight:800;opacity:.85;padding:8px;border-top:2px dashed currentColor}
.arv-a .arv-end{color:#7FA8F0}.arv-b .arv-end{color:#F6C94A}
.arv-mark{font-weight:800;color:#F6C94A}
.arv-pen{min-width:44px;min-height:40px;border-radius:10px;border:1.5px solid #F6C94A;background:transparent;color:#F6C94A;font:inherit;font-weight:800;cursor:pointer}
.arv-pen.on{background:#F6C94A;color:#141F33}
.arv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:17px}.arv-total{margin-inline-start:auto;font-weight:800;color:#F6C94A}
.arv-q{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
.arv-qline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.arv-qline .exnum{width:64px}.arv-qline small{flex-basis:100%;opacity:.8}
.arv-by{font-size:13px;font-weight:800;padding:2px 10px;border-radius:20px;background:rgba(246,201,74,.16);color:#F6C94A}
.arv-tools{margin-top:6px}.arv-hint{font-weight:800;color:#F6C94A}
.arv-adding .mkpage{outline:3px dashed #F6C94A;cursor:crosshair}
.arv-box{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border:2px solid #F6C94A;border-radius:12px;background:rgba(246,201,74,.08)}
.arv-img{width:100%;display:block;margin-top:8px;border-radius:8px;background:#fff}
`;
