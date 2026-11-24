// 📝 رسم السبورة على الـ canvas: الإطار والخشب، الخلفية، الكتابة والتظليل والنص
import { FRAME, H, frameOf, insetOf, woodPixels, wrapWidth, type Item, type TextItem } from "../../../lib/board/engine.ts";

export const FONT = `"Segoe UI", Tahoma, "Noto Naskh Arabic", Arial, sans-serif`;

// ---------- الخشب: يتسوى مرة وحدة لكل إطار ويتكرر
const woodCache = new Map<string, { h: HTMLCanvasElement; v: HTMLCanvasElement }>();
export function woodTiles(id: string) {
  const f = frameOf(id);
  if (!f.wood) return null;
  const hit = woodCache.get(id);
  if (hit) return hit;
  const W = 1024, T = 96;
  const seed = [...id].reduce((t, c) => t + c.charCodeAt(0), 0) % 97 + 3;
  const h = document.createElement("canvas"); h.width = W; h.height = T;
  const ctx = h.getContext("2d")!;
  const img = ctx.createImageData(W, T);
  img.data.set(woodPixels(W, T, f.wood[0], f.wood[1], seed, f.wood[2]));
  ctx.putImageData(img, 0, 0);
  // الجوانب: نفس الخشب مدور 90°
  const v = document.createElement("canvas"); v.width = T; v.height = W;
  const vc = v.getContext("2d")!;
  vc.translate(T, 0); vc.rotate(Math.PI / 2); vc.drawImage(h, 0, 0);
  const out = { h, v };
  woodCache.set(id, out);
  return out;
}
/** شريط صغير للمعاينة بقائمة الإطارات */
export function framePreview(id: string): string {
  const f = frameOf(id);
  const c = document.createElement("canvas"); c.width = 240; c.height = 28;
  const x = c.getContext("2d")!;
  if (f.wood) x.drawImage(woodTiles(id)!.h, 0, 0, 1024, 96, 0, 0, 240, 28);
  else if (f.grad) { const g = x.createLinearGradient(0, 0, 0, 28); f.grad.forEach((s, i) => g.addColorStop(i / (f.grad!.length - 1), s)); x.fillStyle = g; x.fillRect(0, 0, 240, 28); }
  else { x.strokeStyle = "#8a93a6"; x.setLineDash([6, 5]); x.strokeRect(2, 2, 236, 24); }
  return c.toDataURL();
}

/** الإطار ولون السبورة. ctx محوّل لوحدات السبورة (W × 1080) */
export function paintFrame(ctx: CanvasRenderingContext2D, W: number, board: string, frameId: string, logo: HTMLImageElement | null) {
  const f = frameOf(frameId), F = insetOf(frameId);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = board;
  ctx.fillRect(F, F, W - 2 * F, H - 2 * F);
  if (!F) return;
  type Bar = { x: number; y: number; w: number; h: number; side: "t" | "b" | "l" | "r" };
  const bars: Bar[] = [{ x: 0, y: 0, w: F, h: H, side: "l" }, { x: W - F, y: 0, w: F, h: H, side: "r" }, { x: 0, y: 0, w: W, h: F, side: "t" }, { x: 0, y: H - F, w: W, h: F, side: "b" }];
  const wood = f.wood ? woodTiles(frameId) : null;
  for (const b of bars) {
    ctx.save();
    ctx.beginPath();
    // زوايا مشطوفة مثل إطار الصورة
    if (b.side === "t") { ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W - F, F); ctx.lineTo(F, F); }
    else if (b.side === "b") { ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(W - F, H - F); ctx.lineTo(F, H - F); }
    else if (b.side === "l") { ctx.moveTo(0, 0); ctx.lineTo(F, F); ctx.lineTo(F, H - F); ctx.lineTo(0, H); }
    else { ctx.moveTo(W, 0); ctx.lineTo(W - F, F); ctx.lineTo(W - F, H - F); ctx.lineTo(W, H); }
    ctx.closePath();
    ctx.clip();
    if (wood) {
      const vert = b.side === "l" || b.side === "r";
      const tile = vert ? wood.v : wood.h;
      const pat = ctx.createPattern(tile, "repeat")!;
      const k = F / 96;
      pat.setTransform(new DOMMatrix().translate(b.x, b.y).scale(k, k));
      ctx.fillStyle = pat;
    } else if (f.grad) {
      const g = b.side === "t" ? ctx.createLinearGradient(0, 0, 0, F) : b.side === "b" ? ctx.createLinearGradient(0, H, 0, H - F) : b.side === "l" ? ctx.createLinearGradient(0, 0, F, 0) : ctx.createLinearGradient(W, 0, W - F, 0);
      f.grad.forEach((s, i) => g.addColorStop(i / (f.grad!.length - 1), s));
      ctx.fillStyle = g;
    }
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // الحافة: فاتحة من برا، غامقة صوب السبورة
    const m = b.side === "t" ? ctx.createLinearGradient(0, 0, 0, F) : b.side === "b" ? ctx.createLinearGradient(0, H, 0, H - F) : b.side === "l" ? ctx.createLinearGradient(0, 0, F, 0) : ctx.createLinearGradient(W, 0, W - F, 0);
    m.addColorStop(0, "rgba(255,255,255,0.33)"); m.addColorStop(0.45, "rgba(255,255,255,0)"); m.addColorStop(0.7, "rgba(0,0,0,0)"); m.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = m;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  // خط برا غامق، وظل خفيف جوة
  ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.strokeStyle = "rgba(0,0,0,0.44)"; ctx.lineWidth = 3; ctx.strokeRect(F + 1.5, F + 1.5, W - 2 * F - 3, H - 2 * F - 3);
  // اللوحة باسمه: اللوگو والاسم بنص الشريط الفوقاني
  ctx.save();
  ctx.font = `600 21px ${FONT}`;
  ctx.direction = "rtl";
  const name = "قصي العميري";
  const tw = ctx.measureText(name).width, gap = 8, lw = logo ? 28 : 0;
  const total = tw + (lw ? lw + gap : 0);
  const cx = W / 2, x0 = cx - total / 2;
  if (logo) ctx.drawImage(logo, x0 + tw + gap, (F - 28) / 2, 28, 28);
  ctx.fillStyle = f.light ? "#3B2508" : "#F6C94A";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(name, x0, F / 2 + 1);
  ctx.restore();
}

