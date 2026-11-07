"use client";
// المصحح الآلي: صاحب البوت يشغله، ولكل سؤال يحفظ خطوات الحل ودرجة كل خطوة.
// الخطوات يطلعها الذكاء من صورة الحل، وصاحب البوت يعدلها قبل الحفظ
import { useEffect, useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Step = { text: string; points: number };
type Q = { id: number; n: number; max: number; q: string | null; a: string[]; steps: Step[] | null };
type Version = { id: number; model: string; kind: string; questions: Q[] };
type Exam = { id: number; title: string; versions: Version[]; ready: boolean };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type Data = { on: boolean; linked: boolean; ready: number; total: number; graded: number; chapters: Chapter[]; fileToken: string; draft?: { id: number; steps: Step[] }; notice?: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

export default function AiGradeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/aigrade", "🤖 المصحح الآلي");
  const [slug, setSlug] = useState("");
  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  const ch = data?.chapters.find((c) => c.slug === slug) ?? data?.chapters[0];
  return (
    <>
      <AdminHeader title="🤖 المصحح الآلي" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">المصحح الآلي يصحح الورقة وحده ويدزها للطالب، بدون مصحح. يصحح بس الامتحانات اللي كل أسئلتها إلها خطوات محفوظة هنا. الورقة اللي ما يگدر عليها تبقى للمصححين مثل قبل. والاعتراضات على أوراقه توصلك إنت.</div>
            <div className="card expad">
              <div className="exlabel">التشغيل</div>
              {!data.linked && <div className="exbad">⚠️ خدمة التصحيح بعدها مو مربوطة بالسيرفر، فما يگدر يشتغل.</div>}
              <div className="aig-stats">أسئلة إلها خطوات: <b>{data.ready}</b> من {data.total} · أوراق صححها: <b>{data.graded}</b></div>
              <button type="button" className={data.on ? "btn ghost" : "btn"} disabled={busy || (!data.linked && !data.on)} onClick={() => void call({ action: "on", on: !data.on })}>
                {data.on ? "⏸ طفي المصحح الآلي" : "▶️ شغل المصحح الآلي"}
              </button>
              {data.on && <div className="fdok">🤖 شغال: كل دقيقة ياخذ الأوراق الجاهزة ويصححها.</div>}
            </div>
            <div className="card expad">
              <div className="exlabel">الفصل</div>
              <select value={ch?.slug ?? ""} onChange={(e) => setSlug(e.target.value)}>
                {data.chapters.map((c) => <option key={c.slug} value={c.slug}>{c.chapter}</option>)}
              </select>
            </div>
            {ch?.exams.map((e) => (
              <details key={e.id} className="card cpch">
                <summary><b>{e.title}</b> {e.ready ? "· ✅ جاهز" : ""}</summary>
                {e.versions.map((v) => (
                  <div key={v.id} className="aig-ver">
                    <div className="exlabel">النموذج {v.model}{v.kind === "optional" ? " (اختياري)" : ""}</div>
                    {!v.questions.length && <div className="exhint">ماكو أسئلة بهذا النموذج.</div>}
                    {v.questions.map((q) => <QCard key={q.id} q={q} busy={busy} call={call} fileUrl={fileUrl} draft={data.draft?.id === q.id ? data.draft.steps : undefined} />)}
                  </div>
                ))}
              </details>
            ))}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function QCard({ q, busy, call, fileUrl, draft }: { q: Q; busy: boolean; call: Call; fileUrl: (r: string) => string; draft?: Step[] }) {
  const [steps, setSteps] = useState<Step[]>(q.steps ?? []);
  const [open, setOpen] = useState(false);
  // الخطوات اللي طلعها الذكاء تنحط بالمربعات، وما تنحفظ لحد ما يدوس حفظ
  useEffect(() => { if (draft) { setSteps(draft); setOpen(true); } }, [draft]);
  useEffect(() => { if (!draft) setSteps(q.steps ?? []); }, [q.steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = steps.reduce((t, s) => t + (Number(s.points) || 0), 0);
  const ok = steps.length > 0 && Math.abs(sum - q.max) < 0.01 && steps.every((s) => s.text.trim());
  const set = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="aig-q">
      <button type="button" className="aig-qhead" onClick={() => setOpen(!open)}>
        س{q.n} <small>من {q.max}</small> {q.steps ? `· ✅ ${q.steps.length} خطوات` : "· ⏳ بدون خطوات"} {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="aig-body">
          {q.q && <img className="eximg" src={fileUrl(q.q)} alt={`س ${q.n}`} loading="lazy" />}
          {q.a.length ? <div className="aig-sol">{q.a.map((r) => <img key={r} className="eximg" src={fileUrl(r)} alt="الحل" loading="lazy" />)}</div>
            : <div className="exbad">ماكو صورة حل لهذا السؤال، فلازم تكتب الخطوات بإيدك.</div>}
          {q.a.length > 0 && <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "draft", id: q.id })}>🤖 طلّع الخطوات من صورة الحل</button>}
          {steps.map((s, i) => (
            <div key={i} className="aig-step">
              <span className="aig-n">{i + 1}</span>
              <textarea dir="ltr" rows={2} value={s.text} placeholder="x^2 - y^2 = 3" onChange={(e) => set(i, { text: e.target.value })} />
              <input type="number" inputMode="decimal" min={0} value={Number.isFinite(s.points) ? s.points : 0} onChange={(e) => set(i, { points: Number(e.target.value) })} />
              <button type="button" className="aig-x" aria-label="امسح الخطوة" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setSteps([...steps, { text: "", points: 0 }])}>➕ خطوة</button>
          <div className={ok ? "fdok" : "exbad"}>المجموع {sum} من {q.max}{!ok && steps.length ? " · لازم يساوي درجة السؤال" : ""}</div>
          <div className="aig-btns">
            <button type="button" className="btn" disabled={busy || !ok} onClick={() => void call({ action: "save", id: q.id, steps })}>💾 حفظ الخطوات</button>
            {q.steps && <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "clear", id: q.id })}>🗑 امسح الخطوات</button>}
          </div>
        </div>
      )}
    </div>
  );
}
