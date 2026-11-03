// نقطة دخول كل رسالة/ضغطة زر من تليجرام
import { getSession, initDb, kvGet, kvSet, setSession, type Row } from "./db.ts";
import { BTN_ADMIN, BTN_ASK, BTN_CANCEL, BTN_ME, BTN_MYQ, BTN_OFFICE, BTN_REG, BTN_SHOP, WELCOME, toLatinDigits } from "./config.ts";
import { allowed, can, isStaff, myOffice, question, searchStudents, student } from "./data.ts";
import { mainKb, regKb } from "./keyboards.ts";
import { api, answerCb, send } from "./telegram.ts";
import { btn } from "./util.ts";
import { adminMenuFor, onAdminCb, onAdminText } from "./admin.ts";
import { joinOfficeByCode, officeCb, officeMenu, onPosSale, quickSearch } from "./office.ts";
import { askStart, hideTopic, myQuestions, onGroupMessage, qCb, qFollowMessage, qNewMessage } from "./questions.ts";
import {
  onRegForm, onStoreOrder, onStudentCb, onStudentText, openShop, orderCancelCb, regCb, regText, sendBanner, showMe, startReg,
} from "./student.ts";

const CANCEL_TEXTS = ["/cancel", BTN_CANCEL, "❌ إلغاء الطلب"];

async function onMessage(m: Row) {
  const chat: number = m.chat.id, uid: number | undefined = m.from?.id;
  if (m.chat.type === "group" || m.chat.type === "supergroup") return onGroupMessage(m);
  if (m.chat.type !== "private" || !uid) return;
  if (m.web_app_data) {
    const raw = String(m.web_app_data.data ?? "");
    let o: any = {};
    try { o = JSON.parse(raw); } catch { /* يوصل لـ onStoreOrder ويرد بخطأ */ }
    if (o?.k === "reg") return onRegForm(chat, uid, o, m.from);
    if (o?.k === "pos") return onPosSale(chat, uid, o);
    return onStoreOrder(chat, uid, raw, m.from);
  }
  const text = String(m.text ?? "").trim();
  const { state: st, data } = getSession(uid);
  if (text === "/start") {
    setSession(uid, "", { cart: data.cart ?? {} });
    await sendBanner(chat, WELCOME, mainKb(uid));
    if (!student(uid)) await startReg(chat, uid, null);
    return;
  }
  const idWord = text.toLowerCase().split("@")[0].replace(/^[/ ]+|[/ ]+$/g, "").replace(/ /g, "");
  if (["myid", "id", "رقمي", "ايدي", "آيدي"].includes(idWord)) { await send(chat, `رقم حسابك: <code>${uid}</code>`); return; }
  if (text.startsWith("/start lib_")) return joinOfficeByCode(chat, uid, text.slice(text.indexOf("lib_") + 4).trim(), m.from ?? {});
  const digits = toLatinDigits(text).replace(/ /g, "");
  if (/^\d{6}$/.test(digits) && kvGet("libinv_" + digits)) return joinOfficeByCode(chat, uid, digits, m.from ?? {});
  if (text === BTN_SHOP) {
    if (!st.startsWith("a:")) setSession(uid, "", { cart: data.cart ?? {} });
    return openShop(chat, uid);
  }
  if (text === BTN_ASK) { setSession(uid, "", {}); return askStart(chat, uid); }
  if (text === BTN_MYQ) return myQuestions(chat, uid);
  if (text === BTN_ME) return showMe(chat, uid);
  if (text === BTN_OFFICE && myOffice(uid)) { setSession(uid, "", {}); return officeMenu(chat, uid); }
  if (st === "o:pos" && text && !CANCEL_TEXTS.includes(text) && myOffice(uid)) {
    const res = searchStudents(text);
    if (!res.length) { await send(chat, "ما لگيت طالب بهذا الاسم أو الرقم. اكتب مرة ثانية، أو الطالب لازم يسجل بالبوت أول."); return; }
    await send(chat, "اختار الطالب 👇", { kb: res.map((x) => [btn(`👤 ${x.name} — ${x.phone1}`, `of:ps:${x.user_id}`)]) });
    return;
  }
  if (CANCEL_TEXTS.includes(text)) {
    setSession(uid, "", {});
    await send(chat, "❌ تم الإلغاء.", { replyKb: mainKb(uid) });
    return;
  }
  if (isStaff(uid)) {
    if (text === "/admin" || text.startsWith(BTN_ADMIN)) {
      setSession(uid, "", {});
      const [t, kb] = adminMenuFor(uid);
      await send(chat, t, { kb });
      return;
    }
    if (st.startsWith("a:") && text && await onAdminText(chat, uid, text, st, data)) return;
  }
  if (st === "q:write" || (st === "q:sent" && m.media_group_id && data.mg === m.media_group_id)) {
    return qNewMessage(chat, uid, m, st === "q:write" ? data : { ...data, t: null });
  }
  if (st === "q:follow") return qFollowMessage(chat, uid, m, data);
  if (st === "r:form") {
    await send(chat, `👇 اضغط زر «${BTN_REG}» اللي جوة حتى تملأ معلوماتك.`, { replyKb: regKb(uid) });
    return;
  }
  if (st.startsWith("r:")) {
    if (!text) { await send(chat, "⚠️ اكتب نص فقط."); return; }
    return regText(chat, uid, text, st, data);
  }
  if (!text) { await send(chat, "⚠️ اكتب نص فقط."); return; }
  if ((st === "" || st === "cart") && !text.startsWith("/") && (isStaff(uid) || myOffice(uid))) return quickSearch(chat, uid, text);
  return onStudentText(chat, uid, text, st, data);
}

