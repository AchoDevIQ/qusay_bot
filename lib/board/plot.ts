// 📈 رسم دالة على السبورة (طلبه 2026-11-25: «أعطيه معادلة هو يرسم لي»).
// يقرا المعادلة بنفسه (بلا eval): + - × ÷ ^ والأقواس، sin cos tan sqrt √ ln log abs exp، π و e، والضرب المخفي (2x، 3(x+1)).
// يطلع خطوط عادية (المحاور والمنحني) تنمسح وتتحرك مثل كتابته، والأرقام نصوص.

type Tok = { k: "n"; v: number } | { k: "x" } | { k: "f"; v: string } | { k: "o"; v: string } | { k: "(" } | { k: ")" };
const FUNCS: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a), cot: (a) => 1 / Math.tan(a),
};

function tokens(src: string): Tok[] {
  let s = src.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".")
    .replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3")
    .replace(/س/g, "x").replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/\s+/g, "").toLowerCase();
  s = s.replace(/^(y|f\(x\)|ص)=/, "");
  const out: Tok[] = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) { const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(s.slice(i))!; out.push({ k: "n", v: Number(m[0]) }); i += m[0].length; continue; }
    if (/[a-z]/.test(ch)) {
      const m = /^[a-z]+/.exec(s.slice(i))![0];
      // كلمة طويلة: نقسمها لدوال وثوابت و x (مثل «2xsinx»)
      let j = 0;
      while (j < m.length) {
        const f = Object.keys(FUNCS).sort((a, b) => b.length - a.length).find((n) => m.startsWith(n, j));
        if (f) { out.push({ k: "f", v: f }); j += f.length; continue; }
        if (m.startsWith("pi", j)) { out.push({ k: "n", v: Math.PI }); j += 2; continue; }
        if (m[j] === "e") { out.push({ k: "n", v: Math.E }); j++; continue; }
        if (m[j] === "x") { out.push({ k: "x" }); j++; continue; }
        throw new Error(`ما أعرف «${m.slice(j)}»`);
      }
      i += m.length; continue;
    }
    if ("+-*/^".includes(ch)) { out.push({ k: "o", v: ch }); i++; continue; }
    if (ch === "(" || ch === "[") { out.push({ k: "(" }); i++; continue; }
    if (ch === ")" || ch === "]") { out.push({ k: ")" }); i++; continue; }
    if (ch === "|") { out.push({ k: "f", v: "abs" }); out.push({ k: "(" }); const close = s.indexOf("|", i + 1); if (close < 0) throw new Error("القيمة المطلقة ما مسدودة"); s = s.slice(0, close) + ")" + s.slice(close + 1); i++; continue; }
    throw new Error(`ما أعرف «${ch}»`);
  }
  // الضرب المخفي: 2x، x(…)، )(، 2sin، x2 ما نقبلها
  const res: Tok[] = [];
  for (const t of out) {
    const p = res[res.length - 1];
    const endsVal = p && (p.k === "n" || p.k === "x" || p.k === ")");
    const startsVal = t.k === "n" || t.k === "x" || t.k === "(" || t.k === "f";
    // sin^2 x: الأس مال الدالة، ما نحط ضرب بعده
    const fnPow = p?.k === "n" && res[res.length - 2]?.k === "o" && (res[res.length - 2] as { v: string }).v === "^" && res[res.length - 3]?.k === "f";
    if (endsVal && startsVal && !fnPow) res.push({ k: "o", v: "*" });
    res.push(t);
  }
  return res;
}