/** النص: يلف على عرض wrapWidth، ويبدي من فوق يمين */
export function textLines(ctx: CanvasRenderingContext2D, t: string, size: number, right: number): { lines: string[]; w: number; h: number } {
  ctx.font = `${size}px ${FONT}`;
  const max = wrapWidth(right);
  const lines: string[] = [];
  for (const para of t.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = word; } else cur = next;
    }
    lines.push(cur);
  }
  const w = Math.min(max, Math.max(1, ...lines.map((l) => ctx.measureText(l).width)));
  return { lines, w, h: Math.round(lines.length * size * 1.35) };
}
function drawText(ctx: CanvasRenderingContext2D, it: TextItem) {
  const { lines } = textLines(ctx, it.t, it.s, it.x);
  ctx.save();
  ctx.fillStyle = it.c;
  ctx.font = `${it.s}px ${FONT}`;
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, it.x, it.y + i * it.s * 1.35));
  ctx.restore();
}

/** خط واحد: منحني ناعم (نص النقاط)، أو مستقيم للأشكال */
export function strokePath(ctx: CanvasRenderingContext2D, p: number[], smooth: boolean) {
  ctx.beginPath();
  if (p.length === 2) { ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 0.01, p[1] + 0.01); return; }
  ctx.moveTo(p[0], p[1]);
  if (!smooth || p.length < 6) { for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); return; }
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
}
export function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
  if (it.k === "text") { drawText(ctx, it); return; }
  ctx.save();
  ctx.strokeStyle = it.c;
  ctx.lineWidth = it.w;
  if (it.k === "hl") { ctx.globalAlpha = 0.45; ctx.lineCap = "square"; ctx.lineJoin = "miter"; }
  else { ctx.lineCap = "round"; ctx.lineJoin = "round"; }
  strokePath(ctx, it.p, it.fit !== 0);
  ctx.stroke();
  ctx.restore();
}
/** كل الصفحة: الخلفية، التظليل تحت، الكتابة، والنص */
export function drawPage(ctx: CanvasRenderingContext2D, W: number, frameId: string, items: Item[], bg: HTMLImageElement | null) {
  const F = insetOf(frameId);
  ctx.save();
  ctx.beginPath(); ctx.rect(F, F, W - 2 * F, H - 2 * F); ctx.clip();
  if (bg && bg.naturalWidth) {
    const aw = W - 2 * F, ah = H - 2 * F, s = Math.min(aw / bg.naturalWidth, ah / bg.naturalHeight);
    const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
    ctx.drawImage(bg, F + (aw - w) / 2, F + (ah - h) / 2, w, h);
  }
  for (const it of items) if (it.k === "hl") drawItem(ctx, it);
  for (const it of items) if (it.k !== "hl") drawItem(ctx, it);
  ctx.restore();
}
export { FRAME };
