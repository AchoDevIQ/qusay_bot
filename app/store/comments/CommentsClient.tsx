"use client";
// تعليقات الدرجات: لكل مدى درجات مقولات، والطالب توصله وحدة عشوائية ويا درجته
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Comment = { id: number; lo: number; hi: number; text: string; sticker: number };
type Sticker = { id: number; name: string; lo: number; hi: number };
type Data = { comments: Comment[]; stickers: Sticker[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const BANDS = Array.from({ length: 10 }, (_, i) => [i * 10, i === 9 ? 100 : i * 10 + 9]);

export default function CommentsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/comments", "💬 تعليقات الدرجات");
  const [open, setOpen] = useState("");
  const groups = new Map<string, Comment[]>();
  for (const c of data?.comments ?? []) { const k = `${c.lo} - ${c.hi}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  return (
    <>
      <AdminHeader title="💬 تعليقات الدرجات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">لمن تنصحح الورقة، الطالب توصله درجته ويا مقولة عشوائية من مدى درجته، وما تتكرر عليه لحد ما يشوف كل مقولات المدى. إذا المقولة إلها ملصق يوصل وياها، وإذا لا ينختار ملصق عشوائي من نفس المدى.</div>
            <div className="card expad">
              <div className="exlabel">📊 عدد المقولات لكل درجة</div>
              <div className="cmbars">
                {BANDS.map(([a, b]) => {
                  const n = data.comments.filter((c) => c.lo <= b && c.hi >= a).length;
                  return <div key={a} className={"cmbar" + (n ? "" : " none")}><b>{n}</b><span>{a}–{b}</span></div>;
                })}
              </div>
              <div className="exhint">الأحمر يعني ماكو مقولة لهاي الدرجات.</div>
            </div>
            <AddComment stickers={data.stickers} busy={busy} call={call} />
            {[...groups].map(([k, list]) => (
              <div className="card" key={k}>
                <button type="button" className="cmhead" onClick={() => setOpen(open === k ? "" : k)}>
                  <b>من {k}</b><span>{list.length} مقولة {open === k ? "▲" : "▼"}</span>
                </button>
                {open === k && list.map((c) => <CommentRow key={c.id + c.text + c.lo + c.hi + c.sticker} c={c} stickers={data.stickers} busy={busy} call={call} />)}
              </div>
            ))}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Fields({ lo, hi, text, sticker, setLo, setHi, setText, setSticker, stickers }: {
  lo: string; hi: string; text: string; sticker: number; stickers: Sticker[];
  setLo: (v: string) => void; setHi: (v: string) => void; setText: (v: string) => void; setSticker: (v: number) => void;
}) {
  return (
    <>
      <div className="cmrange">
        <label>من <input className="exnum" inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value)} /></label>
        <label>إلى <input className="exnum" inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value)} /></label>
        <label>الملصق
          <select className="exnum adwide" value={sticker} onChange={(e) => setSticker(Number(e.target.value))}>
            <option value={0}>عشوائي من نفس المدى</option>
            {stickers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.lo}–{s.hi})</option>)}
          </select>
        </label>
        {!!sticker && <img className="cmthumb" src={`/api/sticker?id=${sticker}`} alt="" />}
      </div>
      <textarea className="tmtext" rows={3} placeholder="اكتب المقولة" value={text} onChange={(e) => setText(e.target.value)} />
    </>
  );
}

function AddComment({ stickers, busy, call }: { stickers: Sticker[]; busy: boolean; call: Call }) {
  const [lo, setLo] = useState("0"), [hi, setHi] = useState("100"), [text, setText] = useState(""), [sticker, setSticker] = useState(0);
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ مقولة جديدة</div>
      <Fields {...{ lo, hi, text, sticker, setLo, setHi, setText, setSticker, stickers }} />
      <button type="button" className="btn" disabled={busy || !text.trim()} onClick={async () => { if (await call({ action: "add", lo, hi, text, sticker })) setText(""); }}>إضافة</button>
    </div>
  );
}

function CommentRow({ c, stickers, busy, call }: { c: Comment; stickers: Sticker[]; busy: boolean; call: Call }) {
  const [lo, setLo] = useState(String(c.lo)), [hi, setHi] = useState(String(c.hi)), [text, setText] = useState(c.text), [sticker, setSticker] = useState(c.sticker);
  const changed = text.trim() !== c.text || lo !== String(c.lo) || hi !== String(c.hi) || sticker !== c.sticker;
  return (
    <div className="expad cmrow">
      <Fields {...{ lo, hi, text, sticker, setLo, setHi, setText, setSticker, stickers }} />
      <div className="exline pdactions">
        <button type="button" className="btn" disabled={busy || !changed || !text.trim()} onClick={() => void call({ action: "save", id: c.id, lo, hi, text, sticker })}>حفظ</button>
        <Confirm label="🗑 حذف" disabled={busy} onYes={() => void call({ action: "del", id: c.id })} />
      </div>
    </div>
  );
}
