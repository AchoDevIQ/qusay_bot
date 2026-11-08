"use client";
// صفحة الطلاب: الأرقام، البحث، وفورمة كل طالب داخل نفس الصفحة
import { useState } from "react";
import PhotoPick from "../PhotoPick";
import Thumbs from "../Thumbs";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import { CURR_OPTS, SIDE_OPTS, Seg, cleanPhone } from "../shared";

type S = { id: number; username: string; name: string; curr: string; grade: string; gov: string; side: string; area: string; phone1: string; phone2: string; exam: string; gender: string; guardian: boolean; gw: { lastSeen: string | null; unseen: number; blockedAt: string | null } | null; wa: string | null; device: { at: string; tried: string } | null; stop: { at: string; reason: string; what: string; chapter: string; score: number; max: number; absent: number } | null; centerId: number; center: string; created: string; updated: string };
type Area = { id: number; gov: string; name: string; centers: { id: number; name: string }[] };
type TestStudent = { id: number; name: string; papers: number; graded: number; link: string };
type TestVersion = { id: number; title: string; chapter: string; model: string; qs: { n: number; max: number }[] };
type Paper = { id: number; title: string; chapter: string; model: string; optional: boolean; submitted: string; graded: string; total: number | null; grader: string; ai: boolean; marks: { n: number; max: number; mark: number | null }[]; objections: { open: number; ok: number; no: number }; pages: string[]; gradedPages: boolean };
type Data = { papers?: { id: number; list: Paper[]; fileToken: string }; tests?: TestStudent[] | null; testVersions?: TestVersion[] | null; stats: Record<string, number>; results: S[]; found: number; limit: number; govs: string[]; areas: Area[]; notice: string; log?: { id: number; rows: { what: string; created: string }[] }; sched?: { id: number; way: string; items: { id: number; title: string; at: string; state: string; status?: string; retake?: boolean; optional?: boolean }[]; perDay: number; general: number } };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس" }, { v: "الخامس العلمي", label: "الخامس" }];
const GENDER_OPTS = [{ v: "بنين", label: "بنين" }, { v: "بنات", label: "بنات" }];
const EXAM_OPTS = [{ v: "حضوري", label: "🏫 حضوري" }, { v: "إلكتروني", label: "💻 إلكتروني" }];

export default function StudentsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/students", "🎓 الطلاب");
  const [q, setQ] = useState("");       // المكتوب بالمربع
  const [shown, setShown] = useState(""); // البحث اللي نتيجته طالعة
  const [open, setOpen] = useState<number | null>(null);
  const [filters, setFilters] = useState({ curr: "", grade: "", exam: "", gov: "" });
  const [picked, setPicked] = useState<number[]>([]);
  const [printing, setPrinting] = useState(false);
  const act = (b: Record<string, unknown>) => call({ q: shown, filters, ...b });
  function filter(k: keyof typeof filters, v: string) {
    const next = { ...filters, [k]: v };
    setFilters(next);
    setOpen(null);
    void call({ action: "list", q: shown, filters: next });
  }
  const s = data?.stats;

  return (
    <>
      <AdminHeader title="🎓 الطلاب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && s && (
          <>
            {data.tests && <TestStudents tests={data.tests} busy={busy} act={act} />}
            {data.tests && !!data.tests.length && data.testVersions && <TestPaper tests={data.tests} versions={data.testVersions} busy={busy} upload={(f) => call(f)} />}
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
                    <Rows key={x.id} s={x} data={data} picked={picked.includes(x.id)} pick={() => setPicked(picked.includes(x.id) ? picked.filter((i) => i !== x.id) : [...picked, x.id])} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} close={() => setOpen(null)} busy={busy} call={act} />
                  ))}
                </tbody></table>
              ) : <div className="empty">ما لگيت طالب.</div>}
              {data.found > data.results.length && <div className="expad exhint">تطلع أول {data.results.length} من {data.found}. استخدم البحث أو الفلاتر حتى توصل للطالب.</div>}
            </div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
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

function Form({ s, data, close, busy, call }: { s: S; data: Data; close: () => void; busy: boolean; call: Call }) {
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
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "log", id: s.id })}>📜 عمليات الطالب</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "sched", id: s.id })}>🗓 جدوله</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "papers", id: s.id })}>📝 أوراقه</button>
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
        {s.guardian ? <Confirm label="👨‍👧 مربوط بولي أمر: فك الربط" disabled={busy} onYes={() => void call({ action: "unlink", id: s.id })} /> : <span className="exhint">ولي الأمر غير مربوط</span>}
        {s.gw?.blockedAt && <span className="exhint exbad">⛔ ولي الأمر سوى بلوك للبوت من {s.gw.blockedAt.slice(0, 10)}</span>}
        {s.gw && !s.gw.blockedAt && <span className={s.gw.unseen >= 3 ? "exhint exbad" : "exhint"}>✅ آخر مرة استلم درجة: {s.gw.lastSeen ? s.gw.lastSeen.slice(0, 16) : "بعده ما داس استلمت"}{s.gw.unseen ? ` · ${s.gw.unseen} درجة ما فتحها` : ""}</span>}
        {s.wa && <a className="exbtn" href={s.wa} target="_blank" rel="noreferrer">💬 واتساب ولي الأمر</a>}
      </div>
      {data.papers?.id === s.id && <PapersPanel papers={data.papers} />}
      {data.sched?.id === s.id && <SchedPanel key={data.sched.perDay} sched={data.sched} id={s.id} busy={busy} call={call} />}
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

