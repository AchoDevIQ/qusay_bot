// 🔍 فحص الأسبوع (طلب الأستاذ 2026-11-25): كل أسبوع ورقتين من كل موضوع صححها «تصحيح قصي» توصلك تشوفها.
// إذا خطوة غلط تصلحها بـ «✏️ صلّح وعلّمه» (يتعلمها). الأسبوع الجاي يگلك شگد صلّحت: إذا الفرق أكثر من 3 درجات بورقة، يگلك حتى نصلحه.
// ما يكلف شي: ماكو ذكاء، بس أوراق تنختار وتصليحاتك تنحسب
import { find, kvGet, kvSet } from "./db.ts";
import { QUSAY_GRADER } from "./data.ts";
import { send } from "./telegram.ts";
import { stamp } from "./util.ts";

const KEY = "qg_week";
const WEEK_MS = 7 * 24 * 3600_000, PER_TOPIC = 2, MAX_TOPICS = 10, GAP = 3;
type Pick = { id: number; exam: number; title: string; name: string; total: number; seen?: 1 };
type Week = { at: number; items: Pick[] };

const read = async (): Promise<Week> => { try { const j = JSON.parse(await kvGet(KEY) ?? ""); return { at: Number(j.at) || 0, items: Array.isArray(j.items) ? j.items : [] }; } catch { return { at: 0, items: [] }; } };

/** فتح ورقة من فحص الأسبوع: تنحسب «شافها» */
export async function weekSeen(id: number) {
  const w = await read();
  const p = w.items.find((x) => x.id === id);
  if (!p || p.seen) return;
  p.seen = 1;
  await kvSet(KEY, JSON.stringify(w));
}

/** شگد صلّح بكل ورقة من العينة (مجموع فرق الدرجات بتصليحاته) */
export async function weekReport(items: Pick[]) {
  const { lessonsOf } = await import("./qusayGrade.ts");
  const out: { p: Pick; gap: number }[] = [];
  const byExam = new Map<number, Awaited<ReturnType<typeof lessonsOf>>>();
  for (const p of items) {
    if (!byExam.has(p.exam)) byExam.set(p.exam, await lessonsOf(p.exam));
    const gap = byExam.get(p.exam)!.filter((l) => l.item === p.id).reduce((t, l) => t + Math.abs(l.to - l.from), 0);
    out.push({ p, gap });
  }
  return out;
}

/** الساعة ببغداد (حتى الرسالة ما توصل بالليل) */
const baghdadHour = () => (new Date().getUTCHours() + 3) % 24;

export async function weeklyTick(now = Date.now(), h = baghdadHour()) {
  const w = await read();
  if (now - w.at < WEEK_MS) return null;

  if (h < 9 || h >= 21) return null;
  const { staffIds } = await import("./data.ts");
  const { adminPageLink } = await import("./keyboards.ts");
  const { esc } = await import("./util.ts");
  const to = await staffIds("qusay");
  const lines: string[] = [];
  // 1. شنو صار بعينة الأسبوع اللي فات
  if (w.items.length) {
    const rep = await weekReport(w.items);
    const seen = rep.filter((r) => r.p.seen || r.gap).length;
    const far = rep.filter((r) => r.gap > GAP);
    lines.push(`📊 <b>الأسبوع اللي فات:</b> شفت ${seen} من ${rep.length} ورقة.`);
    for (const r of rep.filter((x) => x.gap)) lines.push(`• ${esc(r.p.title)} · ${esc(r.p.name)}: صلّحت ${r.gap} ${r.gap === 1 ? "درجة" : "درجات"}`);
    lines.push(far.length ? `⚠️ <b>الفرق كبير (أكثر من ${GAP} درجات) بـ ${[...new Set(far.map((r) => esc(r.p.title)))].join("، ")}</b>. خلينا نشوف قواعد هذا الموضوع سوة.` : seen ? "✅ تصحيحه قريب من تصحيحك." : "ما شفت ولا ورقة، فما نعرف بعد شگد قريب منك.");
    lines.push("");
  }
  // 2. عينة هذا الأسبوع: ورقتين عشوائية من كل موضوع صححه بالأسبوع
  const since = stamp(new Date(now - WEEK_MS)).slice(0, 16);
  const graded = (await find("sched_items", { grader_id: QUSAY_GRADER })).filter((it) => Number(it.user_id) > 0 && it.graded_at && String(it.graded_at) >= since);
  const byExam = new Map<number, typeof graded>();
  for (const it of graded) byExam.set(Number(it.exam_id), [...(byExam.get(Number(it.exam_id)) ?? []), it]);
  const items: Pick[] = [];
  for (const [exam, list] of [...byExam].slice(0, MAX_TOPICS)) {
    const title = String((await find("bank_exams", { id: exam }))[0]?.title ?? "");
    for (const it of [...list].sort(() => Math.random() - 0.5).slice(0, PER_TOPIC)) {
      const name = String((await find("students", { user_id: it.user_id }))[0]?.name ?? "طالب");
      items.push({ id: Number(it.id), exam, title, name, total: Number(it.total ?? 0) });
    }
  }
  await kvSet(KEY, JSON.stringify({ at: now, items }));
  if (!items.length && !lines.length) return { sent: 0 };
  if (items.length) {
    lines.push(`🔍 <b>فحص هذا الأسبوع</b>: ${items.length} ورقة صححها تصحيح قصي، ورقتين من كل موضوع.`);
    lines.push("افتح كل وحدة وشوف تصحيحها. إذا خطوة غلط: ✏️ صلّح ← الدرجة الصح وليش. يتعلمها، والأسبوع الجاي أگلك شگد الفرق بينه وبينك.");
  }
  for (const a of to) {
    const kb = items.slice(0, 20).map((p) => [{ text: `👁 ${p.title.slice(0, 22)} · ${p.name.slice(0, 18)} (${p.total})`, web_app: { url: `${adminPageLink("qusay", a)}&paper=${p.id}` } }]);
    await send(a, lines.join("\n"), kb.length ? { kb } : {});
  }
  return { sent: items.length };
}
