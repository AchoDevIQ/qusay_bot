// الأسئلة العلمية: الطالب يسأل، وكل سؤال ينفتحله موضوع بمجموعة الأساتذة
import { find, insert, kvGet, kvSet, one, remove, setSession, type Row } from "./db.ts";
import { canAsk, logActivity } from "./access.ts";
import { ADMIN_IDS, BTN_ASK, BTN_MYQ, TOKEN } from "./config.ts";
import { answerFromBooklets, autoReady, bookletCfg, replyText } from "./booklets.ts";
import {
  can, centerName, chLabel, chapters, groupId, hoursText, qHours, qOpenNow, qWhere, question, setQ, student, topic, topics,
} from "./data.ts";
import { HOME_PAGE, flowKb, mainKb } from "./keyboards.ts";
import { api, edit, send, upload, type Kb } from "./telegram.ts";
import { btn, chunk, cut, esc, stamp, words } from "./util.ts";
import { startReg } from "./student.ts";

const chaptersKb = async (en: boolean): Promise<Kb> => (await chapters()).map((c) => [btn(chLabel(c, en), `qc:${c.id}`)]);
const isEn = (s: Row | null) => !!s && s.curr === "إنجليزي";

export async function askStart(chat: number, uid: number) {
  const s = await student(uid);
  if (!s) {
    await send(chat, "حتى تسأل، سجّل معلوماتك أول مرة 👇");
    await startReg(chat, uid, "ask");
    return;
  }
  if (HOME_PAGE && !await canAsk(uid)) { await send(chat, "ℹ️ الأسئلة العلمية تنفتح لمن تشتري محاضرات أو امتحانات من 🛒 المتجر."); return; }
  if (!await groupId()) { await send(chat, "⚠️ قسم الأسئلة العلمية غير مفعّل حالياً."); return; }
  if (!await qOpenNow()) { await send(chat, "⏰ <b>استقبال الأسئلة مغلق هسه.</b>\n\n" + hoursText(await qHours())); return; }
  await setSession(uid, "q:pick", {});
  await send(chat, "❓ <b>سؤال علمي</b>\nاختر الفصل:", { kb: await chaptersKb(isEn(s)) });
}

