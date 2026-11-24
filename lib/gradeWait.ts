// درجة الطالب ما توصله إلا ورا ما ولي أمره يستلمها (طلب الأستاذ 2026-11-24: «اخفي الرقم»).
// الطالب اللي عنده ولي أمر مربوط: من تنصحح ورقته توصله رسالة بلا رقم، وبطاقة درجته (ويا المقولة والملصق) تنحفظ هنا،
// ومن يدوس ولي الأمر «✅ استلمت» توصل للطالب. الطالب بلا ولي أمر، لو ولي أمره حاظر البوت: توصله على طول مثل قبل
import { kvGet, kvSet } from "./db.ts";

/** card: بطاقة الدرجة الأولى. edit: تعديل درجة بعدين */
export type Waiting = { id: number; kind: "card" | "edit"; c?: string; sticker?: number | null };
const key = (sid: number) => `grade_wait_${sid}`;

export async function waitingOf(sid: number): Promise<Waiting[]> {
  try {
    const j = JSON.parse((await kvGet(key(sid))) || "[]");
    return Array.isArray(j) ? j.filter((w) => Number.isInteger(w?.id) && (w.kind === "card" || w.kind === "edit")) : [];
  } catch { return []; }
}
export const setWaiting = (sid: number, list: Waiting[]) => kvSet(key(sid), JSON.stringify(list));

/** تنحفظ للطالب لحد ما ولي أمره يستلم. البطاقة المنتظرة تطلع بآخر درجة، فالتعديل عليها ما يحتاج رسالة ثانية */
export async function holdForStudent(sid: number, w: Waiting) {
  const list = await waitingOf(sid);
  if (list.some((x) => x.id === w.id && (x.kind === "card" || x.kind === w.kind))) return;
  await setWaiting(sid, [...list, w]);
}

export const waitText = (title: string) => `📝 <b>تم تصحيح ورقتك بامتحان ${title}</b>
👨‍👧 تستلم درجتك بعد ما ولي أمرك يدوس «✅ استلمت الدرجة» بموبايله.`;
export const editWaitText = (title: string) => `✏️ <b>تعدلت درجتك بامتحان ${title}</b>
👨‍👧 تستلم الدرجة الجديدة بعد ما ولي أمرك يدوس «✅ استلمت الدرجة».`;
