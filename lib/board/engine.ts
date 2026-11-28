// 📝 سبورة قصي العميري (طلبه 2026-11-25): نفس سبورة الويندوز مالته (BOARD_SPEC.md)، بس بالتطبيق، عنده وعند الطالب.
// هذا الملف حساب بس (بلا شاشة): الخطوط، الأشكال والمجسمات، المسح اللي يقسم الخط، الألوان، الإطارات، ونسيج الخشب.
// كل القياسات بوحدات السبورة: الارتفاع 1080، والعرض 1080 × نسبة الشاشة

export const H = 1080;
export const FRAME = 40;

export type Pt = number[];   // [x0, y0, x1, y1, ...]
export type InkStroke = { k: "ink" | "hl"; c: string; w: number; p: Pt; fit?: 0 };
/** ww: عرض اللف اللي حدده بالسحب (طلبه 2026-11-28: «يكتب شوية وينزل»)، وبدونه يلف لحد طرف السبورة */
export type TextItem = { k: "text"; c: string; s: number; x: number; y: number; t: string; bw: number; bh: number; ww?: number };
export type ImageItem = { k: "img"; r: string; x: number; y: number; w: number; h: number };
export type Item = InkStroke | TextItem | ImageItem;
export type Page = { items: Item[]; bg?: string | null };
/** wm: لوگوه خفيف بخلفية البطن، grid: ورق (مربعات/نقاط/أسطر)، foot: سطر تحت كل صفحة (رقمها وعنوان الشرح) */
export type Lesson = { v: 1; w: number; board: string; frame: string; head?: string; pages: Page[]; title?: string; wm?: 1; grid?: Grid; foot?: 1 };
export type Grid = "sq" | "dots" | "lines";
export const GRIDS: { id: "" | Grid; t: string }[] = [{ id: "", t: "بلا" }, { id: "sq", t: "مربعات" }, { id: "dots", t: "نقاط" }, { id: "lines", t: "أسطر" }];

// ---------- 📓 هيدرات الدفتر: نفس الشكل، لون الشريط يتغير
export const NOTEBOOK: { id: string; t: string; bg: string; bg2: string }[] = [
  { id: "nb-charcoal", t: "دفتر فحمي", bg: "#252527", bg2: "#38383B" },
  { id: "nb-navy", t: "دفتر كحلي", bg: "#121C2F", bg2: "#1F2E4A" },
  { id: "nb-black", t: "دفتر أسود", bg: "#0A0A0B", bg2: "#1C1C1E" },
  { id: "nb-wine", t: "دفتر خمري", bg: "#3A0E18", bg2: "#5A1828" },
  { id: "nb-emerald", t: "دفتر زمردي", bg: "#0A2F25", bg2: "#145142" },
  { id: "nb-royal", t: "دفتر أزرق ملكي", bg: "#0D2655", bg2: "#1A3F85" },
  { id: "nb-purple", t: "دفتر بنفسجي", bg: "#26163C", bg2: "#3F2763" },
  { id: "nb-brown", t: "دفتر بني", bg: "#2E2017", bg2: "#4A3526" },
  { id: "nb-teal", t: "دفتر فيروزي", bg: "#0B303A", bg2: "#16505E" },
  { id: "nb-slate", t: "دفتر رصاصي", bg: "#2A303B", bg2: "#434B5A" },
];
export const SLOGAN = "معاً لنغيّر الفكر الخاطئ عن الرياضيات";
// ---------- 🌙 الهيدرات المقوسة: الشكل × لون من ألوان الدفتر، id = cv-<الشكل>-<اللون>
export const CURVES: { id: string; t: string }[] = [
  { id: "arch", t: "قوس لفوك" },
  { id: "dome", t: "قوس لجوه" },
  { id: "wave", t: "موجة" },
  { id: "swoosh", t: "انسيابي" },
  { id: "medal", t: "ميدالية اللوگو" },
  { id: "pill", t: "كبسولتين" },
];
export const curveOf = (id?: string) => {
  const m = /^cv-([a-z]+)-([a-z]+)$/.exec(String(id ?? ""));
  if (!m) return null;
  const shape = CURVES.find((c) => c.id === m[1]), col = NOTEBOOK.find((n) => n.id === `nb-${m[2]}`);
  return shape && col ? { shape: shape.id, col } : null;
};

