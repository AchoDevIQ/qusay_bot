"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل الشاشة مثل النظام القديم (Grader)
import { useEffect, useRef, useState } from "react";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import Grader, { type Paper, type Prepared, type Sticker } from "./Grader";
import { allJobs, postRetry, saveJob, sendJob, type SendJob } from "./reliable";

type Row = { id: number; exam: number; general: boolean; optional: boolean; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type ObjRow = Row & { qs: number[] };
type Group = { exam: number; general: boolean; title: string; chapter: string; count: number; tests: number; oldest?: string };
type HistRow = Row & { objOpen: number; objOk: number; objNo: number };
type History = { day: string; days: { d: string; n: number }[]; prev: string; next: string; due: number | null; count: number; owner: boolean; rows: HistRow[] };
type ObjQ = { q: number; text: string; old: number; mark: number | null; status: string; reason: string; edited: boolean; by: string; at: string };
type ObjLog = { q: string; people: { name: string; n: number; ok: number }[]; day: string; days: { d: string; n: number }[]; prev: string; next: string; owner: boolean; count: number; ok: number; no: number; open: number; rows: (Row & { qs: ObjQ[]; at: string; canEdit: boolean; canAnswer: boolean })[] };
type Rate = { mandatory: number; optional: number; deduct: number };
type PayCard = { id: number; name: string; chapters: string[]; rate: Rate; mand: number; opt: number; obj: number; amount: number; archive: { id: number; mand: number; opt: number; obj: number; forgiven?: boolean; amount: number; created: string }[] };
type Pay = { all: boolean; chapters: string[]; graders: PayCard[] };
type Only = { exams: { id: number; slug: string; chapter: string; title: string }[]; graders: { id: number; name: string }[]; rules: { exam: number; title: string; until: string; names: string[] }[]; out?: { ids: number[]; chapters: Record<string, number[]> } };
type FoundPaper = { id: number; name: string; title: string; chapter: string; model: string; total: number; graded: string };
type Data = { canEdit?: boolean; found?: FoundPaper[]; only?: Only; groups: Group[]; unsent?: Row[]; history?: History; objLog?: ObjLog; pay?: Pay; objections: ObjRow[]; waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string; today: number; errors?: string[]; stickers?: Sticker[]; penText?: boolean };
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

export default function GradeClient({ only }: { only?: "obj" } = {}) {
  // اختيار المصحح «تبقى قلم / تتحول نص» بعد ما يبدله، حتى الورقة الجاية تفتح بيه
  const [penNow, setPenNow] = useState<boolean | null>(null);
  const { data, error, busy, call } = useAdminApi<Data>("/api/grade", only ? "✋ الاعتراضات" : "✍️ التصحيح");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [allDone, setAllDone] = useState(false);
  const skipped = useRef(new Set<number>());
  // الامتحان اللي فتحه: الأوراق تنفتح منه وحده لحد ما تخلص
  const group = useRef<string | null>(null);
  const [tab, setTab] = useState<"papers" | "history" | "objlog" | "pay">("papers");
  const inGroup = (x: Row) => group.current === null || `${x.exam}|${x.general}` === group.current;
  const saving = useRef(new Set<number>());
  const [savedNow, setSavedNow] = useState(0);
  const [bgErr, setBgErr] = useState("");
  const [savingLeft, setSavingLeft] = useState(0);
  // أوراق تنتظر النت حتى تنرسل (تعيد وحدها)
  const [netWait, setNetWait] = useState<Set<number>>(new Set());
  useWide(!!paper || allDone);
  // أوراق بقت محفوظة بالجهاز من مرة قبل (انسدت الصفحة قبل ما توصل): تنرسل وحدها أول ما تنفتح الصفحة
  const resumed = useRef(false);
  useEffect(() => {
    if (!data || resumed.current) return;
    resumed.current = true;
    void (async () => {
      for (const j of await allJobs()) {
        if (saving.current.has(j.id)) continue;
        saving.current.add(j.id); setSavingLeft(saving.current.size);
        setNetWait((x) => new Set(x).add(j.id));
        const r = await sendJob(j, pageAuth).catch(() => ({ ok: false, error: "" }));
        if (!r.ok) setBgErr(`⚠️ ورقة ${j.name} ما انرسلت${r.error ? `: ${r.error}` : ""}. افتحها من القائمة واحفظها مرة ثانية.`);
        saving.current.delete(j.id); setSavingLeft(saving.current.size);
        setNetWait((x) => { const y = new Set(x); y.delete(j.id); return y; });
      }
      void call({ action: "list" });
    })();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // القائمة تتحدث كل 20 ثانية وهو بيها: الورقة اللي فتحها مصحح ثاني تختفي
  useEffect(() => {
    if (paper || allDone || tab !== "papers" || only) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void call({ action: "list" }); }, 20000);
    return () => clearInterval(t);
  }, [paper, allDone, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // ورقة بعدها ما وصلت: الصفحة تنبه قبل ما تنسد
  useEffect(() => {
    if (!savingLeft) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [savingLeft]);
  // فتح ورقة: السيرفر يرجع الورقة بس (بدون القائمة كلها)، حتى تنفتح أسرع
  const act: Call = async (b) => {
    const light = b.action === "open";
    const r = await call(light ? { ...b, light: 1 } : b, light);
    if (r?.paper) setPaper(r.paper);
    // الورقة أخذها مصحح ثاني قبله: القائمة تتحدث حتى تختفي
    else if (!r && light) void call({ action: "list" });
    return r;
  };
  /** الورقة الجاية: السيرفر يختارها ويحجزها بنفس اللحظة، فما تطلع لمصححين اثنين */
  const openNext = async (exclude: number[] = []) => {
    const [exam, general] = (group.current ?? "").split("|");
    const r = await call({ action: "openNext", light: 1, exam: group.current ? Number(exam) : 0, general: group.current ? general === "true" : null, skip: [...skipped.current, ...saving.current, ...exclude] }, true);
    if (r?.paper) setPaper(r.paper);
    else if (r) { setAllDone(true); void call({ action: "list" }); }
    return r;
  };
  // جاي من ملف الطالب: تنفتح الورقة للتعديل مباشرة
  const editOpened = useRef(false);
  useEffect(() => {
    if (!data || editOpened.current) return;
    editOpened.current = true;
    const id = Number(new URLSearchParams(location.search).get("edit"));
    if (id) void act({ action: "openEdit", id });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = (ref: string) => `/api/grade/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  /** الحفظ بالخلفية: المصحح ما ينتظر، تنفتح الورقة الجاية والدرجة توصل للطالب وراها */
  function saveInBackground(p: Paper, inkSaved: Promise<void>, compose: (x: Prepared) => Promise<Blob[]>, decide?: { rejects: Record<number, string>; accepted: number }) {
    saving.current.add(p.id);
    setSavingLeft(saving.current.size);
    setSavedNow((n) => n + 1);
    void (async () => {
      // كل خطوة تعيد وحدها إذا النت انقطع، فالمصحح ما يحتاج يرجع للورقة. بس رفض السيرفر يوگف
      const wait = () => setNetWait((x) => new Set(x).add(p.id));
      try {
        await inkSaved;
        const res = await postRetry(() => JSON.stringify({ initData: pageAuth(), action: "prepare", id: p.id }), true, { onWait: wait });
        const prep: Prepared & { error?: string } = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(prep.error ?? "");
        // الصفحة تركب صور الورقة المصححة (برد الاعتراض: بس إذا انقبل شي أو تعدل الرد)، وإذا ما گدرت توصل الدرجة كرسالة بس
        let photos: Blob[] = [];
        if (!decide || decide.accepted || p.objections?.some((o) => o.was)) { try { photos = await compose(prep); } catch { photos = []; } }
        // الورقة الجاهزة تنحفظ بالجهاز قبل الإرسال: إذا انسدت الصفحة أو طفى الجهاز، ترجع تنرسل من تنفتح الصفحة
        const job: SendJob = { key: `${p.id}`, id: p.id, name: p.name, action: decide ? "decide" : "finish", comment: prep.sent, rejects: decide?.rejects, photos, at: Date.now() };
        await saveJob(job);
        const r = await sendJob(job, pageAuth, wait);
        if (!r.ok) throw new Error(r.error ?? "");
      } catch (e) {
        setSavedNow((n) => n - 1);
        setBgErr(`⚠️ ورقة ${p.name} ما انحفظت${(e as Error).message ? `: ${(e as Error).message}` : ""}. افتحها من القائمة واحفظها مرة ثانية.`);
      } finally {
        saving.current.delete(p.id); setSavingLeft(saving.current.size);
        setNetWait((x) => { const y = new Set(x); y.delete(p.id); return y; });
        if (decide) void call({ action: tab === "objlog" ? "objLog" : "list" });
      }
    })();
    if (decide) {
      // بعد الرد تنفتح الورقة الجاية اللي عليها اعتراض، وإذا ماكو يرجع للقائمة
      const nextObj = data?.objections.find((x) => x.id !== p.id && !saving.current.has(x.id));
      setPaper(null);
      if (nextObj) void act({ action: "openObj", id: nextObj.id });
      return;
    }
    // تعديل ورقة مصححة: يرجع للقائمة، ما تنفتح ورقة ثانية
    if (p.editing) { setPaper(null); setTimeout(() => void call({ action: "list" }), 1500); return; }
    setPaper(null);
    void openNext([p.id]);
  }
  /** بعد ما تتخطى، تنفتح الورقة اللي بعدها وحدها */
  async function next(_r: Data | null) {
    setPaper(null);
    await openNext();
  }
  return (
    <>
      {!paper && !allDone && <AdminHeader title={only ? "✋ الاعتراضات" : "✍️ التصحيح"} />}
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && paper && bgErr && <div className="gk-bgerr" onClick={() => setBgErr("")}>{bgErr} ✕</div>}
        {data && netWait.size > 0 && <div className="gk-netwait">📶 {netWait.size} ورقة تنتظر النت حتى توصل للطالب. تنرسل وحدها أول ما يرجع النت، لا تسد الصفحة.</div>}
        {data && paper && (
          <Grader key={paper.id} paper={paper} url={url} busy={busy} act={act} today={data.today + savedNow} stickers={data.stickers ?? []} penText={penNow ?? !!data.penText} onPenText={setPenNow} left={data.waiting.filter((x) => x.id !== paper.id && inGroup(x) && !saving.current.has(x.id)).length}
            onClose={() => { setPaper(null); setSavedNow(0); group.current = null; void call({ action: tab === "objlog" ? "objLog" : tab === "history" ? "history" : "list" }); }}
            onSkip={async () => { skipped.current.add(paper.id); await next(await call({ action: "release", id: paper.id })); }}
            onRescan={async () => { skipped.current.add(paper.id); await next(await call({ action: "rescan", id: paper.id })); }}
            onSave={(inkSaved, compose) => saveInBackground(paper, inkSaved, compose)}
            onDecide={(inkSaved, compose, rejects, accepted) => saveInBackground(paper, inkSaved, compose, { rejects, accepted })} />
        )}
        {data && !paper && allDone && (
          <div className="gk gk-done">
            <div className="gk-check">✓</div>
            <b>انتهت الأوراق المتاحة</b>
            <span>{group.current !== null ? "خلصت أوراق هذا الامتحان. ارجع للقائمة وافتح امتحان ثاني." : "ماكو أوراق ثانية تنتظر التصحيح هسه."}</span>
            {savingLeft > 0 && <span className="gk-err">⏳ جاري حفظ {savingLeft} ورقة وإرسالها للطلاب. لا تسد الصفحة لحد ما تخلص.</span>}
            {bgErr && <span className="gk-err">{bgErr}</span>}
            <button type="button" className="gk-finish" onClick={() => { setAllDone(false); skipped.current.clear(); setSavedNow(0); group.current = null; void call({ action: "list" }); }}>رجوع للقائمة</button>
          </div>
        )}
        {data && !paper && only && (
          <>
            <div className="seg gktabs">
              <button type="button" className={tab !== "objlog" ? "on" : ""} onClick={() => { setTab("papers"); void call({ action: "list" }); }}>⏳ تنتظر رد</button>
              <button type="button" className={tab === "objlog" ? "on" : ""} onClick={() => { setTab("objlog"); void call({ action: "objLog" }); }}>📜 سجل الاعتراضات</button>
            </div>
            {tab !== "objlog" && (data.objections.length ? <ObjList data={data} busy={busy} act={act} /> : <div className="empty">👏 ماكو اعتراضات تنتظر</div>)}
            {tab === "objlog" && data.objLog && <ObjLogTab h={data.objLog} busy={busy} act={act} />}
          </>
        )}
        {data && !paper && !allDone && !only && (
          <>
            <div className="seg gktabs">
              <button type="button" className={tab === "papers" ? "on" : ""} onClick={() => { setTab("papers"); void call({ action: "list" }); }}>📥 الأوراق</button>
              <button type="button" className={tab === "history" ? "on" : ""} onClick={() => { setTab("history"); void call({ action: "history" }); }}>📜 السجل</button>
              <button type="button" className={tab === "objlog" ? "on" : ""} onClick={() => { setTab("objlog"); void call({ action: "objLog" }); }}>✋ الاعتراضات</button>
              {!data.owner && <button type="button" className={tab === "pay" ? "on" : ""} onClick={() => { setTab("pay"); void call({ action: "pay" }); }}>💰 حسابي</button>}
            </div>
            {tab === "papers" && data.canEdit && <EditFind found={data.found ?? null} busy={busy} act={act} />}
            {tab === "papers" && <List data={data} busy={busy} act={act} openGroup={(g) => {
              group.current = `${g.exam}|${g.general}`; skipped.current.clear();
              void openNext();
            }} />}
            {tab === "history" && data.history && <HistoryTab h={data.history} busy={busy} owner={data.owner} act={act} />}
            {tab === "objlog" && data.objLog && <ObjLogTab h={data.objLog} busy={busy} act={act} />}
            {tab === "pay" && data.pay && <PayTab pay={data.pay} busy={busy} act={act} />}
          </>
        )}
      </div>
      {!paper && !allDone && <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />}
    </>
  );
}

/** الاعتراضات اللي تنتظر رد */
function ObjList({ data, busy, act }: { data: Data; busy: boolean; act: Call }) {
  return (
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
  );
}

/** الأوراق: الاعتراضات أول، وبعدها الامتحانات اللي بيها أوراق تنتظر. المصحح يفتح امتحان، مو طالب */
function List({ data, busy, act, openGroup }: { data: Data; busy: boolean; act: Call; openGroup: (g: Group) => void }) {
  const [kind, setKind] = useState<"general" | "private">("general");
  const gen = data.groups.filter((g) => g.general), priv = data.groups.filter((g) => !g.general);
  const sum = (l: Group[]) => l.reduce((n, g) => n + g.count, 0);
  const shown = kind === "general" ? gen : priv;
  return (
    <>
      {!!data.unsent?.length && (
        <div className="card warn">
          <h2>📤 مصححة وما انرسلت: {data.unsent.length}</h2>
          <div className="exhint expad">صححتها كلها بس ما وصلت للطالب (النت انقطع). الدرجات والرسم محفوظة: افتحها واضغط حفظ.</div>
          <table className="extable"><tbody>
            {data.unsent.map((p) => (
              <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "open", id: p.id }); }}>
                <td><b>{p.name}</b><small className="pdmode">{p.title}</small></td>
                <td className="p"><span className="exbtn">📤 افتحها</span></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {!!data.objections.length && <ObjList data={data} busy={busy} act={act} />}
      {data.only && <OnlyCard only={data.only} busy={busy} act={act} />}
      {data.only && <OutCard only={data.only} busy={busy} act={act} />}
      <div className="card">
        <h2>📥 أوراق تنتظر: {sum(data.groups)}</h2>
        <div className="seg expad gktabs2">
          <button type="button" className={kind === "general" ? "on" : ""} onClick={() => setKind("general")}>📅 الجدول العام ({sum(gen)})</button>
          <button type="button" className={kind === "private" ? "on" : ""} onClick={() => setKind("private")}>🗂 الجدول الخاص ({sum(priv)})</button>
        </div>
        {kind === "private" && !!priv.length && <div className="exhint expad">طلاب الجدول الخاص يمتحنون بأوقات متفرقة، فأوراقهم مجمعة حسب الموضوع حتى تصححها سوا.</div>}
        {shown.length ? (
          <div className="gkgroups">
            {shown.map((g) => (
              <div key={`${g.exam}|${g.general}`} className="gkgroup">
                <div><b>{g.title}</b><small>{g.chapter}{g.oldest ? <> · أقدم ورقة <span dir="ltr">{g.oldest.slice(0, 16)}</span></> : null}</small></div>
                <span className="gkcount">{g.count} ورقة{g.tests ? ` (${g.tests} تجربة)` : ""}</span>
                <button type="button" className="btn" disabled={busy} onClick={() => openGroup(g)}>▶ فتح التجمع</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">✅ ماكو أوراق تنتظر.</div>}
      </div>
    </>
  );
}

/** صاحب البوت: أوراق هذا الامتحان تطلع لمصححين يختارهم بس، لحد وقت يحدده */
function OnlyCard({ only, busy, act }: { only: Only; busy: boolean; act: Call }) {
  const [slug, setSlug] = useState("");
  const [exam, setExam] = useState(0);
  const [ids, setIds] = useState<number[]>([]);
  const [until, setUntil] = useState("");
  const chapters = only.exams.filter((e, i) => only.exams.findIndex((x) => x.slug === e.slug) === i);
  const pickExam = (id: number) => { setExam(id); setIds([]); };
  return (
    <details className="card cpch">
      <summary><b>🎯 هذا الامتحان لمصححين معينين</b>{only.rules.length ? <small className="pdmode"> {only.rules.length} محدد هسه</small> : null}</summary>
      <div className="form">
        <div className="exhint">تختار امتحان وتأشر المصححين: أوراقه تطلع إلهم بس، والباقين ما يشوفوها. إذا حددت وقت، بعده ترجع لكل المصححين وحدها. الأوراق اللي مصحح فاتحها قبل تبقى يمه.</div>
        {only.rules.map((r) => (
          <div key={r.exam} className="aig-logrow"><div><b>{r.title}</b><br /><small>{r.names.join("، ")} · {r.until ? `لحد ${r.until}` : "لحد ما تشيلها"}</small></div>
            <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "only", exam: r.exam, ids: [] })}>↩️ رجّعه للكل</button></div>
        ))}
        <select value={slug} onChange={(e) => { setSlug(e.target.value); pickExam(0); }}>
          <option value="">اختار الفصل...</option>
          {chapters.map((c) => <option key={c.slug} value={c.slug}>{c.chapter || c.slug}</option>)}
        </select>
        {slug && <select value={exam} onChange={(e) => pickExam(Number(e.target.value))}>
          <option value={0}>اختار الامتحان...</option>
          {only.exams.filter((e) => e.slug === slug).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>}
        {exam > 0 && (
          <>
            {only.graders.map((g) => <label key={g.id} className="adcheck adflat"><input type="checkbox" checked={ids.includes(g.id)} onChange={(e) => setIds(e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id))} /><span>{g.name}</span></label>)}
            <label>لحد وقت (اختياري)</label>
            <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
            <button type="button" className="btn" disabled={busy || !ids.length} onClick={() => void act({ action: "only", exam, ids, until })}>💾 احفظ ({ids.length} مصحح)</button>
          </>
        )}
      </div>
    </details>
  );
}

/** صاحب البوت: أوراق الاستثناء والتعويض (كل امتحان مو ويا الطلاب بوقتهم) لمصححين يختارهم، ولكل فصل إذا يريد غيرهم */
function OutCard({ only, busy, act }: { only: Only; busy: boolean; act: Call }) {
  const saved = only.out ?? { ids: [], chapters: {} };
  const [ids, setIds] = useState<number[]>(saved.ids);
  const [chs, setChs] = useState<Record<string, number[]>>(saved.chapters);
  const chapters = [...new Set(only.exams.map((e) => e.chapter).filter(Boolean))];
  const flip = (list: number[], id: number, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const name = (id: number) => only.graders.find((g) => g.id === id)?.name ?? String(id);
  const count = saved.ids.length + Object.keys(saved.chapters).length;
  return (
    <details className="card cpch">
      <summary><b>🔓 أوراق الاستثناء والتعويض</b>{count ? <small className="pdmode"> {saved.ids.length ? saved.ids.map(name).join("، ") : "حسب الفصل"}</small> : <small className="pdmode"> حسب مركز الطالب</small>}</summary>
      <div className="form">
        <div className="exhint">كل امتحان مو ويا الطلاب بوقتهم: اللي فتحته إله من ملفه، والإعادة، وتقديم الموعد، والتعويض، واللي جا للمركز بغير وقته ودخل باستثناء. تأشر مصححين لكل الفصول، ولكل فصل تگدر تأشر غيرهم. إذا ما أشرت أحد، الورقة تروح لأي مصحح على مركز الطالب.</div>
        <b>كل الفصول</b>
        {only.graders.map((g) => <label key={g.id} className="adcheck adflat"><input type="checkbox" checked={ids.includes(g.id)} onChange={(e) => setIds(flip(ids, g.id, e.target.checked))} /><span>{g.name}</span></label>)}
        {chapters.map((c) => (
          <details key={c} className="cpexam">
            <summary>{c}{chs[c]?.length ? <small className="pdmode"> {chs[c].map(name).join("، ")}</small> : <small className="pdmode"> مثل كل الفصول</small>}</summary>
            {only.graders.map((g) => <label key={g.id} className="adcheck adflat"><input type="checkbox" checked={(chs[c] ?? []).includes(g.id)} onChange={(e) => setChs({ ...chs, [c]: flip(chs[c] ?? [], g.id, e.target.checked) })} /><span>{g.name}</span></label>)}
          </details>
        ))}
        <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: "outSave", ids, chapters: chs })}>💾 احفظ</button>
      </div>
    </details>
  );
}

/** سجل التصحيح: كل ورقة ودرجتها وشوكت انصححت، وحالة الاعتراضات عليها */
function HistoryTab({ h, busy, act }: { h: History; busy: boolean; owner: boolean; act: Call }) {
  const go = (day: string) => void act({ action: "history", day });
  const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
  return (
    <div className="card">
      <h2>📜 سجل التصحيح</h2>
      {h.due !== null && <div className="expad"><div className="adstats adstats2"><div><b>{iqd(h.due)}</b>المبلغ المستحق إلك</div><div><b>{h.count}</b>ورقة بهذا اليوم</div></div></div>}
      <div className="exline expad gkmonth">
        <button type="button" className="exbtn" disabled={busy} onClick={() => go(h.prev)}>› الشهر اللي قبله</button>
        <b>{MONTHS[Number(h.day.slice(5, 7)) - 1]} {h.day.slice(0, 4)}</b>
        {h.next ? <button type="button" className="exbtn" disabled={busy} onClick={() => go(h.next)}>الشهر اللي بعده ‹</button> : <span />}
      </div>
      <div className="gkdays">
        {h.days.map((x, i) => (
          <button type="button" key={x.d} className={x.d === h.day ? "on" : ""} disabled={busy} onClick={() => go(x.d)}>
            <b>{i === 0 && !h.next ? "اليوم" : Number(x.d.slice(8, 10))}</b><small>{x.n ? `${x.n} ورقة` : "—"}</small>
          </button>
        ))}
      </div>
      {h.rows.length ? (
        <table className="extable"><tbody>
          {h.rows.map((p) => (
            <tr key={p.id} className="exrow" onClick={() => { if (!busy) void act({ action: "open", id: p.id }); }}>
              <td><b>{p.name}</b>{p.optional && <span className="adentag">اختياري</span>}
                <small className="pdmode">{p.title} · {String(p.graded).slice(11, 16)}{h.owner && p.grader ? ` · ${p.grader}` : ""}</small>
                {(p.objOpen + p.objOk + p.objNo > 0) && <small className="pdmode">✋ اعتراض: {p.objOpen ? `⏳${p.objOpen} ` : ""}{p.objOk ? `✅${p.objOk} ` : ""}{p.objNo ? `❌${p.objNo}` : ""}</small>}
              </td>
              <td className="p"><b>{p.total}</b></td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty">ماكو أوراق مصححة بهذا اليوم.</div>}
    </div>
  );
}

const MONTH_NAMES = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
/** سجل الاعتراضات يوم يوم: كل اعتراض ورده، ومنه يرجع للورقة ويعدل رده */
function ObjLogTab({ h, busy, act }: { h: ObjLog; busy: boolean; act: Call }) {
  const go = (day: string) => void act({ action: "objLog", day });
  const [q, setQ] = useState(h.q);
  const search = (text: string) => { setQ(text); void act({ action: "objLog", day: h.day, q: text }); };
  const state = (x: ObjQ) => (x.status === "accepted" ? `✅ انقبل: ${x.old} ← ${x.mark}` : x.status === "rejected" ? `❌ انرفض، بقت ${x.old}` : "⏳ ينتظر رد");
  return (
    <div className="card">
      <h2>✋ سجل الاعتراضات</h2>
      <form className="exline expad" onSubmit={(e) => { e.preventDefault(); search(q.trim()); }}>
        <input value={q} placeholder="🔍 دوّر باسم الطالب" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="exbtn" disabled={busy || q.trim().length < 2}>بحث</button>
        {h.q && <button type="button" className="exbtn" disabled={busy} onClick={() => search("")}>✕</button>}
      </form>
      {!h.q && !!h.people.length && (
        <details className="expad">
          <summary>👥 الطلاب اللي يعترضون بهذا الشهر ({h.people.length})</summary>
          {h.people.map((x) => <button type="button" key={x.name} className="exbtn gkperson" disabled={busy} onClick={() => search(x.name)}>{x.name} · {x.n} اعتراض{x.ok ? ` · انقبل ${x.ok}` : ""}</button>)}
        </details>
      )}
      {h.q && <div className="exhint expad">كل اعتراضات «{h.q}» بكل الأيام</div>}
      <div className="expad"><div className="adstats adstats2"><div><b>{h.count}</b>{h.q ? "اعتراض" : "اعتراض بهذا اليوم"}</div><div><b>✅{h.ok} ❌{h.no}{h.open ? ` ⏳${h.open}` : ""}</b>انقبل · انرفض{h.open ? " · ينتظر" : ""}</div></div></div>
      {!h.q && <><div className="exline expad gkmonth">
        <button type="button" className="exbtn" disabled={busy} onClick={() => go(h.prev)}>› الشهر اللي قبله</button>
        <b>{MONTH_NAMES[Number(h.day.slice(5, 7)) - 1]} {h.day.slice(0, 4)}</b>
        {h.next ? <button type="button" className="exbtn" disabled={busy} onClick={() => go(h.next)}>الشهر اللي بعده ‹</button> : <span />}
      </div>
      <div className="gkdays">
        {h.days.map((x, i) => (
          <button type="button" key={x.d} className={x.d === h.day ? "on" : ""} disabled={busy} onClick={() => go(x.d)}>
            <b>{i === 0 && !h.next ? "اليوم" : Number(x.d.slice(8, 10))}</b><small>{x.n ? `${x.n} اعتراض` : "—"}</small>
          </button>
        ))}
      </div></>}
      {h.rows.length ? (
        <table className="extable"><tbody>
          {h.rows.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b>{p.test && <span className="adentag">تجربة</span>}
                <small className="pdmode">{p.title} · الدرجة {p.total}{h.q ? ` · ${String(p.graded).slice(0, 10)}` : ""}{h.owner && p.grader ? ` · صححها ${p.grader}` : ""}</small>
                {p.qs.map((x) => (
                  <small key={x.q} className="pdmode gkobjline">
                    <b>س{x.q}</b> {state(x)}{x.edited ? " ✏️ انعدل" : ""}{x.status !== "open" && x.at ? ` · ${x.at}` : ""}{h.owner && x.by ? ` · ${x.by}` : ""}
                    {x.reason && <><br />السبب: {x.reason}</>}
                    {x.text && <><br />الطالب: {x.text}</>}
                  </small>
                ))}
              </td>
              <td className="p">
                {p.qs.some((x) => x.status === "open")
                  ? p.canAnswer && <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "openObj", id: p.id })}>رد</button>
                  : p.canEdit && <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "reopenObj", id: p.id })}>✏️ عدّل الرد</button>}
              </td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty">ماكو اعتراضات بهذا اليوم.</div>}
    </div>
  );
}

const iqd = (n: number) => `${n.toLocaleString("en")} دينار`;
/** التعويض: صاحب البوت يحدد لكل مصحح فصوله وأجوره ويحاسبه، والمصحح يشوف حسابه */
function PayTab({ pay, busy, act }: { pay: Pay; busy: boolean; act: Call }) {
  if (!pay.graders.length) return <div className="card"><div className="empty">ماكو حساب.</div></div>;
  return <>{pay.graders.map((g) => <PayCardView key={g.id} g={g} all={pay.all} chapters={pay.chapters} busy={busy} act={act} />)}</>;
}
function PayCardView({ g, all, chapters, busy, act }: { g: PayCard; all: boolean; chapters: string[]; busy: boolean; act: Call }) {
  const [rate, setRate] = useState(g.rate);
  const [chs, setChs] = useState<string[]>(g.chapters.length ? g.chapters : chapters);
  const num = (k: keyof Rate) => (
    <input type="number" inputMode="numeric" className="ltr" min={0} value={rate[k]} onChange={(e) => setRate({ ...rate, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
  );
  return (
    <div className="card">
      <h2>✍️ {g.name}</h2>
      <div className="form">
        <div className="paybal">
          <div><span>أوراق إجبارية</span><b>{g.mand} × {iqd(g.rate.mandatory)}</b></div>
          <div><span>أوراق اختيارية</span><b>{g.opt} × {iqd(g.rate.optional)}</b></div>
          <div><span>اعتراضات انقبلت</span><b>− {g.obj} × {iqd(g.rate.deduct)}</b></div>
          <div className="paytotal"><span>الرصيد</span><b>{iqd(g.amount)}</b></div>
        </div>
        {all && (g.obj ? (
          <>
            <div className="hint">عليه {g.obj} اعتراض انقبل. تخصمها من حسابه؟</div>
            <Confirm label={`✂️ تسوية ويا الخصم: ${iqd(g.amount)}`} disabled={busy} onYes={() => void act({ action: "settle", grader: g.id })} />
            <Confirm label={`🤝 تسوية بدون خصم: ${iqd(g.amount + g.obj * g.rate.deduct)}`} disabled={busy} onYes={() => void act({ action: "settle", grader: g.id, forgive: true })} />
          </>
        ) : <Confirm label="💵 تسوية الحساب (يصفر الرصيد)" disabled={busy || (!g.mand && !g.opt)} onYes={() => void act({ action: "settle", grader: g.id })} />)}
        {all && (
          <>
            <label>الفصول اللي يصححها</label>
            <div className="seg wrap2">
              {chapters.map((c) => <button type="button" key={c} className={chs.includes(c) ? "on" : ""} onClick={() => setChs(chs.includes(c) ? chs.filter((x) => x !== c) : [...chs, c])}>{c}</button>)}
            </div>
            {!chs.length && <div className="hint">إذا ما تختار ولا فصل، يصحح كل الفصول.</div>}
            <label>أجر الورقة الإجبارية (دينار)</label>{num("mandatory")}
            <label>أجر الورقة الاختيارية (دينار)</label>{num("optional")}
            <label>خصم كل اعتراض ينقبل على ورقته (دينار)</label>{num("deduct")}
            <div className="hint">الأجر الجديد ينحسب على الأوراق اللي بعدها ما انحاسبت.</div>
            <button type="button" className="btn agbtn" disabled={busy} onClick={() => void act({ action: "setRate", grader: g.id, ...rate, chapters: chs })}>💾 حفظ</button>
          </>
        )}
        {!!g.archive.length && (
          <>
            <label className="adtop">الحسابات السابقة</label>
            <table className="extable"><tbody>
              {g.archive.map((a) => <tr key={a.id}><td>{a.created}<small className="pdmode">إجباري {a.mand} · اختياري {a.opt} · اعتراض {a.obj}{a.obj ? (a.forgiven ? " بدون خصم" : " انخصم") : ""}</small></td><td className="p"><b>{iqd(a.amount)}</b></td></tr>)}
            </tbody></table>
          </>
        )}
      </div>
    </div>
  );
}

/** البحث عن طالب حتى تتعدل ورقته المصححة */
function EditFind({ found, busy, act }: { found: FoundPaper[] | null; busy: boolean; act: (b: Record<string, unknown>) => unknown }) {
  const [q, setQ] = useState("");
  return (
    <div className="card expad">
      <div className="exlabel">✏️ تعديل ورقة مصححة</div>
      <form className="atrow adtop" onSubmit={(e) => { e.preventDefault(); void act({ action: "find", q }); }}>
        <input className="exinput" placeholder="🔍 اسم الطالب أو تلفونه" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="exbtn" disabled={busy || q.trim().length < 2}>بحث</button>
      </form>
      {found?.map((p) => (
        <div key={p.id} className="adsale">
          <b>{p.name}</b> · {p.title} ({p.model})
          <small>{p.chapter} · {p.graded.slice(0, 10)}</small>
          <b>{p.total} من 100</b>
          <button type="button" className="exbtn adsmall" disabled={busy} onClick={() => void act({ action: "openEdit", id: p.id })}>✏️ عدل</button>
        </div>
      ))}
    </div>
  );
}
