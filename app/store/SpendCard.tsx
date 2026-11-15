"use client";
// «💰 صرفية الذكاء»: شگد يكلف التصحيح، وشگد تكلف الأسئلة العلمية، وقلم المصحح، كل واحد لحاله
import { useAdminApi } from "./adminPage";

type Row = { key: string; label: string; today: number; month: number; all: number };
type Data = { rows: Row[]; total: { today: number; month: number; all: number }; since: string };
const IQD = 1600;
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const iqd = (n: number) => `${Math.round(n * IQD).toLocaleString("en")} د.ع`;

export default function SpendCard() {
  const { data, error } = useAdminApi<Data>("/api/aispend", "💰 صرفية الذكاء");
  const cell = (n: number) => <td dir="ltr"><b>{usd(n)}</b><br /><small>{iqd(n)}</small></td>;
  return (
    <div className="card expad">
      <div className="exlabel">💰 صرفية الذكاء: كل شي لحاله</div>
      {!data && !error && <div className="empty">جاري التحميل...</div>}
      {error && !data && <div className="exbad">⚠️ {error}</div>}
      {data && (
        <>
          <table className="aig-money">
            <thead><tr><th></th><th>اليوم</th><th>هذا الشهر</th><th>من البداية</th></tr></thead>
            <tbody>
              {data.rows.map((r) => <tr key={r.key}><td>{r.label}</td>{cell(r.today)}{cell(r.month)}{cell(r.all)}</tr>)}
              <tr><td><b>المجموع</b></td>{cell(data.total.today)}{cell(data.total.month)}{cell(data.total.all)}</tr>
            </tbody>
          </table>
          <div className="exhint">
            كله على نفس حساب Anthropic، فحساب Anthropic يطلع المجموع بس. هنا البوت يحسب كل واحد لحاله من عدد التوكنات وسعر الموديل (تقريب، والدينار على {IQD} للدولار).
            {" "}الأسئلة العلمية تشمل قراءة صورة السؤال، والحل على طريقتك، و«🤔 ما فهمت خطوة»، وقراءة أسئلة الامتحانات. اليوم والشهر للأسئلة والقلم ينحسبن من {data.since}.
          </div>
        </>
      )}
    </div>
  );
}
