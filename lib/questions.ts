// الأسئلة العلمية: الطالب يسأل، وكل سؤال ينفتحله موضوع بمجموعة الأساتذة
import { LOCK_TEXT, examInProgress } from "./examLock.ts";
import { find, insert, kvGet, kvSet, one, remove, setSession, type Row } from "./db.ts";
import { need } from "./webApi.ts";
import { canAsk, logActivity } from "./access.ts";
import { ADMIN_IDS, BTN_ASK, BTN_MYQ, TOKEN } from "./config.ts";
import { answerFromBooklets, autoReady, bookletCfg, replyText } from "./booklets.ts";
import { qaAnswer, qaCfg, qaReady, saveAnswer, type QaResult } from "./qaBank.ts";
import { QA_FAIL_PERM, backAlert, failAlertDue, failWhy, noteQaFail, retryFails, type QaFail } from "./qaFails.ts";
import {
  can, centerName, chLabel, chapters, groupId, hoursText, qHours, qOpenNow, qWhere, question, setQ, staffIds, student, topic, topics,
} from "./data.ts";
import { HOME_PAGE, adminPageLink, flowKb, mainKb } from "./keyboards.ts";
import { api, edit, send, upload, type Kb } from "./telegram.ts";
import { btn, chunk, cut, esc, stamp, words } from "./util.ts";
import { startReg } from "./student.ts";

