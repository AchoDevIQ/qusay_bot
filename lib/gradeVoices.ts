// تعليقات المصحح بالصوت: المصحح يسجل فويس على مكان بالورقة، وتوصل للطالب ويا ورقته المصححة.
// إذا حفظه بالأخطاء الشائعة، كل المصححين اللي يصححون نفس الامتحان يگدرون يستعملوه بضغطة بدون ما يسجلون من جديد
import path from "node:path";
import { randomUUID } from "node:crypto";
import { kvGet, kvSet } from "./db.ts";
import { files } from "./files.ts";
import { upload } from "./telegram.ts";
import { AUDIO, audioExt } from "./objections.ts";
import { need } from "./webApi.ts";

export type Voice = { id: string; name: string; ref: string };
const VOICE_MAX = 20 * 1024 * 1024;
const examKey = (examId: number) => `grade_voices_exam_${examId}`;
const paperKey = (itemId: number) => `grade_voices_paper_${itemId}`;
async function read(key: string): Promise<Voice[]> {
  try { const j = JSON.parse(await kvGet(key) ?? "[]"); return Array.isArray(j) ? j.filter((v) => v && typeof v.ref === "string") : []; } catch { return []; }
}
const write = (key: string, list: Voice[]) => kvSet(key, JSON.stringify(list));

export const examVoices = (examId: number) => read(examKey(examId));
export const paperVoices = (itemId: number) => read(paperKey(itemId));
export const clearPaperVoices = (itemId: number) => write(paperKey(itemId), []);

/** فويس جديد على الورقة، وإذا keep ينحفظ ويا الأخطاء الشائعة مال الامتحان */
export async function addVoice(itemId: number, examId: number, blob: unknown, rawName: unknown, keep: boolean) {
  need(blob instanceof Blob && blob.size > 0, "سجل الفويس أول");
  need((blob as Blob).size <= VOICE_MAX, "التسجيل طويل هواية");
  const name = String(rawName ?? "").trim().slice(0, 60);
  need(!keep || name, "اكتب اسم قصير للفويس حتى يبين بالأخطاء الشائعة");
  const ext = audioExt((blob as Blob).type || "");
  const ref = path.posix.join("gradevoices", String(examId), `${randomUUID()}.${ext}`);
  await files().write(ref, Buffer.from(await (blob as Blob).arrayBuffer()), AUDIO[`.${ext}`]);
  const v: Voice = { id: randomUUID().slice(0, 8), name: name || "تعليق صوتي", ref };
  if (keep) await write(examKey(examId), [v, ...await examVoices(examId)].slice(0, 100));
  const mine = [...await paperVoices(itemId), v];
  await write(paperKey(itemId), mine);
  return mine.length;
}
/** فويس محفوظ بالأخطاء الشائعة ينضاف لهذي الورقة */
export async function useVoice(itemId: number, examId: number, id: unknown) {
  const v = (await examVoices(examId)).find((x) => x.id === id);
  need(v, "هذا الفويس انمسح");
  const mine = [...await paperVoices(itemId), v!];
  await write(paperKey(itemId), mine);
  return mine.length;
}
export async function dropSaved(examId: number, id: unknown) {
  await write(examKey(examId), (await examVoices(examId)).filter((x) => x.id !== id));
}
export async function dropFromPaper(itemId: number, n: unknown) {
  const mine = await paperVoices(itemId);
  const i = Number(n) - 1;
  need(Number.isInteger(i) && i >= 0 && i < mine.length, "الفويس غير موجود");
  mine.splice(i, 1);
  await write(paperKey(itemId), mine);
}

/** توصل للطالب ويا ورقته المصححة: كل فويس برقمه، نفس الرقم المكتوب على الورقة */
export async function sendPaperVoices(chat: number, itemId: number) {
  const list = await paperVoices(itemId);
  for (const [i, v] of list.entries()) {
    const ext = path.extname(v.ref).slice(1);
    const method = ext === "webm" ? "sendDocument" : "sendVoice";
    const field = method === "sendVoice" ? "voice" : "document";
    const caption = `🎙 <b>تعليق المصحح ${i + 1}</b>${list.length > 1 ? ` من ${list.length}` : ""} · مكانه مكتوب على ورقتك «🎙${i + 1}»`;
    const fields = { chat_id: String(chat), caption, parse_mode: "HTML", protect_content: "true" };
    const body = await files().read(v.ref);
    if (!body) continue;
    await upload(method, fields, field, body, `voice.${ext}`, AUDIO[`.${ext}`] ?? "audio/ogg");
  }
}