type Fn = (x: number) => number;
const LTR = String.fromCharCode(0x202a), POP = String.fromCharCode(0x202c);
/** يحول المعادلة لدالة. يرمي خطأ بالعربي إذا ما فهمها */
export function parseFn(src: string): Fn {
  const t = tokens(src);
  if (!t.length) throw new Error("اكتب المعادلة");
  let i = 0;
  const peek = () => t[i];
  const expr = (): Fn => {
    let a = term();
    while (peek()?.k === "o" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
      const op = (t[i++] as { v: string }).v, l = a, r = term();
      a = op === "+" ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return a;
  };
  const term = (): Fn => {
    let a = unary();
    while (peek()?.k === "o" && ((peek() as { v: string }).v === "*" || (peek() as { v: string }).v === "/")) {
      const op = (t[i++] as { v: string }).v, l = a, r = unary();
      a = op === "*" ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
    }
    return a;
  };
  const unary = (): Fn => {
    if (peek()?.k === "o" && (peek() as { v: string }).v === "-") { i++; const a = unary(); return (x) => -a(x); }
    if (peek()?.k === "o" && (peek() as { v: string }).v === "+") { i++; return unary(); }
    return power();
  };
  const power = (): Fn => {
    const b = atom();
    if (peek()?.k === "o" && (peek() as { v: string }).v === "^") {
      i++;
      const e = unary();
      // جذر فردي لعدد سالب: x^(1/3) يرسم الجهة السالبة هم
      return (x) => { const bv = b(x), ev = e(x); if (bv < 0 && !Number.isInteger(ev)) { const q = Math.round(1 / ev); if (Math.abs(1 / ev - q) < 1e-9 && q % 2) return -Math.pow(-bv, ev); } return Math.pow(bv, ev); };
    }
    return b;
  };
  const atom = (): Fn => {
    const k = t[i++];
    if (!k) throw new Error("المعادلة ناقصة");
    if (k.k === "n") { const v = k.v; return () => v; }
    if (k.k === "x") return (x) => x;
    if (k.k === "(") { const a = expr(); if (t[i++]?.k !== ")") throw new Error("قوس ما مسدود"); return a; }
    if (k.k === "f") {
      const f = FUNCS[k.v];
      // sin x و sin(x) و sin^2 x
      let pw: number | null = null;
      if (peek()?.k === "o" && (peek() as { v: string }).v === "^" && t[i + 1]?.k === "n") { i++; pw = (t[i++] as { v: number }).v; }
      const a = peek()?.k === "(" ? atom() : power();
      return pw === null ? (x) => f(a(x)) : (x) => Math.pow(f(a(x)), pw!);
    }
    throw new Error("المعادلة مو مضبوطة");
  };
  const f = expr();
  if (i < t.length) throw new Error("المعادلة مو مضبوطة");
  return f;
}

export type PlotOut = {
  strokes: { p: number[]; w: number; axis: boolean }[];
  labels: { x: number; y: number; t: string; s: number }[];
};
/** يرسم بمربع box (وحدات السبورة). المحاور، التدريج، والمنحني مقطّع عند القفزات (الخطوط المقاربة) */
/** yRange: مدى y بيده (إذا ما حطه، يختاره وحده) */
export function plot(src: string, xmin: number, xmax: number, box: { x: number; y: number; w: number; h: number }, width = 5, yRange?: [number, number]): PlotOut {
  const f = parseFn(src);
  if (!(xmax > xmin)) throw new Error("لازم «إلى» أكبر من «من»");
  const N = 800, xs: number[] = [], ys: number[] = [];
  for (let k = 0; k <= N; k++) { const x = xmin + ((xmax - xmin) * k) / N; xs.push(x); ys.push(f(x)); }
  const ok = ys.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ok.length) throw new Error("الدالة ما إلها قيم بهالمجال");
  // مدى y: نشيل أطراف الخطوط المقاربة، ونخلي الصفر بالرسمة
  let ymin = ok[Math.floor(ok.length * 0.03)], ymax = ok[Math.ceil(ok.length * 0.97) - 1];
  ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0);
  if (ymax - ymin < 1e-9) { ymin -= 1; ymax += 1; }
  const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  if (yRange) { if (!(yRange[1] > yRange[0])) throw new Error("لازم y «إلى» أكبر من «من»"); [ymin, ymax] = yRange; }
  const X = (x: number) => box.x + ((x - xmin) / (xmax - xmin)) * box.w;
  const Y = (y: number) => box.y + box.h - ((y - ymin) / (ymax - ymin)) * box.h;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const strokes: PlotOut["strokes"] = [], labels: PlotOut["labels"] = [];
  // المحاور
  const ax = xmin <= 0 && xmax >= 0 ? X(0) : box.x, ay = Y(0);
  const aw = Math.max(2, width * 0.6);
  strokes.push({ p: [r1(box.x - 10), r1(ay), r1(box.x + box.w + 18), r1(ay)], w: aw, axis: true });
  strokes.push({ p: [r1(box.x + box.w + 18), r1(ay), r1(box.x + box.w + 4), r1(ay - 9)], w: aw, axis: true });
  strokes.push({ p: [r1(box.x + box.w + 18), r1(ay), r1(box.x + box.w + 4), r1(ay + 9)], w: aw, axis: true });
  strokes.push({ p: [r1(ax), r1(box.y + box.h + 10), r1(ax), r1(box.y - 18)], w: aw, axis: true });
  strokes.push({ p: [r1(ax), r1(box.y - 18), r1(ax - 9), r1(box.y - 4)], w: aw, axis: true });
  strokes.push({ p: [r1(ax), r1(box.y - 18), r1(ax + 9), r1(box.y - 4)], w: aw, axis: true });
  labels.push({ x: box.x + box.w + 30, y: ay - 14, t: "x", s: 34 }, { x: ax + 12, y: box.y - 40, t: "y", s: 34 });
  // التدريج: خطوة حلوة (1، 2، 5 × 10ⁿ)
  const nice = (span: number) => { const raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw)!; };
  // السالب يطلع «-4» مو «4-» (السبورة يمين لليسار): نعزله يسار لليمين
  const fmt = (v: number) => { const t = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); return v < 0 ? LTR + t + POP : t; };
  const sx = nice(xmax - xmin), sy = nice(ymax - ymin);
  for (let v = Math.ceil(xmin / sx) * sx; v <= xmax + 1e-9; v += sx) {
    if (Math.abs(v) < 1e-9) continue;
    strokes.push({ p: [r1(X(v)), r1(ay - 7), r1(X(v)), r1(ay + 7)], w: aw, axis: true });
    labels.push({ x: X(v) - 8, y: ay + 12, t: fmt(v), s: 24 });
  }
  for (let v = Math.ceil(ymin / sy) * sy; v <= ymax + 1e-9; v += sy) {
    if (Math.abs(v) < 1e-9) continue;
    strokes.push({ p: [r1(ax - 7), r1(Y(v)), r1(ax + 7), r1(Y(v))], w: aw, axis: true });
    labels.push({ x: ax - 14 - (fmt(v).length - (v < 0 ? 2 : 0)) * 13, y: Y(v) - 14, t: fmt(v), s: 24 });
  }
  // المنحني: ينقطع إذا طلع برا المربع أو قفز (خط مقارب)
  let seg: number[] = [];
  const flush = () => { if (seg.length >= 4) strokes.push({ p: seg, w: width, axis: false }); seg = []; };
  for (let k = 0; k <= N; k++) {
    const y = ys[k];
    if (!Number.isFinite(y) || y < ymin || y > ymax) { flush(); continue; }
    if (seg.length && k > 0 && Number.isFinite(ys[k - 1]) && Math.abs(Y(y) - seg[seg.length - 1]) > box.h * 0.5) flush();
    seg.push(r1(X(xs[k])), r1(Y(y)));
  }
  flush();
  return { strokes, labels };
}
