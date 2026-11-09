"use client";
// المكتبات: المبيعات، المحاسبة، الأرشيف، والحسابات
import { useState } from "react";
import { partsLine, type MoneyParts } from "../../../lib/orderRules.ts";
import { AdminHeader, Confirm, MoneyBreakdown, StatusBar, useAdminApi } from "../adminPage";

type Tot = { n: number; total: number };
type Office = {
  id: number; name: string; lim: number; today: Tot; yesterday: Tot; open: Tot & { parts: MoneyParts }; settled: number;
  users: { id: number; name: string }[]; archive: { id: number; amount: number; n: number; created: string; parts: MoneyParts | null }[];
};
type Sale = { id: number; time: string; name: string; total: number; items: string };
type Data = {
  today: string; offices: Office[]; notice: string; openId?: number;
  sales?: { officeId: number; title: string; rows: Sale[]; parts: MoneyParts }; invite?: { officeId: number; code: string; link: string };
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function LibsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/libs", "🏬 المكتبات");
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState("");
  return (
    <>
      <AdminHeader title="🏬 المكتبات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            {data.offices.map((o) => (
              <div className="card" key={o.id}>
                <button type="button" className="adchapter" onClick={() => setOpen(open === o.id ? null : o.id)}>
                  <span>🏪 {o.name}</span><small>اليوم: {fmt(o.today.total)} {open === o.id ? "▲" : "▼"}</small>
                </button>
                {open === o.id && <Panel key={o.name + o.lim} o={o} data={data} busy={busy} call={call} />}
              </div>
            ))}
            {!data.offices.length && <div className="empty">ما أكو مكتبات بعد.</div>}
            <div className="card expad adform">
              <div className="exlabel">➕ مكتبة جديدة</div>
              <input placeholder="اسم المكتبة" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="button" className="btn" disabled={busy || !name.trim()} onClick={async () => {
                const r = await call({ action: "add", name });
                if (r) { setName(""); setOpen(r.openId ?? null); }
              }}>إضافة</button>
            </div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Panel({ o, data, busy, call }: { o: Office; data: Data; busy: boolean; call: Call }) {
  const [name, setName] = useState(o.name);
  const [lim, setLim] = useState(String(o.lim));
  const [uid, setUid] = useState("");
  const [uname, setUname] = useState("");
  const [kind, setKind] = useState("today");
  const sales = data.sales?.officeId === o.id ? data.sales : null;
  const invite = data.invite?.officeId === o.id ? data.invite : null;
  const show = (k: string) => { setKind(k); void call({ action: "sales", id: o.id, kind: k }); };
  return (
    <div className="form">
      <div className="adstats adstats2 adnopad">
        <div><b>{fmt(o.today.total)}</b>اليوم ({o.today.n})</div><div><b>{fmt(o.yesterday.total)}</b>البارحة ({o.yesterday.n})</div>
        <div><b>{fmt(o.open.total)}</b>غير محاسب ({o.open.n})</div><div><b>{fmt(o.settled)}</b>تحاسبتوا عليه</div>
      </div>
      <MoneyBreakdown parts={o.open.parts} title="غير المحاسب مقسم" />
      {!!o.open.n && <div className="exline"><Confirm label={`✅ استلمت ${fmt(o.open.total)}: تمت المحاسبة`} disabled={busy} onYes={() => void call({ action: "settle", id: o.id, amount: o.open.total })} /></div>}

      <div className="exfoot">
        <div className="exlabel">📊 المبيعات</div>
        <div className="exline">
          <button type="button" className="exbtn" disabled={busy} onClick={() => show("today")}>اليوم</button>
          <button type="button" className="exbtn" disabled={busy} onClick={() => show("yesterday")}>البارحة</button>
          <button type="button" className="exbtn" disabled={busy} onClick={() => show("open")}>غير المحاسب عليها</button>
        </div>
        {sales && (
          <>
            <div className="exhint">{sales.title} · {sales.rows.length} بيعة</div>
            <MoneyBreakdown parts={sales.parts} />
            {sales.rows.map((r) => <div key={r.id} className="adsale"><b>#{r.id} · {fmt(r.total)}</b> {r.name}<small>{r.time} · {r.items}</small></div>)}
            {!!sales.rows.length && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "pdf", id: o.id, kind })}>📄 PDF</button>}
          </>
        )}
      </div>

      {!!o.archive.length && (
        <div className="exfoot">
          <div className="exlabel">🗂 الأرشيف</div>
          {o.archive.map((s) => (
            <div key={s.id} className="adsale adsplit">
              <span>{s.created.slice(0, 10)} · <b>{fmt(s.amount)}</b> ({s.n}){s.parts && <small>{partsLine(s.parts)}</small>}</span>
              <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "settlePdf", id: s.id })}>📄</button>
            </div>
          ))}
        </div>
      )}

      <div className="exfoot">
        <div className="exlabel">👥 الحسابات</div>
        {o.users.map((u) => (
          <div key={u.id} className="adsale adsplit">
            <span>{u.name}</span>
            <Confirm label="🗑" disabled={busy} onYes={() => void call({ action: "delUser", user: u.id })} />
          </div>
        ))}
        {!o.users.length && <div className="exhint">ما أكو حساب. ضيف حساب حتى يبيع.</div>}
        <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "invite", id: o.id })}>🔗 رابط ورمز انضمام جديد</button>
        {invite && (
          <div className="adinvite">
            <div className="exhint">دز الرابط لصاحب المكتبة، أو خليه يكتب الرمز بالبوت. يشتغلون مرة وحدة وخلال 3 أيام.</div>
            <a href={invite.link} className="adlink">{invite.link}</a>
            <div>الرمز: <b className="adcode">{invite.code}</b></div>
            <a className="exbtn" href={"https://t.me/share/url?url=" + encodeURIComponent(invite.link)} target="_blank" rel="noreferrer">📤 مشاركة الرابط</a>
          </div>
        )}
        <div className="exhint adtop">أو ضيفه برقم حسابه:</div>
        <div className="exadd">
          <input inputMode="numeric" className="ltr" placeholder="رقم الحساب" value={uid} onChange={(e) => setUid(e.target.value)} />
          <input placeholder="اسمه" value={uname} onChange={(e) => setUname(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !uid.trim() || !uname.trim()} onClick={async () => { if (await call({ action: "addUser", id: o.id, user: uid, name: uname })) { setUid(""); setUname(""); } }}>إضافة</button>
        </div>
      </div>

      <div className="exfoot">
        <div className="exlabel">⚙️ الإعدادات</div>
        <div className="exadd">
          <input aria-label="اسم المكتبة" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === o.name} onClick={() => void call({ action: "rename", id: o.id, name })}>حفظ الاسم</button>
        </div>
        <div className="exadd">
          <input aria-label="الرصيد المسموح" value={lim} onChange={(e) => setLim(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !lim.trim() || lim === String(o.lim)} onClick={() => void call({ action: "limit", id: o.id, amount: lim })}>🎯 حفظ الرصيد (0 بدون حد)</button>
        </div>
        <Confirm label="🗑 حذف المكتبة" disabled={busy} onYes={() => void call({ action: "del", id: o.id })} />
      </div>
    </div>
  );
}
