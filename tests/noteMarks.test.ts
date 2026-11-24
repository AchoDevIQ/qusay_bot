// أزرار الفيديو داخل الملزمة: تنحط وحدها على الأسئلة، الفيديو التوضيحي يدور سؤاله، والتعديل والحذف من صاحب البوت
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-marks-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { insert, one, put } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { noteAction, noteAdmin, noteVideo } = await import("../lib/notes.ts");
const { parseLink, parseYouTube, questionTag, videoName } = await import("../lib/noteMarks.ts");
const { files } = await import("../lib/files.ts");
await ensure();

/** PDF صغير بصفحة وحدة وسطور إنجليزي (y من جوه) */
function pdf(lines: [number, string][]) {
  const text = lines.map(([y, t]) => `BT /F1 12 Tf 40 ${y} Td (${t}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
const admin = (action: string, x: object = {}) => noteAdmin({ initData: `tk:${homeToken(1)}`, action, ...x } as never) as Promise<any>;
const mp4 = (name: string) => new File([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40)])], name, { type: "video/mp4" });

test("رابط منشور القناة واسم الفيديو من ملفه", () => {
  assert.deepEqual(parseLink("https://t.me/c/1234567890/77"), { chat: "-1001234567890", msg: 77 });
  assert.deepEqual(parseLink("t.me/c/1234567890/5/77?single"), { chat: "-1001234567890", msg: 77 });
  assert.deepEqual(parseLink("https://t.me/qusay_ch/9"), { chat: "@qusay_ch", msg: 9 });
  assert.equal(parseLink("https://youtube.com/x"), null);
  for (const u of ["https://youtu.be/yrnZcMgZsUw?feature=shared", "https://www.youtube.com/watch?v=yrnZcMgZsUw&t=3", "youtube.com/shorts/yrnZcMgZsUw", "https://m.youtube.com/watch?v=yrnZcMgZsUw"]) assert.equal(parseYouTube(u), "yrnZcMgZsUw", u);
  for (const u of ["https://youtube.com/x", "https://evil.com/youtu.be/yrnZcMgZsUw", "https://t.me/c/1/2"]) assert.equal(parseYouTube(u), null, u);
  assert.deepEqual(videoName("السلم_المنزلق_English_عربي.mp4"), { name: "السلم المنزلق", lang: "en" });
  assert.deepEqual(videoName("السلم_المنزلق_عربي.mp4"), { name: "السلم المنزلق", lang: "ar" });
});

test("🔍 الأزرار تنحط على الأسئلة، والفيديو التوضيحي يروح لسؤاله، والتعديل يبقى", async () => {
  await files().write("notes/m1.pdf", pdf([[700, "Q 1 / Find the derivative"], [640, "Q 2 / A ladder with 10 m length leans against a wall"], [400, "Example 3 something"]]), "application/pdf");
  const book = await insert("note_books", { title: "Ch3 EN", chapter: "الفصل الثالث", lang: "en", file: "m1", pages: 1, created: "1" });
  let r = await admin("videoUpload", { file: mp4("السلم_المنزلق_English_عربي.mp4") });
  assert.match(r.notice, /انرفع «السلم المنزلق»/);
  r = await admin("videoUpload", { file: mp4("السلم_المنزلق_English_عربي.mp4") });
  assert.match(r.notice, /انبدل/);
  assert.equal(r.videos.length, 1);
  await assert.rejects(admin("videoUpload", { file: new File([Buffer.from("not a video")], "x.mp4") }), /mp4/);
  r = await admin("autoMarks", { book });
  assert.equal(r.marks.length, 3);
  const ladder = r.marks.find((m: any) => m.page === 1 && m.label.includes("ladder"));
  assert.equal(ladder.video, r.videos[0].id);
  // الطالب يشوف بس الأزرار اللي بيها فيديو، بلا روابط
  await put("students", { user_id: 20, name: "طالب", curr: "إنجليزي", exam: "إلكتروني", created: "2026-01-01" });
  await put("guardians", { guardian_id: 1020, student_id: 20, created: "1" });
  await put("exam_access", { user_id: 20, chapter: "الفصل الثالث", created: "1" });
  await put("schedules", { user_id: 20, mode: "general", center_id: 0, picks: "{}", created: "1" });
  const act = (action: string, x: object = {}) => noteAction({ token: homeToken(20), device: "dev-00000000000020", pf: "android", action, book, ...x });
  // 🔖 الصفحة اللي وصلها: تنحفظ، وتطلع بقائمة الملازم، والصفحة الغلط تنرفض
  assert.equal((await act("list")).books.find((b: any) => b.id === book).saved, 0);
  assert.deepEqual(await act("bookmark", { page: 1 }), { saved: 1 });
  assert.equal((await act("list")).books.find((b: any) => b.id === book).saved, 1);
  await assert.rejects(act("bookmark", { page: 9 }), /الصفحة/);
  // 📝 الملاحظات اللاصقة: تنحفظ ويا الكتابة، حتى إذا الصفحة ما بيها كتابة، والغلط ينرفض
  const withNote = JSON.stringify({ items: [], notes: [{ x: 0.2, y: 0.3, t: "راجع هاي" }] });
  await act("save", { page: 1, ink: withNote });
  assert.equal((await act("ink", { page: 1 })).ink, withNote);
  await assert.rejects(act("save", { page: 1, ink: JSON.stringify({ items: [], notes: [{ x: 3, y: 0, t: "x" }] }) }), /الملاحظات/);
  // ملاحظة بالقلم: خطوطها تنحفظ وياها، والخطوط الهواية تنرفض
  const penNote = JSON.stringify({ items: [], notes: [{ x: 0.1, y: 0.1, t: "", s: [{ p: [0.1, 0.2, 0.3, 0.4] }] }] });
  await act("save", { page: 1, ink: penNote });
  assert.equal((await act("ink", { page: 1 })).ink, penNote);
  await assert.rejects(act("save", { page: 1, ink: JSON.stringify({ items: [], notes: [{ x: 0, y: 0, t: "", s: Array(151).fill({ p: [0, 0] }) }] }) }), /الملاحظات/);
  // الفيديو ما اشتغل: رمزه ينكتب بالسجل بس
  assert.deepEqual(await act("videoError", { kind: "video", code: "v4" }), { ok: true });
  await act("save", { page: 1, ink: JSON.stringify({ items: [], notes: [] }) });
  assert.equal((await act("ink", { page: 1 })).ink, "");
  const seen = (await act("marks")).marks;
  assert.deepEqual(seen.map((m: any) => [m.video, m.solution]), [[true, false]]);
  assert.ok(!JSON.stringify(seen).includes("t.me"));
  await assert.rejects(act("play", { mark: seen[0].id, kind: "solution" }), /بعده ما انضاف/);
  // الفيديو التوضيحي يشتغل جوّا الملزمة: الزر يرجع clip، والملف ينطي بس لصاحب الرابط وعلى جهازه
  assert.deepEqual(await act("play", { mark: seen[0].id, kind: "video" }), { notice: "▶️ فيديو توضيح السؤال", clip: true });
  const clip = await noteVideo(homeToken(20), book, seen[0].id, "android", "dev-00000000000020");
  assert.equal(clip.subarray(4, 8).toString(), "ftyp");
  await assert.rejects(noteVideo("غلط", book, seen[0].id, "android", "dev-00000000000020"), /قديم/);
  await assert.rejects(noteVideo(homeToken(20), book, 99999, "android", "dev-00000000000020"), /مو موجود/);
  // رابط الحل: الغلط ينرفض، والصح ينحفظ ويبقى بعد إعادة التدوير
  const q1 = r.marks.find((m: any) => m.label.startsWith("Q 1"));
  await assert.rejects(admin("markSave", { book, id: q1.id, page: 1, y: q1.y, solution: "https://youtube.com/x" }), /رابط الحل/);
  // رابط يوتيوب: ينحفظ، والطالب ياخذ رقم الفيديو بس حتى يشتغل جوّا الملزمة، بلا رابط
  const ex = r.marks.find((m: any) => m.label.startsWith("Example"));
  await admin("markSave", { book, id: ex.id, page: 1, y: ex.y, label: ex.label, solution: "https://youtu.be/W7hH5Vyt_no?feature=shared" });
  const exSeen = (await act("marks")).marks.find((m: any) => m.id === ex.id);
  assert.deepEqual([exSeen.video, exSeen.solution], [false, true]);
  assert.deepEqual(await act("play", { mark: ex.id, kind: "solution" }), { notice: "🎬 فيديو حل السؤال", yt: "W7hH5Vyt_no" });
  await admin("markSave", { book, id: ex.id, page: 1, y: ex.y, label: ex.label, solution: "" });
  // لصق روابط كثيرة: الرابط يروح للزر القريب بنفس الصفحة، والمكان الفارغ ينضافله زر، والسطر الغلط ينذكر
  const pasted = await admin("solutionsPaste", { book, text: `ص1 · ${(ex.y + 0.01).toFixed(3)} · مثال · https://youtu.be/W7hH5Vyt_no\nص1 · 0.900 · سؤال جوه · https://youtu.be/OLs8XMB0gVk\nكلام غلط` });
  assert.match(pasted.notice, /انربط 2 سؤال/);
  assert.match(pasted.notice, /انضاف 1 زر/);
  assert.match(pasted.notice, /1 سطر ما انفهم/);
  assert.equal(pasted.marks.find((m: any) => m.id === ex.id).solution, "https://youtu.be/W7hH5Vyt_no");
  const bottom = pasted.marks.find((m: any) => m.label === "سؤال جوه");
  assert.equal(bottom.solution, "https://youtu.be/OLs8XMB0gVk");
  await admin("markDelete", { book, id: bottom.id });
  await admin("markSave", { book, id: ex.id, page: 1, y: ex.y, label: ex.label, solution: "" });
  r = await admin("markSave", { book, id: q1.id, page: 1, y: q1.y, label: q1.label, solution: "https://t.me/c/123456/9" });
  r = await admin("autoMarks", { book });
  assert.equal(r.marks.find((m: any) => m.id === q1.id)?.solution, "https://t.me/c/123456/9");
  assert.equal(r.marks.length, 3);
  assert.equal((await act("marks")).marks.length, 2);
  // حذف الفيديو التوضيحي: زره يختفي من الملزمة، وزر الحل يبقى
  r = await admin("videoDelete", { id: r.videos[0].id });
  assert.equal(r.videos.length, 0);
  assert.deepEqual((await act("marks")).marks.map((m: any) => [m.video, m.solution]), [[false, true]]);
  // زر يدوي وحذفه
  r = await admin("markSave", { book, page: 1, y: 0.5, label: "يدوي", solution: "https://t.me/c/123456/10" });
  const manual = r.marks.find((m: any) => m.label === "يدوي");
  assert.ok(manual);
  await assert.rejects(admin("markSave", { book, page: 5, y: 0.5 }), /الصفحة/);
  r = await admin("markDelete", { book, id: manual.id });
  assert.equal(await one("note_marks", { id: manual.id }), null);
});

