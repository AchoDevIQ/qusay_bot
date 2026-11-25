"use client";
// 🛤 مساري: «مسارك ويا قصي العميري». كل موضوع بطاقة لحاله، جواها المحاضرات بالترتيب والامتحانات بمكانها والسيطرة 🚦.
// المحاضرة المفتوحة تنفتح بالتطبيق نفسه (ويا ملحقاتها). الجاية مقفولة لحد ما يكمل اللي قبلها للآخر
import { useEffect, useState } from "react";

type Step =
  | { kind: "lec"; id: string; title: string; n: number; state: "done" | "open" | "locked" | "buy"; pct: number }
  | { kind: "exam"; id: number; title: string; state: string; at?: string; total?: number | null }
  | { kind: "cp"; exam: number; min: number; absent: number; count: number };
type Section = { name: string; general?: boolean; steps: Step[] };
type Path = { ch: number; chapters: { ch: number; name: string }[]; lecturesBought: boolean; sections: Section[]; stopped: boolean; pickTimes?: boolean };

const token = () => new URLSearchParams(location.search).get("t") ?? "";
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
  const progress = p ? (() => { const l = p.sections.flatMap((s) => s.steps.filter((x) => x.kind === "lec")) as Extract<Step, { kind: "lec" }>[]; return { done: l.filter((x) => x.state === "done").length, all: l.length }; })() : null;
  return (
    <div className="qp" dir="rtl">
      <style>{CSS}</style>
      <header>
        <img src="/app-logo.png" alt="" />
        <div><b>مسارك ويا قصي العميري</b>{progress && progress.all > 0 && <small>خلصت {progress.done} من {progress.all} محاضرة</small>}</div>
      </header>
      {progress && progress.all > 0 && <div className="qp-bar"><i style={{ width: `${(100 * progress.done) / progress.all}%` }} /></div>}
      {p && p.chapters.length > 1 && <nav className="qp-ch">{p.chapters.map((c) => <button key={c.ch} type="button" className={c.ch === p.ch ? "on" : ""} onClick={() => load(c.ch)}>{c.name}</button>)}</nav>}
      {p?.pickTimes && <a className="qp-go" href={examsLink()}>🗓 أول شي: اختار أوقات امتحاناتك<small>دوس هنا، وبعدها ينفتحلك مسارك كله</small></a>}
      {p?.stopped && <div className="qp-stop">⛔ المنصة موقوفة عليك بسبب السيطرة. شوف رسالتها بالمحادثة، وراجع الإدارة.</div>}
      {err && <div className="qp-msg">{err}</div>}
      {!err && !p && <div className="qp-msg">جاري التحميل...</div>}
      {p && !p.sections.length && <div className="qp-msg">بعده ما أكو محاضرات بهذا الفصل</div>}
      {p?.sections.map((sec, i) => {
        const lecs = sec.steps.filter((x) => x.kind === "lec") as Extract<Step, { kind: "lec" }>[];
        const done = lecs.length && lecs.every((x) => x.state === "done");
        return (
          <section key={i} className={`qp-sec${sec.general ? " gen" : ""}${done ? " done" : ""}`}>
            <button type="button" className="qp-head" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              <span className="qp-num">{done ? "✓" : sec.general ? "📝" : i + 1}</span>
              <b>{sec.name}</b>
              {lecs.length > 0 && <small>{lecs.filter((x) => x.state === "done").length}/{lecs.length}</small>}
              <span className="qp-arr">{open[i] ? "▴" : "▾"}</span>
            </button>
            {open[i] && <div className="qp-steps">
              {sec.steps.map((s, k) => s.kind === "lec" ? (
                <button key={k} type="button" className={`qp-step lec ${s.state}`} onClick={() => openLec(s)}>
                  <span className="qp-ic">{s.state === "done" ? "✅" : s.state === "open" ? "▶️" : "🔒"}</span>
                  <span className="qp-t"><b>🎬 {s.title}</b><small>{s.state === "done" ? "كملتها" : s.state === "open" ? (s.pct ? `وصلت ${s.pct}٪، كمّلها للآخر` : "هسه دورها") : s.state === "buy" ? "اشتري المحاضرات" : "تنفتح بعد اللي قبلها"}</small></span>
                </button>
              ) : s.kind === "exam" ? (
                <a key={k} className={`qp-step exam ${s.state}`} href={s.state === "buy" ? undefined : examsLink()}>
                  <span className="qp-ic">📝</span>
                  <span className="qp-t"><b>{s.title}</b><small>{EXAM[s.state] ?? s.state}{s.state === "locked" ? `: ${when(s.at)}` : ""}{s.state === "graded" && s.total !== null && s.total !== undefined ? ` ${s.total}` : ""}</small></span>
                </a>
              ) : (
                <div key={k} className="qp-step cp">
                  <span className="qp-ic">🚦</span>
                  <span className="qp-t"><b>سيطرة</b><small>آخر {s.count} امتحانات: لازم مجموعك {s.min} أو أكثر{s.absent ? `، وإذا غبت ${s.absent} مرات تنوقف المنصة` : ""}</small></span>
                </div>
              ))}
            </div>}
          </section>
        );
      })}
      {msg && <div className="qp-toast">{msg}</div>}
    </div>
  );
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
.qp-msg{max-width:600px;margin:40px auto;padding:0 16px;text-align:center;font-size:18px;line-height:1.8}
.qp-toast{position:fixed;left:16px;right:16px;bottom:20px;background:#141F33;color:#fff;border-radius:12px;padding:12px 14px;text-align:center;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.25)}
`;
