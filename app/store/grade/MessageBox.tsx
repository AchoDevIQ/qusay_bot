"use client";
// رسالة من المصحح للطالب: كتابة، وتسجيل صوت لحد 5 دقايق، وزر اختياري يفتح محادثة تلگرام
import { useEffect, useRef, useState } from "react";
import { pageAuth } from "../adminPage";

const MAX_SEC = 300;
const pickType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function MessageBox({ paperId, name, onClose }: { paperId: number; name: string; onClose: (notice?: string) => void }) {
  const [text, setText] = useState("");
  const [btnText, setBtnText] = useState("");
  const [btnUser, setBtnUser] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const url = useRef("");
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((t) => t.stop()); if (timer.current) clearInterval(timer.current); if (url.current) URL.revokeObjectURL(url.current); }, []);

  async function start() {
    setErr("");
    const type = pickType();
    if (!type || !navigator.mediaDevices?.getUserMedia) { setErr("هذا الجهاز ما يدعم التسجيل من هنا. اكتب الرسالة بدال الصوت."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: type });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const b = new Blob(parts, { type: type.split(";")[0] });
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(b);
        setVoice(b); setRec(false);
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
      };
      recorder.current = r;
      r.start(1000);
      setRec(true); setSec(0); setVoice(null);
      timer.current = setInterval(() => setSec((s) => { if (s + 1 >= MAX_SEC) recorder.current?.stop(); return s + 1; }), 1000);
    } catch { setErr("ما گدرت أفتح المايك. اسمح للتلگرام يستعمل المايكروفون وجرب مرة ثانية."); }
  }
  async function send() {
    setErr(""); setSending(true);
    try {
      const fd = new FormData();
      fd.set("initData", pageAuth()); fd.set("action", "message"); fd.set("id", String(paperId));
      fd.set("text", text); fd.set("btnText", btnText); fd.set("btnUser", btnUser);
      if (voice) fd.set("voice", voice, "voice");
      const res = await fetch("/api/grade", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "ما وصلت الرسالة");
      onClose(j.notice);
    } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  }
  return (
    <div className="gk-modal" onClick={() => !rec && !sending && onClose()}>
      <div className="gk-dialog gk-msg" onClick={(e) => e.stopPropagation()}>
        <b>📩 رسالة إلى {name}</b>
        <label>نص الرسالة<textarea rows={4} value={text} placeholder="اكتب رسالتك للطالب" onChange={(e) => setText(e.target.value)} /></label>
        <div className="gk-voice">
          <span>🎙 رسالة صوتية (اختياري، أكثر شي 5 دقايق)</span>
          {!rec && !voice && <button type="button" className="gk-btn" onClick={() => void start()}>🔴 تسجيل</button>}
          {rec && <button type="button" className="gk-btn gk-recon" onClick={() => recorder.current?.stop()}>⏹ إيقاف {mmss(sec)}</button>}
          {voice && !rec && (
            <div className="gk-tools">
              <audio controls src={url.current} />
              <button type="button" className="gk-btn" onClick={() => setVoice(null)}>🗑 امسح</button>
            </div>
          )}
        </div>
        <label>نص الزر (اختياري)<input value={btnText} placeholder="مثال: تواصل وياي" onChange={(e) => setBtnText(e.target.value)} /></label>
        <label>اسم مستخدم تلگرام للزر (اختياري)<input dir="ltr" value={btnUser} placeholder="@username" onChange={(e) => setBtnUser(e.target.value)} /></label>
        {err && <div className="gk-err">⚠️ {err}</div>}
        <div className="gk-tools">
          <button type="button" className="gk-finish" disabled={sending || rec || (!text.trim() && !voice)} onClick={() => void send()}>{sending ? "جاري الإرسال..." : "📤 إرسال"}</button>
          <button type="button" className="gk-btn" disabled={sending || rec} onClick={() => onClose()}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
