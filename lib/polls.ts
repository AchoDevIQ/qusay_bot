// التصويت: صاحب البوت (أو المساعد اللي عنده صلاحية 🗳) يسوي تصويت بسؤال وكم اختيار، ويختار منو يصوت:
// الكل، أو مراكز معينة، أو بنين بس أو بنات بس. البوت يدزه لكل طالب من الفئة بالمحادثة.
// الطالب يصوت من حسابه بس (حساب تليجرام اللي مسجل بيه)، ومرة وحدة: يختار، يطلعله «متأكد؟»، يدوس نعم، وصوته يتثبت.
// لما ينتهي التصويت توصل النتيجة كاملة (الأسماء والعدد والنسبة) لصاحب البوت، ويسأله يظهرها للطلاب لو لا.
// إذا وافق، يوصل للطلاب النسب بس، بدون أسماء ولا أعداد.
// (2026-11-22) الفئة صارت تنختار بالمنهج (عربي/إنجليزي) والفصل اللي شاريه هم. الطالب يصوت من صفحة «🗳 التصويت» بالتطبيق والبوت،
// ورابط لكل تصويت ينحط بقناة التليگرام. وكل اختيار يگدر يكون إله شغل: بعد ما ينتهي، «⚡ طبّق على المصوتين» يسويه لكل اللي اختاروه
import { CURRS, GENDERS, ORD_AR } from "./config.ts";
import { find, insert, one, put, remove, tx, update, type Row } from "./db.ts";
import { can, staffIds } from "./data.ts";
import { checkDevice } from "./deviceLock.ts";
import { adminPageLink, siteBase } from "./keyboards.ts";
import { edit, send, sendMany, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { authed, ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const POLL_PERM = "polls";
/** رقم «بدون مركز» بقائمة المراكز: طلاب الإلكتروني */
export const NO_CENTER = -1;
const MAX_OPTIONS = 10;
const TG_MAX = 3900;

/** شغل يتسوى لكل اللي اختاروا هذا الاختيار، بعد ما ينتهي التصويت */
export const POLL_ACTS: Record<string, string> = {
  early_with: "🚀 يبدي الفصل الجاي هسه، ويا المراجعات",
  early_without: "🚀 يبدي الفصل الجاي هسه، بدون المراجعات",
  // نفس اختيار الطالب «📱 أمتحن بالآيباد» بجدوله (ipad_exam_<رقمه>): بالمركز ما تنطبعله ورقة، ويكتب بالقلم بالآيباد
  ipad: "📝 يمتحن بالآيباد (الحضوري)",
};
/** شنو صار لمن انطبق: كم واحد انثبت، ومنو ما انثبت وليش، ومنو استثناه صاحب البوت */
export type Applied = { at: string; ok: number; fail: { id: number; name: string; why: string }[]; skipped?: { id: number; name: string }[]; running?: boolean };
/** شنو شاري: lec محاضرات بس، exam امتحانات بس، both الاثنين. الفئة تختار واحد أو أكثر، وبدونها كل المسجلين */
export const BUYS: Record<string, string> = { lec: "محاضرات بس", exam: "امتحانات بس", both: "محاضرات وامتحانات" };
/** curr: المنهج، chapters: الفصول (الطالب شاري واحد منها على الأقل)، buys: شنو شاري، acts: شغل كل اختيار، reach: كم طالب بالفئة وقت ما انرسل */
export type Poll = { id: number; question: string; options: string[]; centers: number[]; gender: string; curr: string; chapters: string[]; buys: string[]; acts: string[]; applied: Applied | null; reach: number | null; status: "open" | "closed"; created: string; closed_at: string; shown: boolean | null };
const arr = (v: unknown) => { try { const j = JSON.parse(String(v ?? "[]")); return Array.isArray(j) ? j : []; } catch { return []; } };
const pollOf = (r: Row): Poll => ({
  id: r.id, question: String(r.question ?? ""), options: arr(r.options).map(String), centers: arr(r.centers).map(Number),
  gender: String(r.gender ?? ""), curr: String(r.curr ?? ""), chapters: arr(r.chapters).map(String), buys: arr(r.buys).map(String).filter((b) => BUYS[b]),
  acts: arr(r.acts).map((a) => (POLL_ACTS[String(a)] ? String(a) : "")), applied: appliedOf(r.applied), reach: r.reach == null ? null : Number(r.reach),
  status: r.status === "closed" ? "closed" : "open", created: String(r.created ?? ""), closed_at: String(r.closed_at ?? ""),
  shown: r.shown === 1 ? true : r.shown === 0 ? false : null,
});
function appliedOf(v: unknown): Applied | null {
  try { const j = JSON.parse(String(v ?? "null")); return j && typeof j.at === "string" ? { at: j.at, ok: Number(j.ok) || 0, fail: Array.isArray(j.fail) ? j.fail : [], ...(Array.isArray(j.skipped) && j.skipped.length ? { skipped: j.skipped } : {}), ...(j.running ? { running: true } : {}) } : null; } catch { return null; }
}
export async function getPoll(id: number) { const r = await one("polls", { id }); return r ? pollOf(r) : null; }

/** الطالب من فئة هذا التصويت؟ كل شرط مختار لازم ينطبق: المركز، الجنس، المنهج، والفصل (شاري واحد من الفصول المختارة) */
export async function inTarget(p: Poll, s: Row | null | undefined) {
  if (!s) return false;
  if (p.centers.length && !p.centers.includes(s.center_id ?? NO_CENTER)) return false;
  if (p.gender && s.gender !== p.gender) return false;
  if (p.curr && s.curr !== p.curr) return false;
  if (p.chapters.length) {
    const { ownedChapters } = await import("./notes.ts");
    const mine = new Set(await ownedChapters(Number(s.user_id)));
    if (!p.chapters.some((c) => mine.has(c))) return false;
  }
  if (p.buys.length && !p.buys.includes(await buyKind(Number(s.user_id)))) return false;
  return true;
}
/** شنو شاري هالسنة الدراسية: محاضرات، امتحانات، لو الاثنين (من البوت والتطبيق، نفس اللي يحسب خصم طالب العام).
 *  الامتحانات كذلك من تفعيل الامتحانات (exam_access). ما شاري شي = "" */
export async function buyKind(uid: number): Promise<string> {
  const { boughtIn, retSettings, schoolYear } = await import("./returnDisc.ts");
  const kinds = [...await boughtIn(uid, schoolYear(stamp(), (await retSettings()).start))].map((k) => k.split("|")[1]);
  const exam = kinds.includes("exams") || (await find("exam_access", { user_id: uid })).length > 0;
  const lec = kinds.includes("lectures");
  return exam && lec ? "both" : exam ? "exam" : lec ? "lec" : "";
}
async function targets(p: Poll) {
  const out: Row[] = [];
  for (const s of await find("students")) if (await inTarget(p, s)) out.push(s);
  return out;
}
/** أسماء الفصول للاختيار: نفس اللي بالإشعارات و«شنو يشوف الطالب» */
async function chapterNames() {
  return (await find("chapters")).filter((c) => c.active !== 0).sort((a, b) => Number(a.ord) - Number(b.ord)).map((_, i) => `الفصل ${ORD_AR[i]}`);
}
/** رابط التصويت للقناة: يفتح التطبيق، أو البوت */
export const pollLink = (id: number) => `${siteBase()}/v/${id}`;

/** أسماء المراكز (ويا منطقتها إذا الاسم ما بي المنطقة) */
export async function centerNames() {
  const areas = new Map((await find("areas")).map((a) => [a.id as number, String(a.name ?? "")]));
  const out = new Map<number, string>([[NO_CENTER, "الإلكتروني (بدون مركز)"]]);
  for (const c of await find("centers")) {
    const n = String(c.name ?? ""), a = areas.get(c.area_id) ?? "";
    out.set(c.id, a && !n.includes(a) ? `${n} (${a})` : n);
  }
  return out;
}
export async function targetLabel(p: Poll) {
  const names = await centerNames();
  const where = p.centers.length ? p.centers.map((c) => names.get(c) ?? `مركز ${c}`).join("، ") : "كل الطلاب";
  return [where, p.gender && `${p.gender} بس`, p.curr && `منهج ${p.curr}`, p.chapters.length && `شاري ${p.chapters.join(" أو ")}`, p.buys.length && `شاري ${p.buys.map((b) => BUYS[b]).join(" أو ")}`].filter(Boolean).join(" · ");
}

/** النسب تنجمع 100 بالضبط (الباقي يروح للأكبر كسراً) */
export function percents(counts: number[]) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total), out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; if (counts[i]) { out[i]++; left--; } }
  return out;
}

