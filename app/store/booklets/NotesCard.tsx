"use client";
// ملازم الطلاب: PDF لكل فصل، تطلع للي اشترى الفصل ويكتب فوكها
import { useState } from "react";
import { Confirm, StatusBar, useAdminApi } from "../adminPage";

type Row = { id: number; title: string; chapter: string; lang: string; pages: number; created: string };
type Data = { chapters: string[]; books: Row[]; link: string; notice: string };
const LANG: Record<string, string> = { ar: "عربي", en: "إنجليزي", all: "عربي وإنجليزي" };

export default function NotesCard() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/notes/admin", "📚 الملازم");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [chapter, setChapter] = useState("");
  const [lang, setLang] = useState("all");
  async function upload() {
    if (!file) return;
    const f = new FormData();
    f.set("action", "upload"); f.set("file", file); f.set("title", title); f.set("chapter", chapter); f.set("lang", lang);
    if (await call(f)) { setFile(null); setTitle(""); }
  }
  const chapters = data ? data.chapters.filter((c) => data.books.some((b) => b.chapter === c)) : [];
  return (
    <div className="card">
      <h2>📘 ملازم الطلاب (PDF)</h2>
      <div className="form">
        <div className="exhint">تطلع للطالب اللي اشترى الفصل (محاضرات أو امتحانات) بمربع «ملازمي». تگدر تضيف أكثر من ملزمة للفصل. الطالب يكتب فوكها وكتابته تنحفظ، وملف الـ PDF نفسه ما يوصله.</div>
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <label>الفصل</label>
            <select value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="">اختار الفصل...</option>{data.chapters.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <label>اسم الملزمة</label>
            <input className="exinput" value={title} maxLength={80} placeholder="مثال: ملزمة القطع المكافئ" onChange={(e) => setTitle(e.target.value)} />
            <label>المنهج</label>
            <div className="seg">{Object.keys(LANG).map((k) => <button type="button" key={k} className={lang === k ? "on" : ""} onClick={() => setLang(k)}>{LANG[k]}</button>)}</div>
            <label className="exbtn">📎 {file ? file.name : "اختار ملف PDF (أكثر شي 30 ميگا)"}<input type="file" accept="application/pdf" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
            <button type="button" className="btn" disabled={busy || !file || !title.trim() || !chapter} onClick={() => void upload()}>{busy ? "جاري الرفع..." : "⬆️ ارفع الملزمة"}</button>
            {!!data.books.length && <a className="exbtn" href={data.link}>👀 افتحها مثل الطالب</a>}
            {chapters.map((c) => (
              <details key={c} className="cpbox expad">
                <summary><b>{c}</b> <span className="cpcount">{data.books.filter((b) => b.chapter === c).length} ملزمة</span></summary>
                {data.books.filter((b) => b.chapter === c).map((b) => (
                  <div key={b.id} className="exline adtop">
                    <span>📘 {b.title} <small>· {b.pages} صفحة · {LANG[b.lang]}</small></span>
                    <Confirm label="🗑 احذف (تنمسح كتابة الطلاب عليها)" disabled={busy} onYes={() => void call({ action: "delete", id: b.id })} />
                  </div>
                ))}
              </details>
            ))}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={error} notice={data?.notice} />
    </div>
  );
}
