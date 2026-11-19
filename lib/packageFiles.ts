// «⬆️ ارفع البكج كله» (طلب الأستاذ 2026-11-19): يختار كل ملفات مجلد الفصل مرة وحدة، والبوت يعرف كل ملف من اسمه وين ينحط.
// أسماء ملفاته مثل: «الفصل 2 انكلش 2027.pdf/.docx» (الكتاب)، «وزاريات انكلش 2 2027 - حلي.pdf» و«… - الحل النموذجي.pdf»
// و«وزاريات انكلش 2 2027.docx»، ونفسها للإثرائيات، و«راصد الفصل الثاني انكلش - حلي.pdf» و«… - الحل النموذجي.pdf».
// ملفات الأسئلة الأصلية (بدون «حلي») وملفات «جواب» تنعبر: هاي مصادر، مو للطالب
export type Section = "book" | "wz" | "ith" | "rasid";
export type PkgPdf = { section: Section; file: string; sol?: string };
export type PkgWord = { kind: "main" | "exams" | "extra"; file: string };
export type PkgPlan = { chapter: number; lang: "ar" | "en" | null; pdf: PkgPdf[]; word: PkgWord[]; skipped: string[]; problems: string[] };

const ORD: Record<string, number> = { الاول: 1, الأول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6 };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
export const SECTION_TITLE: Record<Section, string> = { book: "📘 الكتاب", wz: "📗 الوزارية", ith: "📙 الإثرائية", rasid: "📝 الراصد" };

function chapterOf(name: string): number {
  const ord = Object.keys(ORD).find((w) => name.includes(`الفصل ${w}`) || name.includes(`الفصل ال${w.replace(/^ال/, "")}`));
  if (ord) return ORD[ord];
  // رقم واحد لوحده (مو أول رقم من 2027): «الفصل 2»، «ف 4 انكلش»، «انكلش 5 2027»، «وزاريات 4 انكلش»
  const m = name.match(/(?:الفصل|ف|انكلش|انجليزي|انكليزي|عربي|Chapter)\s*_?([1-6])(?!\d)/i) ?? name.match(/(?:^|\s)([1-6])(?=\s|$)/);
  return m ? Number(m[1]) : 0;
}
const langOf = (name: string): "ar" | "en" | null => (/انكلش|انجليزي|انكليزي|english/i.test(name) ? "en" : /عربي|arabic/i.test(name) ? "ar" : null);
function sectionOf(name: string): Section | null {
  if (/وزاري/.test(name)) return "wz";
  if (/[اإ]ثرائي/.test(name)) return "ith";
  if (/راصد|جواب/.test(name)) return "rasid";
  if (/الفصل|^ف\s/.test(name)) return "book";   // «الفصل 2 انكلش 2027» أو «ف 4 انكلش 2027»
  return null;
}

export function planPackage(names: string[]): PkgPlan {
  const plan: PkgPlan = { chapter: 0, lang: null, pdf: [], word: [], skipped: [], problems: [] };
  const pairs = new Map<Section, { q?: string; sol?: string }>();
  const chapters = new Set<number>(), langs = new Set<string>();
  for (const file of names) {
    const ext = (file.match(/\.([a-z]+)$/i)?.[1] ?? "").toLowerCase();
    const base = norm(file.replace(/\.[a-z]+$/i, ""));
    if (file.startsWith("~$") || !["pdf", "docx"].includes(ext)) { plan.skipped.push(file); continue; }
    const sec = sectionOf(base);
    if (!sec) { plan.skipped.push(file); continue; }
    const c = chapterOf(base), l = langOf(base);
    if (c) chapters.add(c);
    if (l) langs.add(l);
    const solved = /- *الحل النموذجي$/.test(base), mine = /- *حلي$/.test(base);
    if (ext === "docx") {
      // «جواب» و«راصد» Word ما إله مكان (الأسئلة العلمية تنقرا من الكتاب والوزارية والإثرائية)
      if (sec === "rasid" || solved || mine) { plan.skipped.push(file); continue; }
      plan.word.push({ kind: sec === "book" ? "main" : sec === "wz" ? "exams" : "extra", file });
      continue;
    }
    if (sec === "book") {
      if (solved || mine) { plan.skipped.push(file); continue; }
      pairs.set("book", { q: file });
      continue;
    }
    // الوزارية والإثرائية والراصد: بس ملفين «حلي» و«الحل النموذجي»؛ الملف الأصلي مصدر
    if (!solved && !mine) { plan.skipped.push(file); continue; }
    const p = pairs.get(sec) ?? {};
    if (mine) p.q = file; else p.sol = file;
    pairs.set(sec, p);
  }
  for (const sec of ["book", "wz", "ith", "rasid"] as Section[]) {
    const p = pairs.get(sec);
    if (!p) continue;
    if (sec === "book") { plan.pdf.push({ section: sec, file: p.q! }); continue; }
    if (p.q && p.sol) plan.pdf.push({ section: sec, file: p.q, sol: p.sol });
    else plan.problems.push(`${SECTION_TITLE[sec]}: ${p.q ? "ناقص ملف «الحل النموذجي»" : "ناقص ملف «حلي»"}`);
  }
  if (chapters.size > 1) plan.problems.push(`الملفات من أكثر من فصل (${[...chapters].join("، ")}). اختار ملفات فصل واحد`);
  if (langs.size > 1) plan.problems.push("الملفات عربي وإنجليزي سوا. اختار منهج واحد");
  plan.chapter = chapters.size === 1 ? [...chapters][0] : 0;
  plan.lang = langs.size === 1 ? ([...langs][0] as "ar" | "en") : null;
  if (!plan.chapter && !plan.problems.length) plan.problems.push("ما عرفت رقم الفصل من أسماء الملفات");
  if (!plan.pdf.length && !plan.word.length && !plan.problems.length) plan.problems.push("ما لگيت ملفات ملازم بهذا الاختيار");
  return plan;
}
