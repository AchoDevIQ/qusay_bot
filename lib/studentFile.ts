// ملف الطالب: كل شي يخصه بمكان واحد بصفحة الطلاب: درجاته، أوراقه، مشترياته، غياباته، إيقافاته، أسئلته، وسجل عملياته
import { activityOf } from "./access.ts";
import { find, one, type Row } from "./db.ts";
import { orderItems } from "./data.ts";
import { studentPapers } from "./studentPapers.ts";

const ORDER_STATE: Record<number, string> = { 0: "طلب جديد", 1: "انطبع للتوصيل", 2: "ملغي", 3: "بيعة مكتبة" };

export async function studentFile(uid: number) {
  const [papers, orders, items, stops, questions, log] = await Promise.all([
    studentPapers(uid),
    find("orders", { user_id: uid }, { order: ["-id"] }),
    find("sched_items", { user_id: uid }),
    find("student_stops", { user_id: uid }, { order: ["-id"] }),
    find("questions", { user_id: uid }, { order: ["-id"] }),
    activityOf(uid, 300),
  ]);
  const exams = new Map<number, Row>();
  for (const it of items) if (!exams.has(it.exam_id)) { const e = await one("bank_exams", { id: it.exam_id }); if (e) exams.set(it.exam_id, e); }
  const absences = items.filter((i) => i.status === "missed" && !i.graded_at).sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((i) => ({ id: i.id as number, title: exams.get(i.exam_id)?.title ?? "امتحان", chapter: exams.get(i.exam_id)?.chapter ?? "", at: String(i.at ?? "") }));
  const attended = items.filter((i) => i.attended_at).sort((a, b) => String(b.attended_at).localeCompare(String(a.attended_at)))
    .map((i) => ({ id: i.id as number, title: exams.get(i.exam_id)?.title ?? "امتحان", at: String(i.attended_at) }));
  const live = orders.filter((o) => o.printed !== 2);
  const graded = papers.filter((p) => p.total !== null);
  return {
    papers,
    orders: orders.map((o) => ({ id: o.id as number, created: String(o.created ?? ""), state: ORDER_STATE[o.printed as number] ?? "", cancelled: o.printed === 2, total: Number(o.total) || 0, items: orderItems(o).map((i) => `${i.name} ×${i.qty}`) })),
    spent: live.reduce((t, o) => t + (Number(o.total) || 0), 0),
    absences, attended,
    stops: stops.map((s) => ({ id: s.id as number, chapter: String(s.chapter ?? ""), score: s.score ?? 0, max: s.max ?? 0, absent: s.absent ?? 0, reason: String(s.reason ?? ""), created: String(s.created ?? ""), lifted: String(s.lifted ?? "") })),
    questions: questions.map((q) => ({ id: q.id as number, status: String(q.status ?? ""), created: String(q.created ?? "") })),
    log,
    average: graded.length ? Math.round(graded.reduce((t, p) => t + Number(p.total), 0) / graded.length) : null,
  };
}
