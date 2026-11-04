// الامتحانات: تنفتح بعد الشراء، مباشرة من المكتبة، أو برمز QR بوصل التوصيل لمن يوصل الطلب
import { randomInt } from "node:crypto";
import { all, get, run, setSession, tx, type Row } from "./db.ts";
import { BTN_EXAMS, STORE_URL } from "./config.ts";
import { can, noteFail, products, tooManyFails } from "./data.ts";
import { chapterLabel, flowKb, mainKb, scanKb } from "./keyboards.ts";
import { api, edit, send, type Kb } from "./telegram.ts";
import { btn, cut, esc, stamp } from "./util.ts";

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
export function grantExams(uid: number, chapters: string[], oid: number | null) {
  for (const ch of chapters) run("INSERT OR IGNORE INTO exam_access(user_id, chapter, order_id, created) VALUES(?,?,?,?)", uid, ch, oid, stamp());
}
const myChapters = (uid: number) => all("SELECT chapter FROM exam_access WHERE user_id=? ORDER BY created, chapter", uid).map((r) => r.chapter as string);
/** الطلبات الجاهزة اللي رمزها لسه ما انستخدم */
const pendingCodes = (uid: number) => all(`SELECT orders.id FROM order_codes JOIN orders ON orders.id=order_codes.order_id
  WHERE orders.user_id=? AND orders.printed=1 AND order_codes.used_at IS NULL ORDER BY orders.id`, uid);
const chaptersText = (chapters: string[]) => chapters.map((c) => "• " + esc(c)).join("\n");

// ---------- البيع من المكتبة: تنفتح مباشرة
/** يرجع الفصول اللي انفتحت حتى البائع يشوفها */
export async function unlockFromSale(sid: number, items: Row[], oid: number) {
  const chapters = chaptersOf(items);
  if (!chapters.length) return chapters;
  grantExams(sid, chapters, oid);
  await send(sid, `🔓 <b>انفتحت امتحاناتك</b>\n${chaptersText(chapters)}\n\nاضغط «${BTN_EXAMS}» حتى تشوفها 👇`, { replyKb: mainKb(sid) });
  return chapters;
}

// ---------- طلب التوصيل: رمز بالوصل
export function createOrderCode(oid: number, items: Row[]) {
  const chapters = chaptersOf(items);
  if (!chapters.length) return null;
  const make = () => "QM-" + Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  let code = make();
  while (get("SELECT 1 FROM order_codes WHERE code=?", code)) code = make();
  run("INSERT INTO order_codes(code, order_id, chapters) VALUES(?,?,?)", code, oid, JSON.stringify(chapters));
  return code;
}
/** زر رسالة «تم تجهيز طلبك»، إذا الطلب بيه امتحانات */
export function readyExtras(oid: number): { text: string; kb?: Kb } {
  if (!get("SELECT 1 FROM order_codes WHERE order_id=? AND used_at IS NULL", oid)) return { text: "" };
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
  if (tooManyFails(FAILS, uid)) { await send(chat, "⚠️ حاولت هوايا برموز غلط. حاول بعد ساعة، أو تواصل ويا قصي العميري."); return; }
  const r = get(`SELECT order_codes.*, orders.user_id, orders.printed FROM order_codes JOIN orders ON orders.id=order_codes.order_id
    WHERE order_codes.code=?`, normalCode(raw));
  if (!r || r.user_id !== uid) {
    noteFail(FAILS, uid);
    await send(chat, "⚠️ هذا الكود غلط، أو مو لطلبك. جرب مرة ثانية، أو اكتب الرمز المطبوع تحت الكود.");
    return;
  }
  if (r.printed === 2) { setSession(uid, "", {}); await send(chat, "⚠️ هذا الطلب ملغي.", { replyKb: mainKb(uid) }); return; }
  if (r.printed !== 1) { await send(chat, "⏳ طلبك لسه ما تجهز. جرب بعد ما يوصلك."); return; }
  setSession(uid, "", {});
  if (r.used_at) { await send(chat, "ℹ️ هذا الكود انستخدم قبل، وامتحاناته مفتوحة عندك.", { replyKb: mainKb(uid) }); await examsMenu(chat, uid); return; }
  const chapters: string[] = JSON.parse(r.chapters);
  tx(() => {
    grantExams(uid, chapters, r.order_id);
    run("UPDATE order_codes SET used_at=? WHERE code=?", stamp(), r.code);
  });
  await send(chat, `🔓 <b>انفتحت امتحاناتك</b>\n${chaptersText(chapters)}`, { replyKb: mainKb(uid) });
  await examsMenu(chat, uid);
}

