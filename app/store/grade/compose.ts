// تركيب الورقة المصححة كصور: غلاف بهدر الفصل والدرجة والملصق والمقولة، وبعده صفحات ورقة الطالب بتصحيح المصحح.
// كل فصل إله هدر بلون ورموز غير، والعربي غير الإنكليزي
export type Theme = { from: string; to: string; accent: string; symbols: string[] };
export type HeaderInfo = { slug: string; chapter: string; title: string; info: string; model: string; name: string; total: number; lang: "ar" | "en"; sid: number };

const THEMES: Theme[] = [
  { from: "#0d2547", to: "#1d4f8f", accent: "#f9c445", symbols: ["i", "z", "√-1", "a+bi", "|z|", "θ"] },        // الأول: الأعداد المركبة
  { from: "#083b3a", to: "#12746c", accent: "#ffd166", symbols: ["x²", "y²", "F", "e", "a²", "b²"] },            // الثاني: القطوع
  { from: "#4a0d1e", to: "#8f1d3d", accent: "#ffcf70", symbols: ["f′", "dy/dx", "max", "min", "Δx", "f″"] },     // الثالث: تطبيقات التفاضل
  { from: "#26104d", to: "#5a2aa3", accent: "#ffd700", symbols: ["∫", "dx", "∫ₐᵇ", "π", "F(x)", "∑"] },          // الرابع: التكامل
  { from: "#0f3a1c", to: "#2a7d40", accent: "#f6e05e", symbols: ["y′", "dy", "dx", "C", "eˣ", "ln"] },           // الخامس: المعادلات التفاضلية
  { from: "#4a2508", to: "#a5561b", accent: "#ffe08a", symbols: ["→", "⊥", "∥", "k̂", "î", "ĵ"] },               // السادس: الهندسة الفضائية
];
export function themeOf(slug: string) {
  const n = Number(/(\d+)/.exec(slug)?.[1] ?? 0);
  if (n >= 1 && n <= THEMES.length) return THEMES[n - 1];
  let h = 0; for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return THEMES[h % THEMES.length];
}
const EN_NUM = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
// نفس خط التطبيق اللي يختاره صاحب البوت (الحروف الناقصة تجي من Cairo)
const FONT = "QAppEn, QAppAr, Cairo, Tahoma, Arial, sans-serif";
export const W = 1080;

function seeded(seed: number) { let s = seed || 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > max && s > 14);
}
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
}

/** الهدر: العربي من اليمين بخلفية غامقة، والإنكليزي من اليسار بخلفية فاتحة وشريط ملون */
/** badge: بدل دائرة الدرجة (مثلاً رقم السؤال بورقة الكتابة بالقلم) */
export function drawHeader(ctx: CanvasRenderingContext2D, h: number, x: HeaderInfo, logo: HTMLImageElement | null, big = false, badge?: { top: string; sub: string }) {
  const t = themeOf(x.slug), en = x.lang === "en";
  const chapterNo = Number(/(\d+)/.exec(x.slug)?.[1] ?? 0);
  ctx.save();
  if (en) {
    ctx.fillStyle = "#f7f8fb"; ctx.fillRect(0, 0, W, h);
    const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, t.from); g.addColorStop(1, t.to);
    ctx.fillStyle = g; ctx.fillRect(0, h - 14, W, 14); ctx.fillRect(0, 0, 20, h);
  } else {
    const g = ctx.createLinearGradient(W, 0, 0, h); g.addColorStop(0, t.from); g.addColorStop(1, t.to);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
    ctx.fillStyle = t.accent; ctx.fillRect(0, h - 8, W, 8);
  }
  // رموز الفصل الخفيفة بالخلفية
  const rnd = seeded(chapterNo * 97 + (en ? 13 : 7));
  ctx.globalAlpha = en ? 0.07 : 0.1; ctx.fillStyle = en ? t.to : "#ffffff";
  for (let i = 0; i < 16; i++) { ctx.font = `700 ${22 + rnd() * 30}px ${FONT}`; ctx.fillText(t.symbols[i % t.symbols.length], rnd() * W, 30 + rnd() * (h - 30)); }
  ctx.globalAlpha = 1;
  const pad = 34, r = h * 0.3, cy = h / 2;
  const logoX = en ? pad + r : W - pad - r;
  ctx.fillStyle = en ? t.from : "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(logoX, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = t.accent; ctx.lineWidth = 4; ctx.stroke();
  if (logo) ctx.drawImage(logo, logoX - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56);
  // الدرجة بالطرف الثاني
  const gx = en ? W - pad - r : pad + r, pass = x.total >= 50;
  ctx.fillStyle = badge ? t.accent : pass ? "#1f9d55" : "#d32f2f"; ctx.beginPath(); ctx.arc(gx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = badge ? t.from : "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `900 ${r * 0.78}px ${FONT}`; ctx.fillText(badge ? badge.top : String(x.total), gx, cy - r * 0.12);
  ctx.font = `700 ${r * 0.26}px ${FONT}`; ctx.fillText(badge ? badge.sub : "/ 100", gx, cy + r * 0.48);
  // الكتابة بالنص
  const textL = en ? logoX + r + 26 : gx + r + 26, textR = en ? gx - r - 26 : logoX - r - 26, tw = textR - textL;
  ctx.direction = en ? "ltr" : "rtl"; ctx.textAlign = en ? "left" : "right";
  const tx = en ? textL : textR, ink = en ? "#14213d" : "#ffffff", sub = en ? t.to : t.accent;
  const line1 = en ? `Chapter ${EN_NUM[chapterNo] ?? chapterNo} · ${x.info || x.title}` : `${x.chapter} · ${x.title}`;
  // رقم الطالب بالهدر: كل صورة من ورقته تبين لمن
  const line2 = (en ? `Model ${x.model}` : `النسخة ${x.model}`) + (x.sid ? `  ·  ID ${x.sid}` : "");
  ctx.fillStyle = ink; fitText(ctx, line1, tw, big ? 46 : 38); ctx.fillText(line1, tx, cy - h * (big ? 0.2 : 0.17));
  ctx.fillStyle = sub; fitText(ctx, x.name, tw, big ? 40 : 32, 700); ctx.fillText(x.name, tx, cy + h * 0.05);
  ctx.fillStyle = en ? "#55607a" : "rgba(255,255,255,.8)"; fitText(ctx, line2, tw, big ? 28 : 24, 600); ctx.fillText(line2, tx, cy + h * (big ? 0.26 : 0.27));
  ctx.restore();
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("blob"))), "image/jpeg", 0.86));

