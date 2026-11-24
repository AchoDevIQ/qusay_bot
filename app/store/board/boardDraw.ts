// 📝 رسم السبورة على الـ canvas: الإطار والخشب، الخلفية، الكتابة والتظليل والنص
import { FRAME, HEAD_H, H, frameOf, headOf, insetOf, isLight, woodPixels, wrapWidth, type Item, type TextItem } from "../../../lib/board/engine.ts";

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
export function paintFrame(ctx: CanvasRenderingContext2D, W: number, board: string, frameId: string, logo: HTMLImageElement | null, head = "none") {
  const f = frameOf(frameId), F = insetOf(frameId);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = board;
  ctx.fillRect(F, F, W - 2 * F, H - 2 * F);
  const hd = headOf(head);
  if (hd !== "none") drawHeader(ctx, W, F, hd, logo, board);
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
  // اللوحة باسمه: اللوگو والاسم بنص الشريط الفوقاني (إذا ماكو هيدر، لأن الهيدر بيه اسمه)
  if (hd !== "none") return;
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
export type ImgOf = (ref: string) => HTMLImageElement | null;
export function drawItem(ctx: CanvasRenderingContext2D, it: Item, imgOf?: ImgOf) {
  if (it.k === "text") { drawText(ctx, it); return; }
  if (it.k === "img") {
    const im = imgOf?.(it.r);
    if (im?.naturalWidth) ctx.drawImage(im, it.x, it.y, it.w, it.h);
    else { ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.setLineDash([10, 8]); ctx.strokeRect(it.x, it.y, it.w, it.h); ctx.restore(); }
    return;
  }
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
export function drawPage(ctx: CanvasRenderingContext2D, W: number, frameId: string, items: Item[], bg: HTMLImageElement | null, imgOf?: ImgOf) {
  const F = insetOf(frameId);
  ctx.save();
  ctx.beginPath(); ctx.rect(F, F, W - 2 * F, H - 2 * F); ctx.clip();
  if (bg && bg.naturalWidth) {
    const aw = W - 2 * F, ah = H - 2 * F, s = Math.min(aw / bg.naturalWidth, ah / bg.naturalHeight);
    const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
    ctx.drawImage(bg, F + (aw - w) / 2, F + (ah - h) / 2, w, h);
  }
  for (const it of items) if (it.k === "img") drawItem(ctx, it, imgOf);
  for (const it of items) if (it.k === "hl") drawItem(ctx, it);
  for (const it of items) if (it.k !== "hl" && it.k !== "img") drawItem(ctx, it);
  ctx.restore();
}
export { FRAME };

// ---------- 🏷 الهيدرات: اسمه واللوگو فوك السبورة، 10 أشكال (طلبه 2026-11-25)
const GOLD = ["#F6C94A", "#D9A62E", "#F3D27A"];
function goldGrad(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, GOLD[0]); g.addColorStop(0.5, GOLD[1]); g.addColorStop(1, GOLD[2]);
  return g;
}
/** الاسم واللوگو: من اليمين (بداية السطر العربي) أو بالنص */
function nameLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, x: number, cy: number, size: number, color: string | CanvasGradient, align: "right" | "center", chalk = false, disc = "") {
  const name = "قصي العميري";
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.direction = "rtl"; ctx.textBaseline = "middle";
  const tw = ctx.measureText(name).width, lw = logo ? size * 1.45 : 0, gap = logo ? size * 0.35 : 0;
  const total = tw + lw + gap;
  const right = align === "right" ? x : x + total / 2;
  // لوگو ذهبي على خلفية ذهبية ما يبين: دائرة كحلية وراه
  if (logo && disc) { ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(right - lw / 2, cy, lw / 2 + 3, 0, Math.PI * 2); ctx.fill(); }
  if (logo) ctx.drawImage(logo, right - lw, cy - lw / 2, lw, lw);
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  if (chalk) {
    ctx.globalAlpha = 0.35;
    for (const [dx, dy] of [[1.2, 0.6], [-0.8, 1], [0.5, -1.1]]) ctx.fillText(name, right - lw - gap + dx, cy + dy);
    ctx.globalAlpha = 0.92;
  }
  ctx.fillText(name, right - lw - gap, cy + 1);
  ctx.restore();
  return total;
}
export function drawHeader(ctx: CanvasRenderingContext2D, W: number, F: number, id: string, logo: HTMLImageElement | null, board: string) {
  const x0 = F, x1 = W - F, y = F, h = HEAD_H, cy = y + h / 2, w = x1 - x0;
  const light = isLight(board);
  const ink = light ? "#1F2A44" : "#F6C94A";
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, w, h + 30); ctx.clip();
  switch (id) {
    case "navy": {
      ctx.fillStyle = "#141F33"; ctx.fillRect(x0, y, w, h);
      ctx.fillStyle = goldGrad(ctx, x0, x1); ctx.fillRect(x0, y + h - 5, w, 5);
      nameLogo(ctx, logo, x1 - 26, cy - 2, 34, goldGrad(ctx, x1 - 400, x1), "right");
      break;
    }
    case "gold": {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "#F7D774"); g.addColorStop(0.45, "#E2B547"); g.addColorStop(1, "#B8862B");
      ctx.fillStyle = g; ctx.fillRect(x0, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x0, y, w, 3);
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(x0, y + h - 3, w, 3);
      nameLogo(ctx, logo, x1 - 26, cy, 34, "#3B2508", "right", false, "#141F33");
      break;
    }
    case "line": {
      nameLogo(ctx, logo, x1 - 26, cy - 4, 32, ink, "right");
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, "rgba(246,201,74,0)"); g.addColorStop(0.25, "rgba(246,201,74,.9)"); g.addColorStop(1, "rgba(246,201,74,1)");
      ctx.fillStyle = g; ctx.fillRect(x0 + 20, y + h - 6, w - 40, 3);
      break;
    }
    case "ribbon": {
      const rw = Math.min(620, w - 80), rx = (x0 + x1) / 2 - rw / 2, ry = y + 6, rh = h - 22;
      ctx.fillStyle = "#8a6417";
      for (const s of [-1, 1]) {
        const ex = s < 0 ? rx - 46 : rx + rw + 46, ix = s < 0 ? rx + 10 : rx + rw - 10;
        ctx.beginPath(); ctx.moveTo(ix, ry + 12); ctx.lineTo(ex, ry + 12); ctx.lineTo(ex - s * 22, ry + 12 + rh / 2); ctx.lineTo(ex, ry + 12 + rh); ctx.lineTo(ix, ry + 12 + rh); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "#141F33"; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = goldGrad(ctx, rx, rx + rw); ctx.lineWidth = 3; ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);
      nameLogo(ctx, logo, (x0 + x1) / 2, ry + rh / 2, 30, goldGrad(ctx, rx, rx + rw), "center");
      break;
    }
    case "badge": {
      ctx.font = `700 30px ${FONT}`;
      const bw = ctx.measureText("قصي العميري").width + 30 * 1.45 + 30 * 0.35 + 60, bx = (x0 + x1) / 2 - bw / 2, by = y + 10, bh = h - 22;
      ctx.fillStyle = light ? "#141F33" : "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fill();
      ctx.strokeStyle = goldGrad(ctx, bx, bx + bw); ctx.lineWidth = 3; ctx.stroke();
      nameLogo(ctx, logo, (x0 + x1) / 2, by + bh / 2, 30, "#F6C94A", "center");
      break;
    }
    case "corner": {
      const cw = 470;
      ctx.fillStyle = "#141F33";
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - cw, y); ctx.lineTo(x1 - cw + 50, y + h); ctx.lineTo(x1, y + h); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = goldGrad(ctx, x1 - cw, x1); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1 - cw, y); ctx.lineTo(x1 - cw + 50, y + h); ctx.lineTo(x1, y + h); ctx.stroke();
      nameLogo(ctx, logo, x1 - 24, cy, 32, goldGrad(ctx, x1 - cw, x1), "right");
      break;
    }
    case "math": {
      ctx.fillStyle = light ? "rgba(20,31,51,.08)" : "rgba(0,0,0,.25)"; ctx.fillRect(x0, y, w, h);
      ctx.font = `28px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const sym = ["π", "√", "∑", "∫", "∞", "θ", "Δ", "÷", "±", "≤", "x²", "ƒ", "e", "∩"];
      ctx.fillStyle = light ? "rgba(20,31,51,.18)" : "rgba(246,201,74,.22)";
      for (let i = 0, x = x0 + 30; x < x1 - 420; i++, x += 62) ctx.fillText(sym[i % sym.length], x, cy + (i % 2 ? 12 : -12));
      ctx.fillStyle = goldGrad(ctx, x0, x1); ctx.fillRect(x0, y + h - 3, w, 3);
      nameLogo(ctx, logo, x1 - 26, cy, 32, ink, "right");
      break;
    }
    case "double": {
      ctx.fillStyle = goldGrad(ctx, x0, x1);
      ctx.fillRect(x0 + 30, y + 8, w - 60, 2.5); ctx.fillRect(x0 + 30, y + 14, w - 60, 1.2);
      ctx.fillRect(x0 + 30, y + h - 12, w - 60, 1.2); ctx.fillRect(x0 + 30, y + h - 7, w - 60, 2.5);
      nameLogo(ctx, logo, (x0 + x1) / 2, cy, 30, ink, "center");
      break;
    }
    case "chalk": {
      const c = light ? "#2b2b2b" : "#F4F1E8";
      nameLogo(ctx, logo, x1 - 30, cy - 4, 36, c, "right", true);
      ctx.strokeStyle = c; ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1 - 30, y + h - 8);
      for (let x = x1 - 30; x > x1 - 460; x -= 20) ctx.lineTo(x, y + h - 8 + Math.sin(x * 0.07) * 2);
      ctx.stroke();
      break;
    }
    case "modern": {
      const g = ctx.createLinearGradient(x0, y, x1, y + h);
      g.addColorStop(0, "#0F2A47"); g.addColorStop(1, "#1D4E5F");
      ctx.fillStyle = g; ctx.fillRect(x0, y, w, h);
      ctx.fillStyle = goldGrad(ctx, x0, x0 + 200);
      ctx.beginPath(); ctx.moveTo(x0 + 120, y); ctx.lineTo(x0 + 150, y); ctx.lineTo(x0 + 110, y + h); ctx.lineTo(x0 + 80, y + h); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x0 + 170, y); ctx.lineTo(x0 + 180, y); ctx.lineTo(x0 + 140, y + h); ctx.lineTo(x0 + 130, y + h); ctx.fill();
      nameLogo(ctx, logo, x1 - 26, cy, 34, "#FFFFFF", "right");
      break;
    }
  }
  ctx.restore();
}
/** معاينة الهيدر بالقائمة */
export function headPreview(id: string, logo: HTMLImageElement | null, board: string): string {
  const c = document.createElement("canvas"); c.width = 520; c.height = 46;
  const x = c.getContext("2d")!;
  const k = 520 / 1100;
  x.scale(k, k);
  x.fillStyle = board; x.fillRect(0, 0, 1100, 100);
  if (id !== "none") drawHeader(x, 1100, 0, id, logo, board);
  return c.toDataURL();
}
