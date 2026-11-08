"use client";
// كاميرا داخل الصفحة: تفتح الكاميرا الخلفية مباشرة، بدون قائمة الموبايل (استوديو / ملفات / كاميرا).
// إذا الموبايل ما سمح بالكاميرا، ترجع للطريقة العادية (زر الملف بالكاميرا)
import { useEffect, useRef, useState } from "react";

export default function LiveCamera({ onShot, onClose, onFail }: { onShot: (f: File) => void; onClose: () => void; onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
        if (gone) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play(); setReady(true); }
      } catch { if (!gone) onFail(); }
    })();
    return () => { gone = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => { if (b) onShot(new File([b], "camera.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.9);
  }
  return (
    <div className="lcam">
      <video ref={video} playsInline muted />
      {!ready && <div className="lcamwait">⏳ جاري فتح الكاميرا...</div>}
      <div className="lcamhint">خلي الورقة كلها داخل الصورة، والكتابة عدلة مو مقلوبة</div>
      <div className="lcambar">
        <button type="button" className="exbtn" onClick={onClose}>إلغاء</button>
        <button type="button" className="lcamshot" disabled={!ready} aria-label="صوّر" onClick={shoot} />
        <span />
      </div>
    </div>
  );
}
