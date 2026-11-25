"use client";
// ⏰ منبه الامتحانات: الطالب يسمع النغمات ويختار وحدة، ويشوف منبهاته الجاية. صاحب البوت يحدد شوكت يرن للكل
import { useEffect, useState } from "react";
import { pageToken } from "../adminPage";

type Tone = { id: string; name: string };
type Alarm = { key: string; at: string; title: string; body: string };
type Cfg = { on: boolean; before: number[]; night: boolean; tone: string };
type Data = { tones: Tone[]; tone: string; alarms: Alarm[]; admin: boolean; cfg: Cfg | null; notice?: string };
const OFF: { m: number; t: string }[] = [{ m: 120, t: "قبل ساعتين" }, { m: 60, t: "قبل ساعة" }, { m: 30, t: "قبل نص ساعة" }, { m: 10, t: "قبل 10 دقايق" }, { m: 0, t: "بوقت الامتحان" }];
const fmt = (iso: string) => new Date(iso).toLocaleString("ar-IQ", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Baghdad" });

export default function AlarmClient() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const api = async (body: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: pageToken(), ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "صار خطأ");
      setD(j); setCfg(j.cfg); setErr(""); if (j.notice) { setMsg(j.notice); window.setTimeout(() => setMsg(""), 3000); }
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void api({ action: "state" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const play = (id: string) => { try { void new Audio(`/alarm-tones/tone_${id}.mp3`).play(); } catch { /* */ } };
  return (
    <div className="qa" dir="rtl">
      <style>{CSS}</style>
      <header><img src="/app-logo.png" alt="" /><div><b>⏰ منبه امتحاناتي</b><small>يرن وحده قبل كل امتحان وبوقته</small></div></header>
      {err && <div className="qa-msg">{err}</div>}
      {d && <>
        <section>
          <h2>🎵 اختار نغمتك</h2>
          <p>دوس ▶ تسمعها، ودوس الاسم تختارها.</p>
          {d.tones.map((t) => (
            <div key={t.id} className={`qa-tone${d.tone === t.id ? " on" : ""}`}>
              <button type="button" className="qa-play" aria-label="اسمع" onClick={() => play(t.id)}>▶</button>
              <button type="button" className="qa-name" onClick={() => void api({ action: "tone", tone: t.id })}>{t.name}{d.tone === t.id ? " ✓" : ""}</button>
            </div>
          ))}
        </section>
        <section>
          <h2>📅 منبهاتك الجاية</h2>
          {!d.alarms.length && <p>ماكو منبهات هسه. من تختار أوقات امتحاناتك تطلع هنا وحدها.</p>}
          {d.alarms.slice(0, 12).map((a) => <div key={a.key} className="qa-al"><b>{a.title}</b><small>{fmt(a.at)} · {a.body}</small></div>)}
          <p className="qa-note">إذا تبدل موعد امتحان، المنبه يتبدل وحده أول ما تفتح التطبيق.</p>
        </section>
        {d.admin && cfg && <section className="qa-admin">
          <h2>⚙️ شوكت يرن (لكل الطلاب)</h2>
          <label className="qa-check"><input type="checkbox" checked={cfg.on} onChange={(e) => setCfg({ ...cfg, on: e.target.checked })} /> المنبه شغّال</label>
          <div className="qa-chips">{OFF.map((o) => <button key={o.m} type="button" className={cfg.before.includes(o.m) ? "on" : ""} onClick={() => setCfg({ ...cfg, before: cfg.before.includes(o.m) ? cfg.before.filter((x) => x !== o.m) : [...cfg.before, o.m] })}>{o.t}</button>)}
            <button type="button" className={cfg.night ? "on" : ""} onClick={() => setCfg({ ...cfg, night: !cfg.night })}>🌙 الليلة اللي قبل (9 م)</button></div>
          <div className="qa-l">النغمة الأساسية (للي ما اختار):</div>
          <div className="qa-chips">{d.tones.map((t) => <button key={t.id} type="button" className={cfg.tone === t.id ? "on" : ""} onClick={() => setCfg({ ...cfg, tone: t.id })}>{t.name}</button>)}</div>
          <button type="button" className="qa-save" onClick={() => void api({ action: "cfg", cfg })}>💾 حفظ</button>
        </section>}
      </>}
      {!d && !err && <div className="qa-msg">جاري التحميل...</div>}
      {msg && <div className="qa-toast">{msg}</div>}
    </div>
  );
}

const CSS = `
.qa{min-height:100vh;background:#F5F6FA;color:#141F33;font-family:QAppAr,Cairo,Tahoma,sans-serif;padding-bottom:40px}
.qa header{display:flex;align-items:center;gap:12px;background:#141F33;color:#fff;padding:10px 16px;border-bottom:3px solid #F6C94A}
.qa header img{width:44px;height:44px;object-fit:cover;object-position:52% 54%;transform:scale(1.5)}
.qa header div{display:flex;flex-direction:column}.qa header b{color:#F6C94A;font-size:19px}.qa header small{color:#C9D1E0}
.qa section{margin:14px 16px 0;background:#fff;border-radius:14px;padding:14px;border:1px solid #E6E9F0}
.qa h2{margin:0 0 6px;font-size:17px}.qa p{margin:4px 0;color:#5C667A;line-height:1.7}
.qa-tone{display:flex;align-items:center;gap:10px;margin-top:8px;border:1px solid #E6E9F0;border-radius:12px;padding:6px}
.qa-tone.on{border:2px solid #F6C94A}
.qa-play{width:44px;height:44px;border-radius:50%;border:0;background:#141F33;color:#F6C94A;font-size:16px}
.qa-name{flex:1;min-height:44px;border:0;background:none;font:inherit;font-weight:800;text-align:right;color:#141F33}
.qa-al{display:flex;flex-direction:column;border-right:4px solid #F6C94A;background:#F5F6FA;border-radius:8px;padding:8px 10px;margin-top:8px}
.qa-al small{color:#5C667A;line-height:1.6}
.qa-note{font-size:13px}
.qa-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.qa-chips button{min-height:44px;padding:0 12px;border:1px solid #D5DAE5;background:#fff;border-radius:10px;font:inherit;font-weight:700;color:#141F33}
.qa-chips button.on{background:#141F33;color:#F6C94A;border-color:#141F33}
.qa-check{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:700}.qa-check input{width:22px;height:22px}
.qa-l{margin-top:10px;font-weight:700}
.qa-save{margin-top:12px;width:100%;min-height:50px;border:0;border-radius:12px;background:#141F33;color:#F6C94A;font:inherit;font-weight:800;font-size:17px}
.qa-msg{margin:40px 16px;text-align:center;font-size:18px}
.qa-toast{position:fixed;left:16px;right:16px;bottom:20px;background:#141F33;color:#fff;border-radius:12px;padding:12px;text-align:center;font-weight:700}
`;
