// نقطة دخول كل رسالة/ضغطة زر من تليجرام
import { getSession, initDb, kvGet, kvSet, one, setSession, type Row } from "./db.ts";
import { BTN_ADMIN, BTN_ASK, BTN_CANCEL, BTN_EXAMS, BTN_EXIT_GRADER, BTN_EXIT_VIEW, BTN_ME, BTN_MYQ, BTN_OFFICE, BTN_REG, BTN_SHOP, WELCOME, toLatinDigits } from "./config.ts";
import { examBankMessage } from "./examBank.ts";
import { examCb, examsMenu, redeemCode } from "./exams.ts";
import { exceptionCb } from "./lateRequest.ts";
import { invitePrompt, inviteCb, reviewCb } from "./competition.ts";
import { allowed, can, isStaff, myOffice, noteFail, question, searchStudents, setGraderView, setStudentView, student, tooManyFails, viewingAsGrader, viewingAsStudent } from "./data.ts";
import { ADMIN_IDS, WEBHOOK_SECRET } from "./config.ts";
import { guardianSeen, onMemberUpdate } from "./guardianWatch.ts";
import { isGuardian, linkGuardian, notForChatText } from "./access.ts";
import { HOME_PAGE, mainKb, regKb } from "./keyboards.ts";
import { api, answerCb, send } from "./telegram.ts";
import { btn, esc } from "./util.ts";
import { adminMenuFor, onAdminCb, onAdminText } from "./admin.ts";
import { joinOfficeByCode, officeCb, officeMenu, onPosSale, quickSearch } from "./office.ts";
import { askStart, finishQuestion, myQuestions, onGroupMessage, qCb, qFollowMessage, qNewMessage } from "./questions.ts";
import {
  onRegForm, onStoreOrder, onStudentCb, onStudentText, openShop, orderCancelCb, regCb, regText, sendBanner, showMe, startReg,
} from "./student.ts";

const CANCEL_TEXTS = ["/cancel", BTN_CANCEL, "❌ إلغاء الطلب"];

