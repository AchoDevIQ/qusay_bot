"use client";
// 🤖 مراجعة تصحيح الذكاء: تختار مجموعة (امتحان + مكان + موعد)، وتنفتح أوراقها كلها بصفحة وحدة، طالب ورا طالب،
// ويا علامات الذكاء الحمرة ودرجة كل سؤال تگدر تبدلها وتحفظ بنفس المكان. وإعداد: الدرجات توصل مباشرة لو بعد ما تراجعها
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkedPage, type MarkedPageT, type PaperMark } from "../myexams/AiCompare";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { InkBar, InkLayer, loadPen, usePaperInk, type PaperPages, type PenSet } from "./InlineInk";

type Cfg = { mode: "after" | "before"; hours: number };
type Group = { key: string; exam: number; title: string; chapter: string; place: string; at: string; count: number; held: number; seen: boolean; pending?: number };
type Q = { n: number; max: number; mark: number; note: string; photos: string[]; marked: MarkedPageT[] | null };
type Paper = { id: number; name: string; held: boolean; total: number; by: string; questions: Q[]; pg?: PaperPages };
type Data = { cfg?: Cfg; owner?: boolean; groups?: Group[]; notice?: string; group?: Group | null; papers?: Paper[]; fileToken?: string; saved?: { changed: number; total: number }; paper?: Paper | null };
type Call = (b: Record<string, unknown>, merge?: boolean) => Promise<Data | null>;
const markKey = (m: PaperMark) => m.fixed ?? `${m.q}:${m.i ?? -1}:${m.kind}`;
const KINDS: { k: "ok" | "half" | "bad" | "good"; t: string }[] = [{ k: "ok", t: "✓ صح" }, { k: "half", t: "½ نص" }, { k: "bad", t: "✗ غلط" }, { k: "good", t: "👍 ممتاز" }];

