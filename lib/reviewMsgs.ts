// 📩 رسالة قصي العميري للطالب من «مراجعة تصحيح الذكاء» (طلبه 2026-11-28): كتابة أو فويس، مثل المصحح الحقيقي.
// بالمراجعة كلشي بصمت، فالرسالة تنحفظ وتنتظر، وتوصل للطالب ويا درجته من يدوس «📤 دز للطلاب»
// (أو من توصل الورقة المحجوزة وحدها بعد المدة)
import { files } from "./files.ts";
import { kvGet, kvSet, one } from "./db.ts";
import { deliverMsg } from "./directMsg.ts";

type Queued = { caption: string; voice: string | null; type: string; at: number };
const key = (id: number) => `ai_review_msgs_${id}`;
const read = async (id: number): Promise<Queued[]> => { try { const j = JSON.parse((await kvGet(key(id))) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };

export async function queueMsg(id: number, caption: string, voice: Blob | null) {
  const list = await read(id);
  let ref: string | null = null;
  if (voice) {
    ref = `review_msgs/${id}/${Date.now()}.bin`;
    await files().write(ref, Buffer.from(await voice.arrayBuffer()), voice.type || "audio/ogg");
  }
  list.push({ caption, voice: ref, type: voice?.type || "", at: Date.now() });
  await kvSet(key(id), JSON.stringify(list));
  return list.length;
}
/** كم رسالة تنتظر بهاي الأوراق */
export async function queuedCount(ids: number[]) {
  let n = 0;
  for (const id of ids) n += (await read(id)).length;
  return n;
}
/** كم ورقة عدها رسائل تنتظر */
export async function queuedPapers(ids: number[]) {
  let n = 0;
  for (const id of ids) if ((await read(id)).length) n++;
  return n;
}
/** يوصل الرسائل المنتظرة للأوراق اللي وصلت درجتها. يرجع كم رسالة وصلت */
export async function sendQueued(ids: number[]) {
  let n = 0;
  for (const id of ids) {
    const list = await read(id);
    if (!list.length) continue;
    const it = await one("sched_items", { id });
    if (!it?.graded_at) continue; // المحجوزة: تنتظر لحد ما توصل درجتها
    const left: Queued[] = [];
    for (const m of list) {
      try {
        const b = m.voice ? await files().read(m.voice) : null;
        await deliverMsg(Number(it.user_id), m.caption, b ? new Blob([new Uint8Array(b)], { type: m.type || "audio/ogg" }) : null);
        n++;
      } catch (e) { console.error(e); left.push(m); }
    }
    await kvSet(key(id), JSON.stringify(left));
  }
  return n;
}
