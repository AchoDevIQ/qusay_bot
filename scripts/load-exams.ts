// يدخل الامتحانات المجهزة بـ tools/import_exams.py إلى قاعدة البيانات
// الاستخدام:  npm run load-exams -- ch1
import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "../lib/config.ts";
import { initDb } from "../lib/db.ts";
import { loadCatalog } from "../lib/examBank.ts";

const slug = process.argv[2];
const file = slug && path.join(CONTENT_DIR, slug, "catalog.json");
if (!file || !fs.existsSync(file)) {
  console.error("الاستخدام: npm run load-exams -- ch1   (لازم يكون الملف موجود: data/content/ch1/catalog.json)");
  process.exit(1);
}
await initDb();
const r = await loadCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
console.log(`انضاف: ${r.exams} امتحان، ${r.versions} نسخة، ${r.questions} سؤال. نسخ تحتاج تصليح: ${r.needReview}`);
