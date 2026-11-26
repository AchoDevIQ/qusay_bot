"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل الشاشة مثل النظام القديم (Grader)
import { useEffect, useRef, useState } from "react";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import Grader, { type Paper, type Prepared, type Sticker } from "./Grader";
import { allJobs, postRetry, saveJob, sendJob, type SendJob } from "./reliable";

type Row = { id: number; exam: number; general: boolean; optional: boolean; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type ObjRow = Row & { qs: number[] };
type Group = { exam: number; general: boolean; test?: boolean; title: string; chapter: string; count: number; tests: number; oldest?: string };
type HistRow = Row & { objOpen: number; objOk: number; objNo: number };
type History = { day: string; days: { d: string; n: number }[]; prev: string; next: string; due: number | null; count: number; owner: boolean; everyone?: boolean; rows: HistRow[] };
type ObjQ = { q: number; text: string; old: number; mark: number | null; status: string; reason: string; edited: boolean; by: string; at: string };
type ObjLog = { q: string; people: { name: string; n: number; ok: number }[]; day: string; days: { d: string; n: number }[]; prev: string; next: string; owner: boolean; count: number; ok: number; no: number; open: number; rows: (Row & { qs: ObjQ[]; at: string; canEdit: boolean; canAnswer: boolean })[] };
type Rate = { mandatory: number; optional: number; deduct: number; fine: number; weight: number };
type PayCard = { id: number; name: string; chapters: string[]; rate: Rate; mand: number; opt: number; obj: number; fines: { day: string; target: number; done: number }[]; contract: { v: number; at: string; current: boolean } | null; amount: number; archive: { id: number; mand: number; opt: number; obj: number; forgiven?: boolean; amount: number; created: string }[] };
type Pay = { all: boolean; chapters: string[]; graders: PayCard[] };
type Only = { exams: { id: number; slug: string; chapter: string; title: string }[]; graders: { id: number; name: string }[]; rules: { exam: number; title: string; until: string; names: string[] }[]; out?: { ids: number[]; chapters: Record<string, number[]> } };
type FoundPaper = { id: number; name: string; title: string; chapter: string; model: string; total: number; graded: string };
type CheckG = { id: number; name: string; count: number; checked: number; last: string };
type CheckT = { exam: number; title: string; chapter: string; count: number; checked: number; avg: number | null; others: number | null };
type Check = { graders: CheckG[]; grader: number | null; name: string; topics: CheckT[] | null };
type Data = { canEdit?: boolean; canCheck?: boolean; check?: Check; found?: FoundPaper[]; only?: Only; groups: Group[]; unsent?: Row[]; history?: History; objLog?: ObjLog; pay?: Pay; objections: ObjRow[]; waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string; today: number; errors?: string[]; stickers?: Sticker[]; penText?: boolean; quota?: { target: number; done: number } | null; quotaStop?: number[]; contractDue?: boolean; contract?: ContractData };
type Signed = { v: number; at: string; name: string; text: string; sig: { w: number; h: number; s: number[][] }; own?: { w: number; h: number; s: number[][] } | null };
type ContractData = { own?: Signed["sig"] | null; text: string; v: number; updated: string; mine: string; signed: { v: number; at: string; current: boolean } | null; graders?: { id: number; name: string; signed: { v: number; at: string; current: boolean } | null }[]; copy?: Signed | null; copyId?: number; preview?: { text: string; id: number; name: string } };
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

/** جاي من «🗂 مراجعة تصحيح الذكاء»: جوه ورقة الطالب نفسها (?embed=1) يگول للصفحة «خلصت»، أو (?back=المجموعة) يرجع لنفس الطالب هناك. true إذا رجع */
function backToReview(id: number, wait = 0) {
  const q = new URLSearchParams(location.search), g = q.get("back");
  if (q.get("embed") === "1" && window.parent !== window) { setTimeout(() => window.parent.postMessage({ qgrade: "done", id }, location.origin), wait); return true; }
  if (!g) return false;
  const t = q.get("t");
  setTimeout(() => { location.href = `/store/aireview?open=${encodeURIComponent(g)}${t ? `&t=${encodeURIComponent(t)}` : ""}#p${id}`; }, wait);
  return true;
}

const embedded = typeof window !== "undefined" && new URLSearchParams(location.search).get("embed") === "1";
export default function GradeClient({ only }: { only?: "obj" } = {}) {
  // اختيار المصحح «تبقى قلم / تتحول نص» بعد ما يبدله، حتى الورقة الجاية تفتح بيه
  const [penNow, setPenNow] = useState<boolean | null>(null);
  const { data, error, busy, call } = useAdminApi<Data>("/api/grade", only ? "✋ الاعتراضات" : "✍️ التصحيح");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [allDone, setAllDone] = useState(false);
  const skipped = useRef(new Set<number>());
  // الامتحان اللي فتحه: الأوراق تنفتح منه وحده لحد ما تخلص
  const group = useRef<string | null>(null);
  const [tab, setTab] = useState<"papers" | "history" | "objlog" | "pay" | "check" | "contract">("papers");
  const inGroup = (x: Row) => group.current === null || `${x.exam}|${x.general}|${!!x.test}` === group.current;
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
  // وهو بالقائمة: كل 4 ثواني فحص خفيف، وإذا ورقة انحجزت لمصحح ثاني القائمة تتحدث وتختفي. والأوراق الجديدة كل دقيقة
  const waitingIds = useRef<number[]>([]);
  waitingIds.current = (data?.waiting ?? []).map((x) => x.id);
  useEffect(() => {
    if (paper || allDone || tab !== "papers" || only) return;
    let n = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++n % 15 === 0) { void call({ action: "list" }); return; }
      void fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "free", initData: pageAuth() }) })
        .then((r) => (r.ok ? r.json() : null)).then((j: { free?: number[] } | null) => {
          if (!j?.free) return;
          const free = new Set(j.free);
          if (waitingIds.current.some((id) => !free.has(id))) void call({ action: "list" });
        }).catch(() => {});
    }, 4000);
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
    const [exam, general, test] = (group.current ?? "").split("|");
    const r = await call({ action: "openNext", light: 1, exam: group.current ? Number(exam) : 0, general: group.current ? general === "true" : null, test: group.current ? test === "true" : null, skip: [...skipped.current, ...saving.current, ...exclude] }, true);
    if (r?.paper) setPaper(r.paper);
    else if (r) { setAllDone(true); void call({ action: "list" }); }
    return r;
  };
  // جاي من ملف الطالب: تنفتح الورقة للتعديل مباشرة
  // جوه مراجعة الذكاء: «✔ خلصت» برا يطلب الحفظ الأخير
  const [saveSig, setSaveSig] = useState(0);
  useEffect(() => {
    if (!embedded) return;
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.qgrade === "save") setSaveSig((n) => n + 1); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  const editOpened = useRef(false);
  useEffect(() => {
    if (!data || editOpened.current) return;
    editOpened.current = true;
    const id = Number(new URLSearchParams(location.search).get("edit"));
    if (id) void act({ action: "openEdit", id, ...(embedded ? { quiet: true } : {}) });
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
        // جوه مراجعة الذكاء: «خلصت» توصل للصفحة بس بعد ما ينحفظ كله (إذا تتسد قبل، الحفظ ينقطع)
        if (p.editing && embedded) backToReview(p.id);
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
    if (p.editing) { setPaper(null); if (embedded) return; if (backToReview(p.id, 1500)) return; setTimeout(() => void call({ action: "list" }), 1500); return; }
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
          <Grader key={paper.id} stacked={embedded} focusQ={embedded ? Number(new URLSearchParams(location.search).get("q")) || 0 : 0} autosave={embedded} saveSignal={saveSig} paper={paper} url={url} busy={busy} act={act} today={data.today + savedNow} stickers={data.stickers ?? []} penText={penNow ?? !!data.penText} onPenText={setPenNow} left={data.waiting.filter((x) => x.id !== paper.id && inGroup(x) && !saving.current.has(x.id)).length}
            onClose={() => { if (paper.editing && backToReview(paper.id)) return; setPaper(null); setSavedNow(0); group.current = null; void call(tab === "check" ? { action: "check", grader: data?.check?.grader ?? "" } : { action: tab === "objlog" ? "objLog" : tab === "history" ? "history" : "list" }); }}
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
              {data.canCheck && <button type="button" className={tab === "check" ? "on" : ""} onClick={() => { setTab("check"); void call({ action: "check" }); }}>👀 فحص المصححين</button>}
              {!data.owner && <button type="button" className={tab === "pay" ? "on" : ""} onClick={() => { setTab("pay"); void call({ action: "pay" }); }}>💰 حسابي</button>}
              <button type="button" className={tab === "contract" ? "on" : ""} onClick={() => { setTab("contract"); void call({ action: "contract" }); }}>📜 العقد{data.contractDue ? " ⚠️" : ""}</button>
            </div>
            {tab === "papers" && data.contractDue && <div className="card warn"><div className="form"><b>📜 عندك عقد التصحيح، لازم تقراه وتوقعه.</b><button type="button" className="btn" disabled={busy} onClick={() => { setTab("contract"); void call({ action: "contract" }); }}>📜 افتح العقد ووقع</button></div></div>}
            {tab === "papers" && data.quota && <div className="card"><div className="form"><b>🎯 حصتك اليوم: صححت {data.quota.done} من {data.quota.target}</b>{data.quota.done >= data.quota.target && <span className="fdok">✅ وصلت حصتك</span>}</div></div>}
            {tab === "papers" && data.canEdit && <EditFind found={data.found ?? null} busy={busy} act={act} />}
            {tab === "papers" && <List data={data} busy={busy} act={act} openGroup={(g) => {
              group.current = `${g.exam}|${g.general}|${!!g.test}`; skipped.current.clear();
              void openNext();
            }} />}
            {tab === "history" && data.history && <HistoryTab h={data.history} busy={busy} owner={data.owner} act={act} />}
            {tab === "objlog" && data.objLog && <ObjLogTab h={data.objLog} busy={busy} act={act} />}
            {tab === "pay" && data.pay && <PayTab pay={data.pay} busy={busy} act={act} />}
            {tab === "check" && data.check && <CheckTab c={data.check} busy={busy} act={act} />}
            {tab === "contract" && data.contract && <ContractTab c={data.contract} owner={data.owner} busy={busy} act={act} />}
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
  const real = data.groups.filter((g) => !g.test), tests = data.groups.filter((g) => g.test);
  const [tryOpen, setTry] = useState(false);
  const gen = real.filter((g) => g.general), priv = real.filter((g) => !g.general);
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
      {data.only && <QuotaCard only={data.only} stop={data.quotaStop ?? []} busy={busy} act={act} />}
      <div className="card">
        <h2>📥 أوراق تنتظر: {sum(real)}</h2>
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
                <span className="gkcount">{g.count} ورقة</span>
                <button type="button" className="btn" disabled={busy} onClick={() => openGroup(g)}>▶ فتح التجمع</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">✅ ماكو أوراق تنتظر.</div>}
      </div>
      {/* 🧪 أوراق التجربة: لحالها بالآخر، مسدودة لحد ما يدوسها */}
      {!!tests.length && <div className="card">
        <button type="button" className="fthead" onClick={() => setTry(!tryOpen)}><b>🧪 التجريب ({sum(tests)} ورقة)</b><span>{tryOpen ? "▴" : "▾"}</span></button>
        {tryOpen && <div className="gkgroups">
          {tests.map((g) => (
            <div key={`t${g.exam}|${g.general}`} className="gkgroup">
              <div><b>{g.title}</b><small>{g.chapter} · أوراق طلاب التجربة</small></div>
              <span className="gkcount">{g.count} ورقة</span>
              <button type="button" className="btn" disabled={busy} onClick={() => openGroup(g)}>▶ فتح</button>
            </div>
          ))}
        </div>}
      </div>}
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
  const go = (day: string, all = !!h.everyone) => void act({ action: "history", day, all });
  const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
  return (
    <div className="card">
      <h2>📜 سجل التصحيح</h2>
      {h.owner && (
        <div className="seg">
          <button type="button" className={!h.everyone ? "on" : ""} disabled={busy} onClick={() => go(h.day, false)}>✍️ اللي صححتها أنا</button>
          <button type="button" className={h.everyone ? "on" : ""} disabled={busy} onClick={() => go(h.day, true)}>👥 كل المصححين والذكاء</button>
        </div>
      )}
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
  const fineSum = g.fines.length * g.rate.fine;
  return (
    <div className="card">
      <h2>✍️ {g.name}</h2>
      {all && <div className="exhint expad">📜 العقد: {g.contract ? (g.contract.current ? `✅ وقع ${g.contract.at.slice(0, 10)}` : "⚠️ وقع نسخة قديمة") : "⏳ ما وقع"}</div>}
      <div className="form">
        <div className="paybal">
          <div><span>أوراق إجبارية</span><b>{g.mand} × {iqd(g.rate.mandatory)}</b></div>
          <div><span>أوراق اختيارية</span><b>{g.opt} × {iqd(g.rate.optional)}</b></div>
          <div><span>اعتراضات انقبلت</span><b>− {g.obj} × {iqd(g.rate.deduct)}</b></div>
          {!!g.fines.length && <div><span>أيام ما وصل حصته والأوراق ما خلصت</span><b>− {g.fines.length} × {iqd(g.rate.fine)}</b></div>}
          <div className="paytotal"><span>الرصيد</span><b>{iqd(g.amount)}</b></div>
        </div>
        {!!g.fines.length && <div className="exhint">🎯 {g.fines.map((f) => `${f.day}: ${f.done} من ${f.target}`).join(" · ")}</div>}
        {all && !!g.fines.length && <Confirm label={`🤝 تسوية بدون الغرامات: ${iqd(g.amount + fineSum)}`} disabled={busy} onYes={() => void act({ action: "settle", grader: g.id, forgiveFine: true })} />}
        {all && (g.obj ? (
          <>
            <div className="hint">عليه {g.obj} اعتراض انقبل. تخصمها من حسابه؟</div>
            <Confirm label={`✂️ تسوية ويا الخصم: ${iqd(g.amount)}`} disabled={busy} onYes={() => void act({ action: "settle", grader: g.id })} />
            <Confirm label={`🤝 تسوية بدون خصم: ${iqd(g.amount + g.obj * g.rate.deduct)}`} disabled={busy} onYes={() => void act({ action: "settle", grader: g.id, forgive: true })} />
          </>
        ) : <Confirm label="💵 تسوية الحساب (يصفر الرصيد)" disabled={busy || (!g.mand && !g.opt && !g.fines.length)} onYes={() => void act({ action: "settle", grader: g.id })} />)}
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
            <label>غرامة اليوم اللي ما يوصل بيه حصته والأوراق ما تخلص (دينار، 0 = بدون)</label>{num("fine")}
            <label>قدرته: كم مرة من حصة المصحح العادي (1 عادي، 1.5 مرة ونص)</label>
            <input type="number" inputMode="decimal" className="ltr" min={0.2} max={5} step={0.1} value={rate.weight} onChange={(e) => setRate({ ...rate, weight: Number(e.target.value) || 1 })} />
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

/** فحص المصححين: كل مصحح وكم ورقة صحح، ومواضيعه، ومنها ورقة عشوائية يقلبها الأستاذ */
function CheckTab({ c, busy, act }: { c: Check; busy: boolean; act: Call }) {
  const rnd = (exam: number) => void act({ action: "checkRandom", grader: c.grader, exam });
  if (c.grader === null) return (
    <div className="card">
      <h2>👀 فحص المصححين</h2>
      <div className="expad"><small className="pdmode">اختار مصحح حتى تشوف المواضيع اللي صححها، وتفتح منها أوراق عشوائية.</small></div>
      {c.graders.length ? (
        <table className="extable"><tbody>
          {c.graders.map((g) => (
            <tr key={g.id} className="exrow" onClick={() => { if (!busy) void act({ action: "check", grader: g.id }); }}>
              <td><b>{g.name}</b><small className="pdmode">آخر ورقة: {g.last.slice(0, 10)} · شفت منها {g.checked}</small></td>
              <td className="p"><b>{g.count}</b><small>ورقة</small></td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty">ماكو أوراق مصححة لحد هسه.</div>}
    </div>
  );
  return (
    <div className="card">
      <h2>👀 {c.name}</h2>
      <div className="exline expad">
        <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "check" })}>› كل المصححين</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => rnd(0)}>🎲 ورقة عشوائية من كل مواضيعه</button>
      </div>
      <div className="expad"><small className="pdmode">المعدل: معدل درجات أوراقه بهذا الموضوع، وجنبه معدل باقي المصححين بنفس الموضوع. إذا الفرق كبير، قلب أوراقه أكثر.</small></div>
      <table className="extable"><tbody>
        {(c.topics ?? []).map((t) => (
          <tr key={t.exam}>
            <td><b>{t.title}</b>
              <small className="pdmode">{t.chapter} · {t.count} ورقة · شفت {t.checked}</small>
              <small className="pdmode">معدله {t.avg ?? "—"}{t.others !== null ? ` · باقي المصححين ${t.others}` : ""}</small>
            </td>
            <td className="p"><button type="button" className="exbtn adsmall" disabled={busy} onClick={() => rnd(t.exam)}>🎲 ورقة</button></td>
          </tr>
        ))}
      </tbody></table>
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

/** 🎯 الحصص (صاحب البوت): بالأصل المصحح يكمل بعد حصته ويعوض البطيئين، ولكل امتحان يگدر يخليه يوقف من يوصلها */
function QuotaCard({ only, stop, busy, act }: { only: Only; stop: number[]; busy: boolean; act: Call }) {
  const [exam, setExam] = useState(0);
  const title = (id: number) => only.exams.find((e) => e.id === id)?.title ?? String(id);
  return (
    <div className="card">
      <h2>🎯 حصة كل مصحح</h2>
      <div className="form">
        <div className="exhint">كل يوم، أوراق كل امتحان تنقسم بالعدد على المصححين اللي يگدرون يصححوه (والمصحح اللي «قدرته» أكثر ياخذ أكثر، تحددها بحسابه). كل مصحح يشوف «🎯 حصتك اليوم».</div>
        <div className="exhint">بالأصل يكمل بعد حصته حتى يعوض البطيئين. إذا تريد بامتحان معين يوقف من يوصل حصته، اختاره هنا:</div>
        <select value={exam} onChange={(e) => setExam(Number(e.target.value))}>
          <option value={0}>اختار الامتحان...</option>
          {only.exams.map((e) => <option key={e.id} value={e.id}>{e.chapter} · {e.title}</option>)}
        </select>
        {!!exam && (stop.includes(exam)
          ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void act({ action: "quotaStop", exam, on: false })}>✅ رجّعه: يكمل بعد حصته</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: "quotaStop", exam, on: true })}>🛑 يوقف من يوصل حصته</button>)}
        {!!stop.length && <div className="exhint">🛑 يوقفون من يوصلون حصتهم: {stop.map(title).join("، ")}</div>}
      </div>
    </div>
  );
}

/** التوقيع: يرسم بإصبعه أو بقلم الآيباد */
function SignPad({ onChange }: { onChange: (sig: { w: number; h: number; s: number[][] } | null) => void }) {
  const W = 600, H = 220;
  const cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<number[][]>([]);
  const live = useRef<number[] | null>(null);
  const pt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * W), Math.round((e.clientY - r.top) / r.height * H)]; };
  const ctx = () => { const c = cv.current!.getContext("2d")!; c.strokeStyle = "#0b2a6b"; c.lineWidth = 3.5; c.lineCap = "round"; c.lineJoin = "round"; return c; };
  function clear() { strokes.current = []; const c = cv.current!.getContext("2d")!; c.clearRect(0, 0, W, H); onChange(null); }
  useEffect(() => {
    const c = cv.current, stop = (e: TouchEvent) => e.preventDefault();
    c?.addEventListener("touchstart", stop, { passive: false }); c?.addEventListener("touchmove", stop, { passive: false });
    return () => { c?.removeEventListener("touchstart", stop); c?.removeEventListener("touchmove", stop); };
  }, []);
  return (
    <>
      <canvas ref={cv} width={W} height={H} className="inkpad" style={{ aspectRatio: `${W} / ${H}`, maxWidth: 600 }}
        onPointerDown={(e) => { e.preventDefault(); try { cv.current!.setPointerCapture(e.pointerId); } catch { /* */ } live.current = pt(e); }}
        onPointerMove={(e) => { const p = live.current; if (!p) return; const [x, y] = pt(e); const c = ctx(); c.beginPath(); c.moveTo(p[p.length - 2], p[p.length - 1]); c.lineTo(x, y); c.stroke(); p.push(x, y); }}
        onPointerUp={() => { if (live.current) { strokes.current.push(live.current); live.current = null; onChange({ w: W, h: H, s: strokes.current }); } }}
        onPointerCancel={() => { if (live.current) { strokes.current.push(live.current); live.current = null; onChange({ w: W, h: H, s: strokes.current }); } }} />
      <button type="button" className="exbtn" onClick={clear}>🗑 امسح التوقيع</button>
    </>
  );
}
const SigSvg = ({ sig }: { sig: Signed["sig"] }) => (
  <svg viewBox={`0 0 ${sig.w} ${sig.h}`} style={{ width: "100%", maxWidth: 320, height: "auto" }} aria-hidden>
    {sig.s.map((p, i) => <polyline key={i} points={p.reduce((a, v, k) => a + (k % 2 ? `,${v} ` : `${v}`), "")} fill="none" stroke="#0b2a6b" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>
);
/** ورقة العقد الرسمية (طلب الأستاذ 2026-11-22): شعاره واسمه فوك، العنوان، نصه هو (اسم المصحح منملي وحده)،
 *  وجوة مربعين: الطرف الأول قصي العميري، والطرف الثاني المصحح باسمه وتوقيعه. وشعاره خفيف ورا الكلام */
function ContractPaper({ text, no, date, name, sig, own, children }: { text: string; no: string; date: string; name?: string; sig?: Signed["sig"]; own?: Signed["sig"] | null; children?: React.ReactNode }) {
  return (
    <div className="cpaper contractpaper">
      <img className="cpwater" src="/logo.png" alt="" />
      <div className="cphead">
        <img src="/logo.png" alt="" />
        <div className="cpwho"><b>قصي العميري</b><span>مدرس الرياضيات · السادس الإعدادي</span></div>
        <div className="cpmeta"><span>رقم العقد: <b dir="ltr">{no}</b></span><span>التاريخ: <b dir="ltr">{date}</b></span></div>
      </div>
      <div className="cptitle">عقد تصحيح أوراق الامتحانات</div>
      <div className="cptext">{text}</div>
      <div className="cpsigns">
        <div className="cpbox"><b>الطرف الأول</b><span>قصي العميري</span>{own ? <SigSvg sig={own} /> : <div className="cpline" />}<small>التوقيع</small></div>
        <div className="cpbox"><b>الطرف الثاني (المصحح)</b><span>{name || "................................"}</span>
          {sig ? <SigSvg sig={sig} /> : <div className="cpline" />}<small>التوقيع</small></div>
      </div>
      {children}
    </div>
  );
}
/** نسخة العقد الموقعة: النص اللي وقع عليه، واسمه وتوقيعه والتاريخ. تنطبع */
function SignedCopy({ c, id }: { c: Signed; id?: number }) {
  return (
    <ContractPaper text={c.text} no={`${c.v}-${id ?? ""}`} date={c.at.slice(0, 10)} name={c.name} sig={c.sig} own={c.own}>
      <button type="button" className="exbtn noprint" onClick={() => window.print()}>🖨 اطبعه</button>
    </ContractPaper>
  );
}
/** 📜 العقد: صاحب البوت يكتب الصيغة ويشوف منو وقع، والمصحح يقراه ويوقع */
function ContractTab({ c, owner, busy, act }: { c: ContractData; owner: boolean; busy: boolean; act: Call }) {
  const [text, setText] = useState(c.text);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<Signed["sig"] | null>(null);
  const [who, setWho] = useState(0);
  const [ownSig, setOwnSig] = useState<Signed["sig"] | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  if (c.copy) return <><SignedCopy c={c.copy} id={c.copyId} /><button type="button" className="exbtn" onClick={() => void act({ action: "contract" })}>↩️ رجوع</button></>;
  if (c.preview) return (
    <>
      <div className="exhint">👁 هيچ يطلع العقد{c.preview.name ? ` لـ ${c.preview.name}` : " (مثال باسم «فلان الفلاني»)"}. هذا بس عرض، ما انحفظ شي.</div>
      <ContractPaper text={c.preview.text} no={`${c.v || 1}-${c.preview.id || ""}`} date={today} name={c.preview.name} own={c.own}>
        <button type="button" className="exbtn noprint" onClick={() => window.print()}>🖨 اطبعه</button>
      </ContractPaper>
      <button type="button" className="exbtn" onClick={() => void act({ action: "contract" })}>↩️ رجوع للكتابة</button>
    </>
  );
  return (
    <>
      {owner && (
        <div className="card">
          <h2>✍️ صيغة العقد</h2>
          <div className="form">
            <div className="exhint">اكتب العقد بكلامك. تگدر تحط بداخله: <b>{"{الاسم}"}</b> (اسم المصحح)، <b>{"{الغرامة}"}</b> (غرامة اليوم اللي تحددها بحسابه)، <b>{"{الحصة}"}</b> (قدرته)، <b>{"{التاريخ}"}</b>، وتنملى وحدها لكل مصحح. إذا غيرت الصيغة، كل المصححين يوقعون من جديد.</div>
            <div className="exhint">مثلاً: «أنا الموقع أدناه {"{الاسم}"} أتعهد...»، ويطلع اسم كل مصحح بمكانه. الشعار والعنوان ومربعات التوقيع تطلع وحدها بالورقة.</div>
            <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder="أنا الموقع أدناه {الاسم} أتعهد أن أصحح يومياً حصتي من الأوراق..." />
            <label>👁 شوف شكله باسم:</label>
            <select value={who} onChange={(e) => setWho(Number(e.target.value))}>
              <option value={0}>فلان الفلاني (مثال)</option>
              {(c.graders ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="button" className="exbtn" disabled={busy || text.trim().length < 20} onClick={() => void act({ action: "contractPreview", text, grader: who })}>👁 شوف شكل العقد</button>
            <button type="button" className="btn" disabled={busy || text.trim() === c.text} onClick={() => void act({ action: "contractSave", text })}>💾 احفظ العقد</button>
            <button type="button" className="exbtn" onClick={() => setOwnOpen(!ownOpen)}>✍️ توقيعك إنت (الطرف الأول){c.own ? " ✅" : ""}</button>
            {ownOpen && <>
              <div className="exhint">توقع مرة وحدة، ويطلع بمربع «الطرف الأول» بكل العقود. إذا وقعت من جديد، يتبدل بالعقود الجاية.</div>
              <SignPad onChange={setOwnSig} />
              <button type="button" className="btn" disabled={busy || !ownSig} onClick={() => void act({ action: "contractOwnSign", sig: ownSig })}>💾 احفظ توقيعي</button>
            </>}
            {c.v > 0 && <div className="exhint">النسخة {c.v} · آخر تعديل {c.updated.slice(0, 16)}</div>}
          </div>
        </div>
      )}
      {owner && !!c.graders?.length && (
        <div className="card">
          <h2>منو وقع</h2>
          <table className="extable"><tbody>
            {c.graders.map((g) => (
              <tr key={g.id}>
                <td><b>{g.name}</b><small className="pdmode">{g.signed ? (g.signed.current ? `✅ وقع ${g.signed.at.slice(0, 10)}` : `⚠️ وقع نسخة قديمة ${g.signed.at.slice(0, 10)}، لازم يوقع الجديدة`) : "⏳ بعده ما وقع"}</small></td>
                <td className="p">{g.signed && <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "contractCopy", grader: g.id })}>👁 نسخته</button>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {!owner && (c.v === 0 ? <div className="empty">بعده ما انكتب عقد.</div> : (
        <ContractPaper text={c.mine} no={`${c.v}-`} date={today} name={c.signed?.current ? undefined : name.trim()} own={c.own}>
          {c.signed?.current ? (
            <div className="form">
              <div className="fdok">✅ وقعته بتاريخ {c.signed.at.slice(0, 16)}</div>
              <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "contractCopy" })}>👁 نسختي الموقعة</button>
            </div>
          ) : (
            <div className="form">
              {c.signed && <div className="exhint">⚠️ العقد تغير بعد ما وقعت، اقراه ووقع النسخة الجديدة.</div>}
              <label>اسمك الكامل</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <label>توقيعك (بإصبعك أو بالقلم)</label>
              <SignPad onChange={setSig} />
              <button type="button" className="btn" disabled={busy || name.trim().split(/\s+/).length < 2 || !sig} onClick={() => void act({ action: "contractSign", name, sig })}>✍️ أوقع على العقد</button>
            </div>
          )}
        </ContractPaper>
      ))}
    </>
  );
}
