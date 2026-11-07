// يجمع نص الملازم (اللي قراه Word صفحة صفحة بمجلد _index) بملف واحد «الملازم.json» ينرفع من صفحة «📚 الملازم».
// الفصل والمنهج والنوع من اسم المجلد والملف: «بكج الفصل 2 2027/عربي 2/وزاريات ...». إذا أكو أكثر من ملزمة لنفس
// الفصل والمنهج والنوع (مثل نسختين من الفصل الثالث)، ناخذ أحدث ملف Word. التشغيل:
//   node scripts/booklets-bundle.ts "data/الملازم"
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "data/الملازم");
const idx = path.join(root, "_index");
type Item = { chapter: number; lang: "ar" | "en"; kind: "main" | "extra" | "exams"; name: string; pages: string[]; source: string; mtime: number };
const picked = new Map<string, Item>();
for (const f of fs.readdirSync(idx).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(fs.readFileSync(path.join(idx, f), "utf8")) as { file: string; pages: string[] };
  const rel = j.file.replace(/\\/g, "/");
  const [folder, langDir, name] = rel.split("/");
  const chapter = Number(/الفصل\s*(\d)/.exec(folder)?.[1]);
  const lang = /انكل|انجل|english/i.test(langDir) ? "en" : "ar";
  const kind = /اثرائي/.test(name) ? "extra" : /وزاري/.test(name) ? "exams" : "main";
  if (!chapter) { console.log("⚠️ ما عرفت الفصل:", rel); continue; }
  const docx = path.join(root, rel);
  const mtime = fs.existsSync(docx) ? fs.statSync(docx).mtimeMs : 0;
  const key = `${chapter}|${lang}|${kind}`;
  const old = picked.get(key);
  if (old) console.log(`ℹ️ ${key}: أكثر من ملف، ${mtime > old.mtime ? "اخترت" : "تركت"} ${name} (${mtime > old.mtime ? "تركت" : "اخترت"} ${old.source})`);
  if (!old || mtime > old.mtime) picked.set(key, { chapter, lang, kind, name: name.replace(/\.docx$/i, "").trim(), pages: j.pages, source: name, mtime });
}
const booklets = [...picked.values()].sort((a, b) => a.chapter - b.chapter || a.lang.localeCompare(b.lang) || a.kind.localeCompare(b.kind))
  .map(({ chapter, lang, kind, name, pages }) => ({ chapter, lang, kind, name, pages }));
const out = path.join(root, "الملازم.json");
fs.writeFileSync(out, JSON.stringify({ made: new Date().toISOString(), booklets }));
for (const b of booklets) console.log(`الفصل ${b.chapter} · ${b.lang} · ${b.kind} · ${b.pages.length} صفحة · ${b.name}`);
console.log(`\n✅ ${booklets.length} ملزمة بالملف: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
