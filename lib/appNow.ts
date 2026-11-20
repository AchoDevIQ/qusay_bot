// «يهمك هسه» (طلب الأستاذ 2026-11-17، بدل إعلانات التطبيق القديمة): بالرئيسية شريط بطاقات جنب بعض يسحبها الطالب،
// البوت يختار وحده الأهم إله هسه، كل بطاقة تودّيه لمكانها:
//   ١. امتحان مفتوح هسه  ٢. امتحاناته اليوم وباچر (إذا عنده امتحانين، مثلاً تعويض الفصل الأول والثالث، بطاقتين جنب بعض)
//   ٣. إشعارات ما قراها (تطلع هنا، وما يحتاج يفوت للإشعارات)  ٤. درجة طلعت بآخر يومين  ٥. طلب بعده يتجهز
//   ٦. إذا ماكو شي من فوك: امتحانه الجاي
import { find, type Row } from "./db.ts";
import { student } from "./data.ts";
import { roomState } from "./examRoom.ts";
import { plain } from "./appPush.ts";
import { schedSettings } from "./schedApi.ts";
import { addDays, ampm, prettyDay } from "./scheduleRules.ts";
import { stamp, todayStr } from "./util.ts";

export type NowCard = { kind: "exam" | "notice" | "grade" | "order" | "next"; title: string; text: string; go: "exams" | "inbox" | "orders"; hot?: boolean; id?: number };
const MAX = 8;

export async function nowCards(uid: number, now = stamp()): Promise<NowCard[]> {
  const s = await schedSettings();
  const today = now.slice(0, 10) || todayStr(), tomorrow = addDays(today, 1);
  const st = await student(uid);
  const inPerson = st?.exam === "حضوري";
  const exams = new Map((await find("bank_exams")).map((e) => [e.id as number, e]));
  const items = (await find("sched_items", { user_id: uid })).filter((i) => i.kind !== "optional" && i.notified !== "test" && i.status !== "skipped")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const title = (i: Row) => String(exams.get(i.exam_id)?.title ?? "امتحان");
  const where = (i: Row) => (i.kind === "catchup" ? (i.catch_place === "ipad" ? "تعويض حضوري بمركزك بالآيباد" : "تعويض إلكتروني") : i.catch_place === "online" ? "إلكتروني من بيتك" : i.catch_place === "ipad" ? "بمركزك بالآيباد" : inPerson ? "بمركزك" : "إلكتروني");
  const when = (at: string) => `${at.slice(0, 10) === today ? "اليوم" : at.slice(0, 10) === tomorrow ? "باچر" : prettyDay(at.slice(0, 10))} الساعة ${ampm(at.slice(11, 16))}`;
  const out: NowCard[] = [];
  // ١. مفتوح هسه
  for (const i of items) {
    if (i.status === "done" || i.graded_at) continue;
    if (roomState(i, s, now) !== "open") continue;
    const center = where(i).includes("مركزك");
    out.push({ kind: "exam", hot: true, id: Number(i.id), title: `📝 ${title(i)}`, text: center ? "امتحانك هسه بمركزك" : "امتحانك مفتوح هسه، ادخل", go: "exams" });
  }
  // ٢. اليوم وباچر
  for (const i of items) {
    const at = String(i.at ?? "");
    if (i.status !== "waiting" || at <= now || at.slice(0, 10) > tomorrow) continue;
    out.push({ kind: "exam", id: Number(i.id), title: `📝 ${title(i)}`, text: `${when(at)} · ${where(i)}`, go: "exams" });
  }
  // ٣. إشعارات ما قراها
  const { myNotices } = await import("./notices.ts");
  for (const n of (await myNotices(uid)).filter((x) => !x.read).slice(0, 3)) out.push({ kind: "notice", id: n.id, title: n.kind === "keep" ? "📌 إشعار" : "🔔 إشعار جديد", text: plain(n.text, 120), go: "inbox" });
  // ٤. درجة طلعت بآخر يومين
  const since = `${addDays(today, -2)} ${now.slice(11, 16)}`;
  for (const i of items.filter((x) => x.graded_at && String(x.graded_at) >= since).reverse().slice(0, 2)) {
    out.push({ kind: "grade", id: Number(i.id), title: "✅ طلعت درجتك", text: `${title(i)}: ${Number(i.total) || 0} من 100`, go: "exams" });
  }
  // ٥. طلب بعده يتجهز
  for (const o of (await find("orders", { user_id: uid })).filter((x) => !Number(x.printed) && String(x.created ?? "") >= addDays(today, -30))) {
    out.push({ kind: "order", id: Number(o.id), title: "⏳ طلبك يتجهز", text: `طلب رقم ${o.id}، تگدر تشوفه بطلباتي`, go: "orders" });
  }
  // ٦. ماكو شي: امتحانه الجاي
  if (!out.some((c) => c.kind === "exam")) {
    const next = items.find((i) => i.status === "waiting" && String(i.at ?? "") > now);
    if (next) out.push({ kind: "next", id: Number(next.id), title: "📅 امتحانك الجاي", text: `${title(next)} · ${when(String(next.at))} · ${where(next)}`, go: "exams" });
  }
  return out.slice(0, MAX);
}