async function onMessage(m: Row) {
  const chat: number = m.chat.id, uid: number | undefined = m.from?.id;
  if (m.chat.type === "group" || m.chat.type === "supergroup") return await onGroupMessage(m);
  if (m.chat.type !== "private" || !uid) return;
  if (m.web_app_data) {
    const raw = String(m.web_app_data.data ?? "");
    let o: any = {};
    try { o = JSON.parse(raw); } catch { /* يوصل لـ onStoreOrder ويرد بخطأ */ }
    if (o?.k === "reg") return await onRegForm(chat, uid, o, m.from);
    if (o?.k === "pos") return await onPosSale(chat, uid, o);
    if (o?.k === "scan") return await redeemCode(chat, uid, String(o.code ?? ""));
    return await onStoreOrder(chat, uid, raw, m.from);
  }
  const text = String(m.text ?? "").trim();
  const { state: st, data } = await getSession(uid);
  if (text === "/start") {
    await setSession(uid, "", { cart: data.cart ?? {} });
    if (HOME_PAGE) {
      // كل الشرح داخل الصفحات. الرسالة هنا بس تحمل الزر
      const fresh = !await student(uid) && !await isStaff(uid) && !await myOffice(uid) && !await isGuardian(uid);
      if (fresh) await setSession(uid, "r:form", { next: null, edit: false });
      await sendBanner(chat, "أهلا بك في <b>QMath</b> 🌷", fresh ? await regKb(uid) : await mainKb(uid));
      return;
    }
    await sendBanner(chat, WELCOME, await mainKb(uid));
    if (!await student(uid)) await startReg(chat, uid, null);
    return;
  }
  if (text.startsWith("/start par_")) {
    const r = await linkGuardian(uid, text.slice(text.indexOf("par_") + 4).trim());
    if (r.error) { await send(chat, r.error); return; }
    await setSession(uid, "", {});
    await send(chat, `✅ <b>تم الربط بنجاح</b>\nصرتوا مربوطين ويا الطالب: <b>${esc(r.name)}</b>\nدرجاته راح توصلكم هنا أول بأول. ما تحتاجون تسوون شي ثاني 🌷`, { replyKb: await mainKb(uid) });
    await send(chat, await notForChatText());
    await send(r.sid!, "✅ انربط ولي أمرك. افتح القائمة وكمل 🌷");
    return;
  }
  if ((text === BTN_EXIT_VIEW && await viewingAsStudent(uid)) || (text === BTN_EXIT_GRADER && await viewingAsGrader(uid))) {
    await setStudentView(uid, false);
    await setGraderView(uid, false);
    await setSession(uid, "", {});
    const [t, kb] = await adminMenuFor(uid);
    await send(chat, "✅ رجعت لحسابك الإداري.", { replyKb: await mainKb(uid) });
    await send(chat, t, { kb });
    return;
  }
  const idWord = text.toLowerCase().split("@")[0].replace(/^[/ ]+|[/ ]+$/g, "").replace(/ /g, "");
  if (["myid", "id", "رقمي", "ايدي", "آيدي"].includes(idWord)) { await send(chat, `رقم حسابك: <code>${uid}</code>`); return; }
  if (text.startsWith("/start grp_")) return await invitePrompt(chat, uid, text.slice(text.indexOf("grp_") + 4).trim());
  if (text.startsWith("/start lib_")) return await joinOfficeByCode(chat, uid, text.slice(text.indexOf("lib_") + 4).trim(), m.from ?? {});
  const digits = toLatinDigits(text).replace(/ /g, "");
  if (/^\d{8}$/.test(digits)) {
    if (await kvGet("libinv_" + digits) && !await tooManyFails("invfail", uid)) return await joinOfficeByCode(chat, uid, digits, m.from ?? {});
    if (!await isStaff(uid)) await noteFail("invfail", uid);
  }
  if (text === BTN_SHOP) {
    if (!st.startsWith("a:")) await setSession(uid, "", { cart: data.cart ?? {} });
    return await openShop(chat, uid);
  }
  if (text === BTN_ASK) { await setSession(uid, "", {}); return await askStart(chat, uid); }
  if (text === BTN_MYQ) return await myQuestions(chat, uid);
  if (text === BTN_ME) return await showMe(chat, uid);
  if (text === BTN_EXAMS) return await examsMenu(chat, uid);
  if (text === BTN_OFFICE && await myOffice(uid)) { await setSession(uid, "", {}); return await officeMenu(chat, uid); }
  if (st === "o:pos" && text && !CANCEL_TEXTS.includes(text) && await myOffice(uid)) {
    const res = await searchStudents(text);
    if (!res.length) { await send(chat, "ما لگيت طالب بهذا الاسم أو الرقم. اكتب مرة ثانية، أو الطالب لازم يسجل بالبوت أول."); return; }
    await send(chat, "اختار الطالب 👇", { kb: res.map((x) => [btn(`👤 ${x.name} — ${x.phone1}`, `of:ps:${x.user_id}`)]) });
    return;
  }
  if (CANCEL_TEXTS.includes(text)) {
    await setSession(uid, "", {});
    await send(chat, "❌ تم الإلغاء.", { replyKb: await mainKb(uid) });
    return;
  }
  if (st === "x:code") {
    if (!text) { await send(chat, "⚠️ اكتب الرمز المطبوع بالوصل."); return; }
    return await redeemCode(chat, uid, text);
  }
  if (await isStaff(uid)) {
    if (text === "/admin" || text.startsWith(BTN_ADMIN)) {
      await setSession(uid, "", {});
      const [t, kb] = await adminMenuFor(uid);
      await send(chat, t, { kb });
      return;
    }
    if (st.startsWith("a:ex") && await examBankMessage(chat, uid, m, st, data)) return;
    if (st.startsWith("a:") && text && await onAdminText(chat, uid, text, st, data)) return;
  }
  // ولي الأمر يكتب أو يدز صورة للبوت: البوت مو للمراسلة، ويطلعله معرف الأستاذ
  if (!text.startsWith("/start") && await isGuardian(uid) && !await student(uid) && !await isStaff(uid) && !await myOffice(uid)) {
    await send(chat, await notForChatText());
    return;
  }
  if (st === "q:write" || (st === "q:sent" && m.media_group_id && data.mg === m.media_group_id)) {
    return await qNewMessage(chat, uid, m, st === "q:write" ? data : { ...data, t: null });
  }
  if (st === "q:follow") return await qFollowMessage(chat, uid, m, data);
  if (st === "r:form") {
    await send(chat, `👇 اضغط زر «${BTN_REG}» اللي جوة حتى تملأ معلوماتك.`, { replyKb: await regKb(uid) });
    return;
  }
  if (st.startsWith("r:")) {
    if (!text) { await send(chat, "⚠️ اكتب نص فقط."); return; }
    return await regText(chat, uid, text, st, data);
  }
  if (!text) { await send(chat, "⚠️ اكتب نص فقط."); return; }
  if ((st === "" || st === "cart") && !text.startsWith("/") && (await isStaff(uid) || await myOffice(uid))) return await quickSearch(chat, uid, text);
  return await onStudentText(chat, uid, text, st, data);
}

