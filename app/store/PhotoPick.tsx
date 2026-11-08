"use client";
// اختيار صورة الجواب: أول مرة يختار كاميرا أو استوديو، والبوت يتذكر اختياره ويطلعله نفس الزر بعدين.
// الكاميرا تنفتح داخل الصفحة مباشرة (بدون قائمة الموبايل)، وإذا الموبايل ما سمح، ترجع للطريقة العادية.
// ماكو ملفات: الطالب لازم يصور ورقته
import { useEffect, useState } from "react";
import LiveCamera from "./LiveCamera";

export type Way = "camera" | "gallery";
const KEY = "qmathPickWay";
const LABEL: Record<Way, string> = { camera: "📷 الكاميرا", gallery: "🖼 الاستوديو" };

function savedWay(): Way | null {
  try { const w = localStorage.getItem(KEY); return w === "camera" || w === "gallery" ? w : null; } catch { return null; }
}
/** آيفون: زر الاستوديو دائماً يطلع قائمة (مكتبة الصور / التقاط صورة / اختيار ملف)، وهذا من آبل ما ينشال */
const isIos = () => { try { return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform === "ios"; } catch { return false; } };
function saveWay(w: Way) { try { localStorage.setItem(KEY, w); } catch { /* المتصفح مانع الحفظ */ } }

export default function PhotoPick({ onFiles, multiple = false, busy = false, label }: { onFiles: (files: File[]) => void; multiple?: boolean; busy?: boolean; label?: string }) {
  const [way, setWay] = useState<Way | null>(null);
  const [choose, setChoose] = useState(false);
  const [cam, setCam] = useState(false);
  // الموبايل ما سمح بالكاميرا داخل الصفحة: زر الكاميرا يصير زر الموبايل العادي
  const [nativeCam, setNativeCam] = useState(false);
  const [err, setErr] = useState("");
  const [ios, setIos] = useState(false);
  useEffect(() => { setWay(savedWay()); setIos(isIos()); }, []);
  function use(w: Way) { saveWay(w); setWay(w); setChoose(false); }
  function got(list: FileList | null, w: Way) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list?.length) return;
    use(w);
    if (!files.length) { setErr("لازم صورة"); return; }
    setErr("");
    onFiles(multiple ? files : files.slice(0, 1));
  }
  const fileButton = (w: Way, cls: string, text: string) => (
    <label key={w} className={cls}>{text}
      <input type="file" hidden multiple={multiple && w === "gallery"} accept="image/*"
        {...(w === "camera" ? { capture: "environment" as const } : {})}
        onChange={(e) => { const l = e.target.files; got(l, w); e.target.value = ""; }} />
    </label>
  );
  const button = (w: Way, cls: string, text: string) =>
    w === "camera" && !nativeCam
      ? <button key={w} type="button" className={cls} disabled={busy} onClick={() => { use("camera"); setCam(true); }}>{text}</button>
      : fileButton(w, cls, text);
  return (
    <div className="pkwrap">
      {cam && <LiveCamera onClose={() => setCam(false)} onFail={() => { setCam(false); setNativeCam(true); setErr("الموبايل ما سمح بفتح الكاميرا هنا. دوس 📷 الكاميرا مرة ثانية"); }}
        onShot={(f) => { setCam(false); setErr(""); onFiles([f]); }} />}
      {!way || choose ? (
        <>
          {!way && <div className="exhint">منين تريد تجيب الصورة؟ البوت يتذكر اختيارك للمرات الجاية.</div>}
          <div className="exline">{(["camera", "gallery"] as Way[]).map((w) => button(w, "exbtn", LABEL[w]))}</div>
        </>
      ) : (
        <div className="exline">
          {button(way, "btn", label ? `${LABEL[way]} · ${label}` : LABEL[way])}
          <button type="button" className="exbtn" onClick={() => setChoose(true)}>🔄 غيّر الطريقة</button>
        </div>
      )}
      {ios && (way === "gallery" || !way || choose) && <div className="exhint">🖼 بالآيفون، من تدوس الاستوديو تطلع قائمة صغيرة: اختار «مكتبة الصور».</div>}
      {err && <div className="err">⚠️ {err}</div>}
    </div>
  );
}
