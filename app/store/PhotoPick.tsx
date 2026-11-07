"use client";
// اختيار صورة الجواب: أول مرة يختار كاميرا أو استوديو، والبوت يتذكر اختياره ويطلعله نفس الزر بعدين.
// ماكو ملفات: الطالب لازم يصور ورقته
import { useEffect, useRef, useState } from "react";

export type Way = "camera" | "gallery";
const KEY = "qmathPickWay";
const LABEL: Record<Way, string> = { camera: "📷 الكاميرا", gallery: "🖼 الاستوديو" };

function savedWay(): Way | null {
  try { const w = localStorage.getItem(KEY); return w === "camera" || w === "gallery" ? w : null; } catch { return null; }
}
function saveWay(w: Way) { try { localStorage.setItem(KEY, w); } catch { /* المتصفح مانع الحفظ */ } }

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
        if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) out.push(f);
      }
      if (!out.length) setErr("لازم صورة");
      else onFiles(out);
    } catch { setErr("ما گدرت أفتح الصورة، جرب مرة ثانية"); } finally { setWorking(false); }
  }
  const input = (w: Way) => (
    <input type="file" hidden multiple={multiple && w === "gallery"} accept="image/*"
      {...(w === "camera" ? { capture: "environment" as const } : {})}
      onChange={(e) => { const l = e.target.files; void got(l); e.target.value = ""; }} />
  );
  const pick = (w: Way) => <label key={w} className="exbtn" onClick={() => { next.current = w; }}>{LABEL[w]}{input(w)}</label>;
  if (working) return <div className="exhint">⏳ جاري تجهيز الصورة...</div>;
  return (
    <div className="pkwrap">
      {!way || choose ? (
        <>
          {!way && <div className="exhint">منين تريد تجيب الصورة؟ البوت يتذكر اختيارك للمرات الجاية.</div>}
          <div className="exline">{(["camera", "gallery"] as Way[]).map(pick)}</div>
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
