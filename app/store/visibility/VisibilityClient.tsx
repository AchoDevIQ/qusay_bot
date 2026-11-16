"use client";
// 👁 شنو يشوف الطالب بالبوت: البوت احتياط للتطبيق. كل مربع من قائمة الطالب: مخفي، أو لكل الطلاب، أو لفئة أو طلاب بأسمائهم.
// الدرجات توصل دايماً للطالب ولولي أمره
import { useState } from "react";
import { AdminHeader, StatusBar, pageAuth, useAdminApi } from "../adminPage";

type Mode = "off" | "all" | "some";
type Rule = { mode: Mode; centers: number[]; gender: string; curr: string; chapters: string[]; students: number[] };
type Data = { tiles: { key: string; title: string }[]; rules: Record<string, Rule>; notice: string; centers: { id: number; name: string }[]; genders: string[]; currs: string[]; chapters: string[]; names: { id: number; name: string }[] };

export default function VisibilityClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/visibility", "👁 شنو يشوف الطالب");
  return (
    <>
      <AdminHeader title="👁 شنو يشوف الطالب بالبوت" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Form key={JSON.stringify(data.rules)} data={data} busy={busy} onSave={(rules) => void call({ action: "save", rules })} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Form({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (r: Record<string, Rule>) => void }) {
  const [rules, setRules] = useState(data.rules);
  const [names, setNames] = useState(new Map(data.names.map((n) => [n.id, n.name])));
  const set = (k: string, r: Partial<Rule>) => setRules({ ...rules, [k]: { ...rules[k], ...r } });
  const allOn = data.tiles.every((t) => rules[t.key].mode === "all");
  const allOff = data.tiles.every((t) => rules[t.key].mode === "off");
  const setAll = (mode: Mode) => setRules(Object.fromEntries(data.tiles.map((t) => [t.key, { ...rules[t.key], mode }])));
  return (
    <>
      <div className="card">
        <h2>📱 البوت احتياط للتطبيق</h2>
        <div className="form">
          <div className="exhint">الطالب يشوف بالبوت بس المربعات اللي تفتحها هنا. المخفي ما يطلعله، والطالب اللي كلشي مخفي عنده يطلعله «كل خدماتنا صارت بتطبيق قصي العميري». <b>الدرجات توصل دايماً</b> للطالب ولولي أمره بالمحادثة، حتى لو كلشي مخفي. إنت والمساعدين وطلاب التجربة تشوفون كلشي.</div>
          <div className="seg">
            <button type="button" className={allOn ? "on" : ""} onClick={() => setAll("all")}>🚨 افتح الكل للكل</button>
            <button type="button" className={allOff ? "on" : ""} onClick={() => setAll("off")}>🙈 اخفي الكل</button>
          </div>
          <div className="exhint">«افتح الكل للكل» للطوارئ: إذا التطبيق صار بيه خلل، كل الطلاب يلگون كلشي بالبوت. بعدها ارجع اخفيه.</div>
        </div>
      </div>
      {data.tiles.map((t) => {
        const r = rules[t.key];
        const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
        return (
          <div key={t.key} className="card">
            <h2>{t.title}</h2>
            <div className="form">
              <div className="seg">
                {([["off", "🙈 مخفي"], ["all", "✅ لكل الطلاب"], ["some", "🎯 لفئة"]] as [Mode, string][]).map(([m, label]) => (
                  <button type="button" key={m} className={r.mode === m ? "on" : ""} onClick={() => set(t.key, { mode: m })}>{label}</button>
                ))}
              </div>
              {r.mode === "some" && (
                <>
                  <div className="exhint">يطلع للطالب اللي ينطبق عليه كل شي تختاره هنا، وللطلاب اللي تضيفهم بأسمائهم تحت.</div>
                  <label>المراكز (ما تختار شي = كل المراكز)</label>
                  <div className="chips adtabs">
                    {data.centers.map((c) => <button type="button" key={c.id} className={r.centers.includes(c.id) ? "on" : ""} onClick={() => set(t.key, { centers: toggle(r.centers, c.id) })}>{c.name}</button>)}
                  </div>
                  <label>بنين أو بنات</label>
                  <div className="chips adtabs">
                    {["", ...data.genders].map((g) => <button type="button" key={g || "all"} className={r.gender === g ? "on" : ""} onClick={() => set(t.key, { gender: g })}>{g || "الكل"}</button>)}
                  </div>
                  <label>المنهج</label>
                  <div className="chips adtabs">
                    {["", ...data.currs].map((c) => <button type="button" key={c || "all"} className={r.curr === c ? "on" : ""} onClick={() => set(t.key, { curr: c })}>{c || "الكل"}</button>)}
                  </div>
                  <label>اللي شاري (ما تختار شي = الكل)</label>
                  <div className="chips adtabs">
                    {data.chapters.map((c) => <button type="button" key={c} className={r.chapters.includes(c) ? "on" : ""} onClick={() => set(t.key, { chapters: toggle(r.chapters, c) })}>{c}</button>)}
                  </div>
                  <Students ids={r.students} names={names} onChange={(students, more) => { if (more) setNames(new Map([...names, ...more])); set(t.key, { students }); }} />
                </>
              )}
            </div>
          </div>
        );
      })}
      <div className="card">
        <div className="form">
          <button type="button" className="btn" disabled={busy} onClick={() => onSave(rules)}>{busy ? "جاري الحفظ..." : "💾 احفظ"}</button>
        </div>
      </div>
    </>
  );
}

function Students({ ids, names, onChange }: { ids: number[]; names: Map<number, string>; onChange: (ids: number[], more?: [number, string][]) => void }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ found: { id: number; name: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function call(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData: pageAuth() }) });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "صار خطأ"); else setData(j);
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); }
  }
  return (
    <>
      <label>طلاب بأسمائهم</label>
      {ids.map((id) => (
        <div key={id} className="exline">
          <span>🎓 {names.get(id) ?? `طالب ${id}`}</span>
          <button type="button" className="exbtn" onClick={() => onChange(ids.filter((x) => x !== id))}>✖ شيله</button>
        </div>
      ))}
      <div className="adtwo">
        <input value={q} placeholder="اسم الطالب أو رقم تلفونه" onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || q.trim().length < 2} onClick={() => void call({ action: "find", q })}>🔍 دوّر</button>
      </div>
      {error && <div className="exbad">{error}</div>}
      {data?.found.map((s) => (
        <div key={s.id} className="exline">
          <span>{s.name}</span>
          {ids.includes(s.id) ? <span>✅ مضاف</span> : <button type="button" className="exbtn" onClick={() => onChange([...ids, s.id], [[s.id, s.name]])}>➕ ضيفه</button>}
        </div>
      ))}
      {data && !data.found.length && <div className="exhint">ماكو طالب بهذا الاسم أو الرقم.</div>}
    </>
  );
}
