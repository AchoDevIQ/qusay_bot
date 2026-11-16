"use client";
// محادثة البوت داخل التطبيق: نفس رسائل تليگرام بأزرارها، والطالب يرد بالكتابة أو بصورة أو بالأزرار
import { useEffect, useRef, useState } from "react";
import { appKey } from "../shared";

type Btn = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; copy_text?: { text: string } };
type Media = { t: string; n?: string };
type Msg = { id: number; mid: number; dir: "in" | "out"; text: string; html: boolean; kb: Btn[][] | null; media: Media[]; at: string; edited: string };
type List = { msgs: Msg[]; kb: Btn[][]; last: number; answer?: string; error?: string; voice?: boolean };

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "INS", "S", "STRIKE", "DEL", "CODE", "PRE", "A", "BLOCKQUOTE", "TG-SPOILER", "SPAN", "BR"]);
/** HTML تليگرام بس (عريض، مائل، كود، رابط...)، وأي شي ثاني يصير نص */
function safeHtml(src: string) {
  const doc = new DOMParser().parseFromString(`<div>${src}</div>`, "text/html");
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const el = n as Element, inner = [...el.childNodes].map(walk).join("");
    if (!ALLOWED.has(el.tagName)) return inner;
    if (el.tagName === "A") { const h = el.getAttribute("href") ?? ""; return /^(https?:|tg:)/.test(h) ? `<a href="${h.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer">${inner}</a>` : inner; }
    const tag = el.tagName === "TG-SPOILER" ? "span" : el.tagName.toLowerCase();
    return tag === "br" ? "<br>" : `<${tag}>${inner}</${tag}>`;
  };
  return [...doc.body.firstChild!.childNodes].map(walk).join("");
}

