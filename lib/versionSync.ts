// لما صاحب البوت يبدّل صفحات نسخة الطالب أو الجواب النموذجي من صفحة الامتحانات، باقي النسخ اللي بالبوت تتبعها:
// ملف الطباعة PDF ينسوى من الصفحات الجديدة، وصورة كل سؤال تنقص من الصفحة إذا البوت متأكد من مكانه،
// وصور الحل القديمة تنشال وخطوات التصحيح تنعاد من الجواب الجديد (القديمة تبقى شغالة لحد ما تنحفظ الجديدة)
import { randomUUID } from "node:crypto";
import { find, one, update } from "./db.ts";
import { files } from "./files.ts";
import { queueRedraft, rubricOf } from "./aiGrade.ts";

type Img = { w: number; h: number; data: Uint8ClampedArray };
async function decode(b: Buffer): Promise<{ img: Img; im: any } | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const im = await loadImage(b);
    const c = createCanvas(im.width, im.height);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, im.width, im.height);
    g.drawImage(im, 0, 0);
    return { img: { w: im.width, h: im.height, data: g.getImageData(0, 0, im.width, im.height).data }, im: c };
  } catch { return null; }
}

/** PDF بحجم A4، كل صورة بصفحة وبنصها. يرجع null إذا وحدة من الصور ما انقرت */
export async function imagesPdf(imgs: Buffer[]): Promise<Buffer | null> {
  const pages: { w: number; h: number; jpg: Buffer }[] = [];
  for (const b of imgs) {
    const d = await decode(b);
    if (!d) return null;
    pages.push({ w: d.img.w, h: d.img.h, jpg: Buffer.from(await d.im.encode("jpeg", 90)) });
  }
  if (!pages.length) return null;
  const parts: Buffer[] = [];
  const offs: number[] = [];
  let len = 0;
  const push = (x: Buffer | string) => { const b = typeof x === "string" ? Buffer.from(x, "latin1") : x; parts.push(b); len += b.length; };
  const obj = (n: number, body: (Buffer | string)[]) => { offs[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  const W = 595.28, H = 841.89;
  for (const [i, p] of pages.entries()) {
    const s = Math.min(W / p.w, H / p.h), w = p.w * s, h = p.h * s;
    const cs = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((W - w) / 2).toFixed(2)} ${((H - h) / 2).toFixed(2)} cm /Im0 Do Q`;
    obj(3 + 3 * i, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`]);
    obj(4 + 3 * i, [`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`]);
    obj(5 + 3 * i, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`, p.jpg, "\nendstream"]);
  }
  const total = 3 + 3 * pages.length, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) push(`${String(offs[k]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/**
 * يقص أسئلة الصفحة: يشيل شريط الهدر الغامق والتذييل، ويقسم الباقي لقطع كتابة، والسؤال يبدي بقطعة بيها رقم ملوّن
 * (مثل «س 1 /») يم الحافة اليمنى. يرجع null إذا عدد الأسئلة اللي لگاها مو نفس عدد أسئلة النسخة: ساعتها ما يغيّر شي
 */
export async function cropQuestions(page: Buffer, n: number): Promise<Buffer[] | null> {
  const d = await decode(page);
  if (!d || n < 1) return null;
  const { w: W, h: H, data } = d.img;
  const x0 = Math.floor(W * 0.06), x1 = Math.floor(W * 0.94), lx0 = Math.floor(W * 0.78), lx1 = Math.floor(W * 0.96);
  const samples = Math.ceil((x1 - x0) / 2);
  const ink: number[] = [], colored: number[] = [];
  for (let y = 0; y < H; y++) {
    let k = 0, c = 0;
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) k++;
    }
    for (let x = lx0; x < lx1; x += 2) {
      const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 60 && Math.min(r, g, b) < 200) c++;
    }
    ink.push(k); colored.push(c);
  }
  // شريط الهدر أو التذييل يملي العرض كله تقريباً، وسطر الكتابة أبد ما يوصل لهالحد
  const band = (y: number) => ink[y] > samples * 0.85;
  let top = 0, bottom = Math.floor(H * 0.95);
  for (let y = 0; y < H * 0.3; y++) if (band(y)) top = y + 1;
  for (let y = Math.floor(H * 0.8); y < bottom; y++) if (band(y)) { bottom = y; break; }
  const gap = Math.max(4, Math.round(W * 0.011)), minH = Math.max(3, Math.round(W * 0.005));
  const blocks: { a: number; b: number; label: boolean }[] = [];
  let start = -1, last = -1;
  for (let y = top; y < bottom; y++) {
    if (ink[y] < 2) continue;
    if (start >= 0 && y - last > gap) { blocks.push({ a: start, b: last, label: false }); start = -1; }
    if (start < 0) start = y;
    last = y;
  }
  if (start >= 0) blocks.push({ a: start, b: last, label: false });
  const kept = blocks.filter((k) => k.b - k.a >= minH);
  for (const k of kept) { let c = 0; for (let y = k.a; y <= k.b; y++) c += colored[y]; k.label = c >= 6; }
  const starts = kept.map((k, i) => (k.label ? i : -1)).filter((i) => i >= 0);
  if (starts.length !== n) return null;
  const { createCanvas } = await import("@napi-rs/canvas");
  const pad = Math.round(W * 0.018), cx0 = Math.round(W * 0.047), cx1 = Math.round(W * 0.953);
  const out: Buffer[] = [];
  for (const [j, s] of starts.entries()) {
    const end = j + 1 < starts.length ? starts[j + 1] - 1 : kept.length - 1;
    const ya = Math.max(top, kept[s].a - pad), yb = Math.min(bottom, kept[end].b + pad);
    const c = createCanvas(cx1 - cx0, yb - ya);
    c.getContext("2d").drawImage(d.im, cx0, ya, cx1 - cx0, yb - ya, 0, 0, cx1 - cx0, yb - ya);
    out.push(Buffer.from(await c.encode("png")));
  }
  return out;
}

async function store(body: Buffer, ext: "png" | "pdf") {
  const ref = `uploads/${randomUUID()}.${ext}`;
  await files().write(ref, body, ext === "png" ? "image/png" : "application/pdf");
  return ref;
}

/** صفحات نسخة الطالب تبدلت: يرجع رسالة لصاحب البوت بشنو تحدّث وشنو لازم يسويه بإيده */
export async function syncPages(versionId: number, lang: "ar" | "en", refs: string[]): Promise<string> {
  const imgs = (await Promise.all(refs.map((r) => files().read(r)))).filter((b): b is Buffer => !!b);
  const said: string[] = [];
  const pdf = imgs.length === refs.length ? await imagesPdf(imgs) : null;
  if (pdf) { await update("bank_versions", { id: versionId }, { [`pdf_${lang}`]: await store(pdf, "pdf") }); said.push("ملف الطباعة 📄 صار مثل الصفحات الجديدة"); }
  else said.push("⚠️ ما گدرت أسوي ملف الطباعة من هاي الصور، فبقى القديم");
  if (lang === "en") return `✅ ${said.join("، ")}. صور الأسئلة بالبوت عربي، فما تتغير ويا الصفحة الإنجليزية.`;
  const qs = await find("bank_questions", { version_id: versionId }, { order: ["n"] });
  const crops = imgs.length === 1 && qs.length ? await cropQuestions(imgs[0], qs.length) : null;
  if (crops) {
    for (const [i, q] of qs.entries()) await update("bank_questions", { id: q.id }, { q_file: await store(crops[i], "png"), q_text: null, edited: 1 });
    said.push(`صور الأسئلة (${qs.length}) انقصّت من الصفحة الجديدة`);
    return `✅ ${said.join("، ")}. تأكد منها بفتح كل سؤال.`;
  }
  return `✅ ${said.join("، ")}.\n⚠️ صور الأسئلة ما تحدثت: ${imgs.length > 1 ? "الصفحات أكثر من وحدة" : "ما گدرت أحدد مكان كل سؤال بالصفحة بالضبط"}. إذا تغيّر سؤال، بدّل صورته بإيدك من «🖼 صورة جديدة» يمه.`;
}

/** الجواب النموذجي تبدل: صور الحل القديمة لكل سؤال تنشال (الجواب الجديد يصير المرجع)، وخطوات التصحيح تنعاد منه */
export async function syncAnswer(versionId: number): Promise<string> {
  const qs = await find("bank_questions", { version_id: versionId }, { order: ["n"] });
  let images = 0;
  const redo: number[] = [];
  for (const q of qs) {
    if (JSON.parse(q.a_files || "[]").length) { await update("bank_questions", { id: q.id }, { a_files: "[]" }); images++; }
    if (await rubricOf(q.id)) redo.push(q.id);
  }
  if (redo.length) await queueRedraft(redo);
  const v = await one("bank_versions", { id: versionId });
  const parts = [`✅ الجواب النموذجي للنسخة ${v?.model ?? ""} تبدل`];
  if (images) parts.push(`صور الحل القديمة لـ ${images} سؤال انشالت، والجواب الجديد صار هو المرجع`);
  if (redo.length) parts.push(`خطوات التصحيح AI لـ ${redo.length} سؤال راح تنطلع من جديد من الجواب الجديد خلال دقائق، والقديمة تبقى شغالة لحد ما تنحفظ الجديدة`);
  return parts.join("\n• ");
}
