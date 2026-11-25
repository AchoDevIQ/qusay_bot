// 📝 رسم السبورة على الـ canvas: الإطار والخشب، الخلفية، الكتابة والتظليل والنص
import { FRAME, HEAD_H, H, NOTEBOOK, SLOGAN, frameOf, headOf, insetOf, isLight, woodPixels, wrapWidth, type Item, type TextItem, topOf, areaOf } from "../../../lib/board/engine.ts";

// خط التطبيق نفسه (نفس الخط اللي يختاره من «✍️ الخط»)، مو الخط الرسمي
export const FONT = `QAppEn, QAppAr, Cairo, Tahoma, Arial, sans-serif`;

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
  else if (f.deco) { const F0 = insetOf(id), k = 28 / FRAME; x.fillStyle = "#1F4E3D"; x.fillRect(0, 0, 240, 28); x.scale(k, k); x.translate(0, -(H - FRAME)); paintDeco(x, 240 / k, F0, f.deco, "#1F4E3D"); }
  else if (f.grad) { const g = x.createLinearGradient(0, 0, 0, 28); f.grad.forEach((s, i) => g.addColorStop(i / (f.grad!.length - 1), s)); x.fillStyle = g; x.fillRect(0, 0, 240, 28); }
  else { x.strokeStyle = "#8a93a6"; x.setLineDash([6, 5]); x.strokeRect(2, 2, 236, 24); }
  return c.toDataURL();
}

