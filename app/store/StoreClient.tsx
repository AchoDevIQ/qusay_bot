"use client";
import { useState } from "react";
import {
  AR_NAME_ERR, CURR_OPTS, Err, type Errs, PhoneInput, SIDE_OPTS, Seg, cleanName, cleanPhone, fmt, haptic, nameOk, phoneErr, scrollToFirst, sendToBot, useBotData,
} from "./shared";

type Item = [number, string, number];
type Data = {
  c: [string, Item[]][]; g: string[]; f: number[]; w?: string[];
  p?: { n?: string; cu?: string; g?: string; s?: string; a?: string; p1?: string; p2?: string };
};

export default function StoreClient() {
  const D = useBotData<Data>({ c: [], g: [], f: [] });
  return D ? <Store D={D} /> : null;
}

function Store({ D }: { D: Data }) {
  const P = D.p;
  const locked = !!P;   // المسجل: معلوماته مقفولة
  const prod = new Map(D.c.flatMap(([, items]) => items.map(([id, n, p]) => [id, { n, p }] as const)));
  const [cart, setCart] = useState<Record<number, number>>({});
  const [page, setPage] = useState(1);
  const [name, setName] = useState(P?.n ?? "");
  const [curr, setCurr] = useState(P?.cu ?? "");
  const [gov, setGov] = useState(P?.g ?? "");
  const [side, setSide] = useState(P?.s ?? "");
  const [area, setArea] = useState(P?.a ?? "");
  const [ph1, setPh1] = useState(P?.p1 ?? "");
  const [ph2, setPh2] = useState(P?.p2 ?? "");
  const [errs, setErrs] = useState<Errs>({});

  const entries = Object.entries(cart).map(([id, q]) => [Number(id), q] as const);
  const sub = entries.reduce((s, [id, q]) => s + prod.get(id)!.p * q, 0);
  const govIdx = D.g.indexOf(gov);
  const fee = govIdx < 0 ? 0 : D.f[govIdx];

  function chg(id: number, d: number) {
    setCart((c) => {
      const q = Math.max(0, (c[id] ?? 0) + d);
      const next = { ...c };
      if (q) next[id] = q; else delete next[id];
      return next;
    });
    haptic();
  }
  function go(p: number) { setPage(p); window.scrollTo(0, 0); }
  function onGov(g: string) {
    setGov(g);
    if (g !== "بغداد") setSide("");
  }
  function submit() {
    if (page === 1) return go(2);
    const e: Errs = {};
    const n = cleanName(name);
    if (!nameOk(n)) e.name = AR_NAME_ERR;
    if (!curr) e.curr = "اختر المنهج";
    if (!gov) e.gov = "اختر المحافظة";
    if (gov === "بغداد" && !side) e.side = "اختر الرصافة أو الكرخ";
    if (area.trim().length < 2) e.area = "اكتب اسم المنطقة";
    const p1 = cleanPhone(ph1), p2 = cleanPhone(ph2);
    const a = phoneErr(p1), b = phoneErr(p2);
    if (a) e.ph1 = a;
    if (b) e.ph2 = b; else if (p1 === p2) e.ph2 = "الرقم الثاني لازم يختلف عن الأول";
    setErrs(e);
    if (scrollToFirst(e)) return;
    sendToBot({ n, cu: curr, g: gov, s: side, a: area.trim(), p1, p2, i: entries.map(([id, q]) => [id, q]), t: sub + fee });
  }

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>متجر قصي العميري</h1>
        <p>الرياضيات · السادس الإعدادي</p>
        <div className="steps">
          <span className={page === 1 ? "on" : ""}>1  اختر المنتجات</span>
          <span className={page === 2 ? "on" : ""}>2  معلوماتك</span>
        </div>
      </header>

      <div className="wrap">
        <section className={page === 1 ? "" : "hide"}>
          {!D.c.length && <div className="empty">لا توجد منتجات حاليا.</div>}
          {!!D.w?.length && <div className="card warn">⚠️ <b>تنبيه:</b> امتحانات <b>{D.w.join("، ")}</b> <b>إلكترونية فقط</b>.</div>}
          {D.c.map(([cname, items]) => (
            <div className="card" key={cname}>
              <h2>📂 {cname}</h2>
              <table><tbody>
                <tr><th>المنتج</th><th className="p">السعر</th><th className="q">الكمية</th></tr>
                {items.map(([id, n, p]) => (
                  <tr key={id} className={cart[id] ? "sel" : ""}>
                    <td>{n}</td><td className="p">{fmt(p)}</td>
                    <td className="q"><span className="qty">
                      <button type="button" onClick={() => chg(id, -1)}>−</button>
                      <b>{cart[id] ?? 0}</b>
                      <button type="button" className="add" onClick={() => chg(id, 1)}>+</button>
                    </span></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          ))}
        </section>

        <section className={page === 2 ? "" : "hide"}>
          <div className="card">
            <h2>📝 معلومات الطلب</h2>
            <div className="form">
              {locked && (
                <div className="warn locked">
                  🔒 هاي معلوماتك المسجلة، ولتغييرها تواصل ويا قصي العميري.<br />
                  📞 <b>أرقام الهاتف</b> تگدر تغيرها لهذا الطلب بس، إذا تريد الطلب يوصل على رقم ثاني.
                </div>
              )}
              <label>الاسم الرباعي</label>
              <input placeholder="بالعربي، مثال: علي حسن محمد كاظم" autoComplete="off" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} />
              <Err id="name" errs={errs} />

              <label>المنهج</label>
              <Seg options={CURR_OPTS} value={curr} onPick={setCurr} disabled={locked} />
              <Err id="curr" errs={errs} />

              <label>المحافظة</label>
              <select value={gov} disabled={locked} onChange={(e) => onGov(e.target.value)}>
                <option value="">اختر المحافظة</option>
                {D.g.map((g, i) => <option key={g} value={g}>{g + "  —  توصيل " + fmt(D.f[i])}</option>)}
              </select>
              <Err id="gov" errs={errs} />

              <div className={gov === "بغداد" ? "" : "hide"}>
                <label>الجانب</label>
                <Seg options={SIDE_OPTS} value={side} onPick={setSide} disabled={locked} />
                <Err id="side" errs={errs} />
              </div>

              <label>المنطقة</label>
              <input placeholder="اسم المنطقة" autoComplete="off" value={area} disabled={locked} onChange={(e) => setArea(e.target.value)} />
              <Err id="area" errs={errs} />

              <label>رقم الهاتف الأول (بالأرقام الإنجليزية)</label>
              <PhoneInput id="ph1" value={ph1} onChange={setPh1} errs={errs} setErrs={setErrs} />

              <label>رقم الهاتف الثاني (بالأرقام الإنجليزية)</label>
              <PhoneInput id="ph2" value={ph2} onChange={setPh2} errs={errs} setErrs={setErrs} />
            </div>
          </div>

          <div className="card sumbox">
            <h2>🧾 ملخص الطلب</h2>
            <table><tbody>
              <tr><th>المنتج</th><th className="p">العدد</th><th className="p">السعر</th></tr>
              {entries.map(([id, q]) => <tr key={id}><td>{prod.get(id)!.n}</td><td className="p">{q}</td><td className="p">{fmt(prod.get(id)!.p * q)}</td></tr>)}
              <tr><td colSpan={2}>مجموع المنتجات</td><td className="p">{fmt(sub)}</td></tr>
              <tr><td colSpan={2}>التوصيل{gov ? ` (${gov})` : ""}</td><td className="p">{gov ? fmt(fee) : "اختر المحافظة"}</td></tr>
              <tr className="tot"><td colSpan={2}>💰 المبلغ الكلي</td><td className="p">{fmt(sub + fee)}</td></tr>
            </tbody></table>
            <div className="note">⚠️ <b>للتذكير:</b> جميع المشتريات <b>غير قابلة للإرجاع إطلاقاً ولأي سبب كان</b>.</div>
          </div>
        </section>
      </div>

      <div className="bar"><div className="in">
        <div className="sum">
          <small>{page === 1 ? "مجموع المنتجات" : "المبلغ الكلي" + (fee ? " مع التوصيل" : "")}</small>
          <strong>{fmt(page === 1 ? sub : sub + fee)}</strong>
        </div>
        {page === 2 && <button type="button" className="btn ghost" onClick={() => go(1)}>رجوع</button>}
        <button type="button" className="btn" disabled={page === 1 && sub === 0} onClick={submit}>{page === 1 ? "التالي" : "تأكيد وإرسال الطلب"}</button>
      </div></div>
    </>
  );
}
