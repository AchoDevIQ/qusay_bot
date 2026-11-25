"use client";
// 🛤 مساري: «مسارك ويا قصي العميري». كل موضوع بطاقة لحاله، جواها المحاضرات بالترتيب والامتحانات بمكانها والسيطرة 🚦.
// المحاضرة المفتوحة تنفتح بالتطبيق نفسه (ويا ملحقاتها). الجاية مقفولة لحد ما يكمل اللي قبلها للآخر
import { useEffect, useState } from "react";
import { pageAuth, pageToken } from "../adminPage";

type Step =
  | { kind: "lec"; id: string; title: string; n: number; state: "done" | "open" | "locked" | "buy"; pct: number }
  | { kind: "exam"; id: number; title: string; state: string; at?: string; total?: number | null; since?: number; from?: string; cp?: Cp | null }
  | { kind: "cp"; exam: number; min: number; absent: number; count: number; title?: string };
type Section = { name: string; general?: boolean; steps: Step[] };
type Honor = { min: number; bday?: boolean; addr?: boolean };
type Cp = { min: number; absent: number; honor: Honor | null; stopImg?: string; topImg?: string };
type Path = { ch: number; chapters: { ch: number; name: string }[]; lecturesBought: boolean; sections: Section[]; stopped: boolean; pickTimes?: boolean; teacher?: boolean };

