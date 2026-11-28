"use client";
// صفحة الطلاب: الأرقام، البحث، وفورمة كل طالب داخل نفس الصفحة
import { createContext, useContext, useEffect, useState } from "react";
import VoiceRec from "../VoiceRec";
import PhotoPick from "../PhotoPick";
import Thumbs from "../Thumbs";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import { CURR_OPTS, DateInput, SIDE_OPTS, Seg, cleanPhone } from "../shared";

type S = { id: number; username: string; name: string; curr: string; grade: string; gov: string; side: string; area: string; phone1: string; phone2: string; exam: string; gender: string; guardian: boolean; pin?: boolean; gcode?: string; pilot?: boolean; app?: boolean; sos?: boolean; door?: boolean; gw: { lastSeen: string | null; unseen: number; blockedAt: string | null } | null; wa: string | null; device: { at: string; tried: string } | null; stop: { at: string; reason: string; what: string; chapter: string; score: number; max: number; absent: number } | null; centerId: number; center: string; created: string; updated: string };
type Area = { id: number; gov: string; name: string; centers: { id: number; name: string }[] };
type TestStudent = { id: number; name: string; curr?: string; papers: number; graded: number; chapters?: string[]; link: string };
type TestVersion = { id: number; exam: number; slug: string; title: string; chapter: string; model: string; qs: { n: number; max: number }[] };
type Paper = { id: number; title: string; chapter: string; model: string; optional: boolean; submitted: string; graded: string; total: number | null; grader: string; ai: boolean; marks: { n: number; max: number; mark: number | null; skip?: boolean }[]; objections: { open: number; ok: number; no: number }; pages: string[]; gradedPages: boolean };
type StudentFile = { id: number; canEdit: boolean; fileToken: string; papers: Paper[]; orders: { id: number; created: string; state: string; cancelled: boolean; total: number; items: string[] }[]; spent: number; absences: { id: number; title: string; chapter: string; at: string }[]; attended: { id: number; title: string; at: string }[]; stops: { id: number; chapter: string; score: number; max: number; absent: number; reason: string; created: string; lifted: string }[]; questions: { id: number; status: string; created: string }[]; lectures?: { title: string; subject: string; times: number; percent: number; last: string }[]; crashes?: { at: string; model: string; os: string; ver: string; screen: string; error: string }[]; log: { what: string; created: string }[]; average: number | null; retDisc?: { on: boolean; pct: number; year: string; lastYear: string; last: string[]; now: string[] } };
type Data = { doorLink?: string; doorFor?: number; canMsg?: boolean; file?: StudentFile; papers?: { id: number; list: Paper[]; fileToken: string }; tests?: TestStudent[] | null; testVersions?: TestVersion[] | null; stats: Record<string, number>; results: S[]; found: number; limit: number; govs: string[]; areas: Area[]; notice: string; tryCode?: { k: number; img: string }; tryCodes?: { k: number; kind: string; img: string }[]; log?: { id: number; rows: { what: string; created: string }[] }; sched?: { id: number; view?: string; way: string; inPerson?: boolean; items: { id: number; title: string; at: string; state: string; status?: string; retake?: boolean; optional?: boolean; away?: boolean; ipad?: boolean }[]; perDay: number; general: number; times?: { picks: Record<string, string>; days: { d: number; name: string; times: { t: string; label: string; full?: boolean }[] }[] } | null; hol?: { from: string; to: string } | null; holReq?: { from: string; to: string } | null }; testAccts?: S[] };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس" }, { v: "الخامس العلمي", label: "الخامس" }];
const GENDER_OPTS = [{ v: "بنين", label: "بنين" }, { v: "بنات", label: "بنات" }];
/** رفع فورم (فويس) بنفس البحث والفلاتر اللي بالصفحة */
const UploadCtx = createContext<(f: FormData) => Promise<Data | null>>(async () => null);
const EXAM_OPTS = [{ v: "حضوري", label: "🏫 حضوري" }, { v: "إلكتروني", label: "💻 إلكتروني" }];

