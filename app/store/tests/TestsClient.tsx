"use client";
// تست التطبيق: كل خطوة صح أو مشكلة. الخطوة اللي تتغير بعد ما تأشرت يروح منها الصح وتطلع «تغيرت»
import { useState } from "react";
import { TEST_PLAN, stepKey, stepState, type TestMark, type TestMarks, type TestSection, type TestStep } from "../../../lib/testPlan.ts";
import { guideSection } from "../../../lib/guide.ts";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import GuideBody from "../guide/GuideBody";

type Data = { marks: TestMarks };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const all = TEST_PLAN.flatMap((s) => s.steps.map((st) => ({ s, st })));
type View = "left" | "ok" | "bad" | "all";
const EMPTY: Record<View, string> = { left: "🎉 ماكو خطوات باقية.", ok: "ما أشرت صح على أي خطوة بعد.", bad: "ماكو خطوات بيها مشكلة.", all: "" };

function Step({ sec, st, mark, busy, call }: { sec: TestSection; st: TestStep; mark?: TestMark; busy: boolean; call: Call }) {
  const key = stepKey(sec.id, st.id);
  const state = stepState(st, mark);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(mark?.note ?? "");
  const icon = { ok: "✅", bad: "❌", changed: "🔄", todo: "⬜️" }[state];
  return (
    <div className="adsale">
      <div>{icon} {st.text}</div>
      <div className="tshow">📍 {st.how}</div>
      {state === "changed" && <small className="exbad">🔄 تغيرت بعد ما أشرت عليها، جربها مرة ثانية</small>}
      {state === "bad" && mark?.note && <small className="exbad">{mark.note}</small>}
      <div className="exline adtop">
        {state !== "ok" && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "ok", key })}>✅ صح</button>}
        {state !== "bad" && !asking && <button type="button" className="exbtn" disabled={busy} onClick={() => setAsking(true)}>❌ بيها مشكلة</button>}
        {mark && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "clear", key }).then(() => setNote(""))}>↩️ شيل</button>}
      </div>
      {asking && (
        <div className="adtop">
          <textarea className="tmtext" rows={2} aria-label="شنو المشكلة" placeholder="شنو المشكلة؟" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="exbtn adtop" disabled={busy || !note.trim()} onClick={() => void call({ action: "bad", key, note }).then((r) => { if (r) setAsking(false); })}>💾 حفظ المشكلة</button>
        </div>
      )}
    </div>
  );
}

export default function TestsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/testplan", "✅ تست التطبيق");
  const [view, setView] = useState<View>("left");
  const marks = data?.marks ?? {};
  const st = (s: TestSection, x: TestStep) => stepState(x, marks[stepKey(s.id, x.id)]);
  const count = (k: string) => all.filter(({ s, st: x }) => st(s, x) === k).length;
  const pct = Math.round((count("ok") / all.length) * 100);
  const inView = (s: TestSection, x: TestStep) => {
    const v = st(s, x);
    return view === "all" || (view === "left" ? v === "todo" || v === "changed" : v === view);
  };
  const tabs: [View, string, number][] = [["left", "⬜️ الباقي", count("todo") + count("changed")], ["ok", "✅ الصح", count("ok")], ["bad", "❌ الغلط", count("bad")], ["all", "الكل", all.length]];
  const nothing = !all.some(({ s, st: x }) => inView(s, x));
  return (
    <>
      <AdminHeader title="✅ تست التطبيق" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card expad">
              <div className="exlabel">خلصت {count("ok")} من {all.length} ({pct}٪)</div>
              <div className="atbar"><i style={{ width: `${pct}%` }} /></div>
              <div className="adstats adstats2 adtop">
                <div><b>{count("todo")}</b>ما تجربت</div>
                <div><b>{count("changed")}</b>تغيرت</div>
                <div><b>{count("bad")}</b>بيها مشكلة</div>
                <div><b>{count("ok")}</b>صح</div>
              </div>
              <div className="exhint adtop">الصح تأشره إنت. إذا تعدل شي، الصح يروح وحده من الخطوات اللي تأثرت.</div>
              <div className="chips adtabs adtop">
                {tabs.map(([v, label, n]) => <button type="button" key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{label} ({n})</button>)}
              </div>
            </div>
            {TEST_PLAN.map((s) => {
              const shown = s.steps.filter((x) => inView(s, x));
              if (!shown.length) return null;
              const done = s.steps.filter((x) => st(s, x) === "ok").length;
              return (
                <details key={s.id} className="card cpch">
                  <summary><b>{s.icon} {s.title}</b> <small className="pdmode">{done} من {s.steps.length}</small></summary>
                  <div className="expad">
                    <div className="exlabel">قبل لا تبدي</div>
                    <ul style={{ margin: "4px 0 10px", paddingInlineStart: 20 }}>{s.needs.map((n) => <li key={n}>{n}</li>)}</ul>
                    <details className="adtop tsguide">
                      <summary><b>📖 الشرح الكامل</b></summary>
                      {s.guide.map((id) => { const g = guideSection(id); return g && <div key={id} className="adtop"><div className="exlabel">{g.icon} {g.title}</div><GuideBody s={g} /></div>; })}
                    </details>
                    {shown.map((x) => <Step key={x.id} sec={s} st={x} mark={marks[stepKey(s.id, x.id)]} busy={busy} call={call} />)}
                  </div>
                </details>
              );
            })}
            {nothing && <div className="empty">{EMPTY[view]}</div>}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
