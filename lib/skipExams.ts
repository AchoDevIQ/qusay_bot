// الامتحانات اللي طالب الجدول الخاص يگدر يشيلها من جدوله. الأصل: كل امتحان ما ينحذف
import { kvGet } from "./db.ts";

export const SKIP_KEY = "skippable_exams";
export async function skippableExams(): Promise<number[]> {
  try { const j = JSON.parse(await kvGet(SKIP_KEY) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; }
}

/** امتحان يطلع ويا فصل غير فصله (مثلاً إعادة الفصل الأول ونصف السنة يطلعن لمشتري الفصل الثالث، قبل العطلة).
 *  اللي ما مشتري ذاك الفصل يطلعله الامتحان ويا فصله مثل قبل */
export const WITH_KEY = "exam_with_chapter";
export async function examWith(): Promise<Record<string, string>> {
  try { const j = JSON.parse(await kvGet(WITH_KEY) ?? "{}"); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
