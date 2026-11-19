"use client";
// الطلبات: البحث برقم وصل الشركة، حساب شركة التوصيل والراجع، الجديدة للطباعة، والمطبوعة
import { useState } from "react";
import { addParts, partsLine, priceReport, type MoneyParts, type PriceLine } from "../../../lib/orderRules.ts";
import { AdminHeader, Confirm, MoneyBreakdown, PriceReport, StatusBar, useAdminApi } from "../adminPage";

type Order = {
  id: number; created: string; name: string; curr: string; place: string; area: string; phone1: string; phone2: string; username: string; userId: number;
  items: { name: string; qty: number; price: number }[]; subtotal: number; fee: number; total: number; printedBy: string; settled: boolean; printed: number;
  coNo: string; ret: boolean; retAt: string; retGot: boolean; retGotAt: string;
};
type Open = { id: number; coNo: string; name: string; total: number; fee: number; parts: MoneyParts; items: { name: string; qty: number; price: number }[] };
type RetLite = { id: number; coNo: string; name: string; retAt: string; retGot: boolean; retGotAt: string; items: string };
type Company = {
  open: Open[]; returns: Order[]; retWaiting: number; retAll: RetLite[];
  last: { id: number; coNo: string; co: number | null } | null;
  archive: { id: number; from: number; to: number; by: string; rets: number | null; n: number; gross: number; fees: number; net: number; created: string; parts: MoneyParts | null }[];
};
/** رقم وصل الشركة كعدد. اللي بيه حروف ما يدخل بالمدى */
const coNum = (co: string) => /^\d{1,15}$/.test(co) ? Number(co) : NaN;
type Data = { fresh: Order[]; printed: Order[]; owner: boolean; company: Company | null; notice: string; allPrices?: PriceLine[] | null; found?: Order[] | null };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
type RowCtl = { busy: boolean; call: Call; company: boolean; copy: (l: string, v: string) => void };
const fmt = (n: number) => n.toLocaleString("en-US");

