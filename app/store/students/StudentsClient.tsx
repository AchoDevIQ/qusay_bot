"use client";
// صفحة الطلاب: الأرقام، البحث، وفورمة كل طالب داخل نفس الصفحة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import { CURR_OPTS, SIDE_OPTS, Seg, cleanPhone } from "../shared";

type S = { id: number; username: string; name: string; curr: string; grade: string; gov: string; side: string; area: string; phone1: string; phone2: string; exam: string; guardian: boolean; centerId: number; center: string; created: string; updated: string };
type Area = { id: number; gov: string; name: string; centers: { id: number; name: string }[] };
type Data = { stats: Record<string, number>; results: S[]; found: number; limit: number; govs: string[]; areas: Area[]; notice: string; log?: { id: number; rows: { what: string; created: string }[] }; sched?: { id: number; items: { id: number; title: string; at: string; state: string }[]; perDay: number; general: number } };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس" }, { v: "الخامس العلمي", label: "الخامس" }];
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
  const [carea, setCarea] = useState(startArea?.id ?? 0);
  const [center, setCenter] = useState(startArea ? s.centerId : 0);
  const centers = data.areas.find((a) => a.id === carea)?.centers ?? [];

  async function save() {
    const form = { n: name, cu: curr, gr: grade, g: gov, s: side, a: area, p1: cleanPhone(p1), p2: cleanPhone(p2), e: exam, c: exam === "حضوري" ? center : 0 };
    if (await call({ action: "save", id: s.id, form })) close();
  }
  return (
    <div>
      <div className="exhint">مسجل من: {s.created}{s.username ? ` · @${s.username}` : ""}</div>
      <div className="exline">
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "log", id: s.id })}>📜 عمليات الطالب</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "sched", id: s.id })}>🗓 جدوله</button>
        {s.guardian ? <Confirm label="👨‍👧 مربوط بولي أمر: فك الربط" disabled={busy} onYes={() => void call({ action: "unlink", id: s.id })} /> : <span className="exhint">ولي الأمر غير مربوط</span>}
      </div>
      {data.sched?.id === s.id && <SchedPanel key={data.sched.perDay} sched={data.sched} id={s.id} busy={busy} call={call} />}
      {data.log?.id === s.id && (
        <div className="adlog">
          {data.log.rows.length ? data.log.rows.map((r, i) => <div key={i} className="adsale">{r.what}<small>{r.created}</small></div>) : <div className="exhint">ما أكو عمليات مسجلة بعد.</div>}
        </div>
      )}
      <label>الاسم الرباعي</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
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
      <label>الهاتف الثاني</label>
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

const SCHED_STATE: Record<string, string> = { locked: "🔒 ينتظر", open: "🟢 بدا", missed: "⛔ فات", done: "✅ مخلص" };
function SchedPanel({ sched, id, busy, call }: { sched: NonNullable<Data["sched"]>; id: number; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(sched.perDay));
  return (
    <div className="adlog">
      {sched.items.length ? sched.items.map((i) => <div key={i.id} className="adsale">{i.title}<small dir="ltr">{i.at}</small><small>{SCHED_STATE[i.state]}</small></div>) : <div className="exhint">ما رتب جدوله بعد.</div>}
      <div className="exadd">
        <input className="exnum" inputMode="numeric" aria-label="حد الامتحانات باليوم لهذا الطالب" value={n} onChange={(e) => setN(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "perDay", id, value: n })}>حفظ حده باليوم (0 = العام: {sched.general})</button>
      </div>
      {!!sched.items.length && <Confirm label="🗓 خليه يرتب جدوله من جديد" disabled={busy} onYes={() => void call({ action: "schedReset", id })} />}
    </div>
  );
}
