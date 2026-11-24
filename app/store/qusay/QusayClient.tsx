"use client";
// «🧠 تصحيح قصي»: مصحح الأستاذ الثاني. يجربه بالسر على أوراق صححها مصحح ويقارن، ومن يرتاح لموضوع يخليه يصححه صدگ
import { useEffect, useRef, useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { Inline, MarkedPage, MathText, type MarkedPageT, type PaperMark as MarkT } from "../myexams/AiCompare";
import VoiceText from "./VoiceText";
import InkBook, { BOX, Pad, type InkItem } from "./InkBook";

type Exam = { id: number; title: string; why: string | null; live: boolean; mu: boolean; human: number; fresh: number; waiting: number; trials: number; gap: number | null; close: number | null; unsure: number; style: string; lessons: Lesson[] };
type MuQ = { n: number; score: number; max: number; note?: string; reason?: string; steps?: { e: string; s: string; a: number; p: number; r: string }[] };
type SideRow = { id: number; name: string; ref: { total: number; qs: Record<string, number> | null } | null; pages: { ref: string; q: number; ink: string }[];
  mu: { total: number; usd: number; qs: MuQ[] } | null; qg: { total: number; usd: number; qs: { n: number; score: number; max: number; reason: string }[]; marked: MarkedPageT[] } | null; muErr: string; qgErr: string };
type CmpSide = { at: string; total: number; qs: { n: number; score: number; max: number; reason: string }[]; usd: number };
type CmpRow = { id: number; name: string; waiting: boolean; ref: { total: number; qs: Record<string, number> } | null; mu: CmpSide | null; qg: CmpSide | null; muErr: string; qgErr: string };
type Lesson = { id: number; at: string; q: number; step: string; from: number; to: number; max: number; why: string };
type Chapter = { slug: string; chapter: string; exams: Exam[] };
type Step = { text: string; points: number; awarded: number; note: string };
type Q = { n: number; max: number; score: number; answered: boolean; sure: boolean; reason: string; method: number; steps: Step[]; human: number | null; marked: MarkedPageT[] | null };
type Paper = { id: number; name: string; exam: string; kind: "trial" | "live"; human: number | null; total: number; sure: boolean; iqd: number; batch: boolean; sent: boolean; qs: Q[]; photos: { q: number; ref: string }[]; demo: { at: string; total: number; iqd: number } | null; demoWaiting: boolean };
type TrialRow = { id: number; name: string; exam: string; human: number | null; qusay: number; sure: boolean; iqd: number; at: string };
type Log = { at: string; kind: "sent" | "unsure" | "failed" | "trial" | "cap" | "obj" | "wait"; item?: number; name?: string; exam?: string; total?: number; iqd: number | null; note?: string; canSend?: boolean };
type Data = {
  on: boolean; key: boolean; settings: { live: number[]; model: "haiku" | "sonnet" | "opus"; effort: "low" | "medium"; batch: boolean; cap: number; carry: boolean; unsure: "send" | "graders"; marks: boolean; style: string; obj: "qusay" | "person"; objTo: number; wait: boolean }; fileToken: string; objStaff: { id: number; name: string }[];
  spent: { today: number; month: number; all: number; capIqd: number }; perPaper: number | null; sent: number; unsure: number;
  trialLeft: number; batches: number; inkWait: InkWait[]; chapters: Chapter[]; trials: TrialRow[]; log: Log[]; tidy?: string; paper?: Paper; cmp?: { exam: number; rows: CmpRow[] }; side?: { exam: number; rows: SideRow[] }; notice?: string; inkOf?: { exam: number; items: InkItem[] };
};
type Call = (b: Record<string, unknown>) => Promise<Data | null>;
type PhraseEx = { item: number; ref: string; marks: MarkT[]; k: number; q: number; step: string; w: string };
type InkWait = { exam: number; title: string; papers: number; phrases: { t: string; n: number; ex?: PhraseEx }[] };
/** ورقة الطالب اللي انكتبت عليها العبارة، والعلامة نفسها محوطة، ورقم السؤال والخطوة وشنو كتب الطالب */
function PhraseExample({ ex, fileUrl }: { ex: PhraseEx; fileUrl: (ref: string) => string }) {
  return (
    <div className="inkex">
      <div className="exhint">السؤال {ex.q}{ex.step && <> · الخطوة: <MathText text={ex.step} /></>}</div>
      {ex.w && <div className="exhint">✍️ الطالب كاتب: <MathText text={ex.w} /></div>}
      <MarkedPage src={fileUrl(ex.ref)} marks={ex.marks} picked={ex.k} />
      <div className="exhint">العبارة محوطة بخط أزرق. دوس على الورقة حتى تكبر.</div>
    </div>
  );
}
const KIND: Record<Log["kind"], string> = { sent: "✅ صحح ووصلت الدرجة", unsure: "↩️ ما متأكد، رجعها للمصححين", failed: "⚠️ ما گدر", trial: "🧪 تجربة", cap: "⛔ الحد اليومي", obj: "✋ راجع اعتراض", wait: "⏸ تنتظر خطك" };
const num = (n: number) => n.toLocaleString("en-US");

export default function QusayClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qusay", "🧠 تصحيح قصي");
  const [slug, setSlug] = useState("");
  const [allLog, setAllLog] = useState(false);
  const ch = data?.chapters.find((c) => c.slug === slug) ?? data?.chapters[0];
  const fileUrl = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  // ↩️ رجوع من ورقة الطالب لنفس مكانك بالصفحة، بلا تحميل من جديد (طلبه 2026-11-23). وسحبة الرجوع بالآيباد هم ترجعك للصفحة، مو تطلعك منها
  const [shut, setShut] = useState<Paper | null>(null);
  const [sideShut, setSideShut] = useState<Data["side"] | null>(null);
  const open = !!data?.paper && data.paper !== shut;
  const cur = useRef<Paper | null>(null);
  cur.current = data?.paper ?? null;
  useEffect(() => {
    if (!open) return;
    history.pushState({ qgPaper: 1 }, "");
    const onPop = () => setShut(cur.current);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);
  const closePaper = () => { if (history.state?.qgPaper) history.back(); else setShut(cur.current); };
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
            {data.inkWait?.length > 0 && <InkWaitCard waits={data.inkWait} busy={busy} call={call} fileUrl={fileUrl} />}
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
            <Settings key={JSON.stringify(data.settings)} s={data.settings} staff={data.objStaff} busy={busy} call={call} />
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
      {data?.paper && data.paper !== shut && <PaperView p={data.paper} fileUrl={fileUrl} busy={busy} call={call} close={closePaper} />}
      {data?.side && data.side !== sideShut && <SideView rows={data.side.rows} fileUrl={fileUrl} close={() => setSideShut(data.side ?? null)} />}
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

/** ⏸ أوراق تنتظر خطك: لكل موضوع العبارات (الأكثر تكرار أول)، يم كل وحدة ✍️ تفتح الورقة البيضة والعبارة فوكها.
 *  من تكتب كل عبارات ورقة تنبعث وحدها. «📤 دز الباقي بالرقعة» يبعث الكل هسه (طلبه 2026-11-24) */
function InkWaitCard({ waits, busy, call, fileUrl }: { waits: InkWait[]; busy: boolean; call: Call; fileUrl: (ref: string) => string }) {
  const [writing, setWriting] = useState<{ exam: number; t: string; ex?: PhraseEx } | null>(null);
  const [look, setLook] = useState("");
  // من التنبيه («✍️ راح أكتبها»): الموضوع اللي إجه منه يطلع أول
  const want = typeof window === "undefined" ? 0 : Number(new URLSearchParams(location.search).get("ink")) || 0;
  const list = [...waits].sort((a, b) => Number(b.exam === want) - Number(a.exam === want));
  if (writing) {
    return (
      <div className="card expad">
        {writing.ex && <PhraseExample ex={writing.ex} fileUrl={fileUrl} />}
        <div className="exhint">اكتبها بأسلوبك، مو لازم نفس الكلام حرفياً. بس خلي المعنى نفسه.</div>
        <Pad kind="note" label={writing.t} busy={busy} onCancel={() => setWriting(null)}
          onUpload={(s, c, wd) => void call({ action: "waitInk", exam: writing.exam, item: { text: writing.t, w: BOX.note.w, h: BOX.note.h, s, c, wd } }).then((d) => { if (d) setWriting(null); })} />
      </div>
    );
  }
  return (
    <div className="card expad">
      <div className="exlabel">⏸ أوراق تنتظر خطك</div>
      <div className="exhint">صححها تصحيح قصي، بس بيها عبارات بعدك ما كاتبها بخط إيدك. دوس ✍️ يم العبارة واكتبها بالقلم مرة وحدة، وتبقى إلك بكل الأوراق الجاية. من تخلص عبارات الورقة تنبعث وحدها بخطك.</div>
      {list.map((w) => (
        <div key={w.exam} className="inkkind">
          <div className="aig-logrow"><b>{w.title}</b><small>{w.papers} {w.papers > 1 ? "أوراق" : "ورقة"} · {w.phrases.length} عبارة</small></div>
          {w.phrases.map((p) => (
            <div key={p.t}>
              <div className="aig-logrow">
                <div dir="auto"><Inline text={p.t} />{p.n > 1 && <small> · {p.n} مرات</small>}</div>
                {p.ex && <button type="button" className="exbtn" onClick={() => setLook(look === p.t ? "" : p.t)}>{look === p.t ? "⬆️ سد" : "📷 وين؟"}</button>}
                <button type="button" className="exbtn" disabled={busy} onClick={() => setWriting({ exam: w.exam, t: p.t, ex: p.ex })}>✍️ اكتبها</button>
              </div>
              {look === p.t && p.ex && <PhraseExample ex={p.ex} fileUrl={fileUrl} />}
            </div>
          ))}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (confirm("تنبعث هسه كل أوراق هذا الموضوع، والعبارات اللي ما كتبتها تطلع بخط الرقعة؟")) void call({ action: "waitSend", exam: w.exam }); }}>📤 دز الباقي بالرقعة</button>
        </div>
      ))}
    </div>
  );
}