/** الغلاف: الهدر الكبير، وبعده الملصق والمقولة بإطار */
export async function coverImage(x: HeaderInfo, quote: string, sticker: HTMLImageElement | null, logo: HTMLImageElement | null) {
  const t = themeOf(x.slug), en = x.lang === "en";
  const headH = 300;
  const stH = sticker ? Math.min(620, (560 * sticker.naturalHeight) / sticker.naturalWidth) : 0;
  const c = document.createElement("canvas");
  const meas = c.getContext("2d")!;
  meas.font = `700 40px ${FONT}`;
  const lines = wrap(meas, quote, W - 220);
  const qH = quote ? 90 + lines.length * 60 : 0;
  c.width = W; c.height = headH + 40 + (stH ? stH + 40 : 0) + (qH ? qH + 40 : 0) + 60;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = en ? "#ffffff" : "#0f1729"; ctx.fillRect(0, 0, W, c.height);
  drawHeader(ctx, headH, x, logo, true);
  let y = headH + 40;
  if (sticker && stH) {
    const sw = (stH * sticker.naturalWidth) / sticker.naturalHeight;
    ctx.save(); round(ctx, (W - sw) / 2, y, sw, stH, 28); ctx.clip(); ctx.drawImage(sticker, (W - sw) / 2, y, sw, stH); ctx.restore();
    ctx.strokeStyle = t.accent; ctx.lineWidth = 6; round(ctx, (W - sw) / 2, y, sw, stH, 28); ctx.stroke();
    y += stH + 40;
  }
  if (quote) {
    ctx.fillStyle = en ? "#f4f6fb" : "rgba(255,255,255,.06)"; round(ctx, 70, y, W - 140, qH, 30); ctx.fill();
    ctx.strokeStyle = t.accent; ctx.lineWidth = 5; round(ctx, 70, y, W - 140, qH, 30); ctx.stroke();
    ctx.fillStyle = t.accent; ctx.font = `900 90px Georgia, serif`; ctx.textAlign = "center"; ctx.fillText("❝", W / 2, y + 10);
    ctx.fillStyle = en ? "#14213d" : "#ffffff"; ctx.font = `700 40px ${FONT}`; ctx.direction = "rtl"; ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 70 + i * 60));
    y += qH + 40;
  }
  ctx.fillStyle = en ? "#8a93a8" : "rgba(255,255,255,.55)"; ctx.font = `600 26px ${FONT}`; ctx.textAlign = "center"; ctx.direction = "rtl";
  ctx.fillText(en ? "Corrected paper on the next pages" : "ورقتك المصححة بالصفحات الجاية", W / 2, c.height - 34);
  return await toBlob(c);
}
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out.slice(0, 8);
}

/** صفحة من ورقة الطالب: هدر صغير، والصفحة بعرض الصورة، والتصحيح فوكها */
export async function pageImage(x: HeaderInfo, page: HTMLImageElement, rot: number, drawInk: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, logo: HTMLImageElement | null) {
  const side = rot % 180 !== 0;
  const iw = side ? page.naturalHeight : page.naturalWidth, ih = side ? page.naturalWidth : page.naturalHeight;
  const headH = 170, ph = Math.round((W * ih) / iw);
  const c = document.createElement("canvas");
  c.width = W; c.height = headH + ph;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, c.height);
  drawHeader(ctx, headH, x, logo);
  ctx.save(); ctx.translate(W / 2, headH + ph / 2); ctx.rotate((rot * Math.PI) / 180);
  const dw = side ? ph : W, dh = side ? W : ph;
  ctx.drawImage(page, -dw / 2, -dh / 2, dw, dh); ctx.restore();
  ctx.save(); ctx.translate(0, headH); drawInk(ctx, W, ph); ctx.restore();
  return await toBlob(c);
}
