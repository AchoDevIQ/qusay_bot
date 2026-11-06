"use client";
// رسالة من المصحح للطالب: كتابة، وتسجيل صوت لحد 5 دقايق، وزر اختياري يفتح محادثة تلگرام
import { useState } from "react";
import { pageAuth } from "../adminPage";
import VoiceRec from "../VoiceRec";

export default function MessageBox({ paperId, name, onClose }: { paperId: number; name: string; onClose: (notice?: string) => void }) {
  const [text, setText] = useState("");
  const [btnText, setBtnText] = useState("");
  const [btnUser, setBtnUser] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);

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
        <VoiceRec value={voice} onChange={setVoice} onRecording={setRec} />
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
