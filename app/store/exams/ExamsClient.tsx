"use client";
// صفحة وحدة لإدارة الامتحانات: جدول الامتحانات، وكل شي ينفتح داخل نفس الصفحة بدون رسائل بالبوت
import { useEffect, useState, type ReactNode } from "react";

type Question = { id: number; n: number; max: number; q: string | null; a: string[]; edited: boolean };
type Version = { id: number; model: string; kind: string; ok: boolean; issues: string[]; manual: boolean; pdfAr: string | null; pdfEn: string | null; pagesAr: string[]; pagesEn: string[]; questions: Question[] };
type Exam = { id: number; ord: number; title: string; info: string; minutes: number; versions: Version[] };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type Data = { chapters: Chapter[]; fileToken: string };

const initData = () => (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
const lectureOf = (info: string) => /\(([\d\s&]+)\)/.exec(info)?.[0] ?? "";
const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const KIND: Record<string, string> = { mandatory: "📌 إجباري", optional: "🎯 اختياري" };

export default function ExamsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openChapter, setOpenChapter] = useState(0);
  const [openExam, setOpenExam] = useState<number | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [openQ, setOpenQ] = useState<number | null>(null);

  async function call(body: Record<string, unknown> | FormData) {
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (body instanceof FormData) {
        body.set("initData", initData());
        res = await fetch("/api/exams", { method: "POST", body });
      } else {
        res = await fetch("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData: initData() }) });
      }
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return false; }
      setData(j);
      return true;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return false; } finally { setBusy(false); }
  }
  // سكربت تليجرام يتحمل بعد الصفحة، فننتظره شوية
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      if (initData()) { clearInterval(t); void call({ action: "list" }); }
      else if (++tries > 25) { clearInterval(t); setError("افتح هاي الصفحة من زر «📝 الامتحانات» داخل البوت."); }
    }, 200);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  const ch = data?.chapters[openChapter];

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>📝 إدارة الامتحانات</p>
      </header>
      <div className="wrap" style={{ maxWidth: 820 }}>
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && data.chapters.length > 1 && (
          <div className="chips">{data.chapters.map((c, i) => <button type="button" key={c.slug} className={i === openChapter ? "on" : ""} onClick={() => { setOpenChapter(i); setOpenExam(null); }}>{c.chapter}</button>)}</div>
        )}
        {ch && (
          <div className="card">
            <h2>📚 {ch.chapter}</h2>
            <table className="extable"><tbody>
              <tr><th>#</th><th>الامتحان</th><th className="p">النسخ</th><th className="p">الوقت</th></tr>
              {ch.exams.map((e) => {
                const bad = e.versions.filter((v) => !v.ok).length;
                const open = openExam === e.id;
                return (
                  <ExamRows key={e.id} open={open} head={
                    <tr className={"exrow" + (open ? " sel" : "")} onClick={() => { setOpenExam(open ? null : e.id); setOpenVersion(null); setOpenQ(null); }}>
                      <td>{e.ord}</td><td><b>{e.title}</b> {lectureOf(e.info)}{bad ? <span className="exbad"> ⚠️ {bad}</span> : null}</td>
                      <td className="p">{e.versions.length}</td><td className="p">{fmtTime(e.minutes)}</td>
                    </tr>
                  }>
                    <ExamPanel exam={e} busy={busy} call={call} fileUrl={fileUrl} openVersion={openVersion} setOpenVersion={(v) => { setOpenVersion(v); setOpenQ(null); }} openQ={openQ} setOpenQ={setOpenQ} />
                  </ExamRows>
                );
              })}
            </tbody></table>
            <AddExam slug={ch.slug} busy={busy} call={call} />
          </div>
        )}
      </div>
      {busy && <div className="bar"><div className="in"><div className="sum"><small>جاري الحفظ...</small></div></div></div>}
    </>
  );
}

function ExamRows({ head, open, children }: { head: ReactNode; open: boolean; children: ReactNode }) {
  return <>{head}{open && <tr><td colSpan={4} className="expanel">{children}</td></tr>}</>;
}