export default function OrdersClient() {
  const { data, error, busy, call: raw } = useAdminApi<Data>("/api/orders", "🖨 الطلبات");
  const [tab, setTab] = useState<"fresh" | "printed">("fresh");
  const [sel, setSel] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  // كل أمر يرجّع نتيجة البحث المفتوح، حتى تشوف التغيير عليها
  const call: Call = (b) => raw(searched && b.action !== "search" ? { ...b, q: searched } : b);
  const fresh = data?.fresh ?? [];
  const list = tab === "fresh" ? fresh : data?.printed ?? [];
  const live = sel.filter((i) => list.some((o) => o.id === i));
  const toggle = (id: number) => setSel(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(`📋 انتسخ: ${label}`); } catch { setCopied("ما انتسخ. اضغط مطولاً على النص"); }
  }
  const pickTab = (t: "fresh" | "printed") => { setTab(t); setOpen(null); setSel([]); };
  async function search() {
    const s = q.trim();
    if (!s) return;
    if (await raw({ action: "search", q: s })) { setSearched(s); setOpen(null); }
  }
  const ctl: RowCtl = { busy, call, company: !!data?.company, copy };
  const found = searched ? data?.found ?? [] : null;
  return (
    <>
      <AdminHeader title="🖨 طلبات التوصيل" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card">
              <h2>🔍 دوّر على طلب</h2>
              <div className="expad adtop">
                <div className="exhint">اكتب رقم وصل الشركة، أو رقم وصلنا، أو الاسم، أو الهاتف.</div>
                <div className="exline">
                  <input className="ltr" value={q} placeholder="رقم الوصل" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
                  <button type="button" className="exbtn" disabled={busy || !q.trim()} onClick={() => void search()}>🔍 بحث</button>
                  {searched && <button type="button" className="exbtn" onClick={() => { setSearched(""); setQ(""); setOpen(null); }}>✖️</button>}
                </div>
              </div>
              {found && (found.length ? (
                <table className="extable"><tbody>
                  {found.map((o) => <Rows key={o.id} o={o} fresh={false} open={open === -o.id} setOpen={() => setOpen(open === -o.id ? null : -o.id)} ctl={ctl} />)}
                </tbody></table>
              ) : <div className="empty">ما لگيت طلب بـ«{searched}».</div>)}
            </div>
            {data.company && <CompanyCard c={data.company} all={data.allPrices ?? null} busy={busy} call={call} />}
            <div className="chips adtabs">
              <button type="button" className={tab === "fresh" ? "on" : ""} onClick={() => pickTab("fresh")}>🖨 الجديدة ({fresh.length})</button>
              <button type="button" className={tab === "printed" ? "on" : ""} onClick={() => pickTab("printed")}>🗂 {data.owner ? "المطبوعة" : "اللي طبعتها"}</button>
            </div>
            <div className="card">
              {list.length ? (
                <table className="extable"><tbody>
                  {list.map((o) => (
                    <Rows key={o.id} o={o} fresh={tab === "fresh"} pick={{ on: live.includes(o.id), toggle: () => toggle(o.id) }} open={open === o.id} setOpen={() => setOpen(open === o.id ? null : o.id)} ctl={ctl} />
                  ))}
                </tbody></table>
              ) : <div className="empty">{tab === "fresh" ? "✅ كل الطلبات مطبوعة." : "لا توجد طلبات مطبوعة بعد."}</div>}
            </div>
            {!!list.length && (
              <div className="exline adorderbtns">
                <button type="button" className="exbtn" onClick={() => setSel(live.length === list.length ? [] : list.map((o) => o.id))}>{live.length === list.length ? "⬜️ إلغاء التحديد" : "☑️ تحديد الكل"}</button>
                {tab === "fresh" ? (
                  <>
                    <button type="button" className="exbtn" disabled={busy || !live.length} onClick={() => void call({ action: "pdf", ids: live })}>🖨 PDF للمحدد ({live.length})</button>
                    <button type="button" className="exbtn" disabled={busy || !live.length} onClick={async () => { if (await call({ action: "done", ids: live })) setSel([]); }}>✅ تم الطباعة ({live.length})</button>
                  </>
                ) : <button type="button" className="exbtn" disabled={busy || !live.length} onClick={() => void call({ action: "reprint", ids: live })}>🖨 إعادة طباعة المحدد ({live.length})</button>}
              </div>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice || copied} />
    </>
  );
}

