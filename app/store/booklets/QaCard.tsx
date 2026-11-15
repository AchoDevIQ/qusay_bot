"use client";
// الأسئلة العلمية من ملازم Word: صاحب البوت يرفع ملف Word، والبوت يقسمه على المحاضرات من عناوينها.
// الطالب يسأل: يدور بالمحاضرة، بعدين بالموضوع، وإذا ما لگاه يحله نظام الذكاء على طريقة الأستاذ. والجواب يوصل كتابة
import { Confirm, StatusBar, useAdminApi } from "../adminPage";

type Book = { id: string; chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; topics: { topic: string; lectures: number[]; tid?: number | null }[]; chars: number; created: string };
type Data = { exams?: { left: number; done: number; total: number; failed: string[] }; qa: { on: boolean; direct: boolean; stepBtn?: boolean; teacherBtn?: boolean; explained?: number; linked: boolean; asked: number; fromBook: number; free?: number; solved: number; cost: number; books: Book[]; botTopics: Record<number, { id: number; ar: string }[]> }; notice: string };
const KIND: Record<Book["kind"], string> = { main: "أسئلة وأمثلة الكتاب", extra: "الأسئلة الإثرائية", exams: "الأسئلة الوزارية" };

export default function QaCard() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qabank", "📚 الملازم");
  const qa = data?.qa;
  return (
    <>
      <div className="card">
        <h2>📗 الأسئلة العلمية من ملازم Word (كتابة)</h2>
        <div className="form">
          <div className="exhint">الطالب يختار الفصل والموضوع والمحاضرة ويسأل. إذا سؤاله نفس سؤال محلول بملزمتك (نفس الأرقام ونفس الطلب)، يدزله حلك نفسه ببلاش بلا ذكاء. وإذا سؤاله بـ«📝 الراصد» اللي بملازمي، يدزله «📘 الحل النموذجي» مال صفحته ويا فيديوهاتها، وإذا محلول بدفتر المحاضرات اللي بملازمي، يدزله صفحات الدفتر من بداية سؤاله. وإلا البوت يدور بالمحاضرة، وإذا ما لگاه يدور بالموضوع بس. إذا لگاه يدزله حلك نفسه، وإذا ما لگاه نظام الذكاء يحله على طريقتك. الحل يوصل كتابة، والرياضيات مكتوبة مثل الكتاب. وإذا ما فهم خطوة، «🤔 ما فهمت خطوة» يشرحها على طريقتك (إذا شغلته تحت).</div>
          {!qa && !error && <div className="empty">جاري التحميل...</div>}
          {error && !qa && <div className="exbad">⚠️ {error}</div>}
          {qa && (
            <>
              {!qa.linked && <div className="exbad">⚠️ خدمة الذكاء مو مربوطة بالسيرفر.</div>}
              <label className="adcheck adflat"><input type="checkbox" checked={qa.on} disabled={busy} onChange={(e) => void call({ action: "settings", on: e.target.checked })} /><span>شغّل الجواب من ملازم Word</span></label>
              <label className="adcheck adflat"><input type="checkbox" checked={qa.direct} disabled={busy} onChange={(e) => void call({ action: "settings", direct: e.target.checked })} /><span>السؤال اللي ما موجود بالملزمة: الحل على طريقتك يوصل للطالب مباشرة (إذا مطفي: السؤال يوصلك إنت)</span></label>
              <label className="adcheck adflat"><input type="checkbox" checked={!!qa.stepBtn} disabled={busy} onChange={(e) => void call({ action: "settings", stepBtn: e.target.checked })} /><span>زر «🤔 ما فهمت خطوة» بصفحة الحل: الطالب يكتب شنو ما فهم، والذكاء يشرحله النقطة على طريقتك من ملزمتك (أكثر شي 5 مرات على نفس الحل و20 باليوم)</span></label>
              <label className="adcheck adflat"><input type="checkbox" checked={qa.teacherBtn !== false} disabled={busy} onChange={(e) => void call({ action: "settings", teacherBtn: e.target.checked })} /><span>زر «❓ بعدني ما فهمت» ويا الحل: يوصّل سؤال الطالب إلك بالمجموعة (إذا مطفي: الزر ما يطلع)</span></label>
              <div className="exhint">انسأل {qa.asked} سؤال: {qa.fromBook} من الملازم (منها <b>{qa.free ?? 0}</b> ببلاش: نفس سؤالك بالملزمة، حلك نفسه بلا ذكاء)، {qa.solved} انحل على طريقتك{qa.explained ? `، ${qa.explained} خطوة انشرحت` : ""} · الكلفة <b dir="ltr">${qa.cost}</b></div>
              <div className="exlabel">📝 أسئلة الامتحانات وحلولها</div>
              <div className="exhint">الطالب ممكن يسأل سؤال جاي بامتحان. هذا الزر يقرا كل أسئلة الامتحانات وحلولها مرة وحدة ويحفظها كتابة ويا موضوعها، وبعدها البوت يدور بيها ويا الملزمة. الحل ياخذه من خطوات التصحيح المحفوظة، وإذا ماكو من صورة الحل. إذا أضفت امتحانات جديدة، دوسه مرة ثانية ويقرا الجديدة بس.</div>
              {data?.exams && <div className="exhint">انقرت <b>{data.exams.done}</b> من {data.exams.total || data.exams.done} سؤال{data.exams.left ? ` · ⏳ باقي ${data.exams.left} (كل دقيقة 6)` : ""}</div>}
              {!!data?.exams?.failed.length && <div className="exbad">⚠️ ما انقرت: {data.exams.failed.join("، ")}</div>}
              <button type="button" className="exbtn" disabled={busy || !qa.linked} onClick={() => void call({ action: "exams" })}>📝 اقرا أسئلة الامتحانات</button>
              <div className="exlabel">ملفات Word وربط مواضيعها</div>
              <div className="exhint">ملفات Word ترفعها من «📚 ملازمي» فوك، بكل قسم. لازم كل محاضرة تبدي بعنوان مثل «رسم الدوال المحاضرة 1». هنا تشوف المواضيع اللي لگاها البوت بكل ملف وتصلّح ربطها.</div>
              <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "list" })}>🔄 حدّث</button>
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