export default function ChatClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [kb, setKb] = useState<Btn[][]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [voice, setVoice] = useState(false);
  const [rec, setRec] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const last = useRef(0), loaded = useRef(false), bottom = useRef<HTMLDivElement>(null);
  const auth = () => ({ token: new URLSearchParams(location.search).get("t") ?? sessionStorage.getItem("qm_t") ?? "", app: appKey() });

  function merge(r: List) {
    setMsgs((old) => {
      const m = new Map(old.map((x) => [x.id, x]));
      for (const x of r.msgs) m.set(x.id, x);
      return [...m.values()].sort((a, b) => a.id - b.id);
    });
    setKb(r.kb ?? []);
    setVoice(!!r.voice);
    if (r.last > last.current) { last.current = r.last; setTimeout(() => bottom.current?.scrollIntoView({ behavior: loaded.current ? "smooth" : "auto" }), 50); }
    if (r.answer) { setToast(r.answer); setTimeout(() => setToast(""), 3500); }
  }
  async function call(body: Record<string, unknown>) {
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...auth(), after: last.current, ...body }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ"); return null; }
      setError("");
      merge(j);
      return j as List;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; }
  }
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("t");
    if (t) sessionStorage.setItem("qm_t", t);
    void call({ action: "list" }).then((r) => {
      loaded.current = true;
      // أول مرة: نفس «ابدأ» بتليگرام، حتى توصله رسالة الترحيب وأزراره
      if (r && !r.msgs.length) void call({ action: "text", text: "/start", hidden: true });
    });
    const iv = setInterval(() => { if (!document.hidden) void call({ action: "list" }); }, 4000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendText(t: string) {
    if (!t.trim() || busy) return;
    setBusy(true);
    if (await call({ action: "text", text: t })) setText("");
    setBusy(false);
  }
  async function press(m: Msg, b: Btn) {
    if (b.callback_data) { setBusy(true); await call({ action: "cb", mid: m.mid, data: b.callback_data }); setBusy(false); }
    else if (b.web_app) location.href = b.web_app.url;
    else if (b.url) window.open(b.url, "_blank");
    else if (b.copy_text) { try { await navigator.clipboard.writeText(b.copy_text.text); setToast("✅ انسخ"); setTimeout(() => setToast(""), 2000); } catch { /* */ } }
  }
  async function sendFile(f: File) {
    setBusy(true);
    const fd = new FormData();
    const a = auth();
    fd.set("token", a.token); fd.set("app", a.app); fd.set("after", String(last.current)); fd.set("caption", text); fd.set("file", f);
    try {
      const res = await fetch("/api/chat", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "ما انرسلت الصورة"); else { setText(""); merge(j); }
    } catch { setError("ماكو اتصال، ما انرسلت الصورة"); }
    setBusy(false);
  }
  // فويس: دوسة تبدي التسجيل، ودوسة ثانية توقفه وتدزه (أكثر شي 3 دقايق)
  async function toggleRec() {
    if (recorder.current) { recorder.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const parts: Blob[] = [];
      const started = Date.now();
      const tick = setInterval(() => { const sec = Math.floor((Date.now() - started) / 1000); setRec(sec || 1); if (sec >= 180) r.stop(); }, 500);
      r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      r.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); recorder.current = null; setRec(0);
        const t = (r.mimeType || type || "audio/webm").split(";")[0];
        const blob = new Blob(parts, { type: t });
        if (blob.size > 1000) void sendFile(new File([blob], `voice.${t.includes("ogg") ? "ogg" : t.includes("mp4") ? "m4a" : "webm"}`, { type: t }));
      };
      recorder.current = r; r.start(); setRec(1);
    } catch { setError("ما گدرت أفتح المايك. اسمح للتطبيق يستعمل المايك وجرب مرة ثانية"); }
  }
  const fileUrl = (m: Msg, k: number) => { const a = auth(); return `/api/chat/file?t=${encodeURIComponent(a.token)}&app=${a.app}&m=${m.id}&k=${k}`; };

  return (
    <div className="chatpage">
      <style>{CSS}</style>
      <div className="chatlist">
        {!msgs.length && !error && <div className="empty">جاري التحميل...</div>}
        {msgs.map((m) => (
          <div key={m.id} className={"chatrow " + m.dir}>
            <div className="bubble">
              {m.media.map((x, k) => x.t === "photo" ? <img key={k} src={fileUrl(m, k)} alt="" />
                : x.t === "voice" || x.t === "audio" ? <audio key={k} controls src={fileUrl(m, k)} />
                : x.t === "video" || x.t === "video_note" || x.t === "animation" ? <video key={k} controls playsInline src={fileUrl(m, k)} />
                : x.t === "sticker" ? <img key={k} className="sticker" src={fileUrl(m, k)} alt="" />
                : <a key={k} className="doc" href={fileUrl(m, k)} target="_blank" rel="noreferrer">📄 {x.n ?? "ملف"}</a>)}
              {m.text && (m.html ? <div className="txt" dangerouslySetInnerHTML={{ __html: safeHtml(m.text) }} /> : <div className="txt">{m.text}</div>)}
              <small>{m.at.slice(11, 16)}{m.edited ? " · معدلة" : ""}</small>
            </div>
            {m.kb && (
              <div className="inkb">
                {m.kb.map((row, i) => <div key={i} className="inrow">{row.map((b, j) => <button type="button" key={j} disabled={busy} onClick={() => void press(m, b)}>{b.text}</button>)}</div>)}
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {toast && <div className="chattoast">{toast}</div>}
      {error && <div className="chaterr">⚠️ {error}</div>}
      <div className="chatbar">
        {!!kb.length && (
          <div className="replykb">
            {kb.map((row, i) => <div key={i} className="inrow">{row.map((b, j) => <button type="button" key={j} disabled={busy} onClick={() => (b.web_app ? (location.href = b.web_app.url) : void sendText(b.text))}>{b.text}</button>)}</div>)}
          </div>
        )}
        <div className="chatinput">
          <label className="cam">📷<input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sendFile(f); }} /></label>
          {voice && <button type="button" className={"cam" + (rec ? " recon" : "")} disabled={busy} onClick={() => void toggleRec()}>{rec ? `⏹ ${Math.floor(rec / 60)}:${String(rec % 60).padStart(2, "0")}` : "🎤"}</button>}
          <textarea rows={1} value={text} placeholder="اكتب رسالة..." onChange={(e) => setText(e.target.value)} />
          <button type="button" className="send" disabled={busy || !text.trim()} onClick={() => void sendText(text)}>{busy ? "⏳" : "➤"}</button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.chatpage{display:flex;flex-direction:column;height:100dvh;background:var(--ink,#0d1b2a)}
.chatlist{flex:1;overflow-y:auto;padding:12px 10px 4px}
.chatrow{display:flex;flex-direction:column;margin:6px 0;max-width:88%}
.chatrow.out{align-items:flex-start;margin-left:auto;margin-right:0}
.chatrow.in{align-items:flex-end;margin-right:auto;margin-left:0}
.chatrow.out{margin-right:auto;margin-left:0}.chatrow.in{margin-left:auto;margin-right:0}
.bubble{background:#1b2d44;color:var(--txt,#fff);border-radius:14px;padding:8px 12px;line-height:1.7;font-size:15px;word-break:break-word}
.chatrow.in .bubble{background:#c9a227;color:#111}
.bubble img,.bubble video{max-width:100%;border-radius:10px;display:block;margin-bottom:4px}
.bubble img.sticker{max-width:140px}
.bubble audio{width:240px;max-width:100%}
.bubble .txt{white-space:pre-wrap}
.bubble a{color:#7cc4ff}
.bubble small{display:block;opacity:.6;font-size:11px;margin-top:2px}
.bubble blockquote{border-right:3px solid #c9a227;margin:4px 0;padding-right:8px}
.bubble pre,.bubble code{direction:ltr;unicode-bidi:plaintext;background:#0006;border-radius:6px;padding:0 4px}
.inkb{width:100%;margin-top:4px}
.inrow{display:flex;gap:6px;margin-top:6px}
.inrow button{flex:1;padding:10px 8px;border-radius:10px;border:1px solid var(--line,#2c4460);background:#14263b;color:var(--txt,#fff);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}
.inrow button:disabled{opacity:.5}
.chatbar{border-top:1px solid var(--line,#2c4460);padding:6px 8px calc(8px + env(safe-area-inset-bottom));background:#0b1726}
.replykb .inrow button{background:#1b2d44}
.chatinput{display:flex;gap:6px;align-items:flex-end;margin-top:6px}
.chatinput textarea{flex:1;resize:none;max-height:120px;border-radius:12px;border:1px solid var(--line,#2c4460);background:#14263b;color:var(--txt,#fff);padding:10px;font-family:inherit;font-size:15px}
.chatinput .cam,.chatinput .send{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;background:#c9a227;color:#111;border:none;cursor:pointer;flex:none}
.chatinput .send:disabled{opacity:.5}
.chatinput .cam.recon{width:auto;padding:0 12px;border-radius:22px;background:#d9534f;color:#fff;font-size:15px}
.chattoast{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#000c;color:#fff;padding:10px 16px;border-radius:12px;z-index:9;max-width:90%;text-align:center}
.chaterr{color:#ff8a8a;text-align:center;padding:4px}
`;