export default function AiReviewClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/aireview", "🤖 مراجعة تصحيح الذكاء");
  const [open, setOpen] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const c = cfg ?? data?.cfg ?? null;
  // بالاسم: منو سؤاله مفتوح، منو ينحفظ، ومنو ما انحفظ، حتى يعرف يرجعله
  const [work, setWork] = useState<Record<number, Work>>({});
  const report = useCallback((id: number, x: Work) => setWork((w) => (JSON.stringify(w[id]) === JSON.stringify(x) ? w : { ...w, [id]: x })), []);
  const busyWork = Object.values(work);
  // ✏️ القلم والمساحة على كل الأوراق: أداة وحدة للكل (تختارها بأي سؤال وتكتب بأي ورقة)، ولونه وسمكه يبقون نفسهم
  const [pen, setPen] = useState<PenSet>({ tool: null, color: "#e53935", width: 2 });
  useEffect(() => { setPen(loadPen()); }, []);
  const openGroup = async (key: string) => { setWork({}); setOpen(key); window.scrollTo(0, 0); await call({ action: "group", key }, true); };
  const back = async () => { setOpen(null); await call({ action: "list" }); };
  // رجع من شاشة التصحيح (?open=المجموعة#p رقم الورقة): تنفتح نفس المجموعة وتنزل لنفس الطالب
  // الصفحة بعرض الشاشة كله (مثل شاشة التصحيح)، حتى الورقة تملي الشاشة وما تتحرك يمين ويسار
  useEffect(() => { document.body.classList.add("grwide"); return () => { document.body.classList.remove("grwide"); }; }, []);
  const reopened = useRef(false);
  useEffect(() => {
    if (!data || reopened.current) return;
    reopened.current = true;
    const k = new URLSearchParams(location.search).get("open");
    if (!k) return;
    void openGroup(k).then(() => {
      const id = location.hash.slice(1);
      if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 400);
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // كل ورقة تگول شگد عندها سؤال مفتوح وشگد ينحفظ بالخلفية: «📤 دز للطلاب» ينتظر لحد ما يخلص كلشي (طلبه 2026-11-27)
  // رمز الصور يبقى نفسه (يتجدد بس قبل ما يخلص بـ10 دقايق): لو يتبدل بكل تحديث، كل الصور تنعاد تتحمل وطولها يتغير لحظة
  // فالصفحة تقفز وتقلّب بين الأوراق (فيديو الأستاذ 2026-11-28، بالآيباد سفاري ما يثبّت مكانه)
  const tok = useRef("");
  const freshTok = data?.fileToken ?? "";
  if (freshTok && (!tok.current || Number(tok.current.split(".")[1] || 0) - Date.now() / 1000 < 600)) tok.current = freshTok;
  const file = (ref: string) => `/api/aireview/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(tok.current)}`;

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
            <SendAll compact g={g} busy={busy} work={busyWork} send={() => void call({ action: "approve", key: g.key }).then(() => openGroup(g.key))} />
          </div>}
          {!data?.papers && <div className="empty">جاري التحميل...</div>}
          {data?.papers?.map((p, i) => <PaperCard key={p.id} pen={pen} setPen={setPen} report={report} p={p} n={i + 1} of={data.papers!.length} file={file} busy={busy} gkey={open} call={call} save={(marks) => call({ action: "save", item: p.id, marks }, true)} />)}
          {/* بالأخير بعد ما يخلص كل الأوراق: نفس الزر */}
          {g && data?.papers && <div className="card expad"><SendAll g={g} busy={busy} work={busyWork} send={() => void call({ action: "approve", key: g.key }).then(() => openGroup(g.key))} /></div>}
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
/** رابط شاشة التصحيح لهاي الورقة، ويا طريق الرجوع لهاي المجموعة (ويا رمز الصفحة إذا موجود) */
function gradeLink(id: number, gkey: string, embed = false) {
  const t = new URLSearchParams(location.search).get("t");
  return `/store/grade?edit=${id}&back=${encodeURIComponent(gkey)}${embed ? "&embed=1" : ""}${t ? `&t=${encodeURIComponent(t)}` : ""}`;
}
/** ورقة طالب. n: رقمه بالمجموعة: الطلاب يتناوبون باللون (إطار أزرق وجوه ذهبي، والجاي بالعكس) حتى تبين وين تخلص ورقة وتبدي اللي بعدها (طلبه 2026-11-27) */
function PaperCard({ p: start, n, of, file, busy, save, gkey, call, report, pen, setPen }: { pen: PenSet; setPen: (p: PenSet) => void; report: (id: number, x: Work) => void; p: Paper; n: number; of: number; file: (ref: string) => string; busy: boolean; save: (marks: Record<number, number>) => Promise<Data | null>; gkey: string; call: Call }) {
  const [p, setP] = useState(start);
  // ✏️ القلم على الورقة بمكانها (طلبه 2026-11-27): ينحفظ وحده، وصور الورقة المصححة تتركب بصمت بعد ما يوگف
  const inl = usePaperInk(start.id, start.name, start.pg, file, () => void call({ action: "group", key: gkey }, true));
  const [more, setMore] = useState<Record<number, boolean>>({});
  const lastPage = useRef<Record<number, number>>({});
  // ✏️ أدوات التصحيح مخفية: كل سؤال يطلع بدرجته وورقته بس، ودوسة «✏️» تطلع أدواته (الدرجة، العلامات، ضيف علامة)
  const [edit, setEdit] = useState<Record<number, boolean>>({});
  // ✏️ صحح (طلبه 2026-11-27): أدوات التصحيح كلها تنفتح بنفس السؤال اللي داسه، بعرض الشاشة. كل دوسة رقم وكل خط ينحفظ وحده،
  // و«✔ خلصت» يحفظ الصفحة الأخيرة ويسدها. ما يوصل شي للطالب إلا من «📤 دز للطلاب» بالمجموعة
  // gq: السؤال المفتوح قدامه. bg: أسئلة تركها، تنحفظ بالخلفية (شاشتها مخفية لحد ما تخلص) وهو يكمل براحته (طلبه 2026-11-27)
  const [gq, setGq] = useState<number | null>(null);
  const [bg, setBg] = useState<number[]>([]);
  const [fails, setFails] = useState<Record<number, string>>({});
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const timers = useRef(new Map<number, number>());
  const doneBg = (n: number) => {
    const t = timers.current.get(n); if (t) window.clearTimeout(t); timers.current.delete(n);
    setBg((b) => b.filter((x) => x !== n));
    void call({ action: "group", key: gkey }, true);
  };
  /** يترك السؤال المفتوح: يحفظه بالخلفية ويفتح اللي بعده فوراً (أو يسدها) */
  const leave = (then: number | null) => {
    const cur = gq;
    if (cur !== null && cur !== then) {
      frames.current.get(cur)?.contentWindow?.postMessage({ qgrade: "save" }, location.origin);
      setBg((b) => [...b.filter((x) => x !== cur), cur]);
      // الدرجات والكتابة أصلاً انحفظت وهو يكتب: إذا الحفظ الأخير ما رد، تنشال بعد 20 ثانية
      timers.current.set(cur, window.setTimeout(() => doneBg(cur), 20000));
    }
    if (then !== null) { setFails((f) => { const x = { ...f }; delete x[then]; return x; }); setBg((b) => b.filter((x) => x !== then)); }
    setGq(then);
    // الأدوات تملي الشاشة: الصفحة تنزل عليها
    // سد التصحيح: يرجع لنفس السؤال بالقائمة
    if (then === null && cur !== null) setTimeout(() => document.getElementById(`q${p.id}-${cur}`)?.scrollIntoView({ block: "center" }), 60);
  };
  // التصحيح المفتوح يملي الشاشة بالضبط وما يتحرك (طلبه 2026-11-27): الصفحة اللي وراه تنقفل لحد «✔ خلصت»
  useEffect(() => {
    if (gq === null) return;
    const h = document.documentElement, b = document.body;
    const was = [h.style.overflow, b.style.overflow];
    h.style.overflow = "hidden"; b.style.overflow = "hidden";
    return () => { h.style.overflow = was[0]; b.style.overflow = was[1]; };
  }, [gq]);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  // 0: كتابة القلم بهاي الورقة (بعدها تنحفظ، لو ما انحفظت)
  useEffect(() => { report(p.id, { id: p.id, name: p.name, open: gq, saving: [...bg, ...(inl.state === "saving" ? [0] : [])], failed: [...Object.keys(fails).map(Number), ...(inl.state === "err" ? [0] : [])] }); }, [gq, bg, fails, inl.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || Number(e.data?.id) !== p.id) return;
      const n = Number(e.data?.q) || 0;
      if (e.data?.qgrade === "done") doneBg(n);
      // «✔ خلصت» من جوه أدوات التصحيح نفسها: نفس زر «✔ خلصت» اللي تحت (يحفظ بالخلفية ويسد)
      if (e.data?.qgrade === "close") leaveRef.current(null);
      // ما انحفظ (سؤال بلا درجة): يگله جنب السؤال، والأدوات تنسد
      if (e.data?.qgrade === "fail") { setFails((f) => ({ ...f, [n]: String(e.data.msg ?? "ما انحفظ") })); doneBg(n); }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
  // رجع من أدوات التصحيح (أو تحدثت المجموعة): الدرجات والمجموع يتحدثون بالقائمة، إلا السؤال اللي قاعد يكتب رقمه هسه
  useEffect(() => {
    setP(start); setTotal(start.total);
    setMarks((m) => ({ ...m, ...Object.fromEntries(start.questions.filter((q) => !edit[q.n]).map((q) => [q.n, String(q.mark)])) }));
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = p.questions.filter((q) => marks[q.n] !== undefined && marks[q.n] !== String(q.mark));
  // 💾 الدرجة تنحفظ وحدها من يعدلها (طلبه 2026-11-27): ثانية بعد آخر رقم يكتبه، بلا زر حفظ.
  // بس الرقم الكامل والصحيح (مو فاضي، مو «8.»، ومو أكثر من درجة السؤال)
  const [saveMsg, setSaveMsg] = useState("");
  const saving = useRef(false);
  const ok = (q: Q) => /^\d+(\.\d+)?$/.test(marks[q.n] ?? "") && Number(marks[q.n]) <= q.max;
  const ready = changed.filter(ok);
  const bad = changed.find((q) => !ok(q) && (marks[q.n] ?? "") !== "" && !/\.$/.test(marks[q.n] ?? ""));
  useEffect(() => {
    if (!ready.length || saving.current) return;
    setSaveMsg("⏳ يحفظ...");
    const t = window.setTimeout(async () => {
      saving.current = true;
      const now = ready.map((q) => [q.n, marks[q.n]] as const);
      const r = await save(Object.fromEntries(now.map(([n, v]) => [n, Number(v)])));
      saving.current = false;
      if (r?.saved) {
        setTotal(r.saved.total);
        for (const [n, v] of now) { const q = p.questions.find((x) => x.n === n); if (q) q.mark = Number(v); }
        setMarks((m) => ({ ...m }));
        setSaveMsg(`✅ انحفظ: صارت ${r.saved.total} من 100`);
      } else setSaveMsg("⚠️ ما انحفظ، عدّل الرقم مرة ثانية");
    }, 1000);
    return () => window.clearTimeout(t);
  }, [marks]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div id={`p${p.id}`} className={"card arv-paper " + (n % 2 ? "arv-a" : "arv-b")}>
      <div className="arv-start">👤 الطالب {n} من {of}: <b>{p.name}</b></div>
      <div className="arv-head"><span className="arv-by">{p.by}</span><span className="arv-total">{total} من 100</span>{p.held && <span className="adentag">⏳ بعدها ما وصلت</span>}</div>
      {p.questions.map((q) => (
        <div key={q.n} id={`q${p.id}-${q.n}`} className="arv-q">
          <div className="arv-qline">
            <b>س{q.n}</b>
            {edit[q.n]
              ? <><input className="exnum" inputMode="decimal" value={marks[q.n] ?? ""} onChange={(e) => setMarks({ ...marks, [q.n]: e.target.value.replace(/[^\d.]/g, "") })} /><span>من {q.max}</span></>
              : <span className="arv-mark">{marks[q.n] ?? q.mark} من {q.max}</span>}
            {/* مجموع الطالب فوگ كل سؤال، ويتغير وياه (طلبه 2026-11-28) */}
            <span className="arv-qtot">المجموع {total} من 100</span>
            {/* ورقة PDF أو ورقة كاملة: القلم هنا ما يشتغل عليها، فتنفتح شاشة التصحيح نفسها */}
            {!inl.order && (gq === q.n
              ? <button type="button" className="arv-pen on" onClick={() => leave(null)}>✔ خلصت</button>
              : <button type="button" className="arv-pen" aria-label="صحح بأدوات التصحيح" title="صحح بأدوات التصحيح" onClick={() => leave(q.n)}>✏️ صحح</button>)}
            {!inl.order && <button type="button" className={"arv-pen arv-pen2" + (edit[q.n] ? " on" : "")} aria-label="علامات الذكاء" title="علامات الذكاء" onClick={() => { setEdit({ ...edit, [q.n]: !edit[q.n] }); setTap(null); setSpot(null); setAdding(null); }}>{edit[q.n] ? "✔ خلصت" : "🤖 علامات الذكاء"}</button>}
            {q.note && <small>{q.note}</small>}
          </div>
          {/* 🔢 أرقام الدرجة ظاهرة تحت كل سؤال مثل شاشة التصحيح (طلبه 2026-11-28): دوسة على الرقم وينحفظ وحده */}
          <div className={"arv-nums" + (q.max + 1 > 16 ? " many" : "")}>
            {Array.from({ length: q.max + 1 }, (_, m) => m).map((m) => (
              <button type="button" key={m} className={Number(marks[q.n] ?? q.mark) === m && (marks[q.n] ?? "") !== "" ? "on" : ""} onClick={() => setMarks({ ...marks, [q.n]: String(m) })}>{m}</button>
            ))}
          </div>
          {/* ✏️ فوك كل سؤال: قلم ومساحة ظاهرين، و«⋯ المزيد» يطلع الباقي بنفس المكان (طلبه 2026-11-27) */}
          {inl.order && <InkBar pen={pen} setPen={(x) => { setPen(x); if (x.tool) { setEdit((e) => ({ ...e, [q.n]: false })); setAdding(null); setTap(null); setSpot(null); } }} more={!!more[q.n]} setMore={(v) => setMore({ ...more, [q.n]: v })}
            canBack={lastPage.current[q.n] !== undefined && inl.canBack(lastPage.current[q.n])} onBack={() => { const i = lastPage.current[q.n]; if (i !== undefined) inl.back(i); }}
            extra={<div className="arv-inkbar">
              <button type="button" className={edit[q.n] ? "on" : ""} onClick={() => { setEdit({ ...edit, [q.n]: !edit[q.n] }); setTap(null); setSpot(null); setAdding(null); if (!edit[q.n]) setPen({ ...pen, tool: null }); }}>{edit[q.n] ? "✔ خلصت علامات الذكاء" : "🤖 علامات الذكاء"}</button>
              <button type="button" onClick={() => leave(q.n)}>🧰 كل أدوات التصحيح</button>
            </div>} />}
          {bg.includes(q.n) && gq !== q.n && <div className="arv-saving">⏳ س{q.n} ينحفظ بالخلفية...</div>}
          {fails[q.n] && <div className="arv-hint" style={{ marginTop: 4 }}>⚠️ س{q.n}: {fails[q.n]}</div>}
          {(gq === q.n || bg.includes(q.n)) && <div id={`g${p.id}-${q.n}`} className={"arv-grade" + (gq === q.n ? " open" : "")} style={gq === q.n ? undefined : { display: "none" }}>
            <iframe ref={(el) => { if (el) frames.current.set(q.n, el); else frames.current.delete(q.n); }} title={`تصحيح ${p.name} س${q.n}`} src={`${gradeLink(p.id, gkey, true)}&q=${q.n}`} />
            <div className="exline arv-gfoot"><span>👤 {p.name} · س{q.n}</span><button type="button" className="btn" style={{ width: "auto" }} onClick={() => leave(null)}>{`✔ خلصت س${q.n}`}</button></div>
          </div>}
          {gq !== q.n && (q.marked?.length ? q.marked : q.photos.map((ref) => ({ ref, marks: [] as PaperMark[] }))).map((pg) => (
            <div key={pg.ref} className={adding === pg.ref ? "arv-adding" : ""} onClickCapture={(e) => pick(e, pg.ref)}>
              <div className="arv-pgbox">
                <MarkedPage src={file(pg.ref)} marks={spot?.ref === pg.ref ? [...pg.marks, { x: spot.x, y: spot.y, kind: "miss", text: "", note: "" }] : pg.marks}
                  onTap={adding || !edit[q.n] ? undefined : (m) => setTap({ ref: pg.ref, m })} picked={tap?.ref === pg.ref ? pg.marks.indexOf(tap.m) : undefined} />
                {(() => {
                  const i = inl.index.get(pg.ref);
                  if (i === undefined) return null;
                  const ink = inl.inks[i] ?? { rot: 0, items: [] };
                  return <InkLayer ink={ink} pen={pen} rotated={!!ink.rot} onChange={(next) => { lastPage.current[q.n] = i; inl.change(i, next); }} />;
                })()}
              </div>
              {edit[q.n] && <div className="exline arv-tools">
                {adding === pg.ref ? <span className="arv-hint">👆 دوس المكان اللي تريد تحط بيه علامتك</span>
                  : <button type="button" className="exbtn" disabled={busy} onClick={() => { setAdding(pg.ref); setTap(null); setSpot(null); }}>➕ ضيف علامة</button>}
                {adding === pg.ref && <button type="button" className="exbtn" onClick={() => { setAdding(null); setSpot(null); }}>إلغاء</button>}
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
      {/* رسائل الحفظ بمكان طوله ثابت: ظهورها واختفاؤها ما يحرك الأوراق (بالآيباد الصفحة چانت تقفز) */}
      <div className="arv-status">
        {bad ? <span className="arv-hint">⚠️ درجة س{bad.n} لازم رقم من 0 لـ {bad.max}</span>
          : inl.state === "err" ? <span className="arv-hint">⚠️ كتابة القلم ما انحفظت{inl.err ? `: ${inl.err}` : ""} <button type="button" className="exbtn" onClick={inl.retry}>🔄 عيدها</button></span>
          : inl.state === "saving" ? <span className="arv-saving">⏳ كتابة القلم تنحفظ...</span>
          : saveMsg ? <span className="arv-saving">{saveMsg}</span> : null}
      </div>
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
.arv-saved{font-weight:800;text-align:center;padding:8px;border-radius:10px;background:rgba(110,231,168,.12);color:#6ee7a8}
.arv-pen{min-width:44px;min-height:40px;border-radius:10px;border:1.5px solid #F6C94A;background:transparent;color:#F6C94A;font:inherit;font-weight:800;cursor:pointer}
.arv-pen.on{background:#F6C94A;color:#141F33}
.arv-pen2{font-size:13px;opacity:.85}
.arv-grade{position:relative;width:auto;margin:8px -12px 12px;border-top:3px solid #F6C94A;border-bottom:3px solid #F6C94A;background:#1b1c1f;overflow:hidden;touch-action:pan-y}
.arv-grade iframe{display:block;width:100%;height:calc(100vh - 64px);min-height:520px;border:0;background:#1b1c1f}
.arv-grade{scroll-margin-top:0}
.arv-gfoot{justify-content:center;align-items:center;gap:12px;padding:6px 8px;flex:none;flex-wrap:nowrap}.arv-gfoot span{font-weight:800;color:#F6C94A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.arv-grade.open{position:fixed;inset:0;z-index:1000;margin:0;border:0;display:flex;flex-direction:column;touch-action:none;overscroll-behavior:contain}
.arv-grade.open iframe{flex:1;height:auto;min-height:0}
.arv-saving{margin-top:4px;font-size:13px;font-weight:800;color:#6ee7a8}
.arv-wait{padding:10px;border-radius:10px;background:rgba(246,201,74,.12);color:#F6C94A;font-weight:800;text-align:center}
.arv-who{background:none;border:0;padding:0;color:#fff;font:inherit;font-weight:900;text-decoration:underline;cursor:pointer}
.arv-ok{padding:10px;border-radius:10px;background:rgba(110,231,168,.12);color:#6ee7a8;font-weight:800;text-align:center}
html,body{overflow-x:hidden;overflow-x:clip}
html,body{touch-action:pan-y;overscroll-behavior-x:none}
.arv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:17px}.arv-total{margin-inline-start:auto;font-weight:800;color:#F6C94A}
.arv-q{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
.arv-qline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.arv-qline .exnum{width:64px}.arv-qline small{flex-basis:100%;opacity:.8}
.arv-by{font-size:13px;font-weight:800;padding:2px 10px;border-radius:20px;background:rgba(246,201,74,.16);color:#F6C94A}
.arv-tools{margin-top:6px}.arv-hint{font-weight:800;color:#F6C94A}
.arv-adding .mkpage{outline:3px dashed #F6C94A;cursor:crosshair}
.arv-box{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border:2px solid #F6C94A;border-radius:12px;background:rgba(246,201,74,.08)}
.arv-img{width:100%;display:block;margin-top:8px;border-radius:8px;background:#fff}
.arv-status{height:34px;margin-top:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.arv-send-top{height:56px;margin-top:8px;display:flex;align-items:center;gap:10px;overflow:hidden;white-space:nowrap}
.arv-okline{font-weight:800;color:#6ee7a8}
.arv-qtot{margin-inline-start:auto;font-weight:800;font-size:14px;padding:2px 10px;border-radius:20px;background:rgba(246,201,74,.16);color:#F6C94A}
.arv-nums{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:5px;margin-top:8px}
.arv-nums button{height:42px;border:0;border-radius:10px;background:#2a2c31;color:#fff;font:inherit;font-size:17px;font-weight:800;cursor:pointer}
.arv-nums button.on{background:#1f9d55;box-shadow:0 0 0 3px #7ee2a8}
.arv-pgbox{position:relative;margin-top:8px}.arv-pgbox .mkpage{margin-top:0}
.arv-ink{position:absolute;inset:0;width:100%;height:100%;z-index:4;border-radius:8px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.arv-ink.on{cursor:crosshair;outline:2px solid rgba(246,201,74,.55)}
.arv-inkbar{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.arv-inkbar button{min-height:40px;padding:0 12px;border-radius:10px;border:1.5px solid #F6C94A;background:transparent;color:#F6C94A;font:inherit;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.arv-inkbar button.on{background:#F6C94A;color:#141F33}.arv-inkbar button:disabled{opacity:.35}
.arv-dot{width:14px;height:14px;border-radius:50%;border:2px solid #fff;display:inline-block}
.arv-more{margin-top:6px;padding:8px;border:1px dashed rgba(246,201,74,.6);border-radius:12px}
.arv-colors{display:flex;flex-wrap:wrap;gap:6px}.arv-colors button{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.5);cursor:pointer}.arv-colors button.on{outline:3px solid #F6C94A;outline-offset:2px}
`;

/** «📤 دز للطلاب»: الدرجات المحجوزة والتعديلات الصامتة بهاي المجموعة توصل هسه للطلاب وأولياء أمورهم */
type Work = { id: number; name: string; open: number | null; saving: number[]; failed: number[] };
const jump = (id: number) => document.getElementById(`p${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
function SendAll({ g, busy, send, work, compact }: { g: Group; busy: boolean; send: () => void; work: Work[]; compact?: boolean }) {
  const n = g.held + (g.pending ?? 0);
  const open = work.filter((w) => w.open !== null), saving = work.filter((w) => w.saving.length), failed = work.filter((w) => w.failed.length);
  // فوگ الصفحة: سطر واحد طوله ثابت دائماً، حتى ما تنزل وتصعد الأوراق اللي تحته كل ما ينحفظ شي.
  // التفاصيل بالأسماء بآخر الصفحة
  if (compact) return (
    <div className="arv-send-top">
      {open.length || saving.length || failed.length
        ? <span className="arv-hint">{failed.length ? "⚠️ أكو شي ما انحفظ (التفاصيل بآخر الصفحة)" : "⏳ ينحفظ... «📤 دز للطلاب» يطلع من يخلص"}</span>
        : n ? <><span className="arv-okline">✅ كلشي انحفظ</span><button type="button" className="btn" style={{ width: "auto" }} disabled={busy} onClick={send}>📤 دز للطلاب ({n})</button></>
          : <span className="exhint">✅ كلشي واصل للطلاب.</span>}
    </div>
  );
  // بعده يصحح، لو ينحفظ، لو سؤال ما انحفظ: الزر ينتظر، ويگله منو بالاسم (دوسة على الاسم توديه لورقته)
  if (open.length || saving.length || failed.length) return (
    <div className="arv-wait adtop">
      {saving.map((w) => <div key={`s${w.id}`}>⏳ ينحفظ: <button type="button" className="arv-who" onClick={() => jump(w.id)}>{w.name}</button> {w.saving.map((q) => (q ? `س${q}` : "كتابة القلم")).join("، ")}</div>)}
      {open.map((w) => <div key={`o${w.id}`}>✏️ مفتوح: <button type="button" className="arv-who" onClick={() => jump(w.id)}>{w.name}</button> س{w.open} (دوس «✔ خلصت»)</div>)}
      {failed.map((w) => <div key={`f${w.id}`}>⚠️ ما انحفظ: <button type="button" className="arv-who" onClick={() => jump(w.id)}>{w.name}</button> {w.failed.map((q) => (q ? `س${q}` : "كتابة القلم")).join("، ")} (افتحه وكمله)</div>)}
      <small>«📤 دز للطلاب» يطلع من ينحفظ كلشي.</small>
    </div>
  );
  if (!n) return <div className="exhint adtop">✅ كلشي انحفظ، وماكو شي ينتظر. كلشي واصل للطلاب.</div>;
  return (
    <>
      <div className="arv-ok adtop">✅ كلشي انحفظ. تگدر تدز هسه.</div>
      <div className="exhint">ما وصل للطلاب بعد: {g.held ? `${g.held} درجة تنتظرك` : ""}{g.held && g.pending ? " و" : ""}{g.pending ? `${g.pending} تعديل سويته` : ""}.</div>
      <button type="button" className="btn adtop" disabled={busy} onClick={send}>📤 دز للطلاب ({n})</button>
    </>
  );
}
