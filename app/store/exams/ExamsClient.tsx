"use client";
// صفحة وحدة لإدارة الامتحانات: جدول الامتحانات، وكل شي ينفتح داخل نفس الصفحة بدون رسائل بالبوت
import { fullMarks } from "../../../lib/answerOnly.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import PdfPages from "../PdfPages";
import { AdminHeader, Confirm, useAdminApi } from "../adminPage";

type Question = { id: number; n: number; max: number; q: string | null; edited: boolean };
type Version = { id: number; model: string; kind: string; ok: boolean; issues: string[]; manual: boolean; pdfAr: string | null; pdfEn: string | null; pagesAr: string[]; pagesEn: string[]; answerPdf: string | null; questions: Question[] };
type Exam = { id: number; ord: number; title: string; info: string; titleEn: string; minutes: number; privateVersion: number; skippable: boolean; withChapter: string; answerOnly: number; versions: Version[] };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type WordSide = { ok: boolean; got: number[] | null; first: string } | null;
type WordRow = { exam: number; title: string; model: string; kind: string; n: number; ar: WordSide; en: WordSide };
type WordGrow = { exam: number; title: string; from: number; to: number; marks: number[] };
type WordResult = { rows: WordRow[]; extraAr: number; extraEn: number; saved: { ar: number; en: number } | null; grow?: WordGrow[]; grown?: WordGrow | null };
type Data = { chapters: Chapter[]; generalMinutes: number; fileToken: string; bookMissing: boolean; lastTwoDone: boolean; notice?: string; word?: WordResult };

const lectureOf = (info: string) => /\(([\d\s&]+)\)/.exec(info)?.[0] ?? "";
const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const KIND: Record<string, string> = { mandatory: "📌 إجباري", optional: "🎯 اختياري" };

