"use client";
// أزرار داخل الملزمة: «🎬 فيديو حل السؤال» (رابط منشور بالقناة) و«▶️ فيديو توضيح السؤال» (الفيديو المتحرك).
// صاحب البوت يرفع الفيديوهات التوضيحية، يحط الأزرار وحدها، ويعدل أو يحذف أي زر أو فيديو
import { useState } from "react";
import { Confirm, StatusBar, useAdminApi } from "../adminPage";

type Book = { id: number; title: string; chapter: string; lang: string; pages: number };
type Video = { id: number; name: string; lang: string; size: number };
type Mark = { id: number; page: number; y: number; label: string; video: number | null; solution: string };
type Data = { books: Book[]; videos: Video[]; link: string; notice: string; marks?: Mark[]; book?: number };
const LANG: Record<string, string> = { ar: "عربي", en: "إنجليزي" };
const where = (y: number) => (y < 0.34 ? "فوك" : y < 0.67 ? "نص" : "جوه");

export default function MarksCard() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/notes/admin", "📚 الملازم");
  const [book, setBook] = useState(0);
  const [progress, setProgress] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [paste, setPaste] = useState("");
  const cur = data?.books.find((b) => b.id === book);
  const marks = data?.book === book ? data?.marks ?? [] : [];
  const videos = (data?.videos ?? []).filter((v) => !cur || cur.lang === "all" ? true : v.lang === (cur.lang === "en" ? "en" : "ar"));
  async function uploadMany(list: FileList) {
    const all = [...list];
    for (const [i, f] of all.entries()) {
      setProgress(`⬆️ ${i + 1} من ${all.length}: ${f.name}`);
      const fd = new FormData();
      fd.set("action", "videoUpload"); fd.set("file", f, f.name);
      if (!await call(fd)) break;
    }
    setProgress("");
    if (book) void call({ action: "marks", book });
  }
  const shown = marks.filter((m) => !onlyEmpty || !m.solution);
  return (
    <div className="card">
      <h2>🎬 أزرار الفيديو داخل الملزمة</h2>
      <div className="form">
        <div className="exhint">يم كل سؤال بالملزمة يطلع للطالب زرين: «🎬 فيديو حل السؤال» (فيديوك) و«▶️ فيديو توضيح السؤال» (الفيديو المتحرك). فيديو الحل إذا رابطه يوتيوب يشتغل جوّا الملزمة، والطالب ما يشوف الرابط ولا يگدر يفتحه باليوتيوب. وإذا رابطه منشور بالقناة، يوصله بالبوت محمي. الفيديو التوضيحي يوصله بالبوت محمي: ما يگدر يحوله ولا يحفظه. الزر اللي ما بيه فيديو ما يطلع للطالب.</div>
        {data && (
          <>
            <details className="cpbox expad">
              <summary><b>▶️ الفيديوهات التوضيحية</b> <span className="cpcount">{data.videos.length}</span></summary>
              <div className="exhint">اختار الفيديوهات كلها مرة وحدة. اسم الملف هو اسم الفيديو: «السلم_المنزلق_عربي.mp4» عربي، و«السلم_المنزلق_English_عربي.mp4» للملزمة الإنجليزية. نفس الاسم يبدل القديم.</div>
              <label className="exbtn">📎 اختار فيديوهات mp4<input type="file" accept="video/mp4" multiple hidden onChange={(e) => { if (e.target.files?.length) void uploadMany(e.target.files); e.target.value = ""; }} /></label>
              {progress && <div className="hint">{progress}</div>}
              {data.videos.map((v) => (
                <div key={v.id} className="exline adtop">
                  <span>▶️ {v.name} <small>· {LANG[v.lang]} · {(v.size / 1048576).toFixed(1)} ميگا</small></span>
                  <Confirm label="🗑 احذفه (يختفي زره من الملازم)" disabled={busy} onYes={() => void call({ action: "videoDelete", id: v.id })} />
                </div>
              ))}
            </details>
            <label>الملزمة</label>
            <select value={book} onChange={(e) => { const id = Number(e.target.value); setBook(id); if (id) void call({ action: "marks", book: id }); }}>
              <option value={0}>اختار الملزمة...</option>
              {data.books.map((b) => <option key={b.id} value={b.id}>{b.chapter} · {b.title}</option>)}
            </select>
            {cur && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "autoMarks", book })}>{busy ? "جاري التدوير بالملزمة..." : "🔍 حط الأزرار وحدها على الأسئلة"}</button>
                <div className="hint">يدور كل سؤال (س1، Q1، مثال) ويحطله زر، ويربط كل فيديو توضيحي بسؤاله. الأزرار اللي إنت عدلتها تبقى مثل ما هي.</div>
                <details className="cpbox expad">
                  <summary><b>📋 الصق روابط الحل كلها مرة وحدة</b></summary>
                  <div className="exhint">كل سطر: «ص22 · 0.196 · اسم السؤال · الرابط». الرابط يروح للزر اللي بنفس الصفحة ونفس المكان، وإذا ماكو زر هناك ينضاف زر جديد.</div>
                  <textarea className="exinput" dir="rtl" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ص22 · 0.196 · المعدلات م2 وزاري س1 · https://youtu.be/…" />
                  <button type="button" className="btn" disabled={busy || !paste.trim()} onClick={async () => { if (await call({ action: "solutionsPaste", book, text: paste })) setPaste(""); }}>💾 اربطهن</button>
                </details>
                <a className="exbtn" href={data.link}>👀 افتح الملازم مثل الطالب</a>
                <label className="adcheck adflat"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /><span>بس الأسئلة اللي بعدها ما بيها رابط حل</span></label>
                <div className="hint">{marks.length} زر · {marks.filter((m) => m.solution).length} بيها رابط حل · {marks.filter((m) => m.video).length} بيها فيديو توضيحي</div>
                {shown.map((m) => <MarkRow key={`${m.id}:${m.page}:${m.y}:${m.video}:${m.solution}`} m={m} book={cur} videos={videos} busy={busy} call={call} />)}
                <MarkRow m={{ id: 0, page: 1, y: 0.1, label: "", video: null, solution: "" }} book={cur} videos={videos} busy={busy} call={call} />
              </>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={error} notice={data?.notice} />
    </div>
  );
}

