// يرفع ملفات الجواب النموذجي الكاملة:  npm run upload-answers -- "C:\path\key.json"
// ينعاد بأمان: النسخة اللي عندها ملف تبقى مثل ما هي
import fs from "node:fs";
import path from "node:path";

const keyFile = process.argv[2];
if (!keyFile || !fs.existsSync(keyFile)) {
  console.error('الاستخدام: npm run upload-answers -- "C:\\path\\key.json"');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
Object.assign(process.env, {
  FIREBASE_PROJECT_ID: key.project_id, FIREBASE_CLIENT_EMAIL: key.client_email, FIREBASE_PRIVATE_KEY: key.private_key,
  FIREBASE_STORAGE_BUCKET: `${key.project_id}.firebasestorage.app`,
});

const { linkAnswerFiles } = await import("../lib/answerFiles.ts");
const dir = path.join(process.cwd(), "data", "exams", "الاجوبه النموذجيه");
const r = await linkAnswerFiles(dir, process.argv[3] ?? "ch1", (line) => console.log("✅", line));
console.log(`انرفع ${r.sent} ملف، وكان موجود ${r.kept}، وما لگيت ${r.missing.length}${r.missing.length ? ": " + r.missing.join("، ") : ""}`);
process.exit(0);
