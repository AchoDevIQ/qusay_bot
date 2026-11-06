"use client";
// صفحة السيطرة: لكل فصل ورا كل كم امتحان، أقل مجموع، وكم غياب يوقف. ورسائل الإيقاف، والموقوفين وفك إيقافهم
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Chapter = { chapter: string; exams: number; on: boolean; every: number; min: number; absent: number };
type Stop = { id: number; name: string; at: string; reason: string; what: string; chapter: string; score: number; max: number; absent: number };
type Data = { chapters: Chapter[]; student: string; guardian: string; tags: string[]; stopped: Stop[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

export default function CheckpointsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/checkpoints", "🚦 السيطرة");
  return (
    <>
      <AdminHeader title="🚦 السيطرة" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">
              كل ما يكمل الطالب العدد اللي تحدده من امتحانات الفصل (انصححت أو غاب عنها) تنحسب سيطرة. إذا مجموعه أقل من المطلوب، أو غيابه وصل للعدد اللي تحدده،
              تنوقف عليه الامتحانات (والمحاضرات إذا مشتريها)، وتوصله رسالة هو وولي أمره. الغياب ينحسب صفر. ويرجع بس إذا إنت فكيته.
            </div>
            <div className="card">
              <h2>⛔ الموقوفين ({data.stopped.length})</h2>
              <div className="expad">
                {!data.stopped.length && <div className="exhint">ماكو طالب موقوف.</div>}
                {data.stopped.map((s) => (
                  <div key={s.id} className="cpstop">
                    <b>{s.name}</b>
                    <div className="exhint">توقفت عليه {s.what} من {s.at.slice(0, 16)}</div>
                    <div className="exhint">{s.reason}: {s.chapter}، {s.score} من {s.max}، غياب {s.absent}</div>
                    <Confirm label="✅ فك الإيقاف" disabled={busy} onYes={() => void call({ action: "lift", id: s.id })} />
                  </div>
                ))}
              </div>
            </div>
            {!data.chapters.length && <div className="empty">ماكو فصول بيها امتحانات بعد.</div>}
            {data.chapters.map((c) => <RuleCard key={c.chapter + c.on + c.every + c.min + c.absent} c={c} busy={busy} call={call} />)}
            <Texts key={data.student + data.guardian} data={data} busy={busy} call={call} />
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function RuleCard({ c, busy, call }: { c: Chapter; busy: boolean; call: Call }) {
  const [on, setOn] = useState(c.on);
  const [every, setEvery] = useState(String(c.every));
  const [min, setMin] = useState(String(c.min));
  const [absent, setAbsent] = useState(String(c.absent));
  const n = Number(every) || 0;
  const changed = on !== c.on || every !== String(c.every) || min !== String(c.min) || absent !== String(c.absent);
  return (
    <div className="card">
      <h2>{c.chapter} <small className="cpcount">({c.exams} امتحان)</small></h2>
      <div className="expad">
        <label className="cpon"><input type="checkbox" checked={on} onChange={() => setOn(!on)} /> {on ? "🟢 السيطرة شغالة" : "⚪ السيطرة طافية"}</label>
        <div className="cprule">
          <label>ورا كل كم امتحان<input className="exnum" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ""))} /></label>
          <label>أقل مجموع (من {n * 100})<input className="exnum" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} /></label>
          <label>يوقف إذا غاب<input className="exnum" inputMode="numeric" value={absent} onChange={(e) => setAbsent(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <div className="exhint">
          {n ? `كل ${n} امتحانات: لازم يجيب ${min || 0} من ${n * 100} أقل شي${Number(absent) ? `، وإذا غاب ${absent} مرات أو أكثر ينوقف` : "، والغياب وحده ما يوقف"}.` : "اكتب عدد الامتحانات."}
          {" "}0 يعني الشرط طافي.
        </div>
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || !changed || !n} onClick={() => void call({ action: "saveRule", chapter: c.chapter, on, every, min: min || 0, absent: absent || 0 })}>💾 حفظ</button>
        </div>
      </div>
    </div>
  );
}

function Texts({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [student, setStudent] = useState(data.student);
  const [guardian, setGuardian] = useState(data.guardian);
  return (
    <div className="card">
      <h2>✉️ رسالة الإيقاف</h2>
      <div className="expad">
        <div className="exhint">هاي الكلمات تتبدل وحدها بمعلومات الطالب:</div>
        <div className="cptags">{data.tags.map((t) => <code key={t}>{t}</code>)}</div>
        <div className="exlabel">للطالب</div>
        <textarea className="tmtext" aria-label="رسالة الطالب" rows={9} value={student} onChange={(e) => setStudent(e.target.value)} />
        <div className="exlabel">لولي الأمر</div>
        <textarea className="tmtext" aria-label="رسالة ولي الأمر" rows={9} value={guardian} onChange={(e) => setGuardian(e.target.value)} />
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || !student.trim() || !guardian.trim() || (student === data.student && guardian === data.guardian)} onClick={() => void call({ action: "saveTexts", student, guardian })}>💾 حفظ الرسائل</button>
          <Confirm label="↩️ رجعها للأصلية" disabled={busy} onYes={() => void call({ action: "resetTexts" })} />
        </div>
      </div>
    </div>
  );
}