test("🔗 نفس السؤال بالدفتر والراصد والإنجليزي: تبدّل فيديوه بوحدة، يتبدل بالكل", async () => {
  const one2 = (await import("../lib/db.ts")).one;
  const lec = await insert("note_books", { title: "دفتر المحاضرات", chapter: "الفصل الخامس", lang: "ar", file: "l1", pages: 5, created: "1" });
  const ras = await insert("note_books", { title: "الراصد", chapter: "الفصل الخامس", lang: "ar", file: "r1", pages: 5, created: "1", kind: "rasid" });
  const eng = await insert("note_books", { title: "Ch5 EN", chapter: "الفصل الخامس", lang: "en", file: "e1", pages: 5, created: "1" });
  await admin("videoUpload", { file: mp4("الصقر_والأرنب_عربي.mp4") });
  const vids = (await admin("videoUpload", { file: mp4("الصقر_والأرنب_English_عربي.mp4") })).videos;
  const ar = vids.find((v: any) => v.name === "الصقر والأرنب" && v.lang === "ar").id, en = vids.find((v: any) => v.name === "الصقر والأرنب" && v.lang === "en").id;
  let r = await admin("markSave", { book: lec, page: 2, y: 0.3, label: "الصقر", solution: "https://youtu.be/W7hH5Vyt_no", video: ar });
  const L = r.marks[0];
  r = await admin("markSave", { book: ras, page: 4, y: 0.1, label: "الصقر" });
  const R = r.marks[0];
  assert.ok(r.others.some((p: any) => p.id === L.id && p.title === "دفتر المحاضرات"));
  // الربط: زر الراصد الفارغ ياخذ رابط الحل والفيديو من الدفتر
  r = await admin("markSave", { book: ras, id: R.id, page: 4, y: 0.1, label: "الصقر", link: L.id });
  let m = r.marks.find((x: any) => x.id === R.id);
  assert.equal(m.solution, "https://youtu.be/W7hH5Vyt_no");
  assert.equal(m.video, ar);
  assert.deepEqual(m.linked.map((p: any) => p.id), [L.id]);
  // الإنجليزي ينربط: ياخذ الفيديو التوضيحي الإنجليزي بنفس الاسم
  r = await admin("markSave", { book: eng, page: 1, y: 0.2, label: "falcon" });
  const E = r.marks[0];
  r = await admin("markSave", { book: eng, id: E.id, page: 1, y: 0.2, label: "falcon", link: R.id });
  m = r.marks.find((x: any) => x.id === E.id);
  assert.equal(m.video, en);
  assert.equal(m.linked.length, 2);
  // تبديل رابط الحل بالراصد: يتبدل بالدفتر والإنجليزي، والإشعار يگول بكم مكان
  r = await admin("markSave", { book: ras, id: R.id, page: 4, y: 0.1, label: "الصقر", solution: "https://youtu.be/OLs8XMB0gVk", video: ar });
  assert.match(r.notice, /تحدّث وياه 2 زر/);
  assert.equal((await one2("note_marks", { id: L.id }))!.solution, "https://youtu.be/OLs8XMB0gVk");
  assert.equal((await one2("note_marks", { id: E.id }))!.solution, "https://youtu.be/OLs8XMB0gVk");
  // شيل الفيديو التوضيحي من الدفتر: ينشال من الراصد ومن الإنجليزي (نفس السؤال)
  await admin("markSave", { book: lec, id: L.id, page: 2, y: 0.3, label: "الصقر", solution: "https://youtu.be/OLs8XMB0gVk" });
  assert.equal((await one2("note_marks", { id: R.id }))!.video_id, null);
  assert.equal((await one2("note_marks", { id: E.id }))!.video_id, null);
  // لصق الروابط بالدفتر يوصل للمربوطين
  r = await admin("solutionsPaste", { book: lec, text: "ص2 · 0.300 · الصقر · https://youtu.be/yrnZcMgZsUw" });
  assert.match(r.notice, /تحدّث وياهن 2 زر/);
  assert.equal((await one2("note_marks", { id: E.id }))!.solution, "https://youtu.be/yrnZcMgZsUw");
  // فك الربط: الزر يبقى بفيديوه، بس بعد ما يتبدل ويا الباقين
  r = await admin("markSave", { book: eng, id: E.id, page: 1, y: 0.2, label: "falcon", solution: "https://youtu.be/yrnZcMgZsUw", link: 0 });
  assert.equal(r.marks.find((x: any) => x.id === E.id).linked.length, 0);
  await admin("markSave", { book: ras, id: R.id, page: 4, y: 0.1, label: "الصقر", solution: "https://youtu.be/W7hH5Vyt_no" });
  assert.equal((await one2("note_marks", { id: E.id }))!.solution, "https://youtu.be/yrnZcMgZsUw");
  assert.equal((await one2("note_marks", { id: L.id }))!.solution, "https://youtu.be/W7hH5Vyt_no");
  // ما ينربط بزر بنفس الملزمة
  await assert.rejects(admin("markSave", { book: lec, page: 3, y: 0.5, label: "x", link: L.id }), /ملزمة ثانية/);
});

