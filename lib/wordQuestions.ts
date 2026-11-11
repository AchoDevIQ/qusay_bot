// أسئلة الامتحانات من ملفات الوورد: كل ملف فصل (عربي أو إنجليزي) يتقسم لنسخ، وكل نسخة أسئلة،
// وبعدها تنطابق ويا نسخ البنك بالترتيب. الملفات مو كلها بيها عناوين (الفصل الثالث والخامس بلا عناوين)،
// فالنسخة تبدي من «س 1» (أو Q1)، والمطابقة بعدد الأسئلة، وتتحمل نسخة زايدة أو ناقصة بالملف.

export type WordBlock = { head: string[]; model: string | null; qs: { n: number; text: string }[]; odd: boolean };

const QRE = /^\s*[‎‏‪-‮]*\s*(?:س|Q)\s*(\d+)\s*[/\\:\-–]?\s*/i;
const HEAD = /نموذج|Model|^الامتحان\s*\{|^Exam\s*\{/i;

/** سطور الوورد (من docxLines) ← نسخ */
export function splitExamDoc(lines: string[]): WordBlock[] {
  const out: WordBlock[] = [];
  let cur: WordBlock | null = null, head: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const m = QRE.exec(l);
    if (m) {
      const n = Number(m[1]);
      if (!cur || n === 1 || head.length) { cur = { head, model: modelOf(head), qs: [], odd: false }; out.push(cur); head = []; }
      cur.qs.push({ n, text: l.slice(m[0].length).trim() });
    } else if (HEAD.test(l) || !cur) head.push(l);
    // سطر بعد السؤال (مثل «1 / ...» أو معادلة بسطر وحده) يكمل نفس السؤال
    else if (cur.qs.length && !head.length) cur.qs[cur.qs.length - 1].text += "\n" + l;
    else head.push(l);
  }
  for (const b of out) b.odd = b.qs.some((q, i) => q.n !== i + 1);
  return out;
}
/** حرف النسخة من العنوان: «نموذج A» أو «Model B» أو «{1 & 2} C _» */
function modelOf(head: string[]): string | null {
  for (const h of head) {
    const m = /(?:نموذج|Model)\s*([A-Z])\b/i.exec(h) ?? /\}\s*([A-Z])\s*_/.exec(h);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export type Sig = { n: number; model: string | null };
/**
 * نسخ البنك بالترتيب ← نسخ الملف بالترتيب: مطابقة (مثل diff) تفضّل نفس عدد الأسئلة ونفس حرف النسخة،
 * وتتخطى نسخة زايدة بالملف أو ناقصة منه. حرف النسخة (إذا الملف كاتبه) يثبت كل نسخة بمكانها،
 * حتى نسخة ناقصة ما تزحلق الأسئلة على امتحان ثاني. يرجع لكل نسخة بالبنك رقم النسخة بالملف أو -1
 */
export function alignBlocks(bank: Sig[], word: Sig[], extra?: (i: number, j: number) => number): number[] {
  const n = bank.length, m = word.length;
  const SKIP = -1;
  const memo = new Map<number, number>();
  const pairAt = (i: number, j: number) => {
    const k = i * (m + 1) + j;
    if (!memo.has(k)) {
      const a = bank[i], b = word[j];
      const sameModel = a.model && b.model ? (a.model === b.model ? 3 : -4) : 0;
      memo.set(k, (a.n === b.n ? 3 : -2) + sameModel + (extra ? extra(i, j) : 0));
    }
    return memo.get(k)!;
  };
  const sc: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i + j) * SKIP));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    sc[i][j] = Math.max(sc[i - 1][j - 1] + pairAt(i - 1, j - 1), sc[i - 1][j] + SKIP, sc[i][j - 1] + SKIP);
  }
  const res = Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (sc[i][j] === sc[i - 1][j - 1] + pairAt(i - 1, j - 1)) { res[i - 1] = j - 1; i--; j--; }
    else if (sc[i][j] === sc[i - 1][j] + SKIP) i--;
    else j--;
  }
  return res;
}

/** أرقام ورموز المعادلات بالنص: نفسها بالعربي والإنجليزي، فتدل على نفس النسخة */
export function mathTokens(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?|\\[a-z]+|[a-zA-Z](?=[\^_{(])/g) ?? []).filter((t) => t !== "1" && t !== "2");
}
/** تشابه نسختين بأرقام معادلاتهن (0 لـ 1) */
export function sameMath(a: string, b: string): number {
  const x = mathTokens(a), y = mathTokens(b);
  if (!x.length || !y.length) return 0;
  const bag = new Map<string, number>();
  for (const t of y) bag.set(t, (bag.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of x) { const c = bag.get(t) ?? 0; if (c) { common++; bag.set(t, c - 1); } }
  return (2 * common) / (x.length + y.length);
}
export const blockText = (b: WordBlock) => b.qs.map((q) => q.text).join("\n");
