// يربط ملفات الجواب النموذجي الكاملة بنسخ الامتحانات المدخلة. الملف اسمه مثل «A 1.pdf» داخل مجلد رقم الامتحان
import fs from "node:fs";
import path from "node:path";
import { find, update } from "./db.ts";
import { files } from "./files.ts";

export async function linkAnswerFiles(dir: string, slug: string, log: (line: string) => void = () => {}) {
  const out = { sent: 0, kept: 0, missing: [] as string[] };
  for (const e of await find("bank_exams", { slug }, { order: ["ord"] })) {
    for (const v of await find("bank_versions", { exam_id: e.id }, { order: ["model"] })) {
      if (v.manual) continue;
      // الملف اللي انرفع من اللوحة يبقى
      if (v.answer_pdf) { out.kept++; continue; }
      const folder = path.join(dir, String(e.ord));
      const name = fs.existsSync(folder) ? fs.readdirSync(folder).find((f) => /\.pdf$/i.test(f) && /^([A-Za-z]+)\s*\d+\./.exec(f)?.[1].toUpperCase() === v.model) : null;
      if (!name) { out.missing.push(`${e.ord} ${v.model}`); continue; }
      const source = path.join(folder, name);
      const ref = path.posix.join("answers", slug, `e${e.ord}`, `${v.model}.pdf`);
      await files().write(ref, fs.readFileSync(source), "application/pdf");
      await update("bank_versions", { id: v.id }, { answer_pdf: ref });
      out.sent++;
      log(`${e.ord} ${v.model}`);
    }
  }
  return out;
}
