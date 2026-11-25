"use client";
// 🧭 التست الكامل: كل التطبيق من الطول للطول بترتيب حياة الطالب. كل خطوة: منو، شنو تسوي بالضبط، شنو لازم يطلع،
// وزر يفتح المكان نفسه («👁 افتح كطالب» = نفس صفحة الطالب بحساب طالب التجربة). «✅ تم» تخفيها، و«❌ بيها مشكلة» توصلني
import { useEffect, useState } from "react";
import { JOURNEY, WHO, jKey, type JSection, type JStep } from "../../../lib/fullTest.ts";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Mark = { state: "ok" | "bad"; rev: number; note?: string; at: string };
type Data = { marks: Record<string, Mark>; student: { uid: number; name: string; phone: string } | null; notice?: string };
const OPEN = { student: "👁 افتح كطالب", panel: "⚙️ افتح باللوحة", library: "🏪 افتح كمكتبة" } as const;
const stateOf = (st: JStep, m?: Mark) => (!m ? "todo" : m.state === "ok" ? (m.rev >= (st.rev ?? 1) ? "ok" : "changed") : "bad");

export default function FullTestClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/fulltest", "التست الكامل");
  const [showDone, setShowDone] = useState(false);
  const [phone, setPhone] = useState("07000000901");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { void call({ action: "list" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = data?.marks ?? {};
  const all = JOURNEY.flatMap((s) => s.steps.map((st) => ({ s, st })));
  const done = all.filter(({ s, st }) => stateOf(st, marks[jKey(s.id, st.id)]) === "ok").length;
  // القسم اللي بيه أول خطوة باقية ينفتح وحده
  const firstLeft = JOURNEY.find((s) => s.steps.some((st) => stateOf(st, marks[jKey(s.id, st.id)]) !== "ok"))?.id;
  const go = async (o: NonNullable<JStep["open"]>) => {
    const w = window.open("about:blank", "_blank");
    const r = await call({ action: "open", as: o.as, page: o.page, q: o.q }, true) as unknown as { url?: string } | null;
    if (r?.url && w) w.location.href = r.url; else w?.close();
  };
  return (
    <>
      <AdminHeader title="🧭 التست الكامل" />
      <div className="wrap">
        <div className="card">
          <div className="exhint">كل التطبيق من أول ما الطالب يسجل لآخر شي، بالترتيب. كل خطوة مكتوب منو يسويها ووين يدوس وشنو لازم يطلع، وزر يفتحلك المكان نفسه. اللي تشتغل دوس «✅ تم» فتختفي، واللي بيها شي دوس «❌ بيها مشكلة» واكتب شنو.</div>
          <div className="ftbar"><i style={{ width: `${all.length ? (100 * done) / all.length : 0}%` }} /></div>
          <b>خلصت {done} من {all.length}</b>
        </div>
        <div className="card">
          <h2>👤 طالب التجربة</h2>
          <div className="exhint">أزرار «👁 افتح كطالب» تفتح بحسابه، نفس الصفحة اللي يشوفها جوه التطبيق بالضبط.</div>
          <div className="exline adtop">
            <input className="exnum" style={{ width: 170 }} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "setStudent", phone })}>اختاره</button>
            <span>{data?.student ? `✅ ${data.student.name} (${data.student.phone})` : "بعدك ما اخترت"}</span>
          </div>
        </div>
        <div className="exline"><button type="button" className={showDone ? "btn" : "exbtn"} onClick={() => setShowDone((x) => !x)}>{showDone ? "اخفي اللي خلصت" : "اعرض اللي خلصت"}</button></div>
        {JOURNEY.map((s) => {
          const left = s.steps.filter((st) => stateOf(st, marks[jKey(s.id, st.id)]) !== "ok");
          const shown = showDone ? s.steps : left;
          const isOpen = open[s.id] ?? s.id === firstLeft;
          return (
            <div key={s.id} className="card">
              <button type="button" className="fthead" onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))}>
                <b>{s.icon} {s.title}</b><small>{s.steps.length - left.length}/{s.steps.length}</small><span>{isOpen ? "▴" : "▾"}</span>
              </button>
              {isOpen && <>
                {s.note && <div className="exhint">📌 {s.note}</div>}
                {!shown.length && <div className="exhint">✅ كل خطوات هذا القسم خلصت</div>}
                {shown.map((st) => <StepCard key={st.id} sec={s} st={st} mark={marks[jKey(s.id, st.id)]} busy={busy} call={call} go={go} />)}
              </>}
            </div>
          );
        })}
      </div>
      <style>{CSS}</style>
      <StatusBar busy={busy} error={error} notice={data?.notice} />
    </>
  );
}

function StepCard({ sec, st, mark, busy, call, go }: { sec: JSection; st: JStep; mark?: Mark; busy: boolean; call: (b: Record<string, unknown>) => Promise<Data | null>; go: (o: NonNullable<JStep["open"]>) => Promise<void> }) {
  const key = jKey(sec.id, st.id);
  const state = stateOf(st, mark);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(mark?.note ?? "");
  return (
    <div className={`ftstep ${state}`}>
      <div className="ftwho">{WHO[st.who]}</div>
      <ol>{st.do.map((d, i) => <li key={i}>{d}</li>)}</ol>
      <div className="ftexp">👀 <b>لازم يطلع:</b> {st.text}</div>
      {state === "changed" && <small className="exbad">🔄 تغيرت بعد ما أشرتها، جربها مرة ثانية</small>}
      {state === "bad" && mark?.note && <small className="exbad">❌ {mark.note}</small>}
      <div className="exline adtop">
        {st.open && <button type="button" className="btn" style={{ width: "auto" }} disabled={busy} onClick={() => void go(st.open!)}>{OPEN[st.open.as]}</button>}
        {state !== "ok" && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "ok", key })}>✅ تم</button>}
        {!asking && state !== "bad" && <button type="button" className="exbtn" disabled={busy} onClick={() => setAsking(true)}>❌ بيها مشكلة</button>}
        {mark && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "clear", key })}>↩️ رجعها</button>}
      </div>
      {asking && <div className="adtop">
        <textarea className="tmtext" rows={2} placeholder="شنو المشكلة؟ شنو طلع بداله؟" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="exbtn adtop" disabled={busy || !note.trim()} onClick={() => void call({ action: "bad", key, note }).then((r) => { if (r) setAsking(false); })}>💾 دز المشكلة</button>
      </div>}
    </div>
  );
}

const CSS = `
.ftbar{height:8px;border-radius:4px;background:rgba(255,255,255,.12);margin:10px 0 6px;overflow:hidden}.ftbar i{display:block;height:100%;background:#F6C94A}
.fthead{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;background:none;border:0;color:inherit;font:inherit;text-align:right;cursor:pointer}
.fthead b{flex:1;font-size:17px}.fthead small{opacity:.75;font-weight:700}
.ftstep{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;margin-top:10px}
.ftstep.ok{opacity:.6}.ftstep.bad{border-color:#e57373}.ftstep.changed{border-color:#F6C94A}
.ftwho{display:inline-block;font-size:13px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(246,201,74,.16);color:#F6C94A;margin-bottom:6px}
.ftstep ol{margin:4px 0 6px;padding-inline-start:22px;line-height:1.9}
.ftexp{background:rgba(255,255,255,.06);border-radius:8px;padding:8px 10px;line-height:1.7}
`;