async function onCallback(q: Row) {
  const uid: number = q.from.id;
  const m = q.message ?? {};
  const chat: number = m.chat?.id ?? uid, mid: number = m.message_id;
  const d = String(q.data ?? "");
  const { state: st, data } = await getSession(uid);
  let note: string | null = null;
  if (d.startsWith("gs:")) {
    note = d === "gs:done" ? "✅ مستلمة" : await guardianSeen(uid, Number(d.slice(3)));
    if (d !== "gs:done" && note.startsWith("✅")) {
      if (mid) await api("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [[{ text: "✅ استلمت", callback_data: "gs:done" }]] } });
      // الدرجة اللي كانت تنتظر هذا الاستلام توصل هسه
      try { const it = await one("sched_items", { id: Number(d.slice(3)) }); const { releaseHeld } = await import("./gradeApi.ts"); if (it) await releaseHeld(Number(it.user_id)); } catch (e) { console.error(e); }
    }
  } else if (d.startsWith("a:")) {
    note = await allowed(uid, d) ? await onAdminCb(chat, uid, mid, d) : "ما عندك صلاحية";
  } else if (["rc:", "rg:", "rv:", "rd:", "rx:", "ra:", "rb:", "rn:", "rs:"].includes(d.slice(0, 3))) {
    note = await regCb(chat, uid, mid, d, st, data, q.from);
  } else if (d.startsWith("of:")) {
    note = await officeCb(chat, uid, d);
  } else if (d.startsWith("qh:")) {
    if (await can(uid, "q")) {
      const qq = await question(Number(d.slice(3)));
      note = qq ? await finishQuestion(qq) : "✅ اختفى السؤال";
    } else note = "ما عندك صلاحية";
  } else if (["qc:", "qb:", "qt:", "ql:", "qf:", "qok:", "qx:"].some((p) => d.startsWith(p))) {
    note = await qCb(chat, uid, mid, d);
  } else if (["oc:", "ocy:", "ocn:"].some((p) => d.startsWith(p))) {
    note = await orderCancelCb(chat, uid, mid, d);
  } else if (d === "xm" || ["xs:", "xc:"].some((p) => d.startsWith(p))) {
    note = await examCb(chat, uid, d);
  } else if (d.startsWith("cj:")) {
    note = await inviteCb(chat, uid, mid, d);
  } else if (d.startsWith("cg:")) {
    note = await reviewCb(chat, uid, mid, d);
  } else if (d.startsWith("ek:")) {
    note = await exceptionCb(chat, uid, mid, d);
  } else if (d === "me:edit") {
    note = "لتغيير معلوماتك تواصل ويا قصي العميري";
    if (!await student(uid)) await startReg(chat, uid, null);
  } else {
    note = await onStudentCb(chat, uid, mid, d, st, data, q.from);
  }
  await answerCb(q.id, note ?? undefined);
}

/** على السيرفر: نطلب من تليگرام يخبرنا منو يحظر البوت (my_chat_member)، حتى ينكشف بلوك ولي الأمر */
async function watchBlocks() {
  if (!process.env.K_SERVICE || !WEBHOOK_SECRET) return;
  const info: any = await api("getWebhookInfo");
  const types: string[] = info?.allowed_updates ?? [];
  if (!info?.url || types.includes("my_chat_member")) return;
  await api("setWebhook", { url: info.url, secret_token: WEBHOOK_SECRET, allowed_updates: [...new Set([...(types.length ? types : ["message", "callback_query"]), "my_chat_member"])] });
}

let ready = false;
export async function handleUpdate(u: any) {
  if (!ready) {
    await initDb();
    ready = true;
    const me: any = await api("getMe");
    if (me?.username) await kvSet("bot_username", me.username);
    await watchBlocks();
  }
  if (u.message) await onMessage(u.message);
  else if (u.callback_query) await onCallback(u.callback_query);
  else if (u.my_chat_member) await onMemberUpdate(u.my_chat_member);
}

// حماية من الإغراق: اللي يرسل أكثر من الحد تنهمل رسائله الزايدة، حتى ما يعطل البوت على الباقين
const RATE_WINDOW_MS = 10_000, RATE_MAX = 20, QUEUE_MAX = 2000;
const recent = new Map<number, number[]>();
export function allowUpdate(uid: number | undefined, now = Date.now()) {
  if (!uid || ADMIN_IDS.includes(uid)) return true;
  if (recent.size > 10_000) recent.clear();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const ok = hits.length < RATE_MAX;
  if (ok) hits.push(now);
  recent.set(uid, hits);
  return ok;
}

// تليجرام يرسل الرسائل بالتوازي؛ ننفذها وحدة وحدة حتى ما تتداخل حالات الجلسة (مثل صور الألبوم)
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;
// تليجرام يعيد نفس الرسالة إذا تأخر الرد، فما تتنفذ مرتين
const seenUpdates = new Set<number>();
export function enqueueUpdate(u: any) {
  const uid: number | undefined = u.message?.from?.id ?? u.callback_query?.from?.id;
  if (u.update_id !== undefined) {
    if (seenUpdates.has(u.update_id)) return tail;
    if (seenUpdates.size > 5000) seenUpdates.clear();
    seenUpdates.add(u.update_id);
  }
  if (pending >= QUEUE_MAX || !allowUpdate(uid)) return tail;
  pending++;
  tail = tail.then(async () => await handleUpdate(u)).catch((e) => console.error("handleUpdate error", e)).finally(() => { pending--; });
  return tail;
}
