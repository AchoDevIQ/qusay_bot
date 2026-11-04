// يرفع ملفات الامتحانات من القرص إلى Cloud Storage:  npm run upload-content
// الملف الموجود بنفس الحجم ما ينرفع مرة ثانية، فتكدر تعيده إذا انقطع
import path from "node:path";
import fs from "node:fs";
import { CONTENT_DIR } from "../lib/config.ts";
import { bucket } from "../lib/firebase.ts";
import { localStore } from "../lib/files.ts";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".json": "application/json" };
const WORKERS = 8;

const [existing] = await bucket().getFiles({ prefix: "content/" });
const sizes = new Map(existing.map((f) => [f.name, Number(f.metadata.size)]));
const names = await localStore(CONTENT_DIR).list("");
let next = 0, sent = 0, skipped = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (next < names.length) {
    const name = names[next++];
    const local = path.join(CONTENT_DIR, name);
    if (sizes.get("content/" + name) === fs.statSync(local).size) { skipped++; continue; }
    await bucket().upload(local, { destination: "content/" + name, resumable: false, contentType: TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream" });
    sent++;
  }
}));
console.log(`انرفع ${sent} ملف، وكان موجود ${skipped}.`);
process.exit(0);
