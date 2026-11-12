"use client";
// الملازم والجواب الآلي: صاحب البوت يرفع الملازم، يشوف المحاضرات اللي لگاها البوت بكل ملزمة ويصلح أسماءها،
// ويشغل أو يطفي الجواب الآلي، ويكتب نص الرد للطالب، ويشوف الكلفة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import NotesCard from "./NotesCard";
import MarksCard from "./MarksCard";
import QaCard from "./QaCard";

type Lecture = { from: number; to: number; topic: string; lecture: number };
type Booklet = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; pages: number; lectures: Lecture[]; created: string; pdf?: boolean };
type Data = { list: Booklet[]; on: boolean; key: boolean; reply: string; tags: string[]; used: number; matched: number; cost: number; model: string; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;
const KIND: Record<Booklet["kind"], string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };

export default function BookletsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/booklets", "📚 الملازم");
  return (
    <>
      <AdminHeader title="📚 الملازم والجواب الآلي" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">الطالب يسأل عادي (صورة أو كتابة). إذا الجواب الآلي شغال وسؤاله إنت حاله بالملازم، يوصله الحل نفسه من الملزمة بصورة بإطار. وإذا بعده ما فهم، أو نفس الحل وصله قبل، أو ما لگيناه، سؤاله يوصلك. وإذا الجواب الآلي طافي، الأسئلة توصلك مثل قبل.</div>
            <NotesCard />
            <MarksCard />
            <QaCard />
            <details className="card cpch"><summary><b>📕 الطريقة القديمة: صور من PDF الملازم</b></summary>
            <AutoCard data={data} busy={busy} call={call} />
            <Upload busy={busy} call={call} />
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((ch) => {
              const l = data.list.filter((b) => b.chapter === ch);
              if (!l.length) return null;
              return (
                <details key={ch} className="card cpch">
                  <summary><b>الفصل {ch}</b> <span className="cpcount">{l.length} ملف</span></summary>
                  {l.map((b) => <BookletRow key={b.id + b.lectures.map((x) => x.topic).join()} b={b} busy={busy} call={call} />)}
                </details>
              );
            })}
            </details>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function AutoCard({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [reply, setReply] = useState(data.reply);
  return (
    <div className="card">
      <h2>🤖 الجواب الآلي</h2>
      <div className="expad">
        {!data.key && <div className="exhint exbad">🔑 المفتاح ما محطوط بالسيرفر بعد، فالجواب الآلي ما يشتغل حتى لو شغلته. الأسئلة توصلك مثل قبل.</div>}
        <div className="seg">
          <button type="button" className={data.on ? "on" : ""} disabled={busy} onClick={() => void call({ action: "settings", on: true })}>✅ شغال</button>
          <button type="button" className={!data.on ? "on" : ""} disabled={busy} onClick={() => void call({ action: "settings", on: false })}>⏸ طافي</button>
        </div>
        <div className="adstats adstats2 adtop">
          <div><b>{data.used}</b>سؤال انفحص</div>
          <div><b>{data.matched}</b>لگيناه بالملزمة</div>
          <div><b>${data.cost}</b>الكلفة لحد هسه</div>
          <div><b>{data.used ? `$${(data.cost / data.used).toFixed(3)}` : "—"}</b>للسؤال الواحد</div>
        </div>
        <div className="exlabel adtop">✉️ الكلام اللي ويا صورة الحل</div>
        <textarea className="tmtext" aria-label="نص الرد" rows={7} value={reply} onChange={(e) => setReply(e.target.value)} />
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || !reply.trim() || reply === data.reply} onClick={() => void call({ action: "settings", reply })}>💾 حفظ الرد</button>
          <Confirm label="↩️ رجعه للأصلي" disabled={busy} onYes={() => void call({ action: "settings", reset: true }).then((r) => { if (r) setReply(r.reply); })} />
        </div>
      </div>
    </div>
  );
}

function Upload({ busy, call }: { busy: boolean; call: Call }) {
  const [list, setList] = useState<File[]>([]);
  const [done, setDone] = useState(0);
  const [errs, setErrs] = useState<string[]>([]);
  const [going, setGoing] = useState(false);
  // ملف الملازم.json أول، بعده ملفات الـ PDF
  async function send() {
    setGoing(true); setDone(0); setErrs([]);
    const ordered = [...list].sort((a, b) => Number(b.name.endsWith(".json")) - Number(a.name.endsWith(".json")));
    const bad: string[] = [];
    for (const [i, file] of ordered.entries()) {
      const f = new FormData();
      f.set("action", /\.json$/i.test(file.name) ? "bundle" : "upload"); f.set("file", file);
      if (!await call(f)) bad.push(file.name);
      setDone(i + 1);
    }
    setErrs(bad); setGoing(false);
    if (!bad.length) setList([]);
  }
  return (
    <div className="card">
      <h2>⬆️ رفع الملازم</h2>
      <div className="expad">
        <div className="exhint">من مجلد «للرفع» بحاسبتك: اختار ملف «الملازم.json» وكل ملفات الـ PDF سوا، ودوس ارفع. ملف PDF وحده (اسمه مثل 2-ar-main.pdf) ينضاف لملزمته.</div>
        <label className="exbtn adtop">📎 {list.length ? `${list.length} ملف` : "اختار الملفات"}<input type="file" multiple accept="application/pdf,.json,application/json" hidden onChange={(e) => { setList([...(e.target.files ?? [])]); e.target.value = ""; }} /></label>
        {!!list.length && <button type="button" className="btn adtop" disabled={busy || going} onClick={() => void send()}>{going ? `جاري الرفع ${done} من ${list.length}...` : `⬆️ ارفع ${list.length} ملف`}</button>}
        {!!errs.length && <div className="exhint exbad adtop">ما انرفعت: {errs.join("، ")}</div>}
      </div>
    </div>
  );
}

function BookletRow({ b, busy, call }: { b: Booklet; busy: boolean; call: Call }) {
  const [names, setNames] = useState(b.lectures.map((l) => l.topic));
  const changed = names.some((n, i) => n !== b.lectures[i].topic);
  return (
    <div className="cpbox expad">
      <b>📄 {KIND[b.kind]} · {b.lang === "ar" ? "عربي" : "إنجليزي"}</b>
      <div className="exhint">{b.pages} صفحة · {b.lectures.length} محاضرة · {b.pdf ? "✅ PDF مرفوع" : "⚠️ بعده ما مرفوع PDF (بدونه ما تطلع صورة الحل)"}</div>
      {!b.lectures.length && <div className="exhint">ما لگينا عناوين محاضرات بهذا الملف (عادي للاثرائيات والوزاريات). الجواب يگول الصفحة بس.</div>}
      {!!b.lectures.length && (
        <details className="adtop">
          <summary>📑 المحاضرات اللي لگيناها (صلح الأسماء إذا تطلع مخربطة)</summary>
          {b.lectures.map((l, i) => (
            <div key={i} className="exadd adtop">
              <small className="pdmode" style={{ minWidth: 90 }}>ص {l.from}{l.to > l.from ? `-${l.to}` : ""} · م{l.lecture}</small>
              <input className="exinput" value={names[i]} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
          ))}
          <button type="button" className="btn adsmallbtn adtop" disabled={busy || !changed} onClick={() => void call({ action: "topics", id: b.id, topics: names })}>💾 حفظ الأسماء</button>
        </details>
      )}
      <div className="exline adtop"><Confirm label="🗑 احذف" disabled={busy} onYes={() => void call({ action: "delete", id: b.id })} /></div>
    </div>
  );
}