/** النتيجة كاملة: كل اختيار وعدده ونسبته والأسماء */
export async function resultsOf(p: Poll) {
  const votes = await find("poll_votes", { poll_id: p.id }, { order: ["at"] });
  const names = await centerNames();
  const studs = new Map((await find("students")).map((s) => [s.user_id as number, s]));
  const counts = p.options.map((_, i) => votes.filter((v) => v.choice === i).length);
  const pct = percents(counts);
  // الفئة اللي بيها فصول تاخذ وقت تنحسب، فعددها ينحفظ وقت الإرسال
  const reach = p.reach ?? (await targets(p)).length;
  return {
    voted: votes.length, targets: reach,
    options: p.options.map((o, i) => ({
      text: o, count: counts[i], pct: pct[i],
      names: votes.filter((v) => v.choice === i).map((v) => {
        const s = studs.get(v.user_id);
        const c = s ? names.get(s.center_id ?? NO_CENTER) ?? "" : "";
        return { id: v.user_id as number, name: String(s?.name ?? `طالب ${v.user_id}`), where: c, at: String(v.at ?? "") };
      }),
    })),
  };
}

// ---------- رسائل الطالب
const pollText = (p: Poll) => `🗳 <b>تصويت</b>\n\n${esc(p.question)}\n\n👇 اختار جوابك. تگدر تصوت مرة وحدة بس، ومن حسابك هذا.`;
const pollKb = (p: Poll): Kb => p.options.map((o, i) => [{ text: o, callback_data: `pv:${p.id}:${i}` }]);
const votedText = (p: Poll, choice: number) => `🗳 <b>تصويت</b>\n\n${esc(p.question)}\n\n✅ انحسب صوتك: <b>${esc(p.options[choice] ?? "")}</b>\nشكراً إلك.`;
export const sendPollTo = (p: Poll, uid: number) => send(uid, pollText(p), { kb: pollKb(p) });