/** زر فيه خطوة تأكيد داخل الصفحة */
function Confirm({ label, onYes, disabled }: { label: string; onYes: () => void; disabled?: boolean }) {
  const [ask, setAsk] = useState(false);
  return ask
    ? <button type="button" className="exbtn danger" disabled={disabled} onClick={() => { setAsk(false); onYes(); }}>⚠️ متأكد؟ اضغط مرة ثانية</button>
    : <button type="button" className="exbtn" disabled={disabled} onClick={() => setAsk(true)}>{label}</button>;
}
function FileButton({ label, accept, multiple, onFiles, disabled }: { label: string; accept: string; multiple?: boolean; onFiles: (f: File[]) => void; disabled?: boolean }) {
  return (
    <label className={"exbtn" + (disabled ? " off" : "")}>
      {label}
      <input type="file" accept={accept} multiple={multiple} hidden disabled={disabled} onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ""; if (f.length) onFiles(f); }} />
    </label>
  );
}

type Call = (b: Record<string, unknown> | FormData) => Promise<boolean>;
function ExamPanel({ exam, busy, call, fileUrl, openVersion, setOpenVersion, openQ, setOpenQ }: {
  exam: Exam; busy: boolean; call: Call; fileUrl: (r: string) => string;
  openVersion: number | null; setOpenVersion: (v: number | null) => void; openQ: number | null; setOpenQ: (q: number | null) => void;
}) {
  const [minutes, setMinutes] = useState(String(exam.minutes));
  const version = exam.versions.find((v) => v.id === openVersion);
  return (
    <div>
      <div className="exline">
        <span>🕓 الوقت بالدقائق:</span>
        <input className="exnum" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || minutes === String(exam.minutes)} onClick={() => call({ action: "minutes", id: exam.id, value: minutes })}>حفظ</button>
      </div>
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
      {version && <VersionPanel version={version} busy={busy} call={call} fileUrl={fileUrl} openQ={openQ} setOpenQ={setOpenQ} onDeleted={() => setOpenVersion(null)} />}
      <div className="exline"><Confirm label="🗑 حذف الامتحان كله" disabled={busy} onYes={() => call({ action: "delExam", id: exam.id })} /></div>
    </div>
  );
}

function PaperTab({ pages, pdf, label, action, busy, upload, fileUrl }: {
  pages: string[]; pdf: string | null; label: string; action: string; busy: boolean; upload: (a: string, f: File) => void; fileUrl: (r: string) => string;
}) {
  return (
    <div>
      {pages.map((p) => <img className="eximg" key={p} src={fileUrl(p)} alt={label} loading="lazy" />)}
      {!pages.length && pdf && <div className="exline"><a className="exbtn" href={fileUrl(pdf)} target="_blank" rel="noreferrer">📄 افتح نسخة {label}</a></div>}
      {!pages.length && !pdf && <div className="exempty">ماكو نسخة {label} بعد</div>}
      <div className="exline">
        <FileButton label={`⬆️ ${pdf ? "تبديل" : "رفع"} نسخة ${label} (PDF)`} accept="application/pdf" disabled={busy} onFiles={(f) => upload(action, f[0])} />
      </div>
    </div>
  );
}