function Settings({ s, staff, busy, call }: { s: Data["settings"]; staff: Data["objStaff"]; busy: boolean; call: Call }) {
  const [obj, setObj] = useState(s.obj);
  const [objTo, setObjTo] = useState(s.objTo);
  const [effort, setEffort] = useState(s.effort);
  const [model, setModel] = useState(s.model);
  const [batch, setBatch] = useState(s.batch);
  const [cap, setCap] = useState(String(s.cap));
  const [carry, setCarry] = useState(s.carry);
  const [unsure, setUnsure] = useState(s.unsure);
  const [marks, setMarks] = useState(s.marks);
  const [style, setStyle] = useState(s.style);
  const [wait, setWait] = useState(s.wait);
  return (
    <div className="card expad">
      <div className="exlabel">⚙️ الإعدادات</div>
      <div className="exhint">الذكاء اللي يصحح (كل ما أدق، أغلى). جربه على نفس أوراق التجربة وقارن قبل ما تشغله صدگ</div>
      <select value={model} onChange={(e) => setModel(e.target.value as "haiku" | "sonnet" | "opus")}>
        <option value="haiku">⚡ Haiku: الأرخص (الورقة تقريباً 15 دينار)</option>
        <option value="sonnet">🎯 Sonnet: أدق بقراءة الخط والرسم وتطبيق قواعدك (تقريباً 20 مرة أغلى، الورقة 250 لحد 300 دينار)</option>
        <option value="opus">🏆 Opus: الأدق (تقريباً 40 مرة أغلى، الورقة 500 لحد 600 دينار)</option>
      </select>
      <div className="exhint">بالدفعة 🌙 كل هذي الأسعار تصير النص.</div>
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
      <div className="exhint">✋ اعتراض الطالب على ورقة صححها «تصحيح قصي»</div>
      <select value={obj} onChange={(e) => setObj(e.target.value === "qusay" ? "qusay" : "person")}>
        <option value="person">👤 يروح لشخص يرد عليه (الأصل)</option>
        <option value="qusay">🧠 تصحيح قصي يراجعه: يعيد السؤال، إذا الدرجة تصعد يقبله، وإلا يرفضه ويكتب ليش</option>
      </select>
      {obj === "person" && <>
        <div className="exhint">منو يرد على اعتراضاتها</div>
        <select value={objTo} onChange={(e) => setObjTo(Number(e.target.value))}>
          <option value={0}>👤 أنا (صاحب البوت)</option>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {!staff.length && <div className="exhint">حتى تختار مساعد: انطيه صلاحية «✋ الاعتراضات» من 👥 المساعدين.</div>}
      </>}
      {obj === "qusay" && <div className="exhint">كل سؤال يراجعه تقريباً 5 إلى 7 دنانير، ويطلع بالسجل «✋ راجع اعتراض». الدرجة ما تنزل بالاعتراض أبداً. إذا ما گدر يراجعه مرتين، يوصلك إنت.</div>}
      <div className="exhint">🖍 العلامات الحمرة على ورقة الطالب (✓ و✗ يم كل خطوة، ودرجة السؤال بدائرة). جربها أول على ورقة من 👁 ← 🖍 جرب العلامات</div>
      <select value={marks ? "1" : "0"} onChange={(e) => setMarks(e.target.value === "1")}>
        <option value="0">⏸ طافية: الطالب يشوف التصحيح خطوات بس (الأصل)</option>
        <option value="1">🖍 شغالة: كل ورقة يصححها تطلع للطالب مصححة بالأحمر</option>
      </select>
      <div className="exhint">⏸ الورقة اللي بيها عبارات بعدك ما كاتبها بخط إيدك</div>
      <select value={wait ? "1" : "0"} onChange={(e) => setWait(e.target.value === "1")}>
        <option value="1">⏸ تنتظرك: يوصلك تنبيه تكتبها لو تدزها بالرقعة (الأصل)</option>
        <option value="0">📤 تنبعث على طول، والعبارات بالرقعة</option>
      </select>
      <div className="exhint">✍️ طريقتك بالكتابة: اكتب أو احچي (🎤 فويس) أمثلة من ملاحظاتك مثل ما تكتبها على ورقة الطالب، كل وحدة بسطر (مثلاً: «المفروض 23π/12» ، «نسيت تعوض» ، «ركز بالإشارة»). يكتب مثلك بالعلامات الحمرة وبـ 🖍 جرب العلامات</div>
      <VoiceText value={style} onChange={setStyle} />
      <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "settings", model, effort, batch, cap: Number(cap), carry, unsure, marks, style, obj, objTo, wait })}>💾 احفظ</button>
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
  const [openLearn, setOpenLearn] = useState(false);
  const [openCmp, setOpenCmp] = useState(false);
  const [nc, setNc] = useState("5");
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
        <div className="exhint">العبارات والكلمات اللي تستعملها بهذا الموضوع بس، كل وحدة بسطر. أحسن شي: اكتب شرحك بالـ Word (المعادلات بمحرر المعادلات) وارفعه هنا. وتگدر هم تكتبها لو تحچيها (🎤 فويس). يستعملها ويا «✍️ طريقتك بالكتابة» العامة بالعلامات الحمرة.</div>
        <label className={"exbtn" + (busy ? " off" : "")}>📄 ارفع ملف Word لو PDF (الـ Word ببلاش)
          <input type="file" accept=".docx,.pdf,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden disabled={busy} onChange={(x) => {
            const f = x.target.files?.[0]; x.target.value = "";
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
              const b64 = String(r.result ?? "").split(",")[1] ?? "";
              void call({ action: "notesFile", name: f.name, b64 }).then((d) => {
                if (!d?.tidy) return;
                // المربع بيه كلام: يبدله لو يضيفه بالآخر
                const keep = words.trim() && !window.confirm("تبدل الكلام اللي بالمربع بكلام الملف؟\n(إلغاء = يضيفه بآخر الكلام)");
                setWords(keep ? `${words.trim()}\n${d.tidy}` : d.tidy);
              });
            };
            r.readAsDataURL(f);
          }} />
        </label>
        <VoiceText value={words} onChange={setWords} />
        <div className="exhint">المعادلة اكتبها مثل الموبايل: x² لو x^2، والكسر 3/x²، والجذر √(x+1)، و≠ و±. وتحت تطلعلك مرتبة مثل الكتاب حتى تتأكد.</div>
        {/[A-Za-z0-9²³√$]/.test(words) && (
          <div className="tidyview">
            <div className="exhint">👁 هيچ ينقرا كلامك (المعادلات مرتبة):</div>
            {words.split(/\n/).filter((l) => l.trim()).map((l, i) => <div key={i} className="tidyline"><Inline text={l} /></div>)}
          </div>
        )}
        <button type="button" className="exbtn" disabled={busy || !words.trim()} onClick={() => void call({ action: "tidy", text: words }).then((d) => { if (d?.tidy) setWords(d.tidy); })}>🪄 رتّب كلام الفويس (بفلوس)</button>
        <button type="button" className="exbtn" disabled={busy || words === e.style} onClick={() => void call({ action: "examStyle", exam: e.id, style: words })}>💾 احفظ العبارات</button>
      </>}
      {/* ⚖️ «قارن مؤمل وقصي» انشال من الصفحة بعد ما خلص المقارنة (طلبه 2026-11-24). الكود يبقى إذا احتاجه */}
      {false && openCmp && <CompareBox exam={e.id} n={nc} setN={setNc} busy={busy} call={call} />}
      {/* 🧠 اللي تعلمه من تصحيحاته بـ «✏️ صلّح» */}
      {e.lessons.length > 0 && <button type="button" className="exbtn" onClick={() => setOpenLearn(!openLearn)}>🧠 اللي تعلمه من تصحيحاتك ({e.lessons.length})</button>}
      {openLearn && e.lessons.map((l) => (
        <div key={l.id} className="aig-logrow"><div style={{ minWidth: 0, flex: 1 }}>
          <b>السؤال {l.q}</b> · چان {l.from} وصار {l.to} من {l.max} · <small dir="ltr">{l.at}</small>
          <MathText text={l.step} />
          <div>ليش: {l.why}</div>
        </div><button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "lessonDel", exam: e.id, lesson: l.id })}>🗑</button></div>
      ))}
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

