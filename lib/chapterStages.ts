// مراحل الفصل (قرار الأستاذ 2026-11-17): صاحب البوت يكتب لكل فصل تاريخ بدايته ومدتين بالأيام:
//   ورا «أيام التعويض»: اللي يشتري يصير تعويضي (جدول مكثف إلكتروني للي فاته، وبعدين يرجع يمتحن ويا مركزه حضوري).
//   ورا «أيام الإلكتروني فقط»: اللي يشتري ما يلحق حضوري، امتحاناته إلكترونية فقط، والمتجر يطلعله أسعار الإلكتروني بس.
// المفتاحين اليدويين (الفصل تعويضي، الفصل إلكتروني فقط) يبقون يشتغلون ويا الحساب بالأيام
import { kvGet, kvSet, type Row } from "./db.ts";
import { addDays, validDay } from "./scheduleRules.ts";

export type Stage = { start: string; makeup: number | null; online: number | null };
const KEY = "chapter_stages";
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);   // بتوقيت بغداد

export async function chapterStages(): Promise<Record<string, Stage>> {
  try { const j = JSON.parse(await kvGet(KEY) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; }
}
const days = (v: unknown) => { const n = Number(v); return v === "" || v === null || v === undefined || !Number.isInteger(n) || n < 0 || n > 365 ? null : n; };
export function cleanStage(r: Row): Stage | null {
  const start = String(r.start ?? "").trim();
  if (!validDay(start)) return null;
  const makeup = days(r.makeup), online = days(r.online);
  return { start, makeup, online: online !== null && makeup !== null && online < makeup ? makeup : online };
}
export async function setChapterStage(chapter: string, r: Row | null) {
  const all = await chapterStages();
  const s = r ? cleanStage(r) : null;
  if (s) all[chapter] = s; else delete all[chapter];
  await kvSet(KEY, JSON.stringify(all));
}

/** الفصول اللي صارت تعويضية بالحساب: الفصل ← يوم صار تعويضي */
export async function autoMakeup(now = today()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [ch, s] of Object.entries(await chapterStages())) {
    if (s.makeup === null || !validDay(s.start)) continue;
    const from = addDays(s.start, s.makeup);
    if (now >= from) out[ch] = `${from} 00:00`;
  }
  return out;
}
/** الفصول اللي صارت إلكترونية فقط بالحساب */
export async function autoOnline(now = today()): Promise<string[]> {
  return Object.entries(await chapterStages()).filter(([, s]) => s.online !== null && validDay(s.start) && now >= addDays(s.start, s.online)).map(([ch]) => ch);
}
/** شنو مرحلة الفصل هسه، للعرض */
export function stageNow(s: Stage | undefined, now = today()): "normal" | "makeup" | "online" | "" {
  if (!s || !validDay(s.start)) return "";
  if (s.online !== null && now >= addDays(s.start, s.online)) return "online";
  if (s.makeup !== null && now >= addDays(s.start, s.makeup)) return "makeup";
  return "normal";
}
