// 📍 المحاضرة اللي وصلها الطالب تنتقل بين ملازم نفس الفصل: إذا كان بالكتاب على «Square roots · المحاضرة 2»
// ويفتح الوزارية أو الإثرائية أو الراصد، تنفتح وحدها على نفس الموضوع ونفس المحاضرة. وهو يقدر يقلب لغيرها براحته.
// كل ملزمة تكتب المحاضرات بطريقة: الكتاب «Square roots lecturer 1»، الوزارية «Square roots · Lecture 1»،
// والراصد بس اسم الموضوع. فنقرا فهرس كل وحدة (📑 المواضيع) ونربط المواضيع بأسمائها، واللي ما ينطابق اسمه
// (مثل «De Movier’s» و«De Moivre's Theorem») ينربط بمكانه بين المواضيع اللي انطابقت
import type { TocItem } from "./noteToc.ts";

/** مكان بالملزمة: من هاي الصفحة يبدي هذا الموضوع وهاي المحاضرة (0 = الموضوع كله، مثل الراصد) */
export type Spot = { p: number; topic: string; lec: number };
export type Group = { name: string; spots: Spot[] };

const ORD: Record<string, number> = {
  "الأولى": 1, "الاولى": 1, "الأول": 1, "الاول": 1, "الثانية": 2, "الثانيه": 2, "الثاني": 2, "الثالثة": 3, "الثالثه": 3, "الثالث": 3,
  "الرابعة": 4, "الرابعه": 4, "الرابع": 4, "الخامسة": 5, "الخامسه": 5, "الخامس": 5, "السادسة": 6, "السادسه": 6, "السادس": 6,
  "السابعة": 7, "السابعه": 7, "السابع": 7, "الثامنة": 8, "الثامنه": 8, "الثامن": 8, "التاسعة": 9, "التاسعه": 9, "التاسع": 9,
  "العاشرة": 10, "العاشره": 10, "العاشر": 10,
};
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** رقم المحاضرة: 3 أو ٣ أو «الثالثة» */
export function lectureNo(s: string): number {
  const t = s.trim().replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[()\[\]]/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return ORD[t] ?? 0;
}
const LEC = /^(.*?)\s*(?:·\s*)?(?:lectur\w*|المحاضر[ةه])\s*[(\[]?\s*([0-9٠-٩]+|[؀-ۿ]+)\s*[)\]]?\s*$/i;

