// 🔢 نفس القيمة بشكل ثاني (طلب الأستاذ 2026-11-25): الذكاء خصم من طالب كاتب «6/4» والحل «3/2».
// الكود يحسب أرقام سطر الطالب الأخير وسطر الحل الأخير. إذا نفس القيم بالضبط بس مكتوبة بشكل ثاني، الخطوة ترجع كاملة.
// الحساب بالكود (مو بالذكاء)، فما يغلط ولا يكلف شي

/** LaTeX أو كتابة الموبايل → نص بسيط ينحسب: \frac{a}{b} → ((a)/(b))، \sqrt{x} → sqrt(x)، π → pi */
function plain(src: string): string {
  let s = String(src ?? "").replace(/\$/g, " ").replace(/\\left|\\right|\\displaystyle|\\,|\\;|\\!|\\quad/g, "").replace(/\\[dt]frac/g, "\\frac");
  // أقواس الـ LaTeX من الداخل للخارج
  for (let k = 0; k < 20; k++) {
    const before = s;
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))")
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "(($2)^(1/($1)))")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\^\s*\{([^{}]*)\}/g, "^($1)");
    if (s === before) break;
  }
  // باقي الأقواس المعقوفة (تجميع بس) بعد ما خلصت الكسور والجذور
  for (let k = 0; k < 20 && /\{[^{}]*\}/.test(s); k++) s = s.replace(/\{([^{}]*)\}/g, "($1)");
  const sup: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => sup[c]).join("")})`);
  return s.replace(/\\pi|π/g, "pi").replace(/\\cdot|\\times|×|·/g, "*").replace(/÷/g, "/").replace(/\\pm|±|\+-/g, "±")
    .replace(/√\s*\(/g, "sqrt(").replace(/√\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/[−–]/g, "-").replace(/٫/g, ".")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
}

/** يحسب تعبير أرقام بس (+ - * / ^ أقواس sqrt pi، والضرب بلا علامة مثل 2pi). null إذا بيه حرف ثاني */
export function evalNum(expr: string): number | null {
  const t = expr.replace(/\s+/g, "");
  if (!t || /[^0-9.+\-*/^()a-z]/.test(t) || /[a-z]/.test(t.replace(/sqrt|pi/g, ""))) return null;
  let i = 0;
  const peek = () => t[i];
  const num = (): number => {
    if (peek() === "(") { i++; const v = add(); if (peek() !== ")") throw 0; i++; return v; }
    if (t.startsWith("sqrt", i)) { i += 4; const v = atom(); return Math.sqrt(v); }
    if (t.startsWith("pi", i)) { i += 2; return Math.PI; }
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(t.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = (): number => { let v = num(); while (peek() === "^") { i++; v = v ** unary(); } return v; };
  const unary = (): number => (peek() === "-" ? (i++, -unary()) : peek() === "+" ? (i++, unary()) : atom());
  const mul = (): number => {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === "*") { i++; v *= unary(); }
      else if (c === "/") { i++; v /= unary(); }
      else if (c === "(" || (c && /[0-9.]/.test(c)) || t.startsWith("sqrt", i) || t.startsWith("pi", i)) v *= atom();   // 2pi ، 3sqrt(2)
      else return v;
    }
  };
  const add = (): number => { let v = mul(); for (;;) { if (peek() === "+") { i++; v += mul(); } else if (peek() === "-") { i++; v -= mul(); } else return v; } };
  try { const v = add(); return i === t.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

/** كل القيم بسطر: يتقسم على = و، و; و→ والكلام، و± تطلع قيمتين */
export function valuesOf(line: string): number[] {
  const s = plain(line);
  const out: number[] = [];
  for (const raw of s.split(/=|,|،|;|→|\\to|\\Rightarrow|\\therefore|[؀-ۿ]+|\b(?!sqrt|pi)[A-Za-z]+\b|\\[A-Za-z]+/)) {
    let c = (raw ?? "").trim();
    if (!c) continue;
    // قوس النقطة «(1» و«3/2)» بعد القسمة على الفارزة
    while (c.startsWith("(") && (c.match(/\(/g)?.length ?? 0) > (c.match(/\)/g)?.length ?? 0)) c = c.slice(1).trim();
    while (c.endsWith(")") && (c.match(/\)/g)?.length ?? 0) > (c.match(/\(/g)?.length ?? 0)) c = c.slice(0, -1).trim();
    if (!/\d|pi/.test(c)) continue;
    if (c.includes("±")) {
      const [a, b] = [evalNum(c.replace(/±/g, "+")), evalNum(c.replace(/±/g, "-"))];
      if (a === null || b === null) continue;
      out.push(a, b);
    } else { const v = evalNum(c); if (v !== null) out.push(v); }
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const lastLine = (t: string) => String(t ?? "").split(/\s;\s|;|\n/).map((x) => x.trim()).filter(Boolean).pop() ?? "";
const squash = (t: string) => plain(t).replace(/[\s()]/g, "");

/** سطر الطالب الأخير نفس قيم سطر الحل الأخير، بس بشكل ثاني (6/4 و3/2)؟ */
export function sameValueOtherForm(scheme: string, student: string): boolean {
  const a = lastLine(scheme), b = lastLine(student);
  if (!a || !b) return false;
  // بالترتيب (مو مرتبة): «x=2، y=3» مو نفس «x=3، y=2»
  const va = valuesOf(a), vb = valuesOf(b);
  if (!va.length || va.length > 6 || va.length !== vb.length) return false;
  if (!va.every((v, k) => close(v, vb[k]))) return false;
  // نفس الكتابة بالضبط: الخصم على شي ثاني (مو على الشكل)، فما نلمسه
  return squash(a) !== squash(b);
}

type StepLike = { text: string; points: number; awarded: number; note: string; w?: string; eq?: 1 };
/** خطوات انخصمت وجواب الطالب نفس القيمة بشكل ثاني: ترجع كاملة وبلا ملاحظة. يرجع عدد اللي رجعت */
export function restoreSameValues(steps: StepLike[]): number {
  let n = 0;
  for (const s of steps) {
    if (s.awarded >= s.points || !s.w || !sameValueOtherForm(s.text, s.w)) continue;
    s.awarded = s.points; s.note = ""; s.eq = 1; n++;
  }
  return n;
}
