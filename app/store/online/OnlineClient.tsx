"use client";
// الفصول اللي خلص امتحانها الحضوري
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Data = { chapters: { label: string; on: boolean }[] };

export default function OnlineClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/online", "💻 فصول إلكترونية فقط");
  return (
    <>
      <AdminHeader title="💻 فصول امتحانها إلكتروني فقط" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <div className="card">
            <h2>أشر الفصل اللي خلص امتحانه الحضوري</h2>
            <div className="expad exhint adtop">طالب الحضوري يشوف منتجات الإلكتروني لهذا الفصل بدل الحضوري، ويطلعله تنبيه إن امتحاناته إلكترونية فقط. الفصل يتعرف من اسم المنتج.</div>
            {data.chapters.length ? data.chapters.map((c) => (
              <label key={c.label} className="adcheck">
                <input type="checkbox" checked={c.on} disabled={busy} onChange={() => void call({ action: "toggle", label: c.label })} />
                <span>{c.label}</span>
              </label>
            )) : <div className="empty">ماكو منتجات باسمها فصل، مثل «الفصل الأول».</div>}
          </div>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
