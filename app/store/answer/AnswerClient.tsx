"use client";
// حل السؤال العلمي: من ملزمة الأستاذ أو محلول على طريقته، والرياضيات مكتوبة مثل الكتاب، كل خطوة بسطر.
// طالب المنهج الإنگليزي يشوف الصفحة كلها بالإنگليزي
import { useEffect, useState } from "react";
import { Inline, MathText } from "../myexams/AiCompare";
import { fixWordLine } from "../../../lib/wordLine.ts";
import { VideoBox } from "../notes/NotesClient";
import { deviceId, haptic, platform, platformNow } from "../shared";

type Mark = { id: number; page: number; video: boolean; solution: boolean; q?: string };
/** rasid: سؤاله موجود بالراصد اللي بملازمه: صفحة الحل النموذجي نفسها، وأزرار فيديو الحل والتوضيح اللي عليها */
type Rasid = { book: number; page: number; topic: string; q: string; marks: Mark[] };
/** notebook: سؤاله محلول بدفتر المحاضرات: صفحاته من بداية السؤال (y مكانه بأول صفحة)، وأزرار فيديوهاته */
type Notebook = { book: number; page: number; pages: number[]; y: number; q: string; where: string; marks: Mark[] };
/** ex: الشروح اللي طلبها على هذا الحل. explain: كم مرة بعد يگدر يسأل (0: الزر ما يطلع). teacher: زر «❓ بعدني ما فهمت» شغال */
type Explained = { ask: string; text: string; at: string };
/** page: انسأل من صفحة «❓ سؤال علمي»، فزر «بعدني ما فهمت» بالصفحة نفسها. sentTo: رقم سؤاله إذا وصل للأستاذ */
type Ans = { similar?: { text: string; where: string }; question: string; where: string; source: "lecture" | "topic" | "ai" | "rasid" | "notebook" | "teacher"; solution: string; lang?: "ar" | "en"; error?: string; rasid?: Rasid; notebook?: Notebook; ex?: Explained[]; explain?: number; teacher?: boolean; page?: boolean; sentTo?: number };

const tgPlatform = platformNow;
const token = () => new URLSearchParams(location.search).get("t") ?? "";

