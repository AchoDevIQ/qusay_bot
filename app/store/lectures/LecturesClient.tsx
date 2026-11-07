"use client";
// محاضرات الامتحانات (السكة): كل امتحان قبله محاضراته بالترتيب. البوت يطلعها من العنوان، وصاحب البوت يعدلها.
// ورابط التطبيق اللي ينفتح لمن الطالب يدوس على المحاضرة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Exam = { id: number; title: string; lectures: string[]; custom: boolean };
type Chapter = { chapter: string; exams: Exam[] };
type LecFile = { fname: string; visible: boolean; at: string };
type Data = { chapters: Chapter[]; link: string; files: Record<string, LecFile>; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;

export default function LecturesClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/lectures", "📺 محاضرات الامتحانات");
  return (
    <>
      <AdminHeader title="📺 محاضرات الامتحانات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">
              بجدول الطالب كل امتحان تطلع قبله محاضراته بالترتيب، وبعدها الامتحان. البوت يطلعها وحده من عنوان الامتحان،
              مثل «قطع مكافئ 1&2» قبله المحاضرة 1 و2. الفاينل والشامل والنصف فاينل بدون محاضرات لأنها مراجعة. إذا تريد تغير، افتح الامتحان وعدل.
              ولكل محاضرة ترفع ملفها، وتخليه ظاهر أو مخفي. الطالب يدوس «📄 الملف» فيوصله بالبوت محمي: ما ينعاد توجيهه ولا ينحفظ.
            </div>
            <Link key={data.link} data={data} busy={busy} call={call} />
            {!data.chapters.length && <div className="empty">ماكو امتحانات بعد.</div>}
            {data.chapters.map((c) => (
              <details key={c.chapter} className="card cpch">
                <summary><b>{c.chapter}</b> <span className="cpcount">{c.exams.length} امتحان · {c.exams.reduce((n, e) => n + e.lectures.length, 0)} محاضرة</span></summary>
                <div className="expad">
                  {c.exams.map((e, i) => <ExamRow key={`${e.id}|${e.lectures.join("|")}`} e={e} n={i + 1} files={data.files} busy={busy} call={call} />)}
                </div>
              </details>
            ))}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Link({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [link, setLink] = useState(data.link);
  return (
    <div className="card">
      <h2>🔗 رابط التطبيق</h2>
      <div className="expad">
        <div className="exhint">اللي مشتري محاضرات يدوس على المحاضرة بجدوله فينفتح هذا الرابط. إذا فارغ، تطلع أسماء المحاضرات بس.</div>
        <input className="exinput" dir="ltr" aria-label="رابط التطبيق" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || link.trim() === data.link} onClick={() => void call({ action: "saveLink", link })}>💾 حفظ الرابط</button>
        </div>
      </div>
    </div>
  );
}

function ExamRow({ e, n, files, busy, call }: { e: Exam; n: number; files: Record<string, LecFile>; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(e.lectures.join("\n"));
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="cpexam">
      <div className="cpname"><span>{n}. {e.title}</span>
        {!open && <button type="button" className="exbtn cpadd" disabled={busy} onClick={() => setOpen(true)}>✏️ تعديل</button>}
      </div>
      {!open && (e.lectures.length
        ? <ol className="lcline">{e.lectures.map((l) => <li key={l}>📺 {l}<LectureFile name={l} f={files[l]} busy={busy} call={call} /></li>)}</ol>
        : <div className="exhint">بدون محاضرات</div>)}
      {open && (
        <div className="cpbox">
          <div className="exhint">كل محاضرة بسطر، بالترتيب. تطلع قبل هذا الامتحان. إذا تمسحها كلها يصير الامتحان بدون محاضرات.</div>
          <textarea className="tmtext" aria-label={`محاضرات ${e.title}`} rows={Math.max(3, lines.length + 1)} value={text} onChange={(x) => setText(x.target.value)} />
          <div className="exline pdactions">
            <button type="button" className="btn" disabled={busy || lines.join("\n") === e.lectures.join("\n")} onClick={() => void call({ action: "save", exam: e.id, lines: text })}>💾 حفظ</button>
            {e.custom && <Confirm label="↩️ رجعها مثل العنوان" disabled={busy} onYes={() => void call({ action: "reset", exam: e.id })} />}
            <button type="button" className="exbtn" disabled={busy} onClick={() => { setOpen(false); setText(e.lectures.join("\n")); }}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ملف المحاضرة: رفع أو تبديل، ظاهر أو مخفي، وحذف */
function LectureFile({ name, f, busy, call }: { name: string; f: LecFile | undefined; busy: boolean; call: Call }) {
  function up(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set("name", name); fd.set("file", file);
    void call(fd);
  }
  const pick = <input type="file" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; up(x); }} />;
  if (!f) return <div className="lcfile"><label className="exbtn adsmall">📎 ارفع ملفها{pick}</label></div>;
  return (
    <div className="lcfile">
      <small className="pdmode">📄 {f.fname} · {f.visible ? "👁 ظاهر للطلاب" : "🙈 مخفي"}</small>
      <div className="exline">
        <button type="button" className={f.visible ? "exbtn adsmall" : "btn adsmall"} disabled={busy} onClick={() => void call({ action: "fileShow", name, visible: !f.visible })}>{f.visible ? "🙈 خفيه" : "👁 بينه للطلاب"}</button>
        <label className="exbtn adsmall">🔄 بدله{pick}</label>
        <Confirm label="🗑" disabled={busy} onYes={() => void call({ action: "fileDelete", name })} />
      </div>
    </div>
  );
}
