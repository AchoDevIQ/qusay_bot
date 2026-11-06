"use client";
// مكتبة الملصقات: صور وكاركترات (حتى المتحركة GIF) لكل مدى درجات. تطلع ويا درجة الطالب، وبأداة الملصقات وقت التصحيح
import { useState } from "react";
import { CHARACTERS } from "../../../lib/characters.ts";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Sticker = { id: number; name: string; lo: number; hi: number };
type Data = { stickers: Sticker[]; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;

export default function StickersClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/comments", "🖼 مكتبة الملصقات");
  return (
    <>
      <AdminHeader title="🖼 مكتبة الملصقات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <Ready have={data.stickers.map((s) => s.name)} busy={busy} call={call} />
            <AddSticker busy={busy} call={call} />
            {!data.stickers.length && <div className="empty">ماكو ملصقات بعد. ارفع أول ملصق من فوك.</div>}
            <div className="stgrid">{data.stickers.map((s) => <StickerCard key={s.id + s.name + s.lo + s.hi} s={s} busy={busy} call={call} />)}</div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
/** الشخصية من رسمة لصورة PNG، حتى توصل للطالب مثل أي ملصق */
async function toPng(svg: string) {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 600; c.height = 600;
  c.getContext("2d")!.drawImage(img, 0, 0, 600, 600);
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("png"))), "image/png"));
}

/** شخصيات جاهزة: تنضاف للمكتبة بزر، وبعدها تتعدل وتنحذف مثل أي ملصق. اللي ينحذف يرجع يطلع هنا */
function Ready({ have, busy, call }: { have: string[]; busy: boolean; call: Call }) {
  const left = CHARACTERS.filter((c) => !have.includes(c.name));
  const [working, setWorking] = useState(false);
  if (!left.length) return null;
  async function add() {
    setWorking(true);
    try {
      for (const c of left) {
        const fd = new FormData();
        fd.set("file", new File([await toPng(c.svg)], "character.png", { type: "image/png" }));
        fd.set("name", c.name); fd.set("lo", String(c.lo)); fd.set("hi", String(c.hi));
        if (!await call(fd)) break;
      }
    } finally { setWorking(false); }
  }
  return (
    <div className="card expad adform">
      <div className="exlabel">🎭 شخصيات جاهزة</div>
      <div className="exhint">«كيو» بحالات حسب الدرجة. تنضاف للمكتبة، وبعدها تگدر تغير اسمها ومداها أو تحذفها، وتضيف شخصيات غيرها.</div>
      <div className="stgrid">{left.map((c) => (
        <div key={c.name} className="card stcard"><img src={svgUrl(c.svg)} alt={c.name} /><b>{c.name}</b><span className="exhint">{c.lo} – {c.hi}</span></div>
      ))}</div>
      <button type="button" className="btn" disabled={busy || working} onClick={() => void add()}>{working ? "جاري الإضافة..." : `➕ أضف ${left.length === CHARACTERS.length ? "الشخصيات" : `الباقي (${left.length})`} للمكتبة`}</button>
    </div>
  );
}

function AddSticker({ busy, call }: { busy: boolean; call: Call }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(""), [lo, setLo] = useState("0"), [hi, setHi] = useState("100");
  const [key, setKey] = useState(0);
  async function send() {
    const fd = new FormData();
    fd.set("file", file!); fd.set("name", name); fd.set("lo", lo); fd.set("hi", hi);
    if (await call(fd)) { setFile(null); setName(""); setKey(key + 1); }
  }
  return (
    <div className="card expad adform">
      <div className="exlabel">📤 رفع ملصق</div>
      <div className="exhint">صورة PNG أو JPG، أو GIF متحركة. أكثر شي 6 ميگا.</div>
      <label className="exbtn">🖼 {file ? file.name : "اختار صورة"}
        <input key={key} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, "")); }} />
      </label>
      <label>الاسم<input className="exinput" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="cmrange">
        <label>من <input className="exnum" inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value)} /></label>
        <label>إلى <input className="exnum" inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value)} /></label>
      </div>
      <button type="button" className="btn" disabled={busy || !file || !name.trim()} onClick={() => void send()}>رفع</button>
    </div>
  );
}

function StickerCard({ s, busy, call }: { s: Sticker; busy: boolean; call: Call }) {
  const [name, setName] = useState(s.name), [lo, setLo] = useState(String(s.lo)), [hi, setHi] = useState(String(s.hi));
  const changed = name.trim() !== s.name || lo !== String(s.lo) || hi !== String(s.hi);
  return (
    <div className="card stcard">
      <img src={`/api/sticker?id=${s.id}`} alt={s.name} />
      <input className="exinput" aria-label="اسم الملصق" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="cmrange">
        <input className="exnum" aria-label="من" inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value)} />
        <span>–</span>
        <input className="exnum" aria-label="إلى" inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value)} />
      </div>
      <div className="exline">
        {changed && <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "saveSticker", id: s.id, name, lo, hi })}>حفظ</button>}
        <Confirm label="🗑 حذف" disabled={busy} onYes={() => void call({ action: "delSticker", id: s.id })} />
      </div>
    </div>
  );
}
