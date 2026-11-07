// الامتحانات: تنفتح بعد الشراء، مباشرة من المكتبة، أو برمز QR بوصل التوصيل لمن يوصل الطلب
import { LOCK_TEXT, examInProgress } from "./examLock.ts";
import { randomInt } from "node:crypto";
import { count, find, insert, insertIgnore, one, setSession, tx, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { BTN_EXAMS, STORE_URL, toLatinDigits } from "./config.ts";
import { noteFail, pendingCodes, tooManyFails } from "./data.ts";
import { chapterLabel, flowKb, mainKb, scanKb } from "./keyboards.ts";
import { send, type Kb } from "./telegram.ts";
import { btn, esc, stamp } from "./util.ts";

const FAILS = "xfail";

/** الفصل اللي يفتحه المنتج، أو null. الدفاتر ورق، والامتحان الحضوري ينقدم بالمركز، فما يفتحون شي بالبوت */
export function examChapterOf(name: string | null | undefined) {
  const n = name ?? "";
  if (!n.includes("امتحانات") || n.includes("دفتر") || n.includes("حضوري")) return null;
  return chapterLabel(n)?.replace("الاول", "الأول") ?? null;
}
export function chaptersOf(items: Row[]) {
  return [...new Set(items.map((i) => examChapterOf(i.name)).filter((c): c is string => !!c))];
}
export async function grantExams(uid: number, chapters: string[], oid: number | null) {
  for (const ch of chapters) await insertIgnore("exam_access", { user_id: uid, chapter: ch }, { order_id: oid, created: stamp() });
}
const myChapters = async (uid: number) => (await find("exam_access", { user_id: uid }, { order: ["created", "chapter"] })).map((r) => r.chapter as string);

const chaptersText = (chapters: string[]) => chapters.map((c) => "• " + esc(c)).join("\n");

// ---------- البيع من المكتبة: تنفتح مباشرة
/** يرجع الفصول اللي انفتحت حتى البائع يشوفها */
export async function unlockFromSale(sid: number, items: Row[], oid: number) {
  const chapters = chaptersOf(items);
  if (!chapters.length) return chapters;
  await grantExams(sid, chapters, oid);
  await send(sid, `🔓 <b>انفتحت امتحاناتك</b>\n${chaptersText(chapters)}\n\nاضغط «${BTN_EXAMS}» حتى تشوفها 👇`, { replyKb: await mainKb(sid) });
  return chapters;
}

// ---------- طلب التوصيل: رمز بالوصل
export async function createOrderCode(oid: number, items: Row[]) {
  const chapters = chaptersOf(items);
  if (!chapters.length) return null;
  // أرقام بس حتى ما يخربط بالكابيتال والسمول. الرمز يشتغل لصاحب الطلب فقط، والمحاولات محدودة
  const make = () => String(randomInt(100000, 1000000));
  let code = make();
  while (await one("order_codes", { code })) code = make();
  await insert("order_codes", { code, order_id: oid, chapters: JSON.stringify(chapters) });
  return code;
}
/** زر رسالة «تم تجهيز طلبك»، إذا الطلب بيه امتحانات */
export async function readyExtras(oid: number): Promise<{ text: string; kb?: Kb }> {
  if (!await one("order_codes", { order_id: oid, used_at: null })) return { text: "" };
  return {
    text: "\n\n📝 طلبك بيه امتحانات. <b>لمن يوصلك الطلب</b> اضغط الزر جوة، ووجه الكاميرا على الكود المطبوع بالوصل، وتنفتح امتحاناتك.",
    kb: [[btn("📷 وصلني الطلب: افتح الامتحانات", `xs:${oid}`)]],
  };
}
function normalCode(raw: string) {
  const c = toLatinDigits(raw).trim().toUpperCase().replace(/[\s-]/g, "").replace(/^QM/, "");
  return /^\d+$/.test(c) ? c : "QM-" + c;   // الوصولات القديمة بيها حروف
}
/** الرمز يشتغل بس لصاحب الطلب، وبعد ما يتجهز الطلب */
export async function redeemCode(chat: number, uid: number, raw: string) {
  if (await tooManyFails(FAILS, uid)) { await send(chat, "⚠️ حاولت هوايا برموز غلط. حاول بعد ساعة، أو تواصل ويا قصي العميري."); return; }
  const c = await one("order_codes", { code: normalCode(raw) });
  const ord = c && await one("orders", { id: c.order_id });
  const r: Row | null = ord ? { ...c!, user_id: ord.user_id, printed: ord.printed } : null;
  if (!r || r.user_id !== uid) {
    await noteFail(FAILS, uid);
    await send(chat, "⚠️ هذا الكود غلط، أو مو لطلبك. جرب مرة ثانية، أو اكتب الرمز المطبوع تحت الكود.");
    return;
  }
  if (r.printed === 2) { await setSession(uid, "", {}); await send(chat, "⚠️ هذا الطلب ملغي.", { replyKb: await mainKb(uid) }); return; }
  if (r.printed !== 1) { await send(chat, "⏳ طلبك لسه ما تجهز. جرب بعد ما يوصلك."); return; }
  await setSession(uid, "", {});
  if (r.used_at) { await send(chat, "ℹ️ هذا الكود انستخدم قبل، وامتحاناته مفتوحة عندك.", { replyKb: await mainKb(uid) }); await examsMenu(chat, uid); return; }
  const chapters: string[] = JSON.parse(r.chapters);
  await tx(async () => {
    await grantExams(uid, chapters, r.order_id);
    await update("order_codes", { code: r.code }, { used_at: stamp() });
  });
  await logActivity(uid, `🔓 فتح امتحانات ${chapters.join("، ")} برمز الوصل`);
  await send(chat, `🔓 <b>انفتحت امتحاناتك</b>\n${chaptersText(chapters)}`, { replyKb: await mainKb(uid) });
  await examsMenu(chat, uid);
}

// ---------- الطالب
export async function examsMenu(chat: number, uid: number) {
  if (await examInProgress(uid)) { await send(chat, LOCK_TEXT); return; }
  const chapters = await myChapters(uid), pend = await pendingCodes(uid);
  if (!chapters.length && !pend.length) { await send(chat, "ما عندك امتحانات مفتوحة بعد. تنفتح لمن تشتري امتحانات أي فصل من 🛒 المتجر أو من المكتبة."); return; }
  const kb: Kb = [...chapters.map((c, i) => [btn("📝 " + c, `xc:${i}`)]), ...pend.map((o) => [btn(`📷 وصلني الطلب #${o.id}: افتح الامتحانات`, `xs:${o.id}`)])];
  await send(chat, chapters.length ? "<b>📝 امتحاناتك</b>\nاختر الفصل:" : "<b>📝 امتحاناتك</b>\nلمن يوصلك الطلب، اضغط الزر جوة 👇", { kb });
}
export async function examCb(chat: number, uid: number, d: string): Promise<string | null> {
  if (d === "xm") await examsMenu(chat, uid);
  else if (d.startsWith("xs:")) {
    const oid = Number(d.slice(3));
    const ord = await one("orders", { id: oid, user_id: uid });
    const c = ord && await one("order_codes", { order_id: oid });
    if (!c) return "الطلب غير موجود";
    const o = { printed: ord!.printed, used_at: c.used_at };
    if (o.used_at) { await examsMenu(chat, uid); return null; }
    if (o.printed !== 1) return "طلبك لسه ما تجهز";
    await setSession(uid, "x:code", { oid });
    await send(chat, (STORE_URL ? "📷 اضغط الزر جوة ووجه الكاميرا على الكود المطبوع بالوصل.\nأو " : "") + "اكتب هنا الرمز المطبوع تحت الكود، مثل <code>482917</code>:",
      { replyKb: STORE_URL ? scanKb(oid) : flowKb() });
  } else if (d.startsWith("xc:")) {
    const chapters = await myChapters(uid);
    const ch = chapters[Number(d.slice(3))];
    if (!ch) return "الفصل غير موجود";
    const n = await count("bank_exams", { chapter: ch });
    await send(chat, `📝 <b>${esc(ch)}</b>\nعدد الامتحانات: ${n}\nجدول امتحاناتك راح يطلع هنا.`, { kb: [[btn("⬅️ رجوع", "xm")]] });
  }
  return null;
}