export default function ExamsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/exams", "📝 الامتحانات");
  const [openChapter, setOpenChapter] = useState(0);
  const [openExam, setOpenExam] = useState<number | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [openQ, setOpenQ] = useState<number | null>(null);

  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  const ch = data?.chapters[openChapter];
  // رسالة «شنو تحدّث» بعد رفع صفحات أو جواب: تطلع بمكان واضح حتى لو الأستاذ نازل جوة بالنسخة
  const noticeBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (data?.notice) noticeBox.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [data?.notice]);

  return (
    <>
      <AdminHeader title="📝 إدارة الامتحانات" />
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data?.bookMissing && (
          <div className="card expad adform">
            <div className="exlabel">📥 جدول الكتاب</div>
            <div className="exhint">يدخل عناوين امتحانات الفصل الثاني والثالث والرابع والخامس بترتيبها. الملفات والنسخ تنضاف بعدين. اللي تحذفه بعدها ما يرجع.</div>
            <button type="button" className="btn agbtn" disabled={busy} onClick={() => void call({ action: "loadBook" })}>📥 أدخل جدول الكتاب</button>
          </div>
        )}
        {data && !data.lastTwoDone && (
          <div className="card expad adform">
            <div className="exhint">آخر نسختين من كل امتحان بكل الفصول تصير اختياري. إذا الامتحان بيه نسختين بس، الأخيرة تصير اختياري والأولى تبقى إجباري. وتگدر تغير أي نسخة بعدها.</div>
            <Confirm label="🎯 خلي آخر نسختين اختياري" disabled={busy} onYes={() => void call({ action: "lastTwoOptional" })} />
          </div>
        )}
        {data && data.chapters.length > 1 && (
          <div className="chips">{data.chapters.map((c, i) => <button type="button" key={c.slug} className={i === openChapter ? "on" : ""} onClick={() => { setOpenChapter(i); setOpenExam(null); }}>{c.chapter}</button>)}</div>
        )}
        {data?.notice && <div ref={noticeBox} className="card warn exerr" style={{ whiteSpace: "pre-line" }}>{data.notice}</div>}
        {data && <GeneralTime value={data.generalMinutes} busy={busy} call={call} />}
        {data && <WordImport chapters={data.chapters} result={data.word} busy={busy} call={call} />}
        {ch && (
          <div className="card">
            <h2>📚 {ch.chapter}</h2>
            <table className="extable"><tbody>
              <tr><th>#</th><th>الامتحان</th><th className="p">النسخ</th><th className="p">الوقت</th></tr>
              {ch.exams.map((e, index) => {
                const bad = e.versions.filter((v) => !v.ok).length;
                const open = openExam === e.id;
                return (
                  <ExamRows key={e.id} open={open} head={
                    <tr className={"exrow" + (open ? " sel" : "")} onClick={() => { setOpenExam(open ? null : e.id); setOpenVersion(null); setOpenQ(null); }}>
                      <td className="exorder">
                        <button type="button" aria-label="لفوق" disabled={busy || index === 0} onClick={(ev) => { ev.stopPropagation(); void call({ action: "moveExam", id: e.id, dir: "up" }); }}>▲</button>
                        <span>{index + 1}</span>
                        <button type="button" aria-label="لجوة" disabled={busy || index === ch.exams.length - 1} onClick={(ev) => { ev.stopPropagation(); void call({ action: "moveExam", id: e.id, dir: "down" }); }}>▼</button>
                      </td><td><b>{e.title}</b> {lectureOf(e.info)}{bad ? <span className="exbad"> ⚠️ {bad}</span> : null}</td>
                      <td className="p">{e.versions.length}</td><td className="p">{fmtTime(e.minutes)}{e.minutes !== data!.generalMinutes ? <small className="exown"> خاص</small> : null}</td>
                    </tr>
                  }>
                    <ExamPanel key={e.id + ":" + e.versions.map((v) => v.questions.map((q) => q.max).join()).join("|")} exam={e} chapters={[...new Set((data?.chapters ?? []).map((c) => c.chapter).filter((c) => String(c).startsWith("الفصل")))]} busy={busy} call={call} fileUrl={fileUrl} openVersion={openVersion} setOpenVersion={(v) => { setOpenVersion(v); setOpenQ(null); }} openQ={openQ} setOpenQ={setOpenQ} />
                    <div className="exline">
                      <AddExam slug={ch.slug} generalMinutes={data!.generalMinutes} busy={busy} call={call} near={e.id} side="before" label="➕ امتحان قبله" />
                      <AddExam slug={ch.slug} generalMinutes={data!.generalMinutes} busy={busy} call={call} near={e.id} side="after" label="➕ امتحان بعده" />
                    </div>
                  </ExamRows>
                );
              })}
            </tbody></table>
            <AddExam slug={ch.slug} generalMinutes={data!.generalMinutes} busy={busy} call={call} />
            <ChapterTools key={ch.slug + ch.chapter} ch={ch} busy={busy} call={call} onGone={() => setOpenChapter(0)} />
          </div>
        )}
        {data && <AddChapter busy={busy} call={call} />}
      </div>
      {busy && <div className="bar"><div className="in"><div className="sum"><small>جاري الحفظ...</small></div></div></div>}
    </>
  );
}

function ChapterTools({ ch, busy, call, onGone }: { ch: Chapter; busy: boolean; call: Call; onGone: () => void }) {
  const [name, setName] = useState(ch.chapter);
  return (
    <div className="expad exfoot">
      <div className="exline">
        <span>👤 نسخة الجدول الخاص لكل الفصل:</span>
        <select className="exnum adwide" aria-label="نسخة الجدول الخاص لكل الفصل" disabled={busy} value="" onChange={(e) => { if (e.target.value) void call({ action: "privateChapter", slug: ch.slug, model: e.target.value === "-" ? "" : e.target.value }); }}>
          <option value="">اختار</option>
          <option value="-">أول نسخة جاهزة</option>
          {[...new Set(ch.exams.flatMap((x) => x.versions.filter((v) => v.kind === "mandatory").map((v) => v.model)))].sort().map((m) => <option key={m} value={m}>نسخة {m}</option>)}
        </select>
      </div>
      <div className="exadd">
        <input aria-label="اسم الفصل" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === ch.chapter} onClick={() => call({ action: "renameChapter", slug: ch.slug, chapter: name })}>حفظ اسم الفصل</button>
      </div>
      <div className="exhint">خلي الاسم مثل «الفصل السادس»، لأن البوت يربط الفصل بالمنتج من هذا الاسم.</div>
      <Confirm label={`🗑 حذف الفصل كله (${ch.exams.length} امتحان)`} disabled={busy} onYes={() => { void call({ action: "delChapter", slug: ch.slug }); onGone(); }} />
    </div>
  );
}

