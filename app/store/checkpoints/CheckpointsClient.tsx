"use client";
// صفحة السيطرة: امتحانات كل فصل بالترتيب، وتحت كل امتحان تگدر تنشئ سيطرة. السيطرة تشمل الامتحانات من بعد اللي قبلها لحدها،
// وإلها أقل مجموع وعدد غيابات يوقف. ورسائل الإيقاف، والموقوفين وفك إيقافهم
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Band = { id: string; from: number; to: number; text: string; pics: { ref: string; url: string }[] };
type Cp = { min: number; absent: number; bands: Band[] };
type Exam = { id: number; title: string; since: number; from: string; cp: Cp | null };
type Chapter = { chapter: string; exams: Exam[] };
type Stop = { id: number; name: string; at: string; reason: string; what: string; chapter: string; score: number; max: number; absent: number };
type Mode = "marks" | "percent";
type Data = { chapters: Chapter[]; student: string; guardian: string; tags: string[]; bandTags: string[]; stopUrl: string; stopBubble: string; mode: Mode; pct: { min: number; absent: number; bands: Band[] }; stopped: Stop[]; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;

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
              افتح الفصل، وتحت أي امتحان اضغط «➕ إنشاء سيطرة». السيطرة تحسب الامتحانات من بعد السيطرة اللي قبلها لحد هذا الامتحان.
              إذا مجموعه أقل من المطلوب، أو غيابه وصل للعدد، تنوقف عليه الامتحانات (والمحاضرات إذا مشتريها) وتوصله رسالة هو وولي أمره.
              الامتحان اللي ما بيه أجوبة ينحسب غياب وصفر. ويرجع بس إذا إنت فكيته.
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
            <ModeCard data={data} busy={busy} call={call} />
            {!data.chapters.length && <div className="empty">ماكو فصول بيها امتحانات بعد.</div>}
            {data.chapters.map((c) => {
              const n = c.exams.filter((e) => e.cp).length;
              return (
                <details key={c.chapter} className="card cpch">
                  <summary><b>{c.chapter}</b> <span className="cpcount">{c.exams.length} امتحان · {n ? `🚦 ${n} سيطرة` : "بدون سيطرة"}</span></summary>
                  <div className="expad">
                    {c.exams.map((e, i) => <ExamRow key={`${e.id}|${e.since}|${e.cp?.min}|${e.cp?.absent}|${data.mode}`} e={e} n={i + 1} mode={data.mode} pct={data.pct.min} tags={data.bandTags} busy={busy} call={call} />)}
                  </div>
                </details>
              );
            })}
            <Texts key={data.student + data.guardian} data={data} busy={busy} call={call} />
            <StopPicture key={data.stopBubble} url={data.stopUrl} bubble={data.stopBubble} busy={busy} call={call} />
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function ExamRow({ e, n, mode, pct, tags, busy, call }: { e: Exam; n: number; mode: Mode; pct: number; tags: string[]; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const max = e.since * 100;
  const [min, setMin] = useState(String(e.cp?.min ?? max / 2));
  const [absent, setAbsent] = useState(String(e.cp?.absent ?? Math.min(3, e.since)));
  const show = !!e.cp || open;
  const changed = !e.cp || min !== String(e.cp.min) || absent !== String(e.cp.absent);
  return (
    <div className={`cpexam${e.cp ? " cpon2" : ""}`}>
      <div className="cpname"><span>{n}. {e.title}</span>
        {!show && <button type="button" className="exbtn cpadd" disabled={busy} onClick={() => setOpen(true)}>➕ إنشاء سيطرة</button>}
      </div>
      {show && (
        <div className="cpbox">
          <b>🚦 {e.cp ? "سيطرة" : "سيطرة جديدة"} بعد هذا الامتحان</b>
          <div className="exhint">تشمل {e.since} امتحان{e.since > 1 ? `، من «${e.from}» لحد هذا` : ""}. المجموع الكلي {max}.</div>
          {mode === "percent" ? (
            <div className="exhint">الشرط والنتائج من «📏 بالنسبة لكل السيطرات» فوق: لازم يجيب {Math.ceil((pct * max) / 100)} من {max} ({pct}%).</div>
          ) : (<>
          <div className="cprule">
            <label>أقل مجموع (من {max})<input className="exnum" inputMode="numeric" value={min} onChange={(x) => setMin(x.target.value.replace(/\D/g, ""))} /></label>
            <label>يوقف إذا غاب<input className="exnum" inputMode="numeric" value={absent} onChange={(x) => setAbsent(x.target.value.replace(/\D/g, ""))} /></label>
          </div>
          <div className="exhint">لازم يجيب {min || 0} من {max} أقل شي{Number(absent) ? `، وإذا غاب ${absent} مرات أو أكثر ينوقف` : "، والغياب وحده ما يوقف"}. 0 يعني الشرط طافي.</div>
          </>)}
          <div className="exline pdactions">
            {mode === "percent"
              ? !e.cp && <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "saveCp", exam: e.id })}>💾 حفظ السيطرة</button>
              : <button type="button" className="btn" disabled={busy || !changed} onClick={() => void call({ action: "saveCp", exam: e.id, min: min || 0, absent: absent || 0 })}>💾 حفظ السيطرة</button>}
            {e.cp ? <Confirm label="🗑 حذف السيطرة" disabled={busy} onYes={() => void call({ action: "delCp", exam: e.id })} />
              : <button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(false)}>إلغاء</button>}
          </div>
          {e.cp && mode === "marks" && <Bands exam={e.id} max={max} bands={e.cp.bands} tags={tags} busy={busy} call={call} />}
        </div>
      )}
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