test("📋 ملف الأزرار الجاهز للملازم الإنجليزية: روابط وفيديوهات توضيحية، ونفس فيديو الحل ينربط ويا العربي وحده", async () => {
  const one2 = (await import("../lib/db.ts")).one;
  const ar = await insert("note_books", { title: "دفتر عربي", chapter: "الفصل السابع", lang: "ar", file: "a7", pages: 9, created: "1" });
  const enBook = await insert("note_books", { title: "Ch7 book", chapter: "الفصل السابع", lang: "en", file: "b7", pages: 9, created: "1", section: "book" });
  const wz = await insert("note_books", { title: "Ch7 wz", chapter: "الفصل السابع", lang: "en", file: "w7", pages: 9, created: "1", section: "wz", sol: 1 });
  const vids = (await admin("videoUpload", { file: mp4("البالون_المتصاعد_English_عربي.mp4") })).videos;
  const balloon = vids.find((v: any) => v.name === "البالون المتصاعد" && v.lang === "en").id;
  // العربي: نفس السؤال بمكانين (السؤال وصفحة حله)
  await admin("solutionsPaste", { book: ar, text: `ص2 · 0.300 · المعدلات م2 وزاري س1 · https://youtu.be/Abc123Xyz_0
ص4 · 0.191 · المعدلات م2 وزاري س1 · https://youtu.be/Abc123Xyz_0` });
  // الإنجليزي: رابط الحل والفيديو التوضيحي على نفس الزر، والفيديو اللي ما انرفع ينذكر
  let r = await admin("solutionsPaste", { book: enBook, text: `ص3 · 0.137 · Q1 المعدلات م2 وزاري س1 · https://youtu.be/Abc123Xyz_0
ص3 · 0.140 · Q1 البالون المتصاعد · ▶️ البالون المتصاعد
ص5 · 0.2 · Q2 السلم · ▶️ السلم المنزلق` });
  assert.match(r.notice, /انربط 1 سؤال بفيديو حله، و1 بفيديو توضيحي/);
  assert.match(r.notice, /1 فيديو توضيحي بعده ما انرفع.*السلم المنزلق/);
  assert.equal(r.marks.length, 1);
  assert.deepEqual([r.marks[0].solution, r.marks[0].video, r.marks[0].label], ["https://youtu.be/Abc123Xyz_0", balloon, "Q1 المعدلات م2 وزاري س1"]);
  // وانربط ويا الزرين العربيين
  assert.equal(r.marks[0].linked.length, 2);
  assert.match(r.notice, /انربط 1 زر ويا نفس السؤال/);   // الزرين العربيين انربطوا ببعض من لصق العربي
  // الوزاريات: «🔍 حط الأزرار وحدها» ما يشتغل بيها (كتابة مخفية)، والملف يحط زرها وينربط ويا الكل
  r = await admin("autoMarks", { book: wz });
  assert.match(r.notice, /كل صفحة بيها سؤال/);
  assert.equal(r.marks.length, 0);
  r = await admin("solutionsPaste", { book: wz, text: "ص1 · 0.153 · Q1 المعدلات م2 وزاري س1 · https://youtu.be/Abc123Xyz_0" });
  assert.equal(r.marks[0].linked.length, 3);
  // تبدّل الفيديو بوحدة: يتبدل بالأربعة
  const W = r.marks[0];
  await admin("markSave", { book: wz, id: W.id, page: 1, y: W.y, label: W.label, solution: "https://youtu.be/Abc123Xyz_1" });
  const arMarks = (await admin("marks", { book: ar })).marks;
  assert.deepEqual(arMarks.map((m: any) => m.solution), ["https://youtu.be/Abc123Xyz_1", "https://youtu.be/Abc123Xyz_1"]);
  assert.equal((await one2("note_marks", { id: (await admin("marks", { book: enBook })).marks[0].id }))!.solution, "https://youtu.be/Abc123Xyz_1");
  // نفس الملف مرتين ما يضاعف الأزرار
  r = await admin("solutionsPaste", { book: wz, text: "ص1 · 0.153 · Q1 المعدلات م2 وزاري س1 · https://youtu.be/Abc123Xyz_1" });
  assert.equal(r.marks.length, 1);
});

