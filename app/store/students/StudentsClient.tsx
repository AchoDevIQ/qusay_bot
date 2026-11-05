"use client";
// صفحة الطلاب: الأرقام، البحث، وفورمة كل طالب داخل نفس الصفحة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import { CURR_OPTS, SIDE_OPTS, Seg, cleanPhone } from "../shared";

type S = { id: number; username: string; name: string; curr: string; grade: string; gov: string; side: string; area: string; phone1: string; phone2: string; exam: string; centerId: number; center: string; created: string; updated: string };
type Area = { id: number; gov: string; name: string; centers: { id: number; name: string }[] };
type Data = { stats: Record<string, number>; results: S[]; limit: number; govs: string[]; areas: Area[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس" }, { v: "الخامس العلمي", label: "الخامس" }];
const EXAM_OPTS = [{ v: "حضوري", label: "🏫 حضوري" }, { v: "إلكتروني", label: "💻 إلكتروني" }];

export default function StudentsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/students", "🎓 الطلاب");
  const [q, setQ] = useState("");       // المكتوب بالمربع
  const [shown, setShown] = useState(""); // البحث اللي نتيجته طالعة
  const [open, setOpen] = useState<number | null>(null);
  const act = (b: Record<string, unknown>) => call({ q: shown, ...b });
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
                <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "pdf", kind: "all" })}>📄 قائمة كل الطلاب</button>
                <button type="button" className="exbtn" disabled={busy} onClick={() => void act({ action: "pdf", kind: "fifth" })}>📄 طلاب الخامس</button>
              </div>
            </div>
            <form className="exadd adsearch" onSubmit={(e) => { e.preventDefault(); setShown(q); setOpen(null); void call({ action: "list", q }); }}>
              <input placeholder="🔍 اسم الطالب أو رقم هاتفه" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="submit" className="exbtn" disabled={busy}>بحث</button>
            </form>
            <div className="card">
              <h2>{shown.trim() ? `نتائج البحث (${data.results.length})` : "آخر المسجلين"}</h2>
              {data.results.length ? (
                <table className="extable"><tbody>
                  {data.results.map((x) => (
                    <Rows key={x.id} s={x} data={data} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} close={() => setOpen(null)} busy={busy} call={act} />
                  ))}
                </tbody></table>
              ) : <div className="empty">ما لگيت طالب.</div>}
              {data.results.length >= data.limit && <div className="expad exhint">تطلع أول {data.limit} بس. ابحث بالاسم أو الرقم حتى توصل للطالب.</div>}
            </div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Rows({ s, data, open, toggle, close, busy, call }: { s: S; data: Data; open: boolean; toggle: () => void; close: () => void; busy: boolean; call: Call }) {
  return (
    <>
      <tr className={"exrow" + (open ? " sel" : "")} onClick={toggle}>
        <td><b>{s.name}</b><small className="pdmode">{s.grade} · {s.exam || "بدون امتحان"}{s.center ? ` · ${s.center}` : ""}</small></td>
        <td className="adphone">{s.phone1}</td>
      </tr>
      {open && <tr><td colSpan={2} className="expanel"><Form key={s.updated + s.id} s={s} data={data} close={close} busy={busy} call={call} /></td></tr>}
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
        <Confirm label="🔑 كلمة مرور جديدة" disabled={busy} onYes={() => void call({ action: "pass", id: s.id })} />
        <Confirm label="🗑 حذف تسجيله" disabled={busy} onYes={() => void call({ action: "del", id: s.id })} />
      </div>
    </div>
  );
}
