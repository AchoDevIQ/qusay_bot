"use client";
// الأسئلة العلمية من ملازم Word: صاحب البوت يرفع ملف Word، والبوت يقسمه على المحاضرات من عناوينها.
// الطالب يسأل: يدور بالمحاضرة، بعدين بالموضوع، وإذا ما لگاه يحله نظام الذكاء على طريقة الأستاذ. والجواب يوصل كتابة
import { useState } from "react";
import { Confirm, StatusBar, useAdminApi } from "../adminPage";

type Book = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; topics: { topic: string; lectures: number[]; tid?: number | null }[]; chars: number; created: string };
type Data = { exams?: { left: number; done: number; total: number; failed: string[] }; qa: { on: boolean; direct: boolean; linked: boolean; asked: number; fromBook: number; solved: number; cost: number; books: Book[]; botTopics: Record<number, { id: number; ar: string }[]> }; notice: string };
const KIND: Record<Book["kind"], string> = { main: "الملزمة", extra: "الاثرائيات", exams: "الوزاريات" };

export default function QaCard() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qabank", "📚 الملازم");
  const [file, setFile] = useState<File | null>(null);
  const [chapter, setChapter] = useState("1");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [kind, setKind] = useState<Book["kind"]>("main");
  const qa = data?.qa;
  async function upload() {
    if (!file) return;
    const f = new FormData();
    f.set("action", "upload"); f.set("file", file); f.set("chapter", chapter); f.set("lang", lang); f.set("kind", kind);
    if (await call(f)) setFile(null);
  }
  return (
    <>
      <div className="card">
        <h2>📗 الأسئلة العلمية من ملازم Word (كتابة)</h2>
        <div className="form">
          <div className="exhint">الطالب يختار الفصل والموضوع والمحاضرة ويسأل. البوت يدور بالمحاضرة، وإذا ما لگاه يدور بالموضوع بس. إذا لگاه يدزله حلك نفسه، وإذا ما لگاه نظام الذكاء يحله على طريقتك. الحل يوصل كتابة، والرياضيات مكتوبة مثل الكتاب.</div>
          {!qa && !error && <div className="empty">جاري التحميل...</div>}
          {error && !qa && <div className="exbad">⚠️ {error}</div>}
          {qa && (
            <>
              {!qa.linked && <div className="exbad">⚠️ خدمة الذكاء مو مربوطة بالسيرفر.</div>}
              <label className="adcheck adflat"><input type="checkbox" checked={qa.on} disabled={busy} onChange={(e) => void call({ action: "settings", on: e.target.checked })} /><span>شغّل الجواب من ملازم Word</span></label>
              <label className="adcheck adflat"><input type="checkbox" checked={qa.direct} disabled={busy} onChange={(e) => void call({ action: "settings", direct: e.target.checked })} /><span>السؤال اللي ما موجود بالملزمة: الحل على طريقتك يوصل للطالب مباشرة (إذا مطفي: السؤال يوصلك إنت)</span></label>
              <div className="exhint">انسأل {qa.asked} سؤال: {qa.fromBook} من الملازم، {qa.solved} انحل على طريقتك · الكلفة <b dir="ltr">${qa.cost}</b></div>
              <div className="exlabel">📝 أسئلة الامتحانات وحلولها</div>
              <div className="exhint">الطالب ممكن يسأل سؤال جاي بامتحان. هذا الزر يقرا كل أسئلة الامتحانات وحلولها مرة وحدة ويحفظها كتابة ويا موضوعها، وبعدها البوت يدور بيها ويا الملزمة. الحل ياخذه من خطوات التصحيح المحفوظة، وإذا ماكو من صورة الحل. إذا أضفت امتحانات جديدة، دوسه مرة ثانية ويقرا الجديدة بس.</div>
              {data?.exams && <div className="exhint">انقرت <b>{data.exams.done}</b> من {data.exams.total || data.exams.done} سؤال{data.exams.left ? ` · ⏳ باقي ${data.exams.left} (كل دقيقة 6)` : ""}</div>}
              {!!data?.exams?.failed.length && <div className="exbad">⚠️ ما انقرت: {data.exams.failed.join("، ")}</div>}
              <button type="button" className="exbtn" disabled={busy || !qa.linked} onClick={() => void call({ action: "exams" })}>📝 اقرا أسئلة الامتحانات</button>
              <div className="exlabel">ارفع ملزمة Word</div>
              <div className="exhint">لازم كل محاضرة تبدي بعنوان مثل «رسم الدوال المحاضرة 1». نفس الفصل والمنهج والنوع يتبدل بالجديد.</div>
              <div className="exline">
                <select value={chapter} onChange={(e) => setChapter(e.target.value)}>{[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>الفصل {c}</option>)}</select>
                <select value={lang} onChange={(e) => setLang(e.target.value as "ar" | "en")}><option value="ar">عربي</option><option value="en">إنجليزي</option></select>
                <select value={kind} onChange={(e) => setKind(e.target.value as Book["kind"])}>{(Object.keys(KIND) as Book["kind"][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
              </div>
              <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" className="btn" disabled={busy || !file} onClick={() => void upload()}>{busy ? "جاري الرفع والقراءة..." : "📤 ارفع الملزمة"}</button>
              {qa.books.map((b) => (
                <details key={b.id} className="cpch">
                  <summary><b>الفصل {b.chapter} · {KIND[b.kind]} · {b.lang === "ar" ? "عربي" : "إنجليزي"}</b> <small className="pdmode">{b.topics.length} موضوع · {b.created}</small></summary>
                  <div className="expad">
                    <div className="exhint">كل موضوع بالملزمة مربوط بموضوع بالبوت: الطالب اللي يختار موضوع البوت، يدور بالمواضيع المربوطة بيه. إذا الربط غلط، غيّره.</div>
                    {b.topics.map((t) => (
                      <div key={t.topic} className="exline">
                        <span className="exhint">📌 {t.topic} (المحاضرات {t.lectures.join("، ")}) ←</span>
                        <select value={t.tid === undefined ? "" : String(t.tid ?? "")} disabled={busy} onChange={(e) => void call({ action: "map", id: b.id, topic: t.topic, tid: Number(e.target.value) || 0 })}>
                          <option value="">⚠️ ما مربوط</option>
                          {(qa.botTopics[b.chapter] ?? []).map((x) => <option key={x.id} value={x.id}>{x.ar}</option>)}
                        </select>
                      </div>
                    ))}
                    <Confirm label="🗑 احذف" disabled={busy} onYes={() => void call({ action: "delete", id: b.id })} />
                  </div>
                </details>
              ))}
            </>
          )}
        </div>
      </div>
      <StatusBar busy={busy} error={qa ? error : ""} notice={data?.notice} />
    </>
  );
}
