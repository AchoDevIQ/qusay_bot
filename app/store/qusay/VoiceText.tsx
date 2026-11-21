"use client";
// مربع كتابة بخيارين: ⌨️ كتابة، لو 🎤 فويس (يحچي وينكتب). الفويس مجاني: سماع الكلام اللي بالمتصفح نفسه (كروم أو سفاري).
// داخل تليگرام سماع المتصفح ما موجود، فيطلع شرح مايك الكيبورد (كيبورد التلفون يسمع ويكتب بالمربع، بكل مكان)
import { useEffect, useRef, useState } from "react";
import { inAppView } from "../grade/VoiceMark";

type Alt = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alt };
type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: Result } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
};
type RecCtor = new () => Rec;
const ctor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
/** سماع المتصفح يشتغل هنا؟ (داخل تليگرام لا، حتى لو الصفحة تكول موجود) */
function canListen() {
  const plat = (window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "";
  if (["android", "android_x", "ios", "tdesktop", "macos"].includes(plat) || inAppView()) return false;
  return !!ctor();
}

export default function VoiceText({ value, onChange, rows = 4, maxLength = 3000 }: { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number }) {
  const [mode, setMode] = useState<"type" | "voice">("type");
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  const [heard, setHeard] = useState("");
  const [err, setErr] = useState("");
  const rec = useRef<Rec | null>(null);
  const cur = useRef(value);
  cur.current = value;
  useEffect(() => { setCan(canListen()); return () => rec.current?.stop(); }, []);
  function start() {
    const C = ctor(); if (!C) return;
    const r = new C();
    r.lang = "ar-IQ"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript ?? "";
        // الجملة اللي خلصت تنضاف بسطر جديد بالمربع
        if (e.results[i].isFinal) { if (t.trim()) onChange(((cur.current.trim() ? cur.current.replace(/\s+$/, "") + "\n" : "") + t.trim()).slice(0, maxLength)); }
        else live += t;
      }
      setHeard(live);
    };
    r.onerror = (e) => { setErr(e.error === "not-allowed" ? "المتصفح ما سمح بالمايك. اسمحله من إعدادات المتصفح." : "انقطع السماع، دوس 🎤 مرة ثانية."); setOn(false); };
    r.onend = () => { setOn(false); setHeard(""); };
    rec.current = r; setErr(""); r.start(); setOn(true);
  }
  function stop() { rec.current?.stop(); setOn(false); }
  return (
    <div className="vtext">
      <div className="seg">
        <button type="button" className={mode === "type" ? "on" : ""} onClick={() => { stop(); setMode("type"); }}>⌨️ كتابة</button>
        <button type="button" className={mode === "voice" ? "on" : ""} onClick={() => setMode("voice")}>🎤 فويس</button>
      </div>
      {mode === "voice" && (can ? (
        <div className="aig-logrow">
          <button type="button" className={on ? "btn ghost" : "btn"} onClick={() => (on ? stop() : start())}>{on ? "⏹ وگف" : "🎤 احچي"}</button>
          <small>{on ? (heard ? `🎧 ${heard}` : "🎧 دا أسمعك... كل جملة تنكتب بسطر") : "دوس 🎤 احچي، وكل جملة تحچيها تنكتب بالمربع بسطر. تگدر تصلحها بإيدك بعدين."}</small>
        </div>
      ) : (
        <div className="exhint">🎤 دوس داخل المربع، وبعدين دوس المايك 🎤 اللي بالكيبورد واحچي: الكلام ينكتب وحده بالمربع. (داخل تليگرام هاي الطريقة، لأن سماع المتصفح ما يشتغل بيه)</div>
      ))}
      {err && <div className="exbad">⚠️ {err}</div>}
      <textarea rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