/** «Square roots · Lecture 2» ← الموضوع ورقم المحاضرة. null إذا العنوان مو محاضرة */
export function parseLecture(title: string): { topic: string; lec: number } | null {
  const m = LEC.exec(title.trim());
  if (!m) return null;
  const lec = lectureNo(m[2]);
  return lec ? { topic: m[1].replace(/[\s·:\-\[(]+$/, "").replace(/\s+/g, " ").trim(), lec } : null;
}

/** فهرس الملزمة ← مواضيعها بالترتيب، وكل موضوع ومحاضراته ويا صفحة بدايتها */
export function groupsOf(toc: TocItem[]): Group[] {
  const spots: Spot[] = [];
  for (const t of toc) {
    const own = parseLecture(t.t);
    if (own) { spots.push({ p: t.p, ...own }); continue; }
    const lectures = (t.items ?? []).map((l) => ({ l, x: parseLecture(l.t) })).filter((y) => y.x);
    if (!lectures.length) { spots.push({ p: t.p, topic: t.t, lec: 0 }); continue; }
    if (lectures[0].l.p > t.p) spots.push({ p: t.p, topic: t.t, lec: 0 });
    // «Lecture 2» تحت موضوعه: الاسم من الموضوع
    for (const { l, x } of lectures) spots.push({ p: l.p, topic: x!.topic || t.t, lec: x!.lec });
  }
  spots.sort((a, b) => a.p - b.p);
  const out: Group[] = [];
  for (const s of spots) {
    const g = out[out.length - 1];
    const last = g?.spots[g.spots.length - 1];
    // موضوع جديد: اسم ثاني، أو الترقيم رجع يبدي من جديد
    const named = key(s.topic);
    if (g && (!named || named === key(g.name)) && !(s.lec && last && last.lec && s.lec <= last.lec)) { g.spots.push(s); if (!g.name) g.name = s.topic; }
    else out.push({ name: s.topic, spots: [s] });
  }
  // نفس الموضوع مكتوب بأشكال («الاساسيات» و«اسا سيات») وترقيمه يكمل: موضوع واحد
  for (let i = out.length - 1; i > 0; i--) if (key(out[i].name) && key(out[i].name) === key(out[i - 1].name)) { out[i - 1].spots.push(...out[i].spots); out.splice(i, 1); }
  return out;
}

const STOP = new Set(["of", "the", "a", "an", "and", "one", "in", "for", "theorem", "في", "من", "و"]);
function words(s: string) {
  return new Set(s.toLowerCase().replace(/[’'`]s\b/g, "").replace(/[^a-z؀-ۿω0-9]+/g, " ").split(" ")
    .map((w) => w.replace(/^ال(?=\S{3})/, "").replace(/(?<=[a-z]{3})s$/, "")).filter((w) => w && !STOP.has(w)));
}
/** الاسم بلا فراغات ولا «ال»: «اسا سيات» = «الاساسيات» */
export const key = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿω0-9]+/g, "").replace(/^ال/, "").replace(/s$/, "");
/** قرب اسمين لموضوع (0 لـ 1) */
export function nameScore(a: string, b: string) {
  if (key(a) && key(a) === key(b)) return 1;
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** كل موضوع بالملزمة الأولى ← رقم موضوعه بالثانية (أو -1). المطابقة بالاسم، والباقي بمكانه بين المطابقين */
export function pairGroups(a: Group[], b: Group[]): number[] {
  const to = a.map(() => -1);
  // المطابقة بالاسم: كل واحد أقرب اسم للثاني من الجهتين، («قبل x & y» ما ياخذ «x, y» من «x,y»)، وبالترتيب
  const best = (g: Group, list: Group[]) => { let k = -1, sc = 0.5 - 1e-9; list.forEach((h, j) => { const s = nameScore(g.name, h.name); if (s > sc) { sc = s; k = j; } }); return k; };
  const pairs = a.map((g, i) => { const j = best(g, b); return j >= 0 && best(b[j], a) === i ? j : -1; });
  // أطول تسلسل مرتب (اللي يعاكس الترتيب ينشال)
  const idx = pairs.map((j, i) => [i, j]).filter(([, j]) => j >= 0);
  const len = idx.map(() => 1), prev = idx.map(() => -1);
  idx.forEach(([, j], x) => { for (let y = 0; y < x; y++) if (idx[y][1] < j && len[y] + 1 > len[x]) { len[x] = len[y] + 1; prev[x] = y; } });
  let at = len.length ? len.indexOf(Math.max(...len)) : -1;
  while (at >= 0) { to[idx[at][0]] = idx[at][1]; at = prev[at]; }
  // اللي بين موضوعين مطابقين: بالترتيب، من جهة الموضوع اللي بعده (أول موضوع بالفصل غالباً ما عليه اسم)
  let i = 0;
  while (i < a.length) {
    if (to[i] >= 0) { i++; continue; }
    let k = i; while (k < a.length && to[k] < 0) k++;
    const lo = i ? to[i - 1] + 1 : 0, hi = k < a.length ? to[k] : b.length;
    for (let s = k - 1, t = hi - 1; s >= i && t >= lo; s--, t--) to[s] = t;
    // الزايد ينحسب على أول موضوع بنفس الفراغ
    for (let s = i; s < k; s++) if (to[s] < 0 && hi > lo) to[s] = lo;
    i = k;
  }
  return to;
}

function where(groups: Group[], page: number) {
  for (let g = groups.length - 1; g >= 0; g--)
    for (let s = groups[g].spots.length - 1; s >= 0; s--)
      if (groups[g].spots[s].p <= page) return { g, s };
  return null;
}

/** الطالب بصفحة page من الملزمة الأولى: بيا صفحة تنفتح الثانية؟ ويا وصف المكان (للرسالة). null إذا ما ينعرف */
export function matchPage(fromToc: TocItem[], page: number, toToc: TocItem[]): { page: number; label: string; g: number; lec: number } | null {
  const a = groupsOf(fromToc), b = groupsOf(toToc);
  const at = where(a, page);
  if (!at || !b.length) return null;
  const g = pairGroups(a, b)[at.g];
  if (g < 0) return null;
  const lec = a[at.g].spots[at.s].lec;
  const spots = b[g].spots;
  // نفس المحاضرة، وإذا ما موجودة بهاي الملزمة فأقرب محاضرة إلها، وإلا بداية الموضوع
  const withLec = spots.filter((s) => s.lec);
  let pick = spots[0];
  if (lec && withLec.length) pick = withLec.reduce((x, y) => (Math.abs(y.lec - lec) < Math.abs(x.lec - lec) ? y : x));
  // الوصف مال المكان اللي انفتحت عليه: الراصد بلا محاضرات، فبس الموضوع
  const name = b[g].name || a[at.g].name;
  return { page: pick.p, label: [name, pick.lec ? `المحاضرة ${pick.lec}` : ""].filter(Boolean).join(" · "), g, lec: pick.lec };
}

/** نفس المحاضرة؟ حتى إذا علامته بهاي الملزمة جوة نفس المحاضرة تنفتح على علامته هو (أدق) */
export function sameSpot(toc: TocItem[], p1: number, p2: number) {
  const gs = groupsOf(toc);
  const a = where(gs, p1), b = where(gs, p2);
  return !!a && !!b && a.g === b.g && a.s === b.s;
}