function CompanyCard({ c, all, busy, call }: { c: Company; all: PriceLine[] | null; busy: boolean; call: Call }) {
  const [by, setBy] = useState<"" | "co">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [skip, setSkip] = useState<number[]>([]);
  const [show, setShow] = useState(false);
  const [list, setList] = useState(false);
  const [got, setGot] = useState(false);
  const key = (o: { id: number; coNo: string }) => (by === "co" ? coNum(o.coNo) : o.id);
  const nums = c.open.map(key).filter((n) => !Number.isNaN(n));
  const first = nums.length ? Math.min(...nums) : undefined, last = nums.length ? Math.max(...nums) : undefined;
  const a = Number(from || first), b = Number(to || last);
  const within = (o: { id: number; coNo: string }) => { const n = key(o); return n >= a && n <= b; };
  const inRange = c.open.filter(within).sort((x, y) => key(x) - key(y));
  const rows = inRange.filter((o) => !skip.includes(o.id));
  const gross = rows.reduce((s, o) => s + o.total, 0), fees = rows.reduce((s, o) => s + o.fee, 0), net = gross - fees;
  const flip = (id: number) => setSkip(skip.includes(id) ? skip.filter((x) => x !== id) : [...skip, id]);
  const rangeRets = c.retAll.filter(within);
  const noCo = by === "co" ? c.open.filter((o) => Number.isNaN(coNum(o.coNo))).length : 0;
  // وصولات قبل آخر حساب وبعدها ما محاسبة (شلت عنها الصح وقتها)
  const behind = c.last ? c.open.filter((o) => o.id < c.last!.id) : [];
  const waiting = c.returns.filter((o) => !o.retGot), back = c.returns.filter((o) => o.retGot);
  const pickBy = (v: "" | "co") => { setBy(v); setFrom(""); setTo(""); setSkip([]); };
  const label = (o: { id: number; coNo: string }) => (by === "co" ? `الشركة ${o.coNo || "—"} · وصلنا #${o.id}` : `#${o.id}${o.coNo ? ` · الشركة ${o.coNo}` : ""}`);
  return (
    <div className="card">
      <h2>💰 حساب شركة التوصيل</h2>
      <div className="expad adtop">
        <div className="who adnopad">
          {c.last
            ? <>آخر وصل محاسب: <b>#{c.last.id}</b>{c.last.co !== null ? <> (أكبر رقم شركة محاسب: <b>{c.last.co}</b>)</> : null} · من <b>#{c.last.id + 1}</b> بعدك ما محاسبهم.</>
            : <>بعدك ما محاسب الشركة ولا مرة.</>}
          {" "}غير محاسب: <b>{c.open.length}</b> وصل. الراجع ❌ ما ينحسب.
        </div>
        {!!behind.length && <div className="exhint">⚠️ وصولات قبل آخر حساب بعدها ما محاسبة: {behind.map((o) => "#" + o.id).join("، ")}</div>}
      </div>
      {c.open.length || c.retAll.length ? (
        <div className="expad">
          <div className="chips adtabs">
            <button type="button" className={by === "" ? "on" : ""} onClick={() => pickBy("")}>حسب وصلنا</button>
            <button type="button" className={by === "co" ? "on" : ""} onClick={() => pickBy("co")}>حسب وصل الشركة</button>
          </div>
          <div className="adtwo">
            <div><label>من وصل</label><input className="ltr" inputMode="numeric" placeholder={first === undefined ? "" : String(first)} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label>إلى وصل</label><input className="ltr" inputMode="numeric" placeholder={last === undefined ? "" : String(last)} value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          {!!noCo && <div className="exhint">{noCo} وصل غير محاسب ما عليه رقم الشركة، فما يدخل بالمدى حسب وصل الشركة.</div>}
          <div className="adstats adnopadtop adcompany">
            <div><b>{fmt(gross)}</b>المبلغ الكلي ({rows.length})</div>
            <div><b>{fmt(fees)}</b>توصيل (للشركة)</div>
            <div className="adnet"><b>{fmt(net)}</b>لازم يعطوك</div>
          </div>
          <button type="button" className="exbtn" onClick={() => setList(!list)}>🧾 وصل وصل ({rows.length}{skip.length ? ` من ${inRange.length}` : ""})</button>
          {list && (
            <>
              <div className="exhint adtop">شيل الصح عن الوصل اللي الشركة بعدها ما سلمته، يبقى للحساب الجاي.</div>
              <table className="extable"><tbody>
                {inRange.map((o) => (
                  <tr key={o.id} className={"exrow" + (skip.includes(o.id) ? "" : " sel")}>
                    <td className="adpick"><input type="checkbox" aria-label={`حساب ${o.id}`} checked={!skip.includes(o.id)} onChange={() => flip(o.id)} /></td>
                    <td><b>{label(o)}</b><small className="pdmode">{o.name} · الكلي {fmt(o.total)} · التوصيل {fmt(o.fee)}</small></td>
                    <td className="p">{fmt(o.total - o.fee)}</td>
                  </tr>
                ))}
              </tbody></table>
            </>
          )}
          <h3 className="adtop">📦 الراجع بهذا المدى ({rangeRets.length})</h3>
          {rangeRets.length ? rangeRets.map((o) => (
            <label key={o.id} className="adfield">
              <input type="checkbox" checked={o.retGot} disabled={busy} onChange={(e) => void call({ action: "retGot", id: o.id, on: e.target.checked })} />
              <span><b>{label(o)}</b> {o.name}<small className="pdmode">❌ راجع ·{o.retGot ? `✅ استلمته ${o.retGotAt}` : "بعده عند الشركة، أشّر لمن تستلمه"}</small></span>
            </label>
          )) : <div className="exhint">ماكو راجع بهذا المدى.</div>}
          <MoneyBreakdown parts={addParts(rows.map((o) => o.parts))} title="اللي لازم يعطوك مقسم (بدون التوصيل)" />
          <PriceReport lines={priceReport(rows.map((o) => o.items))} title="هذا المدى حسب السعر" />
          <Confirm label={`✅ تم الحساب، استلمت ${fmt(net)}`} disabled={busy || !rows.length} onYes={async () => { if (await call({ action: "settle", by, from: a, to: b, net, skip })) { setFrom(""); setTo(""); setSkip([]); } }} />
        </div>
      ) : <div className="empty">✅ ماكو طلبات غير محاسب عليها ويا الشركة.</div>}
      <div className="expad">
        <h3>📦 الراجع: بعده عند الشركة ({c.retWaiting})</h3>
        {waiting.length ? waiting.map((o) => (
          <div key={o.id} className="adsale adsplit">
            <span><b>#{o.id}{o.coNo ? ` · الشركة ${o.coNo}` : ""}</b> {o.name}<small>❌ راجع من {o.retAt} · {o.items.map((i) => `${i.name} ×${i.qty}`).join("، ")}</small></span>
            <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "retGot", id: o.id, on: true })}>✅ استلمتها</button>
          </div>
        )) : <div className="exhint">ماكو بضاعة راجعة بعدها عند الشركة.</div>}
        {!!back.length && (
          <>
            <button type="button" className="exbtn adtop" onClick={() => setGot(!got)}>✅ الراجع اللي استلمته ({back.length})</button>
            {got && back.map((o) => (
              <div key={o.id} className="adsale"><b>#{o.id}{o.coNo ? ` · الشركة ${o.coNo}` : ""}</b> {o.name}<small>❌ راجع من {o.retAt} · ✅ استلمتها {o.retGotAt}</small></div>
            ))}
          </>
        )}
      </div>
      <div className="expad">
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "allPrices" })}>💵 كل طلبات التوصيل حسب السعر</button>
        {all && (all.length ? <div className="adtop"><PriceReport lines={all} title="كل الطلبات اللي انسلمت للشركة" open /></div> : <div className="exhint adtop">ماكو طلبات مطبوعة بعد.</div>)}
      </div>
      {!!c.archive.length && (
        <div className="expad">
          <button type="button" className="exbtn" onClick={() => setShow(!show)}>🗂 الحسابات السابقة ({c.archive.length})</button>
          {show && c.archive.map((s) => <div key={s.id} className="adsale"><b>{s.by === "co" ? `وصل الشركة ${s.from} إلى ${s.to}` : `#${s.from} إلى #${s.to}`}</b> — استلمت {fmt(s.net)}<small>{s.created} · {s.n} طلب{s.rets ? ` · ${s.rets} راجع` : ""} · الكلي {fmt(s.gross)} · التوصيل {fmt(s.fees)}{s.parts ? ` · ${partsLine(s.parts)}` : ""}</small></div>)}
        </div>
      )}
    </div>
  );
}

