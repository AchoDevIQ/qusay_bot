"use client";
// 📚 ملازمي: المكان الوحيد اللي ترفع بيه الملازم. كل فصل وكل منهج بيه 4 أقسام، وكل قسم إله ملفاته:
// PDF يطلع للطالب يكتب فوكه، وWord يقرا منه البوت الأسئلة العلمية. الملف الجديد يتبدل مكان القديم
import { useState } from "react";
import { Confirm, StatusBar, useAdminApi } from "../adminPage";

type Row = { id: number; title: string; chapter: string; lang: string; pages: number; kind?: string; section?: string; created: string };
type Data = { chapters: string[]; books: Row[]; link: string; notice: string };
type Word = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; topics: unknown[]; created: string };
type QaData = { qa: { books: Word[] }; notice: string };
const LANG: Record<string, string> = { ar: "عربي", en: "إنجليزي", all: "عربي وإنجليزي" };
// نفس lib/notes.ts SECTIONS
const SECTIONS = [
  { key: "book", icon: "📘", title: "دفتر المحاضرات (أسئلة وأمثلة الكتاب)", word: "main" },
  { key: "wz", icon: "📗", title: "دفتر المحاضرات (الأسئلة الوزارية)", word: "exams" },
  { key: "ith", icon: "📙", title: "دفتر المحاضرات (الأسئلة الإثرائية)", word: "extra" },
  { key: "rasid", icon: "📝", title: "الدفتر الامتحاني (الراصد)", word: "" },
] as const;
const NUM: Record<string, number> = { الأول: 1, الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6 };
const chapterNum = (c: string) => NUM[c.replace("الفصل", "").trim()] ?? 0;

export default function NotesCard() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/notes/admin", "📚 الملازم");
  const qa = useAdminApi<QaData>("/api/qabank", "📚 الملازم");
  const [chapter, setChapter] = useState("");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const ch = chapter || data?.chapters[0] || "";
  const n = chapterNum(ch);
  const legacy = data ? data.books.filter((b) => !b.section) : [];
  const pdf = (section: string) => data?.books.find((b) => b.chapter === ch && b.lang === lang && b.section === section);
  const word = (kind: string) => qa.data?.qa.books.find((b) => b.chapter === n && b.lang === lang && b.kind === kind);
  async function upPdf(section: string, file: File, sol?: File) {
    const f = new FormData();
    f.set("action", "upload"); f.set("file", file); f.set("chapter", ch); f.set("lang", lang); f.set("section", section);
    if (sol) f.set("sol", sol);
    await call(f);
  }
  async function upWord(kind: string, file: File) {
    const f = new FormData();
    f.set("action", "upload"); f.set("file", file); f.set("chapter", String(n)); f.set("lang", lang); f.set("kind", kind);
    await qa.call(f);
  }
  return (
    <div className="card">
      <h2>📚 ملازمي</h2>
      <div className="form">
        <div className="exhint">هنا بس ترفع الملازم. اختار الفصل والمنهج، وكل قسم ارفعله ملفاته. البوت يوزعها وحده: الـ <b>PDF</b> يطلع للطالب بملازمي ويكتب فوكه، والـ <b>Word</b> يقرا منه الأسئلة العلمية. إذا صلحت غلط، ارفع الملف الجديد بنفس مكانه ويتبدل بكل مكان. كتابة الطلاب وأزرار الفيديو تبقى على نفس أرقام الصفحات.</div>
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <label>الفصل</label>
            <select value={ch} onChange={(e) => setChapter(e.target.value)}>{data.chapters.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <label>المنهج</label>
            <div className="seg">{(["ar", "en"] as const).map((k) => <button type="button" key={k} className={lang === k ? "on" : ""} onClick={() => setLang(k)}>{LANG[k]}</button>)}</div>
            {SECTIONS.map((s) => {
              const p = pdf(s.key), w = s.word ? word(s.word) : undefined;
              return (
                <div key={s.key} className="cpbox expad adtop">
                  <div className="exlabel">{s.icon} {s.title}</div>
                  {s.key === "rasid" ? (
                    <>
                      <div className="exhint">{p ? `✅ مرفوع: ${p.pages} صفحة · ${p.created}` : "⬜ بعد ما انرفع"}. يحتاج ملفين PDF بنفس عدد الصفحات: صفحات الأسئلة، وصفحات الحل النموذجي (حل كل صفحة بنفس رقمها).</div>
                      <RasidPick busy={busy} onUp={(a, b) => void upPdf(s.key, a, b)} />
                    </>
                  ) : (
                    <>
                      <div className="exhint">📄 PDF (للطالب): {p ? `✅ ${p.pages} صفحة · ${p.created}` : "⬜ بعد ما انرفع"}</div>
                      <Pick label="📄 ارفع PDF" accept="application/pdf" busy={busy} onFile={(f) => void upPdf(s.key, f)} />
                      <div className="exhint">📝 Word (للأسئلة العلمية): {w ? `✅ ${w.name} · ${w.created}` : "⬜ بعد ما انرفع"}</div>
                      <Pick label="📝 ارفع Word" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" busy={qa.busy || !n} onFile={(f) => void upWord(s.word, f)} />
                    </>
                  )}
                </div>
              );
            })}
            {!!data.books.length && <a className="exbtn adtop" href={data.link}>👀 افتحها مثل الطالب</a>}
            {!!legacy.length && (
              <details className="cpbox expad adtop">
                <summary><b>ملازم انرفعت قبل الأقسام</b> <span className="cpcount">{legacy.length}</span></summary>
                <div className="exhint">هاي تطلع للطالب باسمها تحت الأقسام. من ترفع ملفاتك الجديدة بالأقسام، احذفها حتى ما تتكرر.</div>
                {legacy.map((b) => (
                  <div key={b.id} className="exline adtop">
                    <span>📘 {b.title} <small>· {b.chapter} · {b.pages} صفحة · {LANG[b.lang]}</small></span>
                    <Confirm label="🗑 احذف (تنمسح كتابة الطلاب عليها)" disabled={busy} onYes={() => void call({ action: "delete", id: b.id })} />
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy || qa.busy} error={error || qa.error} notice={qa.data?.notice || data?.notice} />
    </div>
  );
}

function Pick({ label, accept, busy, onFile }: { label: string; accept: string; busy: boolean; onFile: (f: File) => void }) {
  return <label className={"exbtn" + (busy ? " off" : "")}>{busy ? "⏳ جاري الرفع..." : label}<input type="file" accept={accept} hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} /></label>;
}

function RasidPick({ busy, onUp }: { busy: boolean; onUp: (q: File, sol: File) => void }) {
  const [q, setQ] = useState<File | null>(null);
  const [sol, setSol] = useState<File | null>(null);
  return (
    <>
      <label className="exbtn">📎 {q ? q.name : "PDF صفحات الأسئلة"}<input type="file" accept="application/pdf" hidden onChange={(e) => { setQ(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
      <label className="exbtn">📘 {sol ? sol.name : "PDF الحل النموذجي"}<input type="file" accept="application/pdf" hidden onChange={(e) => { setSol(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
      <button type="button" className="btn" disabled={busy || !q || !sol} onClick={() => { if (q && sol) { onUp(q, sol); setQ(null); setSol(null); } }}>{busy ? "جاري الرفع..." : "⬆️ ارفع الراصد"}</button>
    </>
  );
}