/** صورة تختار ملف وتعرضه قبل الحفظ */
function PicturePick({ url, file, setFile, drop, setDrop }: { url: string; file: File | null; setFile: (f: File | null) => void; drop: boolean; setDrop: (d: boolean) => void }) {
  const [preview, setPreview] = useState("");
  const shown = file ? preview : drop ? "" : url;
  return (
    <div className="cppic">
      {shown ? <img src={shown} alt="الشخصية" /> : <div className="exhint">ماكو شخصية</div>}
      <div className="exline">
        <label className="exbtn">🖼 {shown ? "بدل الشخصية" : "اختار شخصية"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f) { setFile(f); setDrop(false); setPreview(URL.createObjectURL(f)); } }} /></label>
        {shown && <button type="button" className="exbtn" onClick={() => { setFile(null); setDrop(true); }}>🗑 شيلها</button>}
      </div>
    </div>
  );
}

/** شخصية الإيقاف: مثل شرطي مرور يكول «أوگف» */
function StopPicture({ url, bubble, busy, call }: { url: string; bubble: string; busy: boolean; call: Call }) {
  const [words, setWords] = useState(bubble);
  const [file, setFile] = useState<File | null>(null);
  const [drop, setDrop] = useState(false);
  function save() {
    const f = new FormData();
    f.set("action", "stopImage");
    if (file) f.set("file", file); else f.set("dropImage", "1");
    void call(f).then((r) => { if (r) { setFile(null); setDrop(false); } });
  }
  return (
    <div className="card">
      <h2>⛔ شخصية الإيقاف</h2>
      <div className="expad">
        <div className="exhint">توصل للطالب ويا رسالة الإيقاف بالبوت، وتومض بصفحة امتحاناته. ولي أمره توصله الرسالة بدون صورة. مثلاً إنت لابس مرور وتكول «أوگف أوگف».</div>
        <PicturePick url={url} file={file} setFile={setFile} drop={drop} setDrop={setDrop} />
        <button type="button" className="btn adsmallbtn" disabled={busy || (!file && !drop)} onClick={save}>💾 حفظ الصورة</button>
        <div className="exlabel">✍️ الكتابة اللي تطلع بالفقاعة على الصورة</div>
        <div className="exhint">حط الصورة بدون كتابة، وخلي فوك يمينها مكان فاضي، لأن الفقاعة تطلع هناك. أكثر شي 220 حرف. تگدر تكتب {"{الاسم}"} ويتبدل باسم الطالب.</div>
        <textarea className="tmtext" aria-label="كتابة الفقاعة" rows={3} maxLength={220} value={words} onChange={(e) => setWords(e.target.value)} />
        <button type="button" className="btn adsmallbtn" disabled={busy || words === bubble} onClick={() => void call({ action: "stopBubble", text: words })}>💾 حفظ الكتابة</button>
        {url && words.trim() && <><div className="exlabel">شكلها عند الطالب</div><div className="cpbubw"><img src={url} alt="شخصية الإيقاف" style={{ maxHeight: 340 }} /><div className="cpbub">{words}</div></div></>}
      </div>
    </div>
  );
}