/** رسم المصحح على الصفحة (خطوط القلم، والكتابة، والختم ✓ ✗) فوك صورة الورقة */
function InkOverlay({ ink }: { ink: string }) {
  let items: any[] = [];
  try { items = JSON.parse(ink || "{}").items ?? []; } catch { items = []; }
  if (!items.length) return null;
  return (
    <svg className="sideink" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
      {items.map((x, i) => x.t === "s" ? (
        <polyline key={i} fill="none" stroke={x.c || "#d40000"} strokeWidth={Math.max(2, Number(x.w) || 4)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          points={(x.p as number[]).reduce((t: string, v: number, k: number) => t + (k % 2 ? `,${v * 1000} ` : `${v * 1000}`), "")} />
      ) : x.t === "x" ? <text key={i} x={x.x * 1000} y={x.y * 1000} fill={x.c || "#d40000"} fontSize={(Number(x.z) || 0.032) * 1000} textAnchor="end">{String(x.s ?? "")}</text>
        : x.t === "k" || x.t === "w" ? <text key={i} x={x.x * 1000} y={x.y * 1000} fill="#d40000" fontSize={50} textAnchor="middle">{x.t === "k" ? "✓" : "✗"}</text> : null)}
    </svg>
  );
}
/** «⚖️ الأوراق جنب بعض» (طلب الأستاذ 2026-11-24): كل طالب ثلاث خانات: تصحيحه هو على الورقة، ومؤمل خطوة خطوة، وقصي بعلاماته على الورقة */
function SideView({ rows, fileUrl, close }: { rows: SideRow[]; fileUrl: (ref: string) => string; close: () => void }) {
  const [big, setBig] = useState<number | null>(null);
  return (
    <div className="exfull sidefull">
      <button type="button" className="exbtn" onClick={close}>↩️ رجوع</button>
      {!rows.length && <div className="empty">ماكو أوراق مقارنة بهذا الموضوع بعد.</div>}
      {rows.map((r) => (
        <div key={r.id} className="card expad">
          <div className="exlabel">{r.name}: إنت <b>{r.ref?.total ?? "—"}</b> · مؤمل <b>{r.mu?.total ?? "—"}</b> · قصي <b>{r.qg?.total ?? "—"}</b>
            {" "}<button type="button" className="exbtn" onClick={() => setBig(big === r.id ? null : r.id)}>{big === r.id ? "⇆ رجّعها جنب بعض" : "🔎 كبّرها (وحدة تحت وحدة)"}</button></div>
          <div className={"sidegrid" + (big === r.id ? " sideone" : "")}>
            <div className="sidecol">
              <div className="sidehead">✍️ تصحيحك</div>
              {r.ref ? Object.entries(r.ref.qs ?? {}).map(([n, m]) => <div key={n} className="sideq">س{n}: <b>{m}</b></div>) : <small>ما مصححها إنت</small>}
              {r.pages.map((p, i) => <div key={i} className="sidepage"><img src={fileUrl(p.ref)} alt="" /><InkOverlay ink={p.ink} /></div>)}
            </div>
            <div className="sidecol">
              <div className="sidehead">🤖 مؤمل</div>
              {r.muErr && <small className="exbad">⚠️ {r.muErr}</small>}
              {(r.mu?.qs ?? []).map((q) => (
                <div key={q.n} className="sideq">
                  <b>س{q.n}: {q.score} من {q.max}</b>{(q.note || q.reason) && <div><small><Inline text={String(q.note || q.reason)} /></small></div>}
                  {(q.steps ?? []).map((st, k) => (
                    <div key={k} className={"sidestep" + (st.a >= st.p ? "" : st.a > 0 ? " half" : " bad")}>
                      <small>{st.a >= st.p ? "✅" : st.a > 0 ? "◐" : "❌"} {st.a}/{st.p}</small> <MathText text={st.e} />
                      {st.a < st.p && st.r && <small><Inline text={st.r} /></small>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="sidecol">
              <div className="sidehead">🧠 قصي</div>
              {r.qgErr && <small className="exbad">⚠️ {r.qgErr}</small>}
              {(r.qg?.qs ?? []).map((q) => <div key={q.n} className="sideq"><b>س{q.n}: {q.score} من {q.max}</b>{q.reason && <div><small><Inline text={q.reason} /></small></div>}</div>)}
              {(r.qg?.marked ?? []).map((p) => <MarkedPage key={p.ref} src={fileUrl(p.ref)} marks={p.marks} />)}
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="exbtn" onClick={close}>↩️ رجوع</button>
    </div>
  );
}

/** ⚖️ المقارنة: كل ورقة بدرجة المرجع (المصحح اللي صححها بإيده) ومؤمل وقصي، وبالآخر منو أقرب وشگد كلف */
function CompareBox({ exam, n, setN, busy, call }: { exam: number; n: string; setN: (v: string) => void; busy: boolean; call: Call }) {
  const [data, setData] = useState<CmpRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = (b: Record<string, unknown>) => void call({ ...b, exam }).then((d) => { if (d?.cmp?.exam === exam) setData(d.cmp.rows); });
  useEffect(() => { load({ action: "compareView" }); }, [exam]);
  const rows = data ?? [];
  const both = rows.filter((r) => r.ref && r.mu && r.qg);
  const gap = (k: "mu" | "qg") => both.length ? Math.round((both.reduce((t, r) => t + Math.abs(r[k]!.total - r.ref!.total), 0) / both.length) * 10) / 10 : null;
  const near = (k: "mu" | "qg") => both.length ? Math.round((both.filter((r) => Math.abs(r[k]!.total - r.ref!.total) <= 3).length / both.length) * 100) : null;
  const cost = (k: "mu" | "qg") => { const l = rows.filter((r) => r[k]); return l.length ? Math.round((l.reduce((t, r) => t + r[k]!.usd, 0) / l.length) * 1600) : null; };
  const cell = (r: CmpRow, k: "mu" | "qg") => r[k] ? <b>{r[k]!.total}</b> : r[k === "mu" ? "muErr" : "qgErr"] ? <small className="exbad">⚠️ {r[k === "mu" ? "muErr" : "qgErr"]}</small> : <small>⏳</small>;
  return (
    <div className="tidyview">
      <div className="exhint">نفس الأوراق يصححها نظام مؤمل وتصحيح قصي، كل واحد بالسر (ولا شي يوصل للطالب ولا تتغير درجته). أول شي ياخذ الأوراق اللي صححها مصحح بإيده، حتى نعرف منو أقرب لدرجته، وبعدها أوراق طلاب التجربة. صحح إنت كم ورقة بإيدك حتى تكون إنت المرجع.</div>
      <div className="aig-logrow">
        <input type="number" inputMode="numeric" min={1} max={30} value={n} onChange={(x) => setN(x.target.value)} style={{ width: 70 }} />
        <button type="button" className="exbtn" disabled={busy} onClick={() => load({ action: "compare", n: Number(n) })}>⚖️ قارن على {n} ورقة</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => load({ action: "compareView" })}>📊 شوف النتائج</button>
      </div>
      {!!rows.length && <>
        <div className="aig-stats">
          على {both.length} ورقة إلها درجة مصحح: فرق مؤمل عنها <b>{gap("mu") ?? "—"}</b> درجة (قريبة {near("mu") ?? "—"}%) · فرق قصي <b>{gap("qg") ?? "—"}</b> درجة (قريبة {near("qg") ?? "—"}%)
          <br />كلفة الورقة: مؤمل <b>{cost("mu") ?? "—"}</b> دينار · قصي <b>{cost("qg") ?? "—"}</b> دينار
        </div>
        <table className="aig-money">
          <thead><tr><th>الورقة</th><th>المصحح</th><th>مؤمل</th><th>قصي</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: "pointer" }}>
              <td>{r.name}{r.waiting ? " ⏳" : ""}</td><td>{r.ref ? <b>{r.ref.total}</b> : <small>ما مصححة</small>}</td><td>{cell(r, "mu")}</td><td>{cell(r, "qg")}</td>
            </tr>
          ))}</tbody>
        </table>
        {open !== null && (() => {
          const r = rows.find((x) => x.id === open);
          if (!r) return null;
          const ns = [...new Set([...(r.mu?.qs ?? []), ...(r.qg?.qs ?? [])].map((q) => q.n))].sort((a, b) => a - b);
          return (
            <div className="card expad">
              <div className="exlabel">{r.name}: سؤال سؤال</div>
              {ns.map((qn) => {
                const m = r.mu?.qs.find((q) => q.n === qn), g = r.qg?.qs.find((q) => q.n === qn);
                return (
                  <div key={qn} className="aig-logrow"><div style={{ minWidth: 0, flex: 1 }}>
                    <b>س{qn}</b> (من {m?.max ?? g?.max}) · المصحح <b>{r.ref?.qs[String(qn)] ?? "—"}</b> · مؤمل <b>{m?.score ?? "—"}</b> · قصي <b>{g?.score ?? "—"}</b>
                    {m?.reason && <div><small>مؤمل: <Inline text={m.reason} /></small></div>}
                    {g?.reason && <div><small>قصي: <Inline text={g.reason} /></small></div>}
                  </div></div>
                );
              })}
            </div>
          );
        })()}
        <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "compareSide", exam })}>⚖️ شوف الأوراق جنب بعض (تصحيحك، مؤمل، قصي)</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => load({ action: "compareRedoAll" })}>🔁 أعد الاثنين على نفس الأوراق</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => load({ action: "compareRedoQ" })}>🔁 أعد قصي بس على نفس الأوراق (إذا غيرت إعداداته لو قواعده)</button>
        <button type="button" className="exbtn" disabled={busy} onClick={() => load({ action: "compareClear" })}>🗑 امسح نتائج المقارنة بهذا الموضوع</button>
      </>}
    </div>
  );
}

