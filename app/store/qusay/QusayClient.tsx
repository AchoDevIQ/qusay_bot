"use client";
// «🧠 تصحيح قصي»: مصحح الأستاذ الثاني. يجربه بالسر على أوراق صححها مصحح ويقارن، ومن يرتاح لموضوع يخليه يصححه صدگ
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Exam = { id: number; title: string; why: string | null; live: boolean; mu: boolean; human: number; fresh: number; waiting: number; trials: number; gap: number | null; close: number | null; unsure: number };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type Step = { text: string; points: number; awarded: number; note: string };
type Q = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: Step[]; human: number | null };
type Paper = { id: number; name: string; exam: string; kind: "trial" | "live"; human: number | null; total: number; sure: boolean; iqd: number; batch: boolean; sent: boolean; qs: Q[]; photos: { q: number; ref: string }[] };
type TrialRow = { id: number; name: string; exam: string; human: number | null; qusay: number; sure: boolean; iqd: number; at: string };
type Log = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap"; item?: number; name?: string; exam?: string; total?: number; iqd: number | null; note?: string };
type Data = {
  on: boolean; key: boolean; settings: { live: number[]; effort: "low" | "medium"; batch: boolean; cap: number; carry: boolean }; fileToken: string;
  spent: { today: number; month: number; all: number; capIqd: number }; perPaper: number | null; sent: number; unsure: number;
  trialLeft: number; batches: number; chapters: Chapter[]; trials: TrialRow[]; log: Log[]; paper?: Paper; notice?: string;
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const KIND: Record<Log["kind"], string> = { sent: "✅ صحح ووصلت الدرجة", unsure: "↩️ ما متأكد، رجعها للمصححين", failed: "⚠️ ما گدر", trial: "🧪 تجربة", cap: "⛔ الحد اليومي" };
const num = (n: number) => n.toLocaleString("en-US");

export default function QusayClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qusay", "🧠 تصحيح قصي");
  const [slug, setSlug] = useState("");
  const ch = data?.chapters.find((c) => c.slug === slug) ?? data?.chapters[0];
  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  return (
    <>
      <AdminHeader title="🧠 تصحيح قصي" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">
              مصححك الثاني، بروحه وبعيد عن نظام التصحيح AI مال مؤمل. يقرا ورقة الطالب كلها بمرة وحدة ويصححها على خطوات الحل اللي كتبتها، فكلفته واطية.
              الورقة اللي يشك بيها ما ينطيها درجة، ترجع للمصححين. ابدي بالتجربة: يصحح بالسر أوراق صححها مصحح، وتقارن الدرجتين. ما يوصل شي للطالب لحد ما تخليه يصحح موضوع صدگ.
            </div>
            <div className="card expad">
              <div className="exlabel">التشغيل</div>
              {!data.key && <div className="exbad">⚠️ مفتاح الذكاء الاصطناعي مو محطوط بالسيرفر، فما يگدر يشتغل.</div>}
              <button type="button" className={data.on ? "btn ghost" : "btn"} disabled={busy || (!data.key && !data.on)} onClick={() => void call({ action: "on", on: !data.on })}>
                {data.on ? "⏸ طفي تصحيح قصي" : "▶️ شغل تصحيح قصي"}
              </button>
              {data.on ? <div className="fdok">🧠 شغال: كل دقيقة يكمل التجارب، ويصحح المواضيع اللي خليته يصححها صدگ.</div> : <div className="exhint">طافي: ما يصحح ولا يصرف شي.</div>}
              <div className="aig-stats">
                صرف اليوم: <b>{num(data.spent.today)}</b> دينار (الحد {num(data.spent.capIqd)}) · هذا الشهر: <b>{num(data.spent.month)}</b> · من البداية: <b>{num(data.spent.all)}</b> دينار
                <br />معدل الورقة: <b>{data.perPaper ?? "—"}</b> دينار · صحح ووصلت الدرجة: <b>{data.sent}</b> · رجعها للمصححين: <b>{data.unsure}</b>
                {data.trialLeft > 0 && <><br />🧪 تنتظر التجربة: <b>{data.trialLeft}</b> ورقة <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "trialClear" })}>🗑 لا تكمل</button></>}
                {data.batches > 0 && <><br />🌙 دفعات بعدها عند الذكاء: <b>{data.batches}</b></>}
              </div>
              <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "list" })}>🔄 حدّث</button>
            </div>
            <Settings key={JSON.stringify(data.settings)} s={data.settings} busy={busy} call={call} />
            {data.chapters.length > 0 && (
              <div className="card expad">
                <div className="exlabel">الفصل</div>
                <select value={ch?.slug ?? ""} onChange={(e) => setSlug(e.target.value)}>
                  {data.chapters.map((c) => <option key={c.slug} value={c.slug}>{c.chapter}</option>)}
                </select>
              </div>
            )}
            {ch?.exams.map((e) => <ExamCard key={e.id + ":" + e.trials + ":" + e.live} e={e} busy={busy} call={call} />)}
            <div className="card expad">
              <div className="exlabel">🧪 نتائج التجارب (درجة المصحح جنب درجة تصحيح قصي)</div>
              {!data.trials.length && <div className="exhint">بعد ما جربته. اختار موضوع فوك ودوس «🧪 جرب».</div>}
              {data.trials.map((t) => {
                const gap = t.human === null ? null : Math.abs(t.qusay - t.human);
                return (
                  <div key={t.id} className="aig-logrow">
                    <div><b>{t.name}</b> · {t.exam}<br /><small>المصحح: <b>{t.human ?? "⏳ بعده ما صححها"}</b> · تصحيح قصي: <b>{t.qusay}</b>{gap !== null && <> · الفرق {gap}</>}{!t.sure && " · ⚠️ ما متأكد (كان يرجعها للمصحح)"} · {t.iqd} دينار</small></div>
                    <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "paper", id: t.id })}>👁 شوف</button>
                  </div>
                );
              })}
            </div>
            <div className="card expad">
              <div className="exlabel">📋 السجل</div>
              {!data.log.length && <div className="exhint">ماكو شي بعد.</div>}
              {data.log.map((r, i) => (
                <div key={i} className="aig-logrow">
                  <div><small>{r.at}</small> · {KIND[r.kind]}{r.name && <> · <b>{r.name}</b></>}{r.exam && <> · {r.exam}</>}{r.total !== undefined && <> · {r.total}</>}{r.iqd !== null && <> · {r.iqd} دينار</>}{r.note && <><br /><small>{r.note}</small></>}</div>
                  {r.item && (r.kind === "unsure" || r.kind === "failed") && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "retry", id: r.item })}>🔁 يعيدها</button>}
                  {r.item && r.kind !== "failed" && r.kind !== "cap" && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "paper", id: r.item })}>👁</button>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {data?.paper && <PaperView p={data.paper} fileUrl={fileUrl} close={() => void call({ action: "list" })} />}
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Settings({ s, busy, call }: { s: Data["settings"]; busy: boolean; call: Call }) {
  const [effort, setEffort] = useState(s.effort);
  const [batch, setBatch] = useState(s.batch);
  const [cap, setCap] = useState(String(s.cap));
  const [carry, setCarry] = useState(s.carry);
  return (
    <div className="card expad">
      <div className="exlabel">⚙️ الإعدادات</div>
      <div className="exhint">التفكير</div>
      <select value={effort} onChange={(e) => setEffort(e.target.value as "low" | "medium")}>
        <option value="medium">🧠 يفكر أكثر وأدق (الأصل)</option>
        <option value="low">⚡ يفكر أقل وأرخص</option>
      </select>
      <div className="exhint">متى توصل الدرجة</div>
      <select value={batch ? "1" : "0"} onChange={(e) => setBatch(e.target.value === "1")}>
        <option value="0">⚡ هسه: خلال دقيقة أو دقيقتين</option>
        <option value="1">🌙 بالدفعة: نص الكلفة، توصل خلال ساعة تقريباً (أكثر شي يوم)</option>
      </select>
      <div className="exhint">أكثر شي يصرف باليوم (بالدولار): {Math.round((Number(cap) || 0) * 1600).toLocaleString("en-US")} دينار. من يوصله يوگف لباچر</div>
      <input type="number" inputMode="decimal" min={0.1} max={100} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} />
      <div className="exhint">الأوراق اللي تزيد عن الحد</div>
      <select value={carry ? "1" : "0"} onChange={(e) => setCarry(e.target.value === "1")}>
        <option value="1">⏳ تنتظر وتتصحح باچر (ما تروح للمصححين)</option>
        <option value="0">✍️ ترجع للمصححين</option>
      </select>
      <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "settings", effort, batch, cap: Number(cap), carry })}>💾 احفظ</button>
    </div>
  );
}

