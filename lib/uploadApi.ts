// رفع فصل كامل من صفحة: الملفات وحدة وحدة، بصلاحية السيرفر نفسه، فما يحتاج مفتاح Firebase. لصاحب البوت بس
import path from "node:path";
import { find, one, update, type Row } from "./db.ts";
import { alignOrds, loadCatalog } from "./examBank.ts";
import { files } from "./files.ts";
import { authed, need } from "./webApi.ts";

const PART = 3;      // كل طلب يدخل كم امتحان، حتى ما يخلص وقت الطلب
const MAX_FILE = 30 * 1024 * 1024;
const SAFE = /^(?:ch\d+\/[A-Za-z0-9_./-]+\.(?:png|pdf|json)|answers\/ch\d+\/e\d+\/[A-Z]\.pdf)$/;
const TYPES: Record<string, string> = { ".png": "image/png", ".pdf": "application/pdf", ".json": "application/json" };
const slugOf = (raw: unknown) => { const s = String(raw ?? ""); need(/^ch\d+$/.test(s), "فصل غير معروف"); return s; };
async function catalogOf(slug: string) {
  const body = await files().read(`${slug}/catalog.json`);
  need(body, "ملف الفصل ما انرفع بعد");
  return JSON.parse(body!.toString("utf8")) as Row;
}

export async function uploadFile(form: FormData) {
  await authed(form.get("initData"), "owner");
  const ref = String(form.get("path") ?? "");
  need(SAFE.test(ref) && !ref.includes(".."), "مسار ملف غير مسموح");
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0 && f.size <= MAX_FILE, "الملف فارغ أو كبير");
  await files().write(ref, Buffer.from(await (f as Blob).arrayBuffer()), TYPES[path.extname(ref)]);
  return { ok: true };
}

export async function uploadAction(body: Row) {
  await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  if (a === "list") return { ready: true };
  const slug = slugOf(body.slug);
  if (a === "have") return { names: [...await files().list(`${slug}/`, true), ...await files().list(`answers/${slug}/`, true)] };
  if (a === "start") {
    const c = await catalogOf(slug);
    await alignOrds(c);
    return { total: c.exams.length, chapter: c.chapter };
  }
  need(a === "part", "أمر غير معروف");
  const c = await catalogOf(slug);
  const from = Math.max(0, Number(body.from) || 0);
  const exams = c.exams.slice(from, from + PART);
  if (exams.length) await loadCatalog({ ...c, exams, partial: true });
  // ملف الحلول الكامل لكل نسخة. اللي انرفع من اللوحة يبقى
  const have = new Set(await files().list(`answers/${slug}/`, true));
  for (const ex of exams) {
    const e = await one("bank_exams", { slug, ord: ex.ord });
    if (!e) continue;
    for (const v of await find("bank_versions", { exam_id: e.id })) {
      const ref = `answers/${slug}/e${ex.ord}/${v.model}.pdf`;
      if (!v.manual && !v.answer_pdf && have.has(ref)) await update("bank_versions", { id: v.id }, { answer_pdf: ref });
    }
  }
  return { done: from + exams.length, total: c.exams.length };
}