/** فصول الطالب اللي مشتري محاضراتها لو امتحاناتها (طلبه 2026-11-24)، وصاحب البوت كل الفصول */
const ORDS = ["الاول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
async function askChapters(uid: number) {
  const all = await chapters();
  if (!HOME_PAGE || ADMIN_IDS.includes(uid)) return all;
  const { ownedChapters } = await import("./notes.ts");
  const labels = (await ownedChapters(uid)).map((l) => l.replace(/[أإآ]/g, "ا"));
  return all.filter((c) => labels.some((l) => l.includes(ORDS[Number(c.ord) - 1] ?? "~")));
}
const chaptersKb = async (en: boolean, uid: number): Promise<Kb> => (await askChapters(uid)).map((c) => [btn(chLabel(c, en), `qc:${c.id}`)]);
const isEn = (s: Row | null) => !!s && s.curr === "إنجليزي";

export async function askStart(chat: number, uid: number) {
  if (await examInProgress(uid)) { await send(chat, LOCK_TEXT); return; }
  const s = await student(uid);
  if (!s) {
    await send(chat, "حتى تسأل، سجّل معلوماتك أول مرة 👇");
    await startReg(chat, uid, "ask");
    return;
  }
  if (HOME_PAGE && !await canAsk(uid)) { await send(chat, "ℹ️ الأسئلة العلمية تنفتح لمن تشتري محاضرات أو امتحانات من 🛒 المتجر."); return; }
  if (!await groupId()) { await send(chat, "⚠️ قسم الأسئلة العلمية غير مفعّل حالياً."); return; }
  if (!await qOpenNow()) { await send(chat, "⏰ <b>استقبال الأسئلة مغلق هسه.</b>\n\n" + hoursText(await qHours())); return; }
  const kbCh = await chaptersKb(isEn(s), uid);
  if (!kbCh.length) { await send(chat, isEn(s) ? "ℹ️ You can ask about the chapters you bought (lectures or exams)." : "ℹ️ تگدر تسأل بالفصول اللي مشتري محاضراتها لو امتحاناتها."); return; }
  await setSession(uid, "q:pick", {});
  await send(chat, "❓ <b>سؤال علمي</b>\nاختر الفصل:", { kb: kbCh });
}

export async function qCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const en = isEn(await student(uid));
  if (d.startsWith("qc:")) {
    const chid = Number(d.slice(3));
    if (!(await askChapters(uid)).some((c) => Number(c.id) === chid)) return en ? "You did not buy this chapter" : "هذا الفصل مو مشتريه";
    await setSession(uid, "q:pick", { c: chid });
    await edit(chat, mid, "❓ اختر الموضوع:", [...(await topics(chid)).map((t) => [btn(en ? t.en || t.ar : t.ar, `qt:${t.id}`)]), [btn("⬅️ رجوع للفصول", "qb:ch")]]);
  } else if (d === "qb:ch") {
    await edit(chat, mid, "❓ <b>سؤال علمي</b>\nاختر الفصل:", await chaptersKb(en, uid));
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
/** الجواب من ملازم Word (كتابة): يدور بالمحاضرة، بعدين بالموضوع، وإذا ما لگاه يحله نظام الذكاء على طريقة الأستاذ.
 *  الطالب يوصله زر يفتح الحل مكتوب مثل الكتاب. إذا ماكو ملازم لهذا الموضوع، يرجع false ويكمل الطريق القديم */
async function qaAuto(chat: number, uid: number, m: Row, data: Row, en: boolean) {
  const t = await topic(data.t);
  const n = await chapterNo(t?.chapter_id);
  if (!t || !n || !await qaReady(n)) return false;
  const text = String(m.text ?? m.caption ?? "").trim();
  const image = m.photo ? await photoOf(m) : null;
  if (!image && !text) return false;
  // ما تطلع رسالة «لحظة»: الطالب يوصله الحل بس
  await api("sendChatAction", { chat_id: chat, action: "typing" });
  let r = null;
  try { r = await qaAnswer({ text: text || undefined, image: image ?? undefined }, n, Number(t.id), Number(data.l) || 0, en ? "en" : "ar", uid); }
  catch (e) { console.error("qa", e); data.aiFail = failWhy(e); }   // الذكاء واقف: السؤال يروح للأستاذ، وصاحب البوت يتبلغ
  if (!r) return false;
  // حل نظام الذكاء (مو من الملزمة): إذا صاحب البوت يريد يشوفه أول، السؤال يروح للأستاذ مثل العادة
  if (r.source === "ai" && !(await qaCfg()).direct) return false;
  await kvSet(`qauto_${uid}`, JSON.stringify({ mid: m.message_id, t: data.t, l: data.l || 0 }));
  await setSession(uid, "", {});
  const later = await deliverQa(chat, uid, r, t, Number(data.l) || 0, en, text, 0, (m.photo as Row[] | undefined)?.at(-1)?.file_id);
  await send(chat, later ? (en ? "✅ Your question arrived. The answer comes to you here." : "✅ وصل سؤالك. راح يوصلك الجواب هنا.") : "👆", { replyKb: await mainKb(uid) });
  return true;
}

/** يوصل للطالب زر «📘 افتح الحل». qid: سؤاله اللي بالمجموعة (الذكاء جاوبه بعد ما رجع يشتغل)، فـ«بعدني ما فهمت» يرجع لنفس السؤال */
async function deliverQa(chat: number, uid: number, r: QaResult, t: Row, l: number, en: boolean, text: string, qid = 0, photo?: string): Promise<boolean> {
  const where = `${t.ar}${l ? ` — المحاضرة ${l}` : ""}`;
  const shown = en ? `${t.en || t.ar}${l ? ` — Lecture ${l}` : ""}` : where;
  // موضوعه ومحاضرته ينحفظن ويا الحل، حتى «🤔 ما فهمت خطوة» ياخذ شرح الأستاذ من نفس الملزمة
  const id = await saveAnswer(uid, text, r, shown, en ? "en" : "ar", { chapter: await chapterNo(t.chapter_id), tid: Number(t.id), lecture: l, ...(photo ? { photo } : {}) });
  const more = en ? "❓ Still not clear: send my question to the teacher" : "❓ بعدني ما فهمت، وصّل سؤالي للأستاذ";
  const kb: Kb = [[{ text: en ? "📘 Open the solution" : "📘 افتح الحل", web_app: { url: `${adminPageLink("answer", uid)}&a=${id}` } }]];
  // صاحب البوت يگدر يخفي «❓ بعدني ما فهمت»
  if ((await qaCfg()).teacherBtn !== false) kb.push([btn(more, qid ? `qf:${qid}` : "qx:go")]);
  const msg = r.source === "teacher"
    ? (en ? "✏️ <b>The teacher solved this question himself</b>\nTap the button to see his solution." : "✏️ <b>سؤالك حله الأستاذ بنفسه</b>\nدوس الزر تشوف حله.")
    : r.source === "notebook"
    ? (en ? "📘 <b>Your question is solved in the teacher's lecture notebook</b>\nTap the button to see his solution." : "📘 <b>سؤالك محلول بدفتر المحاضرات</b>\nدوس الزر تشوف حل الأستاذ.")
    : r.source === "rasid"
    ? (en ? "📝 <b>Your question is in the teacher's Rasid</b>\nTap the button to see his model solution." : "📝 <b>سؤالك موجود بالراصد</b>\nدوس الزر تشوف الحل النموذجي مال الأستاذ.")
    : en
    ? "📘 <b>Here is your solution</b>\nTap the button to see it step by step."
    : "📘 <b>عيوني، تفضل هذا الحل</b>\nدوس الزر تشوف الحل خطوة خطوة.";
  const head = qid ? (en ? `💬 <b>About your question #${qid}</b>\n` : `💬 <b>بخصوص سؤالك #${qid}</b>\n`) : "";
  const later = await notifyAnswer(chat, head + msg, kb, id);
  await logActivity(uid, (qid ? `🔁 #${qid} بعد ما رجع الذكاء: ` : "") + (r.source === "ai" ? `🤖 انحل سؤاله العلمي على طريقة الأستاذ (${where})` : r.source === "rasid" ? `📝 وصله الحل النموذجي من الراصد (${r.rasid?.topic ?? where} ${r.rasid?.q ?? ""})` : r.source === "notebook" ? `📘 وصله حل سؤاله من دفتر المحاضرات (${r.notebook?.where || where} ص${r.notebook?.page ?? ""})` : `📘 وصله حل سؤاله من الملزمة (${where})`));
  return later;
}

// ---------- الذكاء ما جاوب (الرصيد خلص أو الخدمة واقفة): تنبيه لصاحب البوت، والبوت يرجع يجرب وحده
const RETRY_NOW = "qa_retry_now";
async function tellFail(text: string, o: { only?: number; retry?: boolean } = {}) {
  const ids = o.only ? [o.only] : await staffIds(QA_FAIL_PERM);
  for (const id of ids) await send(id, text, o.retry ? { kb: [[btn("🔁 جربهم هسه", "qr:go")]] } : {}).catch((e) => console.error("qa fail alert", id, e));
}
/** للمؤقت كل دقيقة: تنبيه بالطلاب اللي ما جاوبهم الذكاء (يتجمعون، نص ساعة بين تنبيه وتنبيه) */
export async function qaFailTick() {
  const msg = await failAlertDue();
  if (msg) await tellFail(msg, { retry: true });
  return msg ? 1 : 0;
}
/** زر «🔁 جربهم هسه»: التجربة نفسها بالدكة الجاية (تاخذ دقايق، والزر لازم يرد بسرعة) */
export async function qaRetryNow(uid = 0) {
  await kvSet(RETRY_NOW, String(uid || 1));
  return "⏳ خلال دقيقة يجربهم، ويوصلك تنبيه بالنتيجة";
}
/** يجاوب طالب ما جاوبه الذكاء قبل: true وصله الحل، false الذكاء ما لگاله حل (يبقى للأستاذ)، ويرمي خطأ إذا بعده واقف */
async function retryOne(f: QaFail) {
  const t = await topic(f.t);
  const n = await chapterNo(t?.chapter_id);
  if (!t || !n) return false;
  const image = f.photo ? await photoOf({ photo: [{ file_id: f.photo }] }) : null;
  if (f.photo && !image) return false;
  const r = await qaAnswer({ text: f.text || undefined, image: image ?? undefined }, n, Number(t.id), f.l, f.en ? "en" : "ar", f.uid);
  if (!r || (r.source === "ai" && !(await qaCfg()).direct)) return false;
  await deliverQa(f.uid, f.uid, r, t, f.l, f.en, f.text, f.qid);
  // موضوع السؤال بالمجموعة: انجاوب، ما يحتاج الأستاذ يجاوب
  await setQ(f.qid, { status: "answered" });
  const q = await question(f.qid);
  const g = await groupId();
  if (g && q?.thread_id) {
    await api("editForumTopic", { chat_id: g, message_thread_id: q.thread_id, name: await topicTitle(q, true) });
    await api("sendMessage", {
      chat_id: g, message_thread_id: q.thread_id, parse_mode: "HTML",
      text: "🤖 <b>رجع الذكاء يشتغل، وجاوب الطالب هسه.</b>\nما تحتاج تجاوب هذا السؤال. إذا الطالب بعده ما فهم، يرجعلك هنا.",
      reply_markup: { inline_keyboard: [[btn("✅ تم — خلصت هذا السؤال", `qh:${q.id}`)]] },
    });
  }
  return true;
}
/** للمؤقت: يرجع يجرب أسئلة الطلاب اللي ما جاوبهم الذكاء (كل 10 دقايق، أو هسه إذا انداس الزر) */
export async function qaRetryTick() {
  const by = Number(await kvGet(RETRY_NOW)) || 0;
  if (by) await kvSet(RETRY_NOW, "0");
  const open = async (f: QaFail) => { const q = await question(f.qid); return !!q && q.status === "open"; };
  const res = await retryFails(open, retryOne, { force: !!by });
  if (res.answered.length) await tellFail(backAlert(res.answered, res.left));
  else if (by) {
    await tellFail(res.why ? `⚠️ <b>بعده الذكاء ما يشتغل</b>\nالسبب: ${esc(res.why)}\n${res.left} سؤال بعدهم ينتظرون، ويتجربون وحدهم كل 10 دقايق.`
      : res.left ? `ℹ️ ${res.left} سؤال بعدهم ينتظرون، ويتجربون بالدكة الجاية.` : "ℹ️ ماكو أسئلة تنتظر الذكاء: كلها انجاوبت.", { only: by > 1 ? by : 0, retry: !!res.why });
  }
  return { answered: res.answered.length, left: res.left };
}

async function autoAnswer(chat: number, uid: number, m: Row, data: Row, en: boolean) {
  if (await qaAuto(chat, uid, m, data, en)) return true;
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
  const kb = (await qaCfg()).teacherBtn !== false ? [[btn("❓ بعدني ما فهمت، وصّل سؤالي للأستاذ", "qx:go")]] : [];
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
// ---------- ❓ السؤال العلمي بصفحة بشكل الأستاذ (طلبه 2026-11-24: «ما أريده اختيارات بوت»): الفصل والموضوع والمحاضرة
// أزرار، والسؤال كتابة لو صورة. الحل ينفتح بنفس الصفحة، وإذا ما انحل يروح للأستاذ بالمجموعة مثل البوت بالضبط
type AskBody = { tid?: unknown; lec?: unknown; text?: unknown; checked?: unknown };
/** شنو يگدر يختار: فصوله ومواضيعها ومحاضراتها، ولو مقفول ليش */
export async function askInfo(uid: number) {
  const s = await student(uid);
  const en = isEn(s);
  if (!s) return { en, need: "reg" as const };
  if (await examInProgress(uid)) return { en, closed: LOCK_TEXT };
  if (HOME_PAGE && !await canAsk(uid)) return { en, closed: en ? "ℹ️ Scientific questions open when you buy lectures or exams from the 🛒 store." : "ℹ️ الأسئلة العلمية تنفتح لمن تشتري محاضرات أو امتحانات من 🛒 المتجر." };
  if (!await groupId()) return { en, closed: "⚠️ قسم الأسئلة العلمية غير مفعّل حالياً." };
  if (!await qOpenNow()) return { en, closed: "⏰ استقبال الأسئلة مغلق هسه.\n\n" + hoursText(await qHours()).replace(/<[^>]+>/g, "") };
  const chs = await askChapters(uid);
  if (!chs.length) return { en, closed: en ? "ℹ️ You can ask about the chapters you bought (lectures or exams)." : "ℹ️ تگدر تسأل بالفصول اللي مشتري محاضراتها لو امتحاناتها." };
  return {
    en,
    chapters: await Promise.all(chs.map(async (c) => ({
      id: Number(c.id), label: chLabel(c, en),
      topics: (await topics(Number(c.id))).map((t) => ({ id: Number(t.id), name: String(en ? t.en || t.ar : t.ar), lectures: Number(t.lectures) || 0 })),
    }))),
  };
}
/** الطالب دز سؤاله من الصفحة: ينحفظ وينتظر بالطابور (queued). الجواب يوصله بإشعار (طلبه 2026-11-24: «ما نكتب له شيء،
 *  هو يدز السؤال وينتظر، ويوصل إشعار إنه جاوبك»). الطابور يمشي كل دقيقة (askPageTick) */
const ASK_Q = "qa_page_q";
type AskJob = { uid: number; tid: number; lec: number; text: string; img: string; at: string; checked?: boolean };
export async function askFromPage(uid: number, b: AskBody, image: Buffer | null): Promise<{ queued?: boolean; closed?: string }> {
  const info = await askInfo(uid);
  if (!("chapters" in info) || !info.chapters) return { closed: "closed" in info ? info.closed : "سجّل معلوماتك أول" };
  const s = (await student(uid))!;
  const en = isEn(s);
  const t = await topic(Number(b.tid));
  if (!t || !info.chapters.some((c) => c.id === Number(t.chapter_id))) return { closed: en ? "Choose your topic" : "اختار الموضوع" };
  const lec = Number(b.lec) || 0;
  if (t.lectures > 0 && (lec < 1 || lec > t.lectures)) return { closed: en ? "Choose the lecture" : "اختار المحاضرة" };
  const text = String(b.text ?? "").trim().slice(0, 2000);
  if (!text && !image) return { closed: en ? "Write your question or add a photo" : "اكتب سؤالك لو صوّره" };
  // الصورة تنحفظ، حتى إذا گال «بعدني ما فهمت» توصل للأستاذ نفسها
  const { files } = await import("./files.ts");
  const { createHash } = await import("node:crypto");
  const img = image ? `qa/ask/${createHash("sha1").update(image).digest("hex").slice(0, 20)}.jpg` : "";
  if (image) await files().write(img, image, "image/jpeg");
  const q = JSON.parse((await kvGet(ASK_Q)) || "[]") as AskJob[];
  const checked = b.checked === true || b.checked === "1";
  await kvSet(ASK_Q, JSON.stringify([...q, { uid, tid: Number(t.id), lec, text, img, at: stamp(), ...(checked ? { checked } : {}) }]));
  await logActivity(uid, "❓ دز سؤال علمي من الصفحة");
  return { queued: true };
}
/** إشعار الجواب للطالب: مباشرة، لو بعد الساعات اللي اختارها الأستاذ («⏱ متى يوصل الجواب»). true: تأجل */
const DUE = "qa_due";
type Due = { uid: number; text: string; kb: Kb; ans?: string; due: number };
async function notifyAnswer(uid: number, text: string, kb: Kb, ans?: string) {
  const h = Number((await qaCfg()).delayH) || 0;
  if (h <= 0) { await deliverAnswer(uid, text, kb, ans); return false; }
  const l = JSON.parse((await kvGet(DUE)) || "[]") as Due[];
  await kvSet(DUE, JSON.stringify([...l, { uid, text, kb, ...(ans ? { ans } : {}), due: Date.now() + h * 3600_000 }]));
  return true;
}
/** الجواب يوصل ملف PDF بس، بلا كتابة (طلب الأستاذ 2026-11-24)، وتحته فيديو السؤال (التوضيح والحل) إذا إله.
 *  الحل اللي هو صفحات من الملزمة بلا كتابة، لو الملف ما انسوى: الرسالة وزر صفحة الحل مثل قبل */
async function deliverAnswer(uid: number, text: string, kb: Kb, ans?: string) {
  if (ans) { try { if (await sendAnswerPdf(uid, ans)) return; } catch (e) { console.error("answer pdf", uid, e); } }
  await send(uid, text, { kb });
  // فيديو السؤال يوصل حتى ويا الرسالة (الحل صفحات من الملزمة)
  if (ans) { const a = JSON.parse((await kvGet(`qa_ans_${ans}`)) || "null"); if (a) await answerVideos(uid, a).catch((e) => console.error("answer videos", uid, e)); }
}
export async function sendAnswerPdf(uid: number, id: string) {
  const a = JSON.parse((await kvGet(`qa_ans_${id}`)) || "null");
  if (!a || !String(a.solution ?? "").trim()) { if (a) console.error("answer pdf: no written solution", id, a.source); return false; }
  const en = a.lang === "en";
  const { answerPdf } = await import("./documents.ts");
  const pdf = await answerPdf({ name: String((await student(uid))?.name ?? ""), where: String(a.where ?? ""), question: String(a.question || a.asked || ""), solution: String(a.solution), ...(a.similar ? { similar: a.similar } : {}), lang: en ? "en" : "ar", date: stamp() });
  if (!pdf) { console.error("answer pdf: the file was not made", id); return false; }
  const kb: Kb = (await qaCfg()).teacherBtn !== false ? [[btn(en ? "❓ Still not clear: send my question to the teacher" : "❓ بعدني ما فهمت، وصّل سؤالي للأستاذ", `qa2t:${id}`)]] : [];
  const ok = await upload("sendDocument", { chat_id: String(uid), protect_content: "true", ...(kb.length ? { reply_markup: JSON.stringify({ inline_keyboard: kb }) } : {}) }, "document", pdf, en ? "solution.pdf" : "حل_سؤالك.pdf", "application/pdf");
  if (!ok) { console.error("answer pdf: the file was not sent", id); return false; }
  await answerVideos(uid, a);
  return true;
}
/** فيديو السؤال من الدفتر لو الراصد (التوضيح والحل)، ورا ملف الحل */
async function answerVideos(uid: number, a: Row) {
  const { sendMarkVideos, marksFor } = await import("./noteMarks.ts");
  // السؤال المشابه من الدفتر: فيديوهاته (مثل الكنافة)
  if (a.similar?.mark) await sendMarkVideos(uid, Number(a.similar.mark.book), Number(a.similar.mark.mark)).catch((e) => console.error("similar videos", uid, e));
  const book = Number(a.notebook?.book ?? a.rasid?.book ?? 0);
  if (!book) return;
  const ids = a.notebook ? (a.notebook.mark ? [Number(a.notebook.mark)] : []) : (await marksFor(book)).filter((m) => m.page === Number(a.rasid.page)).map((m) => Number(m.id));
  for (const m of ids) await sendMarkVideos(uid, book, m).catch((e) => console.error("answer videos", uid, e));
}
/** «❓ بعدني ما فهمت» تحت ملف الحل: سؤاله (الكتابة والصورة) يروح للأستاذ بالمجموعة، مرة وحدة */
export async function answerToTeacherBot(uid: number, id: string) {
  const key = `qa_ans_${id}`;
  const a = JSON.parse((await kvGet(key)) || "null");
  need(a && a.uid === uid, "الحل غير موجود");
  if (a.sentTo) return Number(a.sentTo);
  const { files } = await import("./files.ts");
  const img = a.img ? await files().read(String(a.img)) : a.photo ? await photoOf({ photo: [{ file_id: a.photo }] }) : null;
  const qid = await toTeacher(uid, Number(a.tid) || 0, Number(a.lecture) || 0, String(a.question || a.asked || ""), img);
  await kvSet(key, JSON.stringify({ ...a, sentTo: qid }));
  return qid;
}
/** كل دقيقة: الأجوبة اللي صار وقتها توصل */
async function dueTick() {
  const l = JSON.parse((await kvGet(DUE)) || "[]") as Due[];
  if (!l.length) return 0;
  const now = Date.now();
  const ready = l.filter((d) => d.due <= now);
  if (!ready.length) return 0;
  await kvSet(DUE, JSON.stringify(l.filter((d) => d.due > now)));
  for (const d of ready) await deliverAnswer(d.uid, d.text, d.kb, d.ans).catch((e) => console.error("qa due", d.uid, e));
  return ready.length;
}
/** كل دقيقة: أسئلة الصفحة تنجاوب (نفس طريق البوت: ملزمتك، الراصد، الدفتر، لو الذكاء)، والحل يوصل بإشعار بزر يفتحه.
 *  اللي ما انحل يروح للأستاذ بالمجموعة */
export async function askPageTick(limit = 4) {
  await dueTick();
  const all = JSON.parse((await kvGet(ASK_Q)) || "[]") as AskJob[];
  if (!all.length) return 0;
  const jobs = all.slice(0, limit);
  await kvSet(ASK_Q, JSON.stringify(all.slice(limit)));
  const { files } = await import("./files.ts");
  for (const j of jobs) {
    try {
      const image = j.img ? await files().read(j.img) : null;
      await answerJob(j, image);
    } catch (e) { console.error("ask page", j.uid, e); }
  }
  return jobs.length;
}
async function answerJob(j: AskJob, image: Buffer | null) {
  const { uid, lec, text, img } = j;
  const s = await student(uid);
  const t = await topic(j.tid);
  if (!s || !t) return;
  const en = isEn(s);
  // الجواب الآلي: نفس اللي بالبوت (ملزمتك، الراصد، الدفتر، لو الذكاء على طريقتك)
  const n = await chapterNo(t.chapter_id);
  let aiFail = "";
  if (n && await qaReady(n)) {
    let r: QaResult | null = null;
    try { r = await qaAnswer({ text: text || undefined, image: image ?? undefined, ...(j.checked ? { checked: true } : {}) }, n, Number(t.id), lec, en ? "en" : "ar", uid); }
    catch (e) { console.error("qa page", e); aiFail = failWhy(e); }
    if (r && (r.source !== "ai" || (await qaCfg()).direct)) {
      const where = `${t.ar}${lec ? ` — المحاضرة ${lec}` : ""}`;
      const shown = en ? `${t.en || t.ar}${lec ? ` — Lecture ${lec}` : ""}` : where;
      const id = await saveAnswer(uid, text, r, shown, en ? "en" : "ar", { chapter: n, tid: Number(t.id), lecture: lec, page: true, ...(img ? { img } : {}) });
      await logActivity(uid, r.source === "ai" ? `🤖 انحل سؤاله العلمي من الصفحة (${where})` : `📘 وصله حل سؤاله من الصفحة (${where}، ${r.source})`);
      // إشعار بالبوت والتطبيق: جواب سؤالك وصل، وزر يفتحه. ما بيه شي يبين منين انحل
      await notifyAnswer(uid, en ? `📘 <b>The answer to your question arrived</b>\n📍 ${esc(shown)}\nTap the button to see it.` : `📘 <b>وصل جواب سؤالك</b>\n📍 ${esc(shown)}\nدوس الزر تشوف الحل.`,
        [[{ text: en ? "📘 Open the answer" : "📘 افتح الجواب", web_app: { url: `${adminPageLink("answer", uid)}&a=${id}` } }]], id);
      return;
    }
  }
  await toTeacher(uid, Number(t.id), lec, text, image, aiFail);
}
/** السؤال يروح للأستاذ بالمجموعة (موضوع جديد بيه الكتابة والصورة)، مثل سؤال البوت بالضبط */
export async function toTeacher(uid: number, tid: number, lec: number, text: string, image: Buffer | null, aiFail = ""): Promise<number> {
  const g = await groupId();
  const s = await student(uid);
  need(g && s, "قسم الأسئلة العلمية غير مفعّل حالياً");
  const qid = await insert("questions", { user_id: uid, chapter_id: (await topic(tid))?.chapter_id ?? null, topic_id: tid, lecture: lec || 0, status: "open", created: stamp(), updated: stamp() });
  const q = (await question(qid))!;
  const r: any = await api("createForumTopic", { chat_id: g, name: await topicTitle(q) });
  if (!r) { await remove("questions", { id: qid }); need(false, "ما گدرت أوصل سؤالك هسه، حاول بعد شوية"); }
  const th = r.message_thread_id;
  await setQ(qid, { thread_id: th });
  const head = await studentHead(q, s!, `❓ <b>سؤال جديد #${qid}</b>`) +
    "\n\n✍️ اكتب جوابك هنا بهذا الموضوع (كتابة أو صورة أو صوت) ويوصل للطالب مباشرة.\nلمن تخلص جوابك اضغط «✅ خلصت» حتى يختفي السؤال من عندك.";
  await api("sendMessage", { chat_id: g, message_thread_id: th, text: head, parse_mode: "HTML" });
  if (image) await upload("sendPhoto", { chat_id: String(g), message_thread_id: String(th), ...(text ? { caption: text.slice(0, 1000) } : {}) }, "photo", image, "question.jpg", "image/jpeg");
  else await api("sendMessage", { chat_id: g, message_thread_id: th, text });
  if (aiFail) await api("sendMessage", { chat_id: g, message_thread_id: th, parse_mode: "HTML", text: `🤖 الذكاء ما گدر يجاوب هذا السؤال (${esc(aiFail)}). جاوبه إنت.` });
  await logActivity(uid, `❓ سأل سؤال علمي #${qid} (من الصفحة)`);
  await send(uid, `✅ <b>وصل سؤالك</b> (رقم <b>#${qid}</b>)\n📍 ${esc(await qWhere(q, isEn(s)))}\n\nراح يوصلك الجواب هنا. وتگدر تشوف أسئلتك من «${BTN_MYQ}».`);
  return qid;
}

export async function qNewMessage(chat: number, uid: number, m: Row, data: Row) {
  // دخل امتحان وهو بنص السؤال: ما يوصل شي لحد ما يخلص
  if (await examInProgress(uid)) { await setSession(uid, "", {}); await send(chat, LOCK_TEXT, { replyKb: await mainKb(uid) }); return; }
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
  if (data.aiFail) {
    await api("sendMessage", { chat_id: g, message_thread_id: tid, parse_mode: "HTML", text: `🤖 الذكاء ما گدر يجاوب هذا السؤال (${esc(String(data.aiFail))}).\nإذا رجع يشتغل خلال يومين، يجاوب الطالب وحده ويكتبلك هنا. وإذا تريد تجاوبه إنت، جاوب عادي.` });
    await noteQaFail({
      qid, uid, name: words(s.name).slice(0, 3).join(" "), where: await qWhere(q), t: Number(data.t), l: Number(data.l) || 0, en: s.curr === "إنجليزي",
      text: String(m.text ?? m.caption ?? "").trim(), photo: String((m.photo as Row[] | undefined)?.at(-1)?.file_id ?? ""), why: String(data.aiFail),
    });
  }
  await logActivity(uid, `❓ سأل سؤال علمي #${qid}`);
  await setSession(uid, "q:sent", mg ? { qid, mg } : {});
  await send(chat, `✅ <b>وصل سؤالك</b> (رقم <b>#${qid}</b>)\n📍 ${esc(await qWhere(q, s.curr === "إنجليزي"))}\n\nراح يوصلك الجواب هنا بالبوت. وتگدر تشوف أسئلتك من «${BTN_MYQ}».`, { replyKb: await mainKb(uid) });
}

export async function qFollowMessage(chat: number, uid: number, m: Row, data: Row) {
  if (await examInProgress(uid)) { await setSession(uid, "", {}); await send(chat, LOCK_TEXT, { replyKb: await mainKb(uid) }); return; }
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
  if (await examInProgress(uid)) { await send(chat, LOCK_TEXT); return; }
  const qs = await find("questions", { user_id: uid }, { order: ["-id"], limit: 10 });
  if (!qs.length) { await send(chat, `ما عندك أسئلة بعد. اضغط «${BTN_ASK}» حتى تسأل.`); return; }
  const st: Record<string, string> = { open: "🟡 بانتظار الجواب", answered: "🟢 تم الجواب", closed: "✅ مغلق" };
  const en = isEn(await student(uid));
  const lines = ["<b>📂 أسئلتك (آخر 10)</b>", "", ...await Promise.all(qs.map(async (q) => `#${q.id} — ${esc(await qWhere(q, en))}\n${st[q.status] ?? ""}`))];
  await send(chat, lines.join("\n\n"), { kb: qs.map((q) => [btn(`🔁 استفسار على #${q.id}`, `qf:${q.id}`)]) });
}