// ---------- الطالب
export async function examsMenu(chat: number, uid: number) {
  const chapters = myChapters(uid), pend = pendingCodes(uid);
  if (!chapters.length && !pend.length) { await send(chat, "ما عندك امتحانات مفتوحة بعد. تنفتح لمن تشتري امتحانات أي فصل من 🛒 المتجر أو من المكتبة."); return; }
  const kb: Kb = [...chapters.map((c, i) => [btn("📝 " + c, `xc:${i}`)]), ...pend.map((o) => [btn(`📷 وصلني الطلب #${o.id}: افتح الامتحانات`, `xs:${o.id}`)])];
  await send(chat, chapters.length ? "<b>📝 امتحاناتك</b>\nاختر الفصل:" : "<b>📝 امتحاناتك</b>\nلمن يوصلك الطلب، اضغط الزر جوة 👇", { kb });
}
async function deliverExam(chat: number, e: Row) {
  const base = { chat_id: chat, protect_content: true };   // تليجرام يمنع التحويل والحفظ
  const caption = e.title ? { caption: e.title } : {};
  if (e.kind === "document") return api("sendDocument", { ...base, ...caption, document: e.file_id });
  if (e.kind === "photo") return api("sendPhoto", { ...base, ...caption, photo: e.file_id });
  if (e.kind === "video") return api("sendVideo", { ...base, ...caption, video: e.file_id });
  return send(chat, esc(e.body), { extra: { protect_content: true } });
}
export async function examCb(chat: number, uid: number, d: string): Promise<string | null> {
  if (d === "xm") await examsMenu(chat, uid);
  else if (d.startsWith("xs:")) {
    const oid = Number(d.slice(3));
    const o = get(`SELECT orders.printed, order_codes.used_at FROM order_codes JOIN orders ON orders.id=order_codes.order_id
      WHERE orders.id=? AND orders.user_id=?`, oid, uid);
    if (!o) return "الطلب غير موجود";
    if (o.used_at) { await examsMenu(chat, uid); return null; }
    if (o.printed !== 1) return "طلبك لسه ما تجهز";
    setSession(uid, "x:code", { oid });
    await send(chat, (STORE_URL ? "📷 اضغط الزر جوة ووجه الكاميرا على الكود المطبوع بالوصل.\nأو " : "") + "اكتب هنا الرمز المطبوع تحت الكود، مثل <code>QM-ABCD2345</code>:",
      { replyKb: STORE_URL ? scanKb(oid) : flowKb() });
  } else if (d.startsWith("xc:")) {
    const chapters = myChapters(uid);
    const ch = chapters[Number(d.slice(3))];
    if (!ch) return "الفصل غير موجود";
    const es = all("SELECT id, title FROM exams WHERE chapter=? AND active=1 ORDER BY id", ch);
    if (!es.length) { await send(chat, `📝 <b>${esc(ch)}</b>\nلسه ما انضافت امتحانات لهذا الفصل. راح تطلع هنا لمن تنضاف.`); return null; }
    await send(chat, `📝 <b>${esc(ch)}</b>\nاختر الامتحان:`, { kb: [...es.map((e) => [btn(cut(e.title || "امتحان", 60), `xo:${e.id}`)]), [btn("⬅️ رجوع", "xm")]] });
  } else if (d.startsWith("xo:")) {
    const e = get("SELECT * FROM exams WHERE id=? AND active=1", Number(d.slice(3)));
    if (!e || !get("SELECT 1 FROM exam_access WHERE user_id=? AND chapter=?", uid, e.chapter)) return "ما عندك صلاحية";
    await deliverExam(chat, e);
  }
  return null;
}