export default function StudentsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/students", "🎓 الطلاب");
  const [q, setQ] = useState("");       // المكتوب بالمربع
  const [shown, setShown] = useState(""); // البحث اللي نتيجته طالعة
  const [open, setOpen] = useState<number | null>(null);
  const [fileOf, setFileOf] = useState<S | null>(null);
  const [fileData, setFileData] = useState<StudentFile | null>(null);
  const [filters, setFilters] = useState({ curr: "", grade: "", exam: "", gov: "" });
  const [picked, setPicked] = useState<number[]>([]);
  const [printing, setPrinting] = useState(false);
  const act = (b: Record<string, unknown>) => call({ q: shown, filters, ...b });
  const upload = (f: FormData) => { f.set("q", shown); f.set("filters", JSON.stringify(filters)); return call(f); };
  function filter(k: keyof typeof filters, v: string) {
    const next = { ...filters, [k]: v };
    setFilters(next);
    setOpen(null);
    void call({ action: "list", q: shown, filters: next });
  }
  const s = data?.stats;
  const [tryOpen, setTry] = useState(false);
  async function openFile(x: S) {
    setFileOf(x); setFileData(null);
    window.scrollTo(0, 0);
    const r = await act({ action: "file", id: x.id });
    if (r?.file) setFileData(r.file);
  }
  if (fileOf && data) {
    return (
      <UploadCtx.Provider value={upload}>
        <AdminHeader title="📂 ملف الطالب" />
        <div className="wrap">
          <button type="button" className="exbtn" style={{ marginBottom: 10 }} onClick={() => { setFileOf(null); setFileData(null); }}>⬅️ رجوع لقائمة الطلاب</button>
          <FileView s={data.results.find((x) => x.id === fileOf.id) ?? fileOf} file={fileData} data={data} busy={busy} call={act} close={() => { setFileOf(null); setFileData(null); }} />
          {data.tests && fileOf.id > 0 && (() => {
            const isTest = !!data.testAccts?.some((x) => x.id === fileOf.id);
            return <div className="card expad exline"><span className="exhint">{isTest ? "🧪 هذا حساب تجربة: ما يطلع بقائمة الطلاب، يطلع جوه «🧪 التجريب»." : "حساب تستعمله للتجربة؟ أشّره حتى ما يطلع بقائمة الطلاب الحقيقية."}</span>
              <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "testAcct", id: fileOf.id, on: !isTest })}>{isTest ? "↩️ رجّعه حساب حقيقي" : "🧪 حساب تجربة"}</button></div>;
          })()}
        </div>
        <StatusBar busy={busy} error={error} notice={data.notice} />
      </UploadCtx.Provider>
    );
  }

  return (
    <UploadCtx.Provider value={upload}>
      <AdminHeader title="🎓 الطلاب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && s && (
          <>
            <div className="card">
              <h2>📊 الطلاب المسجلين: {s.all}</h2>
              <div className="adstats">
                <div><b>{s.g6}</b>السادس</div><div><b>{s.g5}</b>الخامس</div>
                <div><b>{s.in}</b>حضوري</div><div><b>{s.on}</b>إلكتروني</div>
                <div><b>{s.ar}</b>عربي</div><div><b>{s.en}</b>إنجليزي</div>
              </div>
              <div className="expad exline">
                <button type="button" className="exbtn" onClick={() => setPrinting(!printing)}>🖨 طباعة قائمة</button>
              </div>
              {printing && (
                <div className="expad exline">
                  <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "pdf", kind: "all" })}>📄 كل الطلاب ({s.all})</button>
                  <button type="button" className="exbtn" disabled={busy || !data.found} onClick={() => void act({ action: "pdf", kind: "found" })}>📄 نتيجة البحث والفلاتر ({data.found})</button>
                  <button type="button" className="exbtn" disabled={busy || !picked.length} onClick={() => void act({ action: "pdf", kind: "picked", ids: picked })}>📄 المحددين ({picked.length})</button>
                </div>
              )}
            </div>
            <form className="exadd adsearch" onSubmit={(e) => { e.preventDefault(); setShown(q); setOpen(null); void call({ action: "list", q, filters }); }}>
              <input placeholder="🔍 اسم الطالب أو رقم هاتفه" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className="exbtn" disabled={busy}>بحث</button>
            </form>
            <div className="adfilters">
              <select aria-label="المنهج" value={filters.curr} onChange={(e) => filter("curr", e.target.value)}><option value="">كل المناهج</option>{CURR_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
              <select aria-label="الصف" value={filters.grade} onChange={(e) => filter("grade", e.target.value)}><option value="">كل الصفوف</option>{GRADE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
              <select aria-label="الامتحان" value={filters.exam} onChange={(e) => filter("exam", e.target.value)}><option value="">كل الامتحانات</option>{EXAM_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
              <select aria-label="المحافظة" value={filters.gov} onChange={(e) => filter("gov", e.target.value)}><option value="">كل المحافظات</option>{data.govs.map((g) => <option key={g} value={g}>{g}</option>)}</select>
            </div>
            <div className="card">
              <h2>{shown.trim() || Object.values(filters).some(Boolean) ? `النتائج: ${data.found}` : "آخر المسجلين"}</h2>
              {data.results.length ? (
                <table className="extable"><tbody>
                  {data.results.map((x) => (
                    <Rows key={x.id} s={x} data={data} picked={picked.includes(x.id)} pick={() => setPicked(picked.includes(x.id) ? picked.filter((i) => i !== x.id) : [...picked, x.id])} open={open === x.id} toggle={() => void openFile(x)} close={() => setOpen(null)} busy={busy} call={act} />
                  ))}
                </tbody></table>
              ) : <div className="empty">ما لگيت طالب.</div>}
              {data.found > data.results.length && <div className="expad exhint">تطلع أول {data.results.length} من {data.found}. استخدم البحث أو الفلاتر حتى توصل للطالب.</div>}
            </div>
            {/* 🧪 التجريب (طلبه 2026-11-26): كل شي تجريبي هنا بس، مسدود لحد ما يدوسه */}
            {(data.tests || !!data.testAccts?.length) && <div className="card">
              <button type="button" className="fthead" onClick={() => setTry(!tryOpen)}><b>🧪 التجريب</b><span>{tryOpen ? "▴" : "▾"}</span></button>
              {tryOpen && <>
                {!!data.testAccts?.length && <>
                  <div className="exlabel adtop">👤 حسابات التجربة ({data.testAccts.length})</div>
                  <table className="extable"><tbody>
                    {data.testAccts.map((x) => <tr key={x.id} className="exrow" onClick={() => void openFile(x)}><td><b>{x.name}</b><small className="pdmode">{x.phone1}</small></td><td className="p">📂 ملفه</td></tr>)}
                  </tbody></table>
                </>}
                {data.tests && <TestStudents tests={data.tests} chapters={[...new Set((data.testVersions ?? []).map((v) => v.chapter).filter(Boolean))]} busy={busy} act={act} />}
                {data.tests && data.testVersions && <InPersonTry areas={data.areas} versions={data.testVersions} busy={busy} act={act} code={data.tryCode} codes={data.tryCodes} />}
                {data.tests && !!data.tests.length && data.testVersions && <TryExam tests={data.tests} versions={data.testVersions} busy={busy} act={act} />}
                {data.tests && !!data.tests.length && data.testVersions && <TestPaper tests={data.tests} versions={data.testVersions} busy={busy} upload={(f) => call(f)} />}
              </>}
            </div>}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </UploadCtx.Provider>
  );
}

function Rows({ s, data, picked, pick, open, toggle, close, busy, call }: { s: S; data: Data; picked: boolean; pick: () => void; open: boolean; toggle: () => void; close: () => void; busy: boolean; call: Call }) {
  return (
    <>
      <tr className={"exrow" + (open || picked ? " sel" : "")} onClick={toggle}>
        <td className="adpick" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${s.name}`} checked={picked} onChange={pick} /></td>
        <td><b>{s.name}</b><small className="pdmode">{s.grade} · {s.exam || "بدون امتحان"}{s.center ? ` · ${s.center}` : ""}</small></td>
        <td className="adphone">{s.phone1}</td>
      </tr>
      {open && <tr><td colSpan={3} className="expanel"><Form key={s.updated + s.id} s={s} data={data} close={close} busy={busy} call={call} /></td></tr>}
    </>
  );
}

type Tab = "grades" | "papers" | "money" | "absent" | "sched" | "info" | "log";
const TABS: [Tab, string][] = [["grades", "📊 درجاته"], ["papers", "📝 أوراقه"], ["money", "💰 مشترياته"], ["absent", "⛔ غياباته"], ["sched", "🗓 جدوله"], ["info", "👤 معلوماته"], ["log", "📜 سجله"]];

/** ملف الطالب: كل شي يخصه بمكان واحد */
function FileView({ s, file, data, busy, call, close }: { s: S; file: StudentFile | null; data: Data; busy: boolean; call: Call; close: () => void }) {
  const [tab, setTab] = useState<Tab>("grades");
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState("");
  const papers = file?.papers ?? [];
  const chapters = [...new Set(papers.map((p) => p.chapter).filter(Boolean))];
  const inChapter = chapter ? papers.filter((p) => p.chapter === chapter) : papers;
  const topics = [...new Set(inChapter.map((p) => p.title))];
  const shownPapers = topic ? inChapter.filter((p) => p.title === topic) : inChapter;
  const graded = inChapter.filter((p) => p.total !== null);
  const avg = graded.length ? Math.round(graded.reduce((t, p) => t + Number(p.total), 0) / graded.length) : null;
  function pick(t: Tab) {
    setTab(t);
    if (t === "sched") void call({ action: "sched", id: s.id });
  }
  const chapterBox = (
    <select className="exinput" aria-label="الفصل" value={chapter} onChange={(e) => { setChapter(e.target.value); setTopic(""); }}>
      <option value="">كل الفصول</option>
      {chapters.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
  return (
    <>
      <div className="card expad">
        <h2 style={{ margin: 0 }}>{s.name}</h2>
        <div className="exhint">{s.grade} · {s.curr} · {s.exam || "بدون امتحان"}{s.center ? ` · ${s.center}` : ""}</div>
        <div className="exhint" dir="ltr" style={{ textAlign: "right" }}>{s.phone1}</div>
        {file && (
          <div className="adstats adstats2 adtop">
            <div><b>{file.average ?? "—"}</b>المعدل</div>
            <div><b>{file.papers.length}</b>ورقة</div>
            <div><b>{file.absences.length}</b>غياب</div>
            <div><b>{file.spent.toLocaleString("en-US")}</b>مشترياته</div>
          </div>
        )}
      </div>
      <div className="seg wrap2" style={{ flexWrap: "wrap", marginBottom: 10 }}>
        {TABS.map(([k, label]) => <button type="button" key={k} className={tab === k ? "on" : ""} style={{ flex: "1 1 30%" }} onClick={() => pick(k)}>{label}</button>)}
      </div>
      {!file && <div className="empty">جاري تحميل ملفه...</div>}
      {file && tab === "grades" && (
        <div className="card expad">
          {chapterBox}
          <div className="exhint adtop">{graded.length} درجة{avg !== null ? ` · معدل ${avg}` : ""}</div>
          {inChapter.length ? inChapter.map((p) => (
            <div key={p.id} className="adsale">{p.title}{p.optional ? " (اختياري)" : ""}<small>{p.chapter}</small><small>{(p.graded || p.submitted).slice(0, 10)}</small><b>{p.total !== null ? `${p.total} من 100` : "بعده ما انصحح"}</b></div>
          )) : <div className="exhint">ماكو درجات.</div>}
        </div>
      )}
      {file && tab === "papers" && (
        <div className="card expad">
          {chapterBox}
          <select className="exinput adtop" aria-label="الموضوع" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">كل المواضيع</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <PapersPanel papers={{ id: s.id, list: shownPapers, fileToken: file.fileToken }} canEdit={file.canEdit} />
        </div>
      )}
      {file && tab === "money" && (
        <div className="card expad">
          <div className="exhint">المجموع بدون الملغي: <b>{file.spent.toLocaleString("en-US")}</b> دينار</div>
          {file.orders.length ? file.orders.map((o) => (
            <div key={o.id} className="adsale">
              <b>#{o.id}</b> {o.items.join("، ")}
              <small>{o.created.slice(0, 16)}</small>
              <small className={o.cancelled ? "exbad" : ""}>{o.state}</small>
              <b>{o.total.toLocaleString("en-US")}</b>
            </div>
          )) : <div className="exhint">ماكو مشتريات.</div>}
          {file.retDisc && <>
            <div className="exlabel adtop">🎁 خصم طالب العام{file.retDisc.on ? ` (${file.retDisc.pct}%)` : " (مطفي هسه)"}</div>
            <div className="exhint">اشترى بسنة {file.retDisc.lastYear}، فعليه خصم هالسنة على: <b>{file.retDisc.last.length ? file.retDisc.last.join("، ") : "ولا شي"}</b></div>
            <div className="exhint">اشترى بسنة {file.retDisc.year}، فعليه خصم السنة الجاية على: <b>{file.retDisc.now.length ? file.retDisc.now.join("، ") : "ولا شي"}</b></div>
          </>}
        </div>
      )}
      {file && tab === "absent" && (
        <div className="card expad">
          <div className="exlabel">⛔ غياباته ({file.absences.length})</div>
          {file.absences.length ? file.absences.map((a) => <div key={a.id} className="adsale">{a.title}<small>{a.chapter}</small><small dir="ltr">{a.at}</small></div>) : <div className="exhint">ماكو غيابات.</div>}
          {!!file.crashes?.length && <>
            <div className="exlabel adtop">💥 أعطال التطبيق بتلفونه ({file.crashes.length})</div>
            {file.crashes.map((c, i) => <div key={i} className="adsale">{c.error.slice(0, 160)}<small>{c.model} · {c.os} · نسخة {c.ver}{c.screen ? ` · ${c.screen}` : ""}</small><small dir="ltr">{String(c.at).slice(0, 16)}</small></div>)}
          </>}
          <div className="exlabel adtop">🎬 مشاهداته للمحاضرات ({file.lectures?.length ?? 0})</div>
          {file.lectures?.length ? file.lectures.map((v, i) => <div key={i} className="adsale">{v.title}<small>{v.times > 1 ? `شافها ${v.times} مرات` : "شافها مرة وحدة"} · وصل {v.percent}٪</small><small dir="ltr">{v.last.slice(0, 16)}</small></div>) : <div className="exhint">بعده ما شاف ولا محاضرة بالتطبيق (أو ما يجرب التطبيق الجديد).</div>}
          <div className="exlabel adtop">🎫 حضوره بالمركز ({file.attended.length})</div>
          {file.attended.map((a) => <div key={a.id} className="adsale">{a.title}<small dir="ltr">{a.at}</small></div>)}
          <div className="exlabel adtop">🚦 إيقافات السيطرة ({file.stops.length})</div>
          {file.stops.length ? file.stops.map((x) => <div key={x.id} className="adsale">{x.chapter}: {x.score} من {x.max}، غياب {x.absent}<small>{x.reason}</small><small>{x.created.slice(0, 10)}{x.lifted ? ` · انفك ${x.lifted.slice(0, 10)}` : " · بعده موقوف"}</small></div>) : <div className="exhint">ماكو إيقافات.</div>}
        </div>
      )}
      {file && tab === "sched" && (data.sched?.id === s.id ? <SchedPanel key={data.sched.perDay} sched={data.sched} id={s.id} busy={busy} call={call} /> : <div className="empty">جاري تحميل جدوله...</div>)}
      {tab === "info" && <div className="card expad"><Form key={s.updated + s.id} s={s} data={data} close={close} busy={busy} call={call} inFile /></div>}
      {file && tab === "log" && (
        <div className="card expad">
          <div className="exlabel">❓ أسئلته العلمية: {file.questions.length}</div>
          <div className="exlabel adtop">📜 عملياته</div>
          {file.log.length ? file.log.map((r, i) => <div key={i} className="adsale">{r.what}<small>{r.created}</small></div>) : <div className="exhint">ما أكو عمليات مسجلة.</div>}
        </div>
      )}
    </>
  );
}

/** «📩 رسالة»: للطالب أو لولي أمره، كتابة أو فويس أو الاثنين. توصل بالبوت ومحمية ما تنحول */
/** طوارئ لهذا الطالب بس (يشوف البوت كله)، ورابط بالمتصفح إذا التطبيق خربان عنده. تقدر توقفه بأي وقت */
function EmergencyBox({ s, busy, call }: { s: S; busy: boolean; call: Call }) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  async function make() {
    const r = await call({ action: "doorMake", id: s.id, fresh: true });
    if (r?.doorLink && r.doorFor === s.id) { setLink(r.doorLink); setCopied(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }
  return (
    <>
      <label className="adcheck adflat">
        <input type="checkbox" checked={!!s.sos} disabled={busy} onChange={(e) => void call({ action: "sos", id: s.id, on: e.target.checked })} />
        <span>🚨 طوارئ: افتحله البوت كله (بتليگرام أو بالرابط)</span>
      </label>
      {link ? (
        <div className="form">
          <input readOnly value={link} dir="ltr" onFocus={(e) => e.target.select()} />
          <button type="button" className="exbtn" onClick={() => void copy()}>{copied ? "✅ انتسخ، دزه للطالب" : "📋 انسخ الرابط"}</button>
        </div>
      ) : null}
      {s.door
        ? <><Confirm label="🔗 عنده رابط بالمتصفح: سويله رابط جديد (القديم يبطل)" disabled={busy} onYes={() => void make()} /><Confirm label="⛔ وقف رابطه بالمتصفح" disabled={busy} onYes={() => { setLink(""); void call({ action: "doorRevoke", id: s.id }); }} /></>
        : <Confirm label="🔗 سويله رابط بالمتصفح (إذا التطبيق خربان عنده)" disabled={busy} onYes={() => void make()} />}
    </>
  );
}

function MsgPanel({ s, busy }: { s: S; busy: boolean }) {
  const upload = useContext(UploadCtx);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<"student" | "guardian">("student");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [rec, setRec] = useState(false);
  if (!open) return <div className="exline expad"><button type="button" className="exbtn" onClick={() => setOpen(true)}>📩 رسالة للطالب أو لولي أمره</button></div>;
  async function send() {
    const f = new FormData();
    f.set("action", "message"); f.set("id", String(s.id)); f.set("to", to); f.set("text", text);
    if (voice) f.set("voice", voice, "voice");
    if (await upload(f)) { setText(""); setVoice(null); setOpen(false); }
  }
  return (
    <div className="card expad adtop">
      <div className="exlabel">📩 رسالة إلى</div>
      <div className="seg">
        <button type="button" className={to === "student" ? "on" : ""} onClick={() => setTo("student")}>🎓 الطالب</button>
        <button type="button" className={to === "guardian" ? "on" : ""} disabled={!s.guardian} onClick={() => setTo("guardian")}>👨‍👧 ولي أمره{s.guardian ? "" : " (مو مربوط)"}</button>
      </div>
      <textarea className="stfield adtop" rows={3} maxLength={3000} placeholder="اكتب الرسالة (أو سجل فويس، أو الاثنين)" value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      <VoiceRec value={voice} onChange={setVoice} onRecording={setRec} btn="exbtn" label="🎙 فويس (اختياري، أكثر شي 5 دقايق)" />
      <div className="exline adtop">
        <button type="button" className="btn" disabled={busy || rec || (!text.trim() && !voice)} onClick={() => void send()}>📤 دز {to === "guardian" ? "لولي أمره" : "للطالب"}</button>
        <button type="button" className="exbtn" disabled={rec} onClick={() => setOpen(false)}>إلغاء</button>
      </div>
      <div className="exhint">توصل بالبوت باسم «قصي العميري»، ومحمية ما تنحول. وتنكتب بسجل الطالب.</div>
    </div>
  );
}

function Form({ s, data, close, busy, call, inFile }: { s: S; data: Data; close: () => void; busy: boolean; call: Call; inFile?: boolean }) {
  const startArea = data.areas.find((a) => a.centers.some((c) => c.id === s.centerId));
  const [name, setName] = useState(s.name);
  const [curr, setCurr] = useState(s.curr);
  const [grade, setGrade] = useState(s.grade);
  const [gov, setGov] = useState(s.gov);
  const [side, setSide] = useState(s.side);
  const [area, setArea] = useState(s.area);
  const [p1, setP1] = useState(s.phone1);
  const [p2, setP2] = useState(s.phone2);
  const [exam, setExam] = useState(s.exam);
  const [gender, setGender] = useState(s.gender);
  const [carea, setCarea] = useState(startArea?.id ?? 0);
  const [center, setCenter] = useState(startArea ? s.centerId : 0);
  const centers = data.areas.find((a) => a.id === carea)?.centers ?? [];

  async function save() {
    const form = { n: name, cu: curr, gr: grade, g: gov, s: side, a: area, p1: cleanPhone(p1), p2: cleanPhone(p2), e: exam, c: exam === "حضوري" ? center : 0, sx: gender };
    if (await call({ action: "save", id: s.id, form })) close();
  }
  return (
    <div>
      <div className="exhint">مسجل من: {s.created}{s.username ? ` · @${s.username}` : ""}</div>
      <div className="exline">
        {!inFile && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "log", id: s.id })}>📜 عمليات الطالب</button>}
        {!inFile && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "sched", id: s.id })}>🗓 جدوله</button>}
        {!inFile && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "papers", id: s.id })}>📝 أوراقه</button>}
        {s.stop && (
          <>
            <span className="exhint exbad">⛔ موقوفة عليه {s.stop.what} من {s.stop.at.slice(0, 10)}: {s.stop.reason} ({s.stop.chapter}: {s.stop.score} من {s.stop.max}، غياب {s.stop.absent})</span>
            <Confirm label="✅ فك الإيقاف" disabled={busy} onYes={() => void call({ action: "liftStop", id: s.id })} />
          </>
        )}
        {s.device ? (
          <>
            {s.device.tried && <span className="exhint exbad">🔒 حاول يفتح من جهاز ثاني: {s.device.tried}</span>}
            <Confirm label={`📱 مقفول على جهاز من ${s.device.at.slice(0, 10)}: فك القفل`} disabled={busy} onYes={() => void call({ action: "unlockDevice", id: s.id })} />
          </>
        ) : <span className="exhint">📱 لسه ما فتح صفحاته من أي جهاز</span>}
        {s.app ? (
          <label className="adcheck adflat">
            <input type="checkbox" checked={!!s.pilot} disabled={busy} onChange={(e) => void call({ action: "pilot", id: s.id, on: e.target.checked })} />
            <span>🧪 يجرب التطبيق الجديد (البوت داخل التطبيق)</span>
          </label>
        ) : <span className="exhint">📱 بعده ما فتح التطبيق بعد التحديث، فما يگدر يجرب الجديد</span>}
        <EmergencyBox s={s} busy={busy} call={call} />
        {s.pin && <SignPhotos id={s.id} />}
        {/* رمز ولي الأمر: الأستاذ يصنعه وينطيه لولي الأمر بس (قراره 2026-11-22) */}
        {s.gcode !== undefined && (s.gcode
          ? <span className="exhint">🔑 رمز ولي الأمر: <b dir="ltr" style={{ fontSize: 20, letterSpacing: 4 }}>{s.gcode}</b> · انطيه لولي الأمر بس</span>
          : <span className="exhint">🔑 بعده ما صنعت رمز لولي أمره</span>)}
        {!!data.tests && <Confirm label={s.gcode ? "🔄 رمز جديد لولي الأمر (القديم يبطل)" : "🔑 اصنع رمز لولي الأمر"} disabled={busy} onYes={() => void call({ action: "issuePin", id: s.id })} />}
        {s.pin && <Confirm label="🔐 شيل رمز ولي الأمر" disabled={busy} onYes={() => void call({ action: "resetPin", id: s.id })} />}
        {s.guardian ? <Confirm label="👨‍👧 مربوط بولي أمر: فك الربط" disabled={busy} onYes={() => void call({ action: "unlink", id: s.id })} /> : <span className="exhint">ولي الأمر غير مربوط</span>}
        {s.gw?.blockedAt && <span className="exhint exbad">⛔ ولي الأمر سوى بلوك للبوت من {s.gw.blockedAt.slice(0, 10)}</span>}
        {s.gw && !s.gw.blockedAt && <span className={s.gw.unseen >= 3 ? "exhint exbad" : "exhint"}>✅ آخر مرة استلم درجة: {s.gw.lastSeen ? s.gw.lastSeen.slice(0, 16) : "بعده ما داس استلمت"}{s.gw.unseen ? ` · ${s.gw.unseen} درجة ما فتحها` : ""}</span>}
        {s.wa && <a className="exbtn" href={s.wa} target="_blank" rel="noreferrer">💬 واتساب ولي الأمر</a>}
      </div>
      {data.canMsg && <MsgPanel s={s} busy={busy} />}
      {!inFile && data.papers?.id === s.id && <PapersPanel papers={data.papers} />}
      {!inFile && data.sched?.id === s.id && <SchedPanel key={data.sched.perDay} sched={data.sched} id={s.id} busy={busy} call={call} />}
      {data.log?.id === s.id && (
        <div className="adlog">
          {data.log.rows.length ? data.log.rows.map((r, i) => <div key={i} className="adsale">{r.what}<small>{r.created}</small></div>) : <div className="exhint">ما أكو عمليات مسجلة بعد.</div>}
        </div>
      )}
      <label>الاسم الرباعي</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label>بنين لو بنات</label>
      <Seg options={GENDER_OPTS} value={gender} onPick={setGender} />
      <label>المنهج</label>
      <Seg options={CURR_OPTS} value={curr} onPick={setCurr} />
      <label>صفه بالمدرسة</label>
      <Seg options={GRADE_OPTS} value={grade} onPick={setGrade} />
      <label>المحافظة</label>
      <select value={gov} onChange={(e) => { setGov(e.target.value); if (e.target.value !== "بغداد") setSide(""); }}>
        {data.govs.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      {gov === "بغداد" && (<><label>الجانب</label><Seg options={SIDE_OPTS} value={side} onPick={setSide} /></>)}
      <label>العنوان</label>
      <input value={area} onChange={(e) => setArea(e.target.value)} />
      <label>الهاتف الأول</label>
      <input className="ltr" inputMode="tel" value={p1} onChange={(e) => setP1(e.target.value)} />
      <label>رقم ولي الأمر (واتساب)</label>
      <input className="ltr" inputMode="tel" value={p2} onChange={(e) => setP2(e.target.value)} />
      <label>نوع الامتحان</label>
      <Seg options={EXAM_OPTS} value={exam} onPick={setExam} />
      {exam === "حضوري" && (
        <>
          <label>منطقة المركز</label>
          <select value={carea} onChange={(e) => { setCarea(Number(e.target.value)); setCenter(0); }}>
            <option value={0}>اختر المنطقة</option>
            {data.areas.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.gov})</option>)}
          </select>
          <label>المركز الامتحاني</label>
          <select value={center} onChange={(e) => setCenter(Number(e.target.value))}>
            <option value={0}>اختر المركز</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {!startArea && s.center && <div className="exhint">مركزه الحالي «{s.center}» انحذف، فاختار غيره.</div>}
        </>
      )}
      <div className="exline pdactions">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>حفظ</button>
        <Confirm label="🔑 دز له كلمة مرور جديدة" disabled={busy} onYes={() => void call({ action: "pass", id: s.id })} />
        <Confirm label="🗑 حذف تسجيله" disabled={busy} onYes={() => void call({ action: "del", id: s.id })} />
      </div>
    </div>
  );
}

/** يختار اليوم والساعة: للإعادة ولتقديم الموعد. الحضوري بالإعادة يختار وين: إلكتروني من بيته لو بمركزه بالآيباد */
function AtPicker({ label, busy, onSave, places }: { label: string; busy: boolean; onSave: (at: string, where: string) => void; places?: boolean }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  const [where, setWhere] = useState("");
  if (!open) return <button type="button" className="exbtn adsmall" disabled={busy} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div className="exadd">
      <input type="datetime-local" className="ltr" aria-label="اليوم والساعة" value={at} onChange={(e) => setAt(e.target.value)} />
      {places && (
        <select aria-label="وين يمتحن" value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">وين يمتحن؟</option>
          <option value="online">💻 إلكتروني من بيته</option>
          <option value="ipad">🏫 بمركزه بالآيباد (آيباد وقلم ونت)</option>
        </select>
      )}
      <button type="button" className="exbtn" disabled={busy || !at || (places && !where)} onClick={() => onSave(at, where)}>💾 حفظ</button>
      <button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(false)}>✖</button>
    </div>
  );
}

/** الإدارة تغير وقت يوم من أيام طالب «ويا الطلاب» بأي وقت. المكتمل يحتاج تأكيد «فوك العدد» */
function PickTimes({ times, id, busy, call }: { times: NonNullable<NonNullable<Data["sched"]>["times"]>; id: number; busy: boolean; call: Call }) {
  const [sel, setSel] = useState<Record<string, string>>({});
  return (
    <div className="cpexam">
      <b>🕐 أوقاته</b>
      {times.days.map((d) => {
        const cur = times.picks[String(d.d)] ?? "", t = sel[String(d.d)] ?? "";
        const full = d.times.find((x) => x.t === t)?.full;
        return (
          <div key={d.d} className="exline">
            <span>{d.name}</span>
            <select aria-label={`وقت ${d.name}`} value={t || cur} onChange={(e) => setSel({ ...sel, [String(d.d)]: e.target.value })}>
              {!cur && <option value="">—</option>}
              {d.times.map((x) => <option key={x.t} value={x.t}>{x.label}{x.full && x.t !== cur ? " · مكتمل" : ""}</option>)}
            </select>
            {t && t !== cur && (full
              ? <Confirm label="➕ ثبته فوك العدد" disabled={busy} onYes={() => void call({ action: "schedPick", id, d: d.d, time: t, force: true })} />
              : <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "schedPick", id, d: d.d, time: t })}>💾 غيره</button>)}
          </div>
        );
      })}
      <div className="exhint">تغيره بأي وقت، حتى قبل امتحانه بساعة. كل امتحاناته الجاية بذاك اليوم تمشي على الوقت الجديد، ويوصله خبر.</div>
    </div>
  );
}

const SCHED_STATE: Record<string, string> = { locked: "🔒 ينتظر", open: "🟢 بدا", missed: "⛔ فات", done: "✅ مخلص", center: "🏫 بالمركز", past: "انتهى موعده" };
function SchedPanel({ sched, id, busy, call }: { sched: NonNullable<Data["sched"]>; id: number; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(sched.perDay));
  const [hf, setHf] = useState(sched.hol?.from ?? "");
  const [ht, setHt] = useState(sched.hol?.to ?? "");
  return (
    <div className="adlog">
      {/* نفس صفحة «📝 امتحاناتي» اللي يشوفها الطالب، عرض بس */}
      {sched.view && <button type="button" className="exbtn" onClick={() => { location.href = sched.view!; }}>👁 شوف جدوله مثل ما يطلعله</button>}
      {sched.way && <div className="exlabel">{sched.way}</div>}
      {sched.times && <PickTimes times={sched.times} id={id} busy={busy} call={call} />}
      {sched.hol && (
        <div className="cpexam">
          <b>🏖 عطلته</b>
          {sched.holReq && <div className="exhint exbad">⏳ طالب يغيرها لـ {sched.holReq.from ? `${sched.holReq.from} إلى ${sched.holReq.to}` : "بدون عطلة"}. توافق من 🗓 جدول الامتحانات، أو غيرها هنا.</div>}
          <label>من</label>
          <DateInput label="عطلته من" value={hf} placeholder="بدون عطلة" onChange={setHf} />
          <label>إلى</label>
          <DateInput label="عطلته إلى" min={hf} value={ht} placeholder="بدون عطلة" onChange={setHt} />
          <div className="atrow">
            <button type="button" className="btn" disabled={busy || (!!hf !== !!ht) || (!!hf && ht < hf)} onClick={() => void call({ action: "schedHol", id, holFrom: hf, holTo: ht })}>💾 غير عطلته</button>
            <button type="button" className="exbtn" onClick={() => { setHf(""); setHt(""); }}>بدون عطلة</button>
          </div>
        </div>
      )}
      {sched.items.length ? sched.items.map((i) => (
        <div key={i.id} className="adsale">{i.retake ? "🔁 " : ""}{i.title}<small dir="ltr">{i.at}</small><small>{SCHED_STATE[i.state]}{i.away ? " · 💻 من بيته" : sched.inPerson && i.ipad ? " · 📱 بالآيباد" : ""}</small>
          {i.state === "missed" && <Confirm label={sched.inPerson ? "🔓 افتحه هسه إلكتروني من بيته" : "🔓 افتحه هسه باستثناء"} disabled={busy} onYes={() => void call({ action: "examException", id, item: i.id })} />}
          {(i.state === "locked" || i.state === "center") && <button type="button" className="exbtn adsmall" disabled={busy} onClick={() => void call({ action: "examNow", id, item: i.id })}>▶️ جربه هسه</button>}
          {!i.optional && (i.status === "done" || i.status === "missed") && <AtPicker label="🔁 إعادة بموعد" busy={busy} places={sched.inPerson} onSave={(at, where) => void call({ action: "examRetake", id, item: i.id, at, where })} />}
          {i.status === "waiting" && i.state === "locked" && <AtPicker label="⏩ قدّم الموعد" busy={busy} onSave={(at) => void call({ action: "examMove", id, item: i.id, at })} />}
        </div>
      )) : <div className="exhint">ما رتب جدوله بعد.</div>}
      <div className="exadd">
        <input className="exnum" inputMode="numeric" aria-label="حد الامتحانات باليوم لهذا الطالب" value={n} onChange={(e) => setN(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "perDay", id, value: n })}>حفظ حده باليوم (0 = العام: {sched.general})</button>
      </div>
      {!!sched.way && <Confirm label="🗓 خليه يرتب جدوله من جديد" disabled={busy} onYes={() => void call({ action: "schedReset", id })} />}
    </div>
  );
}

/** طلاب تجربة لصاحب البوت: أوراقهم تنتظر بالتصحيح مثل أي طالب، ويفتح صفحتهم كأنه هو حتى يشوف الدرجة ويعترض */
function TestStudents({ tests, chapters, busy, act }: { tests: TestStudent[]; chapters: string[]; busy: boolean; act: (b: Record<string, unknown>) => unknown }) {
  // يبدي على آخر طالب تجربة انضاف، ومن تزيد واحد جديد ينتقل عليه
  const newest = tests[tests.length - 1]?.id ?? 0;
  const [sid, setSid] = useState(newest);
  useEffect(() => { setSid(newest); }, [newest]);
  const [chapter, setChapter] = useState("");
  return (
    <div className="card">
      <h2>🧪 طلاب تجربة</h2>
      <div className="expad">
        <div className="exhint">3 طلاب تجربة، لكل واحد ورقة مسلمة بكل امتحان جاهز (جوابها الحل النموذجي). أوراقهم تطلع بالتصحيح مثل أي طالب. بعد التصحيح افتح صفحة الطالب وشوف درجته واعترض كأنك هو. ينحسبون مثل الطلاب الحقيقيين (بأجور المصححين وأرقام الطلاب والترتيب)، وكل رسالة توصلهم توصلك إنت وفوكها اسمه. قبل إطلاق المشروع امسحهم.</div>
        {tests.map((t) => (
          <div key={t.id} className="atrow">
            <span><b>{t.name}</b> <small className="pdmode">منهج {t.curr ?? "عربي"} · {t.papers} ورقة · انصححت {t.graded}{t.chapters?.length ? ` · 📚 ${t.chapters.join("، ")}` : ""}</small></span>
            <a className="exbtn" style={{ textDecoration: "none" }} href={t.link}>👁 افتح امتحاناته كطالب</a>
            <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "testCurr", sid: t.id, curr: t.curr === "إنجليزي" ? "عربي" : "إنجليزي" })}>🔁 خليه {t.curr === "إنجليزي" ? "عربي" : "إنجليزي"}</button>
          </div>
        ))}
        {!!tests.length && !!chapters.length && (
          <div className="form adtop">
            <div className="exhint">📚 حتى تجرب الجدول الخاص: اعطي طالب تجربة فصل، فيصير كأنه مشتريه وجدوله ينفتح. بعدها افتح امتحاناته كطالب (تنفتح صفحة «📝 امتحاناتي» مالته مباشرة) ← 👤 بدون الطلاب (جدول خاص).</div>
            <select aria-label="طالب التجربة" value={sid} onChange={(e) => setSid(Number(e.target.value))}>{tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select aria-label="الفصل" value={chapter} onChange={(e) => setChapter(e.target.value)}>
              <option value="">اختار الفصل...</option>
              {chapters.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="exbtn" disabled={busy || !sid || !chapter} onClick={() => void act({ action: "testChapter", sid, chapter })}>📚 اعطيه الفصل وافتح جدوله</button>
          </div>
        )}
        <div className="exline adtop">
          <Confirm label={tests.length ? "🔄 سويهم من جديد" : "🧪 سوي طلاب تجربة"} disabled={busy} onYes={() => void act({ action: "makeTests" })} />
          <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "addTest", curr: "عربي" })}>➕ طالب تجربة عربي</button>
          <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "addTest", curr: "إنجليزي" })}>➕ طالب تجربة إنجليزي</button>
          {!!tests.length && <Confirm label="🗑 امسحهم" disabled={busy} onYes={() => void act({ action: "deleteTests" })} />}
        </div>
      </div>
    </div>
  );
}

/** الصورة الكبيرة من الكاميرا تصغر قبل الرفع (أطول ضلع 2000) */
async function shrink(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? f), "image/jpeg", 0.88));
  } catch { return f; }
}

/** طالب حضوري تجريبي بمركز، وامتحانه اليوم، حتى تنجرب قراءة الحضور وطباعة الليبل بدون حساب ثاني */
function InPersonTry({ areas, versions, busy, act, code, codes }: { areas: Data["areas"]; versions: TestVersion[]; busy: boolean; act: (b: Record<string, unknown>) => unknown; code?: { k: number; img: string }; codes?: { k: number; kind: string; img: string; open?: string; openImg?: string }[] }) {
  const centers = areas.flatMap((a) => a.centers.map((c) => ({ id: c.id, name: `${c.name} (${a.name})` })));
  const [center, setCenter] = useState(0);
  const [big, setBig] = useState<{ k: number; img: string; open?: string } | null>(null);
  const [slug, setSlug] = useState("");
  const [exam, setExam] = useState(0);
  const [vid, setVid] = useState(0);
  const chapters = versions.filter((x, i) => versions.findIndex((y) => y.slug === x.slug) === i);
  const topics = versions.filter((x, i) => x.slug === slug && versions.findIndex((y) => y.exam === x.exam) === i);
  const models = versions.filter((x) => x.exam === exam);
  return (
    <div className="card">
      <h2>🎫 طالب حضوري تجريبي</h2>
      <div className="form">
        <div className="exhint">اختار المركز والامتحان، وبعدين سوي الطالب اللي تريده (كل دوسة طالب جديد). بعدها بـ 🎫 الحضوري (لو المحطة) وجه الكاميرا على كوده، لو اكتب رقمه.</div>
        <label>المركز</label>
        <select value={center} onChange={(e) => setCenter(Number(e.target.value))}>
          <option value={0}>اختار المركز...</option>
          {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label>الفصل</label>
        <select value={slug} onChange={(e) => { setSlug(e.target.value); setExam(0); setVid(0); }}>
          <option value="">اختار الفصل...</option>
          {chapters.map((x) => <option key={x.slug} value={x.slug}>{x.chapter || x.slug}</option>)}
        </select>
        {slug && <select value={exam} onChange={(e) => { const id = Number(e.target.value); setExam(id); const m = versions.filter((x) => x.exam === id); setVid(m.length === 1 ? m[0].id : 0); }}>
          <option value={0}>اختار الموضوع...</option>
          {topics.map((x) => <option key={x.exam} value={x.exam}>{x.title}</option>)}
        </select>}
        {exam > 0 && models.length > 1 && <div className="seg">{models.map((x) => <button key={x.id} type="button" className={vid === x.id ? "on" : ""} onClick={() => setVid(x.id)}>{x.model}</button>)}</div>}
        {/* كل دوسة طالب جديد من النوع اللي تختاره (طلبه 2026-11-28: «أنا أصنع»)، والطلاب كلهم بقائمة تحت */}
        <label>سوي طالب</label>
        <div className="atrow">
          <button type="button" className="btn" disabled={busy || !center || !vid} onClick={() => void act({ action: "tryInPersonKind", center, vid, kind: "now" })}>✅ امتحانه هسه</button>
          <button type="button" className="btn" disabled={busy || !center || !vid} onClick={() => void act({ action: "tryInPersonKind", center, vid, kind: "late" })}>⏰ جاي بغير وقته</button>
          <button type="button" className="btn" disabled={busy || !center || !vid} onClick={() => void act({ action: "tryInPersonKind", center, vid, kind: "none" })}>🚫 غير مشترك بالفصل</button>
          <button type="button" className="btn" disabled={busy || !center || !vid} onClick={() => void act({ action: "tryInPersonKind", center, vid, kind: "ipad" })}>📱 يمتحن بالآيباد</button>
        </div>
        <button type="button" className="exbtn adtop" disabled={busy || !center || !vid} onClick={() => void act({ action: "tryInPersonList", center, vid })}>📋 طلاب التجربة اللي سويتهم بهذا المركز</button>
        {/* 🗑 كل مرة يبدي بطلاب جدد (طلبه 2026-11-28) */}
        <Confirm label="🗑 امسح كل طلاب التجربة الحضوريين (كل المراكز)" disabled={busy} onYes={() => void act({ action: "tryInPersonClear" })} />
        {!!codes?.length && (
          <div className="adtop" style={{ display: "grid", gap: 8 }}>
            <div className="exhint">دوس على الطالب: يطلع كوده كبير يملي الشاشة، ووجه عليه كاميرا الحضور.</div>
            {codes.map((x) => (
              <div key={x.k} style={{ display: "grid", gap: 6 }}>
                <button type="button" className="exbtn" onClick={() => setBig({ k: x.k, img: x.img })}>
                  🎫 طالب حضوري تجريبي {x.k} · {x.kind === "now" ? "✅ امتحانه هسه" : x.kind === "late" ? "⏰ جاي بغير وقته" : x.kind === "none" ? "🚫 غير مشترك بالفصل" : x.kind === "ipad" ? "📱 يمتحن بالآيباد" : "ما عنده هذا الامتحان"}
                </button>
                {x.open && x.openImg && <button type="button" className="exbtn" onClick={() => setBig({ k: x.k, img: x.openImg!, open: x.open })}>📱 خلي الآيباد جهاز هذا الطالب (للتجربة)</button>}
              </div>
            ))}
          </div>
        )}
        {big && (
          <div onClick={() => setBig(null)} style={{ position: "fixed", inset: 0, zIndex: 80, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 12 }}>
            <b style={{ color: "#141F33", fontSize: 22 }}>طالب حضوري تجريبي {big.k}</b>
            {big.open && <div style={{ color: "#141F33", fontWeight: 700, textAlign: "center", maxWidth: 560 }}>للتجربة بس: صوّر هذا الكود بكاميرا الآيباد، فيصير الآيباد كأنه جهاز الطالب وتنفتح امتحاناته. بعدها بالآيباد يطلع «🎫 كود الحضور» مالته، مثل الطالب الحقيقي بتطبيقه. وجه كاميرا جهاز الحضور (POS) على الكود اللي بشاشة الآيباد: ينسجل حضوره، والأسئلة تنفتح بالآيباد وحدها بلا قسم</div>}
            <img src={big.img} alt={`كود الطالب ${big.k}`} style={{ width: "min(92vw, 70vh)", height: "auto" }} />
            {big.open && <button type="button" className="exbtn" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(big.open!); }}>📋 انسخ الرابط</button>}
            <button type="button" className="btn" style={{ width: "auto" }} onClick={() => setBig(null)}>✖ سد</button>
          </div>
        )}
        {code && (
          <div className="exhint adtop" style={{ textAlign: "center" }}>
            <b>🎫 كود حضور الطالب {code.k}</b>
            <div>وجه كاميرا جهاز الحضور على هذا الكود، مثل ما يطلّع الطالب كوده من تلفونه.</div>
            <img src={code.img} alt="كود الحضور" style={{ width: 240, maxWidth: "100%", background: "#fff", borderRadius: 12, marginTop: 8 }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** صاحب البوت يمتحن بنفسه باسم طالب تجربة: امتحان حي يبدي هسه، بالأسئلة والقسم والكاميرا والتسليم */
function TryExam({ tests, versions, busy, act }: { tests: TestStudent[]; versions: TestVersion[]; busy: boolean; act: (b: Record<string, unknown>) => unknown }) {
  const [sid, setSid] = useState(tests[0]?.id ?? 0);
  const [slug, setSlug] = useState("");
  const [exam, setExam] = useState(0);
  const [vid, setVid] = useState(0);
  const chapters = versions.filter((x, i) => versions.findIndex((y) => y.slug === x.slug) === i);
  const topics = versions.filter((x, i) => x.slug === slug && versions.findIndex((y) => y.exam === x.exam) === i);
  const models = versions.filter((x) => x.exam === exam);
  async function go() {
    const link = tests.find((t) => t.id === sid)?.link;
    if (link && await act({ action: "tryExam", sid, vid })) location.href = link;
  }
  return (
    <div className="card">
      <h2>📝 امتحن بنفسك كطالب</h2>
      <div className="form">
        <div className="exhint">يبدي امتحان حي هسه باسم طالب التجربة، وتمشي نفس خطوات الطالب: الأسئلة، القسم، الكاميرا، والتسليم. تدوس «📝 ادخل الامتحان» بالصفحة اللي تنفتح. إذا عدتها، ورقته القديمة بهذا الامتحان تنمسح.</div>
        <label>طالب التجربة</label>
        <select value={sid} onChange={(e) => setSid(Number(e.target.value))}>{tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label>الفصل</label>
        <select value={slug} onChange={(e) => { setSlug(e.target.value); setExam(0); setVid(0); }}>
          <option value="">اختار الفصل...</option>
          {chapters.map((x) => <option key={x.slug} value={x.slug}>{x.chapter || x.slug}</option>)}
        </select>
        {slug && <select value={exam} onChange={(e) => { const id = Number(e.target.value); setExam(id); const m = versions.filter((x) => x.exam === id); setVid(m.length === 1 ? m[0].id : 0); }}>
          <option value={0}>اختار الموضوع...</option>
          {topics.map((x) => <option key={x.exam} value={x.exam}>{x.title}</option>)}
        </select>}
        {exam > 0 && models.length > 1 && <div className="seg">{models.map((x) => <button key={x.id} type="button" className={vid === x.id ? "on" : ""} onClick={() => setVid(x.id)}>{x.model}</button>)}</div>}
        <button type="button" className="btn" disabled={busy || !vid} onClick={() => void go()}>▶️ ابدي الامتحان</button>
      </div>
    </div>
  );
}

/** ورقة تجربة من صور حقيقية: يختار طالب التجربة والامتحان، يرفع جواب كل سؤال، ويختار منو يصححها */
function TestPaper({ tests, versions, busy, upload }: { tests: TestStudent[]; versions: TestVersion[]; busy: boolean; upload: (f: FormData) => Promise<unknown> }) {
  const [sid, setSid] = useState(tests[0]?.id ?? 0);
  const [vid, setVid] = useState(0);
  const [slug, setSlug] = useState("");
  const [exam, setExam] = useState(0);
  // الفصل أول، بعدين مواضيع هذا الفصل بس، بعدين النموذج
  const chapters = versions.filter((x, i) => versions.findIndex((y) => y.slug === x.slug) === i);
  const topics = versions.filter((x, i) => x.slug === slug && versions.findIndex((y) => y.exam === x.exam) === i);
  const models = versions.filter((x) => x.exam === exam);
  const [who, setWho] = useState<"ai" | "me" | "qusay">("ai");
  const [fast, setFast] = useState(true);
  const [pics, setPics] = useState<Record<number, File[]>>({});
  const v = versions.find((x) => x.id === vid);
  const count = Object.values(pics).reduce((t, x) => t + x.length, 0);
  async function go() {
    const f = new FormData();
    f.set("action", "testPaper"); f.set("sid", String(sid)); f.set("vid", String(vid)); f.set("who", who); f.set("now", fast ? "1" : "0");
    for (const [n, list] of Object.entries(pics)) for (const p of list) f.append(`q_${n}`, await shrink(p), "answer.jpg");
    if (await upload(f)) setPics({});
  }
  return (
    <div className="card">
      <h2>📷 ورقة تجربة من صور حقيقية</h2>
      <div className="form">
        <div className="exhint">ترفع جواب طالب حقيقي باسم طالب تجربة، وتختار منو يصححها. إذا الطالب عنده ورقة بنفس الامتحان، تتبدل بهاي.</div>
        <label>طالب التجربة</label>
        <select value={sid} onChange={(e) => setSid(Number(e.target.value))}>{tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label>الفصل</label>
        <select value={slug} onChange={(e) => { setSlug(e.target.value); setExam(0); setVid(0); setPics({}); }}>
          <option value="">اختار الفصل...</option>
          {chapters.map((x) => <option key={x.slug} value={x.slug}>{x.chapter || x.slug}</option>)}
        </select>
        {slug && (
          <>
            <label>الموضوع (الامتحان)</label>
            <select value={exam} onChange={(e) => { const id = Number(e.target.value); setExam(id); const m = versions.filter((x) => x.exam === id); setVid(m.length === 1 ? m[0].id : 0); setPics({}); }}>
              <option value={0}>اختار الموضوع...</option>
              {topics.map((x) => <option key={x.exam} value={x.exam}>{x.title}</option>)}
            </select>
          </>
        )}
        {exam > 0 && models.length > 1 && (
          <>
            <label>النموذج</label>
            <div className="seg">
              {models.map((x) => <button key={x.id} type="button" className={vid === x.id ? "on" : ""} onClick={() => { setVid(x.id); setPics({}); }}>{x.model}</button>)}
            </div>
          </>
        )}
        {v?.qs.map((q) => (
          <div key={q.n}>
            <label>جواب السؤال {q.n} <small>(من {q.max})</small>{pics[q.n]?.length ? ` · ${pics[q.n].length} صورة` : ""}</label>
            <PhotoPick label={pics[q.n]?.length ? "بدّل الصورة" : `السؤال ${q.n}`} onFiles={(fs) => setPics({ ...pics, [q.n]: fs.slice(0, 1) })} />
            <Thumbs files={pics[q.n] ?? []} onRemove={(i) => setPics({ ...pics, [q.n]: (pics[q.n] ?? []).filter((_, j) => j !== i) })} />
          </div>
        ))}
        {v && (
          <>
            <label>منو يصححها</label>
            <div className="seg">
              <button type="button" className={who === "ai" ? "on" : ""} onClick={() => setWho("ai")}>🤖 نظام التصحيح AI</button>
              <button type="button" className={who === "me" ? "on" : ""} onClick={() => setWho("me")}>✍️ أصححها أنا</button>
              <button type="button" className={who === "qusay" ? "on" : ""} onClick={() => setWho("qusay")}>🧠 تصحيح قصي</button>
            </div>
            {who === "qusay" && (
              <div className="seg">
                <button type="button" className={fast ? "on" : ""} onClick={() => setFast(true)}>⚡ هسه</button>
                <button type="button" className={!fast ? "on" : ""} onClick={() => setFast(false)}>🌙 بالدفعة (نص الكلفة)</button>
              </div>
            )}
            {who === "qusay" && <div className="exhint">يصححها طبيعي مثل ورقة حقيقية، بأي موضوع، والدرجة توصلك بالبوت مثل ما توصل للطالب. حتى ياخذها: لازم «تصحيح قصي» شغال، وكل أسئلة النموذج إلها خطوات أو حل. التفصيل كامل بصفحته ← السجل ← 👁.</div>}
            {who === "ai" && <div className="exhint">حتى ياخذها: لازم موضوعها مأشر بصفحة نظام التصحيح AI، وكل أسئلة النموذج إلها خطوات، وهو شغال.</div>}
            <button type="button" className="btn" disabled={busy || !count} onClick={() => void go()}>{busy ? "جاري الرفع..." : `📤 ارفع الورقة (${count} صورة)`}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** أوراق الطالب: كل امتحان سلمه، درجته وصور ورقته المصححة، محفوظة يم صاحب البوت */
function PapersPanel({ papers, canEdit }: { papers: NonNullable<Data["papers"]>; canEdit?: boolean }) {
  const url = (ref: string) => `/api/students/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(papers.fileToken)}`;
  if (!papers.list.length) return <div className="adlog"><div className="exhint">بعده ما سلم أي امتحان.</div></div>;
  return (
    <div className="adlog stp">
      {papers.list.map((p) => (
        <details key={p.id} className="stp-paper">
          <summary>
            <b>{p.title}</b>{p.optional ? " (اختياري)" : ""} · {p.total !== null ? <b>{p.total} من 100</b> : <span className="exbad">بعده ما انصحح</span>}
            <small> · {(p.graded || p.submitted).slice(0, 10)}</small>
          </summary>
          <div className="exhint">
            {p.chapter} · النموذج {p.model} · سلّم {p.submitted.slice(0, 16)}
            {p.graded && <> · صححه {p.ai ? "🤖 " : ""}{p.grader || "مصحح"} {p.graded.slice(0, 16)}</>}
          </div>
          {canEdit && p.graded && <a className="exbtn" style={{ textDecoration: "none", display: "inline-block", margin: "6px 0" }} href={`/store/grade?edit=${p.id}`}>✏️ عدل التصحيح والدرجة</a>}
          <div className="stp-marks">{p.marks.map((m) => <span key={m.n}>س{m.n}: {m.skip ? "⏭ ترك" : <><b>{m.mark ?? "-"}</b>/{m.max}</>}</span>)}</div>
          {(p.objections.open + p.objections.ok + p.objections.no > 0) && <div className="exhint">✋ اعتراضات: {p.objections.open} تنتظر · {p.objections.ok} انقبل · {p.objections.no} انرفض</div>}
          {!p.gradedPages && p.pages.length > 0 && <div className="exhint">{p.graded ? "صور جوابه مثل ما رفعها (هذي الورقة انصححت بدون صور مصححة)" : "صور جوابه مثل ما رفعها"}</div>}
          <div className="stp-pages">{p.pages.map((r) => <img key={r} src={url(r)} alt="الورقة" loading="lazy" />)}</div>
        </details>
      ))}
    </div>
  );
}

/** صور توقيع ولي الأمر بوجهه (تنحفظ مشفرة 30 يوم): صاحب البوت يتأكد إنه هو ولي الأمر مو الطالب */
function SignPhotos({ id }: { id: number }) {
  const [list, setList] = useState<{ at: string; kind: string; src: string }[] | null>(null);
  const [err, setErr] = useState("");
  async function load() {
    setErr("");
    try {
      const r = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signPhotos", id, initData: pageAuth() }) });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "صار خطأ"); else setList(j.photos ?? []);
    } catch { setErr("ماكو اتصال"); }
  }
  return (
    <>
      <button type="button" className="exbtn" onClick={() => void load()}>📸 صور توقيع ولي الأمر بوجهه</button>
      {err && <span className="exhint exbad">{err}</span>}
      {list && !list.length && <span className="exhint">ماكو صور. ولي الأمر بعده ما سجل وجهه أو ما وقّع بيه.</span>}
      {list && !!list.length && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{list.map((p) => <figure key={p.at + p.kind} style={{ margin: 0, width: 110 }}><img src={p.src} alt="" style={{ width: 110, borderRadius: 10 }} /><figcaption className="exhint">{p.kind} · {p.at}</figcaption></figure>)}</div>}
    </>
  );
}
