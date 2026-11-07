"use client";
// الملازم والجواب الآلي: صاحب البوت يرفع الملازم، يشوف المحاضرات اللي لگاها البوت بكل ملزمة ويصلح أسماءها،
// ويشغل أو يطفي الجواب الآلي، ويكتب نص الرد للطالب، ويشوف الكلفة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Lecture = { from: number; to: number; topic: string; lecture: number };
type Booklet = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; pages: number; lectures: Lecture[]; created: string };
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
            <div className="exhint tmhint">الطالب يصور السؤال من الملزمة. إذا الجواب الآلي شغال ولگينا السؤال، يوصله وين مشروح. وإذا بعده ما فهم، أو سأل نفس السؤال مرة ثانية، سؤاله يوصلك. وإذا الجواب الآلي طافي، الأسئلة توصلك مثل قبل.</div>
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
        <div className="exlabel adtop">✉️ نص الرد للطالب</div>
        <div className="exhint">هاي الكلمات تتبدل وحدها:</div>
        <div className="cptags">{data.tags.map((t) => <code key={t}>{t}</code>)}</div>
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
  const [file, setFile] = useState<File | null>(null);
  const [chapter, setChapter] = useState("");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [kind, setKind] = useState<Booklet["kind"]>("main");
  const bundle = !!file && /\.json$/i.test(file.name);
  function send() {
    if (!file) return;
    const f = new FormData();
    f.set("action", bundle ? "bundle" : "upload"); f.set("file", file); f.set("chapter", chapter); f.set("lang", lang); f.set("kind", kind);
    void call(f).then((r) => { if (r) setFile(null); });
  }
  return (
    <div className="card">
      <h2>⬆️ رفع ملزمة</h2>
      <div className="expad">
        <div className="exhint">ارفع ملف PDF مطلع من Word، أو ملف «الملازم.json» اللي يجهزه البرنامج (بيه كل الملازم مرة وحدة). الملف الجديد يحل محل القديم لنفس الفصل والمنهج والنوع.</div>
        <label className="exbtn adtop">📎 {file ? file.name : "اختار الملف"}<input type="file" accept="application/pdf,.json,application/json" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
        {file && !bundle && (
          <>
            <div className="seg wrap2 adtop">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={chapter === String(n) ? "on" : ""} onClick={() => setChapter(String(n))}>الفصل {n}</button>)}</div>
            <div className="seg adtop"><button type="button" className={lang === "ar" ? "on" : ""} onClick={() => setLang("ar")}>عربي</button><button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>إنجليزي</button></div>
            <div className="seg adtop">{(Object.keys(KIND) as Booklet["kind"][]).map((k) => <button type="button" key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND[k]}</button>)}</div>
          </>
        )}
        {file && <button type="button" className="btn adtop" disabled={busy || (!bundle && !chapter)} onClick={send}>⬆️ ارفع</button>}
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
      <div className="exhint">{b.pages} صفحة · {b.lectures.length} محاضرة · انرفع {b.created}</div>
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
