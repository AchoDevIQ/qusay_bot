// أسئلة الامتحانات من ملفات الوورد: كل ملف فصل (عربي أو إنجليزي) يتقسم لنسخ، وكل نسخة أسئلة،
// وبعدها تنطابق ويا نسخ البنك بالترتيب. الملفات مو كلها بيها عناوين (الفصل الثالث والخامس بلا عناوين)،
// فالنسخة تبدي من «س 1» (أو Q1)، والمطابقة بعدد الأسئلة، وتتحمل نسخة زايدة أو ناقصة بالملف.

export type WordBlock = { head: string[]; model: string | null; qs: { n: number; text: string }[]; odd: boolean };

// «س 3 /» و«س /3» و«س3:» و«س1*/» و«س $4*$» و«Q 3 /»، وأحياناً قبلها معادلة فارغة «$$»، والأرقام عربية لو هندية
const QRE = /^\s*(?:\$\s*\$\s*)?[\u200e\u200f\u202a-\u202e]*\s*(?:س|Q)\s*\/?\s*\$?\s*([0-9\u0660-\u0669]+)\s*\*?\s*\$?\s*[/\\:\-–]?\s*/i;
// السطر اللي يبدي بمعادلة: الرقم ينكتب بآخره «… جد / س 4»
const QEND = /\s*\/?\s*(?:س|Q)\s*([0-9\u0660-\u0669]+)\s*$/i;
// \u0646\u0633\u062e\u0629 \u0623\u0633\u0626\u0644\u062a\u0647\u0627 \u0645\u0631\u0642\u0645\u0629 \u00ab1/ 2/ 3/\u00bb \u0628\u0644\u0627 \u00ab\u0633\u00bb \u0623\u0648 Q: \u062a\u0646\u0642\u0628\u0644 \u0628\u0633 \u0625\u0630\u0627 \u0623\u0648\u0644 \u0633\u0637\u0631 \u0628\u0639\u062f \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u00ab1/\u00bb\u060c
// \u0648\u0628\u0639\u062f\u0647\u0627 \u0643\u0644 \u0631\u0642\u0645 \u0644\u0627\u0632\u0645 \u064a\u0643\u0648\u0646 \u0627\u0644\u0644\u064a \u0628\u0639\u062f\u0647 \u0628\u0627\u0644\u062a\u0633\u0644\u0633\u0644\u060c \u0641\u0640\u00ab1/ 2/\u00bb \u062a\u062d\u062a \u0633\u0624\u0627\u0644 (\u0641\u0631\u0648\u0639\u0647) \u062a\u0628\u0642\u0649 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0633\u0624\u0627\u0644
const BARE = /^\s*[\u200e\u200f\u202a-\u202e]*\s*([0-9\u0660-\u0669]+)\s*\/\s*/;
const toNum = (d: string) => Number(d.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660)));
const HEAD = /نموذج|Model|^الامتحان\s*\{|^Exam\s*\{/i;

/** سطور الوورد (من docxLines) ← نسخ */
export function splitExamDoc(lines: string[]): WordBlock[] {
  const out: WordBlock[] = [];
  let cur: WordBlock | null = null, head: string[] = [], bare = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const end = QRE.test(l) ? null : QEND.exec(l);
    const m = end ? null : QRE.exec(l);
    let b = m || end ? null : BARE.exec(l);
    if (b) {
      const n = toNum(b[1]);
      const ok = head.length ? n === 1 : bare && !!cur?.qs.length && n === cur.qs[cur.qs.length - 1].n + 1;
      if (!ok) b = null;
    }
    if (m || end || b) {
      const n = toNum((m ?? end ?? b)![1]);
      if (!cur || n === 1 || head.length) { cur = { head, model: modelOf(head), qs: [], odd: false }; out.push(cur); head = []; bare = !!b; }
      const text = m || b ? l.slice((m ?? b)![0].length) : l.slice(0, end!.index);
      cur.qs.push({ n, text: text.replace(/^\s*[*/]+\s*/, "").trim() });
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
    // بالتعادل: نسخة البنك الأخيرة تبقى بلا مطابقة، حتى الملف ينطابق ويا الامتحانات اللي قبل
    // (مثلاً الفصل الثالث بالبوت بآخره الإعادة ونصف السنة، وفاينل الملف لازم يروح لفاينل الفصل)
    if (sc[i][j] === sc[i - 1][j] + SKIP) i--;
    else if (sc[i][j] === sc[i - 1][j - 1] + pairAt(i - 1, j - 1)) { res[i - 1] = j - 1; i--; j--; }
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
