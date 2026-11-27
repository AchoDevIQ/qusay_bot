"use client";
// ⏰ منبه الامتحانات: الطالب يسمع النغمات ويختار وحدة، ويشوف منبهاته الجاية. صاحب البوت يحدد شوكت يرن للكل
import { useEffect, useRef, useState } from "react";
import { pageToken } from "../adminPage";

type Tone = { id: string; name: string; url: string; custom?: boolean };
type Alarm = { key: string; at: string; title: string; body: string };
type Cfg = { on: boolean; before: number[]; night: boolean; tone: string };
type Data = { tones: Tone[]; tone: string; alarms: Alarm[]; admin: boolean; cfg: Cfg | null; notice?: string };
const OFF: { m: number; t: string }[] = [{ m: 120, t: "قبل ساعتين" }, { m: 60, t: "قبل ساعة" }, { m: 30, t: "قبل نص ساعة" }, { m: 10, t: "قبل 10 دقايق" }, { m: 0, t: "بوقت الامتحان" }];
const SR = 22050, MAX_S = 29;
/** أي صوت (MP3، تسجيل، فيديو…) ← WAV مونو، أقل من 30 ثانية، بعلو مضبوط ويخفت بآخره: هيج يرن بالآيفون والأندرويد */
async function toWav(blob: Blob): Promise<{ b64: string; secs: number; cut: boolean }> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  let src: AudioBuffer;
  try { src = await ac.decodeAudioData(await blob.arrayBuffer()); } catch { throw new Error("ما گدرت أقرا هذا الصوت. جرب MP3 أو M4A"); } finally { void ac.close(); }
  const secs = Math.min(src.duration, MAX_S), len = Math.ceil(secs * SR);
  const off = new OfflineAudioContext(1, len, SR);
  const n = off.createBufferSource(); n.buffer = src; n.connect(off.destination); n.start();
  const d = (await off.startRendering()).getChannelData(0);
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const gain = peak > 0.01 ? 0.9 / peak : 1, fade = Math.floor(SR * 0.4);
  const out = new DataView(new ArrayBuffer(44 + d.length * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + d.length * 2, true); str(8, "WAVE"); str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) {
    const f = src.duration > MAX_S && i > d.length - fade ? (d.length - i) / fade : 1;
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * gain * f)) * 0x7fff, true);
  }
  const bytes = new Uint8Array(out.buffer); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), secs: Math.round(secs), cut: src.duration > MAX_S };
}

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
  // نغمة وحدة بس تشتغل (طلبه 2026-11-27): ▶ على غيرها يسكت اللي قبلها، و⏹ على نفسها يسكتها
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState("");
  const stop = () => { const a = audio.current; audio.current = null; if (a) { a.pause(); a.currentTime = 0; } setPlaying(""); };
  const play = (t: Tone) => {
    const same = playing === t.id;
    stop();
    if (same) return;
    try { const a = new Audio(t.url); audio.current = a; a.onended = () => { if (audio.current === a) stop(); }; setPlaying(t.id); void a.play().catch(() => { if (audio.current === a) stop(); }); } catch { /* */ }
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
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
              <button type="button" className="qa-play" aria-label={playing === t.id ? "سكت" : "اسمع"} onClick={() => play(t)}>{playing === t.id ? "⏹" : "▶"}</button>
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
        {d.admin && <MyTones tones={d.tones.filter((t) => t.custom)} api={api} play={play} playing={playing} />}
      </>}
      {!d && !err && <div className="qa-msg">جاري التحميل...</div>}
      {msg && <div className="qa-toast">{msg}</div>}
    </div>
  );
}

