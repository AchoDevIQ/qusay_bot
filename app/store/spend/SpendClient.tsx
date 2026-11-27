"use client";
// «💰 الصرفية» (طلب الأستاذ 2026-11-23): شگد صرف الذكاء بالمجمل، والأسئلة العلمية والامتحانات كل واحد لحاله، وكل يوم بيومه
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Row = { key: string; label: string; today: number; month: number; all: number };
type Day = { day: string; qa: number; exams: number; board?: number; total: number };
type Data = { rows: Row[]; groups: Row[]; days: Day[]; total: { today: number; month: number; all: number }; since: string };
const IQD = 1600;
// المبلغ الصغير كلش (أقل من 10 دنانير، مثل ترجمة سطر بالسبورة) يبين بكسوره، مو «0» (طلبه 2026-11-27)
const iqd = (n: number) => { const v = n * IQD; return `${v > 0 && v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString("en")} د.ع`; };
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

export default function SpendClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/aispend", "💰 الصرفية");
  const cell = (n: number) => <td dir="ltr"><b>{iqd(n)}</b><br /><small>{usd(n)}</small></td>;
  const table = (rows: Row[], total?: Data["total"]) => (
    <table className="aig-money">
      <thead><tr><th></th><th>اليوم</th><th>هذا الشهر</th><th>من البداية</th></tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.key}><td>{r.label}</td>{cell(r.today)}{cell(r.month)}{cell(r.all)}</tr>)}
        {total && <tr><td><b>المجموع</b></td>{cell(total.today)}{cell(total.month)}{cell(total.all)}</tr>}
      </tbody>
    </table>
  );
  return (
    <>
      <AdminHeader title="💰 الصرفية" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card expad">
              <div className="exlabel">بالمجمل</div>
              {table(data.groups, data.total)}
              <button type="button" className="exbtn" disabled={busy} onClick={() => void call({})}>🔄 حدّث</button>
            </div>
            <div className="card expad">
              <div className="exlabel">كل شي لحاله</div>
              {table(data.rows)}
              <div className="exhint">
                📝 الامتحانات = نظام التصحيح AI (مؤمل) + 🧠 تصحيح قصي + 🖊 قلم المصحح. ❓ الأسئلة العلمية تشمل قراءة صورة السؤال، والحل على طريقتك، و«🤔 ما فهمت خطوة». 🌐 السبورة = زر «🌐 ترجم» بمايك السبورة.
                {" "}كله تقريب من عدد الكلمات وسعر الذكاء، والدولار على {IQD} دينار. اليوم والشهر للأسئلة والقلم ينحسبن من {data.since}.
              </div>
            </div>
            <div className="card expad">
              <div className="exlabel">📅 آخر 30 يوم</div>
              {data.days.length ? (
                <table className="aig-money">
                  <thead><tr><th>اليوم</th><th>❓ الأسئلة</th><th>📝 الامتحانات</th><th>🌐 السبورة</th><th>المجموع</th></tr></thead>
                  <tbody>{data.days.map((d) => <tr key={d.day}><td dir="ltr">{d.day.slice(5)}</td><td dir="ltr">{iqd(d.qa)}</td><td dir="ltr">{iqd(d.exams)}</td><td dir="ltr">{iqd(d.board ?? 0)}</td><td dir="ltr"><b>{iqd(d.total)}</b></td></tr>)}</tbody>
                </table>
              ) : <div className="empty">ماكو صرفية بآخر 30 يوم.</div>}
            </div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
