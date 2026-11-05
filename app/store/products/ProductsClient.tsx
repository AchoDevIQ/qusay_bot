"use client";
// صفحة المنتجات والأقسام: كل شي يتعدل داخل نفس الصفحة بدون رسائل بالبوت
import { useState } from "react";
import { AdminHeader, Confirm, useAdminApi } from "../adminPage";

type Product = { id: number; name: string; price: number; mode: string; hidden: boolean; ask: boolean };
type Cat = { id: number; name: string; products: Product[] };
type Data = { cats: Cat[]; catId?: number; added?: string[]; bad?: string[] };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const MODES: [string, string][] = [["both", "🔄 كليهما"], ["in", "🏫 حضوري"], ["online", "💻 إلكتروني"]];
const modeLabel = (m: string) => MODES.find(([k]) => k === m)?.[1] ?? MODES[0][1];
const fmt = (n: number) => n.toLocaleString("en-US");

export default function ProductsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/products", "🛒 المنتجات والأقسام");
  const [catId, setCatId] = useState<number | null>(null);
  const [newCat, setNewCat] = useState("");
  const cats = data?.cats ?? [];
  const cat = cats.find((c) => c.id === catId) ?? cats[0];

  async function addCat() {
    const r = await call({ action: "addCat", name: newCat });
    if (r) { setNewCat(""); setCatId(r.catId ?? null); }
  }
  return (
    <>
      <AdminHeader title="🛒 المنتجات والأقسام" />
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="chips">
              {cats.map((c) => <button type="button" key={c.id} className={c.id === cat?.id ? "on" : ""} onClick={() => setCatId(c.id)}>{c.name} ({c.products.length})</button>)}
            </div>
            <div className="exadd pdnew">
              <input placeholder="اسم قسم جديد" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button type="button" className="exbtn" disabled={busy || !newCat.trim()} onClick={() => void addCat()}>➕ إضافة قسم</button>
            </div>
            {cat
              ? <CatCard key={cat.id} cat={cat} cats={cats} busy={busy} call={call} />
              : <div className="empty">لسه ماكو أقسام. ضيف قسم حتى تبدي.</div>}
            <Bulk result={data} busy={busy} call={call} />
          </>
        )}
      </div>
      {busy && <div className="bar"><div className="in"><div className="sum"><small>جاري الحفظ...</small></div></div></div>}
    </>
  );
}

function CatCard({ cat, cats, busy, call }: { cat: Cat; cats: Cat[]; busy: boolean; call: Call }) {
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState(cat.name);
  return (
    <div className="card">
      <h2>📂 {cat.name}</h2>
      {cat.products.length ? (
        <table className="extable"><tbody>
          <tr><th>المنتج</th><th className="p">السعر</th><th className="p">بالمتجر</th></tr>
          {cat.products.map((p) => (
            <ProductRows key={p.id} p={p} cats={cats} catId={cat.id} open={open === p.id} toggle={() => setOpen(open === p.id ? null : p.id)} close={() => setOpen(null)} busy={busy} call={call} />
          ))}
        </tbody></table>
      ) : <div className="empty">هذا القسم فارغ، والطالب ما يشوفه لحد ما تضيف بي منتج.</div>}
      <div className="expad">
        {!!cat.products.length && (
          <div className="exline pdhideall">
            <button type="button" className="exbtn" disabled={busy || cat.products.every((p) => !p.hidden)} onClick={() => void call({ action: "hideCat", id: cat.id, hidden: false })}>👁 إظهار الكل</button>
            <button type="button" className="exbtn" disabled={busy || cat.products.every((p) => p.hidden)} onClick={() => void call({ action: "hideCat", id: cat.id, hidden: true })}>🙈 إخفاء الكل</button>
          </div>
        )}
        <div className="exhint">❓ يسأل: اللي يشتري هذا المنتج ينفتح عنده السؤال العلمي. 🚫 ما يسأل: هذا المنتج ما يفتحه.</div>
        <div className="exhint">المنتج المخفي ما يطلع بالمتجر. مو حذف، واللي اشتراه قبل تبقى مشترياته عنده.</div>
        <AddProduct catId={cat.id} busy={busy} call={call} />
        <div className="exfoot">
          <div className="exadd">
            <input aria-label="اسم القسم" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === cat.name} onClick={() => void call({ action: "renameCat", id: cat.id, name })}>حفظ اسم القسم</button>
          </div>
          <Confirm label={`🗑 حذف القسم ومنتجاته (${cat.products.length})`} disabled={busy} onYes={() => void call({ action: "delCat", id: cat.id })} />
        </div>
      </div>
    </div>
  );
}

