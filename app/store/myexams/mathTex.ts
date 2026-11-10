// رياضيات صفحة التصحيح: كتابة الطالب والملزمة تصير LaTeX، وKaTeX يرسمها.
// إذا KaTeX ما گدر يقرا السطر (مثلاً $ بنص الرياضيات، أو \frac(a)(b))، السطر ينكتب نص عادي بلونه، مو مصدر أحمر
import katex from "katex";

/** كتابة الطالب أو الملزمة (x^2 ، sqrt(3) ، 3/(2x)) تصير LaTeX، والكسر بخط أفقي مثل ما ينكتب باليد */
const OPERAND = String.raw`(\((?:[^()]|\([^()]*\))*\)|\\sqrt\{[^{}]*\}|\\frac\{[^{}]*\}\{[^{}]*\}|[A-Za-z0-9.]+)`;
const unwrap = (x: string) => (x.startsWith("(") && x.endsWith(")") ? x.slice(1, -1) : x);

/** القوس اللي يبدي عند s[i] = "(": اللي داخله ونهايته، أو null إذا ما ينسد */
function group(s: string, i: number): [string, number] | null {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) return [s.slice(i + 1, k), k + 1];
  }
  return null;
}

/** \frac(a)(b) ← \frac{a}{b}، \sqrt(a) ← \sqrt{a}، x^(2) ← x^{2}، x_(1) ← x_{1} */
export function braceArgs(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const frac = /^\\[dt]?frac\s*\(/.exec(s.slice(i));
    if (frac) {
      const a = group(s, i + frac[0].length - 1);
      if (a) {
        let j = a[1];
        while (s[j] === " ") j++;
        const b = s[j] === "(" ? group(s, j) : null;
        if (b) { out += `\\frac{${braceArgs(a[0])}}{${braceArgs(b[0])}}`; i = b[1]; continue; }
      }
    }
    const arg = /^(\\sqrt|\^|_)\s*\(/.exec(s.slice(i));
    if (arg) {
      const g = group(s, i + arg[0].length - 1);
      if (g) { out += `${arg[1]}{${braceArgs(g[0])}}`; i = g[1]; continue; }
    }
    out += s[i++];
  }
  return out;
}

/** فواصل الرياضيات ($ و \( \) و \[ \]) تنشال: KaTeX يرسم الرياضيات بدونها، وما يقبل $ بداخلها */
export const stripDelimiters = (s: string) => s.replace(/\$+|\\\(|\\\)|\\\[|\\\]/g, " ").replace(/\s{2,}/g, " ").trim();

export function toTex(p: string) {
  let t = braceArgs(stripDelimiters(p)).replace(/sqrt\(([^()]*)\)/g, "\\sqrt{$1}").replace(/√\s*\(([^()]*)\)/g, "\\sqrt{$1}").replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}")
    .replace(/=>|⇒|⟹/g, "\\Rightarrow ").replace(/->|→/g, "\\to ").replace(/∓/g, "\\mp ").replace(/±/g, "\\pm ").replace(/−/g, "-").replace(/×/g, "\\times ");
  const re = new RegExp(`${OPERAND}\\s*/\\s*${OPERAND}`);
  for (let i = 0; i < 12 && re.test(t); i++) t = t.replace(re, (_, x: string, y: string) => `\\frac{${unwrap(x)}}{${unwrap(y)}}`);
  return t;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** HTML الرياضيات، أو null إذا KaTeX ما يگدر يقراها */
export function renderTex(p: string): string | null {
  try { return katex.renderToString(toTex(p), { throwOnError: true, strict: false, output: "html" }); } catch { return null; }
}

const ARROWS = /\s*(?:=>|⇒|⟹|->|→|\\Rightarrow|\\to)\s*/;
/** كل سطر بالخطوة ينرسم؟ (السطر اللي بيه كلام عربي ينكتب نص، فينحسب ماشي) */
export function canRender(text: string): boolean {
  return String(text ?? "").split(/\s*;\s*/).filter(Boolean).every((line) =>
    /[؀-ۿ]/.test(line) || line.split(ARROWS).filter((x) => x.trim()).every((x) => renderTex(x) !== null));
}

/** الرياضيات مرسومة، وإذا ما انقرت: نفس الكتابة نص عادي (بدون $، ومحمية من HTML) */
export const mathHtml = (p: string) => renderTex(p) ?? `<span class="aiplain">${escapeHtml(stripDelimiters(p))}</span>`;
