"use client";
// تكبير الصور بالآيباد (طلب الأستاذ 2026-11-24): تيليگرام يقفل تكبير الصفحة بالأصابع، فأي صورة ورقة (ورقة الطالب، العلامات الحمرة،
// صور الأجوبة) تندس فتنفتح على الشاشة كاملة، وتكبر بالقرصة (إصبعين) لو بـ ➕ ➖ لو بدوستين سريعات، وتتحرك بالسحب
import { useEffect, useRef, useState } from "react";

// الأشياء اللي تنكبر. صفحة التصحيح إلها تكبيرها، فما تدخل
const TARGETS = ".mkpage, .sidepage, .aicbig img, .exfull img, img.eximg";
const SKIP = ".grpaper, .gk-paper, .mk.mktap, button, a, input, textarea, .zoomov";

export default function ZoomLayer() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest(SKIP)) return;
      const el = t.closest(TARGETS) as HTMLElement | null;
      if (!el) return;
      const copy = el.cloneNode(true) as HTMLElement;
      copy.style.width = "100%";
      copy.style.maxWidth = "none";
      copy.style.margin = "0";
      setScale(1);
      setNode(copy);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const b = box.current;
    if (!b || !node) return;
    b.querySelector(".zoomin")?.replaceChildren(node);
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: dist(e.touches), s: scaleRef.current }; };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      e.preventDefault();
      setScale(Math.min(6, Math.max(1, pinch.current.s * dist(e.touches) / pinch.current.d)));
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null;
      // دوستين سريعات: تكبير لو رجوع
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const now = Date.now();
        if (now - lastTap.current < 300) setScale((s) => (s > 1.2 ? 1 : 2.5));
        lastTap.current = now;
      }
    };
    b.addEventListener("touchstart", start, { passive: true });
    b.addEventListener("touchmove", move, { passive: false });
    b.addEventListener("touchend", end, { passive: true });
    return () => { b.removeEventListener("touchstart", start); b.removeEventListener("touchmove", move); b.removeEventListener("touchend", end); };
  }, [node]);
  const scaleRef = useRef(1);
  scaleRef.current = scale;

  if (!node) return null;
  return (
    <div className="zoomov" ref={box}>
      <div className="zoombar">
        <button type="button" onClick={() => setNode(null)}>✕</button>
        <button type="button" onClick={() => setScale((s) => Math.max(1, s / 1.4))}>➖</button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale((s) => Math.min(6, s * 1.4))}>➕</button>
      </div>
      <div className="zoomscroll"><div className="zoomin" style={{ width: `${scale * 100}%` }} /></div>
    </div>
  );
}
