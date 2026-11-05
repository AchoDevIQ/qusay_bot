// صفحات الإعدادات: الفصول الإلكترونية، أوقات الأسئلة، الفصول والمواضيع، والأسئلة المفتوحة
import { find, kvSet, saveCurriculum, type Row } from "./db.ts";
import { DAYS, DAY_ORDER, toLatinDigits } from "./config.ts";
import { chapters, groupId, products, qHours, qWhere, student, topics } from "./data.ts";
import { chapterLabel, onlineOnly } from "./keyboards.ts";
import { authed, need } from "./webApi.ts";

// ---------- فصول امتحانها إلكتروني فقط
async function onlineData() {
  const labels: string[] = [];
  for (const p of await products()) {
    const l = chapterLabel(p.name);
    if (l && !labels.includes(l)) labels.push(l);
  }
  const on = await onlineOnly();
  return { chapters: labels.map((label) => ({ label, on: on.includes(label) })) };
}
export async function onlineAction(body: Row) {
  await authed(body?.initData, "products");
  if (body.action === "toggle") {
    const data = await onlineData();
    const label = String(body.label);
    need(data.chapters.some((c) => c.label === label), "الفصل غير موجود");
    const set = new Set(await onlineOnly());
    if (set.has(label)) set.delete(label); else set.add(label);
    await kvSet("online_only", JSON.stringify([...set].sort()));
  } else need(body.action === "list", "أمر غير معروف");
  return await onlineData();
}

// ---------- أوقات استقبال الأسئلة
const clock = (raw: unknown) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(toLatinDigits(String(raw ?? "")).trim());
  need(m && Number(m[1]) < 24 && Number(m[2]) < 60, "اكتب الوقت بنظام 24 ساعة، مثل 16:30");
  return `${m![1].padStart(2, "0")}:${m![2]}`;
};
async function hoursData() {
  const h = await qHours();
  return { on: h.on !== false, days: h.days, from: h.from, to: h.to, week: DAY_ORDER.map((i) => ({ i, name: DAYS[i] })), group: !!await groupId() };
}
export async function hoursAction(body: Row) {
  await authed(body?.initData, "owner");
  if (body.action === "save") {
    const days = Array.isArray(body.days) ? [...new Set((body.days as unknown[]).map(Number))].sort((a, b) => a - b) : [];
    need(days.every((d) => DAY_ORDER.includes(d)), "يوم غير معروف");
    await kvSet("q_hours", JSON.stringify({ on: !!body.on, days, from: clock(body.from), to: clock(body.to) }));
  } else need(body.action === "list", "أمر غير معروف");
  return await hoursData();
}

// ---------- الفصول والمواضيع
const curriculumData = async () => ({
  chapters: await Promise.all((await chapters()).map(async (c) => ({
    ar: c.ar, en: c.en ?? "", topics: (await topics(c.id)).map((t) => ({ ar: t.ar, en: t.en ?? "", lectures: t.lectures ?? 0 })),
  }))),
});
const cell = (raw: unknown, label: string, required = true) => {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (required) need(t, label);
  need(!/[|=]/.test(t) && !t.startsWith("#"), "الأسماء ما تصير بيها العلامات | أو = أو #");
  return t;
};
export async function curriculumAction(body: Row) {
  await authed(body?.initData, "owner");
  if (body.action === "save") {
    const list: Row[] = Array.isArray(body.chapters) ? body.chapters : [];
    need(list.length, "لازم فصل واحد على الأقل");
    const lines: string[] = [];
    for (const c of list) {
      lines.push(`# ${cell(c?.ar, "كل فصل لازم إله اسم عربي")} | ${cell(c?.en, "", false)}`);
      for (const t of Array.isArray(c?.topics) ? c.topics : []) {
        const n = Number(toLatinDigits(String(t?.lectures ?? 0)));
        need(Number.isInteger(n) && n >= 0 && n <= 999, "عدد المحاضرات لازم رقم كامل");
        lines.push(`${cell(t?.ar, "كل موضوع لازم إله اسم عربي")} | ${cell(t?.en, "", false)} = ${n}`);
      }
    }
    await saveCurriculum(lines.join("\n"));
  } else need(body.action === "list", "أمر غير معروف");
  return await curriculumData();
}

// ---------- الأسئلة اللي تنتظر جواب
export async function questionsAction(body: Row) {
  await authed(body?.initData, "q");
  need(body.action === "list", "أمر غير معروف");
  const g = await groupId();
  const base = g && String(g).startsWith("-100") ? `https://t.me/c/${String(g).slice(4)}/` : null;
  const qs = await find("questions", { status: "open" }, { order: ["id"], limit: 100 });
  return {
    group: !!g,
    questions: await Promise.all(qs.map(async (q) => ({
      id: q.id, name: (await student(q.user_id))?.name ?? "—", where: await qWhere(q), created: q.created ?? "", link: base && q.thread_id ? `${base}${q.thread_id}` : null,
    }))),
  };
}