/** حالة الطلب ويا الشركة بكلمتين */
const coState = (o: Order) => [
  o.coNo ? `🚚 الشركة ${o.coNo}` : "",
  o.ret ? (o.retGot ? "❌ راجع · ✅ استلمته" : "❌ راجع · بعده عند الشركة") : "",
  o.settled ? "💰 انحسب" : "",
  o.printed === 2 ? "ملغي" : o.printed === 0 ? "جديد" : "",
].filter(Boolean).join(" · ");

function Rows({ o, fresh, pick, open, setOpen, ctl }: {
  o: Order; fresh: boolean; pick?: { on: boolean; toggle: () => void }; open: boolean; setOpen: () => void; ctl: RowCtl;
}) {
  const items = o.items.map((i) => `${i.name} × ${i.qty}`).join("، ");
  const fields: [string, string][] = [["الاسم", o.name], ["المنهج", o.curr], ["المحافظة", o.place], ["المنطقة", o.area], ["الهاتف 1", o.phone1], ["الهاتف 2", o.phone2], ["المنتجات", items], ["المبلغ الكلي", fmt(o.total)]];
  const en = o.curr === "إنجليزي";
  const state = coState(o);
  return (
    <>
      <tr className={"exrow" + (pick?.on || open ? " sel" : "") + (en ? " adenrow" : "")} onClick={setOpen}>
        {pick && <td className="adpick" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${o.id}`} checked={pick.on} onChange={pick.toggle} /></td>}
        <td><b>#{o.id} {o.name}</b>{en && <span className="adentag">ENGLISH</span>}<small className="pdmode">{o.place} · {o.created}{o.printedBy ? ` · طبعه: ${o.printedBy}` : ""}{state ? ` · ${state}` : ""}</small></td>
        <td className="p">{fmt(o.total)}</td>
      </tr>
      {open && (
        <tr><td colSpan={pick ? 3 : 2} className="expanel">
          <button type="button" className="btn agbtn" onClick={() => ctl.copy("الطلب كله", fields.map(([l, v]) => `${l}: ${v}`).join("\n"))}>📋 نسخ الكل</button>
          {fields.map(([l, v]) => (
            <button type="button" key={l} className="adfield" onClick={() => ctl.copy(l, v)}><small>{l}</small><span>{v || "—"}</span><i>📋</i></button>
          ))}
          <div className="exhint adtop">مجموع المنتجات {fmt(o.subtotal)} + التوصيل {fmt(o.fee)}{o.username ? ` · @${o.username}` : ""}</div>
          {o.printed === 1 && <CompanyBox key={o.coNo} o={o} ctl={ctl} />}
          {!fresh && o.printed === 1 && !o.settled && !o.ret && <button type="button" className="exbtn" disabled={ctl.busy} onClick={() => void ctl.call({ action: "back", id: o.id })}>↩️ إرجاع للطلبات الجديدة</button>}
        </td></tr>
      )}
    </>
  );
}

/** رقم وصل الشركة، والمربعين: ❌ راجع (يطلع من الحساب) و✅ استلمت البضاعة */
function CompanyBox({ o, ctl }: { o: Order; ctl: RowCtl }) {
  const [no, setNo] = useState(o.coNo);
  const { busy, call } = ctl;
  return (
    <div className="adtop">
      <label>🚚 رقم وصل الشركة</label>
      <div className="exline">
        <input className="ltr" inputMode="numeric" value={no} placeholder="مثل 10234" onChange={(e) => setNo(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || no.trim() === o.coNo} onClick={() => void call({ action: "coNo", id: o.id, no })}>💾 حفظ</button>
      </div>
      {ctl.company && (
        <div className="adtop">
          <label className="adfield"><input type="checkbox" checked={o.ret} disabled={busy || (o.settled && !o.ret) || o.retGot}
            onChange={(e) => void call({ action: "ret", id: o.id, on: e.target.checked })} /><span>❌ راجع: يطلع من الحساب ويا الشركة{o.retAt ? ` (${o.retAt})` : ""}</span></label>
          {o.ret && <label className="adfield"><input type="checkbox" checked={o.retGot} disabled={busy}
            onChange={(e) => void call({ action: "retGot", id: o.id, on: e.target.checked })} /><span>✅ استلمت البضاعة الراجعة من الشركة{o.retGotAt ? ` (${o.retGotAt})` : ""}</span></label>}
          {o.settled && !o.ret && <div className="exhint">هذا الوصل انحسب ويا الشركة.</div>}
          {o.retGot && <div className="exhint">حتى تشيل ❌، شيل ✅ أول.</div>}
        </div>
      )}
    </div>
  );
}
