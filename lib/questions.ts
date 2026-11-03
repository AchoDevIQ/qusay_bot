// الأسئلة العلمية: الطالب يسأل، وكل سؤال ينفتحله موضوع بمجموعة الأساتذة
import { all, get, kvSet, run, setSession, type Row } from "./db.ts";
import { ADMIN_IDS, BTN_ASK, BTN_MYQ } from "./config.ts";
import {
  can, centerName, chLabel, chapters, groupId, hoursText, qHours, qOpenNow, qWhere, question, setQ, student, topic, topics,
} from "./data.ts";
import { flowKb, mainKb } from "./keyboards.ts";
import { api, edit, send, type Kb } from "./telegram.ts";
import { btn, chunk, cut, esc, stamp, words } from "./util.ts";
import { startReg } from "./student.ts";

const chaptersKb = (en: boolean): Kb => chapters().map((c) => [btn(chLabel(c, en), `qc:${c.id}`)]);
const isEn = (s: Row | null) => !!s && s.curr === "إنجليزي";

export async function askStart(chat: number, uid: number) {
  const s = student(uid);
  if (!s) {
    await send(chat, "حتى تسأل، سجّل معلوماتك أول مرة 👇");
    await startReg(chat, uid, "ask");
    return;
  }
  if (!groupId()) { await send(chat, "⚠️ قسم الأسئلة العلمية غير مفعّل حالياً."); return; }
  if (!qOpenNow()) { await send(chat, "⏰ <b>استقبال الأسئلة مغلق هسه.</b>\n\n" + hoursText(qHours())); return; }
  setSession(uid, "q:pick", {});
  await send(chat, "❓ <b>سؤال علمي</b>\nاختر الفصل:", { kb: chaptersKb(isEn(s)) });
}

export async function qCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const en = isEn(student(uid));
  if (d.startsWith("qc:")) {
    const chid = Number(d.slice(3));
    setSession(uid, "q:pick", { c: chid });
    await edit(chat, mid, "❓ اختر الموضوع:", [...topics(chid).map((t) => [btn(en ? t.en || t.ar : t.ar, `qt:${t.id}`)]), [btn("⬅️ رجوع للفصول", "qb:ch")]]);
  } else if (d === "qb:ch") {
    await edit(chat, mid, "❓ <b>سؤال علمي</b>\nاختر الفصل:", chaptersKb(en));
  } else if (d.startsWith("qt:")) {
    const t = topic(Number(d.slice(3)));
    if (!t) return "الموضوع غير موجود";
    if (t.lectures > 0) {
      setSession(uid, "q:pick", { c: t.chapter_id, t: t.id });
      const lecs = Array.from({ length: t.lectures }, (_, i) => btn(en ? `Lecture ${i + 1}` : `المحاضرة ${i + 1}`, `ql:${t.id}:${i + 1}`));
      await edit(chat, mid, `❓ <b>${esc(en ? t.en || t.ar : t.ar)}</b>\nاختر المحاضرة:`, [...chunk(lecs, 2), [btn("⬅️ رجوع للمواضيع", `qc:${t.chapter_id}`)]]);
    } else await qWrite(chat, uid, mid, t.id, 0, en);
  } else if (d.startsWith("ql:")) {
    const [, tid, lec] = d.split(":");
    const t = topic(Number(tid));
    if (!t || Number(lec) < 1 || Number(lec) > Math.max(t.lectures, 1)) return "اختر من الأزرار";
    await qWrite(chat, uid, mid, Number(tid), Number(lec), en);
  } else if (d.startsWith("qf:")) {
    const qid = Number(d.slice(3));
    const q = question(qid);
    if (!q || q.user_id !== uid) return "السؤال غير موجود";
    setSession(uid, "q:follow", { qid });
    await send(chat, `🔁 اكتب استفسارك على السؤال <b>#${qid}</b> (كتابة أو صورة أو صوت):`, { replyKb: flowKb() });
  } else if (d.startsWith("qok:")) {
    const qid = Number(d.slice(4));
    const q = question(qid);
    if (!q || q.user_id !== uid) return "السؤال غير موجود";
    setQ(qid, { status: "closed" });
    await hideTopic(q);
    await api("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [] } });
    await send(chat, `✅ تمام، انغلق السؤال <b>#${qid}</b>. إذا عندك سؤال جديد اضغط «${BTN_ASK}».`);
  } else return "انتهت صلاحية هذا الزر";
  return null;
}

