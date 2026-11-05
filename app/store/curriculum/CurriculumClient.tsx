"use client";
// الفصول والمواضيع. الأسئلة القديمة مربوطة بمكان الفصل والموضوع، فالحذف بس من آخر القائمة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Topic = { ar: string; en: string; lectures: number | string };
type Chapter = { ar: string; en: string; topics: Topic[] };
type Data = { chapters: Chapter[] };

export default function CurriculumClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/curriculum", "📚 الفصول والمواضيع");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <AdminHeader title="📚 الفصول والمواضيع" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Editor key={JSON.stringify(data)} start={data.chapters} busy={busy} save={async (chapters) => setSaved(!!await call({ action: "save", chapters }))} edited={() => setSaved(false)} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={saved ? "✅ انحفظت الفصول والمواضيع" : ""} />
    </>
  );
}

function Editor({ start, busy, save, edited }: { start: Chapter[]; busy: boolean; save: (c: Chapter[]) => void; edited: () => void }) {
  const [list, setList] = useState(start);
  const [open, setOpen] = useState<number | null>(null);
  const change = (next: Chapter[]) => { setList(next); edited(); };
  const setCh = (i: number, c: Partial<Chapter>) => change(list.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <>
      <div className="card expad exhint adpad">الأسئلة القديمة مربوطة بمكان الفصل والموضوع، فتعديل الاسم آمن، والإضافة والحذف يكونون من آخر القائمة بس.</div>
      {list.map((c, i) => (
        <div className="card" key={i}>
          <button type="button" className="adchapter" onClick={() => setOpen(open === i ? null : i)}><span>📚 {c.ar || "فصل جديد"}</span><small>{c.topics.length} موضوع {open === i ? "▲" : "▼"}</small></button>
          {open === i && (
            <div className="form">
              <label>اسم الفصل بالعربي</label>
              <input value={c.ar} onChange={(e) => setCh(i, { ar: e.target.value })} />
              <label>اسم الفصل بالإنجليزي</label>
              <input className="ltr" value={c.en} onChange={(e) => setCh(i, { en: e.target.value })} />
              <div className="exlabel adtopics">المواضيع</div>
              {c.topics.map((t, k) => {
                const setT = (p: Partial<Topic>) => setCh(i, { topics: c.topics.map((x, m) => (m === k ? { ...x, ...p } : x)) });
                return (
                  <div className="adtopic" key={k}>
                    <input placeholder="الاسم بالعربي" value={t.ar} onChange={(e) => setT({ ar: e.target.value })} />
                    <input className="ltr" placeholder="English" value={t.en} onChange={(e) => setT({ en: e.target.value })} />
                    <label className="adlect">عدد المحاضرات <input className="exnum" inputMode="numeric" value={t.lectures} onChange={(e) => setT({ lectures: e.target.value })} /></label>
                  </div>
                );
              })}
              <div className="exline">
                <button type="button" className="exbtn" onClick={() => setCh(i, { topics: [...c.topics, { ar: "", en: "", lectures: 0 }] })}>➕ موضوع</button>
                {!!c.topics.length && <button type="button" className="exbtn" onClick={() => setCh(i, { topics: c.topics.slice(0, -1) })}>🗑 حذف آخر موضوع</button>}
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="exline">
        <button type="button" className="exbtn" onClick={() => { change([...list, { ar: "", en: "", topics: [] }]); setOpen(list.length); }}>➕ فصل جديد</button>
        {list.length > 1 && <Confirm label="🗑 حذف آخر فصل" onYes={() => { change(list.slice(0, -1)); setOpen(null); }} />}
      </div>
      <button type="button" className="btn adfull" disabled={busy} onClick={() => save(list)}>حفظ كل التعديلات</button>
    </>
  );
}
