"use client";
// «🧠 تصحيح قصي»: مصحح الأستاذ الثاني. يجربه بالسر على أوراق صححها مصحح ويقارن، ومن يرتاح لموضوع يخليه يصححه صدگ
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { Inline, MarkedPage, MathText, type MarkedPageT } from "../myexams/AiCompare";
import VoiceText from "./VoiceText";
import InkBook, { type InkItem } from "./InkBook";

type Exam = { id: number; title: string; why: string | null; live: boolean; mu: boolean; human: number; fresh: number; waiting: number; trials: number; gap: number | null; close: number | null; unsure: number; style: string };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type Step = { text: string; points: number; awarded: number; note: string };
type Q = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: Step[]; human: number | null; marked: MarkedPageT[] | null };
type Paper = { id: number; name: string; exam: string; kind: "trial" | "live"; human: number | null; total: number; sure: boolean; iqd: number; batch: boolean; sent: boolean; qs: Q[]; photos: { q: number; ref: string }[]; demo: { at: string; total: number; iqd: number } | null; demoWaiting: boolean };
type TrialRow = { id: number; name: string; exam: string; human: number | null; qusay: number; sure: boolean; iqd: number; at: string };
type Log = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap"; item?: number; name?: string; exam?: string; total?: number; iqd: number | null; note?: string; canSend?: boolean };
type Data = {
  on: boolean; key: boolean; settings: { live: number[]; effort: "low" | "medium"; batch: boolean; cap: number; carry: boolean; unsure: "send" | "graders"; marks: boolean; style: string }; fileToken: string;
  spent: { today: number; month: number; all: number; capIqd: number }; perPaper: number | null; sent: number; unsure: number;
  trialLeft: number; batches: number; chapters: Chapter[]; trials: TrialRow[]; log: Log[]; paper?: Paper; notice?: string; inkOf?: { exam: number; items: InkItem[] };
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
const KIND: Record<Log["kind"], string> = { sent: "✅ صحح ووصلت الدرجة", unsure: "↩️ ما متأكد، رجعها للمصححين", failed: "⚠️ ما گدر", trial: "🧪 تجربة", cap: "⛔ الحد اليومي" };
const num = (n: number) => n.toLocaleString("en-US");

export default function QusayClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qusay", "🧠 تصحيح قصي");
  const [slug, setSlug] = useState("");
  const [allLog, setAllLog] = useState(false);
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
              مصححك الثاني، بروحه وبعيد عن نظام التصحيح AI مال مؤمل. يقرا ورقة الطالب كلها بمرة وحدة ويصححها على خطوات الحل اللي كتبتها.
              جربه بالسر على أوراق الطلاب (ما يوصل شي للطالب)، لو ارفع ورقة طالب تجربة من 🎓 الطلاب ← 📷 ورقة تجربة ← 🧠 تصحيح قصي. كل اللي يصححه يطلع تحت بـ «📋 السجل».
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
            <div className="card expad">
              <div className="exlabel">📋 السجل: آخر الأوراق اللي صححها</div>
              <div className="exhint">دوس 👁 يم أي ورقة حتى تشوف تصحيحها كامل: كل سؤال، وكل خطوة شگد انطى وليش، ويا صور الجواب.</div>
              {!data.log.length && <div className="exhint">ماكو شي بعد.</div>}
              {(allLog ? data.log : data.log.slice(0, 8)).map((r, i) => (
                <div key={i} className="aig-logrow">
                  <div><small>{r.at}</small> · {KIND[r.kind]}{r.name && <> · <b>{r.name}</b></>}{r.exam && <> · {r.exam}</>}{r.total !== undefined && <> · {r.total}</>}{r.iqd !== null && <> · {r.iqd} دينار</>}{r.note && <><br /><small>{r.note}</small></>}</div>
                  {r.item && r.kind !== "failed" && r.kind !== "cap" && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "paper", id: r.item })}>👁 شوف</button>}
                  {r.item && r.canSend && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "sendSaved", id: r.item })}>✅ ابعث درجته</button>}
                  {r.item && (r.kind === "unsure" || r.kind === "failed") && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "retry", id: r.item })}>🔁 يعيدها</button>}
                </div>
              ))}
              {data.log.length > 8 && <button type="button" className="exbtn" onClick={() => setAllLog(!allLog)}>{allLog ? "⬆️ أقل" : `⬇️ كل السجل (${data.log.length})`}</button>}
            </div>
            <Settings key={JSON.stringify(data.settings)} s={data.settings} busy={busy} call={call} />
            <InkCard busy={busy} call={call} />
            {data.chapters.length > 0 && (
              <div className="card expad">
                <div className="exlabel">الفصل</div>
                <select value={ch?.slug ?? ""} onChange={(e) => setSlug(e.target.value)}>
                  {data.chapters.map((c) => <option key={c.slug} value={c.slug}>{c.chapter}</option>)}
                </select>
              </div>
            )}
            {ch?.exams.map((e) => <ExamCard key={e.id + ":" + e.trials + ":" + e.live + ":" + e.style} e={e} busy={busy} call={call} />)}
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
          </>
        )}
      </div>
      {data?.paper && <PaperView p={data.paper} fileUrl={fileUrl} busy={busy} call={call} close={() => void call({ action: "list" })} />}
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Settings({ s, busy, call }: { s: Data["settings"]; busy: boolean; call: Call }) {
  const [effort, setEffort] = useState(s.effort);
  const [batch, setBatch] = useState(s.batch);
  const [cap, setCap] = useState(String(s.cap));
  const [carry, setCarry] = useState(s.carry);
  const [unsure, setUnsure] = useState(s.unsure);
  const [marks, setMarks] = useState(s.marks);
  const [style, setStyle] = useState(s.style);
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
      <div className="exhint">الورقة اللي ما متأكد من سؤال بيها</div>
      <select value={unsure} onChange={(e) => setUnsure(e.target.value === "graders" ? "graders" : "send")}>
        <option value="send">✅ يصححها ويبعث درجتها، والسبب يطلع بالسجل (الأصل)</option>
        <option value="graders">↩️ ترجع للمصححين</option>
      </select>
      <div className="exhint">ورقة طالب التجربة ما ترجع للمصححين أبداً.</div>
      <div className="exhint">🖍 العلامات الحمرة على ورقة الطالب (✓ و✗ يم كل خطوة، ودرجة السؤال بدائرة). جربها أول على ورقة من 👁 ← 🖍 جرب العلامات</div>
      <select value={marks ? "1" : "0"} onChange={(e) => setMarks(e.target.value === "1")}>
        <option value="0">⏸ طافية: الطالب يشوف التصحيح خطوات بس (الأصل)</option>
        <option value="1">🖍 شغالة: كل ورقة يصححها تطلع للطالب مصححة بالأحمر</option>
      </select>
      <div className="exhint">✍️ طريقتك بالكتابة: اكتب أو احچي (🎤 فويس) أمثلة من ملاحظاتك مثل ما تكتبها على ورقة الطالب، كل وحدة بسطر (مثلاً: «المفروض 23π/12» ، «نسيت تعوض» ، «ركز بالإشارة»). يكتب مثلك بالعلامات الحمرة وبـ 🖍 جرب العلامات</div>
      <VoiceText value={style} onChange={setStyle} />
      <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "settings", effort, batch, cap: Number(cap), carry, unsure, marks, style })}>💾 احفظ</button>
    </div>
  );
}

