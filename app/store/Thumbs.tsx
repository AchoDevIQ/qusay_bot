"use client";
// معاينة الصور المختارة قبل الرفع: كبيرة كفاية حتى يعرف كل صورة لأي سؤال، ويگدر يشيل وحدة
import { useEffect, useMemo } from "react";

export default function Thumbs({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!files.length) return null;
  return (
    <div className="pkthumbs">
      {urls.map((u, i) => (
        <span key={u}>
          <img src={u} alt={`صورة ${i + 1}`} />
          <button type="button" aria-label="شيل الصورة" onClick={() => onRemove(i)}>✕</button>
        </span>
      ))}
    </div>
  );
}
