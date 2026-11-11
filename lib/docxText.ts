// قراءة ملزمة Word (docx): الفقرات بالترتيب، والمعادلات (محرر معادلات Word) تتحول لـ LaTeX بين $ $.
// الرقم المرفوع بتنسيق النص يصير ^{..}، والرسوم اللي Word يخزنها مرتين (نسخة قديمة احتياط) تنشال حتى ما يتكرر الكلام
import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

/** ملف واحد من داخل الـ zip (الـ docx هو zip) */
export function unzipEntry(zip: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("مو ملف Word (docx)");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= zip.length; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32), off = zip.readUInt32LE(p + 42);
    const fname = zip.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (fname === name) {
      const start = off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28);
      const data = zip.subarray(start, start + csize);
      return method === 8 ? inflateRawSync(data) : method === 0 ? Buffer.from(data) : null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

type Node = Record<string, unknown>;
const tagOf = (n: Node) => Object.keys(n).find((k) => k !== ":@") ?? "";
const kids = (n: Node): Node[] => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as Node[]) : []);
const attr = (n: Node, a: string) => ((n[":@"] as Record<string, string> | undefined) ?? {})[`@_${a}`];
const find = (n: Node, t: string) => kids(n).find((k) => tagOf(k) === t);
const textIn = (n: Node): string => kids(n).map((k) => (tagOf(k) === "#text" ? String(k["#text"] ?? "") : textIn(k))).join("");

const SYM: Record<string, string> = { "±": "\\pm ", "∓": "\\mp ", "×": "\\times ", "÷": "\\div ", "≠": "\\neq ", "≤": "\\le ", "≥": "\\ge ", "∞": "\\infty ", "π": "\\pi ", "θ": "\\theta ", "ω": "\\omega ", "α": "\\alpha ", "β": "\\beta ", "→": "\\to ", "⇒": "\\Rightarrow ", "⟹": "\\Rightarrow ", "∴": "\\therefore ", "−": "-", "∈": "\\in " };
const sym = (t: string) => [...t].map((c) => SYM[c] ?? c).join("");

/** معادلة Word (OMML) → LaTeX */
function omml(n: Node): string {
  const t = tagOf(n).replace(/^m:/, "");
  const sub = (name: string) => { const e = find(n, `m:${name}`); return e ? all(e) : ""; };
  switch (t) {
    case "#text": return "";
    case "r": return kids(n).filter((k) => tagOf(k) === "m:t").map((k) => sym(textIn(k))).join("");
    case "sSup": return `{${sub("e")}}^{${sub("sup")}}`;
    case "sSub": return `{${sub("e")}}_{${sub("sub")}}`;
    case "sSubSup": return `{${sub("e")}}_{${sub("sub")}}^{${sub("sup")}}`;
    case "f": return `\\frac{${sub("num")}}{${sub("den")}}`;
    case "rad": { const d = sub("deg"); return (d.trim() ? `\\sqrt[${d}]{` : "\\sqrt{") + sub("e") + "}"; }
    case "d": {
      const pr = find(n, "m:dPr");
      const beg = pr && find(pr, "m:begChr") ? attr(find(pr, "m:begChr")!, "m:val") ?? "" : "(";
      const end = pr && find(pr, "m:endChr") ? attr(find(pr, "m:endChr")!, "m:val") ?? "" : ")";
      const inner = kids(n).filter((k) => tagOf(k) === "m:e").map(all).join(",");
      const br = (c: string) => (c === "{" ? "\\{" : c === "}" ? "\\}" : c || ".");
      return `\\left${br(beg)}${inner}\\right${br(end)}`;
    }
    case "nary": {
      const pr = find(n, "m:naryPr"); const c = pr && find(pr, "m:chr") ? attr(find(pr, "m:chr")!, "m:val") : "∫";
      return ({ "∑": "\\sum", "∏": "\\prod" } as Record<string, string>)[c ?? ""] ?? "\\int" + `_{${sub("sub")}}^{${sub("sup")}}${sub("e")}`;
    }
    case "func": return `${sub("fName")} ${sub("e")}`;
    case "bar": return `\\overline{${sub("e")}}`;
    case "limLow": return `${sub("e")}_{${sub("lim")}}`;
    case "limUpp": return `${sub("e")}^{${sub("lim")}}`;
    case "eqArr": return kids(n).filter((k) => tagOf(k) === "m:e").map(all).join(" \\\\ ");
    case "m": return "\\begin{matrix}" + kids(n).filter((k) => tagOf(k) === "m:mr").map((r) => kids(r).filter((k) => tagOf(k) === "m:e").map(all).join(" & ")).join(" \\\\ ") + "\\end{matrix}";
    case "box": case "borderBox": case "groupChr": case "phant": case "acc": return sub("e");
    default: return t.endsWith("Pr") ? "" : all(n);
  }
}
const all = (n: Node) => kids(n).map(omml).join("");

/** نص الفقرة: الكلام، والأس المرفوع، والمعادلات بين $ $ */
function para(n: Node): string {
  let out = "";
  for (const k of kids(n)) {
    const t = tagOf(k);
    if (t === "w:r") {
      const pr = find(k, "w:rPr"); const va = pr && find(pr, "w:vertAlign") ? attr(find(pr, "w:vertAlign")!, "w:val") : "";
      for (const x of kids(k)) {
        const xt = tagOf(x);
        if (xt === "w:t") { const s = textIn(x); out += va === "superscript" ? `^{${s}}` : va === "subscript" ? `_{${s}}` : s; }
        else if (xt === "w:tab") out += " ";
        else if (xt === "w:br") out += "\n";
      }
    } else if (t === "m:oMath") out += ` $${all(k).trim()}$ `;
    else if (t === "m:oMathPara") for (const om of kids(k).filter((z) => tagOf(z) === "m:oMath")) out += ` $${all(om).trim()}$ `;
    else if (["w:hyperlink", "w:smartTag", "w:ins", "w:sdt", "w:sdtContent"].includes(t)) out += para(k);
  }
  return out;
}

/** كل فقرات الملزمة بالترتيب، وكل فقرة سطر */
export function docxLines(docx: Buffer): string[] {
  const xml = unzipEntry(docx, "word/document.xml");
  if (!xml) throw new Error("ما لگيت نص الملزمة داخل الملف");
  const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, processEntities: true, parseTagValue: false, parseAttributeValue: false }).parse(xml.toString("utf8")) as Node[];
  const lines: string[] = [];
  const walk = (list: Node[]) => {
    for (const n of list) {
      const t = tagOf(n);
      if (t === "mc:Fallback") continue;
      if (t === "w:p") {
        const s = para(n).replace(/[ \t]+/g, " ").trim();
        if (s) lines.push(s);
        // مربعات النص داخل الفقرة (الرسوم) تنقرا بعدها
        walk(kids(n).filter((k) => tagOf(k) !== "w:r" || !!find(k, "mc:AlternateContent") || !!find(k, "w:drawing") || !!find(k, "w:pict")));
      } else walk(kids(n));
    }
  };
  walk(tree);
  return lines;
}
