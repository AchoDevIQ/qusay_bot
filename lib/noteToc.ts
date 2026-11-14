// «📑 المواضيع» بالملزمة والراصد: الطالب يختار الموضوع، وبعده المحاضرة (أو السؤال بالراصد)، ويروح لصفحتها.
// الفهرس يطلع وحده من الملف: إذا الـ PDF بيه فهرس (bookmarks) ناخذه، وإلا نقرا عناوين المحاضرات من أعلى كل صفحة
// («المحاضرة الأولى : المعدلات الزمنية» وتحتها «أسئلة وأمثلة الكتاب»). ينحسب مرة وحدة وينحفظ ويا الملف
import { files } from "./files.ts";
import { pdfjsLib } from "./pdfjs.ts";
import type { Row } from "./db.ts";

export type TocItem = { t: string; p: number; items?: TocItem[] };
export type TextItem = { s: string; x: number; y: number };

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\s*:\s*$/, "").trim();
const LECTURE = /^(المحاضرة|المحاضره|Lecture)\s+(\S+)\s*:?\s*(.*)$/i;

/** عناوين المحاضرات من نصوص الصفحات (كل صفحة: نصوصها ويا مكانها، y من تحت لفوك، H ارتفاع الصفحة) */
export function tocFromText(pages: TextItem[][], H: number): TocItem[] {
  const toc: TocItem[] = [];
  pages.forEach((items, i) => {
    const page = i + 1;
    const top = items.filter((it) => it.y > H * 0.72);
    const head = top.find((it) => LECTURE.test(it.s.trim()));
    if (!head) return;
    const m = LECTURE.exec(head.s.trim())!;
    const lecture = clean(`${m[1]} ${m[2]}`);
    const rtl = !/^Lecture/i.test(m[1]);
    // الموضوع: باقي سطر العنوان (نفس الارتفاع)، والعنوان الفرعي (مثل «حل الأسئلة الوزارية») السطر اللي تحته
    const sameLine = top.filter((it) => it !== head && Math.abs(it.y - head.y) <= 3).sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    const topic = clean([m[3], ...sameLine.map((it) => it.s)].join(" "));
    const below = top.filter((it) => head.y - it.y > 12 && head.y - it.y < 45).sort((a, b) => b.y - a.y || (rtl ? b.x - a.x : a.x - b.x));
    const firstY = below[0]?.y;
    const section = clean(below.filter((it) => Math.abs(it.y - firstY) <= 3).map((it) => it.s).join(" "));
    if (!topic) return;
    let t = toc.find((x) => x.t === topic);
    if (!t) { t = { t: topic, p: page, items: [] }; toc.push(t); }
    let l = t.items!.find((x) => x.t === lecture);
    if (!l) { l = { t: lecture, p: page, items: [] }; t.items!.push(l); }
    if (section && section.length < 40 && !l.items!.some((x) => x.t === section)) l.items!.push({ t: section, p: page });
  });
  for (const t of toc) for (const l of t.items ?? []) if (!l.items?.length) delete l.items;
  return toc;
}

async function fromPdf(pdf: Buffer): Promise<TocItem[]> {
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const doc = await task.promise;
    // فهرس الملف نفسه (الراصد ينبني ويّاه)
    const outline = await doc.getOutline();
    if (outline?.length) {
      const walk = async (list: any[]): Promise<TocItem[]> => {
        const out: TocItem[] = [];
        for (const o of list) {
          let p = 0;
          try {
            const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : o.dest;
            if (dest?.[0]) p = (await doc.getPageIndex(dest[0])) + 1;
          } catch { /* عنوان بلا صفحة */ }
          const items = o.items?.length ? await walk(o.items) : undefined;
          if (!p && items?.length) p = items[0].p;
          if (p) out.push({ t: clean(String(o.title ?? "")), p, ...(items?.length ? { items } : {}) });
        }
        return out;
      };
      return await walk(outline);
    }
    const pages: TextItem[][] = [];
    let H = 842;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      H = page.getViewport({ scale: 1 }).height;
      const tc = await page.getTextContent();
      pages.push((tc.items as any[]).filter((it) => it.str?.trim()).map((it) => ({ s: String(it.str), x: it.transform[4], y: it.transform[5] })));
      page.cleanup();
    }
    return tocFromText(pages, H);
  } finally { await task.destroy(); }
}

/** فهرس الملزمة، محفوظ ويّا ملفها. فارغ إذا ما بيها عناوين */
export async function bookToc(b: Row): Promise<TocItem[]> {
  const ref = `notes/${b.file}.toc.json`;
  const cached = await files().read(ref);
  if (cached) { try { return JSON.parse(cached.toString("utf8")); } catch { /* ينحسب من جديد */ } }
  const pdf = await files().read(`notes/${b.file}.pdf`);
  if (!pdf) return [];
  const toc = await fromPdf(pdf).catch((e) => { console.error("note toc:", e); return null; });
  if (!toc) return [];
  await files().write(ref, Buffer.from(JSON.stringify(toc)), "application/json");
  return toc;
}
