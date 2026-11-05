"use client";
// صفحة المراكز الامتحانية ونوع الامتحان لكل محافظة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Center = { id: number; name: string; gender: string; n: number };
type Area = { id: number; gov: string; name: string; centers: Center[] };
type Data = { govs: string[]; modes: { gov: string; mode: string }[]; areas: Area[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const MODES: [string, string][] = [["in", "🏫 حضوري بس"], ["online", "💻 إلكتروني بس"], ["both", "🔄 الطالب يختار"]];

export default function CentersClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/centers", "🏫 المراكز الامتحانية");
  const [tab, setTab] = useState<"centers" | "modes">("centers");
  return (
    <>
      <AdminHeader title="🏫 المراكز الامتحانية" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="chips adtabs">
              <button type="button" className={tab === "centers" ? "on" : ""} onClick={() => setTab("centers")}>🏫 المراكز</button>
              <button type="button" className={tab === "modes" ? "on" : ""} onClick={() => setTab("modes")}>🗺 نوع الامتحان</button>
            </div>
            {tab === "centers" && (
              <>
                {data.areas.map((a) => <AreaCard key={a.id} area={a} busy={busy} call={call} />)}
                {!data.areas.length && <div className="empty">لسه ماكو مناطق.</div>}
                <AddArea govs={data.govs} busy={busy} call={call} />
              </>
            )}
            {tab === "modes" && (
              <div className="card">
                <h2>🗺 نوع الامتحان لكل محافظة</h2>
                <table className="extable"><tbody>
                  {data.modes.map((m) => (
                    <tr key={m.gov}>
                      <td><b>{m.gov}</b></td>
                      <td className="admode">
                        <select aria-label={`نوع امتحان ${m.gov}`} value={m.mode} disabled={busy} onChange={(e) => void call({ action: "mode", gov: m.gov, mode: e.target.value })}>
                          {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function AreaCard({ area, busy, call }: { area: Area; busy: boolean; call: Call }) {
  const [name, setName] = useState(area.name);
  const [show, setShow] = useState(false);
  const [newC, setNewC] = useState("");
  const total = area.centers.reduce((s, c) => s + c.n, 0);
  return (
    <div className="card">
      <h2>📍 {area.name} <small className="adsmall">({area.gov}) · {total} طالب</small></h2>
      {area.centers.length ? (
        <table className="extable"><tbody>
          {area.centers.map((c) => <CenterRow key={c.id + c.name} c={c} busy={busy} call={call} />)}
        </tbody></table>
      ) : <div className="empty">هاي المنطقة بدون مراكز، والطالب ما يشوفها.</div>}
      <div className="expad">
        <div className="exadd">
          <input placeholder="اسم مركز جديد" value={newC} onChange={(e) => setNewC(e.target.value)} />
          <button type="button" className="exbtn" disabled={busy || !newC.trim()} onClick={async () => { if (await call({ action: "addCenter", id: area.id, name: newC })) setNewC(""); }}>➕ إضافة مركز</button>
        </div>
        <button type="button" className="exmove" onClick={() => setShow(!show)}>{show ? "▲ إخفاء" : "⚙️ تعديل المنطقة"}</button>
        {show && (
          <div className="exfoot">
            <div className="exadd">
              <input aria-label="اسم المنطقة" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === area.name} onClick={() => void call({ action: "renameArea", id: area.id, name })}>حفظ الاسم</button>
            </div>
            <Confirm label="🗑 حذف المنطقة ومراكزها" disabled={busy} onYes={() => void call({ action: "delArea", id: area.id })} />
          </div>
        )}
      </div>
    </div>
  );
}

function CenterRow({ c, busy, call }: { c: Center; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(c.name);
  return (
    <>
      <tr className={"exrow" + (open ? " sel" : "")} onClick={() => setOpen(!open)}>
        <td><b>🏫 {c.name}</b>{c.gender && <small className="pdmode">{c.gender} فقط</small>}</td><td className="p">{c.n} طالب</td>
      </tr>
      {open && (
        <tr><td colSpan={2} className="expanel">
          <div className="exadd">
            <input aria-label="اسم المركز" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="exbtn" disabled={busy || !name.trim() || name.trim() === c.name} onClick={() => void call({ action: "renameCenter", id: c.id, name })}>حفظ الاسم</button>
          </div>
          <div className="exline">
            <span>يطلع لـ:</span>
            <select className="exnum adwide" aria-label="بنين أو بنات" disabled={busy} value={c.gender} onChange={(e) => void call({ action: "centerGender", id: c.id, gender: e.target.value })}>
              <option value="">الكل</option><option value="بنين">بنين فقط</option><option value="بنات">بنات فقط</option>
            </select>
          </div>
          <div className="exline">
            <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "pdf", id: c.id })}>📄 قائمة طلابه</button>
            <Confirm label="🗑 حذف المركز" disabled={busy} onYes={() => void call({ action: "delCenter", id: c.id })} />
          </div>
        </td></tr>
      )}
    </>
  );
}

function AddArea({ govs, busy, call }: { govs: string[]; busy: boolean; call: Call }) {
  const [gov, setGov] = useState("");
  const [name, setName] = useState("");
  const [center, setCenter] = useState("");
  return (
    <div className="card expad adform">
      <div className="exlabel">➕ منطقة جديدة</div>
      <select aria-label="المحافظة" value={gov} onChange={(e) => setGov(e.target.value)}>
        <option value="">اختر المحافظة</option>
        {govs.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <input placeholder="اسم المنطقة، مثل المنصور" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="اسم أول مركز بيها" value={center} onChange={(e) => setCenter(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !gov || !name.trim() || !center.trim()} onClick={async () => {
        if (await call({ action: "addArea", gov, name, center })) { setName(""); setCenter(""); }
      }}>إضافة</button>
    </div>
  );
}