/** سؤال واحد: زر «📝 التصحيح» وجنبه «📷 ورقة الطالب»، كل واحد يطلع لحاله. الرياضيات بشكل الكتاب (الكسر أفقي، π) */
function QView({ q, photos, fileUrl, teach, hide, busy }: { q: Q; photos: string[]; fileUrl: (ref: string) => string; teach?: (i: number, mark: number, why: string) => Promise<unknown>; hide?: (key: string) => Promise<unknown>; busy?: boolean }) {
  const marked = !!q.marked?.some((p) => p.marks.length);
  // «✏️ صلّح وعلّمه»: درجة الخطوة الصح وليش، وجوابه يصير قاعدة بهذا الموضوع
  const [fix, setFix] = useState<number | null>(null);
  const [mark, setMark] = useState("");
  const [why, setWhy] = useState("");
  // العلامة اللي داس عليها بالورقة (طلبه 2026-11-23: يصلح على الورقة نفسها، مو بالكيبورد)
  const [tap, setTap] = useState<{ ref: string; k: number; m: MarkT } | null>(null);
  const [view, setView] = useState<"grade" | "paper" | "marked">(marked ? "marked" : "grade");
  const open = (i: number) => { setFix(i); setMark(String(q.steps[i]?.awarded ?? 0)); setWhy(""); };
  const form = (i: number) => {
    const s = q.steps[i];
    if (!s || !teach) return null;
    return (
      <div className="form">
        <label>✏️ الدرجة الصح لهاي الخطوة (من {s.points})</label>
        <input type="number" inputMode="numeric" min={0} max={s.points} value={mark} onChange={(x) => setMark(x.target.value)} style={{ width: 90 }} />
        <label>ليش؟ احچيها 🎤 لو اكتبها (هذا اللي يتعلمه ويطبقه بكل ورقة جاية)</label>
        <VoiceText value={why} onChange={setWhy} rows={3} maxLength={1500} />
        <button type="button" className="btn" disabled={busy || mark === "" || Number(mark) < 0 || Number(mark) > s.points || why.trim().length < 4}
          onClick={() => void teach(i, Number(mark), why).then(() => { setFix(null); setWhy(""); setTap(null); })}>🧠 احفظ وعلّمه</button>
        <button type="button" className="exbtn" onClick={() => setFix(null)}>✖ إلغاء</button>
      </div>
    );
  };
  return (
    <div className="card expad">
      <div className="exlabel">السؤال {q.n}: {q.score} من {q.max}{q.human !== null && <> · المصحح {q.human}</>} {q.sure ? "" : "⚠️ ما متأكد"}</div>
      <div className="aicview">
        {marked && <button type="button" className={view === "marked" ? "on" : ""} onClick={() => setView("marked")}>🖍 على الورقة</button>}
        <button type="button" className={view === "grade" ? "on" : ""} onClick={() => setView("grade")}>📝 التصحيح</button>
        <button type="button" className={view === "paper" ? "on" : ""} onClick={() => setView("paper")}>📷 ورقة الطالب{photos.length ? "" : " (ماكو)"}</button>
      </div>
      {view === "marked" && marked ? <>
        {teach && <div className="exhint">👆 دوس على أي علامة بالورقة حتى تشيلها لو تصلح درجتها.</div>}
        {q.marked!.map((p) => (
          <div key={p.ref}>
            <MarkedPage src={fileUrl(p.ref)} marks={p.marks} picked={tap?.ref === p.ref ? tap.k : undefined}
              onTap={teach ? (m, k) => { setTap({ ref: p.ref, k, m }); open(m.i !== undefined && m.i >= 0 ? m.i : q.steps.findIndex((s) => s.awarded < s.points) >= 0 ? q.steps.findIndex((s) => s.awarded < s.points) : 0); } : undefined} />
            {tap?.ref === p.ref && (
              <div className="card expad">
                <div className="exlabel">{tap.m.big ? "✓ السؤال كله صح" : tap.m.kind === "miss" ? "؟ ناقص" : "✗ غلط"}{tap.m.note ? <> · <Inline text={tap.m.note} /></> : null}</div>
                {hide && <button type="button" className="exbtn" disabled={busy} onClick={() => void hide(`${q.n}:${tap.m.i ?? -1}:${tap.m.kind}`).then(() => setTap(null))}>🗑 شيل هاي العلامة (مكانها غلط، والدرجة صح)</button>}
                {q.steps.length > 1 && (
                  <select value={fix ?? 0} onChange={(e) => open(Number(e.target.value))}>
                    {q.steps.map((s, i) => <option key={i} value={i}>{i + 1}. {s.awarded}/{s.points} · {s.text.slice(0, 60)}</option>)}
                  </select>
                )}
                {fix !== null && <><MathText text={q.steps[fix]?.text ?? ""} />{form(fix)}</>}
                <button type="button" className="exbtn" onClick={() => { setTap(null); setFix(null); }}>✖ سد</button>
              </div>
            )}
          </div>
        ))}
      </> : view === "paper" ? photos.map((u) => <img key={u} src={u} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />) : <>
        {q.reason && <div className="exhint"><Inline text={q.reason} /></div>}
        {q.method > 1 && <div className="exhint">صححه على الطريقة {q.method}</div>}
        {q.steps.map((s, i) => (
          <div key={i} className="aig-logrow"><div style={{ minWidth: 0, flex: 1 }}>
            {s.awarded >= s.points ? "✅" : s.awarded > 0 ? "◐" : "❌"} <b>{s.awarded}/{s.points}</b>
            <MathText text={s.text} />
            {s.note && <small><Inline text={s.note} /></small>}
            {teach && (fix === i && !tap ? form(i) : <button type="button" className="exbtn" disabled={busy} onClick={() => { setTap(null); open(i); }}>✏️ صلّح</button>)}
          </div></div>
        ))}
      </>}
    </div>
  );
}