// ---------- 🏷 الهيدرات: شريط فوك السبورة باسمه واللوگو (طلبه 2026-11-25، يختار من 10)
export const HEADS: { id: string; t: string }[] = [
  { id: "none", t: "بدون هيدر" },
  { id: "navy", t: "كحلي وذهبي" },
  { id: "gold", t: "ذهبي فاخر" },
  { id: "line", t: "خط ذهبي ناعم" },
  { id: "ribbon", t: "شريط معلّق" },
  { id: "badge", t: "شارة بالنص" },
  { id: "corner", t: "زاوية فوك يمين" },
  { id: "math", t: "رموز الرياضيات" },
  { id: "double", t: "خطين ذهبيين" },
  { id: "chalk", t: "طباشير" },
  { id: "modern", t: "حديث متدرج" },
  // 📓 مثل هيدر دفتر المحاضرات (طلبه 2026-11-25): لوگو بمربع + «قصي العميري» يسار، خط ذهبي مايل، وشعاره يمين. نفس التصميم بعشر ألوان
  ...NOTEBOOK.map((n) => ({ id: n.id, t: `📓 ${n.t}` })),
  // 🌙 مقوسة (طلبه 2026-11-25: «مو بس عدلة، شوية مقوسة»): نفس المحتوى، الحافة التحتانية مقوسة. لونها يتبدل من صف الألوان
  ...CURVES.map((c) => ({ id: `cv-${c.id}-navy`, t: `🌙 ${c.t}` })),
];
export const HEAD_H = 76;
export const headOf = (id?: string) => (HEADS.some((h) => h.id === id) || curveOf(id) ? String(id) : "none");

// ---------- الألوان
export const QUICK = ["#FFFFFF", "#FFE600", "#FF3B30", "#2F9BFF", "#34C759", "#000000"];
export const WIDTHS = [3, 5, 10];
export const ERASERS: { n: number; t: string }[] = [{ n: 40, t: "صغيرة" }, { n: 80, t: "وسط" }, { n: 160, t: "كبيرة" }];
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0").toUpperCase();
export function hsv(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${hex2(f(5) * 255)}${hex2(f(3) * 255)}${hex2(f(1) * 255)}`;
}
/** اللوحة الكاملة: 14 لون × 6 درجات + 14 رصاصي = 98 */
export function palette(): string[] {
  const shades: [number, number][] = [[1, 0.35], [1, 0.55], [1, 0.8], [1, 1], [0.6, 1], [0.3, 1]];
  const out: string[] = [];
  for (const [s, v] of shades) for (let i = 0; i < 14; i++) out.push(hsv((i * 360) / 14, s, v));
  for (let i = 0; i < 14; i++) { const g = hex2((i * 255) / 13); out.push(`#${g}${g}${g}`); }
  return out;
}

// ---------- لون السبورة والإطارات
// بطن السبورة: ألوان هواية (طلبه 2026-11-25)، وكل لون يگدر يختاره من «لون ثاني»
export const BOARDS: { c: string; t: string }[] = [
  { c: "#1F4E3D", t: "أخضر" }, { c: "#2E5E3A", t: "أخضر زرعي" }, { c: "#0F3B2E", t: "زمردي" }, { c: "#3B5323", t: "زيتوني" }, { c: "#155E52", t: "أخضر بحري" },
  { c: "#1D4E5F", t: "فيروزي" }, { c: "#0E5E6F", t: "تركوازي" }, { c: "#1F6F8B", t: "أزرق سماوي غامق" }, { c: "#1B3A8A", t: "أزرق ملكي" }, { c: "#1E56A0", t: "أزرق" },
  { c: "#293B60", t: "كحلي" }, { c: "#141F33", t: "كحلي غامق" }, { c: "#0F2A47", t: "أزرق غامق" }, { c: "#2C2F5B", t: "نيلي" }, { c: "#3A1F5C", t: "بنفسجي" },
  { c: "#5B2A6E", t: "موف" }, { c: "#4A1F2E", t: "عنابي" }, { c: "#6B1E2B", t: "خمري" }, { c: "#7A2E1F", t: "قرميدي" }, { c: "#3E2A1E", t: "بني" },
  { c: "#5A3A22", t: "بني فاتح" }, { c: "#4B3B2A", t: "قهوائي" }, { c: "#2B2B2B", t: "أسود" }, { c: "#111111", t: "أسود فاحم" }, { c: "#3A3F47", t: "رصاصي غامق" },
  { c: "#4F5B66", t: "رصاصي" }, { c: "#36454F", t: "فحمي" }, { c: "#F8F8F4", t: "سبورة بيضة" }, { c: "#FFFFFF", t: "أبيض ناصع" }, { c: "#F4EEDC", t: "عاجي" },
  { c: "#FFF8E7", t: "كريمي" }, { c: "#F3E9D2", t: "ورق قديم" }, { c: "#EAF4EA", t: "أخضر فاتح" }, { c: "#E8F1FA", t: "أزرق فاتح" }, { c: "#FDF0F3", t: "وردي فاتح" },
  { c: "#F2ECFA", t: "بنفسجي فاتح" }, { c: "#FFF6D6", t: "أصفر فاتح" }, { c: "#E9ECEF", t: "رصاصي فاتح" }, { c: "#DDE6D5", t: "ميرمية" }, { c: "#E5DCCB", t: "بيج" },
];
/** deco: إطار مزخرف بدل الخشب (طلبه 2026-11-25): ثلاث جهات بس (يمين ويسار وجوه)، الفوك يبقى للهيدر مالته
 *  حتى ما يصير طبقتين فوك وتقل مساحة الكتابة. شريط بلون وخطوط ذهبية (أو فضية أو ذهبي وردي).
 *  bar: لون الشريط («board» يعني نفس لون السبورة، فتطلع الخطوط بس) */
