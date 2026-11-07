// منع الغش: الطالب اللي عنده امتحان مفتوح هسه (دخله وبعده وقته ما خلص) ينقفل عليه كل شي ممكن يساعده:
// الأسئلة العلمية والجواب الآلي، أسئلته القديمة، ملفات المحاضرات ورابط التطبيق، أوراقه المصححة واعتراضاته، وملفات الامتحانات.
// يبقى بس الامتحان نفسه
import { find, one } from "./db.ts";
import { closeOf } from "./examRoom.ts";
import { stamp } from "./util.ts";

export const LOCK_TEXT = "🔒 عندك امتحان مفتوح هسه. كل شي مقفول لحد ما تسلم الامتحان أو يخلص وقته.";

/** عنده امتحان داخله هسه وبعده وقته ما خلص؟ */
export async function examInProgress(uid: number) {
  const open = await find("sched_items", { user_id: uid, status: "started" });
  if (!open.length) return false;
  const { schedSettings } = await import("./schedApi.ts");
  const s = await schedSettings(), now = stamp();
  for (const it of open) {
    const e = await one("bank_exams", { id: it.exam_id });
    if (now < closeOf(it, e?.minutes ?? 75, s)) return true;
  }
  return false;
}
