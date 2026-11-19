// تركيب الورقة المصححة كصور: غلاف بهدر الفصل والدرجة والملصق والمقولة، وبعده صفحات ورقة الطالب بتصحيح المصحح.
// الهدر نفس شكل ورقة الأسئلة (كحلي وذهبي). ألوان الفصول (themeOf) تبقى لورقة الكتابة بالقلم
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
export const EN_NUM = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
// نفس خط التطبيق اللي يختاره صاحب البوت (الحروف الناقصة تجي من Cairo)
const FONT = "QAppEn, QAppAr, Cairo, Tahoma, Arial, sans-serif";
export const W = 1080;

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > max && s > 14);
}
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
}

// شكل الهدر نفس ورقة الأسئلة اللي يسويها الأستاذ: شريط كحلي بزوايا مدورة وإطار ذهبي رفيع،
// اللوگو الذهبي بدائرة كحلية، وخط ذهبي تحته. بدون رموز بالخلفية
const NAVY_L = "#2a3652", NAVY_D = "#111a2d", GOLD = "#d8b04a";

/** الإنكليزي والأرقام بين العربي ينكتبون بترتيبهم الصحيح: بدونها «(1 & 2)» تطلع «(2 & 1)» (انقاس بالمتصفح) */
export const isolate = (s: string) => s.replace(/[([]*[A-Za-z0-9][A-Za-z0-9 &+\-*/.,=^()[\]]*/g, (m) => {
  const t = m.replace(/\s+$/, "");
  return `\u202A${t}\u202C${m.slice(t.length)}`;
});

/** الهدر: الشريط الكحلي، اللوگو، الفصل والعنوان، اسم الطالب، النسخة، والدرجة. العربي من اليمين والإنكليزي من اليسار */
/** badge: بدل دائرة الدرجة (مثلاً رقم السؤال بورقة الكتابة بالقلم) */
export function drawHeader(ctx: CanvasRenderingContext2D, h: number, x: HeaderInfo, logo: HTMLImageElement | null, big = false, badge?: { top: string; sub: string }) {
  const en = x.lang === "en";
  const chapterNo = Number(/(\d+)/.exec(x.slug)?.[1] ?? 0);
  ctx.save();
  const m = Math.round(h * 0.08), gap = Math.round(h * 0.035), lineH = Math.max(4, Math.round(h * 0.022));
  const bx = m, by = m, bw = W - 2 * m, bh = h - 2 * m - gap - lineH + Math.round(m * 0.6);
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, en ? NAVY_D : NAVY_L); g.addColorStop(1, en ? NAVY_L : NAVY_D);
  ctx.fillStyle = g; round(ctx, bx, by, bw, bh, bh * 0.14); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; round(ctx, bx, by, bw, bh, bh * 0.14); ctx.stroke();
  // الخط الذهبي تحت الشريط
  ctx.fillStyle = GOLD; ctx.fillRect(bx + bh * 0.08, by + bh + gap, bw - bh * 0.16, lineH);
  const cy = by + bh / 2, r = bh * 0.37, edge = bh * 0.16;
  // اللوگو: دائرة كحلية بحافة ذهبية
  const logoX = en ? bx + edge + r : bx + bw - edge - r;
  ctx.fillStyle = NAVY_D; ctx.beginPath(); ctx.arc(logoX, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
  if (logo) { const s = r * 1.3, k = logo.naturalWidth / logo.naturalHeight; ctx.drawImage(logo, logoX - (s * k) / 2, cy - s / 2, s * k, s); }
  // الدرجة بالطرف الثاني
  const gx = en ? bx + bw - edge - r : bx + edge + r, pass = x.total >= 50;
  ctx.fillStyle = badge ? GOLD : pass ? "#1f9d55" : "#d32f2f"; ctx.beginPath(); ctx.arc(gx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = badge ? "#ffffff" : GOLD; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = badge ? NAVY_D : "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "ltr";
  ctx.font = `900 ${r * 0.78}px ${FONT}`; ctx.fillText(badge ? badge.top : String(x.total), gx, cy - r * 0.12);
  ctx.font = `700 ${r * 0.26}px ${FONT}`; ctx.fillText(badge ? badge.sub : "/ 100", gx, cy + r * 0.5);
  // الكتابة بالنص
  const textL = en ? logoX + r + 24 : gx + r + 24, textR = en ? gx - r - 24 : logoX - r - 24, tw = textR - textL;
  ctx.direction = en ? "ltr" : "rtl"; ctx.textAlign = en ? "left" : "right";
  const tx = en ? textL : textR, k = big ? 1.08 : 1;
  const line1 = en ? `Chapter ${EN_NUM[chapterNo] ?? chapterNo} · ${x.info || x.title}` : isolate(`${x.chapter} · ${x.title}`);
  // رقم الطالب بالهدر: كل صورة من ورقته تبين لمن
  const line2 = en ? `Model ${x.model}` + (x.sid ? `  ·  ID ${x.sid}` : "") : isolate(`النسخة ${x.model}` + (x.sid ? `  ·  ID ${x.sid}` : ""));
  ctx.fillStyle = "#ffffff"; fitText(ctx, line1, tw, Math.round(bh * 0.21 * k), 700); ctx.fillText(line1, tx, cy - bh * 0.25);
  ctx.fillStyle = GOLD; fitText(ctx, x.name, tw, Math.round(bh * 0.19 * k), 700); ctx.fillText(x.name, tx, cy + bh * 0.02);
  ctx.fillStyle = "rgba(255,255,255,.85)"; fitText(ctx, line2, tw, Math.round(bh * 0.14 * k), 500); ctx.fillText(line2, tx, cy + bh * 0.27);
  ctx.restore();
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("blob"))), "image/jpeg", 0.86));