/** صفحة من ملازمي (بنفس شروطها: جهازه، فصوله، اسمه عليها). sol: صفحة الحل النموذجي بالراصد */
function NotePageImg({ book, page, sol, mark }: { book: number; page: number; sol?: boolean; mark?: number }) {
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let url = "";
    void (async () => {
      try {
        const res = await fetch(`/api/notes/page?t=${encodeURIComponent(token())}&book=${book}&page=${page}${sol ? "&sol=1" : ""}&pf=${encodeURIComponent(await platform())}&d=${encodeURIComponent(await deviceId())}`);
        if (!res.ok) { setErr(await res.text().catch(() => "") || "ما انفتحت صفحة الحل"); return; }
        url = URL.createObjectURL(await res.blob());
        setSrc(url);
      } catch { setErr("ماكو اتصال، حاول مرة ثانية"); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [book, page, sol]);
  if (err) return <div className="exbad">⚠️ {err}</div>;
  if (!src) return <div className="empty">جاري فتح الحل...</div>;
  return (
    <div style={{ position: "relative" }}>
      <img src={src} alt="الحل" style={{ width: "100%", display: "block", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff" }} onContextMenu={(e) => e.preventDefault()} draggable={false} />
      {/* بداية سؤاله بالصفحة: خط برتقالي */}
      {mark !== undefined && (
        <div style={{ position: "absolute", left: 0, right: 0, top: `${Math.max(0, mark * 100)}%`, borderTop: "3px solid #e67e22", pointerEvents: "none" }}>
          <span style={{ position: "absolute", top: -14, right: 6, background: "#e67e22", color: "#fff", fontSize: 12, borderRadius: 8, padding: "1px 8px" }}>👇 سؤالك من هنا</span>
        </div>
      )}
    </div>
  );
}

/** حل السؤال من ملازمي: الراصد («📘 الحل النموذجي» نفسه) أو دفتر المحاضرات (صفحاته من بداية السؤال)، وتحته فيديو الحل والتوضيح */
function BookSolution({ book, title, hint, pages, sol, y, marks }: { book: number; title: string; hint: string; pages: number[]; sol?: boolean; y?: number; marks: Mark[] }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [yt, setYt] = useState("");
  const [clip, setClip] = useState("");
  const [clipMark, setClipMark] = useState<Mark | null>(null);
  async function play(m: Mark, kind: "video" | "solution" | "chat") {
    haptic(); setBusy(true); setMsg("⏳ دا يفتح الفيديو...");
    try {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), pf: await platform(), action: "play", book, mark: m.id, kind }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
      if (j.yt) { setYt(j.yt); setMsg(""); }
      else if (j.clip) { setClipMark(m); setClip(`/api/notes/video?t=${encodeURIComponent(token())}&book=${book}&mark=${m.id}&pf=${encodeURIComponent(tgPlatform())}&d=${encodeURIComponent(await deviceId())}`); setMsg(""); }
      else setMsg(`${j.notice}.`);
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  // الفيديو ما اشتغل: رمز الخطأ ينكتب بسجل البوت (مثل الملزمة)
  const fail = (kind: string) => (code: string) => void (async () => {
    await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), pf: await platform(), action: "videoError", book, kind, code }) });
  })().catch(() => undefined);
  const vids = marks.filter((m) => m.solution || m.video);
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="expad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {hint && <div className="exhint">{hint}</div>}
        {vids.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {vids.map((m) => (
              <span key={m.id} style={{ display: "contents" }}>
                {m.solution && <button type="button" className="btn" disabled={busy} onClick={() => void play(m, "solution")}>🎬 فيديو الحل{m.q ? ` ${m.q}` : ""}</button>}
                {m.video && <button type="button" className="btn" disabled={busy} onClick={() => void play(m, "video")}>▶️ فيديو التوضيح{m.q ? ` ${m.q}` : ""}</button>}
              </span>
            ))}
          </div>
        )}
        {msg && <div className="exhint">{msg}</div>}
        {pages.map((p, i) => <NotePageImg key={p} book={book} page={p} sol={sol} mark={i === 0 && y !== undefined && y > 0.05 ? y : undefined} />)}
      </div>
      {yt && <VideoBox title="🎬 فيديو حل السؤال" yt={yt} back="✖ سد وارجع للحل" onClose={() => setYt("")} onFail={fail("solution")} />}
      {clip && <VideoBox title="▶️ فيديو توضيح السؤال" src={clip} back="✖ سد وارجع للحل" onClose={() => setClip("")} onChat={clipMark ? () => { setClip(""); void play(clipMark, "chat"); } : undefined} onFail={fail("video")} />}
    </div>
  );
}

const TXT = {
  ar: { title: "📘 حل سؤالك", q: "❓ سؤالك", photo: "📷 سؤالك بالصورة اللي دزيتها", ai: "📘 الحل", book: "📘 الحل", aiNote: "", help: "إذا بعدك ما فهمت، ارجع للبوت ودوس «❓ بعدني ما فهمت» ويوصل سؤالك للأستاذ.", step: "🤔 ما فهمت خطوة", stepHint: "اكتب شنو ما فهمت بالحل، مثلاً: «ليش صارت سالب بالسطر الثالث؟»", send: "اشرحلي", wait: "⏳ دا يشرحها...", you: "❓ سألت", left: (n: number) => `باقي ${n} مرة على هذا الحل`, loading: "جاري التحميل...", net: "ماكو اتصال، حاول مرة ثانية", err: "صار خطأ" },
  en: { title: "📘 Your solution", q: "❓ Your question", photo: "📷 Your question is in the photo you sent", ai: "📘 The solution", book: "📘 The solution", aiNote: "", help: "Still not clear? Go back to the bot and tap «❓ Still not clear» to send your question to the teacher.", step: "🤔 I didn't get a step", stepHint: "Write what you did not understand, e.g. «why did it become negative in line 3?»", send: "Explain", wait: "⏳ Explaining...", you: "❓ You asked", left: (n: number) => `${n} more on this solution`, loading: "Loading...", net: "No connection, try again", err: "Something went wrong" },
};

