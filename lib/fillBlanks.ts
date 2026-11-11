// «املأ الفراغات»: بدل ما الطالب يرتب كل كلمات الجملة، الجملة تبقى كاملة قدامه وبيها كم فراغ،
// وكل فراغ يختارله الكلمة الصحيحة من 3 اختيارات. هيچ يقراها كلها حتى يعرف الكلمة الناقصة.

export type Blank = { i: number; pre: string; answer: string; post: string; options: string[] };
export type Part = string | Blank;

// علامات الترقيم تبقى برا الفراغ: «الأول،» ← الفراغ «الأول» وبعده «،»
const EDGE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const SPARE = ["الثاني", "غير", "فقط", "دائماً", "بعد", "قبل", "كل", "مجاناً"];

function shuffle<T>(a: T[], rnd: () => number) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** كم فراغ: جملة قصيرة فراغين، وكل ما تطول يزيد لحد 5 */
export const blankCount = (words: number) => (words < 4 ? 0 : Math.min(5, Math.max(2, Math.round(words / 7))));

/**
 * يقسم الجملة: نص عادي، وفراغات. الفراغات كلمات واضحة (3 حروف أو أكثر، مو أرقام، وما تتكرر بالجملة)،
 * متوزعة على طول الجملة حتى يقراها كلها. rnd للاختبار.
 */
export function makeBlanks(text: string, rnd: () => number = Math.random): Part[] {
  const tokens = text.split(/(\s+)/);
  const core = (t: string) => EDGE.exec(t)![2];
  const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
  const words = tokens.filter(isWord);
  const count = new Map<string, number>();
  for (const w of words) count.set(core(w), (count.get(core(w)) ?? 0) + 1);
  const cands = tokens.map((t, i) => ({ t, i })).filter(({ t }) => {
    const c = core(t);
    return isWord(t) && [...c].filter((ch) => /\p{L}/u.test(ch)).length >= 3 && !/\d/.test(c) && count.get(c) === 1;
  });
  const k = Math.min(blankCount(words.length), cands.length);
  // كل فراغ من قطعة من الجملة، حتى ما يتجمعون بمكان واحد
  const chosen = new Set<number>();
  for (let s = 0; s < k; s++) {
    const from = Math.floor((s * cands.length) / k), to = Math.floor(((s + 1) * cands.length) / k);
    chosen.add(cands[from + Math.floor(rnd() * Math.max(1, to - from))].i);
  }
  const pool = [...new Set(cands.map(({ t }) => core(t)))];
  return tokens.map((t, i) => {
    if (!chosen.has(i)) return t;
    const [, pre, answer, post] = EDGE.exec(t)!;
    const others = shuffle(pool.filter((w) => w !== answer), rnd);
    const spare = shuffle(SPARE.filter((w) => w !== answer && !others.includes(w)), rnd);
    const options = shuffle([answer, ...[...others, ...spare].slice(0, 2)], rnd);
    return { i, pre, answer, post, options };
  });
}