/** الغلاف: الهدر الكبير، وبعده الملصق والمقولة بإطار */
export async function coverImage(x: HeaderInfo, quote: string, sticker: HTMLImageElement | null, logo: HTMLImageElement | null) {
  const en = x.lang === "en";
  const headH = 300;
  const stH = sticker ? Math.min(620, (560 * sticker.naturalHeight) / sticker.naturalWidth) : 0;
  const c = document.createElement("canvas");
  const meas = c.getContext("2d")!;
  meas.font = `700 40px ${FONT}`;
  const lines = wrap(meas, quote, W - 220);
  const qH = quote ? 90 + lines.length * 60 : 0;
  c.width = W; c.height = headH + 40 + (stH ? stH + 40 : 0) + (qH ? qH + 40 : 0) + 60;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, c.height);
  drawHeader(ctx, headH, x, logo, true);
  let y = headH + 40;
  if (sticker && stH) {
    const sw = (stH * sticker.naturalWidth) / sticker.naturalHeight;
    ctx.save(); round(ctx, (W - sw) / 2, y, sw, stH, 28); ctx.clip(); ctx.drawImage(sticker, (W - sw) / 2, y, sw, stH); ctx.restore();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 6; round(ctx, (W - sw) / 2, y, sw, stH, 28); ctx.stroke();
    y += stH + 40;
  }
  if (quote) {
    ctx.fillStyle = "#f6f3ea"; round(ctx, 70, y, W - 140, qH, 30); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5; round(ctx, 70, y, W - 140, qH, 30); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.font = `900 90px Georgia, serif`; ctx.textAlign = "center"; ctx.fillText("❝", W / 2, y + 10);
    ctx.fillStyle = "#14213d"; ctx.font = `700 40px ${FONT}`; ctx.direction = "rtl"; ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 70 + i * 60));
    y += qH + 40;
  }
  ctx.fillStyle = "#8a93a8"; ctx.font = `600 26px ${FONT}`; ctx.textAlign = "center"; ctx.direction = "rtl";
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
  const headH = 200, ph = Math.round((W * ih) / iw);
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