/** التصويتات المفتوحة لهذا الطالب اللي بعده ما صوت بيها */
export async function openFor(uid: number) {
  const s = await one("students", { user_id: uid });
  if (!s) return [];
  const mine = new Set((await find("poll_votes", { user_id: uid })).map((v) => v.poll_id as number));
  const out: Poll[] = [];
  for (const p of (await find("polls", { status: "open" }, { order: ["id"] })).map(pollOf)) if (!mine.has(p.id) && await inTarget(p, s)) out.push(p);
  return out;
}

/** يحسب الصوت: مرة وحدة لكل حساب، حتى لو داس مرتين بنفس اللحظة. يرجع ok والرسالة */
async function castVote(p: Poll, uid: number, choice: number): Promise<{ ok: boolean; msg: string }> {
  if (await one("poll_votes", { poll_id: p.id, user_id: uid })) return { ok: false, msg: "صوتت قبل، والصوت ما يتغير" };
  if (p.status !== "open") return { ok: false, msg: "التصويت انتهى" };
  if (!await inTarget(p, await one("students", { user_id: uid }))) return { ok: false, msg: "هذا التصويت مو إلك" };
  if (!(Number.isInteger(choice) && choice >= 0 && choice < p.options.length)) return { ok: false, msg: "اختيار غير معروف" };
  const ok = await tx(async () => {
    if (await one("poll_votes", { poll_id: p.id, user_id: uid })) return false;
    await put("poll_votes", { poll_id: p.id, user_id: uid, choice, at: stamp() });
    return true;
  });
  return ok ? { ok, msg: "✅ انحسب صوتك" } : { ok, msg: "صوتت قبل، والصوت ما يتغير" };
}

