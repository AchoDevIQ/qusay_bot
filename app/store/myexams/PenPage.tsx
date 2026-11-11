"use client";
// ✏️ اكتب بالقلم: ورقة وحدة لكل سؤال، فوكها هدر الفصل باسم الطالب الرباعي ورقمه، وبعده السؤال، وتحته سطور يكتب عليها بقلم الآيباد.
// ألوان القلم وسماكته نفس المصحح. الكتابة تنحفظ بالجهاز أول بأول، وتندز كصورة جواب مثل الكاميرا بالضبط.
import { useCallback, useEffect, useRef, useState } from "react";
import { drawHeader, loadImage, themeOf, W, type HeaderInfo } from "../grade/compose";
import { COLORS, WIDTHS } from "../grade/pens";
import { haptic } from "../shared";

export type PenHead = { slug: string; chapter: string; title: string; info: string; name: string; lang: string };
type Stroke = { c: string; w: number; p: number[] };
export const H = 1527;          // نسبة ورقة A4
const SCALE = 1.5;              // الورقة تنرسم أوضح من حجم الشاشة، حتى الصورة تطلع حادة
const HEAD = 210;
const FONT = "QAppEn, QAppAr, Cairo, Tahoma, Arial, sans-serif";
const PX: Record<number, number> = { 2: 4, 5: 9 };   // سماكة القلم بالورقة
const draftKey = (item: number, q: number) => `penDraft:${item}:${q}`;
const readDraft = (item: number, q: number): Stroke[] => { try { const j = JSON.parse(localStorage.getItem(draftKey(item, q)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };
const keepDraft = (item: number, q: number, s: Stroke[]) => { try { localStorage.setItem(draftKey(item, q), JSON.stringify(s)); } catch { /* بدون حفظ */ } };
export const hasPenDraft = (item: number, q: number) => readDraft(item, q).length > 0;

/**
 * الورقة بدون الكتابة: الإطار، الهدر، السؤال، السطور.
 * السؤال صورة من السيرفر: مكتوب من الوورد بنفس شكل الورقة (العربي والمعادلات بترتيبهم الصحيح)، أو صورته من الامتحان إذا بعد ما انرفع وورده
 */
function drawPaper(ctx: CanvasRenderingContext2D, head: HeaderInfo, n: number, max: number, img: HTMLImageElement | null, logo: HTMLImageElement | null) {
  const t = themeOf(head.slug), en = head.lang === "en";
  ctx.fillStyle = "#fffdf7"; ctx.fillRect(0, 0, W, H);
  drawHeader(ctx, HEAD, head, logo, false, { top: String(n), sub: en ? "Question" : "السؤال" });
  // السؤال: مربع فاتح وبطرفه خط بلون الفصل
  const bx = 44, bw = W - 88;
  let y = HEAD + 34, bh = 0;
  ctx.direction = en ? "ltr" : "rtl";
  if (img) {
    // درجة السؤال فوك، والسؤال تحته
    const iw = bw - 60, ih = Math.min(470, (iw * img.naturalHeight) / img.naturalWidth), dw = (ih * img.naturalWidth) / img.naturalHeight;
    bh = ih + 80;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(bx, y, bw, bh);
    ctx.drawImage(img, bx + (bw - dw) / 2, y + 66, dw, ih);
  }
  if (bh) {
    ctx.fillStyle = t.accent; ctx.fillRect(en ? bx : bx + bw - 10, y, 10, bh);
    // درجة السؤال
    if (max) {
      const label = en ? `${max} marks` : `${max} درجة`;
      ctx.font = `700 26px ${FONT}`; const lw = ctx.measureText(label).width + 30;
      const lx = en ? bx + bw - lw - 14 : bx + 14;
      ctx.fillStyle = "#e3ebf8"; ctx.beginPath(); ctx.roundRect(lx, y + 12, lw, 42, 21); ctx.fill();
      ctx.fillStyle = t.to; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, lx + lw / 2, y + 34);
    }
    y += bh;
  }
  // السطور
  const top = y + 70;
  ctx.font = `700 24px ${FONT}`; ctx.fillStyle = "#9aa6bd"; ctx.textBaseline = "alphabetic"; ctx.textAlign = en ? "left" : "right";
  ctx.fillText(en ? "✍️ Write your answer here" : "✍️ اكتب جوابك هنا", en ? bx : bx + bw, top - 18);
  ctx.fillStyle = "#d9e2f1";
  for (let ly = top + 62; ly < H - 90; ly += 64) ctx.fillRect(bx, ly, bw, 2);
  // تحت: اسم الأستاذ ورقم الطالب
  ctx.font = `700 22px ${FONT}`; ctx.fillStyle = "#8a95ab"; ctx.textAlign = "right"; ctx.direction = "rtl";
  ctx.fillText("QMath · قصي العميري", W - bx, H - 38);
  ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.fillText(`ID ${head.sid}`, bx, H - 38);
  // الإطار بلون الفصل
  ctx.lineWidth = 12; ctx.strokeStyle = t.from; ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.lineWidth = 6; ctx.strokeStyle = t.accent; ctx.strokeRect(16, 16, W - 32, H - 32);
}

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

export default function PenPage({ item, sid, model, head, q, imgUrl, busy, onSave, onClose }: {
  item: number; sid: number; model: string; head: PenHead; q: { n: number; max: number }; imgUrl: string | null; busy: boolean;
  onSave: (file: File) => Promise<boolean>; onClose: () => void;
}) {
  const bg = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(() => readDraft(item, q.n));
  const live = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#111111");
  const [width, setWidth] = useState(2);
  const [penBox, setPenBox] = useState(false);
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState(0.5);
  const [sure, setSure] = useState(false);
  const info: HeaderInfo = { slug: head.slug, chapter: head.chapter, title: head.title, info: head.info, model, name: head.name, total: 0, lang: head.lang === "en" ? "en" : "ar", sid };

  // الورقة تدخل كلها بالشاشة، بدون تحريك
  useEffect(() => {
    const size = () => setFit(Math.min((window.innerWidth - 20) / W, (window.innerHeight - 150) / H));
    size(); window.addEventListener("resize", size); return () => window.removeEventListener("resize", size);
  }, []);
  // الورقة نفسها: تنرسم مرة وحدة بعد ما الخط والصور تحمل
  useEffect(() => {
    let off = false;
    (async () => {
      try { await Promise.all([document.fonts.load(`700 40px QAppAr`, "اب"), document.fonts.load(`700 40px QAppEn`, "Ab1")]); await document.fonts.ready; } catch { /* بدون خطوط */ }
      const [img, logo] = await Promise.all([imgUrl ? loadImage(imgUrl) : Promise.resolve(null), loadImage("/logo.png")]);
      if (off || !bg.current) return;
      const c = bg.current; c.width = W * SCALE; c.height = H * SCALE;
      const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawPaper(ctx, info, q.n, q.max, img, logo);
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
    const keep = strokes.filter((s) => { for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < r) return false; return true; });
    if (keep.length !== strokes.length) setStrokes(keep);
  }
  function down(e: React.PointerEvent) {
    if (skip(e)) return;
    e.preventDefault(); ink.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    live.current = { c: color, w: width, p: [x, y] }; redraw();
  }
  function move(e: React.PointerEvent) {
    if (skip(e) || !(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    if (live.current) { live.current.p.push(x, y); redraw(); }
  }
  function up() {
    if (live.current) { const s = live.current; live.current = null; setStrokes((old) => [...old, s]); }
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
  return (
    <div className="pen-wrap">
      <div className="pen-bar">
        <button type="button" className={"gk-ic" + (tool === "pen" ? " on" : "")} title="القلم" onClick={() => { if (tool === "pen") setPenBox(!penBox); setTool("pen"); }}><span style={{ color }}>🖊️</span></button>
        <button type="button" className={"gk-ic" + (tool === "eraser" ? " on" : "")} title="الممحاة" onClick={() => { setTool("eraser"); setPenBox(false); }}>🧽</button>
        <button type="button" className="gk-ic" title="رجوع" disabled={!strokes.length} onClick={() => setStrokes(strokes.slice(0, -1))}>↶</button>
        {sure
          ? <button type="button" className="gk-clear on" onClick={() => { setStrokes([]); setSure(false); }}>⚠️ متأكد؟ دوس مرة ثانية</button>
          : <button type="button" className="gk-clear" disabled={!strokes.length} onClick={() => setSure(true)}>🗑 امسح الكل</button>}
        {penBox && (
          <div className="gk-penbox">
            <div className="gk-lbl">خيارات القلم</div>
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
      <div className="pen-foot">
        <button type="button" className="btn" disabled={busy || !ready || !strokes.length} onClick={() => void save()}>{busy ? "جاري الإرسال..." : "💾 احفظ الجواب"}</button>
        <button type="button" className="exbtn" disabled={busy} onClick={onClose}>↩️ رجوع للأسئلة</button>
      </div>
      <div className="pen-hint">ورقة وحدة لهذا السؤال. كتابتك تبقى محفوظة بالجهاز لحد ما تدوس «احفظ الجواب».</div>
    </div>
  );
}
