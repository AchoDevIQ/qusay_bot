// التصويت: صاحب البوت (أو المساعد اللي عنده صلاحية 🗳) يسوي تصويت بسؤال وكم اختيار، ويختار منو يصوت:
// الكل، أو مراكز معينة، أو بنين بس أو بنات بس. البوت يدزه لكل طالب من الفئة بالمحادثة.
// الطالب يصوت من حسابه بس (حساب تليجرام اللي مسجل بيه)، ومرة وحدة: يختار، يطلعله «متأكد؟»، يدوس نعم، وصوته يتثبت.
// لما ينتهي التصويت توصل النتيجة كاملة (الأسماء والعدد والنسبة) لصاحب البوت، ويسأله يظهرها للطلاب لو لا.
// إذا وافق، يوصل للطلاب النسب بس، بدون أسماء ولا أعداد
import { GENDERS } from "./config.ts";
import { find, insert, one, put, remove, tx, update, type Row } from "./db.ts";
import { can, staffIds } from "./data.ts";
import { adminPageLink } from "./keyboards.ts";
import { edit, send, sendMany, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";

export const POLL_PERM = "polls";
/** رقم «بدون مركز» بقائمة المراكز: طلاب الإلكتروني */
export const NO_CENTER = -1;
const MAX_OPTIONS = 10;
const TG_MAX = 3900;

export type Poll = { id: number; question: string; options: string[]; centers: number[]; gender: string; status: "open" | "closed"; created: string; closed_at: string; shown: boolean | null };
const arr = (v: unknown) => { try { const j = JSON.parse(String(v ?? "[]")); return Array.isArray(j) ? j : []; } catch { return []; } };
const pollOf = (r: Row): Poll => ({
  id: r.id, question: String(r.question ?? ""), options: arr(r.options).map(String), centers: arr(r.centers).map(Number),
  gender: String(r.gender ?? ""), status: r.status === "closed" ? "closed" : "open", created: String(r.created ?? ""), closed_at: String(r.closed_at ?? ""),
  shown: r.shown === 1 ? true : r.shown === 0 ? false : null,
});
export async function getPoll(id: number) { const r = await one("polls", { id }); return r ? pollOf(r) : null; }

/** الطالب من فئة هذا التصويت؟ (المركز والجنس) */
export const inTarget = (p: Poll, s: Row | null | undefined) =>
  !!s && (!p.centers.length || p.centers.includes(s.center_id ?? NO_CENTER)) && (!p.gender || s.gender === p.gender);
const targets = async (p: Poll) => (await find("students")).filter((s) => inTarget(p, s));

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
  return p.gender ? `${where} · ${p.gender} بس` : where;
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
  const all = await targets(p);
  return {
    voted: votes.length, targets: all.length,
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
  return (await find("polls", { status: "open" }, { order: ["id"] })).map(pollOf).filter((p) => inTarget(p, s) && !mine.has(p.id));
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
  if (!inTarget(p, await one("students", { user_id: uid }))) return "هذا التصويت مو إلك";
  const choice = Number(chS);
  if (kind === "pb") { if (mid) await edit(chat, mid, pollText(p), pollKb(p)); return ""; }
  if (!(Number.isInteger(choice) && choice >= 0 && choice < p.options.length)) return "اختيار غير معروف";
  if (kind === "pv") {
    if (mid) await edit(chat, mid, `🗳 ${esc(p.question)}\n\nاخترت: <b>${esc(p.options[choice])}</b>\n\n❓ <b>هل أنت متأكد؟</b> بعد ما تأكد ما تگدر تغير صوتك.`,
      [[{ text: "✅ نعم، متأكد", callback_data: `pk:${p.id}:${choice}` }], [{ text: "↩️ لا، ارجع للاختيارات", callback_data: `pb:${p.id}` }]]);
    return "";
  }
  // pk: صوت واحد لكل حساب، حتى لو داس مرتين بنفس اللحظة
  const ok = await tx(async () => {
    if (await one("poll_votes", { poll_id: p.id, user_id: uid })) return false;
    await put("poll_votes", { poll_id: p.id, user_id: uid, choice, at: stamp() });
    return true;
  });
  const now = await one("poll_votes", { poll_id: p.id, user_id: uid });
  if (mid) await edit(chat, mid, votedText(p, now?.choice ?? choice));
  return ok ? "✅ انحسب صوتك" : "صوتت قبل، والصوت ما يتغير";
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
  const text = `${await fullText(p)}\n\n❓ <b>تريد تظهر النتيجة للطلاب؟</b> يوصلهم النسب بس، بدون أسماء ولا أعداد.`;
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
    const id = await insert("polls", { question, options: JSON.stringify(options), centers: JSON.stringify(centers), gender, status: "open", created: stamp(), by_id: uid, closed_at: null, shown: null });
    const p = (await getPoll(id))!;
    const list = await targets(p);
    const sent = await sendMany(list.map((s) => s.user_id as number), (to) => sendPollTo(p, to));
    notice = list.length ? `✅ انرسل التصويت لـ ${sent} من ${list.length} طالب` : "⚠️ انحفظ التصويت، بس ماكو ولا طالب بهذي الفئة";
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
    polls: await Promise.all(polls.map(async (p) => ({ ...p, target: await targetLabel(p), results: await resultsOf(p) }))),
    centers: [...names.entries()].map(([id, name]) => ({ id, name })), genders: GENDERS, notice,
  };
}

export const openPolls = async () => (await find("polls", { status: "open" })).length;