/** slim: إطار نحيف (طلبه 2026-11-25: «الجوانب ثخينة وماخذة عرض»). الهيدر يمتد على العرض كله فوك الإطار، فالزاوية نظيفة. w: عرضه. bar "head": بلون الهيدر */
export type Frame = { id: string; t: string; wood?: [string, string, number]; grad?: string[]; deco?: { bar: string; style: string; line?: "gold" | "silver" | "rose" }; light: boolean; w?: number; slim?: boolean };
export const FRAMES: Frame[] = [
  { id: "s-match", t: "نحيف بلون الهيدر", deco: { bar: "head", style: "slim" }, light: false, w: 14, slim: true },
  { id: "s-match2", t: "نحيف بلون الهيدر وخطين", deco: { bar: "head", style: "slim2" }, light: false, w: 16, slim: true },
  { id: "s-gold", t: "خط ذهبي نحيف بس", deco: { bar: "board", style: "slim" }, light: false, w: 10, slim: true },
  { id: "s-silver", t: "نحيف بلون الهيدر وخط فضي", deco: { bar: "head", style: "slim", line: "silver" }, light: false, w: 14, slim: true },
  { id: "d-navy", t: "كحلي وذهبي", deco: { bar: "#141F33", style: "lines" }, light: false },
  { id: "d-gold", t: "ذهبي فاخر", deco: { bar: "gold", style: "lines" }, light: true },
  { id: "d-black", t: "أسود وذهبي", deco: { bar: "#111111", style: "lines" }, light: false },
  { id: "d-wine", t: "عنابي وذهبي", deco: { bar: "#4A1F2E", style: "lines" }, light: false },
  { id: "d-line", t: "خط ذهبي ناعم", deco: { bar: "board", style: "line" }, light: false },
  { id: "d-double", t: "خطين ذهبيين", deco: { bar: "board", style: "double" }, light: false },
  { id: "d-corners", t: "زوايا ذهبية", deco: { bar: "board", style: "corners" }, light: false },
  { id: "d-math", t: "رموز الرياضيات", deco: { bar: "#141F33", style: "math" }, light: false },
  { id: "d-modern", t: "حديث متدرج", deco: { bar: "modern", style: "modern" }, light: false },
  { id: "d-chalk", t: "طباشير", deco: { bar: "board", style: "chalk" }, light: false },
  { id: "d-emerald", t: "زمردي وذهبي", deco: { bar: "#0F3B2E", style: "lines" }, light: false },
  { id: "d-royal", t: "أزرق ملكي وذهبي", deco: { bar: "#1B3A8A", style: "lines" }, light: false },
  { id: "d-purple", t: "بنفسجي وذهبي", deco: { bar: "#3A1F5C", style: "lines" }, light: false },
  { id: "d-brown", t: "بني وذهبي", deco: { bar: "#4A2E1A", style: "lines" }, light: false },
  { id: "d-ivory", t: "عاجي وذهبي", deco: { bar: "#F4EEDC", style: "lines" }, light: true },
  { id: "d-silver", t: "فضي", deco: { bar: "#1E2430", style: "lines", line: "silver" }, light: false },
  { id: "d-rose", t: "ذهبي وردي", deco: { bar: "#3B2430", style: "lines", line: "rose" }, light: false },
  { id: "d-dots", t: "نقاط ذهبية", deco: { bar: "#141F33", style: "dots" }, light: false },
  { id: "d-wave", t: "موجة ذهبية", deco: { bar: "#141F33", style: "wave" }, light: false },
  { id: "d-stars", t: "نجوم", deco: { bar: "#141F33", style: "stars" }, light: false },
  { id: "d-rope", t: "حبل ذهبي", deco: { bar: "board", style: "rope" }, light: false },
  // 🪢 عائلة الحبل الذهبي (عجبه، طلب أفكار مثله 2026-11-25): أنحف، والهيدر يمتد فوكها فالزاوية نظيفة
  { id: "r-twist", t: "🪢 حبل مبروم ذهبي", deco: { bar: "board", style: "twist" }, light: false, w: 24, slim: true },
  { id: "r-twist-navy", t: "🪢 حبل مبروم على كحلي", deco: { bar: "head", style: "twist" }, light: false, w: 26, slim: true },
  { id: "r-twist-silver", t: "🪢 حبل مبروم فضي", deco: { bar: "board", style: "twist", line: "silver" }, light: false, w: 24, slim: true },
  { id: "r-twist-rose", t: "🪢 حبل مبروم ذهبي وردي", deco: { bar: "board", style: "twist", line: "rose" }, light: false, w: 24, slim: true },
  { id: "r-rope-slim", t: "🪢 حبل ذهبي نحيف", deco: { bar: "board", style: "rope" }, light: false, w: 20, slim: true },
  { id: "r-rope-line", t: "🪢 حبل وخط ذهبي", deco: { bar: "board", style: "rope2" }, light: false, w: 26, slim: true },
  { id: "r-beads", t: "🪢 خرز ذهبي", deco: { bar: "board", style: "beads" }, light: false, w: 20, slim: true },
  { id: "r-pearls", t: "🪢 لؤلؤ", deco: { bar: "board", style: "beads", line: "silver" }, light: false, w: 20, slim: true },
  { id: "r-chain", t: "🪢 سلسلة ذهبية", deco: { bar: "board", style: "chain" }, light: false, w: 22, slim: true },
  { id: "r-chain-navy", t: "🪢 سلسلة على كحلي", deco: { bar: "head", style: "chain" }, light: false, w: 24, slim: true },
  { id: "oak", t: "بلوط فاتح", wood: ["#D9B07A", "#A8763F", 0.55], light: true },
  { id: "walnut", t: "جوز غامق", wood: ["#7A5236", "#3B2415", 0.5], light: false },
  { id: "mahogany", t: "ماهوجني", wood: ["#A3532F", "#561F10", 0.6], light: false },
  { id: "teak", t: "ساج ذهبي", wood: ["#CF9A47", "#8A5A20", 0.45], light: true },
  { id: "classic", t: "خشب كلاسيكي", wood: ["#B07A45", "#6A4020", 0.55], light: false },
  { id: "ebony", t: "أبنوس أسود", wood: ["#4A3A30", "#120D0A", 0.65], light: false },
  { id: "pine", t: "صنوبر", wood: ["#EBD199", "#C29A5B", 0.4], light: true },
  { id: "cherry", t: "كرز", wood: ["#B8673F", "#68291A", 0.55], light: false },
  { id: "gold", t: "ذهبي", grad: ["#F7D774", "#C9962B", "#F3CF6A", "#9C6F17"], light: true },
  { id: "black", t: "أسود عصري", grad: ["#3A3A3A", "#151515", "#262626", "#0A0A0A"], light: false },
  { id: "silver", t: "فضي", grad: ["#F1F3F5", "#AEB5BD", "#DDE1E5", "#8D949C"], light: true },
  { id: "white", t: "أبيض", grad: ["#FFFFFF", "#E4E6E8", "#F6F7F8", "#C9CDD1"], light: true },
  { id: "none", t: "بدون إطار", light: false },
];
export const DEFAULT_BOARD = "#1F4E3D", DEFAULT_FRAME = "s-match";
export const frameOf = (id: string) => FRAMES.find((f) => f.id === id) ?? FRAMES.find((f) => f.id === DEFAULT_FRAME)!;
export const insetOf = (id: string) => { const f = frameOf(id); return f.id === "none" ? 0 : f.w ?? FRAME; };
/** من وين تبدي السبورة من فوك: الإطارات المزخرفة ما إلها ضلع فوك (الفوك للهيدر) */
export const topOf = (id: string) => (frameOf(id).deco ? 0 : insetOf(id));
/** مساحة الكتابة داخل الإطار */
export const areaOf = (id: string, W: number) => { const F = insetOf(id), T = topOf(id); return { x: F, y: T, w: W - 2 * F, h: H - F - T }; };
/** السبورة فاتحة؟ (القلم الأبيض يصير أسود عليها) */
export function isLight(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

// ---------- نسيج الخشب (نفس Wood.Make بالويندوز): العروق على طول الخشبة، ويتكرر بلا فاصل
const hash = (n: number) => { n = ((n << 13) ^ n) | 0; return 1 - ((Math.imul(n, (Math.imul(Math.imul(n, n), 15731) + 789221) | 0) + 1376312589) & 0x7fffffff) / 1073741824; };
const smooth = (x: number, seed: number) => {
  const i = Math.floor(x), f = x - i;
  const a = hash(i * 57 + seed * 131), b = hash((i + 1) * 57 + seed * 131);
  return a + (b - a) * (f * f * (3 - 2 * f));
};
const rgb = (c: string) => { const n = parseInt(c.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** بكسلات RGBA للخشب، عرض w وارتفاع h */
export function woodPixels(w: number, h: number, light: string, dark: string, seed: number, rings: number): Uint8ClampedArray {
  const L = rgb(light), D = rgb(dark);
  const px = new Uint8ClampedArray(w * h * 4);
  let r = seed * 9301 + 49297;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xs = (2 * Math.PI * x) / w;
    const warp = 3.2 * Math.sin(xs + seed) + 1.6 * Math.sin(xs * 3 + seed * 1.7) + 0.5 * Math.sin(xs * 7 + seed * 0.3);
    const yy = y + warp;
    const bands = smooth(yy * 0.045 * rings, seed) * 0.55 + smooth(yy * 0.13, seed + 7) * 0.28;
    const fibers = smooth(yy * 0.9, seed + 19) * 0.13 + smooth(yy * 2.3, seed + 23) * 0.06;
    const ring = Math.sin(yy * 0.22 * rings + smooth(y * 0.03, seed + 3) * 5);
    const sheen = 0.05 * Math.sin(xs * 2 + y * 0.01 + seed);
    const t = Math.max(0, Math.min(1, 0.5 + 0.1 * ring + bands + fibers + sheen + (rnd() - 0.5) * 0.05));
    const i = (y * w + x) * 4;
    px[i] = D[0] + (L[0] - D[0]) * t; px[i + 1] = D[1] + (L[1] - D[1]) * t; px[i + 2] = D[2] + (L[2] - D[2]) * t; px[i + 3] = 255;
  }
  return px;
}

// ---------- الأشكال والمجسمات (نفس BuildShape بالويندوز)
export const SHAPES: { id: string; t: string }[] = [
  { id: "line", t: "خط" }, { id: "arrow", t: "سهم" }, { id: "rect", t: "مستطيل" }, { id: "ellipse", t: "دائرة" }, { id: "triangle", t: "مثلث" }, { id: "righttri", t: "قائم" },
];
export const SOLIDS: { id: string; t: string }[] = [
  { id: "cube", t: "متوازي مستطيلات" }, { id: "cylinder", t: "أسطوانة" }, { id: "cone", t: "مخروط" }, { id: "pyramid", t: "هرم" }, { id: "sphere", t: "كرة" }, { id: "prism", t: "منشور ثلاثي" },
];
type P2 = [number, number];
const arc = (cx: number, cy: number, rx: number, ry: number, t0: number, t1: number, n: number): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / n; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as P2; });
const rot = (v: P2, deg: number): P2 => { const a = (deg * Math.PI) / 180; return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]; };