async function qWrite(chat: number, uid: number, mid: number, tid: number, lec: number, en: boolean) {
  const t = topic(tid)!;
  setSession(uid, "q:write", { t: tid, l: lec });
  const where = en ? `${t.en || t.ar} — ${lec ? `Lecture ${lec}` : ""}` : `${t.ar}${lec ? ` — المحاضرة ${lec}` : ""}`;
  await edit(chat, mid, `❓ <b>${esc(where)}</b>`);
  await send(chat, "✍️ هسه <b>اكتب سؤالك</b>، أو أرسل <b>صورة</b> أو <b>تسجيل صوتي</b>:", { replyKb: flowKb() });
}

function topicTitle(q: Row, done = false, follow = false) {
  const s = student(q.user_id) ?? { name: "طالب" };
  const t = topic(q.topic_id);
  const name = words(s.name).slice(0, 3).join(" ");
  const where = (t ? `ف${t.chord} ${t.ar}` : "") + (q.lecture ? ` م${q.lecture}` : "");
  const mark = done ? "✅ " : follow ? "🔁 استفسار " : "🔴 ";
  return cut(`${mark}#${q.id} ${name} — ${where}`, 120);
}
/** نحفظ رسائل السؤال والجواب حتى نرجعها إذا الطالب استفسر بعدين */
function logMsg(qid: number, kind: string, chatId: number, msgId: number | null | undefined) {
  if (msgId) run("INSERT INTO qmsgs(qid, kind, chat_id, msg_id) VALUES(?,?,?,?)", qid, kind, chatId, msgId);
}
/** يخفي موضوع السؤال من المجموعة (السؤال يبقى محفوظ ويرجع إذا الطالب استفسر) */
export async function hideTopic(q: Row) {
  const g = groupId();
  if (!g || !q.thread_id) return;
  if (!await api("deleteForumTopic", { chat_id: g, message_thread_id: q.thread_id })) {
    await api("editForumTopic", { chat_id: g, message_thread_id: q.thread_id, name: topicTitle(q, true) });
    await api("closeForumTopic", { chat_id: g, message_thread_id: q.thread_id });
  }
  setQ(q.id, { thread_id: null });
}
function studentHead(q: Row, s: Row, title: string) {
  const center = s.center_id ? " — " + esc(centerName(s.center_id)) : "";
  return `${title}\n\n<b>${esc(s.name)}</b>\nالمنهج: ${esc(s.curr)} — ${esc(s.grade)}\nالامتحان: ${esc(s.exam ?? "")}${center}\n📞 <code>${s.phone1}</code>\n\n📍 ${esc(qWhere(q))}`;
}

