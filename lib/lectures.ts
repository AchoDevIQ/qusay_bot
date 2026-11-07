// السكة: كل امتحان قبله محاضراته بالترتيب، مثل «قطع مكافئ 1&2» قبله المحاضرة 1 و2.
// البوت يطلعها وحده من عنوان الامتحان، وصاحب البوت يعدلها. المحاضرات نفسها بالتطبيق، والبوت يبين الترتيب بس
import { LOCK_TEXT, examInProgress } from "./examLock.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { bookExams } from "./checkpoints.ts";
import { files } from "./files.ts";
import { api, upload } from "./telegram.ts";
import { esc } from "./util.ts";
import { authed, need } from "./webApi.ts";

const KEY = "exam_lectures";
const LINK = "app_link";
const MAX_LECTURES = 20;
const MAX_NAME = 80;

/** المحاضرات من العنوان: «قطع مكافئ 1&2» ← قطع مكافئ: المحاضرة 1، المحاضرة 2. الفاينل والشامل والنصف فاينل مراجعة بدون محاضرات */
export function guessLectures(title: string, info = ""): string[] {
  const t = String(title ?? "").trim();
  if (/فاينل|شامل|final|all /i.test(t)) return [];
  let topic = t, nums = "";
  const m = /^(.*?)\s*\(?\s*(\d+(?:\s*&\s*\d+)*)\s*\)?\s*$/.exec(t);
  if (m) [topic, nums] = [m[1], m[2]];
  else nums = /\(\s*(\d+(?:\s*&\s*\d+)*)\s*\)/.exec(String(info ?? ""))?.[1] ?? "";
  if (!nums) return [];
  topic = topic.replace(/\s*(?:المحاضرة|محاضرة)\s*$/, "").trim();
  return nums.split("&").map((n) => `${topic ? `${topic}: ` : ""}المحاضرة ${Number(n)}`);
}

async function saved(): Promise<Record<string, string[]>> {
  try { return JSON.parse(await kvGet(KEY) ?? "{}"); } catch { return {}; }
}
/** محاضرات كل امتحان: اللي عدلها صاحب البوت، وإلا من العنوان */
export async function lectureMap() {
  const own = await saved();
  return new Map((await find("bank_exams")).map((e) => [e.id as number, own[String(e.id)] ?? guessLectures(e.title, e.info)]));
}
export const appLink = async () => (await kvGet(LINK)) ?? "";

// ---------- ملف كل محاضرة: صاحب البوت يرفعه ويخليه ظاهر أو مخفي. الطالب يدوس فيوصله بالبوت محمي
// (ما ينعاد توجيهه ولا ينحفظ، وبالتلفون تليجرام يمنع تصويره)
const FILES = "lecture_files";
const FILE_MAX = 49 * 1024 * 1024;   // تليجرام يقبل لحد 50 ميگا للبوت
type LecFile = { ref: string; fname: string; visible: boolean; at: string; fid?: string };
async function lectureFiles(): Promise<Record<string, LecFile>> { try { return JSON.parse(await kvGet(FILES) ?? "{}"); } catch { return {}; } }
/** أسماء المحاضرات اللي ملفها ظاهر للطالب */
export async function visibleLectureFiles() { return Object.entries(await lectureFiles()).filter(([, f]) => f.visible).map(([name]) => name); }
/** الطالب يطلب ملف المحاضرة: يوصله بالبوت محمي. أول مرة ينرفع لتليجرام، وبعدها نفس الملف بدون رفع */
export async function sendLectureFile(uid: number, name: unknown) {
  need(!await examInProgress(uid), LOCK_TEXT, 423);
  const all = await lectureFiles();
  const f = all[String(name ?? "")];
  need(f?.visible, "هذا الملف مو متوفر");
  const caption = `📄 <b>${esc(String(name))}</b>`;
  if (f!.fid && await api("sendDocument", { chat_id: uid, document: f!.fid, caption, parse_mode: "HTML", protect_content: true })) return;
  const body = await files().read(f!.ref);
  need(body, "الملف غير موجود");
  const r: any = await upload("sendDocument", { chat_id: String(uid), caption, parse_mode: "HTML", protect_content: "true" }, "document", body!, f!.fname, "application/octet-stream");
  need(r, "ما گدرت أدز الملف هسه، حاول بعد شوية");
  const fid = r?.document?.file_id;
  if (fid) { const fresh = await lectureFiles(); if (fresh[String(name)]) { fresh[String(name)].fid = fid; await kvSet(FILES, JSON.stringify(fresh)); } }
}
/** رفع ملف محاضرة (FormData) */
export async function lectureFileUpload(form: FormData) {
  await authed(form.get("initData"), "owner");
  const name = String(form.get("name") ?? "").trim();
  need(name && name.length <= MAX_NAME, "المحاضرة غير معروفة");
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0, "اختار الملف");
  need((f as Blob).size <= FILE_MAX, "الملف كبير، تليجرام يقبل لحد 50 ميگا");
  const fname = path.basename(String((f as File).name || "lecture.pdf")).slice(0, 100);
  const ref = `lectures/${randomUUID()}${path.extname(fname).toLowerCase() || ".pdf"}`;
  await files().write(ref, Buffer.from(await (f as Blob).arrayBuffer()), (f as Blob).type || "application/octet-stream");
  const all = await lectureFiles();
  all[name] = { ref, fname, visible: all[name]?.visible ?? false, at: new Date().toISOString().slice(0, 16).replace("T", " ") };
  await kvSet(FILES, JSON.stringify(all));
  return { ...await pageData(), notice: `✅ انرفع ملف «${name}»${all[name].visible ? "" : ". بعده مخفي عن الطلاب"}` };
}

