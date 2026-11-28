"use client";
// 🚪 طلعوا من الامتحان (طلبه 2026-11-28): بالتطبيق بدل التليگرام. كل طالب طلع برا صفحة الامتحان وهو يمتحن سطر،
// «✅ تم» ينزله لورا، و«📩 رسالة» يدزله كتابة لو صوت. إذا طلع مرة ثانية يرجع فوگ
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import VoiceRec from "../VoiceRec";

type L = { item: number; name: string; exam: string; ipad: boolean; center: string; first: string; last: string; n: number; away: number; msgs: number; done: string };
type Data = { open: L[]; done: L[]; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;

const hm = (at: string) => {
  const t = at.slice(11, 16);
  const [h, m] = t.split(":").map(Number);
  return t ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "صباحاً" : "مساءً"}` : "";
};
const away = (s: number) => (s >= 60 ? `${Math.round(s / 60)} دقيقة` : `${s} ثانية`);

export default function LeavesClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/leaves", "🚪 طلعوا من الامتحان");
  return (
    <>
      <AdminHeader title="🚪 طلعوا من الامتحان" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Body data={data} busy={busy} call={call} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Body({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [msg, setMsg] = useState<L | null>(null);
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      <div className="exhint tmhint">كل طالب طلع برا صفحة الامتحان وهو يمتحن يطلع هنا. «✅ تم» ينزله لورا، و«📩 رسالة» تدزله كتابة لو صوت. إذا طلع مرة ثانية يرجع فوگ. ولي أمره ومسؤول مركزه يوصلهم تنبيه هم.</div>
      <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void call({ action: "list" })}>🔄 حدّث</button>
      {!data.open.length && <div className="empty">✅ ماكو أحد ينتظر</div>}
      {data.open.map((l) => <Row key={l.item} l={l} busy={busy} call={call} onMsg={() => setMsg(l)} />)}
      {!!data.done.length && (
        <div className="card expad adtop">
          <button type="button" className="exbtn" onClick={() => setShowDone(!showDone)}>{showDone ? "▲ سد" : "▼"} ✅ اللي خلصتهم ({data.done.length})</button>
          {showDone && data.done.map((l) => <Row key={l.item} l={l} busy={busy} call={call} onMsg={() => setMsg(l)} />)}
        </div>
      )}
      {msg && <MsgBox l={msg} call={call} onClose={() => setMsg(null)} />}
    </>
  );
}

function Row({ l, busy, call, onMsg }: { l: L; busy: boolean; call: Call; onMsg: () => void }) {
  return (
    <div className={"card expad adtop" + (l.done ? " lvdone" : "")}>
      <b>{l.name}</b>
      <div className="exhint">{l.exam}</div>
      <div className="exhint">{l.ipad ? "📱 بالآيباد بالمركز" : "💻 إلكتروني"}{l.center ? ` · 🏫 ${l.center}` : ""}</div>
      <div className="exhint exbad">🚪 طلع {l.n === 1 ? "مرة وحدة" : `${l.n} مرات`} · آخر مرة الساعة {hm(l.last)}{l.away ? ` · غاب ${away(l.away)}` : ""}</div>
      {!!l.msgs && <div className="exhint">📩 دزيتله {l.msgs === 1 ? "رسالة" : `${l.msgs} رسائل`}</div>}
      <div className="atrow adtop">
        {l.done
          ? <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "undo", item: l.item })}>↩️ رجّعه فوگ</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "done", item: l.item })}>✅ تم</button>}
        <button type="button" className="exbtn" disabled={busy} onClick={onMsg}>📩 رسالة</button>
      </div>
    </div>
  );
}

/** 📩 رسالة للطالب: كتابة لو صوت */
function MsgBox({ l, call, onClose }: { l: L; call: Call; onClose: () => void }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [rec, setRec] = useState(false);
  const [sending, setSending] = useState(false);
  async function send() {
    const fd = new FormData();
    fd.set("action", "message"); fd.set("item", String(l.item)); fd.set("text", text);
    if (voice) fd.set("voice", voice, "voice");
    setSending(true);
    const r = await call(fd);
    setSending(false);
    if (r) onClose();
  }
  return (
    <div className="gk-modal" onClick={() => !rec && !sending && onClose()}>
      <div className="gk-dialog gk-msg" onClick={(e) => e.stopPropagation()}>
        <b>📩 رسالة إلى {l.name}</b>
        <label>نص الرسالة<textarea rows={4} value={text} placeholder="اكتب رسالتك للطالب" onChange={(e) => setText(e.target.value)} /></label>
        <VoiceRec value={voice} onChange={setVoice} onRecording={setRec} />
        <div className="gk-tools">
          <button type="button" className="gk-btn gk-save" disabled={sending || rec || (!text.trim() && !voice)} onClick={() => void send()}>{sending ? "جاري الإرسال..." : "📤 دز"}</button>
          <button type="button" className="gk-btn" disabled={sending || rec} onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