function AddChapter({ busy, call }: { busy: boolean; call: Call }) {
  const [chapter, setChapter] = useState("");
  const [title, setTitle] = useState("");
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ فصل جديد</div>
      <input placeholder="اسم الفصل، مثل: الفصل السادس" value={chapter} onChange={(e) => setChapter(e.target.value)} />
      <input placeholder="عنوان أول امتحان بالفصل" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !chapter.trim() || !title.trim()} onClick={async () => { if (await call({ action: "addChapter", chapter, title })) { setChapter(""); setTitle(""); } }}>➕ إضافة الفصل</button>
    </div>
  );
}

function PrivateVersion({ exam, busy, call }: { exam: Exam; busy: boolean; call: Call }) {
  const list = exam.versions.filter((v) => v.kind === "mandatory" && v.ok);
  return (
    <div className="exline exfoot">
      <span>👤 نسخة الجدول الخاص:</span>
      <select className="exnum adwide" aria-label="نسخة الجدول الخاص" disabled={busy} value={exam.privateVersion} onChange={(e) => call({ action: "privateVersion", id: exam.id, version: Number(e.target.value) })}>
        <option value={0}>أول نسخة جاهزة</option>
        {list.map((v) => <option key={v.id} value={v.id}>نسخة {v.model}</option>)}
      </select>
      <span className="exhint">نسخة كل مجموعة تتحدد من مربع 🗓 جدول الامتحانات.</span>
    </div>
  );
}

function GeneralTime({ value, busy, call }: { value: number; busy: boolean; call: Call }) {
  const [minutes, setMinutes] = useState(String(value));
  useEffect(() => setMinutes(String(value)), [value]);
  return (
    <div className="card expad exgeneral">
      <div className="exline">
        <b>🕓 وقت كل الامتحانات بالدقائق:</b>
        <input className="exnum" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || minutes === String(value)} onClick={() => call({ action: "minutesAll", value: minutes })}>حفظ</button>
      </div>
      <div className="exhint">اللي مكتوب يمه «خاص» يبقى على وقته. تغير وقت امتحان واحد من داخل الامتحان.</div>
    </div>
  );
}

/** صورة كبيرة بعرض الصفحة، وتنفتح بملء الشاشة لمن تنضغط */
function BigImage({ src, alt }: { src: string; alt: string }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <img className="eximg" src={src} alt={alt} loading="lazy" onClick={() => setFull(true)} />
      {full && (
        <div className="exfull" onClick={() => setFull(false)}>
          <button type="button" className="exbtn">✕ سكر</button>
          <img src={src} alt={alt} />
        </div>
      )}
    </>
  );
}

function ExamRows({ head, open, children }: { head: ReactNode; open: boolean; children: ReactNode }) {
  return <>{head}{open && <tr><td colSpan={4} className="expanel">{children}</td></tr>}</>;
}

function FileButton({ label, accept, multiple, onFiles, disabled }: { label: string; accept: string; multiple?: boolean; onFiles: (f: File[]) => void; disabled?: boolean }) {
  return (
    <label className={"exbtn" + (disabled ? " off" : "")}>
      {label}
      <input type="file" accept={accept} multiple={multiple} hidden disabled={disabled} onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ""; if (f.length) onFiles(f); }} />
    </label>
  );
}

