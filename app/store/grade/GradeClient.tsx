"use client";
// التصحيح: قائمة الأوراق، وشاشة الورقة بكل الشاشة مثل النظام القديم (Grader)
import { useEffect, useRef, useState } from "react";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import Grader, { type Paper, type Prepared, type Sticker } from "./Grader";

type Row = { id: number; exam: number; general: boolean; optional: boolean; name: string; title: string; chapter: string; model: string; submitted: string; total: number | null; graded: string; test: boolean; grader: string };
type ObjRow = Row & { qs: number[] };
type Group = { exam: number; general: boolean; title: string; chapter: string; count: number; tests: number };
type HistRow = Row & { objOpen: number; objOk: number; objNo: number };
type History = { day: string; days: { d: string; n: number }[]; prev: string; next: string; due: number | null; count: number; owner: boolean; rows: HistRow[] };
type Rate = { mandatory: number; optional: number; deduct: number };
type PayCard = { id: number; name: string; chapters: string[]; rate: Rate; mand: number; opt: number; obj: number; amount: number; archive: { id: number; mand: number; opt: number; obj: number; forgiven?: boolean; amount: number; created: string }[] };
type Pay = { all: boolean; chapters: string[]; graders: PayCard[] };
type Data = { groups: Group[]; history?: History; pay?: Pay; objections: ObjRow[]; waiting: Row[]; done: Row[]; owner: boolean; hasTests: boolean; fileToken: string; paper: Paper | null; notice: string; today: number; errors?: string[]; stickers?: Sticker[] };
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
  const { data, error, busy, call } = useAdminApi<Data>("/api/grade", only ? "✋ الاعتراضات" : "✍️ التصحيح");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [allDone, setAllDone] = useState(false);
  const skipped = useRef(new Set<number>());
  // الامتحان اللي فتحه: الأوراق تنفتح منه وحده لحد ما تخلص
  const group = useRef<string | null>(null);
  const [tab, setTab] = useState<"papers" | "history" | "pay">("papers");
  const inGroup = (x: Row) => group.current === null || `${x.exam}|${x.general}` === group.current;
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
    const nextPaper = data?.waiting.find((x) => x.id !== p.id && inGroup(x) && !skipped.current.has(x.id) && !saving.current.has(x.id));
    setPaper(null);
    if (nextPaper) void act({ action: "open", id: nextPaper.id });
    else setAllDone(true);
  }
  /** بعد ما تتخطى، تنفتح الورقة اللي بعدها وحدها */
  async function next(r: Data | null) {
    const p = r?.waiting.find((x) => inGroup(x) && !skipped.current.has(x.id));
    setPaper(null);
    if (p) await act({ action: "open", id: p.id });
    else setAllDone(true);
  }
  return (
    <>
      {!paper && !allDone && <AdminHeader title={only ? "✋ الاعتراضات" : "✍️ التصحيح"} />}
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && paper && bgErr && <div className="gk-bgerr" onClick={() => setBgErr("")}>{bgErr} ✕</div>}
        {data && paper && (
          <Grader key={paper.id} paper={paper} url={url} busy={busy} act={act} today={data.today + savedNow} stickers={data.stickers ?? []} left={data.waiting.filter((x) => x.id !== paper.id && inGroup(x) && !saving.current.has(x.id)).length}
            onClose={() => { setPaper(null); setSavedNow(0); group.current = null; void call({ action: "list" }); }}
            onSkip={async () => { skipped.current.add(paper.id); await next(await call({ action: "release", id: paper.id })); }}
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
          data.objections.length ? <ObjList data={data} busy={busy} act={act} /> : <div className="empty">👏 ماكو اعتراضات تنتظر</div>
        )}
        {data && !paper && !allDone && !only && (
          <>
            <div className="seg gktabs">
              <button type="button" className={tab === "papers" ? "on" : ""} onClick={() => { setTab("papers"); void call({ action: "list" }); }}>📥 الأوراق</button>
              <button type="button" className={tab === "history" ? "on" : ""} onClick={() => { setTab("history"); void call({ action: "history" }); }}>📜 السجل</button>
              {!data.owner && <button type="button" className={tab === "pay" ? "on" : ""} onClick={() => { setTab("pay"); void call({ action: "pay" }); }}>💰 حسابي</button>}
            </div>
            {tab === "papers" && <List data={data} busy={busy} act={act} openGroup={(g) => {
              group.current = `${g.exam}|${g.general}`; skipped.current.clear();
              const p = data.waiting.find(inGroup);
              if (p) void act({ action: "open", id: p.id });
            }} />}
            {tab === "history" && data.history && <HistoryTab h={data.history} busy={busy} owner={data.owner} act={act} />}
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
      {!!data.objections.length && <ObjList data={data} busy={busy} act={act} />}
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
                <div><b>{g.title}</b><small>{g.chapter}</small></div>
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