/** نتائج اللي عبر هاي السيطرة: من درجة لدرجة، رسالة وشخصية */
function Bands({ exam, max, bands, tags, busy, call }: { exam: number | "pct"; max: number; bands: Band[]; tags: string[]; busy: boolean; call: Call }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="cpbands">
      <b>🏅 نتيجة اللي يعبر {exam === "pct" ? "(بالنسبة)" : `(من ${max})`}</b>
      <div className="exhint">{exam === "pct" ? "حط نسب «من» و«إلى»، تنطبق على كل السيطرات." : "حط درجات «من» و«إلى»."} اللي يعبر توصله رسالة الدرجة اللي جابها وشخصيتها، وتومض بصفحة امتحاناته. ولي أمره توصله الرسالة بدون صورة.</div>
      <div className="cptags">{tags.map((t) => <code key={t}>{t}</code>)}</div>
      {bands.map((b) => <BandRow key={`${b.id}|${b.from}|${b.to}|${b.text}|${b.pics.map((p) => p.ref).join()}`} exam={exam} max={max} b={b} busy={busy} call={call} />)}
      {adding ? <BandRow exam={exam} max={max} b={null} busy={busy} call={call} done={() => setAdding(false)} />
        : <button type="button" className="exbtn adtop" disabled={busy} onClick={() => setAdding(true)}>➕ إضافة نتيجة</button>}
    </div>
  );
}

