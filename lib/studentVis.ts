// شنو يشوف الطالب بالبوت: البوت احتياط للتطبيق، فمربعات قائمة الطالب مخفية، وصاحب البوت يفتح أي مربع
// لكل الطلاب، أو لفئة (مركز، بنين/بنات، المنهج، الفصل اللي شاريه)، أو لطلاب بأسمائهم. الدرجات توصل دايماً
// للطالب ولولي أمره، لأنها رسائل مو مربعات. الكادر وطلاب التجربة (أرقام سالبة) يشوفون كلشي.
import { kvGet, kvSet, find, type Row } from "./db.ts";
import { GENDERS } from "./config.ts";
import { isRealStaff, isStaff, student } from "./data.ts";
import { ownedChapters } from "./notes.ts";
import { centerNames, NO_CENTER } from "./polls.ts";
import { ORD_AR } from "./config.ts";
import { authed, need } from "./webApi.ts";

export const VIS_PERM = "studentvis";
export const VIS_TILES = [
  { key: "shop", title: "🛒 المتجر" },
  { key: "ask", title: "❓ سؤال علمي" },
  { key: "myq", title: "📂 أسئلتي" },
  { key: "me", title: "👤 معلوماتي" },
  { key: "exams", title: "📝 امتحاناتي" },
  { key: "notes", title: "📚 ملازمي" },
  { key: "vote", title: "🗳 التصويت" },
  { key: "board", title: "📝 السبورة" },
] as const;
export type TileKey = (typeof VIS_TILES)[number]["key"];
/** شغلات التطبيق مو مربعات: الرسائل الصوتية بالمحادثة. من البداية مسدودة */
export const VIS_EXTRA = [{ key: "voice", title: "🎤 الرسائل الصوتية بمحادثة التطبيق" },
  // 📘 الحل النموذجي (طلبه 2026-11-26): مخفي من البداية، بالملازم (الراصد والوزارية والإثرائية) وبتبويب المحاضرة «الحل النموذجي»
  { key: "sol", title: "📘 الحل النموذجي (بالملازم وبتبويب المحاضرة)" }] as const;
export type RuleKey = TileKey | (typeof VIS_EXTRA)[number]["key"];
const KEYS = new Set<string>(VIS_TILES.map((t) => t.key));
const CURRS = ["عربي", "إنجليزي"];

/** off: مخفي عن الكل. all: لكل الطلاب. some: للفئة اللي تختارها، ويا الطلاب اللي بأسمائهم */
export type Rule = { mode: "off" | "all" | "some"; centers: number[]; gender: string; curr: string; chapters: string[]; students: number[] };
const KV = "student_vis";
const emptyRule = (mode: Rule["mode"]): Rule => ({ mode, centers: [], gender: "", curr: "", chapters: [], students: [] });

/** قبل ما يحفظ صاحب البوت أي اختيار: البوت الحقيقي يبدي كلشي مخفي (احتياط)، والتجربة والفحوصات تبدي كلشي ظاهر */
const startMode = (): Rule["mode"] => (process.env.NODE_ENV === "production" ? "off" : "all");

export async function visRules(): Promise<Record<RuleKey, Rule>> {
  const raw = await kvGet(KV);
  let saved: Record<string, Partial<Rule>> = {};
  try { saved = JSON.parse(raw ?? "{}"); } catch { saved = {}; }
  // بعد أول حفظ، المربع اللي ما بيه اختيار ينحسب مخفي
  const fallback = raw === null ? startMode() : "off";
  const out = {} as Record<RuleKey, Rule>;
  for (const t of VIS_TILES) out[t.key] = clean(saved[t.key], fallback);
  for (const t of VIS_EXTRA) out[t.key] = clean(saved[t.key], "off");
  return out;
}
export function clean(r: Partial<Rule> | undefined, fallback: Rule["mode"]): Rule {
  if (!r) return emptyRule(fallback);
  const nums = (a: unknown) => (Array.isArray(a) ? [...new Set(a.map(Number).filter(Number.isSafeInteger))] : []);
  return {
    mode: r.mode === "all" || r.mode === "some" ? r.mode : "off",
    centers: nums(r.centers),
    gender: GENDERS.includes(String(r.gender)) ? String(r.gender) : "",
    curr: CURRS.includes(String(r.curr)) ? String(r.curr) : "",
    chapters: Array.isArray(r.chapters) ? [...new Set(r.chapters.map(String).filter((c) => c.startsWith("الفصل")))] : [],
    students: nums(r.students),
  };
}

/** الطالب من فئة هذا المربع؟ الفئة: كل شرط مختار لازم ينطبق. الطلاب بأسمائهم يشوفونه دايماً */
export async function inRule(r: Rule, uid: number, s: Row | null): Promise<boolean> {
  if (r.mode === "all") return true;
  if (r.mode === "off") return false;
  if (r.students.includes(uid)) return true;
  const any = r.centers.length || r.gender || r.curr || r.chapters.length;
  if (!any || !s) return false;
  if (r.centers.length && !r.centers.includes(s.exam === "حضوري" ? Number(s.center_id ?? NO_CENTER) : NO_CENTER)) return false;
  if (r.gender && s.gender !== r.gender) return false;
  if (r.curr && s.curr !== r.curr) return false;
  if (r.chapters.length) {
    const mine = new Set(await ownedChapters(uid));
    if (!r.chapters.some((c) => mine.has(c))) return false;
  }
  return true;
}

