// الإدارة تحط موعد امتحان باليد لطالب: إعادة امتحان خلصه أو فاته، أو تقديم موعد امتحان بعده ما وصل وقته.
// الطالب يكول «أريد يوم كذا الساعة كذا» والمساعد يحطه. إذا ما إجه بالموعد ينحسب غايب مثل أي امتحان.
// الموعد اللي ينحط باليد (fixed) ما يمسحه ترتيب الجدول من جديد
import { one, insert, update } from "./db.ts";
import { logActivity } from "./access.ts";
import { can, student } from "./data.ts";
import { allowWhileStopped } from "./checkpoints.ts";
import { prettyAt } from "./scheduleRules.ts";
import { send } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { need } from "./webApi.ts";

const AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
function validAt(raw: unknown) {
  const at = String(raw ?? "").replace("T", " ").slice(0, 16);
  need(AT.test(at) && !Number.isNaN(Date.parse(at.replace(" ", "T") + ":00Z")), "اختار اليوم والساعة");
  need(at > stamp(), "الموعد لازم يكون بعد هسه");
  return at;
}

/** إعادة امتحان خلصه أو فاته: محاولة ثانية بالموعد اللي ينحط. الدرجتين يبينن عنده */
export async function retakeExam(admin: number, itemId: unknown, rawAt: unknown, where?: unknown) {
  need(await can(admin, "retake"), "ما عندك صلاحية إعادة الامتحان", 403);
  const it = await one("sched_items", { id: Number(itemId) });
  need(it, "الامتحان غير موجود");
  need(it!.kind !== "optional", "الاختياري ما ينعاد");
  need(["done", "missed"].includes(String(it!.status)), "هذا الامتحان بعده ما خلص");
  const at = validAt(rawAt);
  // الطالب الحضوري: الإدارة تختار يعيده بمركزه، لو «💻 إلكتروني من بيته»
  const away = (await student(it!.user_id))?.exam === "حضوري";
  const online = away && where === "online", ipad = away && where === "ipad";
  const row = await insert("sched_items", { user_id: it!.user_id, exam_id: it!.exam_id, at, status: "waiting", fixed: "retake", retake_of: it!.id, ...(online ? { catch_place: "online" } : ipad ? { catch_place: "ipad" } : {}) });
  await allowWhileStopped(it!.user_id, Number(row) || 0);
  const e = await one("bank_exams", { id: it!.exam_id });
  await logActivity(it!.user_id, `🔁 الإدارة حطتله إعادة امتحان ${e?.title ?? ""} ${at}${online ? " (إلكتروني من بيته)" : ipad ? " (بمركزه بالآيباد)" : ""}`);
  await send(it!.user_id, `🔁 <b>انحطتلك إعادة امتحان ${esc(e?.title ?? "")}</b>\n🗓 ${prettyAt(at)}${online ? "\n💻 إلكتروني من بيتك: تدخله من امتحاناتي وتصور أجوبتك" : ipad ? "\n🏫 بمركزك بالآيباد: لازم يكون وياك آيباد وقلم، والنت شغال وياك بالمركز. من يسجلون حضورك تنفتح أسئلتك" : ""}\nإذا ما دخلت بوقته ينحسب غياب.`);
  return at;
}

/** تقديم (أو تغيير) موعد امتحان بعده ما بدا */
export async function moveExam(admin: number, itemId: unknown, rawAt: unknown) {
  need(await can(admin, "move"), "ما عندك صلاحية تقديم الموعد", 403);
  const it = await one("sched_items", { id: Number(itemId) });
  need(it, "الامتحان غير موجود");
  need(it!.status === "waiting" && String(it!.at) > stamp(), "هذا الامتحان بدا أو خلص");
  const at = validAt(rawAt);
  await update("sched_items", { id: it!.id }, { at, notified: null, fixed: it!.fixed || "moved" });
  const e = await one("bank_exams", { id: it!.exam_id });
  await logActivity(it!.user_id, `⏩ الإدارة غيرت موعد امتحان ${e?.title ?? ""} من ${it!.at} إلى ${at}`);
  await send(it!.user_id, `⏩ <b>تغير موعد امتحان ${esc(e?.title ?? "")}</b>\n🗓 صار ${prettyAt(at)}\nإذا ما دخلت بوقته ينحسب غياب.`);
  return at;
}
