"use client";
// المساعدين: الصلاحيات، والحساب والدفعات
import Link from "next/link";
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Account = { sold: number; paid: number; owed: number; limit: number; left: number };
type Rate = { mandatory: number; optional: number; deduct: number };
type Topic = { id: number; title: string; chapter: string };
type Grade = { chapters: string[]; off: number[]; rate: Rate; mand: number; opt: number; obj: number; amount: number; archive: { id: number; mand: number; opt: number; obj: number; forgiven?: boolean; amount: number; created: string }[] };
type Staff = { id: number; name: string; perms: string[]; account: Account; grade: Grade | null; pays: { id: number; amount: number; created: string }[] };
type Data = { chapters: string[]; topics: Topic[]; perms: { key: string; label: string }[]; staff: Staff[]; notice: string };
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
                    <Rows key={s.id} s={s} perms={data.perms} chapters={data.chapters} topics={data.topics} open={open === s.id} toggle={() => setOpen(open === s.id ? null : s.id)} busy={busy} call={call} />
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

function Rows({ s, perms, chapters, topics, open, toggle, busy, call }: { s: Staff; perms: Data["perms"]; chapters: string[]; topics: Topic[]; open: boolean; toggle: () => void; busy: boolean; call: Call }) {
  const g = s.grade;
  return (
    <>
      <tr className={"exrow" + (open ? " sel" : "")} onClick={toggle}>
        <td><b>👤 {s.name}</b><small className="pdmode">{s.perms.length} صلاحية</small>
          {s.account.owed ? <small className="pdmode">بذمته {fmt(s.account.owed)}</small> : null}
        </td>
        <td className="p">
          {/* اللي إله على التصحيح: يطلع برا، والدفع يصفره */}
          {g && (
            <div className="stwallet" onClick={(e) => e.stopPropagation()}>
              <b>💰 {fmt(g.amount)} د</b>
              <small>{g.mand + g.opt} ورقة{g.obj ? ` · ${g.obj} اعتراض` : ""}</small>
              <PayGrader g={g} short busy={busy} pay={(forgive) => void call({ action: "gradePay", id: s.id, forgive })} />
            </div>
          )}
        </td>
      </tr>
      {open && <tr><td colSpan={2} className="expanel"><Panel key={s.perms.join() + s.name + JSON.stringify(g?.rate) + g?.chapters.join() + g?.off.join()} s={s} perms={perms} chapters={chapters} topics={topics} busy={busy} call={call} /></td></tr>}
    </>
  );
}