/** «✍️ خط إيدي» العام: ينفتح بزر، حتى الصفحة ما تثگل */
function InkCard({ busy, call }: { busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card expad">
      <div className="exlabel">✍️ خط إيدي على ورقة الطالب</div>
      <div className="exhint">تكتب بقلم الآيباد ✓ و✗ والمدح والملاحظات، والتصحيح الأحمر يرسمها بخطك إنت بدل الخط المطبوع. حتى الطالب يحس إنك صححت ورقته بإيدك.</div>
      <button type="button" className={open ? "btn ghost" : "btn"} onClick={() => setOpen(!open)}>{open ? "⬆️ سد" : "✍️ افتح خط إيدي"}</button>
      {open && <InkBook exam={0} busy={busy} call={call} />}
    </div>
  );
}

function ExamCard({ e, busy, call }: { e: Exam; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(Math.min(10, Math.max(1, e.human))));
  const [nf, setNf] = useState(String(Math.min(3, Math.max(1, e.fresh))));
  const [fast, setFast] = useState(true);
  const [words, setWords] = useState(e.style);
  const [openWords, setOpenWords] = useState(false);
  const [openInk, setOpenInk] = useState(false);
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
      {/* عبارات الأستاذ الخاصة بهذا الموضوع، فوك «✍️ طريقتك بالكتابة» العامة */}
      <button type="button" className="exbtn" onClick={() => setOpenWords(!openWords)}>✍️ عبارات هذا الموضوع{e.style.trim() ? " ✅" : ""}</button>
      {openWords && <>
        <div className="exhint">العبارات والكلمات اللي تستعملها بهذا الموضوع بس، كل وحدة بسطر. تگدر تكتبها لو تحچيها (🎤 فويس). يستعملها ويا «✍️ طريقتك بالكتابة» العامة بالعلامات الحمرة.</div>
        <VoiceText value={words} onChange={setWords} />
        <button type="button" className="exbtn" disabled={busy || words === e.style} onClick={() => void call({ action: "examStyle", exam: e.id, style: words })}>💾 احفظ العبارات</button>
      </>}
      {/* خط إيده الخاص بهذا الموضوع، فوك خطه العام */}
      <button type="button" className="exbtn" onClick={() => setOpenInk(!openInk)}>✍️ خط إيدي لهذا الموضوع</button>
      {openInk && <InkBook exam={e.id} busy={busy} call={call} />}
      {!e.mu && !e.why && (
        <button type="button" className={e.live ? "btn ghost" : "btn"} disabled={busy} onClick={() => void call({ action: "live", exam: e.id, on: !e.live })}>
          {e.live ? "⏸ رجّع هذا الموضوع للمصححين" : "▶️ خليه يصحح هذا الموضوع صدگ"}
        </button>
      )}
    </div>
  );
}

