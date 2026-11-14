// السؤال العلمي من «📝 الراصد» اللي بملازمي: إذا سؤال الطالب نفس سؤال بالراصد، يوصله «📘 الحل النموذجي» مال صفحته نفسها
// (الهيدر والسؤال كامل وحله، مثل ما يشوفه بالراصد)، ويا أزرار فيديو الحل والتوضيح إذا بيها. ببلاش، بلا ذكاء.
// نص صفحات الراصد (PDF) ينقرا مرة وحدة وينحفظ ويا الملف: الأرقام بيه سليمة، والكلام مكسر (الحروف المنقطة تنفصل)،
// فالمطابقة بالأرقام (نفس أرقام السؤال كلها) بنفس الموضوع، والكلام يتأكد بس
import { files } from "./files.ts";
import { pdfjsLib } from "./pdfjs.ts";
import { bookToc, type TocItem } from "./noteToc.ts";
import type { Row } from "./db.ts";

export type RasidPage = { page: number; topic: string; q: string; nums: string[]; loose: string };
const HEADER = 70;   // الهيدر بأعلى كل صفحة (اسم الراصد والموضوع ورقم السؤال)

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** أرقام السؤال كلها مرتبة (بدون «س 2» وبدون رقم الفرع «1 …»): بصمة السؤال */
export function numsOf(text: string): string[] {
  const s = text.normalize("NFKC").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/²/g, " 2 ").replace(/³/g, " 3 ")
    .split("\n").map((l) => l.replace(/^\s*(?:س|سؤال|Q)\s*\d+\s*[/:)\-]?/i, "").replace(/^\s*\(?\d{1,2}\)?\s*(?:…|\.{2,}|[/)\-])\s*/, "").replace(/(?:…|\.{2,})\s*\(?\d{1,2}\)?\s*$/, "")).join(" ")
    // طلبات السؤال «جد 1/ معدل… 2/ معدل…»: رقم الطلب مو من السؤال
    .replace(/(^|\s)\d{1,2}\s*\/\s*(?=[؀-ۿ])/g, " ");
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))).sort();
}
/** الكلام للمقارنة: بلا مسافات ولا ألف ولا همزات ولا تشكيل (نص الـ PDF يقلب «لا» و«ال» ويفصل الحروف) */
export function loose(s: string) {
  return s.normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[اأإآءؤئ]/g, "").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/گ/g, "ك").replace(/[^\p{L}]/gu, "").toLowerCase();
}

/** نص كل صفحة بالراصد (بدون الهيدر): الأسطر من فوك لجوة، وكل سطر من اليمين */
export async function pageTexts(pdf: Buffer): Promise<string[]> {
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const doc = await task.promise;
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const H = page.getViewport({ scale: 1 }).height;
      const items = ((await page.getTextContent()).items as any[]).filter((it) => String(it.str ?? "").trim())
        .map((it) => ({ s: String(it.str), x: Number(it.transform[4]), w: Number(it.width) || 0, y: H - Number(it.transform[5]), h: Number(it.height) || 10 })).filter((it) => it.y > HEADER);
      // السطر: الكتابة الكبيرة أول، والصغيرة (الأس ³ والنقاط المنفصلة) تنضم لأقرب سطر تحتها أو بمستواها
      // (حرف منفصل بلا عرض = نقطة أو ياء نهاية انفصلت). الفروع المخفية ممكن تكون 4 نقاط بس فوك الفرع الظاهر، فالسطر ضيق
      const small = (it: (typeof items)[number]) => it.h < 11 || it.w < 0.5;
      items.sort((a, b) => Number(small(a)) - Number(small(b)) || a.y - b.y);
      const lines: { y: number; it: typeof items }[] = [];
      for (const it of items) {
        let l: (typeof lines)[number] | undefined;
        if (!small(it)) l = lines.find((x) => Math.abs(x.y - it.y) <= 3);
        else {
          // الأس فوك السطر بحوالي 5 نقاط، والحرف المنفصل على السطر نفسه
          const aim = it.h < 11 && /^\d+$/.test(it.s.trim()) ? 5 : 0;
          l = lines.filter((x) => x.y - it.y >= -4 && x.y - it.y <= 8).sort((a, b) => Math.abs(a.y - it.y - aim) - Math.abs(b.y - it.y - aim))[0];
        }
        if (l) l.it.push(it); else lines.push({ y: it.y, it: [it] });
      }
      lines.sort((a, b) => a.y - b.y);
      // فروع جنب بعض بنفس السطر («1 … 2 …»): كل عمود سطر وحده، من الفراغ بينهم
      const rows: string[] = [];
      for (const l of lines) {
        const sorted = l.it.sort((a, b) => b.x - a.x);
        let cur: string[] = [], left = Infinity;
        for (const it of sorted) {
          if (cur.length && left - (it.x + it.w) > 28) { rows.push(cur.join(" ")); cur = []; }
          cur.push(it.s); left = Math.min(left, it.x);
        }
        if (cur.length) rows.push(cur.join(" "));
      }
      out.push(rows.join("\n"));
      page.cleanup();
    }
    return out;
  } finally { await task.destroy(); }
}
/** موضوع كل صفحة ورقم سؤالها من فهرس الراصد */
export function labels(toc: TocItem[], pages: number) {
  const out: { topic: string; q: string }[] = Array.from({ length: pages }, () => ({ topic: "", q: "" }));
  for (const t of toc) {
    if (t.p >= 1 && t.p <= pages && !out[t.p - 1].topic) out[t.p - 1].topic = t.t;
    for (const i of t.items ?? []) if (i.p >= 1 && i.p <= pages) { out[i.p - 1].q = i.t; out[i.p - 1].topic ||= t.t; }
  }
  // الصفحة بلا عنوان: موضوع وسؤال اللي گبلها (فرع ثاني من نفس السؤال)
  for (let i = 1; i < pages; i++) { out[i].topic ||= out[i - 1].topic; out[i].q ||= out[i - 1].q; }
  return out;
}
const QHEAD = /^\s*(?:س|Q)\s*(\d+)(?!\d)\s*\/?/i;
const branchOf = (l: string) => { const m = /^\s*\(?(\d{1,2})\)?\s*(?:…|\.{2,})/.exec(l) ?? /(?:…|\.{2,})\s*\(?(\d{1,2})\)?\s*$/.exec(l); return m ? Number(m[1]) : 0; };
/** نص سؤال الصفحة بس: صفحة الراصد نسخة من الملزمة، والأسئلة اللي حولها مخفية بس نصها باقي بالملف.
 *  من سطر «س N /» مال الصفحة لحد السؤال اللي بعده، وبصفحة الفرع: فرعها بس */