function MarkRow({ m, book, videos, busy, call }: { m: Mark; book: Book; videos: Video[]; busy: boolean; call: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [page, setPage] = useState(String(m.page));
  const [y, setY] = useState(Math.round(m.y * 100));
  const [label, setLabel] = useState(m.label);
  const [video, setVideo] = useState(m.video ? String(m.video) : "");
  const [solution, setSolution] = useState(m.solution);
  const isNew = !m.id;
  const changed = isNew ? !!(video || solution.trim()) : page !== String(m.page) || y !== Math.round(m.y * 100) || label !== m.label || video !== (m.video ? String(m.video) : "") || solution !== m.solution;
  const save = () => call({ action: "markSave", book: book.id, id: m.id || undefined, page: Number(page), y: y / 100, label, video: video ? Number(video) : null, solution });
  return (
    <details className="cpbox expad" open={isNew ? undefined : !m.solution && !!m.video}>
      <summary>{isNew ? <b>➕ زر جديد</b> : <><b>ص{m.page}</b> <small>({where(m.y)})</small> {m.label || "سؤال"} {m.solution ? "🎬" : ""}{m.video ? "▶️" : ""}</>}</summary>
      <label>🎬 رابط فيديو الحل (يوتيوب، أو منشور بالقناة)</label>
      <input className="exinput" dir="ltr" placeholder="https://youtu.be/…" value={solution} onChange={(e) => setSolution(e.target.value)} />
      <label>▶️ فيديو التوضيح</label>
      <select value={video} onChange={(e) => setVideo(e.target.value)}>
        <option value="">بدون</option>
        {videos.map((v) => <option key={v.id} value={v.id}>{v.name} ({LANG[v.lang]})</option>)}
      </select>
      <label>اسم السؤال (إلك بس)</label>
      <input className="exinput" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      <div className="exline">
        <span>الصفحة</span>
        <input className="exnum" inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} />
        <span>من {book.pages}</span>
      </div>
      <label>مكانه بالصفحة: {y}% من فوك</label>
      <input type="range" min={0} max={98} value={y} onChange={(e) => setY(Number(e.target.value))} />
      <div className="exline">
        <button type="button" className="exbtn" disabled={busy || !changed || !page} onClick={() => void save()}>💾 احفظ</button>
        {!isNew && <Confirm label="🗑 احذف الزر" disabled={busy} onYes={() => void call({ action: "markDelete", book: book.id, id: m.id })} />}
      </div>
    </details>
  );
}
