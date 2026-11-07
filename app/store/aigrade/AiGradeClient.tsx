"use client";
// نظام التصحيح AI: صاحب البوت يشغله، يختار بكل فصل المواضيع اللي يصححها ومنو توصله الأوراق اللي
// مو متأكد منها، يحفظ خطوات حل كل سؤال، ويشوف سجله وشگد صرف
import { useEffect, useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Step = { text: string; points: number };
type Q = { id: number; n: number; max: number; q: string | null; a: string[]; steps: Step[] | null };
type Version = { id: number; model: string; kind: string; questions: Q[] };
type Exam = { id: number; title: string; on: boolean; versions: Version[]; ready: boolean };
type Chapter = { slug: string; chapter: string; grader: number; exams: Exam[] };
type Sum = { sent: number; unsure: number; cost: number };
type Log = { at: string; kind: "sent" | "unsure" | "rubric"; name?: string; exam?: string; total?: number; toName: string; cost: number };
type PriceRow = { model: string; in: number; out: number; missing: boolean };
type Data = {
  on: boolean; linked: boolean; ready: number; total: number; graded: number; chapters: Chapter[]; graders: { id: number; name: string }[];
  fileToken: string; money: { today: Sum; month: Sum; all: Sum }; prices: PriceRow[]; log: Log[]; draft?: { id: number; steps: Step[] }; notice?: string;
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default function AiGradeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/aigrade", "🤖 نظام التصحيح AI");
  const [slug, setSlug] = useState("");
  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  const ch = data?.chapters.find((c) => c.slug === slug) ?? data?.chapters[0];
  return (
    <>
      <AdminHeader title="🤖 نظام التصحيح AI" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">نظام التصحيح AI مصحح مثل الباقين: يصحح الورقة ويدزها للطالب. يصحح بس المواضيع اللي تأشرها هنا، وبس إذا كل أسئلة الموضوع إلها خطوات محفوظة. الورقة اللي هو مو متأكد منها ما توصل للطالب، تروح للمصحح اللي تختاره لفصلها. والاعتراضات على أوراقه توصلك إنت.</div>
            <div className="card expad">
              <div className="exlabel">التشغيل</div>
              {!data.linked && <div className="exbad">⚠️ خدمة التصحيح بعدها مو مربوطة بالسيرفر، فما يگدر يشتغل.</div>}
              <div className="aig-stats">أسئلة إلها خطوات: <b>{data.ready}</b> من {data.total} · أوراق صححها: <b>{data.graded}</b></div>
              <button type="button" className={data.on ? "btn ghost" : "btn"} disabled={busy || (!data.linked && !data.on)} onClick={() => void call({ action: "on", on: !data.on })}>
                {data.on ? "⏸ طفي نظام التصحيح AI" : "▶️ شغل نظام التصحيح AI"}
              </button>
              {data.on && <div className="fdok">🤖 شغال: كل دقيقة ياخذ أوراق المواضيع المأشرة ويصححها.</div>}
            </div>
            <Money data={data} />
            <div className="card expad">
              <div className="exlabel">الفصل</div>
              <select value={ch?.slug ?? ""} onChange={(e) => setSlug(e.target.value)}>
                {data.chapters.map((c) => <option key={c.slug} value={c.slug}>{c.chapter}</option>)}
              </select>
            </div>
            {ch && <Scope key={ch.slug + JSON.stringify(ch.exams.map((e) => e.on)) + ch.grader} ch={ch} graders={data.graders} busy={busy} call={call} />}
            {ch?.exams.map((e) => (
              <details key={e.id} className="card cpch">
                <summary><b>{e.title}</b> {e.ready ? "· ✅ خطواته جاهزة" : "· ⏳ باقي خطوات"}</summary>
                {e.versions.map((v) => (
                  <div key={v.id} className="aig-ver">
                    <div className="exlabel">النموذج {v.model}{v.kind === "optional" ? " (اختياري)" : ""}</div>
                    {!v.questions.length && <div className="exhint">ماكو أسئلة بهذا النموذج.</div>}
                    {v.questions.map((q) => <QCard key={q.id} q={q} busy={busy} call={call} fileUrl={fileUrl} draft={data.draft?.id === q.id ? data.draft.steps : undefined} />)}
                  </div>
                ))}
              </details>
            ))}
            <LogCard data={data} />
            <Prices rows={data.prices} busy={busy} call={call} />
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

/** شگد صرف: الفلوس اللي تنسحب من حساب OpenAI حسب أسعار الموديلات */
function Money({ data }: { data: Data }) {
  const row = (label: string, s: Sum) => <tr><td>{label}</td><td>{s.sent}</td><td>{s.unsure}</td><td dir="ltr"><b>{usd(s.cost)}</b></td></tr>;
  return (
    <div className="card expad">
      <div className="exlabel">💰 شگد صرف</div>
      <table className="aig-money">
        <thead><tr><th></th><th>انرسلت للطالب</th><th>حولها لمصحح</th><th>الكلفة</th></tr></thead>
        <tbody>{row("اليوم", data.money.today)}{row("هذا الشهر", data.money.month)}{row("من البداية", data.money.all)}</tbody>
      </table>
      <div className="exhint">الكلفة بالدولار، محسوبة من عدد التوكنات وأسعار الموديلات اللي جوه. الرقم الأدق تلگاه بحساب Anthropic نفسه (console.anthropic.com).</div>
    </div>
  );
}

/** مواضيع الفصل: يأشر اللي يصححها نظام التصحيح، ويختار منو توصله الأوراق اللي مو متأكد منها */
function Scope({ ch, graders, busy, call }: { ch: Chapter; graders: Data["graders"]; busy: boolean; call: Call }) {
  const [on, setOn] = useState<number[]>(ch.exams.filter((e) => e.on).map((e) => e.id));
  const [grader, setGrader] = useState(ch.grader);
  const all = on.length === ch.exams.length;
  return (
    <div className="card expad">
      <div className="exlabel">المواضيع اللي يصححها نظام التصحيح AI</div>
      <button type="button" className="btn ghost" onClick={() => setOn(all ? [] : ch.exams.map((e) => e.id))}>{all ? "شيل الكل" : "أشّر الكل"}</button>
      <div className="aig-topics">
        {ch.exams.map((e) => (
          <label key={e.id} className="aig-topic">
            <input type="checkbox" checked={on.includes(e.id)} onChange={(x) => setOn(x.target.checked ? [...on, e.id] : on.filter((i) => i !== e.id))} />
            <span>{e.title}</span>
            {on.includes(e.id) && !e.ready && <small className="exbad">باقي خطوات</small>}
          </label>
        ))}
      </div>
      <div className="exlabel">الأوراق اللي مو متأكد منها تروح لـ</div>
      <select value={grader} onChange={(e) => setGrader(Number(e.target.value))}>
        <option value={0}>كل المصححين (اللي ياخذها أول)</option>
        {graders.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "scope", slug: ch.slug, exams: on, grader })}>💾 حفظ مواضيع الفصل</button>
    </div>
  );
}

function LogCard({ data }: { data: Data }) {
  return (
    <details className="card cpch">
      <summary><b>📜 سجل نظام التصحيح AI</b></summary>
      {!data.log.length && <div className="exhint">بعده ما صحح شي.</div>}
      <div className="aig-log">
        {data.log.map((r, i) => (
          <div key={i} className="aig-logrow">
            <small dir="ltr">{r.at}</small>
            <div>
              {r.kind === "sent" && <>✅ <b>{r.name}</b> · {r.exam} · <b>{r.total}</b> من 100</>}
              {r.kind === "unsure" && <>↪️ <b>{r.name}</b> · {r.exam} · ما متأكد، حولها لـ {r.toName || "كل المصححين"}</>}
              {r.kind === "rubric" && <>🧩 طلّع خطوات حل سؤال</>}
            </div>
            <small dir="ltr">{usd(r.cost)}</small>
          </div>
        ))}
      </div>
    </details>
  );
}

function Prices({ rows, busy, call }: { rows: PriceRow[]; busy: boolean; call: Call }) {
  const [edit, setEdit] = useState<Record<string, { in: number; out: number }>>({});
  return (
    <details className="card cpch">
      <summary><b>⚙️ أسعار الموديلات</b> {rows.some((r) => r.missing) ? "· ⚠️ موديل بدون سعر" : ""}</summary>
      <div className="exhint">بالدولار لكل مليون توكن، داخل وطالع. غيرها إذا تغيرت الأسعار. التصحيح يستعمل claude-haiku-5-5.</div>
      {rows.map((r) => {
        const v = edit[r.model] ?? { in: r.in, out: r.out };
        return (
          <div key={r.model} className="aig-price">
            <b dir="ltr">{r.model}</b>
            <input type="number" inputMode="decimal" min={0} step="0.01" value={v.in} onChange={(e) => setEdit({ ...edit, [r.model]: { ...v, in: Number(e.target.value) } })} />
            <input type="number" inputMode="decimal" min={0} step="0.01" value={v.out} onChange={(e) => setEdit({ ...edit, [r.model]: { ...v, out: Number(e.target.value) } })} />
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "price", model: r.model, ...v })}>💾</button>
          </div>
        );
      })}
    </details>
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