/** أول رسالة بالسؤال: يفتح موضوع بالمجموعة وينقلها */
export async function qNewMessage(chat: number, uid: number, m: Row, data: Row) {
  const g = groupId();
  const s = student(uid);
  if (!g || !s) {
    setSession(uid, "", {});
    await send(chat, "⚠️ صار خطأ، حاول مرة ثانية.", { replyKb: mainKb(uid) });
    return;
  }
  const mg = m.media_group_id;
  if (mg && data.mg === mg && data.qid) {            // باقي صور نفس الألبوم
    const q = question(data.qid)!;
    await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: q.thread_id });
    logMsg(q.id, "q", chat, m.message_id);
    return;
  }
  if (!data.t) return;
  const qid = run("INSERT INTO questions(user_id, chapter_id, topic_id, lecture, status, created, updated) VALUES(?,?,?,?,?,?,?)",
    uid, topic(data.t)?.chapter_id ?? null, data.t, data.l || 0, "open", stamp(), stamp());
  const q = question(qid)!;
  const r: any = await api("createForumTopic", { chat_id: g, name: topicTitle(q) });
  if (!r) {
    setSession(uid, "", {});
    await send(chat, "⚠️ ما گدرت أوصل سؤالك هسه، حاول بعد شوية.", { replyKb: mainKb(uid) });
    run("DELETE FROM questions WHERE id=?", qid);
    return;
  }
  const tid = r.message_thread_id;
  setQ(qid, { thread_id: tid });
  const head = studentHead(q, s, `❓ <b>سؤال جديد #${qid}</b>`) +
    "\n\n✍️ اكتب جوابك هنا بهذا الموضوع (كتابة أو صورة أو صوت) ويوصل للطالب مباشرة.\nلمن تخلص جوابك اضغط «✅ خلصت» حتى يختفي السؤال من عندك.";
  await api("sendMessage", { chat_id: g, message_thread_id: tid, text: head, parse_mode: "HTML" });
  await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: tid });
  logMsg(qid, "q", chat, m.message_id);
  setSession(uid, "q:sent", mg ? { qid, mg } : {});
  await send(chat, `✅ <b>وصل سؤالك</b> (رقم <b>#${qid}</b>)\n📍 ${esc(qWhere(q, s.curr === "إنجليزي"))}\n\nراح يوصلك الجواب هنا بالبوت. وتگدر تشوف أسئلتك من «${BTN_MYQ}».`, { replyKb: mainKb(uid) });
}

export async function qFollowMessage(chat: number, uid: number, m: Row, data: Row) {
  const q = question(data.qid ?? 0);
  const g = groupId();
  setSession(uid, "", {});
  if (!q || !g) { await send(chat, "⚠️ السؤال غير موجود.", { replyKb: mainKb(uid) }); return; }
  const s = student(uid) ?? { name: "طالب", curr: "", grade: "", phone1: "" };
  let tid = q.thread_id;
  if (tid) {                                     // الموضوع بعده موجود: نفتحه ونغير اسمه
    await api("reopenForumTopic", { chat_id: g, message_thread_id: tid });
    await api("editForumTopic", { chat_id: g, message_thread_id: tid, name: topicTitle(q, false, true) });
  } else {                                       // الموضوع مخفي: نفتح موضوع جديد بيه السؤال الأصلي وجوابك السابق
    const r: any = await api("createForumTopic", { chat_id: g, name: topicTitle(q, false, true) });
    if (!r) { await send(chat, "⚠️ ما گدرت أوصل استفسارك هسه، حاول بعد شوية.", { replyKb: mainKb(uid) }); return; }
    tid = r.message_thread_id;
    setQ(q.id, { thread_id: tid });
    await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: studentHead(q, s, `🔁 <b>استفسار على سؤال قديم #${q.id}</b>`) });
    const logs = all("SELECT * FROM qmsgs WHERE qid=? ORDER BY id", q.id);
    let last: string | null = null;
    for (const lg of logs) {
      if (lg.kind !== last) {
        await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: lg.kind === "q" ? "📜 <b>الطالب:</b>" : "💬 <b>جوابك:</b>" });
        last = lg.kind;
      }
      await api("copyMessage", { chat_id: g, from_chat_id: lg.chat_id, message_id: lg.msg_id, message_thread_id: tid });
    }
    if (!logs.length) await api("sendMessage", { chat_id: g, message_thread_id: tid, text: "(السؤال القديم ما محفوظ، لأنه انسأل قبل هذا التحديث)" });
  }
  setQ(q.id, { status: "open" });
  await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: "━━━━━━━━━━━━\n🔁 <b>الاستفسار الجديد (ما فهم):</b>" });
  await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: tid });
  logMsg(q.id, "q", chat, m.message_id);
  await send(chat, `✅ وصل استفسارك على السؤال <b>#${q.id}</b>. راح يوصلك الجواب هنا.`, { replyKb: mainKb(uid) });
}