function ExamCard({ e, busy, call }: { e: Exam; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(Math.min(10, Math.max(1, e.human))));
  const [nf, setNf] = useState(String(Math.min(3, Math.max(1, e.fresh))));
  const [fast, setFast] = useState(true);
  return (
    <div className="card expad">
      <div className="exlabel">{e.title} {e.live && "· ✅ يصححه صدگ"}</div>
      {e.mu && <div className="exhint">🤖 هذا الموضوع يصححه نظام التصحيح AI مال مؤمل، فتصحيح قصي ما ياخذ أوراقه. التجربة بالسر تگدر تسويها.</div>}
      {e.why ? <div className="exbad">⏳ {e.why}. اكتب خطوات الحل من صفحة «🤖 نظام التصحيح AI» (نفس الخطوات تنفع للاثنين).</div> : <div className="fdok">✅ كل أسئلته إلها خطوات أو حل</div>}
      <div className="aig-stats">
        {e.trials ? <>جربته على <b>{e.trials}</b> ورقة · معدل الفرق عن المصحح: <b>{e.gap ?? "—"}</b> درجة · قريبة (3 درجات أو أقل): <b>{e.close ?? "—"}%</b>{e.unsure > 0 && <> · ما متأكد بـ {e.unsure}</>}</> : "بعد ما جربته على هذا الموضوع."}
        {e.waiting > 0 && <><br />⏳ {e.waiting} ورقة جديدة جربها وتنتظر المصحح: من يصححها تطلع درجته جنبها</>}
        <br />أوراق صححها مصحح وتگدر تجربها: <b>{e.human}</b> · أوراق جديدة ما مصححة: <b>{e.fresh}</b>
      </div>
      {!e.why && (e.human > 0 || e.fresh > 0) && (
        <div className="seg">
          <button type="button" className={fast ? "on" : ""} onClick={() => setFast(true)}>⚡ التجربة هسه</button>
          <button type="button" className={!fast ? "on" : ""} onClick={() => setFast(false)}>🌙 بالدفعة (نص الكلفة)</button>
        </div>
      )}
      {!e.why && e.human > 0 && (
        <div className="aig-logrow">
          <input type="number" inputMode="numeric" min={1} max={50} value={n} onChange={(x) => setN(x.target.value)} style={{ width: 70 }} />
          <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "trial", exam: e.id, n: Number(n), now: fast })}>🧪 جرب على {n} ورقة</button>
        </div>
      )}
      {!e.why && e.fresh > 0 && (
        <div className="aig-logrow">
          <input type="number" inputMode="numeric" min={1} max={50} value={nf} onChange={(x) => setNf(x.target.value)} style={{ width: 70 }} />
          <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "trial", exam: e.id, n: Number(nf), fresh: true, now: fast })}>🆕 جرب على {nf} ورقة جديدة</button>
        </div>
      )}
      {!e.why && e.fresh > 0 && <div className="exhint">الورقة الجديدة تبقى عند المصححين مثل ما هي، ودرجة «تصحيح قصي» تطلع إلك إنت بس. ولا شي يوصل للطالب.</div>}
      {e.trials > 0 && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "forget", exam: e.id })}>🗑 امسح تجاربه حتى أعيدها</button>}
      {!e.mu && !e.why && (
        <button type="button" className={e.live ? "btn ghost" : "btn"} disabled={busy} onClick={() => void call({ action: "live", exam: e.id, on: !e.live })}>
          {e.live ? "⏸ رجّع هذا الموضوع للمصححين" : "▶️ خليه يصحح هذا الموضوع صدگ"}
        </button>
      )}
    </div>
  );
}

