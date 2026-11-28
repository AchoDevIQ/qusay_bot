// 🚪 صفحة «طلعوا من الامتحان» (طلبه 2026-11-28: «ليش توصلني على التليگرام؟ بالتطبيق أحسن»):
// كل طالب طلع برا صفحة الامتحان وهو يمتحن يصير سطر. «✅ تم» ينزله لورا (لحد ما تفرغ الصفحة)،
// و«📩 رسالة» يدزله رسالة كتابة لو صوت. تشوفها إنت، واللي عنده صلاحية «🚪 تنبيه: الطالب طلع من صفحة الامتحان».
// إذا طلع مرة ثانية بنفس الامتحان يرجع فوگ.
import { find, one, put, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { authed, need } from "./webApi.ts";
import { esc, stamp } from "./util.ts";

export const LEAVE_PERM = "leave";

/** الطالب طلع (left) لو رجع (back، ويا كم ثانية غاب) */
export async function recordLeave(it: Row, phase: "left" | "back", secs: number, info: { name: string; exam: string; ipad: boolean; center: string }) {
  const old = await one("exam_leaves", { item_id: it.id });
  if (phase === "back") {
    if (old) await update("exam_leaves", { item_id: it.id }, { away_secs: (Number(old.away_secs) || 0) + Math.max(0, Math.round(secs)) });
    return;
  }
  const now = stamp();
  await put("exam_leaves", {
    item_id: it.id, user_id: it.user_id, name: info.name, exam: info.exam, ipad: info.ipad ? 1 : 0, center: info.center,
    first_at: old?.first_at ?? now, last_at: now, n: (Number(old?.n) || 0) + 1, away_secs: Number(old?.away_secs) || 0, msgs: Number(old?.msgs) || 0,
    // طلع مرة ثانية: يرجع فوگ حتى لو چان «تم»
    done_at: null, done_by: null,
  });
}

/** كم طالب ينتظر (للوحة التحكم) */
export const openLeaves = async () => (await find("exam_leaves")).filter((r) => !r.done_at).length;

async function view(notice = "") {
  const rows = await find("exam_leaves");
  const pick = (r: Row) => ({ item: r.item_id as number, name: String(r.name ?? ""), exam: String(r.exam ?? ""), ipad: !!r.ipad, center: String(r.center ?? ""), first: String(r.first_at ?? ""), last: String(r.last_at ?? ""), n: Number(r.n) || 0, away: Number(r.away_secs) || 0, msgs: Number(r.msgs) || 0, done: String(r.done_at ?? "") });
  const open = rows.filter((r) => !r.done_at).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at))).map(pick);
  const done = rows.filter((r) => r.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 60).map(pick);
  return { open, done, notice };
}

export async function leavesAction(body: Row) {
  const uid = await authed(body?.initData, LEAVE_PERM);
  const a = String(body.action ?? "list");
  if (a === "done" || a === "undo") {
    const r = await one("exam_leaves", { item_id: Number(body.item) });
    need(r, "هذا السطر غير موجود", 404);
    await update("exam_leaves", { item_id: r!.item_id }, a === "done" ? { done_at: stamp(), done_by: uid } : { done_at: null, done_by: null });
    return await view(a === "done" ? `✅ ${r!.name}: نزل لورا` : `↩️ ${r!.name}: رجع فوگ`);
  }
  need(a === "list", "أمر غير معروف");
  return await view();
}

/** 📩 رسالة للطالب اللي طلع (كتابة لو صوت) */
export async function leavesUpload(form: FormData) {
  await authed(form.get("initData"), LEAVE_PERM);
  need(form.get("action") === "message", "أمر غير معروف");
  const r = await one("exam_leaves", { item_id: Number(form.get("item")) });
  need(r, "هذا السطر غير موجود", 404);
  const { deliverMsg, voiceOf } = await import("./directMsg.ts");
  const text = String(form.get("text") ?? "").trim().slice(0, 3000);
  const voice = voiceOf(form);
  need(text || voice, "اكتب رسالة أو سجل صوت");
  const caption = `📩 <b>رسالة من قصي العميري</b>\nبخصوص امتحان: ${esc(String(r!.exam ?? ""))}${text ? `\n\n${esc(text)}` : ""}`;
  await deliverMsg(Number(r!.user_id), caption, voice);
  await logActivity(Number(r!.user_id), `📩 وصلته رسالة بخصوص طلعته من امتحان ${r!.exam ?? ""}`);
  await update("exam_leaves", { item_id: r!.item_id }, { msgs: (Number(r!.msgs) || 0) + 1 });
  return await view(Number(r!.user_id) < 0 ? `🧪 ${r!.name} طالب تجربة: الرسالة ما توصل لأحد، بس انحسبت` : `✅ وصلت الرسالة إلى ${r!.name}`);
}