type Call = (b: Record<string, unknown> | FormData) => Promise<unknown>;
function ExamPanel({ exam, chapters = [], busy, call, fileUrl, openVersion, setOpenVersion, openQ, setOpenQ }: {
  exam: Exam; chapters?: string[]; busy: boolean; call: Call; fileUrl: (r: string) => string;
  openVersion: number | null; setOpenVersion: (v: number | null) => void; openQ: number | null; setOpenQ: (q: number | null) => void;
}) {
  const [minutes, setMinutes] = useState(String(exam.minutes));
  useEffect(() => setMinutes(String(exam.minutes)), [exam.minutes]);
  const [title, setTitle] = useState(exam.title);
  useEffect(() => setTitle(exam.title), [exam.title]);
  const [en, setEn] = useState(exam.titleEn);
  useEffect(() => setEn(exam.info), [exam.info]);
  const version = exam.versions.find((v) => v.id === openVersion);
  return (
    <div>
      {version && <VersionPanel version={version} busy={busy} call={call} fileUrl={fileUrl} openQ={openQ} setOpenQ={setOpenQ} onDeleted={() => setOpenVersion(null)} />}
      <div className="exline">
        <span>🕓 الوقت بالدقائق:</span>
        <input className="exnum" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || minutes === String(exam.minutes)} onClick={() => call({ action: "minutes", id: exam.id, value: minutes })}>حفظ</button>
      </div>
      <div className="exadd">
        <input aria-label="عنوان الامتحان" placeholder="الاسم بالعربي" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="الاسم بالإنجليزي" dir="ltr" placeholder="🇬🇧 الاسم بالإنجليزي" value={en} onChange={(e) => setEn(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || !title.trim() || (title.trim() === exam.title && en.trim() === exam.titleEn)} onClick={() => call({ action: "renameExam", id: exam.id, title, en })}>حفظ العنوان</button>
      </div>
      <MarksEditor exam={exam} busy={busy} call={call} />
      <PrivateVersion exam={exam} busy={busy} call={call} />
      <AnswerOnly exam={exam} busy={busy} call={call} />
      <label className="adcheck adflat exfoot"><input type="checkbox" checked={exam.skippable} disabled={busy} onChange={(e) => call({ action: "skippable", id: exam.id, on: e.target.checked })} /><span>🗑 يمكن حذفه: طالب الجدول الخاص يگدر يشيله من جدوله (مثلاً امتحان مكرر). بدون هذا ما ينحذف.</span></label>
      <WithChapter exam={exam} chapters={chapters} busy={busy} call={call} />
      <div className="excols">
        {(["mandatory", "optional"] as const).map((kind) => {
          const list = exam.versions.filter((v) => v.kind === kind);
          return (
            <div className="excol" key={kind}>
              <div className="excolhead">{KIND[kind]} <small>({list.length})</small></div>
              {!list.length && <div className="exempty">ماكو نسخ بعد</div>}
              {list.map((v) => (
                <div className="exvrow" key={v.id}>
                  <button type="button" className={"exvbtn" + (v.id === openVersion ? " on" : "")} onClick={() => setOpenVersion(v.id === openVersion ? null : v.id)}>
                    {v.ok ? "" : "⚠️ "}نسخة {v.model}
                  </button>
                  <button type="button" className="exmove" disabled={busy} onClick={() => call({ action: "kind", id: v.id })}>
                    {kind === "mandatory" ? "نقل للاختياري ⬅️" : "➡️ نقل للإجباري"}
                  </button>
                </div>
              ))}
              <button type="button" className="exbtn exaddv" disabled={busy} onClick={() => call({ action: "addVersion", id: exam.id, kind })}>
                ➕ إضافة {kind === "mandatory" ? "للإجباري" : "للاختياري"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="exline"><Confirm label="🗑 حذف الامتحان كله" disabled={busy} onYes={() => call({ action: "delExam", id: exam.id })} /></div>
    </div>
  );
}

/** درجات الامتحان كله: تتغير كلها سوية، وما تنحفظ إلا إذا مجموعها 100 */
/** مربعات الإجباري والاختياري: كل واحد درجاته مستقلة، وكل عدد أسئلة بمربعه */
function MarksEditor({ exam, busy, call }: { exam: Exam; busy: boolean; call: Call }) {
  const boxes = (["mandatory", "optional"] as const).map((kind) => {
    const shapes = new Map<number, { marks: number[]; models: string[] }>();
    for (const v of exam.versions.filter((x) => x.kind === kind && x.questions.length)) {
      const cur = shapes.get(v.questions.length) ?? { marks: v.questions.map((q) => q.max), models: [] };
      cur.models.push(v.model);
      shapes.set(v.questions.length, cur);
    }
    return { kind, shapes: [...shapes.entries()].sort((x, y) => x[0] - y[0]) };
  });
  if (!boxes.some((x) => x.shapes.length)) return null;
  return (
    <div className="excols">
      {boxes.map(({ kind, shapes }) => (
        <div className="excol" key={kind}>
          <div className="excolhead">🔢 درجات {KIND[kind]}</div>
          {!shapes.length && <div className="exempty">ماكو نسخ بعد</div>}
          {shapes.map(([count, shape]) => <MarksBox key={count + shape.marks.join()} exam={exam} kind={kind} count={count} start={shape.marks} models={shape.models} busy={busy} call={call} />)}
        </div>
      ))}
    </div>
  );
}

function MarksBox({ exam, kind, count, start, models, busy, call }: { exam: Exam; kind: string; count: number; start: number[]; models: string[]; busy: boolean; call: Call }) {
  const [marks, setMarks] = useState(start.map(String));
  // «أجب عن K»: المجموع لأكبر K درجات
  const total = fullMarks(marks.map((m) => Number(m) || 0), exam.answerOnly);
  return (
    <div className="exversion">
      <div className="exhint">{count} أسئلة · النسخ {models.join(" ")}</div>
      <div className="exmarks">
        {marks.map((m, i) => (
          <label key={i}>س {i + 1}<input className="exnum" inputMode="numeric" value={m} onChange={(e) => setMarks(marks.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        ))}
      </div>
      <div className="exline">
        <b className={total === 100 ? "" : "exbad"}>المجموع{exam.answerOnly ? ` (أكبر ${exam.answerOnly})` : ""} {total} من 100</b>
        <button type="button" className="exbtn" disabled={busy || total !== 100 || marks.join() === start.join()} onClick={() => call({ action: "marks", id: exam.id, kind, marks })}>حفظ</button>
      </div>
    </div>
  );
}

function PaperTab({ pages, pdf, label, action, busy, upload, fileUrl }: {
  pages: string[]; pdf: string | null; label: string; action: string; busy: boolean; upload: (a: string, f: File[]) => void; fileUrl: (r: string) => string;
}) {
  return (
    <div>
      {pages.map((p) => <BigImage key={p} src={fileUrl(p)} alt={label} />)}
      {!pages.length && pdf && <div className="exline"><a className="exbtn" href={fileUrl(pdf)} target="_blank" rel="noreferrer">📄 افتح نسخة {label}</a></div>}
      {!pages.length && !pdf && <div className="exempty">ماكو نسخة {label} بعد</div>}
      <div className="exline">
        <FileButton label={`🖼 ${pages.length ? "تبديل" : "رفع"} صور نسخة ${label}`} accept="image/png,image/jpeg" multiple disabled={busy} onFiles={(f) => upload(action, f)} />
      </div>
    </div>
  );
}

function VersionPanel({ version: v, busy, call, fileUrl, openQ, setOpenQ, onDeleted }: {
  version: Version; busy: boolean; call: Call; fileUrl: (r: string) => string; openQ: number | null; setOpenQ: (q: number | null) => void; onDeleted: () => void;
}) {
  const [tab, setTab] = useState<"ar" | "en" | "questions" | "answer">("ar");
  const total = v.questions.reduce((s, q) => s + q.max, 0);
  const upload = (action: string, files: File[]) => { const fd = new FormData(); fd.set("action", action); fd.set("id", String(v.id)); files.forEach((f) => fd.append("file", f)); void call(fd); };
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [v.id]);
  return (
    <div className="exversion" ref={box}>
      <div className="exline">
        <b>نسخة {v.model}</b><span>{KIND[v.kind]}</span><span className={total === 100 ? "" : "exbad"}>المجموع {total}</span>
        <span>{v.ok ? "✅ جاهزة" : "⚠️ موقوفة"}</span>
      </div>
      {v.issues.map((x) => <div className="exbad exissue" key={x}>• {x.replace(/^.*?نسخة \S+:\s*/, "")}</div>)}
      <div className="chips extabs">
        <button type="button" className={tab === "ar" ? "on" : ""} onClick={() => setTab("ar")}>🇮🇶 العربي</button>
        <button type="button" className={tab === "en" ? "on" : ""} onClick={() => setTab("en")}>🇬🇧 الإنجليزي</button>
        <button type="button" className={tab === "questions" ? "on" : ""} onClick={() => setTab("questions")}>✂️ الأسئلة ({v.questions.length})</button>
        <button type="button" className={tab === "answer" ? "on" : ""} onClick={() => setTab("answer")}>📘 الجواب النموذجي</button>
      </div>
      {tab === "ar" && <PaperTab pages={v.pagesAr} pdf={v.pdfAr} label="العربي" action="pagesAr" busy={busy} upload={upload} fileUrl={fileUrl} />}
      {tab === "en" && <PaperTab pages={v.pagesEn} pdf={v.pdfEn} label="الإنجليزي" action="pagesEn" busy={busy} upload={upload} fileUrl={fileUrl} />}
      {tab === "questions" && (
        <div>
          <div className="exhint">الأسئلة المقطعة تطلع للمصحح بالعربي، كل سؤال لوحده.</div>
          {v.questions.map((q) => <QuestionRow key={q.id} q={q} open={openQ === q.id} toggle={() => setOpenQ(openQ === q.id ? null : q.id)} busy={busy} call={call} fileUrl={fileUrl} />)}
          <AddQuestion versionId={v.id} busy={busy} call={call} />
        </div>
      )}
      {tab === "answer" && (
        <div>
          <div className="exhint">ملف واحد كامل، يطلع نفسه للمصحح وللطالب.</div>
          <div className="exline">
            <FileButton label={`📘 ${v.answerPdf ? "تبديل" : "رفع"} الجواب النموذجي (PDF)`} accept="application/pdf" disabled={busy} onFiles={(f) => upload("answerPdf", f)} />
          </div>
          {v.answerPdf ? <PdfPages url={fileUrl(v.answerPdf)} /> : <div className="exempty">لسه ما انرفع الجواب النموذجي</div>}
        </div>
      )}
      <div className="exline exfoot">
        <button type="button" className="exbtn" disabled={busy} onClick={() => call({ action: "ok", id: v.id })}>{v.ok ? "⚠️ أوقفها" : "✅ النسخة جاهزة"}</button>
        <Confirm label="🗑 حذف النسخة" disabled={busy} onYes={async () => { if (await call({ action: "delVersion", id: v.id })) onDeleted(); }} />
      </div>
    </div>
  );
}


function QuestionRow({ q, open, toggle, busy, call, fileUrl }: { q: Question; open: boolean; toggle: () => void; busy: boolean; call: Call; fileUrl: (r: string) => string }) {
  const send = (action: string, files: File[]) => { const fd = new FormData(); fd.set("action", action); fd.set("id", String(q.id)); files.forEach((f) => fd.append("file", f)); return call(fd); };
  return (
    <div className="exq">
      <button type="button" className={"exqhead" + (open ? " on" : "")} onClick={toggle}>
        <span>س {q.n}{q.edited ? " ✏️" : ""}</span><span>{q.max} درجة</span>
      </button>
      {open && (
        <div className="exqbody">
          {q.q ? <BigImage src={fileUrl(q.q)} alt={`س ${q.n}`} /> : <div className="exbad">ماكو صورة للسؤال</div>}
          <div className="exline">
            
            <FileButton label="🖼 تبديل السؤال" accept="image/png,image/jpeg" disabled={busy} onFiles={(f) => send("replaceQ", f)} />
            
            <Confirm label="🗑 حذف" disabled={busy} onYes={() => call({ action: "delQuestion", id: q.id })} />
          </div>
          
        </div>
      )}
    </div>
  );
}

function AddQuestion({ versionId, busy, call }: { versionId: number; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<File | null>(null);
  
  const [mark, setMark] = useState("");
  if (!open) return <div className="exline"><button type="button" className="exbtn" onClick={() => setOpen(true)}>➕ إضافة سؤال</button></div>;
  return (
    <div className="exadd">
      <FileButton label={q ? "✅ صورة السؤال بالعربي" : "🖼 صورة السؤال بالعربي"} accept="image/png,image/jpeg" onFiles={(f) => setQ(f[0])} />
      
      <input className="exnum" inputMode="numeric" placeholder="الدرجة" value={mark} onChange={(e) => setMark(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !q || !mark} onClick={async () => {
        const fd = new FormData();
        fd.set("action", "addQuestion"); fd.set("id", String(versionId)); fd.set("mark", mark); fd.set("q", q!);
        
        if (await call(fd)) { setOpen(false); setQ(null); setMark(""); }
      }}>حفظ السؤال</button>
      <button type="button" className="exbtn" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

/** امتحان جديد: بآخر الفصل، أو قبل أو بعد امتحان (near) */
function AddExam({ slug, generalMinutes, busy, call, near, side, label = "➕ امتحان جديد" }: { slug: string; generalMinutes: number; busy: boolean; call: Call; near?: number; side?: "before" | "after"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("");
  const [en, setEn] = useState("");
  if (!open) return <div className="exline expad"><button type="button" className="exbtn" onClick={() => setOpen(true)}>{label}</button></div>;
  return (
    <div className="exadd expad">
      <input placeholder="عنوان الامتحان، مثل: ديموافر المحاضرة (6)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input dir="ltr" placeholder="🇬🇧 الاسم بالإنجليزي، مثل: Mid-Year Exam" value={en} onChange={(e) => setEn(e.target.value)} />
      <input className="exnum" inputMode="numeric" placeholder={`${generalMinutes} دقيقة`} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !title.trim()} onClick={async () => { if (await call({ action: "addExam", slug, title, en, minutes: minutes || generalMinutes, near, side })) { setOpen(false); setTitle(""); setEn(""); setMinutes(""); } }}>حفظ</button>
      <button type="button" className="exbtn" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

/** «📄 أسئلة من الوورد»: ملف الفصل بالعربي والإنجليزي، المطابقة ويا النسخ تطلع قبل، والحفظ للمطابق بس */
/** «أجب عن K أسئلة فقط»: الطالب يشوف كل الأسئلة ويحل K، والمجموع من أول K جاوبهن */
/** الامتحان يطلع ويا فصل ثاني: مثلاً إعادة الفصل الأول ونصف السنة يطلعن لمشتري الفصل الثالث قبل العطلة */
function WithChapter({ exam, chapters, busy, call }: { exam: Exam; chapters: string[]; busy: boolean; call: Call }) {
  return (
    <div className="exfoot">
      <label>📚 يطلع ويا الفصل:</label>
      <select value={exam.withChapter} disabled={busy} onChange={(e) => void call({ action: "examWith", id: exam.id, chapter: e.target.value })}>
        <option value="">فصله (مثل ما هو)</option>
        {chapters.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div className="exhint">مثلاً إعادة الفصل الأول ونصف السنة: اختار «الفصل الثالث»، فيطلع لكل من اشترى الفصل الثالث، بآخر امتحاناته. اللي ما مشتري الفصل الثالث يطلعله ويا فصله.</div>
    </div>
  );
}

function AnswerOnly({ exam, busy, call }: { exam: Exam; busy: boolean; call: (b: Record<string, unknown>) => Promise<unknown> }) {
  const most = Math.max(0, ...exam.versions.map((v) => v.questions.length));
  return (
    <div className="exline">
      <span className="exhint">✂️ استثناء، الطالب يجاوب عن:</span>
      <select className="exnum adwide" aria-label="عدد الأسئلة المطلوبة" disabled={busy} value={exam.answerOnly} onChange={(e) => void call({ action: "answerOnly", id: exam.id, value: Number(e.target.value) })}>
        <option value={0}>كل الأسئلة</option>
        {Array.from({ length: most }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k} أسئلة فقط</option>)}
      </select>
      {!!exam.answerOnly && <span className="exhint">إذا جاوب أكثر من {exam.answerOnly}، تنحسب أول {exam.answerOnly} بالترتيب. السؤال اللي ما جاوبه ما يطلع للمصحح.</span>}
    </div>
  );
}

function WordImport({ chapters, result, busy, call }: { chapters: Chapter[]; result?: WordResult; busy: boolean; call: (b: Record<string, unknown> | FormData) => Promise<unknown> }) {
  const [target, setTarget] = useState("");
  const [ar, setAr] = useState<File | null>(null);
  const [en, setEn] = useState<File | null>(null);
  const [all, setAll] = useState(false);
  const send = (action: string, grow?: number) => {
    const f = new FormData();
    f.set("action", action);
    if (grow) f.set("grow", String(grow));
    if (target.startsWith("e:")) f.set("exam", target.slice(2)); else f.set("chapter", target);
    if (ar) f.set("ar", ar);
    if (en) f.set("en", en);
    void call(f);
  };
  const side = (x: WordSide, n: number) => !x ? <span className="exhint">—</span> : x.ok ? <span title={x.first}>✅</span>
    : <span className="exbad">⚠️ {x.got ? `بالوورد: ${x.got.map((k) => `س${k}`).join(" ")}، لازم ${n} أسئلة` : "ما لگيتها بالملف"}</span>;
  const rows = result?.rows ?? [];
  const okAr = rows.filter((r) => r.ar?.ok).length, okEn = rows.filter((r) => r.en?.ok).length;
  const shown = all ? rows : rows.filter((r) => (r.ar && !r.ar.ok) || (r.en && !r.en.ok));
  return (
    <div className="card expad adform">
      <div className="exlabel">📄 أسئلة من الوورد</div>
      <div className="exhint">ارفع ملف الفصل بالعربي والإنجليزي سوا. البوت يقسمه لنسخ وأسئلة، ويطابقه ويا نسخ الامتحانات، ويراويك المطابقة قبل الحفظ. السؤال المحفوظ يطلع مكتوب بورقة «✏️ اكتب بالقلم» بدل صورته. النسخة اللي ما طابقت تبقى بصورتها، وتگدر تصلحها بالوورد وترفعه مرة ثانية.</div>
      <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="الفصل أو الامتحان">
        <option value="">اختار الفصل…</option>
        {chapters.map((c) => <option key={c.slug} value={c.chapter}>{c.chapter} (كل امتحاناته)</option>)}
        <optgroup label="امتحان واحد (مثل الإعادة)">
          {chapters.flatMap((c) => c.exams.map((e) => <option key={e.id} value={`e:${e.id}`}>{c.chapter} · {e.title}</option>))}
        </optgroup>
      </select>
      <label className="exfile">🇮🇶 ملف العربي (docx) <input type="file" accept=".docx" onChange={(e) => setAr(e.target.files?.[0] ?? null)} /></label>
      <label className="exfile">🇬🇧 ملف الإنجليزي (docx) <input type="file" accept=".docx" onChange={(e) => setEn(e.target.files?.[0] ?? null)} /></label>
      <div className="exline">
        <button type="button" className="exbtn" disabled={busy || !target || (!ar && !en)} onClick={() => send("wordPreview")}>👁 شوف المطابقة</button>
        <Confirm label="💾 احفظ المطابق" disabled={busy || !target || (!ar && !en) || !rows.length} onYes={() => send("wordSave")} />
      </div>
      {result && (
        <>
          {result.grown && <div className="exhint atok">✅ «{result.grown.title}» صار {result.grown.to} أسئلة، درجاتها {result.grown.marks.join("، ")}. هسه دوس «💾 احفظ المطابق».</div>}
          {(result.grow ?? []).map((g) => (
            <div key={g.exam} className="exhint">
              🔢 «{g.title}»: بالوورد {g.to} أسئلة بكل النسخ، وبالبوت {g.from}. تگدر تخليه {g.to} مثل الوورد: الدرجات تصير {g.marks.join("، ")}، والأسئلة الجديدة تنرسم صورها من نص الوورد.
              <div className="exline"><Confirm label={`🔢 خليه ${g.to} أسئلة`} disabled={busy} onYes={() => send("wordGrow", g.exam)} /></div>
            </div>
          ))}
          {result.saved && <div className="exhint atok">✅ انحفظت أسئلة {result.saved.ar} نسخة بالعربي و{result.saved.en} نسخة بالإنجليزي.</div>}
          <div className="exhint">من {rows.length} نسخة: {rows.some((r) => r.ar) ? `العربي طابق ${okAr}` : ""}{rows.some((r) => r.ar) && rows.some((r) => r.en) ? "، " : ""}{rows.some((r) => r.en) ? `الإنجليزي طابق ${okEn}` : ""}.{result.extraAr ? ` بالعربي ${result.extraAr} نسخة زايدة ما إلها مكان.` : ""}{result.extraEn ? ` بالإنجليزي ${result.extraEn} نسخة زايدة.` : ""}</div>
          <label className="adcheck adflat"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>راويني كل النسخ (هسه بس اللي ما طابقت)</span></label>
          {shown.length ? (
            <table className="extable"><tbody>
              <tr><th>الامتحان</th><th className="p">النسخة</th><th>العربي</th><th>الإنجليزي</th></tr>
              {shown.map((r, i) => (
                <tr key={i}><td>{r.title}</td><td className="p">{r.model}{r.kind === "optional" ? " 🎯" : ""}</td><td>{side(r.ar, r.n)}</td><td>{side(r.en, r.n)}</td></tr>
              ))}
            </tbody></table>
          ) : <div className="exhint atok">✅ كل النسخ طابقت.</div>}
        </>
      )}
    </div>
  );
}