/** سؤال واحد: زر «📝 التصحيح» وجنبه «📷 ورقة الطالب»، كل واحد يطلع لحاله. الرياضيات بشكل الكتاب (الكسر أفقي، π) */
function QView({ q, photos, fileUrl }: { q: Q; photos: string[]; fileUrl: (ref: string) => string }) {
  const marked = !!q.marked?.some((p) => p.marks.length);
  const [view, setView] = useState<"grade" | "paper" | "marked">(marked ? "marked" : "grade");
  return (
    <div className="card expad">
      <div className="exlabel">السؤال {q.n}: {q.score} من {q.max}{q.human !== null && <> · المصحح {q.human}</>} {q.sure ? "" : "⚠️ ما متأكد"}</div>
      <div className="aicview">
        {marked && <button type="button" className={view === "marked" ? "on" : ""} onClick={() => setView("marked")}>🖍 على الورقة</button>}
        <button type="button" className={view === "grade" ? "on" : ""} onClick={() => setView("grade")}>📝 التصحيح</button>
        <button type="button" className={view === "paper" ? "on" : ""} onClick={() => setView("paper")}>📷 ورقة الطالب{photos.length ? "" : " (ماكو)"}</button>
      </div>
      {view === "marked" && marked ? q.marked!.map((p) => <MarkedPage key={p.ref} src={fileUrl(p.ref)} marks={p.marks} />) : view === "paper" ? photos.map((u) => <img key={u} src={u} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />) : <>
        {q.reason && <div className="exhint"><Inline text={q.reason} /></div>}
        {q.method > 1 && <div className="exhint">صححه على الطريقة {q.method}</div>}
        {q.steps.map((s, i) => (
          <div key={i} className="aig-logrow"><div style={{ minWidth: 0, flex: 1 }}>
            {s.awarded >= s.points ? "✅" : s.awarded > 0 ? "◐" : "❌"} <b>{s.awarded}/{s.points}</b>
            <MathText text={s.text} />
            {s.note && <small><Inline text={s.note} /></small>}
          </div></div>
        ))}
      </>}
    </div>
  );
}

function PaperView({ p, fileUrl, busy, call, close }: { p: Paper; fileUrl: (ref: string) => string; busy: boolean; call: Call; close: () => void }) {
  return (
    <div className="exfull" style={{ background: "var(--ink)" }}>
      <button type="button" className="exbtn" onClick={close}>✖ سد</button>
      <div className="card expad">
        <div className="exlabel">{p.name} · {p.exam}</div>
        <div className="aig-stats">
          تصحيح قصي: <b>{p.total}</b>{p.human !== null && <> · المصحح: <b>{p.human}</b></>} · {p.iqd} دينار{p.batch && " (بالدفعة)"}
          <br />{p.kind === "trial" ? "🧪 تجربة بالسر، ما وصلت للطالب" : p.sent ? "✅ هو صححها ووصلت الدرجة للطالب" : "↩️ ما كان متأكد، فرجعها للمصححين"}
        </div>
        {/* 🖍 يعيد تصحيحها بالعلامات الحمرة على الورقة، لحالها: درجتها الأصلية ما تتغير */}
        {p.demo && <div className="exhint">🖍 العلامات على الورقة: صححها مرة ثانية بالعلامات ({p.demo.at}) وانطاها <b>{p.demo.total}</b> · {p.demo.iqd} دينار. شوف «🖍 على الورقة» بكل سؤال.</div>}
        {p.demoWaiting ? <div className="exhint">🖍 تنتظر: خلال دقيقة لو دقيقتين ترسم العلامات. دوس 🔄 حدّث وافتح 👁 مرة ثانية.</div>
          : <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "marks", id: p.id })}>🖍 {p.demo ? "أعد" : "جرب"} العلامات على هاي الورقة (تقريباً 6 دنانير)</button>}
      </div>
      {p.qs.map((q) => <QView key={q.n} q={q} fileUrl={fileUrl} photos={p.photos.filter((f) => f.q === q.n).map((f) => fileUrl(f.ref))} />)}
      {p.photos.some((f) => !f.q) && (
        <div className="card expad">
          <div className="exlabel">صفحات الورقة</div>
          {p.photos.filter((f) => !f.q).map((f) => <img key={f.ref} src={fileUrl(f.ref)} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />)}
        </div>
      )}
    </div>
  );
}