/** خطوط الشكل من نقطة البداية للنهاية: solid خطوط كاملة، dashed مخفية (تنرسم متقطعة) */
export function buildShape(kind: string, a: P2, b: P2, penWidth: number): { solid: P2[][]; dashed: P2[][] } {
  const solid: P2[][] = [], dashed: P2[][] = [];
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, PI = Math.PI;
  switch (kind) {
    case "line": solid.push([a, b]); break;
    case "arrow": {
      solid.push([a, b]);
      const vx = a[0] - b[0], vy = a[1] - b[1], len = Math.hypot(vx, vy);
      if (len < 1) break;
      const v: P2 = [vx / len, vy / len], hl = Math.max(24, penWidth * 6);
      const r1 = rot(v, 28), r2 = rot(v, -28);
      solid.push([[b[0] + r1[0] * hl, b[1] + r1[1] * hl], b, [b[0] + r2[0] * hl, b[1] + r2[1] * hl]]);
      break;
    }
    case "rect": solid.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]); break;
    case "ellipse": solid.push(arc(cx, cy, w / 2, h / 2, 0, 2 * PI, 90)); break;
    case "triangle": solid.push([[cx, y0], [x1, y1], [x0, y1], [cx, y0]]); break;
    case "righttri": solid.push([[x0, y0], [x0, y1], [x1, y1], [x0, y0]]); break;
    case "cube": {
      const d = Math.min(w, h) * 0.3;
      const FL = x0, FR = x1 - d, FT = y0 + d, FB = y1, BL = x0 + d, BR = x1, BT = y0, BB = y1 - d;
      solid.push([[FL, FT], [FR, FT], [FR, FB], [FL, FB], [FL, FT]]);
      solid.push([[FL, FT], [BL, BT], [BR, BT], [BR, BB], [FR, FB]]);
      solid.push([[FR, FT], [BR, BT]]);
      dashed.push([[BL, BT], [BL, BB], [BR, BB]]);
      dashed.push([[FL, FB], [BL, BB]]);
      break;
    }
    case "cylinder": {
      const rx = w / 2, ry = Math.min(h * 0.15, w * 0.22), top = y0 + ry, bot = y1 - ry;
      solid.push(arc(cx, top, rx, ry, 0, 2 * PI, 90));
      solid.push(arc(cx, bot, rx, ry, 0, PI, 45));
      dashed.push(arc(cx, bot, rx, ry, PI, 2 * PI, 45));
      solid.push([[x0, top], [x0, bot]]); solid.push([[x1, top], [x1, bot]]);
      break;
    }
    case "cone": {
      const rx = w / 2, ry = Math.min(h * 0.15, w * 0.22), bot = y1 - ry;
      solid.push(arc(cx, bot, rx, ry, 0, PI, 45));
      dashed.push(arc(cx, bot, rx, ry, PI, 2 * PI, 45));
      solid.push([[x0, bot], [cx, y0], [x1, bot]]);
      dashed.push([[cx, y0], [cx, bot]]);
      break;
    }
    case "pyramid": {
      const d = w * 0.28, dy = Math.min(h * 0.25, d * 0.6);
      const A: P2 = [x0, y1], B: P2 = [x1 - d, y1], C: P2 = [x1, y1 - dy], D: P2 = [x0 + d, y1 - dy], P: P2 = [cx, y0];
      solid.push([A, B, C]); solid.push([A, P, B]); solid.push([P, C]);
      dashed.push([C, D, A]); dashed.push([P, D]);
      break;
    }
    case "sphere": {
      const r = Math.min(w, h) / 2;
      solid.push(arc(cx, cy, r, r, 0, 2 * PI, 120));
      solid.push(arc(cx, cy, r, r * 0.28, 0, PI, 50));
      dashed.push(arc(cx, cy, r, r * 0.28, PI, 2 * PI, 50));
      break;
    }
    case "prism": {
      const d = Math.min(w, h) * 0.3;
      const F1: P2 = [x0, y1], F2: P2 = [x1 - d, y1], F3: P2 = [x0 + (w - d) / 2, y0 + d];
      const off = (p: P2): P2 => [p[0] + d, p[1] - d];
      const B1 = off(F1), B2 = off(F2), B3 = off(F3);
      solid.push([F1, F2, F3, F1]); solid.push([F3, B3, B2, F2]);
      dashed.push([B3, B1, B2]); dashed.push([F1, B1]);
      break;
    }
  }
  return { solid, dashed };
}

