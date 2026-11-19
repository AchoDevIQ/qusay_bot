"use client";
// 📚 ملازمي: المكان الوحيد اللي ترفع بيه الملازم. كل فصل وكل منهج بيه 4 أقسام، وكل قسم إله ملفاته:
// PDF يطلع للطالب يكتب فوكه، وWord يقرا منه البوت الأسئلة العلمية. الملف الجديد يتبدل مكان القديم
import { useState } from "react";
import { Confirm, StatusBar, useAdminApi } from "../adminPage";
import { SECTION_TITLE, planPackage, type PkgPlan } from "../../../lib/packageFiles.ts";

type Row = { id: number; title: string; chapter: string; lang: string; pages: number; kind?: string; section?: string; sol?: boolean; created: string };
type Data = { chapters: string[]; books: Row[]; link: string; notice: string };
type Word = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; topics: unknown[]; created: string };
type QaData = { qa: { books: Word[] }; notice: string };
const LANG: Record<string, string> = { ar: "عربي", en: "إنجليزي", all: "عربي وإنجليزي" };
// نفس lib/notes.ts SECTIONS
const SECTIONS = [
  { key: "book", icon: "📘", title: "دفتر المحاضرات (أسئلة وأمثلة الكتاب)", word: "main", sol: false },
  { key: "wz", icon: "📗", title: "دفتر المحاضرات (الأسئلة الوزارية)", word: "exams", sol: true },
  { key: "ith", icon: "📙", title: "دفتر المحاضرات (الأسئلة الإثرائية)", word: "extra", sol: true },
  { key: "rasid", icon: "📝", title: "الراصد (رصد جميع الأسئلة الوزارية)", word: "", sol: true },
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
  // ⬆️ البكج كله: يختار كل ملفات مجلد الفصل، والبوت يوزعها حسب أسمائها
  const [pkg, setPkg] = useState<{ plan: PkgPlan; files: Map<string, File> } | null>(null);
  const [pkgStep, setPkgStep] = useState("");
  const pkgChapter = pkg ? data?.chapters.find((c) => chapterNum(c) === pkg.plan.chapter) ?? "" : "";
  function pickPackage(list: FileList | null) {
    const files = new Map([...(list ?? [])].map((f) => [f.name, f]));
    setPkg({ plan: planPackage([...files.keys()]), files });
    setPkgStep("");
  }
  async function sendPackage() {
    if (!pkg || !pkgChapter) return;
    const { plan, files } = pkg;
    const L = plan.lang ?? lang;
    setChapter(pkgChapter); setLang(L);
    const total = plan.pdf.length + plan.word.length;
    let k = 0, bad = 0;
    for (const x of plan.pdf) {
      setPkgStep(`⏳ جاري رفع ${++k} من ${total}: ${SECTION_TITLE[x.section]}`);
      const f = new FormData();
      f.set("action", "upload"); f.set("file", files.get(x.file)!); f.set("chapter", pkgChapter); f.set("lang", L); f.set("section", x.section);
      if (x.sol) f.set("sol", files.get(x.sol)!);
      if (!await call(f)) bad++;
    }
    for (const x of plan.word) {
      setPkgStep(`⏳ جاري رفع ${++k} من ${total}: Word ${x.file}`);
      const f = new FormData();
      f.set("action", "upload"); f.set("file", files.get(x.file)!); f.set("chapter", String(plan.chapter)); f.set("lang", L); f.set("kind", x.kind);
      if (!await qa.call(f)) bad++;
    }
    setPkgStep(bad ? `⚠️ انرفعت ${total - bad} من ${total}. اللي ما انرفع شوف سببه تحت، وارفعه من مربعه.` : `✅ انرفع البكج كله: ${total} ملف. شوف كل مربع تحت مكتوب «✅».`);
    setPkg(null);
  }
  return (
    <div className="card">
      <h2>📚 ملازمي</h2>
      {data && (
        <div className="cpbox expad">
          <div className="exlabel">⬆️ ارفع البكج كله</div>
          <div className="exhint">افتح مجلد الفصل (مثلاً «انكلش 2»)، حدد كل ملفاته مرة وحدة (Ctrl + A)، والبوت يعرف كل ملف من اسمه وين ينحط. الملفات اللي مو للطالب (الأصلية بدون «حلي»، و«جواب») تنعبر وحدها.</div>
          <label className={"exbtn" + (busy || qa.busy ? " off" : "")}>📂 اختار ملفات الفصل<input type="file" multiple accept=".pdf,.docx" hidden disabled={busy || qa.busy} onChange={(e) => { pickPackage(e.target.files); e.target.value = ""; }} /></label>
          {pkg && (
            <div className="adtop">
              <div><b>{pkgChapter || "فصل ما معروف"} · {pkg.plan.lang ? LANG[pkg.plan.lang] : LANG[lang]}</b></div>
              {pkg.plan.pdf.map((x) => <div key={x.section} className="exhint">{SECTION_TITLE[x.section]}: {x.file}{x.sol ? ` + ${x.sol}` : ""}</div>)}
              {pkg.plan.word.map((x) => <div key={x.kind} className="exhint">📝 Word ({x.kind === "main" ? "الكتاب" : x.kind === "exams" ? "الوزارية" : "الإثرائية"}): {x.file}</div>)}
              {pkg.plan.problems.map((x) => <div key={x} className="exhint exbad">⚠️ {x}</div>)}
              {!!pkg.plan.skipped.length && <details className="exhint"><summary>ملفات انعبرت ({pkg.plan.skipped.length})</summary>{pkg.plan.skipped.join("، ")}</details>}
              <div className="exline adtop">
                <button type="button" className="btn" disabled={busy || qa.busy || !!pkg.plan.problems.length || !pkgChapter} onClick={() => void sendPackage()}>✅ ارفعها كلها ({pkg.plan.pdf.length + pkg.plan.word.length} ملف)</button>
                <button type="button" className="exbtn" onClick={() => setPkg(null)}>إلغاء</button>
              </div>
            </div>
          )}
          {pkgStep && <div className="exhint adtop"><b>{pkgStep}</b></div>}
        </div>
      )}
      <div className="form">
        <div className="exhint">هنا بس ترفع الملازم. اختار الفصل والمنهج، وكل قسم ارفعله ملفاته. البوت يوزعها وحده: الـ <b>PDF</b> يطلع للطالب بملازمي ويكتب فوكه، والـ <b>Word</b> يقرا منه الأسئلة العلمية. الوزارية والإثرائية والراصد بيهن «📝 حلي» و«📘 الحل النموذجي»، فكل وحدة ملفين PDF: الأسئلة وحلها. إذا صلحت غلط، ارفع الملف الجديد بنفس مكانه ويتبدل بكل مكان. كتابة الطلاب وأزرار الفيديو تبقى على نفس أرقام الصفحات.</div>
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
                  {s.sol ? (
                    <>
                      <div className="exhint">📄 PDF (للطالب): {p ? `✅ ${p.pages} صفحة${p.sol ? " ويا الحل النموذجي" : " · ⚠️ بلا حل نموذجي، ارفعه من جديد ويا حله"} · ${p.created}` : "⬜ بعد ما انرفع"}. ملفين PDF بنفس عدد الصفحات: صفحات الأسئلة اللي يحل بيها الطالب («📝 حلي»)، وصفحات «📘 الحل النموذجي» (حل كل صفحة بنفس رقمها).</div>
                      <SolPick busy={busy} label={s.key === "rasid" ? "⬆️ ارفع الراصد" : "⬆️ ارفع الدفتر وحله"} onUp={(a, b) => void upPdf(s.key, a, b)} />
                    </>
                  ) : (
                    <>
                      <div className="exhint">📄 PDF (للطالب): {p ? `✅ ${p.pages} صفحة · ${p.created}` : "⬜ بعد ما انرفع"}</div>
                      <Pick label="📄 ارفع PDF" accept="application/pdf" busy={busy} onFile={(f) => void upPdf(s.key, f)} />
                    </>
                  )}
                  {s.word && (
                    <>
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

function SolPick({ busy, label, onUp }: { busy: boolean; label: string; onUp: (q: File, sol: File) => void }) {
  const [q, setQ] = useState<File | null>(null);
  const [sol, setSol] = useState<File | null>(null);
  return (
    <>
      <label className="exbtn">📎 {q ? q.name : "PDF صفحات الأسئلة"}<input type="file" accept="application/pdf" hidden onChange={(e) => { setQ(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
      <label className="exbtn">📘 {sol ? sol.name : "PDF الحل النموذجي"}<input type="file" accept="application/pdf" hidden onChange={(e) => { setSol(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
      <button type="button" className="btn" disabled={busy || !q || !sol} onClick={() => { if (q && sol) { onUp(q, sol); setQ(null); setSol(null); } }}>{busy ? "جاري الرفع..." : label}</button>
    </>
  );
}
