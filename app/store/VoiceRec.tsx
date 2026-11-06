"use client";
// تسجيل صوت لحد 5 دقايق: تسجيل، إيقاف، سماع، مسح. تستعمله رسالة المصحح واعتراض الطالب
import { useEffect, useRef, useState } from "react";

const MAX_SEC = 300;
const pickType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function VoiceRec({ value, onChange, onRecording, btn = "gk-btn", label = "🎙 رسالة صوتية (اختياري، أكثر شي 5 دقايق)" }: {
  value: Blob | null; onChange: (b: Blob | null) => void; onRecording?: (on: boolean) => void; btn?: string; label?: string;
}) {
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((t) => t.stop()); if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => {
    if (!value) { setUrl(""); return; }
    const u = URL.createObjectURL(value); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);
  const setOn = (on: boolean) => { setRec(on); onRecording?.(on); };

  async function start() {
    setErr("");
    const type = pickType();
    if (!type || !navigator.mediaDevices?.getUserMedia) { setErr("هذا الجهاز ما يدعم التسجيل من هنا. اكتب بدال الصوت."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: type });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onChange(new Blob(parts, { type: type.split(";")[0] }));
        setOn(false);
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
      };
      recorder.current = r;
      r.start(1000);
      setOn(true); setSec(0); onChange(null);
      timer.current = setInterval(() => setSec((s) => { if (s + 1 >= MAX_SEC) recorder.current?.stop(); return s + 1; }), 1000);
    } catch { setErr("ما گدرت أفتح المايك. اسمح للتلگرام يستعمل المايكروفون وجرب مرة ثانية."); }
  }
  return (
    <div className="gk-voice">
      <span>{label}</span>
      {!rec && !value && <button type="button" className={btn} onClick={() => void start()}>🔴 تسجيل</button>}
      {rec && <button type="button" className={btn + " gk-recon"} onClick={() => recorder.current?.stop()}>⏹ إيقاف {mmss(sec)}</button>}
      {value && !rec && (
        <div className="gk-tools">
          {url && <audio controls src={url} />}
          <button type="button" className={btn} onClick={() => onChange(null)}>🗑 امسح</button>
        </div>
      )}
      {err && <div className="gk-err">⚠️ {err}</div>}
    </div>
  );
}
