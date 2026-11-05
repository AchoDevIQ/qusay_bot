"use client";
// صفحة أسعار التوصيل: تعدل أي عدد من المحافظات، وتحفظهن مرة وحدة
import { useState } from "react";
import { Confirm, useAdminApi } from "../adminPage";

type Data = { fees: { gov: string; fee: number }[] };

export default function FeesClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/fees", "🚚 أسعار التوصيل");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [all, setAll] = useState("");
  const [saved, setSaved] = useState("");
  const changed = Object.fromEntries(Object.entries(draft).filter(([gov, v]) => v !== String(data?.fees.find((f) => f.gov === gov)?.fee)));
  const n = Object.keys(changed).length;

  async function save() {
    if (await call({ action: "save", fees: changed })) { setDraft({}); setSaved(`✅ انحفظ سعر ${n} محافظة`); }
  }
  async function saveAll() {
    if (await call({ action: "all", value: all })) { setDraft({}); setAll(""); setSaved("✅ انحفظ السعر لكل المحافظات"); }
  }
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>🚚 أسعار التوصيل</p>
      </header>
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card expad exgeneral">
              <div className="exlabel">💲 نفس السعر لكل المحافظات</div>
              <div className="exline">
                <input className="exnum" inputMode="numeric" placeholder="السعر" value={all} onChange={(e) => { setAll(e.target.value); setSaved(""); }} />
                <Confirm label="تطبيق على الكل" disabled={busy || !all.trim()} onYes={() => void saveAll()} />
              </div>
            </div>
            <div className="card">
              <h2>🚚 سعر كل محافظة بالدينار</h2>
              <table className="extable"><tbody>
                {data.fees.map(({ gov, fee }) => {
                  const value = draft[gov] ?? String(fee);
                  return (
                    <tr key={gov} className={gov in changed ? "sel" : ""}>
                      <td><b>{gov}</b></td>
                      <td className="fdcell">
                        <input className="ltr fdinput" aria-label={`سعر ${gov}`} inputMode="numeric" value={value} onChange={(e) => { setDraft({ ...draft, [gov]: e.target.value }); setSaved(""); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </>
        )}
      </div>
      {data && (
        <div className="bar"><div className="in">
          <div className="sum">
            {error ? <small className="exbad">⚠️ {error}</small>
              : busy ? <small>جاري الحفظ...</small>
              : saved ? <small className="fdok">{saved}</small>
              : <small>{n ? `تغيرت ${n} محافظة، لسه ما انحفظت` : "غير السعر، وبعدها اضغط حفظ"}</small>}
          </div>
          <button type="button" className="btn" disabled={busy || !n} onClick={() => void save()}>حفظ</button>
        </div></div>
      )}
    </>
  );
}