function Panel({ s, perms, chapters, topics, busy, call }: { s: Staff; perms: Data["perms"]; chapters: string[]; topics: Topic[]; busy: boolean; call: Call }) {
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
      {s.grade && <GradeWallet s={s} g={s.grade} chapters={chapters} topics={topics} busy={busy} call={call} />}

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

/** محفظة التصحيح: تفاصيل اللي إله، وفصوله، وأجره، والدفعات السابقة */
/** الدفع: إذا عليه اعتراضات انقبلت، صاحب البوت يختار يخصمها لو يسامحه بيها */
function PayGrader({ g, short, busy, pay }: { g: Grade; short?: boolean; busy: boolean; pay: (forgive: boolean) => void }) {
  if (!g.mand && !g.opt && !g.obj) return null;
  if (!g.obj) return <Confirm label={short ? "💵 دفع" : `💵 دفع ${fmt(g.amount)} دينار وتصفير`} disabled={busy} onYes={() => pay(false)} />;
  const full = g.amount + g.obj * g.rate.deduct;
  return (
    <>
      <small className="exhint">عليه {g.obj} اعتراض انقبل. تخصمها؟</small>
      <Confirm label={`✂️ دفع ${fmt(g.amount)} ويا الخصم`} disabled={busy} onYes={() => pay(false)} />
      <Confirm label={`🤝 دفع ${fmt(full)} بدون خصم`} disabled={busy} onYes={() => pay(true)} />
    </>
  );
}

function GradeWallet({ s, g, chapters, topics, busy, call }: { s: Staff; g: Grade; chapters: string[]; topics: Topic[]; busy: boolean; call: Call }) {
  const [rate, setRate] = useState(g.rate);
  const [chs, setChs] = useState<string[]>(g.chapters.length ? g.chapters : chapters);
  const [off, setOff] = useState<number[]>(g.off);
  // مواضيع الفصول المختارة: كلها مأشرة، وصاحب البوت يشيل منها
  const shown = chs.length ? chs : chapters;
  const num = (k: keyof Rate, label: string) => (
    <label className="stfield">{label}
      <input type="number" inputMode="numeric" className="ltr" min={0} value={rate[k]} onChange={(e) => setRate({ ...rate, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
    </label>
  );
  return (
    <div className="exfoot">
      <div className="exlabel">✍️ محفظة التصحيح</div>
      <div className="adstats adstats2">
        <div><b>{g.mand}</b>ورقة إجبارية × {fmt(g.rate.mandatory)}</div>
        <div><b>{g.opt}</b>ورقة اختيارية × {fmt(g.rate.optional)}</div>
        <div><b>{g.obj}</b>اعتراض انقبل − {fmt(g.rate.deduct)}</div>
        <div><b>{fmt(g.amount)}</b>إله هسه (دينار)</div>
      </div>
      <PayGrader g={g} busy={busy} pay={(forgive) => void call({ action: "gradePay", id: s.id, forgive })} />
      <div className="exlabel adtop">الفصول اللي يصححها</div>
      <div className="seg wrap2">
        {chapters.map((c) => <button type="button" key={c} className={chs.includes(c) ? "on" : ""} onClick={() => setChs(chs.includes(c) ? chs.filter((x) => x !== c) : [...chs, c])}>{c}</button>)}
      </div>
      {!chs.length && <div className="exhint">إذا ما تختار ولا فصل، يصحح كل الفصول.</div>}
      <div className="exlabel adtop">المواضيع داخل فصوله</div>
      <div className="exhint">كلها مأشرة. شيل الصح من الموضوع اللي ما تريده يصححه.</div>
      {shown.map((c) => {
        const list = topics.filter((t) => t.chapter === c);
        const offHere = list.filter((t) => off.includes(t.id)).length;
        return (
          <details key={c} className="sttopics">
            <summary>{c} <small>({list.length - offHere} من {list.length})</small></summary>
            {list.map((t) => (
              <label key={t.id} className="adcheck adflat">
                <input type="checkbox" checked={!off.includes(t.id)} onChange={() => setOff(off.includes(t.id) ? off.filter((x) => x !== t.id) : [...off, t.id])} />
                <span>{t.title}</span>
              </label>
            ))}
          </details>
        );
      })}
      {num("mandatory", "أجر الورقة الإجبارية (دينار)")}
      {num("optional", "أجر الورقة الاختيارية (دينار)")}
      {num("deduct", "خصم كل اعتراض ينقبل على ورقته (دينار)")}
      <div className="exhint">الأجر الجديد ينحسب على الأوراق اللي بعدها ما اندفعت.</div>
      <button type="button" className="btn adsmallbtn" disabled={busy} onClick={() => void call({ action: "gradeRate", id: s.id, ...rate, chapters: chs, off: off.filter((x) => topics.some((t) => t.id === x && shown.includes(t.chapter))) })}>💾 حفظ الفصول والمواضيع والأجور</button>
      {!!g.archive.length && <div className="exhint">الدفعات السابقة: {g.archive.map((a) => `${a.created.slice(0, 10)}: ${fmt(a.amount)} (${a.mand + a.opt} ورقة${a.obj ? `، ${a.obj} اعتراض ${a.forgiven ? "بدون خصم" : "انخصم"}` : ""})`).join(" · ")}</div>}
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
