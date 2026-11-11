// «📄 أسئلة من الوورد»: صاحب البوت يرفع ملف الفصل بالعربي والإنجليزي، والبوت يقسمهن لنسخ وأسئلة،
// ويطابقهن ويا نسخ البنك، ويراوي المطابقة قبل الحفظ. الإنجليزي يطابق بعدد الأسئلة وحرف النسخة،
// والعربي فوك هذا بأرقام المعادلات اللي نفسها بالإنجليزي، فكل نسخة عربية تثبت على توأمها.
// بس النسخ اللي طابقت بالضبط تنحفظ (نص كل سؤال بـ q_text و q_text_en)، والباقي يطلع بالتقرير حتى تتصلح بالوورد.
import { docxLines } from "./docxText.ts";
import { createHash } from "node:crypto";
import { find, insert, update, type Row } from "./db.ts";
import { files } from "./files.ts";
import { answerOnlyOf } from "./answerOnly.ts";
import { need } from "./webApi.ts";
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
  const m = { rows, bank, A, E, aa, ae, extraAr: A.length - aa.filter((j) => j >= 0).length, extraEn: E.length - ae.filter((j) => j >= 0).length };
  return { ...m, grow: growable(m, !!arDoc, !!enDoc) };
}

export type Grow = { exam: number; title: string; from: number; to: number; marks: number[] };
type Matched = { rows: WordRow[]; bank: BankRow[]; A: WordBlock[]; E: WordBlock[]; aa: number[]; ae: number[] };
/** 100 درجة على n سؤال بالتساوي (الزايد على الأسئلة الأولى) */
export const evenMarks = (n: number) => Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));
/**
 * امتحانات كل نسخها بالوورد بيها أسئلة أكثر من البوت، ونفس العدد بكل النسخ وبالعربي والإنجليزي
 * (مثلاً Ln&E: بالبوت 7، والسؤال السابع بي التكامل والاشتقاقات سوا، وبالوورد 10)
 */
function growable(m: Matched, ar: boolean, en: boolean): Grow[] {
  const out: Grow[] = [];
  for (const id of [...new Set(m.rows.map((r) => r.exam))]) {
    const idx = m.rows.flatMap((r, i) => (r.exam === id ? [i] : []));
    const sizes = new Set<number>();
    const ok = idx.every((i) => {
      const e = en ? (m.ae[i] >= 0 ? m.E[m.ae[i]] : null) : undefined;
      const a = ar ? (m.aa[i] >= 0 ? m.A[m.aa[i]] : null) : undefined;
      if (e === null || a === null || e?.odd || a?.odd) return false;
      if (a && e && sameMath(blockText(a), blockText(e)) < 0.35) return false;
      for (const b of [a, e]) if (b) sizes.add(b.qs.length);
      return sizes.size === 1 && [...sizes][0] > m.bank[i].qs.length;
    });
    if (!ok || sizes.size !== 1) continue;
    const to = [...sizes][0];
    // «أجب عن K»: كل سؤال 100÷K (نصف السنة: 6 أسئلة، كل واحد 20)
    const k = answerOnlyOf(m.bank[idx[0]].exam);
    const marks = k && k < to && 100 % k === 0 ? Array<number>(to).fill(100 / k) : evenMarks(to);
    out.push({ exam: id, title: m.rows[idx[0]].title, from: Math.max(...idx.map((i) => m.bank[i].qs.length)), to, marks });
  }
  return out;
}

/**
 * يخلي أسئلة الامتحان بالبوت بعدد الوورد: الأسئلة الموجودة تبقى بصورها، والأخير منها (اللي كان بي الزايد) والجداد
 * تنرسم صورهن من نص الوورد، والدرجات بالتساوي، والنص ينحفظ. ما يصير إذا أحد امتحن هذا الامتحان
 */
export async function growExam(arDoc: Buffer | null, enDoc: Buffer | null, chapter: string, examId: number, growId: number) {
  const m = await matchWord(arDoc, enDoc, chapter, examId);
  const g = m.grow.find((x) => x.exam === growId);
  need(g, "عدد الأسئلة بالوورد لازم يكون نفسه بكل نسخ الامتحان، بالعربي والإنجليزي");
  const taken = (await find("sched_items", { exam_id: growId })).some((it) => it.started_at || it.submitted_at || it.total != null);
  need(!taken, "اكو طلاب امتحنوا هذا الامتحان، فما يتغير عدد أسئلته");
  const { questionPng } = await import("./documents.ts");
  // الصور أول، حتى إذا وحدة ما انرسمت ما يتغير شي
  const plan: { r: BankRow; a?: WordBlock; e?: WordBlock; pics: Map<number, string> }[] = [];
  for (const [i, r] of m.bank.entries()) {
    if (r.exam.id !== growId) continue;
    const a = m.aa[i] >= 0 ? m.A[m.aa[i]] : undefined, e = m.ae[i] >= 0 ? m.E[m.ae[i]] : undefined;
    const pics = new Map<number, string>();
    for (let k = Math.max(0, r.qs.length - 1); k < g!.to; k++) {
      const [text, lang] = a ? [a.qs[k].text, "ar" as const] : [e!.qs[k].text, "en" as const];
      const png = await questionPng(text, lang);
      need(png, `ما گدرت أرسم السؤال ${k + 1} بنسخة ${r.v.model}`);
      const key = `bank/word/v${r.v.id}_q${k + 1}_${createHash("sha1").update(text).digest("hex").slice(0, 10)}.png`;
      await files().write(key, png!, "image/png");
      pics.set(k, key);
    }
    plan.push({ r, a, e, pics });
  }
  for (const { r, a, e, pics } of plan) {
    for (let k = 0; k < g!.to; k++) {
      const row: Row = { max_mark: g!.marks[k], edited: 1 };
      if (a) row.q_text = a.qs[k].text;
      if (e) row.q_text_en = e.qs[k].text;
      if (pics.has(k)) row.q_file = pics.get(k);
      if (k < r.qs.length) await update("bank_questions", { id: r.qs[k].id }, row);
      else await insert("bank_questions", { version_id: r.v.id, n: k + 1, a_files: "[]", ...row });
    }
  }
  return g!;
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