/** خط متقطع: قطع طول on وفراغ off */
export function dash(pts: P2[], on: number, off: number): P2[][] {
  const res: P2[][] = [];
  if (pts.length < 2) return res;
  let drawing = true, remain = on, cur: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= 0) continue;
    let t = 0;
    while (len - t > remain) {
      t += remain;
      const q: P2 = [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
      if (drawing) { cur.push(q); res.push(cur); } else cur = [q];
      drawing = !drawing;
      remain = drawing ? on : off;
    }
    remain -= len - t;
    if (drawing) cur.push(b);
  }
  if (drawing && cur.length > 1) res.push(cur);
  return res;
}

/** الشكل كخطوط عادية (تنمسح وتتراجع مثل الكتابة) */
export function shapeStrokes(kind: string, a: P2, b: P2, color: string, width: number): InkStroke[] {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return [];
  const { solid, dashed } = buildShape(kind, a, b, width);
  const d = Math.max(10, width * 3);
  for (const line of dashed) solid.push(...dash(line, d, d * 0.8));
  return solid.filter((l) => l.length >= 2).map((l) => ({ k: "ink", c: color, w: width, p: l.flat(), fit: 0 }));
}

// ---------- المسح: الممحاة مربع، والخط اللي تمر عليه ينقسم (مو ينمسح كله). النص ينمسح كله
const DENSE = 2;
/** نقاط أكثر على طول الخط حتى المسح يقص بدقة */
export function densify(p: Pt, step = DENSE): Pt {
  if (p.length < 4) return p.slice();
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  return out;
}
export const textBox = (t: TextItem) => ({ x0: t.x - t.bw, y0: t.y, x1: t.x, y1: t.y + t.bh });
/** مسح على طول الحركة من a لـ b بمربع ضلعه size. يرجع البنود الجديدة، واللي انشالت، واللي انضافت (للتراجع) */
export function eraseAlong(items: Item[], a: P2, b: P2, size: number): { items: Item[]; removed: Item[]; added: Item[] } {
  const half = size / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / Math.max(2, half / 2)));
  const centers: P2[] = Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  const bx0 = Math.min(a[0], b[0]) - half, bx1 = Math.max(a[0], b[0]) + half, by0 = Math.min(a[1], b[1]) - half, by1 = Math.max(a[1], b[1]) + half;
  const removed: Item[] = [], added: Item[] = [], out: Item[] = [];
  for (const it of items) {
    // الصورة والكتابة المطبوعة (المايك والكيبورد) ما تنمسح بالممحاة ولا بالكف: تنشال بس من «تحريك» ← احذف
    // (طلبه 2026-11-27: يمسح كتابة قلمه اللي يمها والمطبوعة تبقى)
    if (it.k === "img" || it.k === "text") { out.push(it); continue; }
    const pad = half + it.w / 2;
    // سريع: إذا مربع الخط كله بعيد عن الممحاة ما نلمسه (المربع، مو النقاط: خط طويل بنقطتين يمر من نصها)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < it.p.length; i += 2) { x0 = Math.min(x0, it.p[i]); x1 = Math.max(x1, it.p[i]); y0 = Math.min(y0, it.p[i + 1]); y1 = Math.max(y1, it.p[i + 1]); }
    if (x1 < bx0 - it.w || x0 > bx1 + it.w || y1 < by0 - it.w || y0 > by1 + it.w) { out.push(it); continue; }
    const p = densify(it.p);
    const hit = (x: number, y: number) => centers.some(([cx, cy]) => Math.abs(x - cx) <= pad && Math.abs(y - cy) <= pad);
    const parts: number[][] = [];
    let cur: number[] = [];
    let any = false;
    for (let i = 0; i < p.length; i += 2) {
      if (hit(p[i], p[i + 1])) { any = true; if (cur.length >= 4) parts.push(cur); cur = []; }
      else cur.push(p[i], p[i + 1]);
    }
    if (!any) { out.push(it); continue; }
    if (cur.length >= 4) parts.push(cur);
    removed.push(it);
    for (const part of parts) { const s: InkStroke = { ...it, p: part }; added.push(s); out.push(s); }
  }
  return { items: out, removed, added };
}

