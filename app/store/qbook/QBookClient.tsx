"use client";
// 📘 ملزمة المحاضرة (ملحق بمحاضرة التطبيق): أسئلة المحاضرة من الوزاري والإثرائي، كل سؤال وحله (صفحة «الحل النموذجي» بيها السؤال وحله).
// الصفحات نفسها مال «📚 ملازمي» (بنفس الحماية: اسمه عليها، جهازه، وقفل الامتحان)، فإذا بدّل الأستاذ ملزمة تتبدل هنا وحدها
import { useEffect, useState } from "react";
import { deviceId, deviceNow, platform, platformNow } from "../shared";
import { VideoBox } from "../notes/NotesClient";

// 🎬 أزرار فيديو الحل والتوضيح (نفس اللي بالملزمة) تحت كل سؤال بـ«الحل النموذجي» بس (طلبه 2026-11-26)
type VMark = { id: number; page: number; video: boolean; solution: boolean; q?: string };
async function notesPost(body: Record<string, unknown>) {
  const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: new URLSearchParams(location.search).get("t") ?? "", device: await deviceId(), pf: await platform(), ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
  return j;
}

type Q = { book: number; page: number; sec: "book" | "wz" | "ith" };
type Lec = { id: string; title: string; topic: string; ch: number; items: Q[] };
const SEC = { book: "📘 أمثلة وأسئلة الكتاب", wz: "📗 وزاري", ith: "📙 إثرائي" } as const;
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
const token = () => new URLSearchParams(location.search).get("t") ?? "";
const src = (q: Q, sol: boolean) => `/api/notes/page?t=${encodeURIComponent(token())}&book=${q.book}&page=${q.page}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}${sol ? "&sol=1" : ""}`;

/** mode: «q» أسئلة بس (تبويب «الأسئلة» تحت الفيديو)، «sol» كل سؤال وحله (تبويب «الحل النموذجي»)، وبلاه الملزمة مثل قبل.
 *  embedded: جوه تبويب بالتطبيق، بلا الرأس الكبير */
export default function QBookClient({ mode, embedded }: { mode?: "q" | "sol"; embedded?: boolean } = {}) {
  const [lec, setLec] = useState<Lec | null>(null);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [marks, setMarks] = useState<Record<number, VMark[]>>({});
  const [vid, setVid] = useState<{ title: string; yt?: string; src?: string; book: number; kind: string } | null>(null);
  const [vmsg, setVmsg] = useState("");
  // علامات الفيديو لكل ملزمة بيها أسئلة هاي المحاضرة (مرة وحدة لكل ملزمة)
  useEffect(() => {
    if (mode !== "sol" || !lec) return;
    for (const b of [...new Set(lec.items.map((x) => x.book))]) {
      void notesPost({ action: "marks", book: b }).then((j) => setMarks((m) => ({ ...m, [b]: (j.marks ?? []) as VMark[] }))).catch(() => undefined);
    }
  }, [mode, lec]);
  async function play(book: number, m: VMark, kind: "video" | "solution") {
    setVmsg("⏳ دا يفتح الفيديو...");
    try {
      const j = await notesPost({ action: "play", book, mark: m.id, kind });
      if (j.yt) { setVid({ title: "🎬 فيديو حل السؤال", yt: j.yt, book, kind }); setVmsg(""); }
      else if (j.clip) { setVid({ title: "▶️ فيديو توضيح السؤال", src: `/api/notes/video?t=${encodeURIComponent(token())}&book=${book}&mark=${m.id}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}`, book, kind }); setVmsg(""); }
      else setVmsg(j.notice ?? "");
    } catch (e) { setVmsg(`⚠️ ${(e as Error).message}`); }
  }
  useEffect(() => {
    void (async () => {
      try {
        await deviceId(); setReady(true);
        const q = new URLSearchParams(location.search);
        const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token(), action: "lq", lec: q.get("lec") }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "صار خطأ");
        setLec(j);
        // الملزمة كاملة: كل سؤال وحله ظاهر، ويگدر يخفي الحلول حتى يحاول بنفسه
        setOpen(mode === "q" ? {} : Object.fromEntries((j.items as Q[]).map((_, i) => [i, true])));
      } catch (e) { setErr((e as Error).message); }
    })();
  }, []);
  const all = lec ? lec.items.every((_, i) => open[i]) : false;
  return (
    <div className="qq" dir="rtl">
      <style>{CSS}</style>
      {!embedded && <header>
        <img src="/app-logo.png" alt="" />
        <div><b>ملزمة المحاضرة</b>{lec && <small>الفصل {ORD[lec.ch]} · {lec.topic} · {lec.title} · {lec.items.filter((x) => x.sec !== "book").length} سؤال</small>}</div>
        {lec && !mode && <button type="button" onClick={() => setOpen(all ? {} : Object.fromEntries(lec.items.map((_, i) => [i, true])))}>{all ? "اخفي الحلول" : "كل الحلول"}</button>}
      </header>}
      {embedded && lec && <div className="qq-top">{mode === "sol" ? "✅ الحل النموذجي" : "📘 أسئلة المحاضرة"} · {lec.topic} · {lec.title}{mode === "q" ? <small>حلها على «✍️ سبورة الحل»، وشوف حلي بـ«✅ الحل النموذجي»</small> : null}</div>}
      {err && <div className="qq-msg">{err}</div>}
      {!err && !lec && <div className="qq-msg">جاري التحميل...</div>}
      {ready && lec?.items.map((q, i) => (
        <section key={`${q.book}-${q.page}`}>
          <div className="qq-tag">{SEC[q.sec]}{q.sec === "book" ? "" : ` · سؤال ${lec.items.slice(0, i + 1).filter((x) => x.sec === q.sec).length}`}</div>
          {/* الكتاب: الصفحة نفسها (الشرح والأمثلة والأسئلة). الوزاري والإثرائي: صفحة الحل بيها السؤال فوك وحله تحته، و«اخفي الحلول» يطلع السؤال بس */}
          {q.sec === "book"
            ? <img className="qq-pg" src={src(q, false)} alt="صفحة الكتاب" loading={i < 2 ? "eager" : "lazy"} />
            : open[i]
            ? <><img className="qq-pg sol" src={src(q, true)} alt={`السؤال ${i + 1} وحله`} loading={i < 2 ? "eager" : "lazy"} />
              {mode === "sol" && (() => {
                const ms = (marks[q.book] ?? []).filter((m) => m.page === q.page && (m.solution || m.video));
                return ms.length ? <div className="qq-vids">{ms.map((m) => <span key={m.id}>
                  {m.solution && <button type="button" onClick={() => void play(q.book, m, "solution")}>🎬 فيديو الحل{ms.length > 1 && m.q ? ` ${m.q}` : ""}</button>}
                  {m.video && <button type="button" onClick={() => void play(q.book, m, "video")}>▶️ توضيح{ms.length > 1 && m.q ? ` ${m.q}` : ""}</button>}
                </span>)}</div> : null;
              })()}</>
            : <><img className="qq-pg" src={src(q, false)} alt={`سؤال ${i + 1}`} loading="lazy" />
              {mode !== "q" && <button type="button" className="qq-sol" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}>📘 الحل</button>}</>}
        </section>
      ))}
      {vmsg && <div className="qq-vmsg">{vmsg}</div>}
      {vid && <VideoBox title={vid.title} yt={vid.yt} src={vid.src} back="✖ سد وارجع للحل" onClose={() => setVid(null)} onFail={(code) => void notesPost({ action: "videoError", book: vid.book, kind: vid.kind, code }).catch(() => undefined)} />}
    </div>
  );
}

