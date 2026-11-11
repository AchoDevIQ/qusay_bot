"use client";
// ✏️ اكتب بالقلم: ورقة وحدة لكل سؤال بكل الشاشة (مثل صفحة التصحيح). فوك هدر بسطر واحد: الفصل والموضوع بطرف،
// اسم الطالب بالنص، والنسخة ورقمه بالطرف الثاني. بعده السؤال (بدون درجته)، وتحته سطور يكتب عليها بقلم الآيباد.
// الأدوات: القلم (ألوانه وسماكته نفس المصحح)، المسطرة (خط مستقيم)، الممحاة، والرجوع.
// الكتابة تنحفظ بالجهاز أول بأول، وتندز كصورة جواب مثل الكاميرا بالضبط، ويگدر يعدلها لحد ما يسلم.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadImage, W, type HeaderInfo } from "../grade/compose";
import { drawPaper, H } from "./penPaper";
import { COLORS, WIDTHS } from "../grade/pens";
import { haptic } from "../shared";

export type PenHead = { slug: string; chapter: string; title: string; info: string; name: string; lang: string };
type Stroke = { c: string; w: number; p: number[] };
type Tool = "pen" | "ruler" | "eraser";
const SCALE = 1.5;              // الورقة تنرسم أوضح من حجم الشاشة، حتى الصورة تطلع حادة
const PX: Record<number, number> = { 2: 4, 5: 9 };   // سماكة القلم بالورقة
const draftKey = (item: number, q: number) => `penDraft:${item}:${q}`;
const readDraft = (item: number, q: number): Stroke[] => { try { const j = JSON.parse(localStorage.getItem(draftKey(item, q)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };
const keepDraft = (item: number, q: number, s: Stroke[]) => { try { localStorage.setItem(draftKey(item, q), JSON.stringify(s)); } catch { /* بدون حفظ */ } };
export const hasPenDraft = (item: number, q: number) => readDraft(item, q).length > 0;

function drawStrokes(ctx: CanvasRenderingContext2D, list: Stroke[]) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of list) {
    ctx.strokeStyle = s.c; ctx.lineWidth = PX[s.w] ?? s.w;
    ctx.beginPath();
    if (s.p.length === 2) { ctx.arc(s.p[0], s.p[1], (PX[s.w] ?? s.w) / 2, 0, Math.PI * 2); ctx.fillStyle = s.c; ctx.fill(); continue; }
    ctx.moveTo(s.p[0], s.p[1]);
    // خط ناعم: منتصف كل نقطتين
    for (let i = 2; i < s.p.length - 2; i += 2) ctx.quadraticCurveTo(s.p[i], s.p[i + 1], (s.p[i] + s.p[i + 2]) / 2, (s.p[i + 1] + s.p[i + 3]) / 2);
    ctx.lineTo(s.p[s.p.length - 2], s.p[s.p.length - 1]);
    ctx.stroke();
  }
}

type FullApp = { isVersionAtLeast?(v: string): boolean; requestFullscreen?(): void; isFullscreen?: boolean };
/** الورقة تاخذ كل الشاشة، وملء الشاشة بالتليجرام إذا يدعمه (مثل صفحة التصحيح) */
function useFull() {
  useEffect(() => {
    document.body.classList.add("penfull");
    const w = (window as unknown as { Telegram?: { WebApp?: FullApp } }).Telegram?.WebApp;
    try { if (w?.isVersionAtLeast?.("8.0") && !w.isFullscreen) w.requestFullscreen?.(); } catch { /* نسخة قديمة */ }
    return () => { document.body.classList.remove("penfull"); };
  }, []);
}

export default function PenPage({ item, sid, model, head, q, imgUrl, busy, timer, onSave, onClose }: {
  item: number; sid: number; model: string; head: PenHead; q: { n: number; max: number }; imgUrl: string | null; busy: boolean; timer?: ReactNode;
  onSave: (file: File) => Promise<boolean>; onClose: () => void;
}) {
  useFull();
  const bg = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(() => readDraft(item, q.n));
  const live = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [width, setWidth] = useState(2);
  const [penBox, setPenBox] = useState(false);
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState(0.5);
  const [sure, setSure] = useState(false);
  const info: HeaderInfo = { slug: head.slug, chapter: head.chapter, title: head.title, info: head.info, model, name: head.name, total: 0, lang: head.lang === "en" ? "en" : "ar", sid };

  // الورقة تدخل كلها بالشاشة تحت شريط الأدوات، بدون تحريك
  useEffect(() => {
    const size = () => {
      const top = bar.current?.getBoundingClientRect().bottom ?? 80;
      setFit(Math.max(0.2, Math.min((window.innerWidth - 12) / W, (window.innerHeight - top - 10) / H)));
    };
    size(); const t = setTimeout(size, 400);
    window.addEventListener("resize", size);
    return () => { clearTimeout(t); window.removeEventListener("resize", size); };
  }, []);
  // الورقة نفسها: تنرسم مرة وحدة بعد ما الخط والصورة تحمل
  useEffect(() => {
    let off = false;
    (async () => {
      try { await Promise.all([document.fonts.load(`700 40px QAppAr`, "اب"), document.fonts.load(`700 40px QAppEn`, "Ab1")]); await document.fonts.ready; } catch { /* بدون خطوط */ }
      const img = imgUrl ? await loadImage(imgUrl) : null;
      if (off || !bg.current) return;
      const c = bg.current; c.width = W * SCALE; c.height = H * SCALE;
      const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawPaper(ctx, info, q.n, img);
      setReady(true);
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgUrl, q.n]);
  const redraw = useCallback(() => {
    const c = ink.current; if (!c) return;
    if (c.width !== W * SCALE) { c.width = W * SCALE; c.height = H * SCALE; }
    const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); ctx.clearRect(0, 0, W, H);
    drawStrokes(ctx, live.current ? [...strokes, live.current] : strokes);
  }, [strokes]);
  useEffect(() => { redraw(); keepDraft(item, q.n, strokes); }, [strokes, redraw, item, q.n]);

  const pt = (e: React.PointerEvent) => { const r = ink.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width * W).toFixed(1), +((e.clientY - r.top) / r.height * H).toFixed(1)] as const; };
  /** إذا انكتب بقلم الآيباد مرة، لمس الكف ما يرسم */
  const skip = (e: React.PointerEvent) => { if (e.pointerType === "pen") penSeen.current = true; return e.pointerType === "touch" && penSeen.current; };
  function erase(x: number, y: number) {
    const r = 22;
    const near = (s: Stroke) => {
      for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < r) return true;
      // خط المسطرة: نقطتين بس، فالممحاة تمسحه إذا قربت من أي مكان عليه
      if (s.p.length === 4) {
        const [ax, ay, bx2, by] = s.p, dx = bx2 - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        if (Math.hypot(ax + k * dx - x, ay + k * dy - y) < r) return true;
      }
      return false;
    };
    const keep = strokes.filter((s) => !near(s));
    if (keep.length !== strokes.length) setStrokes(keep);
  }
  function down(e: React.PointerEvent) {
    if (skip(e)) return;
    e.preventDefault(); ink.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    live.current = { c: color, w: width, p: tool === "ruler" ? [x, y, x, y] : [x, y] }; redraw();
  }
  function move(e: React.PointerEvent) {
    if (skip(e) || !(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    if (!live.current) return;
    // المسطرة: من نقطة البداية لمكان القلم هسه، خط مستقيم
    if (tool === "ruler") { live.current.p[2] = x; live.current.p[3] = y; } else live.current.p.push(x, y);
    redraw();
  }
  function up() {
    if (!live.current) return;
    const s = live.current; live.current = null;
    // دسة بالمسطرة بدون سحب: نقطة
    if (s.p.length === 4 && Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) < 3) s.p = s.p.slice(0, 2);
    setStrokes((old) => [...old, s]);
  }
  async function save() {
    haptic();
    const out = document.createElement("canvas"); out.width = W * SCALE; out.height = H * SCALE;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(bg.current!, 0, 0); ctx.drawImage(ink.current!, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, "image/jpeg", 0.9));
    if (!blob) return;
    await onSave(new File([blob], `pen_q${q.n}.jpg`, { type: "image/jpeg" }));
  }
  const pick = (t: Tool) => { if (t !== "eraser" && tool === t) setPenBox(!penBox); else setPenBox(false); setTool(t); };
  return (
    <div className="pen-wrap">
      <div className="pen-bar" ref={bar}>
        {timer}
        <button type="button" className={"gk-ic" + (tool === "pen" ? " on" : "")} title="القلم" onClick={() => pick("pen")}><span style={{ color }}>🖊️</span></button>
        <button type="button" className={"gk-ic" + (tool === "ruler" ? " on" : "")} title="المسطرة: خط مستقيم" onClick={() => pick("ruler")}>📏</button>
        <button type="button" className={"gk-ic" + (tool === "eraser" ? " on" : "")} title="الممحاة" onClick={() => pick("eraser")}>🧽</button>
        <button type="button" className="gk-ic" title="رجوع" disabled={!strokes.length} onClick={() => setStrokes(strokes.slice(0, -1))}>↶</button>
        {sure
          ? <button type="button" className="gk-clear on" onClick={() => { setStrokes([]); setSure(false); }}>⚠️ متأكد؟</button>
          : <button type="button" className="gk-clear" disabled={!strokes.length} onClick={() => setSure(true)}>🗑 امسح</button>}
        <button type="button" className="btn pen-save" disabled={busy || !ready || !strokes.length} onClick={() => void save()}>{busy ? "جاري الحفظ..." : "💾 احفظ"}</button>
        <button type="button" className="exbtn pen-back" disabled={busy} onClick={onClose}>↩️ الأسئلة</button>
        {penBox && (
          <div className="gk-penbox">
            <div className="gk-lbl">{tool === "ruler" ? "خيارات المسطرة" : "خيارات القلم"}</div>
            <div className="gk-colors">{COLORS.filter((c) => c !== "#ffffff").map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
            <label className="gk-custom">🎨 لون ثاني <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <div className="gk-tools">{WIDTHS.map((w) => <button type="button" key={w} className={"gk-w" + (width === w ? " on" : "")} onClick={() => setWidth(w)}><span style={{ height: w }} /></button>)}</div>
            <button type="button" className="gk-btn" onClick={() => setPenBox(false)}>تم</button>
          </div>
        )}
      </div>
      <div className="pen-sheet" style={{ width: W * fit, height: H * fit }}>
        {!ready && <div className="gk-empty">جاري تجهيز الورقة...</div>}
        <canvas ref={bg} style={{ width: W * fit, height: H * fit }} />
        <canvas ref={ink} style={{ width: W * fit, height: H * fit, touchAction: "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; redraw(); }} />
      </div>
    </div>
  );
}