function PaperView({ p, fileUrl, close }: { p: Paper; fileUrl: (ref: string) => string; close: () => void }) {
  return (
    <div className="exfull" style={{ background: "var(--ink)" }}>
      <button type="button" className="exbtn" onClick={close}>✖ سد</button>
      <div className="card expad">
        <div className="exlabel">{p.name} · {p.exam}</div>
        <div className="aig-stats">
          تصحيح قصي: <b>{p.total}</b>{p.human !== null && <> · المصحح: <b>{p.human}</b></>} · {p.iqd} دينار{p.batch && " (بالدفعة)"}
          <br />{p.kind === "trial" ? "🧪 تجربة بالسر، ما وصلت للطالب" : p.sent ? "✅ هو صححها ووصلت الدرجة للطالب" : "↩️ ما كان متأكد، فرجعها للمصححين"}
        </div>
      </div>
      {p.qs.map((q) => (
        <div key={q.n} className="card expad">
          <div className="exlabel">السؤال {q.n}: {q.score} من {q.max}{q.human !== null && <> · المصحح {q.human}</>} {q.sure ? "" : "⚠️ ما متأكد"}</div>
          {q.reason && <div className="exhint">{q.reason}</div>}
          {q.method > 1 && <div className="exhint">صححه على الطريقة {q.method}</div>}
          {q.steps.map((s, i) => (
            <div key={i} className="aig-logrow"><div>{s.awarded >= s.points ? "✅" : s.awarded > 0 ? "◐" : "❌"} <b>{s.awarded}/{s.points}</b> · {s.text}{s.note && <><br /><small>{s.note}</small></>}</div></div>
          ))}
          {p.photos.filter((f) => f.q === q.n).map((f) => <img key={f.ref} src={fileUrl(f.ref)} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />)}
        </div>
      ))}
      {p.photos.some((f) => !f.q) && (
        <div className="card expad">
          <div className="exlabel">صفحات الورقة</div>
          {p.photos.filter((f) => !f.q).map((f) => <img key={f.ref} src={fileUrl(f.ref)} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />)}
        </div>
      )}
    </div>
  );
}