export async function qCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const en = isEn(await student(uid));
  if (d.startsWith("qc:")) {
    const chid = Number(d.slice(3));
    await setSession(uid, "q:pick", { c: chid });
    await edit(chat, mid, "❓ اختر الموضوع:", [...(await topics(chid)).map((t) => [btn(en ? t.en || t.ar : t.ar, `qt:${t.id}`)]), [btn("⬅️ رجوع للفصول", "qb:ch")]]);
  } else if (d === "qb:ch") {
    await edit(chat, mid, "❓ <b>سؤال علمي</b>\nاختر الفصل:", await chaptersKb(en));
  } else if (d.startsWith("qt:")) {
    const t = await topic(Number(d.slice(3)));
    if (!t) return "الموضوع غير موجود";
    if (t.lectures > 0) {
      await setSession(uid, "q:pick", { c: t.chapter_id, t: t.id });
      const lecs = Array.from({ length: t.lectures }, (_, i) => btn(en ? `Lecture ${i + 1}` : `المحاضرة ${i + 1}`, `ql:${t.id}:${i + 1}`));
      await edit(chat, mid, `❓ <b>${esc(en ? t.en || t.ar : t.ar)}</b>\nاختر المحاضرة:`, [...chunk(lecs, 2), [btn("⬅️ رجوع للمواضيع", `qc:${t.chapter_id}`)]]);
    } else await qWrite(chat, uid, mid, t.id, 0, en);
  } else if (d.startsWith("ql:")) {
    const [, tid, lec] = d.split(":");
    const t = await topic(Number(tid));
    if (!t || Number(lec) < 1 || Number(lec) > Math.max(t.lectures, 1)) return "اختر من الأزرار";
    await qWrite(chat, uid, mid, Number(tid), Number(lec), en);
  } else if (d.startsWith("qf:")) {
    const qid = Number(d.slice(3));
    const q = await question(qid);
    if (!q || q.user_id !== uid) return "السؤال غير موجود";
    await setSession(uid, "q:follow", { qid });
    await send(chat, `🔁 اكتب استفسارك على السؤال <b>#${qid}</b> (كتابة أو صورة أو صوت):`, { replyKb: flowKb() });
  } else if (d === "qx:go") {
    // بعد الجواب الآلي: بعده ما فهم، فسؤاله (نفس الصورة) يروح للأستاذ
    const p = JSON.parse(await kvGet(`qauto_${uid}`) || "null");
    if (!p) return "انتهت صلاحية هذا الزر";
    await kvSet(`qauto_${uid}`, "null");
    await api("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [] } });
    await qNewMessage(chat, uid, { message_id: p.mid }, { t: p.t, l: p.l, direct: true });
  } else if (d.startsWith("qok:")) {
    const qid = Number(d.slice(4));
    const q = await question(qid);
    if (!q || q.user_id !== uid) return "السؤال غير موجود";
    await setQ(qid, { status: "closed" });
    await hideTopic(q);
    await api("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [] } });
    await send(chat, `✅ تمام، انغلق السؤال <b>#${qid}</b>. إذا عندك سؤال جديد اضغط «${BTN_ASK}».`);
  } else return "انتهت صلاحية هذا الزر";
  return null;
}

async function qWrite(chat: number, uid: number, mid: number, tid: number, lec: number, en: boolean) {
  const t = (await topic(tid))!;
  await setSession(uid, "q:write", { t: tid, l: lec });
  const where = en ? `${t.en || t.ar} — ${lec ? `Lecture ${lec}` : ""}` : `${t.ar}${lec ? ` — المحاضرة ${lec}` : ""}`;
  await edit(chat, mid, `❓ <b>${esc(where)}</b>`);
  await send(chat, "✍️ هسه <b>اكتب سؤالك</b>، أو أرسل <b>صورة</b> أو <b>تسجيل صوتي</b>:", { replyKb: flowKb() });
}
/** رقم الفصل بالكتاب (1 لـ 5) من فصول الأسئلة */
const chapterNo = async (chapterId: unknown) => Number((await one("chapters", { id: Number(chapterId) }))?.ord) || 0;
/** صورة الطالب من تليجرام */
async function photoOf(m: Row) {
  const best = (m.photo as Row[] | undefined)?.at(-1);
  if (!best) return null;
  const info: any = await api("getFile", { file_id: best.file_id });
  if (!info?.file_path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`).catch(() => null);
  return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
/** الجواب الآلي: إذا الأستاذ حال هذا السؤال بالملازم، الطالب يوصله الحل نفسه بصورة بإطار، ويا زر يوصل سؤاله للأستاذ
 *  إذا بعده ما فهم. إذا نفس الحل وصله قبل، أو ما لگيناه، يرجع false والسؤال يروح للأستاذ */
async function autoAnswer(chat: number, uid: number, m: Row, data: Row, en: boolean) {
  const t = await topic(data.t);
  const n = await chapterNo(t?.chapter_id);
  if (!n || !await autoReady(n)) return false;
  const text = String(m.text ?? m.caption ?? "").trim();
  const image = m.photo ? await photoOf(m) : null;
  if (!n || (!image && !text)) return false;
  const r = await answerFromBooklets({ image: image ?? undefined, text: text || undefined }, n, en ? "en" : "ar");
  if (!r) return false;
  const key = `${r.match.booklet.id}|${r.match.from}`;
  const seen: string[] = JSON.parse(await kvGet(`qseen_${uid}`) || "[]");
  if (seen.includes(key)) return false;
  await kvSet(`qseen_${uid}`, JSON.stringify([...seen, key].slice(-200)));
  await kvSet(`qauto_${uid}`, JSON.stringify({ mid: m.message_id, t: data.t, l: data.l || 0 }));
  await setSession(uid, "", {});
  const caption = replyText((await bookletCfg()).reply);
  const kb = [[btn("❓ بعدني ما فهمت، وصّل سؤالي للأستاذ", "qx:go")]];
  if (!await upload("sendPhoto", { chat_id: String(chat), caption, parse_mode: "HTML", reply_markup: JSON.stringify({ inline_keyboard: kb }) }, "photo", r.image, "answer.jpg", "image/jpeg")) return false;
  await send(chat, "👆", { replyKb: await mainKb(uid) });
  await logActivity(uid, `📘 وصله حل سؤاله من الملزمة (${r.match.booklet.name})`);
  return true;
}

async function topicTitle(q: Row, done = false, follow = false) {
  const s = await student(q.user_id) ?? { name: "طالب" };
  const t = await topic(q.topic_id);
  const name = words(s.name).slice(0, 3).join(" ");
  const where = (t ? `ف${t.chord} ${t.ar}` : "") + (q.lecture ? ` م${q.lecture}` : "");
  const mark = done ? "✅ " : follow ? "🔁 استفسار " : "🔴 ";
  return cut(`${mark}#${q.id} ${name} — ${where}`, 120);
}
/** نحفظ رسائل السؤال والجواب حتى نرجعها إذا الطالب استفسر بعدين */
async function logMsg(qid: number, kind: string, chatId: number, msgId: number | null | undefined) {
  if (msgId) await insert("qmsgs", { qid, kind, chat_id: chatId, msg_id: msgId });
}
/** يخفي موضوع السؤال من المجموعة (السؤال يبقى محفوظ ويرجع إذا الطالب استفسر) */
export async function hideTopic(q: Row) {
  const g = await groupId();
  if (!g || !q.thread_id) return;
  if (!await api("deleteForumTopic", { chat_id: g, message_thread_id: q.thread_id })) {
    await api("editForumTopic", { chat_id: g, message_thread_id: q.thread_id, name: await topicTitle(q, true) });
    await api("closeForumTopic", { chat_id: g, message_thread_id: q.thread_id });
  }
  await setQ(q.id, { thread_id: null });
}
/** زر «تم»: يخلص السؤال، وإذا أكو سؤال ينتظر يطلع زر ينقله إله. أسئلة نفس الطالب أول */
export async function finishQuestion(q: Row) {
  if (!HOME_PAGE) { await hideTopic(q); return "✅ اختفى السؤال"; }
  const g = await groupId();
  const later: number[] = JSON.parse(await kvGet("q_hide_later") || "[]");
  // المواضيع المخلصة قبلها تنحذف هسه. اللي الطالب استفسر عليها ترجعت مفتوحة فتبقى
  for (const id of later) {
    const old = await question(id);
    if (old && old.id !== q.id && old.status !== "open") await hideTopic(old);
  }
  const open = (await find("questions", { status: "open" }, { order: ["id"] })).filter((x) => x.id !== q.id && x.thread_id);
  const next = open.find((x) => x.user_id === q.user_id) ?? open[0];
  if (!next || !g || !String(g).startsWith("-100")) {
    await kvSet("q_hide_later", "[]");
    await hideTopic(q);
    return "✅ تم. ماكو أسئلة ثانية تنتظر";
  }
  // حذف الموضوع هسه يطلعه من الشاشة ويضيع الزر، فينغلق ويتأجل حذفه
  await kvSet("q_hide_later", JSON.stringify([q.id]));
  await api("editForumTopic", { chat_id: g, message_thread_id: q.thread_id, name: await topicTitle(q, true) });
  const who = next.user_id === q.user_id ? "باقي سؤال لنفس الطالب" : `الطالب اللي وراه: ${words((await student(next.user_id))?.name ?? "").slice(0, 3).join(" ")}`;
  await api("sendMessage", {
    chat_id: g, message_thread_id: q.thread_id, parse_mode: "HTML", text: `✅ <b>تم</b>\n${esc(who)}`,
    reply_markup: { inline_keyboard: [[{ text: "➡️ روح للي وراه", url: `https://t.me/c/${String(g).slice(4)}/${next.thread_id}` }]] },
  });
  await api("closeForumTopic", { chat_id: g, message_thread_id: q.thread_id });
  return "✅ تم";
}
async function studentHead(q: Row, s: Row, title: string) {
  const center = s.center_id ? " — " + esc(await centerName(s.center_id)) : "";
  return `${title}\n\n<b>${esc(s.name)}</b>\nالمنهج: ${esc(s.curr)} — ${esc(s.grade)}\nالامتحان: ${esc(s.exam ?? "")}${center}\n📞 <code>${s.phone1}</code>\n\n📍 ${esc(await qWhere(q))}`;
}

/** أول رسالة بالسؤال: يفتح موضوع بالمجموعة وينقلها */
export async function qNewMessage(chat: number, uid: number, m: Row, data: Row) {
  const g = await groupId();
  const s = await student(uid);
  if (!g || !s) {
    await setSession(uid, "", {});
    await send(chat, "⚠️ صار خطأ، حاول مرة ثانية.", { replyKb: await mainKb(uid) });
    return;
  }
  const mg = m.media_group_id;
  if (mg && data.mg === mg && data.qid) {            // باقي صور نفس الألبوم
    const q = (await question(data.qid))!;
    await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: q.thread_id });
    await logMsg(q.id, "q", chat, m.message_id);
    return;
  }
  if (!data.t) return;
  // الجواب الآلي: إذا الأستاذ حال هذا السؤال بالملازم، يوصله الحل ويا زر للأستاذ
  if (!data.direct && await autoAnswer(chat, uid, m, data, s.curr === "إنجليزي")) return;
  const qid = await insert("questions", { user_id: uid, chapter_id: (await topic(data.t))?.chapter_id ?? null, topic_id: data.t, lecture: data.l || 0, status: "open", created: stamp(), updated: stamp() });
  const q = (await question(qid))!;
  const r: any = await api("createForumTopic", { chat_id: g, name: await topicTitle(q) });
  if (!r) {
    await setSession(uid, "", {});
    await send(chat, "⚠️ ما گدرت أوصل سؤالك هسه، حاول بعد شوية.", { replyKb: await mainKb(uid) });
    await remove("questions", { id: qid });
    return;
  }
  const tid = r.message_thread_id;
  await setQ(qid, { thread_id: tid });
  const head = await studentHead(q, s, `❓ <b>سؤال جديد #${qid}</b>`) +
    "\n\n✍️ اكتب جوابك هنا بهذا الموضوع (كتابة أو صورة أو صوت) ويوصل للطالب مباشرة.\nلمن تخلص جوابك اضغط «✅ خلصت» حتى يختفي السؤال من عندك.";
  await api("sendMessage", { chat_id: g, message_thread_id: tid, text: head, parse_mode: "HTML" });
  await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: tid });
  await logMsg(qid, "q", chat, m.message_id);
  await logActivity(uid, `❓ سأل سؤال علمي #${qid}`);
  await setSession(uid, "q:sent", mg ? { qid, mg } : {});
  await send(chat, `✅ <b>وصل سؤالك</b> (رقم <b>#${qid}</b>)\n📍 ${esc(await qWhere(q, s.curr === "إنجليزي"))}\n\nراح يوصلك الجواب هنا بالبوت. وتگدر تشوف أسئلتك من «${BTN_MYQ}».`, { replyKb: await mainKb(uid) });
}