function BandRow({ exam, max, b, busy, call, done }: { exam: number | "pct"; max: number; b: Band | null; busy: boolean; call: Call; done?: () => void }) {
  const [from, setFrom] = useState(String(b?.from ?? Math.round(max * 0.9)));
  const [to, setTo] = useState(String(b?.to ?? max));
  const [text, setText] = useState(b?.text ?? (exam === "pct" ? "🌹 عاشت إيدك يا {الاسم}! عبرت سيطرة {الفصل} بنسبة {النسبة}" : "🌹 عاشت إيدك يا {الاسم}! عبرت سيطرة {الفصل} بدرجة {الدرجة} من {الكلي}"));
  const unit = exam === "pct" ? "%" : "درجة";
  const [added, setAdded] = useState<{ file: File; url: string }[]>([]);
  const [drop, setDrop] = useState<string[]>([]);
  const kept = (b?.pics ?? []).filter((p) => !drop.includes(p.ref));
  function save() {
    const f = new FormData();
    f.set("action", "saveBand"); f.set("exam", String(exam)); f.set("id", b?.id ?? ""); f.set("from", from); f.set("to", to); f.set("text", text); f.set("drop", drop.join(","));
    for (const a of added) f.append("file", a.file);
    void call(f).then((r) => { if (r) { setAdded([]); setDrop([]); done?.(); } });
  }
  return (
    <div className="cpbox adtop">
      <div className="cprule">
        <label>من {unit}<input className="exnum" inputMode="numeric" value={from} onChange={(x) => setFrom(x.target.value.replace(/\D/g, ""))} /></label>
        <label>إلى {unit}<input className="exnum" inputMode="numeric" value={to} onChange={(x) => setTo(x.target.value.replace(/\D/g, ""))} /></label>
      </div>
      <textarea className="tmtext" aria-label="رسالة هاي النتيجة" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="exhint">الكتابة فوك تطلع بفقاعة على الصورة (لحد 220 حرف، خلي فوك يمين الصورة فاضي). كل مرة يوصل للطالب صورة ما شافها قبل. ولي الأمر توصله الكتابة بس.</div>
      <div className="cppics">
        {kept.map((p) => <div key={p.ref}><img src={p.url} alt="شخصية" /><button type="button" className="exbtn" onClick={() => setDrop([...drop, p.ref])}>🗑</button></div>)}
        {added.map((a, i) => <div key={a.url}><img src={a.url} alt="شخصية جديدة" /><button type="button" className="exbtn" onClick={() => setAdded(added.filter((_, j) => j !== i))}>🗑</button></div>)}
      </div>
      <label className="exbtn">🖼 أضف صور<input type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; setAdded([...added, ...l.map((file) => ({ file, url: URL.createObjectURL(file) }))]); }} /></label>
      <div className="exline pdactions">
        <button type="button" className="btn" disabled={busy || !from || !to || !text.trim()} onClick={save}>💾 حفظ</button>
        {b ? <Confirm label="🗑 حذف" disabled={busy} onYes={() => void call({ action: "delBand", exam, id: b.id })} />
          : <button type="button" className="exbtn" disabled={busy} onClick={() => done?.()}>إلغاء</button>}
      </div>
    </div>
  );
}

/** الطريقة: نسبة وحدة لكل السيطرات، لو كل سيطرة بدرجاتها */
function ModeCard({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [min, setMin] = useState(String(data.pct.min));
  const [absent, setAbsent] = useState(String(data.pct.absent));
  const changed = min !== String(data.pct.min) || absent !== String(data.pct.absent);
  return (
    <div className="card">
      <h2>⚙️ طريقة السيطرة</h2>
      <div className="expad">
        <div className="seg">
          <button type="button" className={data.mode === "percent" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveMode", mode: "percent" })}>📏 بالنسبة لكل السيطرات</button>
          <button type="button" className={data.mode === "marks" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveMode", mode: "marks" })}>🔢 بالدرجات لكل سيطرة</button>
        </div>
        {data.mode === "marks" ? (
          <div className="exhint adtop">كل سيطرة إلها أقل مجموع وغياب ونتائج بالدرجات، تحطهن تحت السيطرة بالفصل.</div>
        ) : (
          <>
            <div className="exhint adtop">نسبة وحدة لكل السيطرات. إنت بس تحط مكان السيطرة بالفصل، والشرط والنتائج من هنا.</div>
            <div className="cprule">
              <label>أقل نسبة يعبر بيها %<input className="exnum" inputMode="numeric" value={min} onChange={(x) => setMin(x.target.value.replace(/\D/g, ""))} /></label>
              <label>يوقف إذا غاب<input className="exnum" inputMode="numeric" value={absent} onChange={(x) => setAbsent(x.target.value.replace(/\D/g, ""))} /></label>
            </div>
            <div className="exhint">مثلاً 50%: سيطرة من 300 لازم يجيب 150، ومن 700 لازم 350. الغياب: 0 يعني طافي.</div>
            <button type="button" className="btn adsmallbtn" disabled={busy || !changed} onClick={() => void call({ action: "savePct", min: min || 0, absent: absent || 0 })}>💾 حفظ</button>
            <Bands exam="pct" max={100} bands={data.pct.bands} tags={data.bandTags} busy={busy} call={call} />
          </>
        )}
      </div>
    </div>
  );
}