// ---------- طوارئ لطلاب بأسمائهم (طلب الأستاذ 2026-11-17): مو لازم الكل. الطالب اللي بالقائمة يشوف البوت كله
// (بتليگرام أو برابط المتصفح)، والباقين مثل ما هم
const SOS = "student_sos";
export async function sosIds(): Promise<number[]> { try { const j = JSON.parse((await kvGet(SOS)) ?? "[]"); return Array.isArray(j) ? j.map(Number).filter(Number.isSafeInteger) : []; } catch { return []; } }
export async function setSos(uid: number, on: boolean) {
  const ids = new Set(await sosIds());
  if (on) ids.add(uid); else ids.delete(uid);
  await kvSet(SOS, JSON.stringify([...ids]));
  (await import("./appChat.ts")).forgetMode(uid);
  return ids.size;
}

/** المربعات اللي تطلع لهذا الطالب بالبوت */
export async function visibleTiles(uid: number): Promise<Set<TileKey>> {
  const all = new Set(VIS_TILES.map((t) => t.key));
  if (uid < 0 || await isStaff(uid) || await isRealStaff(uid)) return all;
  if ((await sosIds()).includes(uid)) return all;
  const rules = await visRules(), s = await student(uid), out = new Set<TileKey>();
  for (const t of VIS_TILES) if (await inRule(rules[t.key], uid, s)) out.add(t.key);
  return out;
}
export const tileVisible = async (uid: number, key: string) => !KEYS.has(key) || (await visibleTiles(uid)).has(key as TileKey);

// ---------- صفحة الإدارة
async function chapterList() {
  const rows = (await find("chapters")).filter((c) => c.active !== 0).sort((a, b) => Number(a.ord) - Number(b.ord));
  return rows.map((_, i) => `الفصل ${ORD_AR[i]}`).filter((c) => !c.endsWith("undefined"));
}
async function studentNames(ids: number[]) {
  const out: { id: number; name: string }[] = [];
  for (const id of ids) out.push({ id, name: String((await student(id))?.name ?? `طالب ${id}`) });
  return out;
}

export async function visAction(body: Row) {
  await authed(body?.initData, VIS_PERM);
  const a = String(body.action ?? "list");
  let notice = "";
  if (a === "save") {
    const rules = body.rules && typeof body.rules === "object" ? body.rules as Record<string, Partial<Rule>> : {};
    const out: Record<string, Rule> = {};
    for (const t of [...VIS_TILES, ...VIS_EXTRA]) out[t.key] = clean(rules[t.key], "off");
    await kvSet(KV, JSON.stringify(out));
    (await import("./appChat.ts")).forgetModes();
    if (Array.isArray(body.sos)) await kvSet(SOS, JSON.stringify([...new Set((body.sos as unknown[]).map(Number).filter(Number.isSafeInteger))]));
    const open = VIS_TILES.filter((t) => out[t.key].mode !== "off").length;
    notice = open ? `✅ انحفظ. ${open} مربع مفتوح للطلاب` : "✅ انحفظ. كل المربعات مخفية عن الطلاب";
  } else if (a === "appReg") {
    // التسجيل الجديد بالتطبيق: طريقة البوت لو القديمة
    const { setAppReg } = await import("./appReg.ts");
    await setAppReg(!!body.on);
    notice = body.on ? "📝 الطالب الجديد هسه يسجل بالتطبيق بطريقة البوت" : "↩️ الطالب الجديد يسجل بالتطبيق بالطريقة القديمة";
  } else if (a === "find") {
    const q = String(body.q ?? "").trim();
    need(q.length >= 2, "اكتب حرفين أو أكثر");
    const hits = (await find("students")).filter((s) => Number(s.user_id) > 0 && (String(s.name ?? "").includes(q) || String(s.phone1 ?? "").includes(q) || String(s.user_id) === q)).slice(0, 20);
    return { found: hits.map((s) => ({ id: Number(s.user_id), name: String(s.name ?? "") })) };
  } else need(a === "list", "أمر غير معروف");
  const rules = await visRules();
  const sos = await sosIds();
  const ids = [...new Set([...Object.values(rules).flatMap((r) => r.students), ...sos])];
  return {
    tiles: [...VIS_TILES, ...VIS_EXTRA], rules, notice,
    centers: [...(await centerNames()).entries()].map(([id, name]) => ({ id, name })),
    genders: GENDERS, currs: CURRS, chapters: await chapterList(), names: await studentNames(ids), sos, appReg: await (await import("./appReg.ts")).appRegOn(),
  };
}

/** 📘 الطالب يشوف الحل النموذجي؟ صاحب البوت والمساعدين يشوفونه دايماً (حتى يجربون) */
export async function solAllowed(uid: number) {
  const { isAdmin, isStaff, student } = await import("./data.ts");
  if (await isAdmin(uid) || await isStaff(uid)) return true;
  const r = (await visRules()).sol;
  return !!r && await inRule(r, uid, await student(uid));
}
