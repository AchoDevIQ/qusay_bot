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
const { noteAction, noteAdmin } = await import("../lib/notes.ts");
const { parseLink, videoName } = await import("../lib/noteMarks.ts");
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
  const act = (action: string, x: object = {}) => noteAction({ token: homeToken(20), device: "dev-00000000000020", pf: "android", action, book, ...x });
  const seen = (await act("marks")).marks;
  assert.deepEqual(seen.map((m: any) => [m.video, m.solution]), [[true, false]]);
  assert.ok(!JSON.stringify(seen).includes("t.me"));
  await assert.rejects(act("play", { mark: seen[0].id, kind: "solution" }), /بعده ما انضاف/);
  // رابط الحل: الغلط ينرفض، والصح ينحفظ ويبقى بعد إعادة التدوير
  const q1 = r.marks.find((m: any) => m.label.startsWith("Q 1"));
  await assert.rejects(admin("markSave", { book, id: q1.id, page: 1, y: q1.y, solution: "https://youtube.com/x" }), /رابط الحل/);
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
