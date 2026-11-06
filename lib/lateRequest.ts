// الطالب اللي فاته امتحان يكتب عذره ويطلب فتحه. الطلب يوصل بالبوت لصاحب البوت وللمساعدين اللي عندهم صلاحية
// «فتح امتحان فايت باستثناء»، ويا زرين: موافق (ينفتح الامتحان ويوصله خبر) أو غير موافق (يوصله خبر بالرفض).
// كل امتحان طلب واحد بس
import { ADMIN_IDS } from "./config.ts";
import { find, one, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { can, student } from "./data.ts";
import { openException, roomState } from "./examRoom.ts";
import type { SchedSettings } from "./scheduleRules.ts";
import { edit, send, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { need } from "./webApi.ts";

const pretty = (at: string) => `${String(at).slice(0, 10)} الساعة ${String(at).slice(11, 16)}`;

/** منو يوصله الطلب: صاحب البوت وكل مساعد عنده الصلاحية */
async function deciders() {
  const staff = (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes("exception")).map((s) => Number(s.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}
async function requestText(it: Row, end = "") {
  const st = await student(it.user_id), e = await one("bank_exams", { id: it.exam_id });
  return [
    "🙋 <b>طلب فتح امتحان فايت</b>", "",
    `👤 ${esc(st?.name ?? "طالب")} · #${it.user_id}`,
    `📝 ${esc(e?.title ?? "امتحان")}${e?.chapter ? ` (${esc(e.chapter)})` : ""}`,
    `🕓 موعده: ${pretty(it.at)}`,
    it.started_at ? "⛔ دخل الامتحان وما سلم بوقته" : "⛔ ما دخل الامتحان بوقته",
    `💬 العذر: ${esc(it.exc_reason ?? "")}`,
    ...(end ? ["", end] : []),
  ].join("\n");
}
const buttons = (id: number): Kb => [[{ text: "✅ موافق", callback_data: `ek:ok:${id}` }, { text: "❌ غير موافق", callback_data: `ek:no:${id}` }]];

/** الطالب يطلب */
export async function askException(uid: number, itemId: unknown, reason: unknown, s: SchedSettings) {
  const it = await one("sched_items", { id: Number(itemId), user_id: uid });
  need(it, "الامتحان غير موجود");
  need(roomState(it!, s) === "missed", "هذا الامتحان مو فايت");
  need(!it!.exc_state, "طلبك لهذا الامتحان وصل من قبل");
  const why = String(reason ?? "").trim().slice(0, 500);
  need(why.length >= 3, "اكتب عذرك");
  // إذا بعده بالانتظار والوقت فات، ينسجل فايت حتى ينفتح بالاستثناء
  await update("sched_items", { id: it!.id }, { status: "missed", exc_state: "asked", exc_reason: why, exc_at: stamp() });
  const fresh = (await one("sched_items", { id: it!.id }))!;
  const text = await requestText(fresh);
  for (const to of await deciders()) { try { await send(to, text, { kb: buttons(fresh.id) }); } catch (e) { console.error(e); } }
  await logActivity(uid, `📨 طلب فتح امتحان فايت: ${why}`);
}

/** زر موافق أو غير موافق من رسالة الطلب */
export async function exceptionCb(chat: number, uid: number, mid: number, d: string): Promise<string> {
  if (!await can(uid, "exception")) return "ما عندك صلاحية";
  const [, choice, raw] = d.split(":");
  const it = await one("sched_items", { id: Number(raw) });
  if (!it) return "الطلب غير موجود";
  const who = (await one("staff", { user_id: uid }))?.name ?? (ADMIN_IDS.includes(uid) ? "صاحب البوت" : `#${uid}`);
  if (it.exc_state !== "asked") {
    await edit(chat, mid, await requestText(it, it.exc_state === "rejected" ? "❌ انرفض من قبل" : "✅ انفتح من قبل"));
    return "انرد على هذا الطلب من قبل";
  }
  const e = await one("bank_exams", { id: it.exam_id });
  if (choice === "ok") {
    await openException(uid, it.id);
    await update("sched_items", { id: it.id }, { exc_state: "approved", exc_by: uid });
    await edit(chat, mid, await requestText(it, `✅ وافق عليه: ${esc(String(who))}`));
    return "✅ انفتح الامتحان للطالب";
  }
  await update("sched_items", { id: it.id }, { exc_state: "rejected", exc_by: uid });
  await logActivity(it.user_id, `❌ انرفض طلب فتح امتحان ${e?.title ?? ""}`);
  await send(it.user_id, `❌ <b>انرفض طلب فتح امتحان ${esc(e?.title ?? "")}</b>.`);
  await edit(chat, mid, await requestText(it, `❌ رفضه: ${esc(String(who))}`));
  return "❌ انرفض الطلب";
}