/** يختار اليوم والساعة: للإعادة ولتقديم الموعد */
function AtPicker({ label, busy, onSave }: { label: string; busy: boolean; onSave: (at: string) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  if (!open) return <button type="button" className="exbtn adsmall" disabled={busy} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div className="exadd">
      <input type="datetime-local" className="ltr" aria-label="اليوم والساعة" value={at} onChange={(e) => setAt(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !at} onClick={() => onSave(at)}>💾 حفظ</button>
      <button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(false)}>✖</button>
    </div>
  );
}

const SCHED_STATE: Record<string, string> = { locked: "🔒 ينتظر", open: "🟢 بدا", missed: "⛔ فات", done: "✅ مخلص", center: "🏫 بالمركز", past: "انتهى موعده" };
function SchedPanel({ sched, id, busy, call }: { sched: NonNullable<Data["sched"]>; id: number; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(sched.perDay));
  return (
    <div className="adlog">
      {sched.way && <div className="exlabel">{sched.way}</div>}
      {sched.items.length ? sched.items.map((i) => (
        <div key={i.id} className="adsale">{i.retake ? "🔁 " : ""}{i.title}<small dir="ltr">{i.at}</small><small>{SCHED_STATE[i.state]}</small>
          {i.state === "missed" && <Confirm label="🔓 افتحه باستثناء" disabled={busy} onYes={() => void call({ action: "examException", id, item: i.id })} />}
          {i.state === "locked" && <button type="button" className="exbtn adsmall" disabled={busy} onClick={() => void call({ action: "examNow", id, item: i.id })}>▶️ جربه هسه</button>}
          {!i.optional && (i.status === "done" || i.status === "missed") && <AtPicker label="🔁 إعادة" busy={busy} onSave={(at) => void call({ action: "examRetake", id, item: i.id, at })} />}
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
function TestStudents({ tests, busy, act }: { tests: TestStudent[]; busy: boolean; act: (b: Record<string, unknown>) => unknown }) {
  return (
    <div className="card">
      <h2>🧪 طلاب تجربة</h2>
      <div className="expad">
        <div className="exhint">3 طلاب تجربة، لكل واحد ورقة مسلمة بكل امتحان جاهز (جوابها الحل النموذجي). أوراقهم تطلع بالتصحيح مثل أي طالب. بعد التصحيح افتح صفحة الطالب وشوف درجته واعترض كأنك هو. ينحسبون مثل الطلاب الحقيقيين (بأجور المصححين وأرقام الطلاب والترتيب)، وكل رسالة توصلهم توصلك إنت وفوكها اسمه. قبل إطلاق المشروع امسحهم.</div>
        {tests.map((t) => (
          <div key={t.id} className="atrow">
            <span><b>{t.name}</b> <small className="pdmode">{t.papers} ورقة · انصححت {t.graded}</small></span>
            <a className="exbtn" style={{ textDecoration: "none" }} href={t.link}>👁 افتح صفحته كطالب</a>
          </div>
        ))}
        <div className="exline adtop">
          <Confirm label={tests.length ? "🔄 سويهم من جديد" : "🧪 سوي طلاب تجربة"} disabled={busy} onYes={() => void act({ action: "makeTests" })} />
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

/** ورقة تجربة من صور حقيقية: يختار طالب التجربة والامتحان، يرفع جواب كل سؤال، ويختار منو يصححها */
function TestPaper({ tests, versions, busy, upload }: { tests: TestStudent[]; versions: TestVersion[]; busy: boolean; upload: (f: FormData) => Promise<unknown> }) {
  const [sid, setSid] = useState(tests[0]?.id ?? 0);
  const [vid, setVid] = useState(0);
  const [who, setWho] = useState<"ai" | "me">("ai");
  const [pics, setPics] = useState<Record<number, File[]>>({});
  const v = versions.find((x) => x.id === vid);
  const count = Object.values(pics).reduce((t, x) => t + x.length, 0);
  async function go() {
    const f = new FormData();
    f.set("action", "testPaper"); f.set("sid", String(sid)); f.set("vid", String(vid)); f.set("who", who);
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
        <label>الامتحان والنموذج</label>
        <select value={vid} onChange={(e) => { setVid(Number(e.target.value)); setPics({}); }}>
          <option value={0}>اختار...</option>
          {versions.map((x) => <option key={x.id} value={x.id}>{x.title} · نموذج {x.model}{x.chapter ? ` (${x.chapter})` : ""}</option>)}
        </select>
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
            </div>
            {who === "ai" && <div className="exhint">حتى ياخذها: لازم موضوعها مأشر بصفحة نظام التصحيح AI، وكل أسئلة النموذج إلها خطوات، وهو شغال.</div>}
            <button type="button" className="btn" disabled={busy || !count} onClick={() => void go()}>{busy ? "جاري الرفع..." : `📤 ارفع الورقة (${count} صورة)`}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** أوراق الطالب: كل امتحان سلمه، درجته وصور ورقته المصححة، محفوظة يم صاحب البوت */
function PapersPanel({ papers }: { papers: NonNullable<Data["papers"]> }) {
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
          <div className="stp-marks">{p.marks.map((m) => <span key={m.n}>س{m.n}: <b>{m.mark ?? "-"}</b>/{m.max}</span>)}</div>
          {(p.objections.open + p.objections.ok + p.objections.no > 0) && <div className="exhint">✋ اعتراضات: {p.objections.open} تنتظر · {p.objections.ok} انقبل · {p.objections.no} انرفض</div>}
          {!p.gradedPages && p.pages.length > 0 && <div className="exhint">{p.graded ? "صور جوابه مثل ما رفعها (هذي الورقة انصححت بدون صور مصححة)" : "صور جوابه مثل ما رفعها"}</div>}
          <div className="stp-pages">{p.pages.map((r) => <img key={r} src={url(r)} alt="الورقة" loading="lazy" />)}</div>
        </details>
      ))}
    </div>
  );
}
