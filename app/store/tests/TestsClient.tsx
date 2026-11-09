"use client";
// تست التطبيق: تنفتح على أول خطوة باقية، وكل خطوة تأشرها تروح وتطلع اللي بعدها. الصح ما يرجع، والمشكلة ترجع بس لمن تنصلح
import { useEffect, useRef, useState } from "react";
import { TEST_PLAN, stepKey, stepState, type TestMark, type TestMarks, type TestSection, type TestStep } from "../../../lib/testPlan.ts";
import { guideSection } from "../../../lib/guide.ts";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import GuideBody from "../guide/GuideBody";

type Data = { marks: TestMarks };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const all = TEST_PLAN.flatMap((s) => s.steps.map((st) => ({ s, st })));
type View = "left" | "ok" | "bad" | "all";
const EMPTY: Record<"ok" | "bad" | "all", string> = { ok: "ما أشرت صح على أي خطوة بعد.", bad: "ماكو خطوات بيها مشكلة.", all: "" };

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
      {state === "changed" && <small className="exbad">🔄 انصلحت المشكلة، جربها مرة ثانية</small>}
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

/** قبل لا تبدي، والشرح الكامل من الدليل */
function SectionHelp({ s }: { s: TestSection }) {
  return (
    <>
      <div className="exlabel">قبل لا تبدي</div>
      <ul style={{ margin: "4px 0 10px", paddingInlineStart: 20 }}>{s.needs.map((n) => <li key={n}>{n}</li>)}</ul>
      <details className="adtop tsguide">
        <summary><b>📖 الشرح الكامل</b></summary>
        {s.guide.map((id) => { const g = guideSection(id); return g && <div key={id} className="adtop"><div className="exlabel">{g.icon} {g.title}</div><GuideBody s={g} /></div>; })}
      </details>
    </>
  );
}

/** الخطوات الباقية وحدة وحدة: تبدي من أول باقية، والمؤشرة تروح وتطلع اللي بعدها */
function NextStep({ marks, busy, call }: { marks: TestMarks; busy: boolean; call: Call }) {
  const left = all.filter(({ s, st }) => { const v = stepState(st, marks[stepKey(s.id, st.id)]); return v === "todo" || v === "changed"; });
  const [pos, setPos] = useState(0);
  const at = Math.max(0, Math.min(pos, left.length - 1));
  const top = useRef<HTMLDivElement>(null);
  const cur = left[at];
  const curKey = cur ? stepKey(cur.s.id, cur.st.id) : "";
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [curKey]);
  if (!cur) return <div className="empty">🎉 ماكو خطوات باقية.</div>;
  return (
    <div ref={top} className="card expad">
      <div className="exlabel">{cur.s.icon} {cur.s.title} · الباقية رقم {at + 1} من {left.length}</div>
      <Step key={curKey} sec={cur.s} st={cur.st} mark={marks[curKey]} busy={busy} call={call} />
      <div className="exline adtop">
        <button type="button" className="exbtn" disabled={at === 0} onClick={() => setPos(at - 1)}>➡️ السابقة</button>
        <button type="button" className="exbtn" disabled={at >= left.length - 1} onClick={() => setPos(at + 1)}>⬅️ التالية</button>
      </div>
      <div className="adtop"><SectionHelp s={cur.s} /></div>
    </div>
  );
}

export default function TestsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/testplan", "✅ تست التطبيق");
  const [view, setView] = useState<View>("left");
  const marks = data?.marks ?? {};
  const st = (s: TestSection, x: TestStep) => stepState(x, marks[stepKey(s.id, x.id)]);
  const count = (k: string) => all.filter(({ s, st: x }) => st(s, x) === k).length;
  const left = count("todo") + count("changed");
  const pct = Math.round((count("ok") / all.length) * 100);
  const inView = (s: TestSection, x: TestStep) => view === "all" || st(s, x) === view;
  const tabs: [View, string, number][] = [["left", "⬜️ الباقي", left], ["ok", "✅ الصح", count("ok")], ["bad", "❌ الغلط", count("bad")], ["all", "الكل", all.length]];
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
              <div className="exlabel">خلصت {count("ok")} من {all.length} ({pct}٪) · باقي {left}</div>
              <div className="atbar"><i style={{ width: `${pct}%` }} /></div>
              <div className="exhint adtop">اللي تأشره ✅ صح يروح وما يرجع. اللي بيه مشكلة يرجع بس لمن تنصلح.</div>
              <div className="chips adtabs adtop">
                {tabs.map(([v, label, n]) => <button type="button" key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{label} ({n})</button>)}
              </div>
            </div>
            {view === "left" ? <NextStep marks={marks} busy={busy} call={call} /> : (
              <>
                {TEST_PLAN.map((s) => {
                  const shown = s.steps.filter((x) => inView(s, x));
                  if (!shown.length) return null;
                  const done = s.steps.filter((x) => st(s, x) === "ok").length;
                  return (
                    <details key={s.id} className="card cpch">
                      <summary><b>{s.icon} {s.title}</b> <small className="pdmode">{done} من {s.steps.length}</small></summary>
                      <div className="expad">
                        <SectionHelp s={s} />
                        {shown.map((x) => <Step key={x.id} sec={s} st={x} mark={marks[stepKey(s.id, x.id)]} busy={busy} call={call} />)}
                      </div>
                    </details>
                  );
                })}
                {nothing && <div className="empty">{EMPTY[view]}</div>}
              </>
            )}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