export async function qFollowMessage(chat: number, uid: number, m: Row, data: Row) {
  const q = await question(data.qid ?? 0);
  const g = await groupId();
  await setSession(uid, "", {});
  if (!q || !g) { await send(chat, "⚠️ السؤال غير موجود.", { replyKb: await mainKb(uid) }); return; }
  const s = await student(uid) ?? { name: "طالب", curr: "", grade: "", phone1: "" };
  let tid = q.thread_id;
  if (tid) {                                     // الموضوع بعده موجود: نفتحه ونغير اسمه
    await api("reopenForumTopic", { chat_id: g, message_thread_id: tid });
    await api("editForumTopic", { chat_id: g, message_thread_id: tid, name: await topicTitle(q, false, true) });
  } else {                                       // الموضوع مخفي: نفتح موضوع جديد بيه السؤال الأصلي وجوابك السابق
    const r: any = await api("createForumTopic", { chat_id: g, name: await topicTitle(q, false, true) });
    if (!r) { await send(chat, "⚠️ ما گدرت أوصل استفسارك هسه، حاول بعد شوية.", { replyKb: await mainKb(uid) }); return; }
    tid = r.message_thread_id;
    await setQ(q.id, { thread_id: tid });
    await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: await studentHead(q, s, `🔁 <b>استفسار على سؤال قديم #${q.id}</b>`) });
    const logs = await find("qmsgs", { qid: q.id }, { order: ["id"] });
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
  await setQ(q.id, { status: "open" });
  await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: "━━━━━━━━━━━━\n🔁 <b>الاستفسار الجديد (ما فهم):</b>" });
  await api("copyMessage", { chat_id: g, from_chat_id: chat, message_id: m.message_id, message_thread_id: tid });
  await logMsg(q.id, "q", chat, m.message_id);
  await logActivity(uid, `🔁 استفسر على السؤال #${q.id}`);
  await send(chat, `✅ وصل استفسارك على السؤال <b>#${q.id}</b>. راح يوصلك الجواب هنا.`, { replyKb: await mainKb(uid) });
}