/** 🎵 نغماتك: ترفع صوت أو موسيقى، أو تسجل صوتك، وتوصل للطلاب وحدها (بلا تحديث للتطبيق) */
function MyTones({ tones, api, play, playing }: { tones: Tone[]; api: (b: Record<string, unknown>) => Promise<void>; play: (t: Tone) => void; playing: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [ready, setReady] = useState<{ b64: string; secs: number; cut: boolean; url: string } | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const take = async (b: Blob) => {
    setBusy("جاري التجهيز...");
    try { const w = await toWav(b); setReady({ ...w, url: `data:audio/wav;base64,${w.b64}` }); } catch (e) { alert((e as Error).message); }
    setBusy("");
  };
  const record = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      const m = new MediaRecorder(st), parts: Blob[] = [];
      m.ondataavailable = (e) => parts.push(e.data);
      m.onstop = () => { st.getTracks().forEach((t) => t.stop()); setRec(null); void take(new Blob(parts, { type: m.mimeType })); };
      m.start(); setRec(m); setReady(null);
      window.setTimeout(() => { if (m.state === "recording") m.stop(); }, MAX_S * 1000);
    } catch { alert("ما گدرت أفتح المايك. اسمحله من المتصفح"); }
  };
  const save = async () => {
    if (!ready) return;
    setBusy("جاري الرفع...");
    await api({ action: "addTone", name, data: ready.b64 });
    setBusy(""); setReady(null); setName("");
  };
  return (
    <section className="qa-admin">
      <h2>🎵 نغماتك</h2>
      <p>ارفع موسيقى أو صوتك، أو سجّل صوتك هنا. تنقص وحدها لـ29 ثانية (الآيفون ما يرن بأطول). توصل للطلاب أول ما يفتحون التطبيق، بلا تحديث.</p>
      <div className="qa-chips">
        <label className="qa-btn">📁 اختار ملف صوت<input type="file" accept="audio/*,video/mp4" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { if (!name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 30)); void take(f); } }} /></label>
        <button type="button" className={`qa-btn${rec ? " on" : ""}`} onClick={() => void record()}>{rec ? "⏹ وقّف التسجيل" : "🎤 سجّل صوتك"}</button>
      </div>
      {busy && <p>{busy}</p>}
      {ready && <div className="qa-ready">
        <div className="qa-l">جاهزة ({ready.secs} ثانية{ready.cut ? "، انقصت لـ29" : ""}). اسمعها:</div>
        <audio controls src={ready.url} />
        <input className="qa-in" placeholder="اسمها (مثلاً: صوت قصي)" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="qa-save" disabled={!name.trim() || !!busy} onClick={() => void save()}>➕ ضيفها للطلاب</button>
      </div>}
      {tones.map((t) => (
        <div key={t.id} className="qa-tone">
          <button type="button" className="qa-play" aria-label={playing === t.id ? "سكت" : "اسمع"} onClick={() => play(t)}>{playing === t.id ? "⏹" : "▶"}</button>
          <span className="qa-name">{t.name}</span>
          <button type="button" className="qa-del" onClick={() => { if (confirm(`تحذف «${t.name}»؟ اللي مختاريها يرجعون للنغمة الأساسية`)) void api({ action: "delTone", id: t.id }); }}>🗑</button>
        </div>
      ))}
    </section>
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
.qa-btn{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #141F33;background:#fff;border-radius:10px;font:inherit;font-weight:700;color:#141F33;cursor:pointer}
.qa-btn.on{background:#141F33;color:#F6C94A}
.qa-ready{margin-top:10px;display:flex;flex-direction:column;gap:8px}.qa-ready audio{width:100%}
.qa-in{min-height:44px;border:1px solid #D5DAE5;border-radius:10px;padding:0 12px;font:inherit}
.qa-del{width:44px;height:44px;border:0;background:none;font-size:18px}
.qa-name{display:flex;align-items:center}
.qa-msg{margin:40px 16px;text-align:center;font-size:18px}
.qa-toast{position:fixed;left:16px;right:16px;bottom:20px;background:#141F33;color:#fff;border-radius:12px;padding:12px;text-align:center;font-weight:700}
`;