function VersionPanel({ version: v, busy, call, fileUrl, openQ, setOpenQ, onDeleted }: {
  version: Version; busy: boolean; call: Call; fileUrl: (r: string) => string; openQ: number | null; setOpenQ: (q: number | null) => void; onDeleted: () => void;
}) {
  const [tab, setTab] = useState<"ar" | "en" | "answers">("ar");
  const total = v.questions.reduce((s, q) => s + q.max, 0);
  const upload = (action: string, f: File) => { const fd = new FormData(); fd.set("action", action); fd.set("id", String(v.id)); fd.set("file", f); void call(fd); };
  return (
    <div className="exversion">
      <div className="exline">
        <b>نسخة {v.model}</b><span>{KIND[v.kind]}</span><span className={total === 100 ? "" : "exbad"}>المجموع {total}</span>
        <span>{v.ok ? "✅ جاهزة" : "⚠️ موقوفة"}</span>
      </div>
      {v.issues.map((x) => <div className="exbad exissue" key={x}>• {x.replace(/^.*?نسخة \S+:\s*/, "")}</div>)}
      <div className="chips extabs">
        <button type="button" className={tab === "ar" ? "on" : ""} onClick={() => setTab("ar")}>🇮🇶 العربي</button>
        <button type="button" className={tab === "en" ? "on" : ""} onClick={() => setTab("en")}>🇬🇧 الإنجليزي</button>
        <button type="button" className={tab === "answers" ? "on" : ""} onClick={() => setTab("answers")}>📘 الجواب النموذجي ({v.questions.length})</button>
      </div>
      {tab === "ar" && <PaperTab pages={v.pagesAr} pdf={v.pdfAr} label="العربي" action="pdfAr" busy={busy} upload={upload} fileUrl={fileUrl} />}
      {tab === "en" && <PaperTab pages={v.pagesEn} pdf={v.pdfEn} label="الإنجليزي" action="pdfEn" busy={busy} upload={upload} fileUrl={fileUrl} />}
      {tab === "answers" && (
        <div>
          <div className="exhint">الجواب نفسه للعربي والإنجليزي، والسؤال يطلع للمصحح بالعربي.</div>
          {v.questions.map((q) => <QuestionRow key={q.id} q={q} open={openQ === q.id} toggle={() => setOpenQ(openQ === q.id ? null : q.id)} busy={busy} call={call} fileUrl={fileUrl} />)}
          <AddQuestion versionId={v.id} busy={busy} call={call} />
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
  const [mark, setMark] = useState(String(q.max));
  useEffect(() => setMark(String(q.max)), [q.max]);
  const send = (action: string, files: File[]) => { const fd = new FormData(); fd.set("action", action); fd.set("id", String(q.id)); files.forEach((f) => fd.append("file", f)); return call(fd); };
  return (
    <div className="exq">
      <button type="button" className={"exqhead" + (open ? " on" : "")} onClick={toggle}>
        <span>س {q.n}{q.edited ? " ✏️" : ""}</span><span>{q.max} درجة {q.a.length ? "" : "· ⚠️ بدون جواب"}</span>
      </button>
      {open && (
        <div className="exqbody">
          {q.q ? <img className="eximg" src={fileUrl(q.q)} alt={`س ${q.n}`} loading="lazy" /> : <div className="exbad">ماكو صورة للسؤال</div>}
          <div className="exline">
            <span>الدرجة:</span>
            <input className="exnum" inputMode="numeric" value={mark} onChange={(e) => setMark(e.target.value)} />
            <button type="button" className="exbtn" disabled={busy || mark === String(q.max)} onClick={() => call({ action: "mark", id: q.id, value: mark })}>حفظ</button>
            <FileButton label="🖼 تبديل السؤال" accept="image/png,image/jpeg" disabled={busy} onFiles={(f) => send("replaceQ", f)} />
            <FileButton label="📘 تبديل الجواب" accept="image/png,image/jpeg" multiple disabled={busy} onFiles={(f) => send("replaceA", f)} />
            <Confirm label="🗑 حذف" disabled={busy} onYes={() => call({ action: "delQuestion", id: q.id })} />
          </div>
          <div className="exlabel">📘 الجواب النموذجي</div>
          {q.a.map((a) => <img className="eximg" key={a} src={fileUrl(a)} alt="الجواب" loading="lazy" />)}
        </div>
      )}
    </div>
  );
}

function AddQuestion({ versionId, busy, call }: { versionId: number; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<File | null>(null);
  const [a, setA] = useState<File[]>([]);
  const [mark, setMark] = useState("");
  if (!open) return <div className="exline"><button type="button" className="exbtn" onClick={() => setOpen(true)}>➕ إضافة سؤال</button></div>;
  return (
    <div className="exadd">
      <FileButton label={q ? "✅ صورة السؤال بالعربي" : "🖼 صورة السؤال بالعربي"} accept="image/png,image/jpeg" onFiles={(f) => setQ(f[0])} />
      <FileButton label={a.length ? `✅ صور الجواب (${a.length})` : "📘 صور الجواب"} accept="image/png,image/jpeg" multiple onFiles={setA} />
      <input className="exnum" inputMode="numeric" placeholder="الدرجة" value={mark} onChange={(e) => setMark(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !q || !a.length || !mark} onClick={async () => {
        const fd = new FormData();
        fd.set("action", "addQuestion"); fd.set("id", String(versionId)); fd.set("mark", mark); fd.set("q", q!);
        a.forEach((f) => fd.append("a", f));
        if (await call(fd)) { setOpen(false); setQ(null); setA([]); setMark(""); }
      }}>حفظ السؤال</button>
      <button type="button" className="exbtn" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

function AddExam({ slug, busy, call }: { slug: string; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("75");
  if (!open) return <div className="exline expad"><button type="button" className="exbtn" onClick={() => setOpen(true)}>➕ امتحان جديد</button></div>;
  return (
    <div className="exadd expad">
      <input placeholder="عنوان الامتحان، مثل: ديموافر المحاضرة (6)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="exnum" inputMode="numeric" placeholder="الدقائق" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      <button type="button" className="exbtn" disabled={busy || !title.trim()} onClick={async () => { if (await call({ action: "addExam", slug, title, minutes })) { setOpen(false); setTitle(""); } }}>حفظ</button>
      <button type="button" className="exbtn" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}