const CSS = `
.qq{min-height:100vh;background:#F5F6FA;color:#141F33;font-family:QAppAr,Cairo,Tahoma,sans-serif;padding-bottom:40px}
.qq header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:#141F33;color:#fff;padding:10px 16px;border-bottom:3px solid #F6C94A}
.qq header img{width:44px;height:44px;object-fit:cover;object-position:52% 54%;transform:scale(1.5)}
.qq header div{flex:1;display:flex;flex-direction:column;min-width:0}
.qq header b{color:#F6C94A;font-size:19px}
.qq header small{color:#C9D1E0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq header button{background:#F6C94A;color:#141F33;border:0;border-radius:10px;padding:8px 12px;font:inherit;font-weight:700;min-height:44px}
.qq section{max-width:900px;margin:16px auto 0;padding:0 16px}
.qq-tag{font-weight:700;color:#8A6420;margin:0 4px 6px}
.qq-pg{display:block;width:100%;height:auto;background:#fff;border-radius:10px;box-shadow:0 1px 6px rgba(20,31,51,.12)}
.qq-pg.sol{border:2px solid #F6C94A}
.qq-sol{display:block;width:100%;margin-top:10px;min-height:52px;border:2px dashed #F6C94A;background:#fff;color:#141F33;border-radius:12px;font:inherit;font-size:17px;font-weight:700}
.qq-top{max-width:900px;margin:12px auto 0;padding:0 16px;font-weight:800;color:#141F33;display:flex;flex-direction:column;gap:2px}.qq-top small{font-weight:600;color:#5C667A}
.qq-vids{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.qq-vids span{display:contents}
.qq-vids button{flex:1;min-width:140px;min-height:46px;border-radius:12px;border:0;background:#141F33;color:#F6C94A;font:inherit;font-weight:800}
.qq-vmsg{position:fixed;left:16px;right:16px;bottom:20px;background:#141F33;color:#fff;border-radius:12px;padding:12px;text-align:center;font-weight:700;z-index:20}
.qq-msg{max-width:600px;margin:40px auto;padding:0 16px;text-align:center;font-size:18px;line-height:1.8}
`;