/** رد المدرس أو المساعد داخل موضوع السؤال بالمجموعة */
export async function onGroupMessage(m: Row) {
  const uid = m.from?.id;
  const text = String(m.text ?? "").trim();
  if (text.startsWith("/setgroup")) {
    if (ADMIN_IDS.includes(uid)) {
      kvSet("q_group", String(m.chat.id));
      await api("sendMessage", { chat_id: m.chat.id, text: "✅ تم ربط هاي المجموعة بالأسئلة العلمية. كل سؤال جديد راح ينفتحله موضوع هنا." });
    }
    return;
  }
  if (m.chat.id !== groupId() || !m.message_thread_id || !m.is_topic_message) return;
  if (["forum_topic_created", "forum_topic_closed", "forum_topic_reopened", "forum_topic_edited", "new_chat_members", "left_chat_member", "pinned_message"].some((k) => k in m)) return;
  if (text.startsWith("/") || !can(uid, "q")) return;
  const q = get("SELECT * FROM questions WHERE thread_id=?", m.message_thread_id);
  if (!q) return;
  const s = student(q.user_id) ?? { curr: "عربي" };
  await api("sendMessage", { chat_id: q.user_id, parse_mode: "HTML", text: `💬 <b>جواب سؤالك #${q.id}</b>\n📍 ${esc(qWhere(q, s.curr === "إنجليزي"))}` });
  const res: any = await api("copyMessage", {
    chat_id: q.user_id, from_chat_id: m.chat.id, message_id: m.message_id,
    reply_markup: { inline_keyboard: [[btn("✅ فهمت", `qok:${q.id}`), btn("🔁 عندي استفسار", `qf:${q.id}`)]] },
  });
  if (res) {
    logMsg(q.id, "a", q.user_id, res.message_id);
    const first = q.status === "open";
    setQ(q.id, { status: "answered" });
    await api("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👍" }] });
    if (first) {
      await api("editForumTopic", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, name: topicTitle(q, true) });
      await api("sendMessage", {
        chat_id: m.chat.id, message_thread_id: m.message_thread_id, parse_mode: "HTML",
        text: "✅ وصل جوابك للطالب.\nإذا خلصت جوابك اضغط الزر حتى يختفي السؤال من عندك.\n(إذا الطالب استفسر بعدين، يرجعلك السؤال نفسه ويا جوابك)",
        reply_markup: { inline_keyboard: [[btn("✅ خلصت — أخفِ السؤال", `qh:${q.id}`)]] },
      });
    }
  } else {
    await api("sendMessage", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: "⚠️ ما گدرت أوصل الجواب للطالب (ممكن مسوي حظر للبوت)." });
  }
}

export async function myQuestions(chat: number, uid: number) {
  const qs = all("SELECT * FROM questions WHERE user_id=? ORDER BY id DESC LIMIT 10", uid);
  if (!qs.length) { await send(chat, `ما عندك أسئلة بعد. اضغط «${BTN_ASK}» حتى تسأل.`); return; }
  const st: Record<string, string> = { open: "🟡 بانتظار الجواب", answered: "🟢 تم الجواب", closed: "✅ مغلق" };
  const en = isEn(student(uid));
  const lines = ["<b>📂 أسئلتك (آخر 10)</b>", "", ...qs.map((q) => `#${q.id} — ${esc(qWhere(q, en))}\n${st[q.status] ?? ""}`)];
  await send(chat, lines.join("\n\n"), { kb: qs.map((q) => [btn(`🔁 استفسار على #${q.id}`, `qf:${q.id}`)]) });
}
