// الامتحانات اللي طالب الجدول الخاص يگدر يشيلها من جدوله. الأصل: كل امتحان ما ينحذف
import { kvGet } from "./db.ts";

export const SKIP_KEY = "skippable_exams";
export async function skippableExams(): Promise<number[]> {
  try { const j = JSON.parse(await kvGet(SKIP_KEY) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; }
}
