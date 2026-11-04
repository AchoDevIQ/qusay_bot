// الامتحانات: تنفتح بعد الشراء، مباشرة من المكتبة، أو برمز QR بوصل التوصيل لمن يوصل الطلب
import { randomInt } from "node:crypto";
import { all, get, run, setSession, tx, type Row } from "./db.ts";
import { BTN_EXAMS, STORE_URL } from "./config.ts";
import { noteFail, tooManyFails } from "./data.ts";
import { chapterLabel, flowKb, mainKb, scanKb } from "./keyboards.ts";
import { send, type Kb } from "./telegram.ts";
import { btn, esc, stamp } from "./util.ts";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون 0 وO و1 وI حتى ما تتشابه بالقراءة
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
  for (const ch of chapters) await run("INSERT OR IGNORE INTO exam_access(user_id, chapter, order_id, created) VALUES(?,?,?,?)", uid, ch, oid, stamp());
}
const myChapters = async (uid: number) => (await all("SELECT chapter FROM exam_access WHERE user_id=? ORDER BY created, chapter", uid)).map((r) => r.chapter as string);
/** الطلبات الجاهزة اللي رمزها لسه ما انستخدم */
const pendingCodes = async (uid: number) => await all(`SELECT orders.id FROM order_codes JOIN orders ON orders.id=order_codes.order_id
  WHERE orders.user_id=? AND orders.printed=1 AND order_codes.used_at IS NULL ORDER BY orders.id`, uid);
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
  const make = () => "QM-" + Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  let code = make();
  while (await get("SELECT 1 FROM order_codes WHERE code=?", code)) code = make();
  await run("INSERT INTO order_codes(code, order_id, chapters) VALUES(?,?,?)", code, oid, JSON.stringify(chapters));
  return code;
}
/** زر رسالة «تم تجهيز طلبك»، إذا الطلب بيه امتحانات */
export async function readyExtras(oid: number): Promise<{ text: string; kb?: Kb }> {
  if (!await get("SELECT 1 FROM order_codes WHERE order_id=? AND used_at IS NULL", oid)) return { text: "" };
  return {
    text: "\n\n📝 طلبك بيه امتحانات. <b>لمن يوصلك الطلب</b> اضغط الزر جوة، ووجه الكاميرا على الكود المطبوع بالوصل، وتنفتح امتحاناتك.",
    kb: [[btn("📷 وصلني الطلب: افتح الامتحانات", `xs:${oid}`)]],
  };
}
function normalCode(raw: string) {
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, "").replace(/^QM/, "");
  return "QM-" + c;
}
/** الرمز يشتغل بس لصاحب الطلب، وبعد ما يتجهز الطلب */
export async function redeemCode(chat: number, uid: number, raw: string) {
  if (await tooManyFails(FAILS, uid)) { await send(chat, "⚠️ حاولت هوايا برموز غلط. حاول بعد ساعة، أو تواصل ويا قصي العميري."); return; }
  const r = await get(`SELECT order_codes.*, orders.user_id, orders.printed FROM order_codes JOIN orders ON orders.id=order_codes.order_id
    WHERE order_codes.code=?`, normalCode(raw));
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
    await run("UPDATE order_codes SET used_at=? WHERE code=?", stamp(), r.code);
  });
  await send(chat, `🔓 <b>انفتحت امتحاناتك</b>\n${chaptersText(chapters)}`, { replyKb: await mainKb(uid) });
  await examsMenu(chat, uid);
}

// ---------- الطالب
export async function examsMenu(chat: number, uid: number) {
  const chapters = await myChapters(uid), pend = await pendingCodes(uid);
  if (!chapters.length && !pend.length) { await send(chat, "ما عندك امتحانات مفتوحة بعد. تنفتح لمن تشتري امتحانات أي فصل من 🛒 المتجر أو من المكتبة."); return; }
  const kb: Kb = [...chapters.map((c, i) => [btn("📝 " + c, `xc:${i}`)]), ...pend.map((o) => [btn(`📷 وصلني الطلب #${o.id}: افتح الامتحانات`, `xs:${o.id}`)])];
  await send(chat, chapters.length ? "<b>📝 امتحاناتك</b>\nاختر الفصل:" : "<b>📝 امتحاناتك</b>\nلمن يوصلك الطلب، اضغط الزر جوة 👇", { kb });
}
export async function examCb(chat: number, uid: number, d: string): Promise<string | null> {
  if (d === "xm") await examsMenu(chat, uid);
  else if (d.startsWith("xs:")) {
    const oid = Number(d.slice(3));
    const o = await get(`SELECT orders.printed, order_codes.used_at FROM order_codes JOIN orders ON orders.id=order_codes.order_id
      WHERE orders.id=? AND orders.user_id=?`, oid, uid);
    if (!o) return "الطلب غير موجود";
    if (o.used_at) { await examsMenu(chat, uid); return null; }
    if (o.printed !== 1) return "طلبك لسه ما تجهز";
    await setSession(uid, "x:code", { oid });
    await send(chat, (STORE_URL ? "📷 اضغط الزر جوة ووجه الكاميرا على الكود المطبوع بالوصل.\nأو " : "") + "اكتب هنا الرمز المطبوع تحت الكود، مثل <code>QM-ABCD2345</code>:",
      { replyKb: STORE_URL ? scanKb(oid) : flowKb() });
  } else if (d.startsWith("xc:")) {
    const chapters = await myChapters(uid);
    const ch = chapters[Number(d.slice(3))];
    if (!ch) return "الفصل غير موجود";
    const n = (await get(`SELECT COUNT(*) n FROM bank_exams WHERE chapter=?`, ch))!.n;
    await send(chat, `📝 <b>${esc(ch)}</b>\nعدد الامتحانات: ${n}\nجدول امتحاناتك راح يطلع هنا.`, { kb: [[btn("⬅️ رجوع", "xm")]] });
  }
  return null;
}