/** سطر الحل: إذا كله رياضيات بدون $ ينكتب معادلة، وإذا بيه كلام وبين $ $ رياضيات ينكتب جملة */
/** السطر اللي يبدي بمعادلة لو إنگليزي يبدي من اليسار، والعربي من اليمين (طلبه 2026-11-24) */
function Line({ text: raw, rtl }: { text: string; rtl: boolean }) {
  const text = fixWordLine(raw);
  const ltr = /^\s*(\$|[A-Za-z0-9\\(])/.test(text);
  if (text.includes("$") || /[؀-ۿ]/.test(text) || /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text)) return <div className="ansline" dir={ltr ? "ltr" : rtl || /[؀-ۿ]/.test(text) ? "rtl" : "ltr"}><Inline text={text} /></div>;
  return <div className="ansline"><MathText text={text} /></div>;
}

/** «🤔 ما فهمت خطوة»: يكتب شنو ما فهم، والشرح ينكتب تحت الحل (وينحفظ، يرجع إذا فتح الحل مرة ثانية) */
function StepHelp({ a, t, rtl, onDone }: { a: Ans; t: (typeof TXT)["ar"]; rtl: boolean; onDone: (ex: Explained[], left: number) => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ex = a.ex ?? [];
  async function send() {
    if (ask.trim().length < 3 || busy) return;
    haptic(); setBusy(true); setErr("");
    try {
      const q = new URLSearchParams(location.search);
      const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "", action: "explain", ask }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? t.err);
      onDone(j.ex, j.left); setAsk(""); setOpen(false);
    } catch (e) { setErr((e as Error).message || t.net); } finally { setBusy(false); }
  }
  if (!ex.length && !a.explain) return null;
  return (
    <>
      {ex.map((x, i) => (
        <div key={i} className="card">
          <h2>{t.you}: «{x.ask}»</h2>
          <div className="expad anssol">{x.text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, k) => <Line key={k} text={l} rtl={rtl} />)}</div>
        </div>
      ))}
      {!!a.explain && (
        <div className="card">
          {!open ? <button type="button" className="btn" style={{ width: "100%" }} onClick={() => { haptic(); setOpen(true); }}>{t.step}</button> : (
            <div className="expad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="exhint">{t.stepHint}</div>
              <textarea value={ask} maxLength={500} rows={3} dir={rtl ? "rtl" : "ltr"} disabled={busy} onChange={(e) => setAsk(e.target.value)} style={{ width: "100%", boxSizing: "border-box", fontSize: 16, padding: 8, borderRadius: 8 }} />
              <button type="button" className="btn" disabled={busy || ask.trim().length < 3} onClick={() => void send()}>{busy ? t.wait : t.send}</button>
              {err && <div className="exbad">⚠️ {err}</div>}
              <div className="exhint">{t.left(a.explain)}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** «📄 دزلي الحل PDF»: ملف الحل بهيدر يوصله بالبوت والتطبيق */
function PdfBtn({ en }: { en: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function go() {
    haptic(); setBusy(true); setMsg(en ? "⏳ ..." : "⏳ ...");
    try {
      const q = new URLSearchParams(location.search);
      const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "", action: "pdf" }) });
      const j = await res.json();
      setMsg(res.ok ? j.notice : `⚠️ ${j.error ?? ""}`);
    } catch { setMsg(en ? "⚠️ No connection, try again" : "⚠️ ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); }
  }
  return (
    <div style={{ margin: "6px 0 10px", textAlign: "center" }}>
      <button type="button" className="btn" disabled={busy} onClick={() => void go()}>{en ? "📄 Send me the solution as PDF" : "📄 دزلي الحل PDF"}</button>
      {msg && <div className="exhint">{msg}</div>}
    </div>
  );
}

/** «❓ بعدني ما فهمت، وصّل سؤالي للأستاذ»: سؤاله (الكتابة والصورة) يروح للأستاذ، والجواب يوصله بالبوت */
function ToTeacher({ a, setA, en }: { a: Ans; setA: (x: Ans) => void; en: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (a.sentTo) return <div className="fdok" style={{ textAlign: "center", margin: "6px 0 18px" }}>{en ? `✅ Your question (#${a.sentTo}) reached the teacher. The answer comes to you in the bot.` : `✅ وصل سؤالك (رقم #${a.sentTo}) للأستاذ، والجواب يوصلك بالبوت.`}</div>;
  async function go() {
    haptic(); setBusy(true); setErr("");
    try {
      const q = new URLSearchParams(location.search);
      const res = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: q.get("t") ?? "", id: q.get("a") ?? "", action: "teacher" }) });
      const j = await res.json();
      if (!res.ok) setErr(j.error ?? "صار خطأ"); else setA({ ...a, sentTo: j.sentTo });
    } catch { setErr("ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); }
  }
  return (
    <div style={{ margin: "6px 0 18px" }}>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void go()}>{en ? "❓ Still not clear: send my question to the teacher" : "❓ بعدني ما فهمت، وصّل سؤالي للأستاذ"}</button>
      {err && <div className="exbad">⚠️ {err}</div>}
    </div>
  );
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
            {a.rasid ? <BookSolution book={a.rasid.book} title="📝 الحل النموذجي من الراصد" hint={`${a.rasid.topic}${a.rasid.q ? ` · ${a.rasid.q}` : ""}`} pages={[a.rasid.page]} sol marks={a.rasid.marks} />
              : a.notebook ? <BookSolution book={a.notebook.book} title="📘 حل الأستاذ من دفتر المحاضرات" hint={`${a.notebook.where ? `${a.notebook.where} · ` : ""}صفحة ${a.notebook.page}`} pages={a.notebook.pages} y={a.notebook.y} marks={a.notebook.marks} /> : (
              <>
              {/* سؤال مشابه من الملزمة ويا حله، وبعده حل سؤاله (طلبه 2026-11-24) */}
              {a.similar && (
                <div className="card">
                  <h2>{rtl ? "📗 سؤال مشابه من الملزمة" : "📗 A similar question from the booklet"}</h2>
                  <div className="expad anssol">
                    {a.similar.where && <div className="exhint">{a.similar.where}</div>}
                    {a.similar.text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <Line key={i} text={l} rtl={rtl} />)}
                  </div>
                </div>
              )}
              <div className="card">
                <h2>{a.similar ? (rtl ? "📘 حل سؤالك" : "📘 Your question's solution") : a.source === "ai" ? t.ai : a.source === "teacher" ? (rtl ? "✏️ حل الأستاذ" : "✏️ The teacher's solution") : t.book}</h2>
                <div className="expad anssol">
                  {a.solution.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <Line key={i} text={l} rtl={rtl} />)}
                </div>
                {a.source === "ai" && t.aiNote && <div className="expad exhint">{t.aiNote}</div>}
              </div>
              </>
            )}
            {!a.rasid && !a.notebook && <PdfBtn en={!rtl} />}
            {!a.rasid && !a.notebook && <StepHelp a={a} t={t} rtl={rtl} onDone={(ex, left) => setA({ ...a, ex, explain: left })} />}
            {a.teacher !== false && (a.page ? <ToTeacher a={a} setA={setA} en={!rtl} /> : <div className="exhint" style={{ textAlign: "center", margin: "6px 0 18px" }}>{t.help}</div>)}
          </>
        )}
      </div>
    </>
  );
}
