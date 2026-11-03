"use client";
import { useState } from "react";
import { fmt, haptic, sendToBot, useBotData } from "../shared";

type Item = [number, string, number];
type Data = { c: [string, Item[]][]; s: { id?: number; n?: string; p?: string; g?: string } };

export default function PosClient() {
  const D = useBotData<Data>({ c: [], s: {} });
  return D ? <Pos D={D} /> : null;
}

function Pos({ D }: { D: Data }) {
  const prod = new Map(D.c.flatMap(([, items]) => items.map(([id, n, p]) => [id, { n, p }] as const)));
  const [cart, setCart] = useState<Record<number, number>>({});
  const [catIdx, setCatIdx] = useState(-1);

  const entries = Object.entries(cart).map(([id, q]) => [Number(id), q] as const);
  const total = entries.reduce((s, [id, q]) => s + prod.get(id)!.p * q, 0);

  function chg(id: number, d: number) {
    setCart((c) => {
      const q = Math.max(0, (c[id] ?? 0) + d);
      const next = { ...c };
      if (q) next[id] = q; else delete next[id];
      return next;
    });
    haptic();
  }

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>🏪 بيع بالمكتب · بدون توصيل</p>
      </header>
      <div className="wrap">
        <div className="card">
          <h2>👤 الطالب</h2>
          <div className="who"><b>{D.s.n ?? ""}</b><br />📞 {D.s.p ?? ""}{D.s.g ? " · " + D.s.g : ""}</div>
        </div>
        <div className="chips">
          <button type="button" className={catIdx === -1 ? "on" : ""} onClick={() => setCatIdx(-1)}>الكل</button>
          {D.c.map((c, i) => <button type="button" key={c[0]} className={catIdx === i ? "on" : ""} onClick={() => setCatIdx(i)}>{c[0]}</button>)}
        </div>
        <section>
          {D.c.map(([cname, items], i) => (catIdx >= 0 && catIdx !== i ? null : (
            <div className="card" key={cname}>
              <h2>📂 {cname}</h2>
              <table><tbody>
                <tr><th>المنتج</th><th className="p">السعر</th><th className="q">العدد</th></tr>
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
          )))}
        </section>
        {!!entries.length && (
          <div className="card sumbox">
            <h2>🧾 الفاتورة</h2>
            <table><tbody>
              <tr><th>المنتج</th><th className="p">العدد</th><th className="p">السعر</th></tr>
              {entries.map(([id, q]) => <tr key={id}><td>{prod.get(id)!.n}</td><td className="p">{q}</td><td className="p">{fmt(prod.get(id)!.p * q)}</td></tr>)}
              <tr className="tot"><td colSpan={2}>💰 المجموع</td><td className="p">{fmt(total)}</td></tr>
            </tbody></table>
          </div>
        )}
      </div>
      <div className="bar"><div className="in">
        <div className="sum"><small>المجموع (بدون توصيل)</small><strong>{fmt(total)}</strong></div>
        <button type="button" className="btn" disabled={!total}
          onClick={() => sendToBot({ k: "pos", sid: D.s.id, i: entries.map(([id, q]) => [id, q]), t: total })}>✅ تم البيع</button>
      </div></div>
    </>
  );
}