/** أزرار التصويت بالمحادثة: pv اختيار، pk تأكيد، pb رجوع، pr صاحب البوت يقرر يظهر النتيجة */
export async function pollCb(chat: number, uid: number, mid: number, d: string): Promise<string> {
  const [kind, idS, chS] = d.split(":");
  const p = await getPoll(Number(idS));
  if (kind === "pr") return await decideShow(chat, uid, mid, p, chS === "1");
  if (!p) { if (mid) await edit(chat, mid, "🗳 هذا التصويت انشال."); return "هذا التصويت انشال"; }
  const done = await one("poll_votes", { poll_id: p.id, user_id: uid });
  if (done) { if (mid) await edit(chat, mid, votedText(p, done.choice)); return "صوتت قبل، والصوت ما يتغير"; }
  if (p.status !== "open") { if (mid) await edit(chat, mid, `🗳 <b>تصويت</b>\n\n${esc(p.question)}\n\n🔒 التصويت انتهى.`); return "التصويت انتهى"; }
  if (!await inTarget(p, await one("students", { user_id: uid }))) return "هذا التصويت مو إلك";
  const choice = Number(chS);
  if (kind === "pb") { if (mid) await edit(chat, mid, pollText(p), pollKb(p)); return ""; }
  if (!(Number.isInteger(choice) && choice >= 0 && choice < p.options.length)) return "اختيار غير معروف";
  if (kind === "pv") {
    if (mid) await edit(chat, mid, `🗳 ${esc(p.question)}\n\nاخترت: <b>${esc(p.options[choice])}</b>\n\n❓ <b>هل أنت متأكد؟</b> بعد ما تأكد ما تگدر تغير صوتك.`,
      [[{ text: "✅ نعم، متأكد", callback_data: `pk:${p.id}:${choice}` }], [{ text: "↩️ لا، ارجع للاختيارات", callback_data: `pb:${p.id}` }]]);
    return "";
  }
  // pk: يتثبت
  const r = await castVote(p, uid, choice);
  const now = await one("poll_votes", { poll_id: p.id, user_id: uid });
  if (mid) await edit(chat, mid, votedText(p, now?.choice ?? choice));
  return r.msg;
}

// ---------- النتيجة
/** رسالة النتيجة الكاملة لصاحب البوت والمساعدين: الأسماء والعدد والنسبة */
async function fullText(p: Poll) {
  const r = await resultsOf(p);
  const head = [`🗳 <b>انتهى التصويت</b>`, esc(p.question), `👥 ${esc(await targetLabel(p))}`, `صوّت <b>${r.voted}</b> من ${r.targets} طالب`, ""];
  const blocks = r.options.map((o, i) => [`<b>${i + 1}. ${esc(o.text)}</b> · ${o.count} صوت (${o.pct}%)`, ...o.names.map((n) => `• ${esc(n.name)}${n.where ? ` · ${esc(n.where)}` : ""}`)]);
  let text = head.join("\n"), cut = false;
  for (const b of blocks) for (const [j, line] of b.entries()) {
    if (cut && j > 0) continue;
    if (text.length + line.length + 60 > TG_MAX && j > 0) { cut = true; continue; }
    text += `\n${line}`;
    if (j === b.length - 1) text += "\n";
  }
  if (cut) text += "\n… الأسماء كاملة بصفحة التصويت.";
  return text.trim();
}
/** النسب بس، للطلاب */
async function shareText(p: Poll) {
  const r = await resultsOf(p);
  return [`🗳 <b>نتيجة التصويت</b>`, "", esc(p.question), "", ...r.options.map((o) => `• ${esc(o.text)}: <b>${o.pct}%</b>`)].join("\n");
}
const askShowKb = (p: Poll): Kb => [
  [{ text: "📢 نعم، اظهرها للطلاب", callback_data: `pr:${p.id}:1` }, { text: "🙈 لا", callback_data: `pr:${p.id}:0` }],
  [{ text: "🗳 افتح التصويت", web_app: { url: adminPageLink("polls") } }],
];