// الرمز من الرابط، أو المحفوظ بالصفحة (لوحة التحكم تفتح صفحاتها بدون الرمز بالرابط)
const token = () => pageToken();
/** «امتحاناتي» من جوه مساري (نفس الدخول): المواعيد، ودخول الامتحان، والدرجة والورقة */
const examsLink = () => { const q = new URLSearchParams(location.search); const app = q.get("app"); return `/store/myexams?t=${encodeURIComponent(token())}${app ? `&app=${encodeURIComponent(app)}` : ""}`; };
async function api(body: Record<string, unknown>) {
  const r = await fetch("/api/path", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token(), ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "صار خطأ");
  return j;
}
const when = (at?: string) => {
  if (!at) return "";
  const d = new Date(at.replace(" ", "T"));
  return d.toLocaleString("ar-IQ", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
};
const EXAM: Record<string, string> = { buy: "🔒 اشتري امتحانات الفصل", nodate: "🗓 بعده ما انحط موعده", locked: "🗓 موعده", open: "🟢 مفتوح هسه، دوس هنا وادخله", missed: "❌ فاتك", done: "✅ قدمته، ينتظر التصحيح", graded: "✅ درجتك" };

export default function PathClient() {
  const [p, setP] = useState<Path | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState("");
  const [cpFor, setCpFor] = useState<Extract<Step, { kind: "exam" }> | null>(null);
  const load = (ch?: number) => {
    const q = new URLSearchParams(location.search);
    void api({ action: "state", ch, env: q.get("env") ?? undefined }).then((j: Path) => {
      setP(j); setErr("");
      // القسم اللي بيه الخطوة الجاية ينفتح وحده
      const k = j.sections.findIndex((s) => s.steps.some((x) => (x.kind === "lec" && x.state === "open") || (x.kind === "exam" && x.state === "open")));
      setOpen(k >= 0 ? { [k]: true } : { 0: true });
    }).catch((e) => setErr((e as Error).message));
  };
  useEffect(() => { load(); const f = () => { if (document.visibilityState === "visible") load(p?.ch); }; document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const say = (t: string) => { setMsg(t); window.setTimeout(() => setMsg((x) => (x === t ? "" : x)), 3500); };
  const openLec = (s: Extract<Step, { kind: "lec" }>) => {
    if (s.state === "locked") { say("🔒 كمّل المحاضرة اللي قبلها للآخر، وبعدها تنفتح هاي"); return; }
    if (s.state === "buy") { say("🔒 اشتري محاضرات هذا الفصل من المتجر"); return; }
    void api({ action: "open", lec: s.id }).then(() => {
      // التطبيق يلگف هذا الرابط ويفتح المحاضرة نفسها جوه التطبيق
      location.href = `qmath://lecture/${s.id}`;
    }).catch((e) => say((e as Error).message));
  };
  const renderSec = (sec: Section, i: number) => {
    const lecs = sec.steps.filter((x) => x.kind === "lec") as Extract<Step, { kind: "lec" }>[];
    const done = lecs.length && lecs.every((x) => x.state === "done");
    return (
      <section key={i} className={`qp-sec${sec.general ? " gen" : ""}${done ? " done" : ""}`}>
        <button type="button" className="qp-head" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
          <span className="qp-num">{done ? "✓" : sec.general ? "📝" : "📘"}</span>
          <b>{sec.name}</b>
          {lecs.length > 0 && <small>{lecs.filter((x) => x.state === "done").length}/{lecs.length}</small>}
          <span className="qp-arr">{open[i] ? "▴" : "▾"}</span>
        </button>
        {open[i] && <div className="qp-steps">{sec.steps.map((s, k) => stepView(s, k))}</div>}
      </section>
    );
  };
  const stepView = (s: Step, k: number) => s.kind === "lec" ? (
    <button key={k} type="button" className={`qp-step lec ${s.state}`} onClick={() => openLec(s)}>
      <span className="qp-ic">{s.state === "done" ? "✅" : s.state === "open" ? "▶️" : "🔒"}</span>
      <span className="qp-t"><b>🎬 {s.title}</b><small>{s.state === "done" ? "كملتها" : s.state === "open" ? (s.pct ? `وصلت ${s.pct}٪، كمّلها للآخر` : "هسه دورها") : s.state === "buy" ? "اشتري المحاضرات" : "تنفتح بعد اللي قبلها"}</small></span>
    </button>
  ) : s.kind === "exam" ? (
    <a key={k} className={`qp-step exam ${s.state}`} href={s.state === "buy" ? undefined : examsLink()}>
      <span className="qp-ic">📝</span>
      <span className="qp-t"><b>{s.title}</b><small>{EXAM[s.state] ?? s.state}{s.state === "locked" ? `: ${when(s.at)}` : ""}{s.state === "graded" && s.total !== null && s.total !== undefined ? ` ${s.total}` : ""}</small></span>
      {p?.teacher && <button type="button" className="qp-addcp" onClick={(e) => { e.preventDefault(); setCpFor(s); }}>{s.cp ? "✏️ السيطرة" : "＋ إنشاء سيطرة"}</button>}
    </a>
  ) : null;
  const progress = p ? (() => { const l = p.sections.flatMap((s) => s.steps.filter((x) => x.kind === "lec")) as Extract<Step, { kind: "lec" }>[]; return { done: l.filter((x) => x.state === "done").length, all: l.length }; })() : null;
  return (
    <div className="qp" dir="rtl">
      <style>{CSS}</style>
      <header>
        <img src="/app-logo.png" alt="" />
        <div><b>مسارك ويا قصي العميري</b>{progress && progress.all > 0 && <small>خلصت {progress.done} من {progress.all} محاضرة</small>}</div>
      </header>
      {progress && progress.all > 0 && <div className="qp-bar"><i style={{ width: `${(100 * progress.done) / progress.all}%` }} /></div>}
      {/* معاينة الأستاذ: داتا التجربة لو الحقيقية */}
      {p && p.chapters.length === 5 && <nav className="qp-ch">{(["prod", "staging"] as const).map((e) => <button key={e} type="button" className={(new URLSearchParams(location.search).get("env") ?? "prod") === e ? "on" : ""} onClick={() => { const q = new URLSearchParams(location.search); q.set("env", e); location.search = q.toString(); }}>{e === "prod" ? "محاضرات التطبيق الحقيقية" : "داتا التجربة"}</button>)}</nav>}
      {p && p.chapters.length > 1 && <nav className="qp-ch">{p.chapters.map((c) => <button key={c.ch} type="button" className={c.ch === p.ch ? "on" : ""} onClick={() => load(c.ch)}>{c.name}</button>)}</nav>}
      {p?.pickTimes && <a className="qp-go" href={examsLink()}>🗓 أول شي: اختار أوقات امتحاناتك<small>دوس هنا، وبعدها ينفتحلك مسارك كله</small></a>}
      {p?.stopped && <div className="qp-stop">⛔ المنصة موقوفة عليك بسبب السيطرة. شوف رسالتها بالمحادثة، وراجع الإدارة.</div>}
      {err && <div className="qp-msg">{err}</div>}
      {!err && !p && <div className="qp-msg">جاري التحميل...</div>}
      {p && !p.sections.length && <div className="qp-msg">بعده ما أكو محاضرات بهذا الفصل</div>}
      {p && splitAtCp(p.sections).map((part, i) => part.band ? (
        <div key={`b${i}`} className="qp-band">
          <span className="qp-bico">🚦</span>
          <span className="qp-t"><b>سيطرة{part.band.title ? ` بعد «${part.band.title}»` : ""}</b><small>آخر {part.band.count} امتحانات: لازم المجموع {part.band.min} أو أكثر{part.band.absent ? `، وإذا غاب ${part.band.absent} تنوقف المنصة` : ""}</small></span>
        </div>
      ) : renderSec(part.sec!, part.i!))}
      {p?.teacher && <a className="qp-link" href={`/store/checkpoints?t=${encodeURIComponent(token())}`}>⛔ الموقوفين، ورسالة الإيقاف وصورته</a>}
      {cpFor && <CpDialog step={cpFor} onClose={() => setCpFor(null)} onSaved={(t) => { setCpFor(null); say(t); load(p?.ch); }} />}
      {msg && <div className="qp-toast">{msg}</div>}
    </div>
  );
}

/** 🚦 السيطرة ورا هذا الامتحان: تشمل الامتحانات من بعد السيطرة اللي قبلها. المجموع، الغياب، وقائمة المتفوقين */
function CpDialog({ step, onClose, onSaved }: { step: Extract<Step, { kind: "exam" }>; onClose: () => void; onSaved: (notice: string) => void }) {
  const n = step.since ?? 1, max = n * 100;
  const [min, setMin] = useState(String(step.cp?.min ?? max / 2));
  const [absent, setAbsent] = useState(step.cp?.absent ?? Math.min(2, n));
  const [honorOn, setHonorOn] = useState(!!step.cp?.honor);
  const [hMin, setHMin] = useState(String(step.cp?.honor?.min ?? 99));
  const [bday, setBday] = useState(!!step.cp?.honor?.bday);
  const [addr, setAddr] = useState(!!step.cp?.honor?.addr);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const call = async (body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/checkpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: pageAuth(), ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "صار خطأ");
      onSaved(j.notice || "✅ انحفظت");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (kind: "top" | "stop", f: File | null) => {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.set("initData", pageAuth()); fd.set("action", "cpImage"); fd.set("exam", String(step.id)); fd.set("kind", kind);
      if (f) fd.set("file", f); else fd.set("dropImage", "1");
      const r = await fetch("/api/checkpoints", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "صار خطأ");
      onSaved(j.notice || "✅ انحفظت");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = () => void call({ action: "saveCp", exam: step.id, min: Number(min) || 0, absent, honor: honorOn ? { min: Number(hMin) || 0, bday, addr } : null });
  return (
    <div className="qp-dlg" onClick={onClose}>
      <div className="qp-box" onClick={(e) => e.stopPropagation()}>
        <b className="qp-dt">🚦 سيطرة بعد «{step.title}»</b>
        <div className="qp-dh">تشمل <b>{n}</b> امتحان{n > 1 ? `ات، من «${step.from}» لحد هذا` : ""}. المجموع الكلي <b>{max}</b>. وبعدها الحساب يتصفّى ويبدي من جديد.</div>
        <label className="qp-l">أقل مجموع يعبر بيه (من {max})
          <input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} />
        </label>
        <div className="qp-dh">اللي يجيب أقل من {Number(min) || 0}، تنوقف عليه المنصة. 0 = المجموع ما يوقف.</div>
        <div className="qp-l">يوقف إذا غاب</div>
        <div className="qp-chips">{Array.from({ length: n + 1 }, (_, i) => i).map((i) => <button key={i} type="button" className={absent === i ? "on" : ""} onClick={() => setAbsent(i)}>{i === 0 ? "ما يوقف" : `${i}`}</button>)}</div>
        <div className="qp-dh">{absent ? `إذا غاب ${absent} من ${n} أو أكثر، تنوقف المنصة (يعني لازم يحضر ${n - absent + 1} على الأقل).` : "الغياب وحده ما يوقف."}</div>
        <label className="qp-check"><input type="checkbox" checked={honorOn} onChange={(e) => setHonorOn(e.target.checked)} /> 🏆 دزلي قائمة المتفوقين PDF</label>
        {honorOn && <>
          <div className="qp-l">معدلهم بكل امتحان (من 100) فما فوق</div>
          <div className="qp-chips">{[100, 99, 98, 95, 90].map((v) => <button key={v} type="button" className={hMin === String(v) ? "on" : ""} onClick={() => setHMin(String(v))}>{v}</button>)}
            <input className="qp-small" inputMode="numeric" value={hMin} onChange={(e) => setHMin(e.target.value.replace(/\D/g, ""))} /></div>
          <label className="qp-check"><input type="checkbox" checked={bday} onChange={(e) => setBday(e.target.checked)} /> 🎂 بس اللي عيد ميلادهم صادف بفترة هالامتحانات</label>
          <label className="qp-check"><input type="checkbox" checked={addr} onChange={(e) => setAddr(e.target.checked)} /> 🏠 ويا عنوانهم الكامل (حتى تسويلهم هدية ومفاجأة)</label>
          <div className="qp-dh">تجيك القائمة مرة وحدة، بعد ما آخر امتحان بهالسيطرة ينصحح كله.</div>
        </>}
        {step.cp && <div className="qp-pics">
          <Pic label="🏆 صورة أو فيديو المتفوقين" hint={`توصل اللي جابوا معدل ${step.cp.honor?.min ?? 95} فما فوق، ويا تهنئة`} url={step.cp.topImg} onPick={(f) => void upload("top", f)} onDrop={() => void upload("top", null)} busy={busy} />
          <Pic label="⛔ صورة أو فيديو الموقوفين" hint="توصل اللي توقف عليه بهالسيطرة (بدل الصورة العامة)" url={step.cp.stopImg} onPick={(f) => void upload("stop", f)} onDrop={() => void upload("stop", null)} busy={busy} />
        </div>}
        {!step.cp && <div className="qp-dh">بعد ما تحفظ السيطرة، تگدر تحط صورة للمتفوقين وصورة للموقوفين.</div>}
        {err && <div className="qp-err">{err}</div>}
        <div className="qp-btns">
          <button type="button" className="ok" disabled={busy} onClick={save}>💾 حفظ السيطرة</button>
          {step.cp && <button type="button" className="bad" disabled={busy} onClick={() => { if (confirm("تحذف هاي السيطرة؟")) void call({ action: "delCp", exam: step.id }); }}>🗑 حذفها</button>}
          <button type="button" disabled={busy} onClick={onClose}>رجوع</button>
        </div>
      </div>
    </div>
  );
}

function Pic({ label, hint, url, onPick, onDrop, busy }: { label: string; hint: string; url?: string; onPick: (f: File) => void; onDrop: () => void; busy: boolean }) {
  return (
    <div className="qp-pic">
      <b>{label}</b><small>{hint}</small>
      {url ? (/\.mp4/.test(decodeURIComponent(url)) ? <video src={url} controls playsInline /> : <img src={url} alt="" />) : <span className="qp-nopic">ماكو صورة ولا فيديو</span>}
      <div className="qp-chips">
        <label className="qp-up">{url ? "🔄 بدّلها" : "🖼 صورة أو 🎬 فيديو"}<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} /></label>
        {url && <button type="button" disabled={busy} onClick={onDrop}>🗑 شيلها</button>}
      </div>
    </div>
  );
}

/** الأقسام تنقسم عند كل سيطرة: الموضوع، بعده شريط السيطرة الطويل، بعده باقي الموضوع (تكملة) */
function splitAtCp(sections: Section[]): { sec?: Section; i?: number; band?: Extract<Step, { kind: "cp" }> }[] {
  const out: { sec?: Section; i?: number; band?: Extract<Step, { kind: "cp" }> }[] = [];
  let i = 0;
  for (const sec of sections) {
    let cur: Step[] = [], first = true;
    for (const st of sec.steps) {
      if (st.kind === "cp") {
        if (cur.length) out.push({ sec: { ...sec, name: first ? sec.name : `${sec.name} (تكملة)`, steps: cur }, i: i++ });
        out.push({ band: st });
        cur = []; first = false;
      } else cur.push(st);
    }
    if (cur.length) out.push({ sec: { ...sec, name: first ? sec.name : `${sec.name} (تكملة)`, steps: cur }, i: i++ });
  }
  return out;
}

const CSS = `
.qp{min-height:100vh;background:#F5F6FA;color:#141F33;font-family:QAppAr,Cairo,Tahoma,sans-serif;padding-bottom:40px}
.qp header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:linear-gradient(#1F2E4A,#121C2F);color:#fff;padding:10px 16px;border-bottom:3px solid #F6C94A}
.qp header img{width:46px;height:46px;object-fit:cover;object-position:52% 54%;transform:scale(1.5)}
.qp header div{display:flex;flex-direction:column}
.qp header b{color:#F6C94A;font-size:19px}
.qp header small{color:#C9D1E0;font-size:13px}
.qp-bar{height:6px;background:#E3E7EF}.qp-bar i{display:block;height:100%;background:linear-gradient(90deg,#F6C94A,#D9A62E)}
.qp-ch{display:flex;gap:8px;overflow-x:auto;padding:12px 16px 0}
.qp-ch button{flex:none;min-height:44px;border:1px solid #D5DAE5;background:#fff;border-radius:22px;padding:0 16px;font:inherit;font-weight:700;color:#141F33}
.qp-ch button.on{background:#141F33;color:#F6C94A;border-color:#141F33}
.qp-stop{margin:14px 16px 0;background:#FFE9E9;border:1px solid #F5B5B5;color:#8A1F1F;border-radius:12px;padding:12px;font-weight:700;line-height:1.7}
.qp-sec{margin:14px 16px 0;background:#fff;border-radius:14px;box-shadow:0 1px 6px rgba(20,31,51,.08);overflow:hidden;border:1px solid #E6E9F0}
.qp-sec.gen{border-color:#F6C94A}
.qp-head{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:10px 14px;background:none;border:0;font:inherit;color:inherit;text-align:right}
.qp-head b{flex:1;font-size:17px}.qp-head small{color:#6B7488;font-weight:700}
.qp-num{width:32px;height:32px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#141F33;color:#F6C94A;font-weight:800}
.qp-sec.done .qp-num{background:#2E9E5B;color:#fff}
.qp-arr{color:#8A93A6}
.qp-steps{border-top:1px solid #EEF0F5;padding:6px 10px 10px}
.qp-step{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;margin-top:6px;padding:8px 10px;border-radius:12px;background:#F7F8FB;border:1px solid transparent;font:inherit;color:inherit;text-align:right}
.qp-step.lec.open{background:#FFF8E1;border-color:#F6C94A}
.qp-step.lec.locked,.qp-step.lec.buy{opacity:.55}
.qp-step.exam{background:#EEF3FF}.qp-step.exam.open{background:#E3F8EA;border-color:#2E9E5B}
.qp-step.cp{background:#FFF1E6;border:1px dashed #E67E22}
.qp-ic{font-size:20px;width:28px;text-align:center;flex:none}
.qp-t{display:flex;flex-direction:column;min-width:0}.qp-t b{font-size:15px}.qp-t small{color:#5C667A;font-size:13px;line-height:1.5}
.qp-go{display:flex;flex-direction:column;gap:4px;margin:14px 16px 0;padding:16px;border-radius:14px;background:#141F33;color:#F6C94A;font-weight:800;font-size:18px;text-decoration:none;box-shadow:0 4px 14px rgba(20,31,51,.25)}.qp-go small{color:#C9D1E0;font-weight:600;font-size:13px}
a.qp-step{text-decoration:none}
.qp-addcp{flex:none;margin-inline-start:auto;min-height:40px;border:1px dashed #E67E22;background:#fff;color:#B35900;border-radius:10px;padding:0 10px;font:inherit;font-weight:700;font-size:13px}
.qp-link{display:block;margin:18px 16px 0;text-align:center;color:#141F33;font-weight:700}
.qp-dlg{position:fixed;inset:0;z-index:20;background:rgba(10,15,25,.55);display:flex;align-items:flex-end;justify-content:center}
.qp-box{width:min(560px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px 18px 0 0;padding:18px 16px 22px;display:flex;flex-direction:column;gap:8px}
.qp-dt{font-size:18px}.qp-dh{color:#5C667A;font-size:14px;line-height:1.7}
.qp-l{display:flex;flex-direction:column;gap:6px;font-weight:700;margin-top:6px}
.qp-l input,.qp-small{min-height:46px;border:1px solid #D5DAE5;border-radius:10px;padding:0 12px;font:inherit;font-size:17px}
.qp-small{width:90px}
.qp-chips{display:flex;flex-wrap:wrap;gap:8px}
.qp-chips button{min-height:44px;min-width:52px;border:1px solid #D5DAE5;background:#fff;border-radius:10px;font:inherit;font-weight:700}
.qp-chips button.on{background:#141F33;color:#F6C94A;border-color:#141F33}
.qp-check{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:700}
.qp-check input{width:22px;height:22px}
.qp-err{color:#B00020;font-weight:700}
.qp-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.qp-btns button{flex:1;min-height:50px;border-radius:12px;border:1px solid #D5DAE5;background:#fff;font:inherit;font-weight:800}
.qp-btns .ok{background:#141F33;color:#F6C94A;border-color:#141F33}.qp-btns .bad{color:#B00020;border-color:#F2B8B5}
.qp-band{display:flex;align-items:center;gap:12px;margin:14px 16px 0;padding:14px 16px;border-radius:14px;background:linear-gradient(90deg,#E67E22,#F6A04D);color:#fff;box-shadow:0 2px 10px rgba(230,126,34,.35)}
.qp-band .qp-t small{color:#FFF3E6}.qp-band .qp-t b{font-size:17px}
.qp-bico{font-size:26px}
.qp-pics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
.qp-pic{display:flex;flex-direction:column;gap:6px;border:1px solid #E6E9F0;border-radius:12px;padding:10px}
.qp-pic small{color:#5C667A;font-size:12px;line-height:1.5}
.qp-pic img,.qp-pic video{width:100%;max-height:160px;object-fit:contain;border-radius:8px;background:#F5F6FA}
.qp-nopic{display:flex;align-items:center;justify-content:center;height:80px;border:1px dashed #D5DAE5;border-radius:8px;color:#8A93A6;font-size:13px}
.qp-up{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid #D5DAE5;border-radius:10px;font-weight:700;cursor:pointer}
@media (max-width:480px){.qp-pics{grid-template-columns:1fr}}
.qp-msg{max-width:600px;margin:40px auto;padding:0 16px;text-align:center;font-size:18px;line-height:1.8}
.qp-toast{position:fixed;left:16px;right:16px;bottom:20px;background:#141F33;color:#fff;border-radius:12px;padding:12px 14px;text-align:center;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.25)}
`;