/** رد المدرس أو المساعد داخل موضوع السؤال بالمجموعة */
export async function onGroupMessage(m: Row) {
  const uid = m.from?.id;
  const text = String(m.text ?? "").trim();
  if (text.startsWith("/setgroup")) {
    if (ADMIN_IDS.includes(uid)) {
      await kvSet("q_group", String(m.chat.id));
      await api("sendMessage", { chat_id: m.chat.id, text: "✅ تم ربط هاي المجموعة بالأسئلة العلمية. كل سؤال جديد راح ينفتحله موضوع هنا." });
    }
    return;
  }
  if (m.chat.id !== await groupId() || !m.message_thread_id || !m.is_topic_message) return;
  if (["forum_topic_created", "forum_topic_closed", "forum_topic_reopened", "forum_topic_edited", "new_chat_members", "left_chat_member", "pinned_message"].some((k) => k in m)) return;
  if (text.startsWith("/") || !await can(uid, "q")) return;
  const q = await one("questions", { thread_id: Number(m.message_thread_id) });
  if (!q) return;
  const s = await student(q.user_id) ?? { curr: "عربي" };
  await api("sendMessage", { chat_id: q.user_id, parse_mode: "HTML", text: `💬 <b>جواب سؤالك #${q.id}</b>\n📍 ${esc(await qWhere(q, s.curr === "إنجليزي"))}` });
  const res: any = await api("copyMessage", {
    chat_id: q.user_id, from_chat_id: m.chat.id, message_id: m.message_id,
    reply_markup: { inline_keyboard: [[btn("✅ فهمت", `qok:${q.id}`), btn("🔁 عندي استفسار", `qf:${q.id}`)]] },
  });
  if (res) {
    await logMsg(q.id, "a", q.user_id, res.message_id);
    const first = q.status === "open";
    await setQ(q.id, { status: "answered" });
    await api("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👍" }] });
    if (first) {
      await api("editForumTopic", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, name: await topicTitle(q, true) });
      await api("sendMessage", {
        chat_id: m.chat.id, message_thread_id: m.message_thread_id, parse_mode: "HTML",
        text: "✅ وصل جوابك للطالب.\nإذا خلصت جوابك اضغط الزر حتى يختفي السؤال من عندك.\n(إذا الطالب استفسر بعدين، يرجعلك السؤال نفسه ويا جوابك)",
        reply_markup: { inline_keyboard: [[btn("✅ تم — خلصت هذا السؤال", `qh:${q.id}`)]] },
      });
    }
  } else {
    await api("sendMessage", { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: "⚠️ ما گدرت أوصل الجواب للطالب (ممكن مسوي حظر للبوت)." });
  }
}

export async function myQuestions(chat: number, uid: number) {
  const qs = await find("questions", { user_id: uid }, { order: ["-id"], limit: 10 });
  if (!qs.length) { await send(chat, `ما عندك أسئلة بعد. اضغط «${BTN_ASK}» حتى تسأل.`); return; }
  const st: Record<string, string> = { open: "🟡 بانتظار الجواب", answered: "🟢 تم الجواب", closed: "✅ مغلق" };
  const en = isEn(await student(uid));
  const lines = ["<b>📂 أسئلتك (آخر 10)</b>", "", ...await Promise.all(qs.map(async (q) => `#${q.id} — ${esc(await qWhere(q, en))}\n${st[q.status] ?? ""}`))];
  await send(chat, lines.join("\n\n"), { kb: qs.map((q) => [btn(`🔁 استفسار على #${q.id}`, `qf:${q.id}`)]) });
}
