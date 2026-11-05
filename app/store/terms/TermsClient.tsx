"use client";
// صفحة شروط التسجيل: إضافة وتعديل وحذف. كلمات الترتيب تطلع من نص الشرط نفسه
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Term = { id: number; text: string };
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
            <div className="exhint tmhint">الطالب الجديد يقرأ الشروط بهذا الترتيب، وتحت كل شرط يرتب كل كلماته. التعديل يطبق على اللي يسجلون بعده.</div>
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

function TermCard({ term, n, busy, call }: { term: Term; n: number; busy: boolean; call: Call }) {
  const [text, setText] = useState(term.text);
  return (
    <div className="card">
      <h2>الشرط {n}</h2>
      <div className="expad">
        <textarea className="tmtext" aria-label={`نص الشرط ${n}`} rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="exline pdactions">
          <button type="button" className="btn" disabled={busy || !text.trim() || text.trim() === term.text} onClick={() => void call({ action: "save", id: term.id, text })}>حفظ</button>
          <Confirm label="🗑 حذف الشرط" disabled={busy} onYes={() => void call({ action: "del", id: term.id })} />
        </div>
      </div>
    </div>
  );
}

function AddTerm({ busy, call }: { busy: boolean; call: Call }) {
  const [text, setText] = useState("");
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ شرط جديد</div>
      <textarea className="tmtext" placeholder="اكتب نص الشرط، وينضاف آخر الشروط" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !text.trim()} onClick={async () => { if (await call({ action: "add", text })) setText(""); }}>إضافة</button>
    </div>
  );
}