async function onCallback(q: Row) {
  const uid: number = q.from.id;
  const m = q.message ?? {};
  const chat: number = m.chat?.id ?? uid, mid: number = m.message_id;
  const d = String(q.data ?? "");
  const { state: st, data } = getSession(uid);
  let note: string | null = null;
  if (d.startsWith("a:")) {
    note = allowed(uid, d) ? await onAdminCb(chat, uid, mid, d) : "ما عندك صلاحية";
  } else if (["rc:", "rg:", "rv:", "rd:", "rx:", "ra:", "rb:", "rn:", "rs:"].includes(d.slice(0, 3))) {
    note = await regCb(chat, uid, mid, d, st, data, q.from);
  } else if (d.startsWith("of:")) {
    note = await officeCb(chat, uid, d);
  } else if (d.startsWith("qh:")) {
    if (can(uid, "q")) {
      const qq = question(Number(d.slice(3)));
      if (qq) await hideTopic(qq);
      note = "✅ اختفى السؤال";
    } else note = "ما عندك صلاحية";
  } else if (["qc:", "qb:", "qt:", "ql:", "qf:", "qok:"].some((p) => d.startsWith(p))) {
    note = await qCb(chat, uid, mid, d);
  } else if (["oc:", "ocy:", "ocn:"].some((p) => d.startsWith(p))) {
    note = await orderCancelCb(chat, uid, mid, d);
  } else if (d === "me:edit") {
    note = "لتغيير معلوماتك تواصل ويا قصي العميري";
    if (!student(uid)) await startReg(chat, uid, null);
  } else {
    note = await onStudentCb(chat, uid, mid, d, st, data, q.from);
  }
  await answerCb(q.id, note ?? undefined);
}

let ready = false;
export async function handleUpdate(u: any) {
  if (!ready) {
    initDb();
    ready = true;
    const me: any = await api("getMe");
    if (me?.username) kvSet("bot_username", me.username);
  }
  if (u.message) await onMessage(u.message);
  else if (u.callback_query) await onCallback(u.callback_query);
}

// تليجرام يرسل الرسائل بالتوازي؛ ننفذها وحدة وحدة حتى ما تتداخل حالات الجلسة (مثل صور الألبوم)
let tail: Promise<unknown> = Promise.resolve();
export function enqueueUpdate(u: any) {
  tail = tail.then(() => handleUpdate(u)).catch((e) => console.error("handleUpdate error", e));
  return tail;
}