/** الكف: التماس أكبر من الحد (بوحدات السبورة) */
export const isPalm = (w: number, h: number, threshold: number) => w > threshold || h > threshold;
/** عرض التظليل */
export const hlWidth = (pen: number) => Math.max(18, pen * 5);
/** عرض النص قبل ما يلف للسطر الثاني */
export const wrapWidth = (right: number) => Math.max(200, Math.min(1400, right - 60));

/** درس فاضي */
export const emptyLesson = (w: number, board = DEFAULT_BOARD, frame = DEFAULT_FRAME): Lesson => ({ v: 1, w, board, frame, pages: [{ items: [] }] });
/** فحص درس جاي من برا (ملف محفوظ أو مستلم): يشيل أي شي غريب */
export function cleanLesson(x: unknown): Lesson | null {
  const j = x as Partial<Lesson> | null;
  if (!j || !Array.isArray(j.pages) || !j.pages.length || j.pages.length > 400) return null;
  const col = (c: unknown) => (typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : "#FFFFFF");
  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const pages: Page[] = j.pages.map((pg) => ({
    bg: typeof pg?.bg === "string" && pg.bg.length < 300 ? pg.bg : null,
    items: (Array.isArray(pg?.items) ? pg.items : []).slice(0, 20000).flatMap((it: any): Item[] => {
      if (it?.k === "img" && typeof it.r === "string" && it.r.length < 300) return [{ k: "img", r: it.r, x: num(it.x), y: num(it.y), w: Math.max(10, num(it.w, 100)), h: Math.max(10, num(it.h, 100)) }];
      if (it?.k === "text") return [{ k: "text", c: col(it.c), s: num(it.s, 56), x: num(it.x), y: num(it.y), t: String(it.t ?? "").slice(0, 4000), bw: num(it.bw), bh: num(it.bh), ...(num(it.ww) > 0 ? { ww: Math.min(4000, num(it.ww)) } : {}) }];
      if ((it?.k === "ink" || it?.k === "hl") && Array.isArray(it.p) && it.p.length >= 2) return [{ k: it.k, c: col(it.c), w: Math.max(1, Math.min(200, num(it.w, 5))), p: it.p.slice(0, 40000).map((v: unknown) => Math.round(num(v) * 10) / 10), ...(it.fit === 0 ? { fit: 0 as const } : {}) }];
      return [];
    }),
  }));
  return { v: 1, w: Math.max(400, Math.min(4000, num(j.w, 1920))), board: typeof j.board === "string" && /^#[0-9A-Fa-f]{6}$/.test(j.board) ? j.board.toUpperCase() : DEFAULT_BOARD, frame: FRAMES.some((f) => f.id === j.frame) ? String(j.frame) : DEFAULT_FRAME, head: headOf(j.head), pages, ...(typeof j.title === "string" ? { title: j.title.slice(0, 120) } : {}), ...(j.wm ? { wm: 1 as const } : {}), ...(j.foot ? { foot: 1 as const } : {}), ...(GRIDS.some((g) => g.id && g.id === j.grid) ? { grid: j.grid as Grid } : {}) };
}

// ---------- ✋ التحريك: يختار كتابة أو صورة (دوسة عليها أو مربع حواليها) ويحركها
export type Box = { x0: number; y0: number; x1: number; y1: number };
export function itemBox(it: Item): Box {
  if (it.k === "text") return textBox(it);
  if (it.k === "img") return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < it.p.length; i += 2) { x0 = Math.min(x0, it.p[i]); x1 = Math.max(x1, it.p[i]); y0 = Math.min(y0, it.p[i + 1]); y1 = Math.max(y1, it.p[i + 1]); }
  const h = it.w / 2;
  return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
}
export const unionBox = (items: Item[]): Box | null => items.length ? items.map(itemBox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : null;
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
/** أعلى شي تحت النقطة (الأخير بالرسم فوك) */
export function hitItem(items: Item[], x: number, y: number, tol = 14): Item | null {
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.k !== "ink" && it.k !== "hl") { const b = itemBox(it); if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return it; continue; }
    const p = it.p, r = it.w / 2 + tol;
    if (p.length === 2) { if (Math.hypot(x - p[0], y - p[1]) <= r) return it; continue; }
    for (let i = 2; i < p.length; i += 2) if (segDist(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= r) return it;
  }
  return null;
}
/** كل شي داخل المربع (نقطة منه بس تكفي للخط) */
export function inRect(items: Item[], r: Box): Item[] {
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  return items.filter((it) => {
    if (it.k !== "ink" && it.k !== "hl") { const b = itemBox(it); return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1; }
    for (let i = 0; i < it.p.length; i += 2) if (it.p[i] >= x0 && it.p[i] <= x1 && it.p[i + 1] >= y0 && it.p[i + 1] <= y1) return true;
    return false;
  });
}
/** نسخة متحركة (النسخة القديمة تبقى للتراجع) */
export function moved(it: Item, dx: number, dy: number): Item {
  if (it.k === "text") return { ...it, x: it.x + dx, y: it.y + dy };
  if (it.k === "img") return { ...it, x: it.x + dx, y: it.y + dy };
  return { ...it, p: it.p.map((v, i) => v + (i % 2 ? dy : dx)) };
}
/** تكبير وتصغير حول نقطة (مسكة الزاوية) */
export function scaled(it: Item, ox: number, oy: number, s: number): Item {
  const f = (x: number, y: number) => [ox + (x - ox) * s, oy + (y - oy) * s];
  if (it.k === "img") { const [x, y] = f(it.x, it.y); return { ...it, x, y, w: it.w * s, h: it.h * s }; }
  if (it.k === "text") { const [x, y] = f(it.x, it.y); return { ...it, x, y, s: it.s * s, bw: it.bw * s, bh: it.bh * s }; }
  return { ...it, w: Math.max(1, it.w * s), p: it.p.map((v, i) => (i % 2 ? oy + (v - oy) * s : ox + (v - ox) * s)) };
}