function ProductRows({ p, cats, catId, open, toggle, close, busy, call }: { p: Product; cats: Cat[]; catId: number; open: boolean; toggle: () => void; close: () => void; busy: boolean; call: Call }) {
  return (
    <>
      <tr className={"exrow" + (open ? " sel" : "") + (p.hidden ? " pdhidden" : "")} onClick={toggle}>
        <td><b>{p.name}</b><small className="pdmode">{modeLabel(p.mode)}</small></td>
        <td className="p">{fmt(p.price)}</td>
        <td className="p"><button type="button" className="exbtn pdeye" disabled={busy} onClick={(e) => { e.stopPropagation(); void call({ action: "hide", id: p.id, hidden: !p.hidden }); }}>{p.hidden ? "🙈 مخفي" : "👁 ظاهر"}</button>
          <button type="button" className="exbtn pdeye pdask" disabled={busy} onClick={(e) => { e.stopPropagation(); void call({ action: "ask", id: p.id, ask: !p.ask }); }}>{p.ask ? "❓ يسأل" : "🚫 ما يسأل"}</button></td>
      </tr>
      {open && <tr><td colSpan={3} className="expanel"><EditProduct key={`${p.name}|${p.price}|${p.mode}|${catId}`} p={p} cats={cats} catId={catId} close={close} busy={busy} call={call} /></td></tr>}
    </>
  );
}

function ModePicker({ mode, setMode }: { mode: string; setMode: (m: string) => void }) {
  return <div className="seg">{MODES.map(([k, l]) => <button type="button" key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}</div>;
}

function EditProduct({ p, cats, catId, close, busy, call }: { p: Product; cats: Cat[]; catId: number; close: () => void; busy: boolean; call: Call }) {
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(String(p.price));
  const [mode, setMode] = useState(p.mode);
  const [target, setTarget] = useState(catId);
  const same = name.trim() === p.name && price === String(p.price) && mode === p.mode && target === catId;
  return (
    <div>
      <label>اسم المنتج</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      {name.trim() !== p.name && <div className="hint pdhint">⚠️ البوت يعرف الفصل اللي يفتحه المنتج من اسمه. خلي كلمة «امتحانات» واسم الفصل مثل ما هن.</div>}
      <label>السعر بالدينار</label>
      <input className="ltr" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
      <label>نوع الطالب اللي يشوفه</label>
      <ModePicker mode={mode} setMode={setMode} />
      <label>القسم</label>
      <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="exline pdactions">
        <button type="button" className="btn" disabled={busy || same} onClick={async () => { if (await call({ action: "save", id: p.id, name, price, mode, catId: target })) close(); }}>حفظ</button>
        <Confirm label="🗑 حذف المنتج" disabled={busy} onYes={() => void call({ action: "del", id: p.id })} />
      </div>
    </div>
  );
}

function AddProduct({ catId, busy, call }: { catId: number; busy: boolean; call: Call }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState("");
  return (
    <div>
      <div className="exlabel">➕ منتج جديد بهذا القسم</div>
      <div className="exadd">
        <input placeholder="اسم المنتج" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="exnum pdprice" inputMode="numeric" placeholder="السعر" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <ModePicker mode={mode} setMode={(m) => setMode(mode === m ? "" : m)} />
      <div className="exhint">إذا ما تختار، النوع ينعرف من الاسم: «حضوري» أو «إلكتروني»، وغيرها كليهما.</div>
      <button type="button" className="exbtn" disabled={busy || !name.trim() || !price.trim()} onClick={async () => {
        if (await call({ action: "add", catId, name, price, mode })) { setName(""); setPrice(""); setMode(""); }
      }}>➕ إضافة المنتج</button>
    </div>
  );
}

function Bulk({ result, busy, call }: { result: Data; busy: boolean; call: Call }) {
  const [text, setText] = useState("");
  const [show, setShow] = useState(false);
  return (
    <div className="card expad pdbulk">
      <button type="button" className="exqhead" onClick={() => setShow(!show)}><span>📥 إضافة منتجات دفعة وحدة</span><span>{show ? "▲" : "▼"}</span></button>
      {show && (
        <div>
          <div className="exhint">السطر اللي يبدي بعلامة # هو اسم القسم، وتحته كل منتج بسطر: الاسم = السعر</div>
          <textarea className="pdtext" rows={7} placeholder={"# المحاضرات\nالمحاضرة الأولى = 5000\nالمحاضرة الثانية = 5000"} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn" disabled={busy || !text.trim()} onClick={async () => {
            // السطور اللي ما انفهمت تبقى بالمربع حتى تتصلح
            const r = await call({ action: "bulk", text });
            if (r) setText((r.bad ?? []).join("\n"));
          }}>إضافة</button>
          {result.added && <div className="exhint pdresult">✅ تمت إضافة {result.added.length} منتج.</div>}
          {!!result.bad?.length && <div className="exbad pdresult">⚠️ هاي السطور ما انفهمت وما انضافت ({result.bad.length}). صلحها بالمربع وضيفها مرة ثانية.</div>}
        </div>
      )}
    </div>
  );
}
