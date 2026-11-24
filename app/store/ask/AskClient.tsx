"use client";
// ❓ سؤال علمي بصفحة بشكل الأستاذ (طلبه 2026-11-24): بدل أزرار التليگرام، الطالب يختار الفصل والموضوع والمحاضرة بأزرار
// مثل صفحة التسجيل، ويكتب سؤاله لو يصوّره. الحل ينفتح بصفحة الحل نفسها، وإذا ما انحل يوصل للأستاذ والجواب يجيه بالبوت
import { useEffect, useRef, useState } from "react";
import { Seg, haptic } from "../shared";

type Topic = { id: number; name: string; lectures: number };
type Chapter = { id: number; label: string; topics: Topic[] };
type Info = { en: boolean; need?: "reg"; closed?: string; chapters?: Chapter[] };

const token = () => (typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("t") ?? "");
const T = {
  ar: { title: "❓ سؤال علمي", ch: "الفصل", topic: "الموضوع", lec: "المحاضرة", lecN: (n: number) => `المحاضرة ${n}`, q: "سؤالك", qHint: "اكتب سؤالك هنا، لو صوّره تحت 👇", photo: "📷 صوّر السؤال", photo2: "📷 بدّل الصورة", del: "🗑 شيل الصورة", send: "📤 دز سؤالي", wait: "📤 ...", queued: "✅ وصل سؤالك.\nراح يوصلك الجواب بإشعار (بالبوت والتطبيق).", sent: (n: number) => `✅ وصل سؤالك (رقم #${n}) للأستاذ.\nراح يوصلك الجواب بالبوت، وتگدر تشوفه من «📂 أسئلتي».`, again: "❓ سؤال ثاني", reg: "حتى تسأل، سجّل معلوماتك أول من البوت.", loading: "جاري التحميل...", net: "ماكو اتصال، حاول مرة ثانية", pick: "اختار", empty: "اكتب سؤالك لو صوّره" },
  en: { title: "❓ Scientific question", ch: "Chapter", topic: "Topic", lec: "Lecture", lecN: (n: number) => `Lecture ${n}`, q: "Your question", qHint: "Write your question here, or take a photo below 👇", photo: "📷 Take a photo", photo2: "📷 Change the photo", del: "🗑 Remove the photo", send: "📤 Send my question", wait: "📤 ...", queued: "✅ Your question arrived.\nThe answer comes to you as a notification (in the bot and the app).", sent: (n: number) => `✅ Your question (#${n}) reached the teacher.\nThe answer comes to you in the bot, and you can see it in «📂 My questions».`, again: "❓ Another question", reg: "To ask, register your details first in the bot.", loading: "Loading...", net: "No connection, try again", pick: "Choose", empty: "Write your question or take a photo" },
};

/** الصورة تصغر قبل ما تنرفع (أخف وأسرع، وتكفي للقراية) */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
  } catch { return file; }
}

export default function AskClient() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [ch, setCh] = useState(0);
  const [tid, setTid] = useState(0);
  const [lec, setLec] = useState(0);
  const [text, setText] = useState("");
  const [pic, setPic] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const fileIn = useRef<HTMLInputElement>(null);
  const t = T[info?.en ? "en" : "ar"];

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), action: "info" }) });
        const j = await res.json();
        if (!res.ok) setError(j.error ?? T.ar.net);
        else { setInfo(j); if (j.chapters?.length === 1) setCh(j.chapters[0].id); }
      } catch { setError(T.ar.net); }
    })();
  }, []);

  const chapter = info?.chapters?.find((c) => c.id === ch);
  const topic = chapter?.topics.find((x) => x.id === tid);
  const ready = !!topic && (topic.lectures === 0 || lec > 0);

  async function choosePic(f: File | undefined) {
    if (!f) return;
    const b = await shrink(f);
    setPic(b);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(b));
  }
  async function send() {
    if (!ready) return;
    if (!text.trim() && !pic) { setError(t.empty); return; }
    haptic(); setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.set("token", token()); fd.set("action", "send"); fd.set("tid", String(tid)); fd.set("lec", String(lec)); fd.set("text", text.trim());
      if (pic) fd.set("photo", pic, "question.jpg");
      const res = await fetch("/api/ask", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || j.closed) { setError(j.error ?? j.closed ?? T.ar.net); return; }
      if (j.queued) setSent(1);
    } catch { setError(t.net); } finally { setBusy(false); }
  }
  function again() { setSent(0); setText(""); setPic(null); setPreview(""); setError(""); }

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>{t.title}</p>
      </header>
      <div className="wrap" dir={info?.en ? "ltr" : "rtl"}>
        {!info && !error && <div className="empty">{t.loading}</div>}
        {error && <div className="card warn exerr" style={{ whiteSpace: "pre-line" }}>⚠️ {error}</div>}
        {info?.need === "reg" && <div className="card expad">{t.reg}</div>}
        {info?.closed && <div className="card expad" style={{ whiteSpace: "pre-line" }}>{info.closed}</div>}
        {sent > 0 && (
          <div className="card expad">
            <div className="fdok" style={{ whiteSpace: "pre-line" }}>{t.queued}</div>
            <button type="button" className="btn" onClick={again}>{t.again}</button>
          </div>
        )}
        {info?.chapters && !sent && (
          <div className="card">
            <div className="form">
              <label>{t.ch} <i>*</i></label>
              <Seg wrap value={String(ch)} options={info.chapters.map((c) => ({ v: String(c.id), label: c.label }))} onPick={(v) => { setCh(Number(v)); setTid(0); setLec(0); }} disabled={busy} />
              {chapter && <>
                <label>{t.topic} <i>*</i></label>
                <Seg wrap value={String(tid)} options={chapter.topics.map((x) => ({ v: String(x.id), label: x.name }))} onPick={(v) => { setTid(Number(v)); setLec(0); }} disabled={busy} />
              </>}
              {topic && topic.lectures > 0 && <>
                <label>{t.lec} <i>*</i></label>
                <Seg wrap value={String(lec)} options={Array.from({ length: topic.lectures }, (_, i) => ({ v: String(i + 1), label: t.lecN(i + 1) }))} onPick={(v) => setLec(Number(v))} disabled={busy} />
              </>}
              {ready && <>
                <label>{t.q} <i>*</i></label>
                <textarea rows={4} placeholder={t.qHint} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
                <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void choosePic(e.target.files?.[0]); e.target.value = ""; }} />
                {preview && <img src={preview} alt="" style={{ width: "100%", borderRadius: 10, border: "1px solid #cbd5e1", marginTop: 8 }} />}
                <div className="aig-logrow">
                  <button type="button" className="exbtn" disabled={busy} onClick={() => fileIn.current?.click()}>{preview ? t.photo2 : t.photo}</button>
                  {preview && <button type="button" className="exbtn" disabled={busy} onClick={() => { setPic(null); setPreview(""); }}>{t.del}</button>}
                </div>
                <button type="button" className="btn" disabled={busy || (!text.trim() && !pic)} onClick={() => void send()}>{busy ? t.wait : t.send}</button>
              </>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