/** ينهي التصويت ويدز النتيجة الكاملة لصاحب البوت واللي عندهم الصلاحية، ويسألهم يظهروها للطلاب */
export async function closePoll(id: number) {
  const n = await update("polls", { id, status: "open" }, { status: "closed", closed_at: stamp() });
  const p = await getPoll(id);
  if (!n || !p) return 0;
  const acted = p.acts.some(Boolean) ? (await find("poll_votes", { poll_id: p.id })).filter((v) => p.acts[Number(v.choice)]).length : 0;
  const todo = acted ? `\n\n⚡ <b>${acted} طالب صوتوا لاختيار بيه شغل.</b> تريد تطبّقه عليهم؟ افتح التصويت ودوس «⚡ طبّق على المصوتين»، وتگدر تستثني أي واحد.` : "";
  const text = `${await fullText(p)}${todo}\n\n❓ <b>تريد تظهر النتيجة للطلاب؟</b> يوصلهم النسب بس، بدون أسماء ولا أعداد.`;
  let sent = 0;
  for (const to of await staffIds(POLL_PERM)) { try { if (await send(to, text, { kb: askShowKb(p) })) sent++; } catch (e) { console.error(e); } }
  return sent;
}

/** يدز النسب لكل طلاب الفئة. مرة وحدة بس */
async function publish(p: Poll) {
  const ok = await tx(async () => {
    const r = await one("polls", { id: p.id });
    if (!r || r.shown === 1) return false;
    await update("polls", { id: p.id }, { shown: 1 });
    return true;
  });
  if (!ok) return -1;
  const text = await shareText(p);
  return await sendMany((await targets(p)).map((s) => s.user_id as number), (uid) => send(uid, text));
}

async function decideShow(chat: number, uid: number, mid: number, p: Poll | null, show: boolean) {
  if (!await can(uid, POLL_PERM)) return "ما عندك صلاحية";
  if (!p) return "هذا التصويت انشال";
  if (p.status !== "closed") return "التصويت بعده مفتوح";
  const head = await fullText(p);
  if (!show) {
    if (p.shown !== true) await update("polls", { id: p.id }, { shown: 0 });
    if (mid) await edit(chat, mid, `${head}\n\n🙈 النتيجة ما انعرضت للطلاب. تگدر تنشرها بعدين من صفحة التصويت.`, [[{ text: "🗳 افتح التصويت", web_app: { url: adminPageLink("polls") } }]]);
    return "ما انعرضت للطلاب";
  }
  const n = await publish(p);
  if (mid) await edit(chat, mid, `${head}\n\n📢 النتيجة (النسب بس) انرسلت للطلاب.`, [[{ text: "🗳 افتح التصويت", web_app: { url: adminPageLink("polls") } }]]);
  return n < 0 ? "انرسلت قبل" : `📢 انرسلت لـ ${n} طالب`;
}

