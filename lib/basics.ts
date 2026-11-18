// بنين لو بنات، والصف (السادس لو الخامس): إجباريات لكل طالب (طلب الأستاذ 2026-11-18).
// التسجيل ما ينقبل بدونهن، والطالب القديم اللي ناقصه وحدة منهن يختارها أول شي قبل ما يرتب امتحاناته.
// بعد ما يختار تنقفل مثل باقي معلوماته، والإدارة بس تغيرها
import { GENDERS, GRADES } from "./config.ts";
import { put, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { student } from "./data.ts";
import { sexOf } from "./seats.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

export const BASICS_FIRST = "📝 قبل كل شي اختار: بنين لو بنات، وصفك بالمدرسة";
/** «ذكر/أنثى» من التطبيق تصير «بنين/بنات» */
export const genderWord = (g: unknown) => ({ b: "بنين", g: "بنات" } as const)[sexOf({ gender: g }) ?? "x" as never] ?? null;
/** الناقص من الثنين، أو null إذا الثنين موجودات */
export function missingBasics(st: Row | null | undefined): { gender: boolean; grade: boolean } | null {
  if (!st) return null;
  const gender = !sexOf(st), grade = !GRADES.includes(String(st.grade ?? ""));
  return gender || grade ? { gender, grade } : null;
}
export async function needBasics(uid: number) { need(!missingBasics(await student(uid)), BASICS_FIRST, 409); }
/** الطالب يختار الناقص بس. اللي محفوظ ما يتغير منه */
export async function setBasics(uid: number, body: Row) {
  const st = await student(uid);
  need(st, "سجل معلوماتك أول");
  const miss = missingBasics(st);
  need(miss, "معلوماتك كاملة. لتغيير أي معلومة تواصل ويا قصي العميري.");
  const add: Row = {};
  if (miss!.gender) { need(GENDERS.includes(String(body.gender)), "اختار بنين لو بنات"); add.gender = String(body.gender); }
  if (miss!.grade) { need(GRADES.includes(String(body.grade)), "اختار صفك: السادس العلمي لو الخامس العلمي"); add.grade = String(body.grade); }
  await put("students", { ...st, ...add, updated: stamp() });
  await logActivity(uid, `📝 اختار ${[add.gender, add.grade].filter(Boolean).join("، ")}`);
  return "✅ انحفظ";
}