test("ملف عامل الـ PDF بـ public مطابق لنسخة المكتبة، والصفحات ما تطلبه من داخل المكتبة", async () => {
  const fs = await import("node:fs");
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) assert.ok(fs.readFileSync(`public/${f}`).equals(fs.readFileSync(`node_modules/pdfjs-dist/build/${f}`)), `انسخ node_modules/pdfjs-dist/build/${f} إلى public`);
  const version = JSON.parse(fs.readFileSync("node_modules/pdfjs-dist/package.json", "utf8")).version;
  assert.ok(fs.readFileSync("app/store/pdfClient.ts", "utf8").includes(`const V = "${version}";`), "حدث رقم النسخة بـ app/store/pdfClient.ts");
  // الصفحات ما تطلب المكتبة من الحزمة أبداً
  for (const f of ["app/store/PdfPages.tsx", "app/store/scanup/ScanUpClient.tsx"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /import\("pdfjs-dist"\)/);
  // new URL على ملف من مكتبة خارج الحزمة يفشّل بناء البوت كله
  for (const f of ["app/store/PdfPages.tsx", "app/store/scanup/ScanUpClient.tsx"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /new URL\("pdfjs-dist/);
});

test("questionTag: short name of the question for the video bar under the page", () => {
  assert.equal(questionTag("س1 / خزان على شكل متوازي"), "س1");
  assert.equal(questionTag("س 12 : سلم"), "س12");
  assert.equal(questionTag("Q 3 / A ladder leans"), "Q3");
  assert.equal(questionTag("مثال 2 جد"), "مثال 2");
  assert.equal(questionTag("Example"), "Example");
  assert.equal(questionTag("1) f(x) = (x - 1)"), "");
  assert.equal(questionTag(null), "");
});

test("🔗 وين ما ينلگى فيديو السؤال، ينحط بكل الأزرار المربوطة بيه (بلغة ملزمتها)، وإذا ما إله نسخة بلغتها ينذكر", async () => {
  const one2 = (await import("../lib/db.ts")).one;
  const { syncLinked } = await import("../lib/noteMarks.ts");
  const a = await insert("note_books", { title: "دفتر", chapter: "الفصل الثامن", lang: "ar", file: "s8a", pages: 5, created: "1" });
  const e = await insert("note_books", { title: "Book", chapter: "الفصل الثامن", lang: "en", file: "s8e", pages: 5, created: "1" });
  const w = await insert("note_books", { title: "وزاري", chapter: "الفصل الثامن", lang: "ar", file: "s8w", pages: 5, created: "1" });
  const vids = (await admin("videoUpload", { file: mp4("الكنافة_English_عربي.mp4") })).videos;
  const en = vids.find((v: any) => v.name === "الكنافة" && v.lang === "en").id;
  // الفيديو بالإنگليزي بس، والأزرار مربوطة (نفس السؤال) بس العربي ناقصه
  const E = await insert("note_marks", { book_id: e, page: 2, y: 0.2, label: "kunafa", video_id: en, solution: "https://youtu.be/W7hH5Vyt_no", auto: 0, link: 900 });
  const A = await insert("note_marks", { book_id: a, page: 2, y: 0.2, label: "الكنافة", video_id: null, solution: null, auto: 0, link: 900 });
  const W = await insert("note_marks", { book_id: w, page: 1, y: 0.3, label: "الكنافة وزاري", video_id: null, solution: null, auto: 0, link: 900 });
  let s = await syncLinked();
  assert.equal((await one2("note_marks", { id: A }))!.solution, "https://youtu.be/W7hH5Vyt_no", "فيديو الحل لكل الأزرار");
  assert.equal((await one2("note_marks", { id: W }))!.solution, "https://youtu.be/W7hH5Vyt_no");
  assert.equal((await one2("note_marks", { id: A }))!.video_id, null, "ماكو نسخة عربية بعد");
  assert.ok(s.other.includes("الكنافة"), "ينذكر إنه يحتاج نسخة عربية");
  // يرفع النسخة العربية: تنحط وحدها على الزرين العربيين
  const r = await admin("videoUpload", { file: mp4("الكنافة_عربي.mp4") });
  assert.match(r.notice, /انحط على 2 زر/);
  const ar = r.videos.find((v: any) => v.name === "الكنافة" && v.lang === "ar").id;
  assert.equal((await one2("note_marks", { id: A }))!.video_id, ar);
  assert.equal((await one2("note_marks", { id: W }))!.video_id, ar);
  assert.equal((await one2("note_marks", { id: E }))!.video_id, en);
  s = await syncLinked();
  assert.deepEqual([s.videosAdded, s.solutionsAdded, s.other.includes("الكنافة")], [0, 0, false]);
});