// ---------- صفحة التصويت
export async function pollAction(body: Row) {
  const uid = await authed(body?.initData, POLL_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "create") {
    const question = String(body.question ?? "").trim().slice(0, 500);
    need(question, "اكتب سؤال التصويت");
    const options = [...new Set((Array.isArray(body.options) ? body.options : []).map((o: unknown) => String(o ?? "").trim().slice(0, 100)).filter(Boolean))];
    need(options.length >= 2, "اكتب اختيارين على الأقل");
    need(options.length <= MAX_OPTIONS, `أكثر شي ${MAX_OPTIONS} اختيارات`);
    const known = await centerNames();
    const centers = [...new Set((Array.isArray(body.centers) ? body.centers : []).map(Number))];
    need(centers.every((c) => known.has(c)), "مركز غير معروف");
    const gender = String(body.gender ?? "");
    need(gender === "" || GENDERS.includes(gender), "اختار بنين أو بنات أو الكل");
    const curr = String(body.curr ?? "");
    need(curr === "" || CURRS.includes(curr), "اختار عربي أو إنجليزي أو الكل");
    const knownCh = new Set(await chapterNames());
    const chapters = [...new Set((Array.isArray(body.chapters) ? body.chapters : []).map(String))];
    need(chapters.every((c) => knownCh.has(c)), "فصل غير معروف");
    // الاختيارات ممكن تتكرر بعد التنظيف، فالشغل ينقرا حسب نص الاختيار
    const rawOpts = (Array.isArray(body.options) ? body.options : []).map((o: unknown) => String(o ?? "").trim().slice(0, 100));
    const rawActs = Array.isArray(body.acts) ? body.acts.map(String) : [];
    const acts = options.map((o) => { const a = rawActs[rawOpts.indexOf(o)] ?? ""; return POLL_ACTS[a] ? a : ""; });
    // الفصل المبكر: اللي يبديه يختار ويا المراجعات لو بدونها، فلازم الاثنين، واختيار ثالث يبقى بيه على جدوله
    const buys = [...new Set((Array.isArray(body.buys) ? body.buys : []).map(String))];
    need(buys.every((b) => BUYS[b]), "اختار شنو شاري");
    if (acts.some((a) => a.startsWith("early_"))) {
      need(acts.includes("early_with") && acts.includes("early_without"), "حط «ويا المراجعات» على اختيار و«بدون المراجعات» على اختيار ثاني");
      need(acts.some((a) => !a), "خلي اختيار بلا شغل للي يبقى ويا جماعته (بعد العطلة)");
    }
    const id = await insert("polls", { question, options: JSON.stringify(options), centers: JSON.stringify(centers), gender, curr, chapters: JSON.stringify(chapters), buys: JSON.stringify(buys), acts: JSON.stringify(acts), applied: null, reach: null, status: "open", created: stamp(), by_id: uid, closed_at: null, shown: null });
    const p = (await getPoll(id))!;
    const list = await targets(p);
    await update("polls", { id }, { reach: list.length });
    const sent = await sendMany(list.map((s) => s.user_id as number), (to) => sendPollTo(p, to));
    notice = list.length ? `✅ انرسل التصويت لـ ${sent} من ${list.length} طالب` : "⚠️ انحفظ التصويت، بس ماكو ولا طالب بهذي الفئة";
  } else if (a === "apply") {
    const id = Number(body.id);
    const p = await getPoll(id);
    need(p, "التصويت غير موجود");
    need(p!.status === "closed", "أنهي التصويت أول");
    need(p!.acts.some(Boolean), "هذا التصويت ما بيه شغل يتطبق");
    need(!p!.applied, "انطبق من قبل");
    notice = await applyPoll(p!, Array.isArray(body.skip) ? body.skip.map(Number) : []);
  } else if (a === "close") {
    const p = await getPoll(Number(body.id));
    need(p, "التصويت غير موجود");
    need(p!.status === "open", "التصويت منتهي من قبل");
    await closePoll(p!.id);
    notice = "🔒 انتهى التصويت، ووصلتك النتيجة بالبوت";
  } else if (a === "publish") {
    const p = await getPoll(Number(body.id));
    need(p?.status === "closed", "أنهي التصويت أول");
    const n = await publish(p!);
    notice = n < 0 ? "النتيجة منشورة من قبل" : `📢 انرسلت النسب لـ ${n} طالب`;
  } else if (a === "delete") {
    const id = Number(body.id);
    need(await one("polls", { id }), "التصويت غير موجود");
    await remove("poll_votes", { poll_id: id });
    await remove("polls", { id });
    notice = "🗑 انشال التصويت";
  } else need(a === "list", "أمر غير معروف");
  const polls = (await find("polls", {}, { order: ["-id"] })).map(pollOf);
  const names = await centerNames();
  return {
    polls: await Promise.all(polls.map(async (p) => ({ ...p, target: await targetLabel(p), results: await resultsOf(p), link: pollLink(p.id) }))),
    centers: [...names.entries()].map(([id, name]) => ({ id, name })), genders: GENDERS, currs: CURRS, chapters: await chapterNames(), buys: Object.entries(BUYS).map(([key, text]) => ({ key, text })),
    acts: Object.entries(POLL_ACTS).map(([key, text]) => ({ key, text })), notice,
  };
}