async function pageData() {
  const own = await saved();
  const chapters = [];
  for (const [chapter, list] of await bookExams()) {
    chapters.push({ chapter, exams: list.map((e: Row) => ({ id: e.id as number, title: String(e.title ?? ""), lectures: own[String(e.id)] ?? guessLectures(e.title, e.info), custom: String(e.id) in own })) });
  }
  const lf = await lectureFiles();
  return { chapters, link: await appLink(), files: Object.fromEntries(Object.entries(lf).map(([k, v]) => [k, { fname: v.fname, visible: v.visible, at: v.at }])), notice: "" };
}

export async function lecturesAction(body: Row) {
  await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  let notice = "";
  if (a === "save" || a === "reset") {
    const id = Number(body.exam);
    const e = (await find("bank_exams", { id }))[0];
    need(e, "الامتحان غير موجود");
    const own = await saved();
    if (a === "reset") {
      delete own[String(id)];
      notice = `↩️ رجعت محاضرات ${e.title} مثل العنوان`;
    } else {
      const lines = String(body.lines ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
      need(lines.length <= MAX_LECTURES, `أكثر شي ${MAX_LECTURES} محاضرة للامتحان`);
      need(lines.every((x) => x.length <= MAX_NAME), `اسم المحاضرة أكثر شي ${MAX_NAME} حرف`);
      own[String(id)] = lines;
      notice = lines.length ? `✅ انحفظت ${lines.length} محاضرة قبل ${e.title}` : `✅ ${e.title} صار بدون محاضرات`;
    }
    await kvSet(KEY, JSON.stringify(own));
  } else if (a === "saveLink") {
    const link = String(body.link ?? "").trim();
    need(!link || (/^https:\/\/\S+$/.test(link) && link.length <= 300), "الرابط لازم يبدي بـ https://");
    await kvSet(LINK, link);
    notice = link ? "✅ انحفظ رابط التطبيق" : "🗑 انشال رابط التطبيق";
  } else if (a === "fileShow" || a === "fileDelete") {
    const all = await lectureFiles();
    const name = String(body.name ?? "");
    need(all[name], "ماكو ملف لهذي المحاضرة");
    if (a === "fileDelete") { delete all[name]; notice = `🗑 انشال ملف «${name}»`; }
    else { all[name].visible = !!body.visible; notice = all[name].visible ? `👁 ملف «${name}» صار ظاهر للطلاب` : `🙈 ملف «${name}» صار مخفي`; }
    await kvSet(FILES, JSON.stringify(all));
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
