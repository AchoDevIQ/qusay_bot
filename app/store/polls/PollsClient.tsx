"use client";
// التصويت: سؤال وكم اختيار لفئة يختارها صاحب البوت (الكل، مراكز معينة، بنين أو بنات بس).
// يوصل للطلاب بالبوت، كل طالب يصوت مرة وحدة من حسابه. النتيجة هنا كاملة بالأسماء، وللطلاب النسب بس إذا وافق
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";

type Name = { id: number; name: string; where: string; at: string };
type Res = { voted: number; targets: number; options: { text: string; count: number; pct: number; names: Name[] }[] };
type Poll = { id: number; question: string; options: string[]; centers: number[]; gender: string; status: "open" | "closed"; created: string; closed_at: string; shown: boolean | null; target: string; results: Res };
type Data = { polls: Poll[]; centers: { id: number; name: string }[]; genders: string[]; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

export default function PollsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/polls", "🗳 التصويت");
  return (
    <>
      <AdminHeader title="🗳 التصويت" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <NewPoll data={data} busy={busy} call={call} />}
        {data && !data.polls.length && <div className="empty">ماكو تصويتات بعد.</div>}
        {data?.polls.map((p) => <PollCard key={p.id} p={p} busy={busy} call={call} />)}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function NewPoll({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [centers, setCenters] = useState<number[]>([]);
  const [gender, setGender] = useState("");
  const [sure, setSure] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = !!question.trim() && filled.length >= 2;
  const toggle = (id: number) => setCenters((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const who = `${centers.length ? data.centers.filter((c) => centers.includes(c.id)).map((c) => c.name).join("، ") : "كل الطلاب"}${gender ? ` · ${gender} بس` : ""}`;
  async function create() {
    const r = await call({ action: "create", question, options: filled, centers, gender });
    if (r) { setQuestion(""); setOptions(["", ""]); setCenters([]); setGender(""); setSure(false); setOpen(false); }
  }
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>➕ تصويت جديد</button>;
  return (
    <div className="card expad">
      <h2>➕ تصويت جديد</h2>
      <div className="exlabel">السؤال</div>
      <textarea className="plq" rows={2} value={question} maxLength={500} placeholder="مثال: شنو أحسن يوم للمراجعة؟" onChange={(e) => { setQuestion(e.target.value); setSure(false); }} />
      <div className="exlabel">الاختيارات (من 2 لـ 10)</div>
      {options.map((o, i) => (
        <div className="exadd plopt" key={i}>
          <input value={o} maxLength={100} placeholder={`الاختيار ${i + 1}`} onChange={(e) => { setOptions(options.map((x, j) => (j === i ? e.target.value : x))); setSure(false); }} />
          {options.length > 2 && <button type="button" className="exbtn" aria-label="شيل الاختيار" onClick={() => setOptions(options.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {options.length < 10 && <button type="button" className="exbtn" onClick={() => setOptions([...options, ""])}>➕ اختيار ثاني</button>}
      <div className="exlabel">منو يصوت: المراكز</div>
      <div className="exhint">ما تختار ولا مركز = كل الطلاب. تگدر تختار أكثر من مركز.</div>
      <div className="plchips">
        <button type="button" className={"exbtn" + (!centers.length ? " on" : "")} onClick={() => { setCenters([]); setSure(false); }}>👥 الكل</button>
        {data.centers.map((c) => <button type="button" key={c.id} className={"exbtn" + (centers.includes(c.id) ? " on" : "")} onClick={() => { toggle(c.id); setSure(false); }}>{c.name}</button>)}
      </div>
      <div className="exlabel">منو يصوت: الجنس</div>
      <div className="plchips">
        {["", ...data.genders].map((g) => <button type="button" key={g || "all"} className={"exbtn" + (gender === g ? " on" : "")} onClick={() => { setGender(g); setSure(false); }}>{g || "👥 الكل"}</button>)}
      </div>
      {gender && <div className="exhint">الطالب اللي ما مسجل جنسه بالتسجيل ما يوصله هذا التصويت.</div>}
      <div className="exfoot">
        <div className="exhint">يوصل لـ: <b>{who}</b>. كل طالب يصوت مرة وحدة من حسابه، وبعد ما يأكد ما يگدر يغير.</div>
        <div className="exadd">
          {sure
            ? <button type="button" className="exbtn danger" disabled={busy || !ready} onClick={() => void create()}>⚠️ متأكد؟ اضغط حتى ينرسل</button>
            : <button type="button" className="btn" disabled={busy || !ready} onClick={() => setSure(true)}>📤 أرسل التصويت</button>}
          <button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(false)}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function PollCard({ p, busy, call }: { p: Poll; busy: boolean; call: Call }) {
  const [names, setNames] = useState(false);
  const r = p.results;
  return (
    <div className="card expad">
      <h2>{p.status === "open" ? "🟢" : "🔒"} {p.question}</h2>
      <div className="exhint">👥 {p.target} · صوّت <b>{r.voted}</b> من {r.targets} طالب · {p.status === "open" ? "مفتوح هسه" : "منتهي"}{p.status === "closed" ? ` · ${p.shown === true ? "📢 النتيجة منشورة للطلاب" : p.shown === false ? "🙈 ما انعرضت للطلاب" : "⏳ ما قررت تنشرها"}` : ""}</div>
      {r.options.map((o, i) => (
        <div key={i} className="plres">
          <div className="plrow"><b>{o.text}</b><span>{o.count} صوت · <b>{o.pct}%</b></span></div>
          <div className="plbar"><span style={{ width: `${o.pct}%` }} /></div>
          {names && !!o.names.length && <ol className="plnames">{o.names.map((n) => <li key={n.id}>{n.name}{n.where && <small> · {n.where}</small>}</li>)}</ol>}
        </div>
      ))}
      <div className="exadd">
        {r.voted > 0 && <button type="button" className="exbtn" onClick={() => setNames(!names)}>{names ? "إخفاء الأسماء" : "👁 الأسماء"}</button>}
        {p.status === "open" && <Confirm label="🔒 إنهاء التصويت" disabled={busy} onYes={() => void call({ action: "close", id: p.id })} />}
        {p.status === "closed" && p.shown !== true && <Confirm label="📢 انشر النسب للطلاب" disabled={busy} onYes={() => void call({ action: "publish", id: p.id })} />}
        <Confirm label="🗑 حذف" disabled={busy} onYes={() => void call({ action: "delete", id: p.id })} />
      </div>
    </div>
  );
}