// ---------- الإدارة
function adminChapters() {
  const labels: string[] = [];
  for (const p of products()) {
    const c = examChapterOf(p.name);
    if (c && !labels.includes(c)) labels.push(c);
  }
  for (const r of all("SELECT DISTINCT chapter FROM exams WHERE active=1 ORDER BY id")) if (!labels.includes(r.chapter)) labels.push(r.chapter);
  return labels;
}
function adminHome(): [string, Kb] {
  const count = (ch: string) => get("SELECT COUNT(*) n FROM exams WHERE chapter=? AND active=1", ch)!.n;
  const labels = adminChapters();
  const kb: Kb = labels.map((c, i) => [btn(`📝 ${c} (${count(c)})`, `a:exc:${i}`)]);
  kb.push([btn("⬅️ رجوع", "a:menu")]);
  return [labels.length ? "<b>📝 الامتحانات</b>\nاختر الفصل حتى تضيف امتحاناته أو تحذفها:"
    : "<b>📝 الامتحانات</b>\nماكو منتجات امتحانات بعد. لازم اسم المنتج يكون بيه «امتحانات» واسم الفصل، مثل: الفصل الأول - امتحانات إلكترونية", kb];
}
function adminChapter(i: number): [string, Kb] {
  const ch = adminChapters()[i];
  if (!ch) return adminHome();
  const es = all("SELECT id, title FROM exams WHERE chapter=? AND active=1 ORDER BY id", ch);
  const kb: Kb = es.map((e) => [btn("🗑 " + cut(e.title || "امتحان", 50), `a:exd:${i}:${e.id}`)]);
  kb.push([btn("➕ إضافة امتحان", `a:exa:${i}`)], [btn("⬅️ رجوع", "a:ex")]);
  return [`<b>📝 ${esc(ch)}</b>\nالامتحانات: ${es.length}\n🗑 يحذف الامتحان.`, kb];
}
export async function examAdminCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const show = ([t, kb]: [string, Kb]) => edit(chat, mid, t, kb);
  if (d === "a:ex") await show(adminHome());
  else if (d.startsWith("a:exc:")) await show(adminChapter(Number(d.slice(6))));
  else if (d.startsWith("a:exa:")) {
    const i = Number(d.slice(6));
    const ch = adminChapters()[i];
    if (!ch) return "الفصل غير موجود";
    setSession(uid, "a:exa", { chapter: ch, i });
    await send(chat, `➕ أرسل امتحان <b>${esc(ch)}</b>: ملف PDF، أو صورة، أو فيديو، أو رابط بنص.\nالكلام اللي تكتبه ويا الملف يصير اسم الامتحان.\nتگدر ترسل أكثر من امتحان، ولمن تخلص اضغط «❌ إلغاء».`, { replyKb: flowKb() });
  } else if (d.startsWith("a:exd:")) {
    const [i, id] = d.slice(6).split(":").map(Number);
    run("UPDATE exams SET active=0 WHERE id=?", id);
    await show(adminChapter(i));
  }
  return null;
}
/** رسالة الإدارة وهي تضيف امتحان. يرجع true إذا عالجها */
export async function examAdminMessage(chat: number, uid: number, m: Row, data: Row) {
  if (!can(uid, "products")) return false;
  const photo = m.photo?.at?.(-1);
  const kind = m.document ? "document" : photo ? "photo" : m.video ? "video" : m.text ? "text" : null;
  if (!kind) { await send(chat, "⚠️ أرسل ملف PDF، أو صورة، أو فيديو، أو نص."); return true; }
  const fileId: string | null = m.document?.file_id ?? photo?.file_id ?? m.video?.file_id ?? null;
  const body: string = String(m.text ?? "");
  const title = cut(String(m.caption ?? "").trim() || String(m.document?.file_name ?? "") || body.trim().split("\n")[0] || "امتحان", 60);
  run("INSERT INTO exams(chapter, title, kind, file_id, body) VALUES(?,?,?,?,?)", data.chapter, title, kind, fileId, body);
  await send(chat, `✅ انضاف «${esc(title)}» إلى ${esc(data.chapter)}.\nأرسل غيره، أو اضغط «❌ إلغاء» إذا خلصت.`);
  return true;
}
