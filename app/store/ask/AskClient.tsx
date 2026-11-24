"use client";
// ❓ سؤال علمي بصفحة بشكل الأستاذ (طلبه 2026-11-24): بدل أزرار التليگرام، الطالب يختار الفصل والموضوع والمحاضرة بأزرار
// مثل صفحة التسجيل، ويكتب سؤاله لو يصوّره. الحل ينفتح بصفحة الحل نفسها، وإذا ما انحل يوصل للأستاذ والجواب يجيه بالبوت
import { useEffect, useRef, useState } from "react";
import { Seg, haptic } from "../shared";
import { Inline } from "../myexams/AiCompare";

type Topic = { id: number; name: string; lectures: number };
type Chapter = { id: number; label: string; topics: Topic[] };
type Info = { en: boolean; need?: "reg"; closed?: string; chapters?: Chapter[] };

const token = () => (typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("t") ?? "");
const T = {
  ar: { title: "❓ سؤال علمي", ch: "الفصل", topic: "الموضوع", lec: "المحاضرة", lecN: (n: number) => `المحاضرة ${n}`, q: "سؤالك", qHint: "اكتب سؤالك هنا، لو صوّره تحت 👇", photo: "📷 صوّر السؤال", photo2: "📷 بدّل الصورة", del: "🗑 شيل الصورة", send: "📤 دز سؤالي", wait: "📤 ...", queued: "✅ وصل سؤالك.\nراح يوصلك الجواب بإشعار (بالبوت والتطبيق).", sent: (n: number) => `✅ وصل سؤالك (رقم #${n}) للأستاذ.\nراح يوصلك الجواب بالبوت، وتگدر تشوفه من «📂 أسئلتي».`, again: "❓ سؤال ثاني", reg: "حتى تسأل، سجّل معلوماتك أول من البوت.", loading: "جاري التحميل...", net: "ماكو اتصال، حاول مرة ثانية", pick: "اختار", empty: "اكتب سؤالك لو صوّره",
    check: "✍️ تأكد من سؤالك", checkHint: "هذا سؤالك مثل ما انقرا من صورتك. إذا بيه رقم لو حرف غلط، امسحه واكتب الصح (مثلاً π/7 تصير π/9)، وتحت يطلع مرتب مثل الكتاب.", look: "👁 هيچ ينقرا سؤالك:", ok: "✅ صح، دزه", retake: "📷 صوّر مرة ثانية", back: "↩️ رجوع", reading: "⏳ ...", noRead: "ما انقرت صورتك. اكتب سؤالك بالمربع، لو صوّره مرة ثانية أوضح." },
  en: { title: "❓ Scientific question", ch: "Chapter", topic: "Topic", lec: "Lecture", lecN: (n: number) => `Lecture ${n}`, q: "Your question", qHint: "Write your question here, or take a photo below 👇", photo: "📷 Take a photo", photo2: "📷 Change the photo", del: "🗑 Remove the photo", send: "📤 Send my question", wait: "📤 ...", queued: "✅ Your question arrived.\nThe answer comes to you as a notification (in the bot and the app).", sent: (n: number) => `✅ Your question (#${n}) reached the teacher.\nThe answer comes to you in the bot, and you can see it in «📂 My questions».`, again: "❓ Another question", reg: "To ask, register your details first in the bot.", loading: "Loading...", net: "No connection, try again", pick: "Choose", empty: "Write your question or take a photo",
    check: "✍️ Check your question", checkHint: "This is your question as read from your photo. If a number or letter is wrong, delete it and type the right one (e.g. π/7 → π/9); below it shows neatly like the book.", look: "👁 Your question reads:", ok: "✅ Correct, send it", retake: "📷 Take it again", back: "↩️ Back", reading: "⏳ ...", noRead: "Your photo could not be read. Type your question in the box, or take a clearer photo." },
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
  // «تأكد من سؤالك»: قراية الصورة بكتابة الموبايل، يصلّحها الطالب قبل ما تنبعث (طلب الأستاذ 2026-11-24)
  const [check, setCheck] = useState<string | null>(null);
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
  /** بيه صورة: تنقرا أول، ويطلعله «تأكد من سؤالك» */
  async function read() {
    if (!ready || !pic) return;
    haptic(); setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.set("token", token()); fd.set("action", "read"); fd.set("tid", String(tid)); fd.set("photo", pic, "question.jpg");
      const res = await fetch("/api/ask", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? T.ar.net); return; }
      setCheck([String(j.phone ?? "").trim(), text.trim()].filter(Boolean).join("\n"));
    } catch { setError(t.net); } finally { setBusy(false); }
  }
  async function send() {
    if (!ready) return;
    if (pic && check === null) { await read(); return; }
    const q = check ?? text;
    if (!q.trim() && !pic) { setError(t.empty); return; }
    haptic(); setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.set("token", token()); fd.set("action", "send"); fd.set("tid", String(tid)); fd.set("lec", String(lec)); fd.set("text", q.trim());
      if (check !== null) fd.set("checked", "1");
      if (pic) fd.set("photo", pic, "question.jpg");
      const res = await fetch("/api/ask", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || j.closed) { setError(j.error ?? j.closed ?? T.ar.net); return; }
      if (j.queued) { setSent(1); setCheck(null); }
    } catch { setError(t.net); } finally { setBusy(false); }
  }
  function again() { setSent(0); setText(""); setPic(null); setPreview(""); setError(""); setCheck(null); }

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
        {/* الصورة: بره المربعات حتى «📷 صوّر مرة ثانية» يفتح الكاميرا من «تأكد من سؤالك» هم */}
        <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void choosePic(e.target.files?.[0]); e.target.value = ""; }} />
        {info?.chapters && !sent && check !== null && (
          <div className="card">
            <div className="form">
              <label>{t.check}</label>
              <div className="exhint">{check.trim() ? t.checkHint : t.noRead}</div>
              {preview && <img src={preview} alt="" style={{ width: "100%", borderRadius: 10, border: "1px solid #cbd5e1" }} />}
              <textarea rows={Math.min(10, Math.max(3, check.split("\n").length + 1))} dir="auto" value={check} onChange={(e) => setCheck(e.target.value)} disabled={busy} />
              {check.trim() && (
                <div className="tidyview">
                  <div className="exhint">{t.look}</div>
                  {check.split(/\n/).filter((l) => l.trim()).map((l, i) => <div key={i} className="tidyline"><Inline text={l} /></div>)}
                </div>
              )}
              <button type="button" className="btn" disabled={busy || !check.trim()} onClick={() => void send()}>{busy ? t.wait : t.ok}</button>
              <div className="aig-logrow">
                <button type="button" className="exbtn" disabled={busy} onClick={() => { setCheck(null); fileIn.current?.click(); }}>{t.retake}</button>
                <button type="button" className="exbtn" disabled={busy} onClick={() => setCheck(null)}>{t.back}</button>
              </div>
            </div>
          </div>
        )}
        {info?.chapters && !sent && check === null && (
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
                {preview && <img src={preview} alt="" style={{ width: "100%", borderRadius: 10, border: "1px solid #cbd5e1", marginTop: 8 }} />}
                <div className="aig-logrow">
                  <button type="button" className="exbtn" disabled={busy} onClick={() => fileIn.current?.click()}>{preview ? t.photo2 : t.photo}</button>
                  {preview && <button type="button" className="exbtn" disabled={busy} onClick={() => { setPic(null); setPreview(""); }}>{t.del}</button>}
                </div>
                <button type="button" className="btn" disabled={busy || (!text.trim() && !pic)} onClick={() => void send()}>{busy ? (pic ? t.reading : t.wait) : t.send}</button>
              </>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
