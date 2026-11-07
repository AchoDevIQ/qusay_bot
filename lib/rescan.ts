// ورقة حضوري انرفعت غلط بالسكنر (ما انقرت زين، أو النت قطع): المصحح يمسحها، وتوصل رسالة للمساعد اللي رفعها
// (اللي عنده صلاحية السكنر أو التصوير) حتى يعيد رفعها. تبقى بقائمة «أوراق لازم تعيد رفعها» بصفحته،
// وأول ما تنرفع من جديد وتروح للتصحيح تنشال من القائمة وحدها
import { kvGet, kvSet, one, remove, update } from "./db.ts";
import { logActivity } from "./access.ts";
import { centerName, isAdmin, staffIds, student } from "./data.ts";
import { send } from "./telegram.ts";
import { clearPaperVoices } from "./gradeVoices.ts";
import { esc } from "./util.ts";
import { need } from "./webApi.ts";

export type Rescan = { item: number; sid: number; name: string; center: string; at: string; exam: string; by: number[]; when: string };
const LIST = "rescan_list";
const byKey = (item: number) => `scan_by_${item}`;

async function list(): Promise<Rescan[]> { try { const j = JSON.parse(await kvGet(LIST) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } }

/** منو رفع صفحات هذي الورقة: ينحفظ ويا كل صفحة ترتفع بالسكنر أو الكاميرا */
export async function recordUploader(item: number, uid: number) {
  let by: number[] = [];
  try { by = JSON.parse(await kvGet(byKey(item)) ?? "[]"); } catch { by = []; }
  if (!by.includes(uid)) await kvSet(byKey(item), JSON.stringify([...by, uid]));
}
async function uploaders(item: number): Promise<number[]> { try { const j = JSON.parse(await kvGet(byKey(item)) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; } }

/** المسح: صفحاته ودرجاته ورسمه تنشال، والورقة ترجع تنتظر الرفع. الرسالة توصل للي رفعها */
export async function rescanPaper(by: number, it: { id: number; user_id: number; exam_id: number; at: string; graded_at?: string | null }, stamp: string) {
  need(!it.graded_at, "الورقة انصححت، ما تنمسح");
  const st = await student(it.user_id);
  need(st?.exam === "حضوري", "هذا بس لأوراق الحضوري اللي انرفعت بالسكنر");
  const e = await one("bank_exams", { id: it.exam_id });
  const entry: Rescan = { item: it.id, sid: it.user_id, name: st?.name ?? "طالب", center: await centerName(st?.center_id) || "", at: String(it.at ?? ""), exam: e?.title ?? "امتحان", by: await uploaders(it.id), when: stamp };
  await remove("exam_answers", { item_id: it.id });
  await remove("question_marks", { item_id: it.id });
  await remove("paper_ink", { item_id: it.id });
  await clearPaperVoices(it.id);
  await kvSet(byKey(it.id), "[]");
  await update("sched_items", { id: it.id }, { status: "attended", submitted_at: null, grader_id: null });
  await kvSet(LIST, JSON.stringify([entry, ...(await list()).filter((x) => x.item !== it.id)]));
  const to = await targets(entry);
  const text = `🔁 <b>عيد رفع ورقة بالسكنر</b>\nالطالب: <b>${esc(entry.name)}</b> (#${entry.sid})\nالمركز: ${esc(entry.center || "-")}\nوقت الامتحان: ${esc(entry.at)}\nالامتحان: ${esc(entry.exam)}\n\nورقته انمسحت لأن الرفع ما طلع صحيح. عيد رفعها من «📤 أوراق السكانر» أو بالكاميرا. أول ما ترفعها تنشال من قائمتك وحدها.`;
  for (const id of to) if (id !== by) await send(id, text);
  await logActivity(it.user_id, `🔁 انمسحت ورقة السكنر مال ${entry.exam} حتى تنرفع من جديد`);
  return to.length;
}
/** اللي رفعوها، وإذا ما معروف منو رفعها: كل اللي عندهم الحضوري أو تصوير الأوراق */
async function targets(r: Rescan) {
  if (r.by.length) return r.by;
  const { ATTEND_PERM, CAM_PERM } = await import("./inPerson.ts");
  return [...new Set([...await staffIds(ATTEND_PERM), ...await staffIds(CAM_PERM)])];
}
/** قائمة المساعد: الأوراق اللي هو رفعها وانمسحت (صاحب البوت يشوف الكل) */
export async function rescanFor(uid: number) {
  const all = await list();
  if (await isAdmin(uid)) return all;
  const out: Rescan[] = [];
  for (const r of all) if ((await targets(r)).includes(uid)) out.push(r);
  return out;
}
export async function rescanItemOf(sid: number) { return (await list()).find((r) => r.sid === sid)?.item ?? 0; }
/** انرفعت من جديد وراحت للتصحيح: تنشال من القائمة */
export async function rescanDone(items: number[]) {
  const all = await list();
  const left = all.filter((r) => !items.includes(r.item));
  if (left.length !== all.length) await kvSet(LIST, JSON.stringify(left));
}
