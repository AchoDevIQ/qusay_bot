// السكة: كل امتحان قبله محاضراته بالترتيب، مثل «قطع مكافئ 1&2» قبله المحاضرة 1 و2.
// البوت يطلعها وحده من عنوان الامتحان، وصاحب البوت يعدلها. المحاضرات نفسها بالتطبيق، والبوت يبين الترتيب بس
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { bookExams } from "./checkpoints.ts";
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

async function pageData() {
  const own = await saved();
  const chapters = [];
  for (const [chapter, list] of await bookExams()) {
    chapters.push({ chapter, exams: list.map((e: Row) => ({ id: e.id as number, title: String(e.title ?? ""), lectures: own[String(e.id)] ?? guessLectures(e.title, e.info), custom: String(e.id) in own })) });
  }
  return { chapters, link: await appLink(), notice: "" };
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
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
