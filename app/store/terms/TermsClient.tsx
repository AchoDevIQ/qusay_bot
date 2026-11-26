"use client";
// صفحة شروط التسجيل: إضافة وتعديل وحذف، ولكل شرط سؤال «إي لو لا» يجاوبه الطالب حتى يعبر
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Term = { id: number; text: string; kind?: "cond" | "info"; q?: string; a?: "yes" | "no" };
type Data = { terms: Term[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

export default function TermsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/terms", "📜 شروط التسجيل");
  return (
    <>
      <AdminHeader title="📜 شروط التسجيل" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">الطالب الجديد يقرأ هاي بالترتيب. كل وحدة تختار نوعها: «✍️ شرط» يعيد كتابته كله كلمة كلمة (ما يگدر يلصق، والهمزات والفواصل ما تفرق)، لو «📖 تعليمة» يقراها ويدوس «فهمت». التعديل يطبق على اللي يسجلون بعده.</div>
            {data.terms.map((t, i) => <TermCard key={t.id + t.text} term={t} n={i + 1} busy={busy} call={call} />)}
            {!data.terms.length && <div className="empty">ماكو شروط، والطالب يبدي من معلوماته مباشرة.</div>}
            <AddTerm busy={busy} call={call} />
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

/** النوع: شرط ينكتب، لو تعليمة تنقرا */
function Kind({ kind, set }: { kind: string; set: (k: "cond" | "info") => void }) {
  return (
    <div className="exline adtop">
      {([["cond", "✍️ شرط: يعيد كتابته"], ["info", "📖 تعليمة: يقراها بس"]] as const).map(([k, t]) => (
        <button type="button" key={k} className={kind === k ? "btn" : "exbtn"} style={{ width: "auto" }} onClick={() => set(k)}>{t}</button>
      ))}
    </div>
  );
}

/** السؤال وجوابه الصح (القديم، ما يطلع بالصفحة) */
export function QA({ q, a, setQ, setA }: { q: string; a: string; setQ: (v: string) => void; setA: (v: "yes" | "no") => void }) {
  return (
    <>
      <div className="exlabel adtop">❓ السؤال اللي يجاوبه الطالب (إي لو لا)</div>
      <input className="tmtext" style={{ minHeight: 44 }} placeholder="مثلاً: بعد ما يخلص الدور الأول، يبقى الكود مفتوح؟" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim() && <div className="exline adtop"><span>الجواب الصح:</span>
        {(["yes", "no"] as const).map((v) => <button type="button" key={v} className={a === v ? "btn" : "exbtn"} style={{ width: "auto", minWidth: 70 }} onClick={() => setA(v)}>{v === "yes" ? "إي" : "لا"}</button>)}
      </div>}
    </>
  );
}

function TermCard({ term, n, busy, call }: { term: Term; n: number; busy: boolean; call: Call }) {
  const [text, setText] = useState(term.text);
  const [kind, setKind] = useState<"cond" | "info">(term.kind ?? "info");
  const same = text.trim() === term.text && kind === (term.kind ?? "info");
  return (
    <div className="card">
      <h2>{kind === "cond" ? "✍️ الشرط" : "📖 التعليمة"} {n}</h2>
      <div className="expad">
        <textarea className="tmtext" aria-label={`نص الشرط ${n}`} rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <Kind kind={kind} set={setKind} />
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || !text.trim() || same} onClick={() => void call({ action: "save", id: term.id, text, kind, q: term.q ?? "", a: term.a ?? "" })}>حفظ</button>
          <Confirm label="🗑 حذف الشرط" disabled={busy} onYes={() => void call({ action: "del", id: term.id })} />
        </div>
      </div>
    </div>
  );
}

function AddTerm({ busy, call }: { busy: boolean; call: Call }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"cond" | "info">("cond");
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ شرط أو تعليمة جديدة</div>
      <textarea className="tmtext" placeholder="اكتب نص الشرط، وينضاف آخر الشروط" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <Kind kind={kind} set={setKind} />
      <button type="button" className="btn adtop" disabled={busy || !text.trim()} onClick={async () => { if (await call({ action: "add", text, kind })) { setText(""); setKind("cond"); } }}>إضافة</button>
    </div>
  );
}
