"use client";
// حل السؤال العلمي: من ملزمة الأستاذ أو محلول على طريقته، والرياضيات مكتوبة مثل الكتاب، كل خطوة بسطر.
// طالب المنهج الإنگليزي يشوف الصفحة كلها بالإنگليزي
import { useEffect, useState } from "react";
import { Inline, MathText } from "../myexams/AiCompare";
import { VideoBox } from "../notes/NotesClient";
import { deviceId, haptic, platform } from "../shared";

type Mark = { id: number; page: number; video: boolean; solution: boolean; q?: string };
/** rasid: سؤاله موجود بالراصد اللي بملازمه: صفحة الحل النموذجي نفسها، وأزرار فيديو الحل والتوضيح اللي عليها */
type Rasid = { book: number; page: number; topic: string; q: string; marks: Mark[] };
type Ans = { question: string; where: string; source: "lecture" | "topic" | "ai" | "rasid"; solution: string; lang?: "ar" | "en"; error?: string; rasid?: Rasid };

const tgPlatform = () => (window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "";
const token = () => new URLSearchParams(location.search).get("t") ?? "";

/** «📘 الحل النموذجي» من الراصد: نفس الصفحة اللي يشوفها بالراصد (الهيدر والسؤال كامل والحل)، وتحتها فيديو الحل والتوضيح */
function RasidSolution({ r }: { r: Rasid }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [yt, setYt] = useState("");
  const [clip, setClip] = useState("");
  const [clipMark, setClipMark] = useState<Mark | null>(null);
  useEffect(() => {
    let url = "";
    void (async () => {
      try {
        const res = await fetch(`/api/notes/page?t=${encodeURIComponent(token())}&book=${r.book}&page=${r.page}&sol=1&pf=${encodeURIComponent(await platform())}&d=${encodeURIComponent(await deviceId())}`);
        if (!res.ok) { setErr(await res.text().catch(() => "") || "ما انفتحت صفحة الحل"); return; }
        url = URL.createObjectURL(await res.blob());
        setSrc(url);
      } catch { setErr("ماكو اتصال، حاول مرة ثانية"); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [r.book, r.page]);
  async function play(m: Mark, kind: "video" | "solution" | "chat") {
    haptic(); setBusy(true); setMsg("⏳ دا يفتح الفيديو...");
    try {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), pf: await platform(), action: "play", book: r.book, mark: m.id, kind }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
      if (j.yt) { setYt(j.yt); setMsg(""); }
      else if (j.clip) { setClipMark(m); setClip(`/api/notes/video?t=${encodeURIComponent(token())}&book=${r.book}&mark=${m.id}&pf=${encodeURIComponent(tgPlatform())}&d=${encodeURIComponent(await deviceId())}`); setMsg(""); }
      else setMsg(`${j.notice}.`);
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  // الفيديو ما اشتغل: رمز الخطأ ينكتب بسجل البوت (مثل الملزمة)
  const fail = (kind: string) => (code: string) => void (async () => {
    await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), pf: await platform(), action: "videoError", book: r.book, kind, code }) });
  })().catch(() => undefined);
  return (
    <div className="card">
      <h2>📝 الحل النموذجي من الراصد</h2>
      <div className="expad">
        <div className="exhint">{r.topic}{r.q ? ` · ${r.q}` : ""}</div>
        {err ? <div className="exbad">⚠️ {err}</div>
          : src ? <img src={src} alt="الحل النموذجي" style={{ width: "100%", display: "block", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff" }} onContextMenu={(e) => e.preventDefault()} draggable={false} />
          : <div className="empty">جاري فتح الحل...</div>}
        {r.marks.some((m) => m.solution || m.video) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {r.marks.map((m) => (
              <span key={m.id} style={{ display: "contents" }}>
                {m.solution && <button type="button" className="btn" disabled={busy} onClick={() => void play(m, "solution")}>🎬 فيديو الحل{m.q ? ` ${m.q}` : ""}</button>}
                {m.video && <button type="button" className="btn" disabled={busy} onClick={() => void play(m, "video")}>▶️ فيديو التوضيح{m.q ? ` ${m.q}` : ""}</button>}
              </span>
            ))}
          </div>
        )}
        {msg && <div className="exhint" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      {yt && <VideoBox title="🎬 فيديو حل السؤال" yt={yt} back="✖ سد وارجع للحل" onClose={() => setYt("")} onFail={fail("solution")} />}
      {clip && <VideoBox title="▶️ فيديو توضيح السؤال" src={clip} back="✖ سد وارجع للحل" onClose={() => setClip("")} onChat={clipMark ? () => { setClip(""); void play(clipMark, "chat"); } : undefined} onFail={fail("video")} />}
    </div>
  );
}

const TXT = {
  ar: { title: "📘 حل سؤالك", q: "❓ سؤالك", photo: "📷 سؤالك بالصورة اللي دزيتها", ai: "🤖 الحل على طريقة الأستاذ", book: "📘 حل الأستاذ من الملزمة", aiNote: "هذا السؤال ما موجود بالملزمة، فانحل بنفس طريقة الأستاذ.", help: "إذا بعدك ما فهمت، ارجع للبوت ودوس «❓ بعدني ما فهمت» ويوصل سؤالك للأستاذ.", loading: "جاري التحميل...", net: "ماكو اتصال، حاول مرة ثانية", err: "صار خطأ" },
  en: { title: "📘 Your solution", q: "❓ Your question", photo: "📷 Your question is in the photo you sent", ai: "🤖 Solved the teacher's way", book: "📘 The teacher's solution from the booklet", aiNote: "This question is not in the booklet, so it was solved with the teacher's method.", help: "Still not clear? Go back to the bot and tap «❓ Still not clear» to send your question to the teacher.", loading: "Loading...", net: "No connection, try again", err: "Something went wrong" },
};

/** سطر الحل: إذا كله رياضيات بدون $ ينكتب معادلة، وإذا بيه كلام وبين $ $ رياضيات ينكتب جملة */
function Line({ text, rtl }: { text: string; rtl: boolean }) {
  if (text.includes("$") || /[؀-ۿ]/.test(text) || /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text)) return <div className="ansline" dir={rtl ? "rtl" : "ltr"}><Inline text={text} /></div>;
  return <div className="ansline"><MathText text={text} /></div>;
}

export default function AnswerClient() {
  const [a, setA] = useState<Ans | null>(null);
  const [error, setError] = useState("");
  const t = TXT[a?.lang === "en" ? "en" : "ar"];
  const rtl = a?.lang !== "en";
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    void (async () => {
      try {
        const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "" }) });
        const j = await res.json();
        if (!res.ok) setError(j.error ?? TXT.ar.err); else setA(j);
      } catch { setError(TXT.ar.net); }
    })();
  }, []);
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>{t.title}</p>
      </header>
      <div className="wrap" dir={rtl ? "rtl" : "ltr"}>
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!a && !error && <div className="empty">{t.loading}</div>}
        {a && (
          <>
            <div className="card">
              <h2>{t.q}</h2>
              <div className="expad">
                {a.where && <div className="exhint">{a.where}</div>}
                {a.question ? <div className="ansq">{a.question}</div> : <div className="exhint">{t.photo}</div>}
              </div>
            </div>
            {a.rasid ? <RasidSolution r={a.rasid} /> : (
              <div className="card">
                <h2>{a.source === "ai" ? t.ai : t.book}</h2>
                <div className="expad anssol">
                  {a.solution.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <Line key={i} text={l} rtl={rtl} />)}
                </div>
                {a.source === "ai" && <div className="expad exhint">{t.aiNote}</div>}
              </div>
            )}
            <div className="exhint" style={{ textAlign: "center", margin: "6px 0 18px" }}>{t.help}</div>
          </>
        )}
      </div>
    </>
  );
}