export function ownText(text: string, q: string, branch: number) {
  const n = /\d+/.exec(q)?.[0];
  const lines = text.split("\n");
  const start = n ? lines.findIndex((l) => QHEAD.exec(l)?.[1] === n) : -1;
  if (start < 0) return text;
  // أس أو دليل جذر بأول سطر يطلع فوكه بسطر وحده (أرقام بس): يبقى ويا السؤال
  const from = start > 0 && /^[\d\s]+$/.test(lines[start - 1]) ? start - 1 : start;
  let end = lines.findIndex((l, i) => i > start && QHEAD.test(l));
  if (end < 0) end = lines.length;
  // وبالعكس: أرقام بسطر وحده گبل السؤال اللي بعده هي مال ذاك السؤال
  else if (end - 1 > from && /^[\d\s]+$/.test(lines[end - 1])) end--;
  return lines.slice(from, end).filter((l) => !branch || !branchOf(l) || branchOf(l) === branch).join("\n");
}
export function buildIndex(texts: string[], toc: TocItem[]): RasidPage[] {
  const lab = labels(toc, texts.length);
  // سؤال بفروع: كل فرع صفحة، بالترتيب
  const branch = lab.map((l, i) => {
    const same = lab.filter((x, k) => k <= i && x.topic === l.topic && x.q === l.q).length;
    const total = lab.filter((x) => x.topic === l.topic && x.q === l.q).length;
    return total > 1 ? same : 0;
  });
  return texts.map((t, i) => {
    const own = ownText(t, lab[i].q, branch[i]);
    return { page: i + 1, topic: lab[i].topic, q: lab[i].q, nums: numsOf(own), loose: loose(own) };
  });
}

const mem = new Map<string, RasidPage[]>();
/** فهرس الراصد: ينحسب مرة وحدة من ملفه وينحفظ ويّاه */
export async function rasidIndex(b: Row): Promise<RasidPage[]> {
  const key = String(b.file);
  if (mem.has(key)) return mem.get(key)!;
  const ref = `notes/${key}.qa.json`;
  let list: RasidPage[] | null = null;
  const cached = await files().read(ref);
  if (cached) { try { list = JSON.parse(cached.toString("utf8")); } catch { list = null; } }
  if (!list) {
    const pdf = await files().read(`notes/${key}.pdf`);
    if (!pdf) return [];
    list = buildIndex(await pageTexts(pdf), await bookToc(b));
    await files().write(ref, Buffer.from(JSON.stringify(list)), "application/json");
  }
  mem.set(key, list);
  return list;
}

export type RasidHit = { page: number; topic: string; q: string };
/** سؤال الطالب بأي صفحة بالراصد؟ نفس الأرقام كلها (رقمين على الأقل)، وبالموضوع اللي اختاره إذا موضوعه بالراصد،
 *  وكلامه موجود بالصفحة. إذا أكثر من سؤال يطابق وماكو واحد أقرب: null */
export function rasidFind(text: string, index: RasidPage[], sameTopic: (t: string) => boolean, words: string[]): RasidHit | null {
  const nums = numsOf(text);
  if (!nums.length) return null;
  const key = nums.join(",");
  const inTopic = index.filter((p) => p.topic && sameTopic(p.topic));
  const pool = inTopic.length ? inTopic : index;
  const ws = words.map(loose).filter((w) => w.length >= 3);
  const share = (p: RasidPage) => (ws.length ? ws.filter((w) => p.loose.includes(w)).length / ws.length : 1);
  // رقم واحد أو رقمين: الكلام لازم يشبه أكثر، والطالب لازم يكون كاتب كلام
  if (nums.length === 1 && ws.length < 4) return null;
  const need = nums.length === 1 ? 0.75 : nums.length === 2 ? 0.6 : 0.4;
  const hits = pool.filter((p) => p.nums.join(",") === key).map((p) => ({ p, s: share(p) })).filter((x) => x.s >= need);
  if (!hits.length) return null;
  // نفس السؤال متكرر بالراصد (نفس الموضوع والأرقام): أول صفحة. أسئلة مختلفة: الأقرب بالكلام إذا واضح
  const qs = [...new Map(hits.map((h) => [`${h.p.topic}|${h.p.loose}`, h])).values()].sort((a, b) => b.s - a.s);
  if (qs.length > 1 && qs[0].s - qs[1].s < 0.15) return null;
  const best = hits.filter((h) => h.p.loose === qs[0].p.loose)[0].p;
  return { page: best.page, topic: best.topic, q: best.q };
}
