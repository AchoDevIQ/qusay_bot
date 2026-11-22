// «📄 ارفع ملف» بعبارات الموضوع (طلب الأستاذ 2026-11-22): الفويس ينكتب بغلطات والمعادلات ما تنعدل على الآيباد،
// فيكتب شرحه بالـ Word (محرر المعادلات) ويرفعه. الـ Word ينقرا ببلاش، والمعادلات تتحول لكتابة الموبايل (x² ، 3/x²)
// حتى تنقرا بالمربع وتنعدل. الـ PDF والصورة يقراها الذكاء حرف بحرف (qusayGrade.ts: readNotesScan)
import { docxLines } from "./docxText.ts";

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "n": "ⁿ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const CMD: Record<string, string> = {
  pm: "±", mp: "∓", times: "×", div: "÷", neq: "≠", ne: "≠", le: "≤", leq: "≤", ge: "≥", geq: "≥", infty: "∞", pi: "π", theta: "θ", omega: "ω",
  alpha: "α", beta: "β", backslash: "\\", setminus: "\\", to: "→", rightarrow: "→", Rightarrow: "⇒", therefore: "∴", in: "∈", cdot: "·", approx: "≈", ",": " ", ";": " ", quad: " ", " ": " ",
  "{": "{", "}": "}",
};
/** المقطع يحتاج قوس إذا صار بسط/مقام لو قبل أس: أكثر من رمز واحد وما محاط بقوس */
const simple = (x: string) => /^-?[A-Za-z0-9.πθ⁰-⁹²³¹ⁿ⁻]+$/.test(x) || /^\((?:[^()]|\([^()]*\))*\)[⁰-⁹²³¹ⁿ⁻]*$/.test(x);
const wrap = (x: string) => (simple(x) ? x : `(${x})`);
const raise = (x: string, map: Record<string, string>, mark: string) => (/^['′″]+$/.test(x) ? x : [...x].every((c) => map[c]) ? [...x].map((c) => map[c]).join("") : `${mark}${wrap(x)}`);

/** LaTeX (من معادلات Word) → كتابة الموبايل: \frac{3}{x^{2}} → 3/x² ، \sqrt{x+1} → √(x+1) */
export function texToPhone(tex: string): string {
  let i = 0;
  const s = tex;
  const group = (): string => {
    while (s[i] === " ") i++;
    if (s[i] === "{") {
      let d = 0; const st = ++i;
      for (; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") d++; else if (s[i] === "}") { if (d-- === 0) break; } }
      const inner = s.slice(st, i); i++;
      return texToPhone(inner);
    }
    if (s[i] === "\\") { const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i)); i += m ? m[0].length : 1; return m ? CMD[m[1]] ?? m[1] : ""; }
    return s[i++] ?? "";
  };
  let out = "";
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))!;
      i += m[0].length;
      const k = m[1];
      if (k === "frac" || k === "dfrac" || k === "tfrac") { const a = group(), b = group(); out += `${wrap(a)}/${wrap(b)}`; }
      else if (k === "sqrt") {
        let n = "";
        if (s[i] === "[") { const e = s.indexOf("]", i); n = texToPhone(s.slice(i + 1, e)); i = e + 1; }
        out += (n ? raise(n, SUP, "^") : "") + `√(${group()})`;
      }
      else if (k === "left" || k === "right") { const g = group(); out += g === "." ? "" : g; }
      else if (k === "\\") out += "، ";
      else if (k === "begin" || k === "end") group();
      else if (k === "overline" || k === "text" || k === "mathrm" || k === "operatorname") out += group();
      else out += CMD[k] ?? k + (/^[A-Za-z{]/.test(s[i] ?? "") ? " " : "");
    } else if (c === "^") { i++; out = out.replace(/\s+$/, ""); out += raise(group(), SUP, "^"); }
    else if (c === "_") { i++; out += raise(group(), SUB, "_"); }
    else if (c === "{") {
      const g = group();
      let j = i; while (s[j] === " ") j++;
      out += s[j] === "^" ? wrap(g) : g;
    }
    else if (c === "}") i++;
    else if (c === "&") { out += " "; i++; }
    else { out += c; i++; }
  }
  // R ما عدا 0: «R\{0}» مثل ما يكتبها بالـ Word (الـ «\» والقوس سوة)
  return out.replace(/\s*\\\s*\{/g, "\\{").replace(/[ \t]+/g, " ").trim();
}

/** سطر من الـ Word: المعادلات بين $ $ والأس المرفوع ^{..} يصيرن كتابة موبايل */
export const lineToPhone = (l: string) => l.replace(/\$([^$]+)\$/g, (_, m) => texToPhone(m)).replace(/[\^_]\{[^{}]*\}/g, (m) => texToPhone(m)).replace(/[ \t]+/g, " ").trim();

/** ملف Word → نص العبارات، كل فقرة بسطر */
export function docxNotes(buf: Buffer): string {
  const lines = docxLines(buf).map(lineToPhone).filter(Boolean);
  if (!lines.length) throw new Error("الملف ما بيه كلام");
  return lines.join("\n");
}

/** نوع الملف من اسمه */
export function notesKind(name: string): "docx" | "pdf" | "image" | null {
  const n = name.toLowerCase();
  return n.endsWith(".docx") ? "docx" : n.endsWith(".pdf") ? "pdf" : /\.(jpe?g|png|webp)$/.test(n) ? "image" : null;
}
