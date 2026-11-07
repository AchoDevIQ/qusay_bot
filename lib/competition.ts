// المنافسة: الطلاب يسوون مجموعة باسم ما يتكرر، ويدزون رابطها لأصدقائهم، والصديق يوافق لو يرفض.
// ما يتنافس إلا اللي اشتراكهم نفس النوع (محاضرات وامتحانات، لو امتحانات بس). من توصل المجموعة 5 طلاب
// يوصل طلبها لصاحب البوت، ومن يوافق يشوفون ترتيبهم كلهم بالمعدل. والمعدل من كل امتحاناته، والغياب صفر.
// وترتيب المراكز يتسوى وحده: صاحب البوت يشوفه كامل، والطالب يشوف ترتيبه هو بس إذا من أول 100
import { randomInt } from "node:crypto";
import { ADMIN_IDS } from "./config.ts";
import { find, insert, kvGet, one, remove, update, type Row } from "./db.ts";
import { boughtLectures, logActivity } from "./access.ts";
import { can, centerName, student } from "./data.ts";
import { adminPageLink } from "./keyboards.ts";
import { edit, send, type Kb } from "./telegram.ts";
import { esc, stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";

export const COMP_PERM = "competition";
export const MIN_MEMBERS = 5;
const MAX_MEMBERS = 60;
const TOP_CENTER = 100;
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ---------- المعدل: كل الامتحانات الإجبارية اللي خلص وقتها، والغياب صفر
export async function averages() {
  const out = new Map<number, { sum: number; n: number }>();
  for (const i of await find("sched_items")) {
    if (i.kind === "optional") continue;
    const graded = !!i.graded_at, missed = i.status === "missed";
    if (!graded && !missed) continue;
    const a = out.get(i.user_id) ?? { sum: 0, n: 0 };
    a.sum += graded ? Number(i.total) || 0 : 0; a.n++;
    out.set(i.user_id, a);
  }
  return out;
}
const avgOf = (a: { sum: number; n: number } | undefined) => (a?.n ? Math.round((a.sum / a.n) * 10) / 10 : null);

/** نوع الاشتراك: محاضرات وامتحانات (L)، لو امتحانات بس (E). ما يتنافسون إلا ويا نفس النوع */
const kindOf = async (uid: number) => ((await boughtLectures(uid)) ? "L" : "E");
const KIND_LABEL: Record<string, string> = { L: "محاضرات وامتحانات", E: "امتحانات بس" };
const hasExams = async (uid: number) => !!(await one("exam_access", { user_id: uid }));
/** الاسم ما يتكرر: بدون مسافات وهمزات وتاء مربوطة */
const nameKey = (s: string) => s.replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
const botName = async () => (await kvGet("bot_username")) || "Qusay_Alomairi_Bot";
export const inviteLink = async (code: string) => `https://t.me/${await botName()}?start=grp_${code}`;

const membersOf = async (gid: number) => (await find("comp_members", { group_id: gid })).sort((a, b) => String(a.joined).localeCompare(String(b.joined)));
const groupOfUser = async (uid: number) => { const m = await one("comp_members", { user_id: uid }); return m ? await one("comp_groups", { id: m.group_id }) : null; };

async function reviewers() {
  const staff = (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes(COMP_PERM)).map((s) => Number(s.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}
const reviewKb = (gid: number): Kb => [[{ text: "✅ موافق", callback_data: `cg:ok:${gid}` }, { text: "❌ رفض", callback_data: `cg:no:${gid}` }]];
async function reviewText(g: Row, end = "") {
  const ms = await membersOf(g.id);
  const names = await Promise.all(ms.map(async (m) => esc((await student(m.user_id))?.name ?? `#${m.user_id}`)));
  return [`🏆 <b>طلب مجموعة منافسة</b>`, `الاسم: <b>${esc(g.name)}</b>`, `النوع: ${KIND_LABEL[g.kind] ?? g.kind}`, `الطلاب (${ms.length}):`, ...names.map((n, i) => `${i + 1}. ${n}`), ...(end ? ["", end] : [])].join("\n");
}
async function tellMembers(gid: number, text: string) {
  for (const m of await membersOf(gid)) { try { await send(m.user_id, text); } catch (e) { console.error(e); } }
}
/** إذا وصلت 5 وهي بعدها مفتوحة: يروح الطلب للإدارة. وإذا نزلت تحت 5 قبل الموافقة: ترجع تنتظر */
async function checkSize(g: Row) {
  const n = (await membersOf(g.id)).length;
  if (g.status === "open" && n >= MIN_MEMBERS) {
    await update("comp_groups", { id: g.id }, { status: "pending" });
    const text = await reviewText({ ...g, status: "pending" });
    for (const to of await reviewers()) { try { await send(to, text, { kb: reviewKb(g.id) }); } catch (e) { console.error(e); } }
    await tellMembers(g.id, `🏆 مجموعة <b>${esc(g.name)}</b> صارت ${n} طلاب، وراح طلبها للإدارة. ننتظر الموافقة.`);
  } else if (g.status === "pending" && n < MIN_MEMBERS) await update("comp_groups", { id: g.id }, { status: "open" });
}

// ---------- الطالب
async function canCompete(uid: number) {
  need(await student(uid), "سجل معلوماتك أول");
  need(await hasExams(uid), "المنافسة بس للي عنده امتحانات");
}
export async function createGroup(uid: number, rawName: unknown) {
  await canCompete(uid);
  need(!await groupOfUser(uid), "إنت بمجموعة. اطلع منها أول");
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  need(name.length >= 3, "اكتب اسم المجموعة، 3 حروف على الأقل");
  const key = nameKey(name);
  need(!(await find("comp_groups")).some((g) => g.name_key === key), "هذا الاسم مستخدم قبل، اختار اسم ثاني");
  let code = "";
  do { code = Array.from({ length: 8 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join(""); } while (await one("comp_groups", { code }));
  const id = await insert("comp_groups", { name, name_key: key, code, owner_id: uid, kind: await kindOf(uid), status: "open", created: stamp(), decided_at: null, decided_by: null });
  await insert("comp_members", { user_id: uid, group_id: id, joined: stamp() });
  await logActivity(uid, `🏆 سوى مجموعة منافسة: ${name}`);
  return id;
}
/** الصديق فتح الرابط: يوافق ويفوت */
export async function joinGroup(uid: number, code: unknown) {
  await canCompete(uid);
  const g = await one("comp_groups", { code: String(code ?? "").toUpperCase() });
  need(g && g.status !== "rejected", "المجموعة غير موجودة");
  const mine = await groupOfUser(uid);
  need(!mine || mine.id !== g!.id, "إنت أصلاً بهاي المجموعة");
  need(!mine, `إنت بمجموعة «${mine?.name ?? ""}». اطلع منها أول`);
  need(await kindOf(uid) === g!.kind, `هاي المجموعة لطلاب «${KIND_LABEL[g!.kind]}»، وإنت اشتراكك غير نوع`);
  need((await membersOf(g!.id)).length < MAX_MEMBERS, "المجموعة مكتملة");
  await insert("comp_members", { user_id: uid, group_id: g!.id, joined: stamp() });
  await logActivity(uid, `🏆 فات لمجموعة منافسة: ${g!.name}`);
  const name = (await student(uid))?.name ?? "";
  try { await send(g!.owner_id, `🏆 <b>${esc(name)}</b> فات لمجموعتك «${esc(g!.name)}».`); } catch (e) { console.error(e); }
  await checkSize((await one("comp_groups", { id: g!.id }))!);
  return g!;
}
export async function leaveGroup(uid: number) {
  const g = await groupOfUser(uid);
  need(g, "إنت مو بمجموعة");
  await remove("comp_members", { user_id: uid });
  const rest = await membersOf(g!.id);
  if (!rest.length) { await remove("comp_groups", { id: g!.id }); return; }
  if (g!.owner_id === uid) await update("comp_groups", { id: g!.id }, { owner_id: rest[0].user_id });
  await checkSize((await one("comp_groups", { id: g!.id }))!);
}

/** رسالة الرابط بالبوت: اسم المجموعة ومنو بيها، وزرين */
export async function invitePrompt(chat: number, uid: number, code: string) {
  const g = await one("comp_groups", { code: code.toUpperCase() });
  if (!g || g.status === "rejected") { await send(chat, "⚠️ هاي المجموعة غير موجودة."); return; }
  const owner = (await student(g.owner_id))?.name ?? "";
  const n = (await membersOf(g.id)).length;
  await send(chat, `🏆 <b>${esc(owner)}</b> يدعوك لمجموعة المنافسة «<b>${esc(g.name)}</b>»\nبيها ${n} طلاب، وتتنافسون بالمعدل.\nتوافق؟`,
    { kb: [[{ text: "✅ أوافق", callback_data: `cj:ok:${g.code}` }, { text: "❌ لا", callback_data: `cj:no:${g.code}` }]] });
}
export async function inviteCb(chat: number, uid: number, mid: number, d: string): Promise<string> {
  const [, choice, code] = d.split(":");
  if (choice !== "ok") { await edit(chat, mid, "تمام، ما فتت للمجموعة."); return "تمام"; }
  try {
    const g = await joinGroup(uid, code);
    await edit(chat, mid, `✅ فتت لمجموعة «<b>${esc(g.name)}</b>». تشوف ترتيبكم من «📝 امتحاناتي».`);
    return "✅ فتت للمجموعة";
  } catch (e) { const msg = (e as Error).message; await edit(chat, mid, `⚠️ ${esc(msg)}`); return msg; }
}

/** صاحب البوت يوافق أو يرفض من الرسالة */
export async function reviewCb(chat: number, uid: number, mid: number, d: string): Promise<string> {
  if (!await can(uid, COMP_PERM)) return "ما عندك صلاحية";
  const [, choice, raw] = d.split(":");
  const g = await one("comp_groups", { id: Number(raw) });
  if (!g) return "المجموعة انحذفت";
  if (g.status !== "pending") { await edit(chat, mid, await reviewText(g, g.status === "approved" ? "✅ انقبلت من قبل" : g.status === "rejected" ? "❌ انرفضت من قبل" : "⏳ نزلت تحت 5 طلاب")); return "انرد عليها من قبل"; }
  await decide(uid, g, choice === "ok");
  await edit(chat, mid, await reviewText(g, choice === "ok" ? "✅ وافقت عليها" : "❌ رفضتها"));
  return choice === "ok" ? "✅ انقبلت" : "❌ انرفضت";
}
async function decide(uid: number, g: Row, ok: boolean) {
  await update("comp_groups", { id: g.id }, { status: ok ? "approved" : "rejected", decided_at: stamp(), decided_by: uid });
  await tellMembers(g.id, ok ? `🏆 <b>انقبلت مجموعة «${esc(g.name)}»</b>\nشوفوا ترتيبكم من «📝 امتحاناتي». بالتوفيق 💪` : `❌ انرفضت مجموعة «${esc(g.name)}».`);
  if (!ok) await remove("comp_members", { group_id: g.id });
}

// ---------- الترتيب
async function rankGroup(gid: number, avg: Awaited<ReturnType<typeof averages>>) {
  const rows = await Promise.all((await membersOf(gid)).map(async (m) => ({ id: m.user_id as number, name: (await student(m.user_id))?.name ?? `#${m.user_id}`, avg: avgOf(avg.get(m.user_id)), exams: avg.get(m.user_id)?.n ?? 0 })));
  return rows.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name, "ar")).map((r, i) => ({ ...r, rank: i + 1 }));
}
/** كل طلاب المركز اللي امتحنوا، من أعلى معدل */
async function rankCenter(cid: number, avg: Awaited<ReturnType<typeof averages>>) {
  const rows = (await find("students", { center_id: cid })).filter((s) => avg.get(s.user_id)?.n)
    .map((s) => ({ id: s.user_id as number, name: String(s.name ?? ""), gender: String(s.gender ?? ""), avg: avgOf(avg.get(s.user_id))!, exams: avg.get(s.user_id)!.n }));
  return rows.sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name, "ar")).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** اللي يشوفه الطالب بصفحة امتحاناته */
export async function studentComp(uid: number) {
  if (!await hasExams(uid)) return null;
  const avg = await averages();
  const g = await groupOfUser(uid);
  let group = null;
  if (g) {
    const ranked = await rankGroup(g.id, avg);
    group = { name: g.name as string, status: g.status as string, count: ranked.length, need: MIN_MEMBERS, link: await inviteLink(g.code), owner: g.owner_id === uid,
      members: g.status === "approved" ? ranked : ranked.map((r) => ({ id: r.id, name: r.name, avg: null, exams: 0, rank: 0 })) };
  }
  const st = await student(uid);
  let center = null;
  if (st?.center_id) {
    const ranked = await rankCenter(st.center_id, avg);
    const me = ranked.find((r) => r.id === uid);
    center = { name: await centerName(st.center_id), avg: avgOf(avg.get(uid)), rank: me && me.rank <= TOP_CENTER ? me.rank : null, total: ranked.length };
  }
  return { group, center, myAvg: avgOf(avg.get(uid)), kind: KIND_LABEL[await kindOf(uid)] };
}

// ---------- صفحة صاحب البوت
export async function competitionAction(body: Row) {
  const uid = await authed(body?.initData, COMP_PERM);
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "approve" || a === "reject") {
    const g = await one("comp_groups", { id: Number(body.id) });
    need(g?.status === "pending", "هاي المجموعة مو بانتظار الموافقة");
    await decide(uid, g!, a === "approve");
    notice = a === "approve" ? `✅ انقبلت «${g!.name}»` : `❌ انرفضت «${g!.name}»`;
  } else if (a === "delete") {
    const g = await one("comp_groups", { id: Number(body.id) });
    need(g, "المجموعة غير موجودة");
    await tellMembers(g!.id, `🗑 الإدارة شالت مجموعة «${esc(g!.name)}».`);
    await remove("comp_members", { group_id: g!.id });
    await remove("comp_groups", { id: g!.id });
    notice = `🗑 انشالت «${g!.name}»`;
  } else need(a === "list", "أمر غير معروف");
  const avg = await averages();
  const groups = [];
  for (const g of (await find("comp_groups")).filter((x) => x.status !== "rejected")) {
    const members = await rankGroup(g.id, avg);
    groups.push({ id: g.id as number, name: g.name as string, kind: KIND_LABEL[g.kind] ?? g.kind, status: g.status as string, created: g.created as string, members });
  }
  const order: Record<string, number> = { pending: 0, approved: 1, open: 2 };
  groups.sort((x, y) => order[x.status] - order[y.status] || y.members.length - x.members.length);
  const centers = [];
  for (const c of await find("centers", { active: 1 })) {
    const ranked = await rankCenter(c.id, avg);
    if (ranked.length) centers.push({ id: c.id as number, name: await centerName(c.id), students: ranked });
  }
  return { groups, centers, min: MIN_MEMBERS, notice };
}

export const pendingGroups = async () => (await find("comp_groups", { status: "pending" })).length;