/** «⚡ طبّق على المصوتين»: مرة وحدة بس. كل اللي اختاروا اختيار بيه شغل يتسويله، واللي ما ينفع يطلع اسمه وليش */
async function applyPoll(p: Poll, skip: number[] = []) {
  const at = stamp();
  const mine = await tx(async () => {
    const r = await one("polls", { id: p.id });
    if (!r || appliedOf(r.applied)) return false;
    await update("polls", { id: p.id }, { applied: JSON.stringify({ at, ok: 0, fail: [], running: true }) });
    return true;
  });
  need(mine, "انطبق من قبل");
  const { earlyStartFor } = await import("./schedApi.ts");
  const res: Applied = { at, ok: 0, fail: [], skipped: [] };
  const nameOf = async (uid: number) => String((await one("students", { user_id: uid }))?.name ?? `طالب ${uid}`);
  for (const v of await find("poll_votes", { poll_id: p.id }, { order: ["at"] })) {
    const act = p.acts[Number(v.choice)];
    if (!act) continue;
    const uid = Number(v.user_id);
    // صاحب البوت شال علامته قبل ما يطبّق: يبقى مثل ما هو
    if (skip.includes(uid)) { res.skipped!.push({ id: uid, name: await nameOf(uid) }); continue; }
    try {
      if (act === "ipad") await ipadFor(uid);
      else await earlyStartFor(uid, act === "early_with");
      res.ok++;
    } catch (e) {
      res.fail.push({ id: uid, name: await nameOf(uid), why: e instanceof Error ? e.message : String(e) });
    }
  }
  await update("polls", { id: p.id }, { applied: JSON.stringify(res) });
  return `⚡ انطبق على ${res.ok} طالب${res.fail.length ? `، وما انطبق على ${res.fail.length} (شوف الأسماء والسبب بالتصويت)` : ""}`;
}

/** «📝 يمتحن بالآيباد»: نفس زر الطالب بجدوله. للحضوري بس، ومركزه ما يصور الأجوبة بالتلفون */
async function ipadFor(uid: number) {
  const { photosAllowed, setIpadExam } = await import("./inPerson.ts");
  const st = await one("students", { user_id: uid });
  need(st?.exam === "حضوري", "طالب إلكتروني: يمتحن من بيته، ما بيه آيباد بالمركز");
  need(!await photosAllowed(uid), "مركزه يصورون الأجوبة بالتلفون، فما بيه آيباد");
  await setIpadExam(uid, true);
}

// ---------- صفحة الطالب «🗳 التصويت»: بالتطبيق والبوت. نفس الصوت ونفس «متأكد؟» (التأكيد بالصفحة نفسها)
export async function voteAction(body: Row) {
  await ensure();
  const uid = verifyHomeToken(body?.token);
  need(uid !== null, "هذا الرابط قديم. سد الصفحة وافتحها من جديد", 401);
  await checkDevice(uid!, body.device);
  const s = await one("students", { user_id: uid });
  need(s, "لازم تسجل أول حتى تگدر تصوت");
  let notice = "";
  if (String(body.action) === "vote") {
    const p = await getPoll(Number(body.id));
    need(p, "هذا التصويت انشال");
    const r = await castVote(p!, uid!, Number(body.choice));
    need(r.ok || r.msg.startsWith("صوتت قبل"), r.msg);
    notice = r.msg;
  }
  const mine = new Map((await find("poll_votes", { user_id: uid })).map((v) => [Number(v.poll_id), Number(v.choice)]));
  const list: { id: number; question: string; options: string[]; open: boolean; mine: number | null; pct: number[] | null }[] = [];
  for (const p of (await find("polls", {}, { order: ["-id"] })).map(pollOf)) {
    // المفتوح، والمنتهي اللي نتيجته انعرضت للطلاب (النسب بس)
    if (p.status === "closed" && p.shown !== true) continue;
    if (!await inTarget(p, s)) continue;
    const pct = p.status === "closed" ? (await resultsOf(p)).options.map((o) => o.pct) : null;
    list.push({ id: p.id, question: p.question, options: p.options, open: p.status === "open", mine: mine.get(p.id) ?? null, pct });
    if (list.length >= 10) break;
  }
  // جاي من رابط القناة لتصويت معين: إذا مو بالقائمة يطلعله ليش
  let why = "";
  const focus = Number(body.p) || 0;
  if (focus && !list.some((x) => x.id === focus)) {
    const p = await getPoll(focus);
    why = !p ? "هذا التصويت انشال" : p.status !== "open" ? "🔒 هذا التصويت انتهى" : "هذا التصويت مو إلك";
  }
  return { list, focus, why, notice };
}

export const openPolls = async () => (await find("polls", { status: "open" })).length;
