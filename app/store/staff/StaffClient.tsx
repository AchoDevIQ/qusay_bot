"use client";
// المساعدين: الصلاحيات، والحساب والدفعات
import Link from "next/link";
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Account = { sold: number; paid: number; owed: number; limit: number; left: number };
type Staff = { id: number; name: string; perms: string[]; account: Account; pays: { id: number; amount: number; created: string }[] };
type Data = { perms: { key: string; label: string }[]; staff: Staff[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function StaffClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/staff", "👥 المساعدين");
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <AdminHeader title="👥 المساعدين والصلاحيات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card">
              <h2>المساعدين: {data.staff.length}</h2>
              {data.staff.length ? (
                <table className="extable"><tbody>
                  {data.staff.map((s) => (
                    <Rows key={s.id} s={s} perms={data.perms} open={open === s.id} toggle={() => setOpen(open === s.id ? null : s.id)} busy={busy} call={call} />
                  ))}
                </tbody></table>
              ) : <div className="empty">لا يوجد مساعدين بعد.</div>}
            </div>
            <Add busy={busy} call={call} />
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Rows({ s, perms, open, toggle, busy, call }: { s: Staff; perms: Data["perms"]; open: boolean; toggle: () => void; busy: boolean; call: Call }) {
  return (
    <>
      <tr className={"exrow" + (open ? " sel" : "")} onClick={toggle}>
        <td><b>👤 {s.name}</b><small className="pdmode">{s.perms.length} صلاحية</small></td>
        <td className="p">{s.account.owed ? `بذمته ${fmt(s.account.owed)}` : ""}</td>
      </tr>
      {open && <tr><td colSpan={2} className="expanel"><Panel key={s.perms.join() + s.name} s={s} perms={perms} busy={busy} call={call} /></td></tr>}
    </>
  );
}

function Panel({ s, perms, busy, call }: { s: Staff; perms: Data["perms"]; busy: boolean; call: Call }) {
  const [name, setName] = useState(s.name);
  const [picked, setPicked] = useState(s.perms);
  const [pay, setPay] = useState("");
  const [limit, setLimit] = useState(String(s.account.limit));
  const a = s.account;
  const same = [...picked].sort().join() === [...s.perms].sort().join();
  return (
    <div>
      <div className="exlabel">الصلاحيات</div>
      {perms.map((p) => (
        <label key={p.key} className="adcheck adflat">
          <input type="checkbox" checked={picked.includes(p.key)} onChange={() => setPicked(picked.includes(p.key) ? picked.filter((x) => x !== p.key) : [...picked, p.key])} />
          <span>{p.label}</span>
        </label>
      ))}
      <button type="button" className="btn adsmallbtn" disabled={busy || same} onClick={() => void call({ action: "perms", id: s.id, perms: picked })}>حفظ الصلاحيات</button>

      <div className="exfoot">
        <div className="exlabel">💰 حساب مبيعاته بنفسه</div>
        <div className="exhint">بس اللي باعه من صفحة البيع بعد ما انضاف مساعد. مبيعات اليوم وشغله بالتفصيل: <Link href="/store/sales" className="adlinkin">🏪 بيع ومبيعات المكتب ← المبيعات</Link></div>
        <div className="adstats adstats2">
          <div><b>{fmt(a.sold)}</b>كل مبيعاته</div><div><b>{fmt(a.paid)}</b>سلمك</div>
          <div><b>{fmt(a.owed)}</b>بذمته</div><div><b>{a.limit ? fmt(a.limit) : "بدون حد"}</b>الرصيد المسموح</div>
        </div>
        <div className="exadd">
          <input placeholder="مبلغ استلمته منه، مثل 10 مليون" value={pay} onChange={(e) => setPay(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !pay.trim()} onClick={async () => { if (await call({ action: "pay", id: s.id, amount: pay })) setPay(""); }}>✅ تسجيل دفعة</button>
        </div>
        <div className="exadd">
          <input aria-label="الرصيد المسموح" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !limit.trim() || limit === String(a.limit)} onClick={() => void call({ action: "limit", id: s.id, amount: limit })}>🎯 حفظ الرصيد (0 بدون حد)</button>
        </div>
        {!!s.pays.length && <div className="exhint">آخر الدفعات: {s.pays.map((p) => `${p.created.slice(0, 10)}: ${fmt(p.amount)}`).join(" · ")}</div>}
      </div>

      <div className="exfoot">
        <div className="exhint">رقم الحساب: {s.id}</div>
        <div className="exadd">
          <input aria-label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === s.name} onClick={() => void call({ action: "rename", id: s.id, name })}>حفظ الاسم</button>
        </div>
        <Confirm label="🗑 حذف المساعد" disabled={busy} onYes={() => void call({ action: "del", id: s.id })} />
      </div>
    </div>
  );
}

function Add({ busy, call }: { busy: boolean; call: Call }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ إضافة مساعد</div>
      <div className="exhint">خلي المساعد يفتح البوت ويكتب <code>/myid</code>، وينطيك الرقم.</div>
      <div className="exhint">🏬 صاحب المكتبة مو مساعد: تضيفه من مربع <Link href="/store/libs" className="adlinkin">المكتبات</Link>، وهو يبيع ويطبع من صفحته.</div>
      <input inputMode="numeric" className="ltr" placeholder="رقم حسابه" value={id} onChange={(e) => setId(e.target.value)} />
      <input placeholder="اسمه" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !id.trim() || !name.trim()} onClick={async () => { if (await call({ action: "add", id, name })) { setId(""); setName(""); } }}>إضافة</button>
    </div>
  );
}
