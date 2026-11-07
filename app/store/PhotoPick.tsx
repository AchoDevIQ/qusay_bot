"use client";
// اختيار صورة الجواب: أول مرة يختار كاميرا أو استوديو أو ملف، والبوت يتذكر اختياره ويطلعله نفس الزر بعدين.
// ملف PDF يتحول كل صفحة منه لصورة
import { useEffect, useRef, useState } from "react";

export type Way = "camera" | "gallery" | "file";
const KEY = "qmathPickWay";
const LABEL: Record<Way, string> = { camera: "📷 الكاميرا", gallery: "🖼 الاستوديو", file: "📄 ملف (PDF أو صورة)" };

function savedWay(): Way | null {
  try { const w = localStorage.getItem(KEY); return w === "camera" || w === "gallery" || w === "file" ? w : null; } catch { return null; }
}
function saveWay(w: Way) { try { localStorage.setItem(KEY, w); } catch { /* المتصفح مانع الحفظ */ } }

/** كل صفحة من PDF تصير صورة JPG */
async function pdfFiles(f: File): Promise<File[]> {
  const { pdfToImages } = await import("./PdfPages");
  const url = URL.createObjectURL(f);
  try {
    const pages = await pdfToImages(url, 1600);
    return await Promise.all(pages.map(async (u, i) => new File([await (await fetch(u)).blob()], `page${i + 1}.jpg`, { type: "image/jpeg" })));
  } finally { URL.revokeObjectURL(url); }
}

export default function PhotoPick({ onFiles, multiple = false, busy = false }: { onFiles: (files: File[]) => void; multiple?: boolean; busy?: boolean }) {
  const [way, setWay] = useState<Way | null>(null);
  const [choose, setChoose] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  // الطريقة الجديدة تنحفظ بعد ما يختار الصورة، حتى ما تتبدل الأزرار ونافذة الاختيار بعدها مفتوحة
  const next = useRef<Way | null>(null);
  useEffect(() => { setWay(savedWay()); }, []);
  async function got(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    if (next.current) { saveWay(next.current); setWay(next.current); setChoose(false); next.current = null; }
    setErr(""); setWorking(true);
    try {
      const out: File[] = [];
      for (const f of files) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) out.push(...await pdfFiles(f));
        else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) out.push(f);
      }
      if (!out.length) setErr("لازم صورة أو ملف PDF");
      else onFiles(out);
    } catch { setErr("ما گدرت أفتح الملف، جرب صورة"); } finally { setWorking(false); }
  }
  const input = (w: Way) => (
    <input type="file" hidden multiple={multiple || w === "file"}
      accept={w === "file" ? "image/*,application/pdf" : "image/*"}
      {...(w === "camera" ? { capture: "environment" as const } : {})}
      onChange={(e) => { const l = e.target.files; void got(l); e.target.value = ""; }} />
  );
  const pick = (w: Way) => <label key={w} className="exbtn" onClick={() => { next.current = w; }}>{LABEL[w]}{input(w)}</label>;
  if (working) return <div className="exhint">⏳ جاري تجهيز الملف...</div>;
  return (
    <div className="pkwrap">
      {!way || choose ? (
        <>
          {!way && <div className="exhint">منين تريد تجيب الصورة؟ البوت يتذكر اختيارك للمرات الجاية.</div>}
          <div className="exline">{(["camera", "gallery", "file"] as Way[]).map(pick)}</div>
        </>
      ) : (
        <div className="exline">
          <label className={"btn" + (busy ? " off" : "")}>{LABEL[way]}{input(way)}</label>
          <button type="button" className="exbtn" onClick={() => setChoose(true)}>🔄 غيّر الطريقة</button>
        </div>
      )}
      {err && <div className="err">⚠️ {err}</div>}
    </div>
  );
}
