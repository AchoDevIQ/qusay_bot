// «📄 أسئلة من الوورد»: صاحب البوت يرفع ملف الفصل بالعربي والإنجليزي، والبوت يقسمهن لنسخ وأسئلة،
// ويطابقهن ويا نسخ البنك، ويراوي المطابقة قبل الحفظ. الإنجليزي يطابق بعدد الأسئلة وحرف النسخة،
// والعربي فوك هذا بأرقام المعادلات اللي نفسها بالإنجليزي، فكل نسخة عربية تثبت على توأمها.
// بس النسخ اللي طابقت بالضبط تنحفظ (نص كل سؤال بـ q_text و q_text_en)، والباقي يطلع بالتقرير حتى تتصلح بالوورد.
import { docxLines } from "./docxText.ts";
import { find, update, type Row } from "./db.ts";
import { alignBlocks, blockText, sameMath, splitExamDoc, type WordBlock } from "./wordQuestions.ts";

type BankRow = { exam: Row; v: Row; qs: Row[] };
export type WordRow = {
  exam: number; title: string; model: string; kind: string; n: number;
  ar: { ok: boolean; got: number[] | null; first: string } | null;
  en: { ok: boolean; got: number[] | null; first: string } | null;
};

/** نسخ البنك بترتيب الكتاب: كل امتحانات الفصل، أو امتحان واحد */
async function bankRows(chapter: string, examId: number): Promise<BankRow[]> {
  const pos = (e: Row) => Number(e.pos ?? e.ord ?? 0);
  const exams = (await find("bank_exams")).filter((e) => (examId ? e.id === examId : e.chapter === chapter)).sort((a, b) => pos(a) - pos(b) || a.id - b.id);
  const versions = await find("bank_versions", {}, { order: ["model"] });
  const questions = await find("bank_questions", {}, { order: ["n"] });
  return exams.flatMap((exam) => versions.filter((v) => v.exam_id === exam.id).map((v) => ({ exam, v, qs: questions.filter((q) => q.version_id === v.id) })));
}

const sig = (b: WordBlock) => ({ n: b.qs.length, model: b.model });
/** نسخة الملف تنفع: نفس عدد الأسئلة، وترقيمها 1، 2، 3… */
const fits = (b: WordBlock | undefined, r: BankRow) => !!b && b.qs.length === r.qs.length && !b.odd;

/** يطابق الملفين ويا البنك. الملف اللي ما انرفع يبقى null */
export async function matchWord(arDoc: Buffer | null, enDoc: Buffer | null, chapter: string, examId: number) {
  const bank = await bankRows(chapter, examId);
  const bankSig = bank.map((r) => ({ n: r.qs.length, model: String(r.v.model ?? "") || null }));
  const E = enDoc ? splitExamDoc(docxLines(enDoc)) : [];
  const A = arDoc ? splitExamDoc(docxLines(arDoc)) : [];
  const ae = enDoc ? alignBlocks(bankSig, E.map(sig)) : bank.map(() => -1);
  // العربي: نفس المطابقة، وفوكها تشابه أرقام المعادلات ويا النسخة الإنجليزية اللي طابقت
  const aa = arDoc ? alignBlocks(bankSig, A.map(sig), (i, j) => (ae[i] < 0 ? 0 : (sameMath(blockText(A[j]), blockText(E[ae[i]])) - 0.35) * 12)) : bank.map(() => -1);
  const side = (blocks: WordBlock[], j: number, r: BankRow, i: number, other: number[] | null) => {
    if (!blocks.length) return null;
    const b = j >= 0 ? blocks[j] : undefined;
    // العربي اللي معادلاته ما تشبه توأمه الإنجليزي ما ينحسب مطابق
    const twin = other && other[i] >= 0 && b ? sameMath(blockText(b), blockText(E[other[i]])) : 1;
    return { ok: fits(b, r) && twin >= 0.35, got: b ? b.qs.map((q) => q.n) : null, first: b?.qs[0]?.text.slice(0, 90) ?? "" };
  };
  const rows: WordRow[] = bank.map((r, i) => ({
    exam: r.exam.id as number, title: String(r.exam.title ?? ""), model: String(r.v.model ?? ""), kind: String(r.v.kind ?? ""), n: r.qs.length,
    ar: side(A, aa[i], r, i, enDoc ? ae : null), en: side(E, ae[i], r, i, null),
  }));
  return { rows, bank, A, E, aa, ae, extraAr: A.length - aa.filter((j) => j >= 0).length, extraEn: E.length - ae.filter((j) => j >= 0).length };
}

/** يحفظ نص كل سؤال للنسخ اللي طابقت بس. يرجع كم نسخة انحفظت بكل لغة */
export async function saveWord(arDoc: Buffer | null, enDoc: Buffer | null, chapter: string, examId: number) {
  const m = await matchWord(arDoc, enDoc, chapter, examId);
  let ar = 0, en = 0;
  for (const [i, r] of m.bank.entries()) {
    const row = m.rows[i];
    if (row.ar?.ok) { for (const [k, q] of r.qs.entries()) await update("bank_questions", { id: q.id }, { q_text: m.A[m.aa[i]].qs[k].text }); ar++; }
    if (row.en?.ok) { for (const [k, q] of r.qs.entries()) await update("bank_questions", { id: q.id }, { q_text_en: m.E[m.ae[i]].qs[k].text }); en++; }
  }
  return { ...m, savedAr: ar, savedEn: en };
}