function PaperView({ p, fileUrl, busy, call, close }: { p: Paper; fileUrl: (ref: string) => string; busy: boolean; call: Call; close: () => void }) {
  return (
    <div className="exfull" style={{ background: "var(--ink)" }}>
      <button type="button" className="exbtn" onClick={close}>↩️ رجوع</button>
      <div className="card expad">
        <div className="exlabel">{p.name} · {p.exam}</div>
        <div className="aig-stats">
          تصحيح قصي: <b>{p.total}</b>{p.human !== null && <> · المصحح: <b>{p.human}</b></>} · {p.iqd} دينار{p.batch && " (بالدفعة)"}
          <br />{p.kind === "trial" ? "🧪 تجربة بالسر، ما وصلت للطالب" : p.sent ? "✅ هو صححها ووصلت الدرجة للطالب" : "↩️ ما كان متأكد، فرجعها للمصححين"}
        </div>
        {/* 🖍 يعيد تصحيحها بالعلامات الحمرة على الورقة، لحالها: درجتها الأصلية ما تتغير */}
        {p.demo && <div className="exhint">🖍 العلامات على الورقة: صححها مرة ثانية بالعلامات ({p.demo.at}) وانطاها <b>{p.demo.total}</b> · {p.demo.iqd} دينار. شوف «🖍 على الورقة» بكل سؤال.</div>}
        {p.demoWaiting ? <div className="exhint">🖍 تنتظر: خلال دقيقة لو دقيقتين ترسم العلامات. دوس 🔄 حدّث وافتح 👁 مرة ثانية.</div>
          : <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "marks", id: p.id })}>🖍 {p.demo ? "أعد" : "جرب"} العلامات على هاي الورقة (كلفة ورقة وحدة)</button>}
      </div>
      <div className="exhint">✏️ إذا خطوة درجتها غلط: افتح «📝 التصحيح» بالسؤال ← ✏️ صلّح ← الدرجة الصح وليش ← 🧠 احفظ وعلّمه. يصلح هاي الورقة، ويتعلمها لكل ورقة جاية بهذا الموضوع.</div>
      {p.qs.map((q) => <QView key={q.n} q={q} fileUrl={fileUrl} photos={p.photos.filter((f) => f.q === q.n).map((f) => fileUrl(f.ref))} busy={busy}
        teach={(i, mark, why) => call({ action: "teach", id: p.id, q: q.n, i, mark, why })} hide={(key) => call({ action: "hideMark", id: p.id, key })} />)}
      {p.photos.some((f) => !f.q) && (
        <div className="card expad">
          <div className="exlabel">صفحات الورقة</div>
          {p.photos.filter((f) => !f.q).map((f) => <img key={f.ref} src={fileUrl(f.ref)} alt="" style={{ width: "100%", minWidth: 0, marginTop: 6 }} />)}
        </div>
      )}
      <button type="button" className="exbtn" onClick={close}>↩️ رجوع</button>
    </div>
  );
}
