"use client";
// ▶️ فيديو سؤال (الحل لو التوضيح) من زر تحت ملف حل السؤال العلمي (طلب الأستاذ 2026-11-24): ينفتح بنفس مشغّل الملزمة،
// ورابط يوتيوب ما يبين للطالب أبداً. نفس شروط ملازمي (جهازه، فصوله)
import { useEffect, useState } from "react";
import { VideoBox } from "../notes/NotesClient";
import { closeApp, deviceId, platform, platformNow } from "../shared";

const q = () => new URLSearchParams(typeof window === "undefined" ? "" : location.search);

export default function VidClient() {
  const [yt, setYt] = useState("");
  const [clip, setClip] = useState("");
  const [msg, setMsg] = useState("⏳ ...");
  const [title, setTitle] = useState("");
  useEffect(() => {
    void (async () => {
      const p = q();
      const book = Number(p.get("book")), mark = Number(p.get("mark")), kind = p.get("kind") === "solution" ? "solution" : "video";
      setTitle(kind === "solution" ? "🎬 فيديو حل السؤال" : "▶️ فيديو توضيح السؤال");
      try {
        const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: p.get("t") ?? "", device: await deviceId(), pf: await platform(), action: "play", book, mark, kind }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(`⚠️ ${j.error ?? "صار خطأ، حاول مرة ثانية"}`); return; }
        if (j.yt) { setYt(j.yt); setMsg(""); }
        else if (j.clip) { setClip(`/api/notes/video?t=${encodeURIComponent(p.get("t") ?? "")}&book=${book}&mark=${mark}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(await deviceId())}`); setMsg(""); }
        else setMsg(String(j.notice ?? ""));
      } catch { setMsg("⚠️ ماكو اتصال، حاول مرة ثانية"); }
    })();
  }, []);
  const fail = (code: string) => void (async () => {
    const p = q();
    await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: p.get("t") ?? "", device: await deviceId(), pf: await platform(), action: "videoError", book: Number(p.get("book")), kind: p.get("kind") === "solution" ? "solution" : "video", code }) });
  })().catch(() => undefined);
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>{title}</p>
      </header>
      <div className="wrap">
        {msg && <div className="card expad" style={{ textAlign: "center" }}>{msg}</div>}
        {(yt || clip) && <VideoBox title={title} yt={yt || undefined} src={clip || undefined} back="✖ سد" onClose={() => closeApp()} onFail={fail} />}
      </div>
    </>
  );
}