/** الإطار ولون السبورة. ctx محوّل لوحدات السبورة (W × 1080) */
export function paintFrame(ctx: CanvasRenderingContext2D, W: number, board: string, frameId: string, logo: HTMLImageElement | null, head = "none") {
  const f = frameOf(frameId), F = insetOf(frameId), T = topOf(frameId);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = board;
  ctx.fillRect(F, T, W - 2 * F, H - F - T);
  const hd = headOf(head);
  // النحيف: الإطار أول، وبعده الهيدر على العرض كله فوكه، فالهيدر والإطار قطعة وحدة
  if (f.slim && f.deco) { paintDeco(ctx, W, F, f.deco, board, headBg(hd)); if (hd !== "none") drawHeader(ctx, W, 0, hd, logo, board, 0); return; }
  if (hd !== "none") drawHeader(ctx, W, F, hd, logo, board, T);
  if (!F) return;
  type Bar = { x: number; y: number; w: number; h: number; side: "t" | "b" | "l" | "r" };
  const bars: Bar[] = [{ x: 0, y: 0, w: F, h: H, side: "l" }, { x: W - F, y: 0, w: F, h: H, side: "r" }, { x: 0, y: 0, w: W, h: F, side: "t" }, { x: 0, y: H - F, w: W, h: F, side: "b" }];
  // المزخرف: ثلاث جهات، والفوك للهيدر مالته
  if (f.deco) { paintDeco(ctx, W, F, f.deco, board); return; }
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
  plate(ctx, W, F, logo, f.light, hd);
}
/** اللوحة باسمه: اللوگو والاسم بنص الشريط الفوقاني (إذا ماكو هيدر، لأن الهيدر بيه اسمه) */
function plate(ctx: CanvasRenderingContext2D, W: number, F: number, logo: HTMLImageElement | null, light: boolean, hd: string) {
  if (hd !== "none" || !F) return;
  ctx.save();
  ctx.font = `700 22px ${FONT}`;
  ctx.direction = "rtl";
  const name = "قصي العميري";
  const tw = ctx.measureText(name).width, gap = 8, lw = logo ? 30 : 0;
  const total = tw + (lw ? lw + gap : 0);
  const x0 = W / 2 - total / 2;
  if (logo) ctx.drawImage(logo, x0 + tw + gap, (F - 30) / 2, 30, 30);
  ctx.fillStyle = light ? "#3B2508" : "#F6C94A";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(name, x0, F / 2 + 1);
  ctx.restore();
}
/** الإطارات المزخرفة: ثلاث جهات (يمين ويسار وجوه) بلا خشب. الفوك مفتوح للهيدر */
/** لون الإطار النحيف «بلون الهيدر»: لون شريط الهيدر نفسه */
function headBg(hd: string) {
  const nb = NOTEBOOK.find((n) => n.id === hd);
  return nb ? nb.bg : hd === "gold" ? "gold" : hd === "modern" ? "modern" : "#141F33";
}
function paintDeco(ctx: CanvasRenderingContext2D, W: number, F: number, d: { bar: string; style: string; line?: string }, board: string, head = "#141F33") {
  if (d.bar === "head") d = { ...d, bar: head };
  const metal = (x0: number, x1: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const st = d.line === "silver" ? ["#F1F3F5", "#AEB5BD", "#DDE1E5"] : d.line === "rose" ? ["#F6CDB4", "#B76E79", "#EDB9A4"] : ["#F6C94A", "#D9A62E", "#F3D27A"];
    st.forEach((c, i) => g.addColorStop(i / 2, c)); return g;
  };
  // الشريط
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(F, 0, W - 2 * F, H - F); ctx.clip("evenodd");
  if (d.bar === "gold") { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#F7D774"); g.addColorStop(0.35, "#C9962B"); g.addColorStop(0.65, "#F3CF6A"); g.addColorStop(1, "#9C6F17"); ctx.fillStyle = g; }
  else if (d.bar === "modern") { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0F2A47"); g.addColorStop(1, "#1D4E5F"); ctx.fillStyle = g; }
  else ctx.fillStyle = d.bar === "board" ? board : d.bar;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const barLight = d.bar === "gold" || (d.bar === "board" ? isLight(board) : d.bar.startsWith("#") && isLight(d.bar));
  const gold: string | CanvasGradient = barLight ? "#8A6420" : metal(0, W);
  const soft = barLight ? "rgba(138,100,32,.55)" : d.line === "silver" ? "rgba(221,225,229,.5)" : "rgba(246,201,74,.5)";
  // خط على شكل U: من فوك يسار، جوه، لفوك يمين
  const u = (inset: number, lw: number, style: string | CanvasGradient = gold) => {
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(inset, 0); ctx.lineTo(inset, H - inset); ctx.lineTo(W - inset, H - inset); ctx.lineTo(W - inset, 0); ctx.stroke();
  };
  // يمشي على شكل U (يسار نازل، جوه، يمين صاعد) كل step، ويعطي النقطة واتجاه «للداخل» (nx, ny) والمسافة من البداية
  const walk = (inset: number, step: number, f: (x: number, y: number, nx: number, ny: number, s: number) => void, start = 0) => {
    const segs: [number, number, number, number, number, number][] = [[inset, 0, inset, H - inset, 1, 0], [inset, H - inset, W - inset, H - inset, 0, -1], [W - inset, H - inset, W - inset, 0, -1, 0]];
    const lens = segs.map(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0)), total = lens.reduce((t, l) => t + l, 0);
    for (let d = start, i = 0, base = 0; d <= total; d += step) {
      while (i < 2 && d > base + lens[i]) base += lens[i++];
      const [x0, y0, x1, y1, nx, ny] = segs[i], k = (d - base) / lens[i];
      f(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, nx, ny, d);
    }
  };
  // نقاط على طول الأضلاع الثلاثة (بنص الشريط)
  const along = (step: number, f: (x: number, y: number, k: number) => void) => {
    const m = (F - 3) / 2; let k = 0;
    for (let y = 30; y < H - F; y += step) { f(m, y, k++); f(W - m, y, k++); }
    for (let x = F + 30; x < W - F - 10; x += step) f(x, H - m, k++);
  };
  ctx.save();
  switch (d.style) {
    // النحيف: خط ذهبي رفيع على حافة البطن (يلتقي بخط الهيدر الذهبي)
    case "slim": u(F - 1.2, 2.2); break;
    case "slim2": u(F - 1, 1.8); u(4, 1.2, soft); break;
    case "lines":
      u(5, 2, d.bar === "gold" ? "#5A3D0C" : gold);
      u(F - 3, 4, d.bar === "gold" ? "#141F33" : gold);
      break;
    case "line":
      u(F / 2, 3);
      break;
    case "double":
      u(F / 2 - 6, 3); u(F / 2 + 4, 1.5);
      break;
    case "corners": {
      const L = 150, t = F / 2;
      ctx.strokeStyle = gold; ctx.lineWidth = 5; ctx.lineCap = "round";
      for (const [x, sx] of [[t, 1], [W - t, -1]]) {
        const y = H - t;
        ctx.beginPath(); ctx.moveTo(x, y - L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + sx * 18, y - 18, 5, 0, Math.PI * 2); ctx.fillStyle = barLight ? "#8A6420" : "#F6C94A"; ctx.fill();
      }
      u(F / 2 + 8, 1.2, soft);
      break;
    }
    case "math": case "stars": {
      u(F - 3, 3);
      ctx.font = `22px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = soft;
      const sym = d.style === "math" ? ["π", "√", "∑", "∫", "∞", "θ", "Δ", "±", "÷", "x²", "≤", "e"] : ["★", "✦", "☆", "✧"];
      along(74, (x, y, k) => ctx.fillText(sym[k % sym.length], x, y));
      break;
    }
    case "dots":
      u(F - 3, 2); u(4, 1.5);
      ctx.fillStyle = barLight ? "#8A6420" : "#F6C94A";
      along(28, (x, y) => { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); });
      break;
    case "wave": {
      u(F - 3, 2);
      const m = (F - 3) / 2, a = 6, wv = (v: number) => Math.sin(v / 18) * a;
      ctx.strokeStyle = gold; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let y = 0; y <= H - m; y += 4) ctx.lineTo(m + wv(y), y);
      for (let x = m; x <= W - m; x += 4) ctx.lineTo(x, H - m + wv(x));
      for (let y = H - m; y >= 0; y -= 4) ctx.lineTo(W - m + wv(y), y);
      ctx.stroke();
      break;
    }
    // 🪢 حبل مبروم: خيطين يلفون على بعض على طول الأضلاع الثلاثة
    case "twist": {
      const m = F / 2, a = Math.max(3, F * 0.2);
      for (const [ph, st, lw] of [[0, soft, 4], [Math.PI, gold, 4.5]] as const) {
        ctx.strokeStyle = st; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.beginPath();
        walk(m, 3, (x, y, nx, ny, s) => { const o = Math.sin(s / 7 + ph) * a; if (s === 0) ctx.moveTo(x + nx * o, y + ny * o); else ctx.lineTo(x + nx * o, y + ny * o); });
        ctx.stroke();
      }
      // لمعة صغيرة على كل لفة
      ctx.fillStyle = "rgba(255,248,220,.75)";
      walk(m, 7 * Math.PI, (x, y) => { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }, 7 * Math.PI / 2);
      break;
    }
    case "rope2": {
      const m = F / 2 - 3;
      ctx.lineCap = "round";
      ctx.setLineDash([14, 10]); u(m - 2, 5);
      ctx.lineDashOffset = 12; u(m + 2, 5, soft);
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      u(F - 1.5, 2);
      break;
    }
    case "beads": {
      const m = F / 2, r = Math.max(3, F * 0.24);
      walk(m, r * 2.6, (x, y) => {
        ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case "chain": {
      const m = F / 2, L = Math.max(8, F * 0.45);
      let k = 0;
      ctx.lineWidth = 2.6;
      walk(m, L * 1.35, (x, y, nx, ny) => {
        const ang = Math.atan2(nx, -ny); // اتجاه المشي
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = k++ % 2 ? soft : gold;
        ctx.beginPath(); ctx.ellipse(0, 0, L * 0.85, k % 2 ? L * 0.45 : L * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });
      break;
    }
    case "rope": {
      const m = F / 2;
      ctx.lineCap = "round"; ctx.lineWidth = 5;
      ctx.setLineDash([14, 10]); u(m - 2, 5);
      ctx.lineDashOffset = 12; u(m + 2, 5, soft);
      ctx.setLineDash([]);
      break;
    }
    case "modern": {
      u(F - 3, 3);
      ctx.fillStyle = gold;
      for (const [x, sx] of [[0, 1], [W, -1]]) {
        ctx.beginPath(); ctx.moveTo(x, H - 90); ctx.lineTo(x, H - 120); ctx.lineTo(x + sx * 120, H); ctx.lineTo(x + sx * 90, H); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case "chalk": {
      const c = isLight(board) && d.bar === "board" ? "#2b2b2b" : "#F4F1E8";
      ctx.strokeStyle = c; ctx.globalAlpha = 0.75; ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const t = F / 2, wob = (v: number) => Math.sin(v * 0.05) * 2.2 + Math.sin(v * 0.17) * 1.1;
      ctx.beginPath();
      for (let y = 0; y <= H - t; y += 12) ctx.lineTo(t + wob(y + 3), y);
      for (let x = t; x <= W - t; x += 12) ctx.lineTo(x, H - t + wob(x + 7));
      for (let y = H - t; y >= 0; y -= 12) ctx.lineTo(W - t + wob(y), y);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
  // ظل خفيف صوب السبورة
  ctx.save(); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(F + 1, 0); ctx.lineTo(F + 1, H - F - 1); ctx.lineTo(W - F - 1, H - F - 1); ctx.lineTo(W - F - 1, 0); ctx.stroke(); ctx.restore();
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
  const A = areaOf(frameId, W);
  ctx.save();
  ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
  if (bg && bg.naturalWidth) {
    const s = Math.min(A.w / bg.naturalWidth, A.h / bg.naturalHeight);
    const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
    ctx.drawImage(bg, A.x + (A.w - w) / 2, A.y + (A.h - h) / 2, w, h);
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
export function drawHeader(ctx: CanvasRenderingContext2D, W: number, F: number, id: string, logo: HTMLImageElement | null, board: string, top = F) {
  const x0 = F, x1 = W - F, y = top, h = HEAD_H, cy = y + h / 2, w = x1 - x0;
  const light = isLight(board);
  const ink = light ? "#1F2A44" : "#F6C94A";
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, w, h + 30); ctx.clip();
  const nb = NOTEBOOK.find((n) => n.id === id);
  if (nb) { notebookHead(ctx, x0, x1, y, h, nb, logo); ctx.restore(); return; }
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
/** 📓 هيدر الدفتر: اللوگو بمربع ذهبي و«قصي العميري» يسار، خط ذهبي مايل، والشعار يمين. نفس ارتفاع باقي الهيدرات حتى البطن يبقى كبير */
function notebookHead(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, c: { bg: string; bg2: string }, logo: HTMLImageElement | null) {
  const w = x1 - x0, k = Math.max(0.6, Math.min(1, w / 1300));
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c.bg2); g.addColorStop(1, c.bg);
  ctx.fillStyle = g; ctx.fillRect(x0, y, w, h);
  ctx.fillStyle = goldGrad(ctx, x0, x1); ctx.fillRect(x0, y + h - 3, w, 3);
  // اللوگو بمربع بإطار ذهبي
  const s = h - 22, bx = x0 + 16, by = y + 9;
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.roundRect(bx, by, s, s, 9); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, bx, bx + s); ctx.lineWidth = 2.5; ctx.stroke();
  if (logo && logo.naturalWidth) {
    const W0 = logo.naturalWidth, H0 = logo.naturalHeight, sw = W0 * 0.57, sh = H0 * 0.62, f = (s - 10) / Math.max(sw, sh);
    ctx.drawImage(logo, W0 * 0.225, H0 * 0.225, sw, sh, bx + s / 2 - (sw * f) / 2, by + s / 2 - (sh * f) / 2, sw * f, sh * f);
  }
  // الاسم يم اللوگو
  ctx.textBaseline = "middle"; ctx.direction = "rtl"; ctx.textAlign = "left";
  ctx.font = `700 ${Math.round(30 * k)}px ${FONT}`;
  const nx = bx + s + 16, nw = ctx.measureText("قصي العميري").width;
  ctx.fillStyle = "#FFFFFF"; ctx.fillText("قصي العميري", nx, y + h / 2 - 1);
  // الخط الذهبي المايل
  const sx = nx + nw + 46 * k;
  ctx.fillStyle = goldGrad(ctx, sx, sx + 60);
  ctx.beginPath(); ctx.moveTo(sx, y + h - 3); ctx.lineTo(sx + 34, y); ctx.lineTo(sx + 56, y); ctx.lineTo(sx + 22, y + h - 3); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(sx + 32, y + h - 3); ctx.lineTo(sx + 66, y); ctx.lineTo(sx + 72, y); ctx.lineTo(sx + 38, y + h - 3); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  // الشعار يمين، يصغر إذا الشاشة ضيقة حتى ما يدوس على الخط
  let fs = Math.round(28 * k);
  ctx.font = `700 ${fs}px ${FONT}`;
  const room = x1 - 24 - (sx + 90);
  while (fs > 14 && ctx.measureText(SLOGAN).width > room) { fs -= 1; ctx.font = `700 ${fs}px ${FONT}`; }
  ctx.textAlign = "right"; ctx.fillStyle = goldGrad(ctx, x1 - 500, x1);
  ctx.fillText(SLOGAN, x1 - 24, y + h / 2 - 1);
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
