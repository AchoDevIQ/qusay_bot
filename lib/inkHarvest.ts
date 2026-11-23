// «🖋 خطي من أوراقي» (طلب الأستاذ 2026-11-23): الأوراق اللي يصححها الأستاذ بإيده بالقلم، كل علامة كتبها (✓ ✗ ؟ والملاحظات)
// تنقرا وتنضاف وحدها لـ «✍️ خط إيدي» مال موضوعها، فمكتبة خطه تكبر وهو يصحح. ودرجاته وملاحظاته بكل سؤال تصير أمثلة
// يشوفها «تصحيح قصي» بهذا الموضوع («هيچ صحح الأستاذ بنفسه»). ورقة وحدة تنقرا بطلب صغير وحد (Haiku)
import type Anthropic from "@anthropic-ai/sdk";
import { createCanvas } from "@napi-rs/canvas";
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { ADMIN_IDS } from "./config.ts";
import { addSpend } from "./aiSpend.ts";

const Q = "qg_harvest_q";
const doneKey = (id: number) => `qg_harvested_${id}`;
const exKey = (exam: number) => `qg_examples_${exam}`;
const EX_MAX = 15, PER_PAPER = 36;
// الصفحة مقاسها نسبة (0 لـ 1) بالعرض والطول؛ الورقة تقريباً A4 بالطول
const PW = 1000, PH = 1350;
type Stroke = { t: "s"; c: string; w: number; p: number[] };
type Box = { x0: number; y0: number; x1: number; y1: number; strokes: Stroke[]; page: number };
export type QgExample = { item: number; at: string; qs: { n: number; mark: number | null; max: number; notes: string[] }[] };

const readJson = async <T>(k: string, def: T): Promise<T> => { try { return (JSON.parse((await kvGet(k)) ?? "null") as T) ?? def; } catch { return def; } };
const queue = async () => { const l = await readJson<number[]>(Q, []); return Array.isArray(l) ? l.map(Number) : []; };
export const examplesOf = async (exam: number) => { const l = await readJson<QgExample[]>(exKey(exam), []); return Array.isArray(l) ? l : []; };

/** ورقة صححها الأستاذ (صاحب البوت) بإيده: تدخل الطابور. كل ورقة مرة وحدة */
export async function queueHarvest(itemId: number) {
  const it = await one("sched_items", { id: itemId });
  if (!it?.graded_at || !ADMIN_IDS.includes(Number(it.grader_id)) || await kvGet(doneKey(itemId))) return false;
  const q = await queue();
  if (!q.includes(itemId)) await kvSet(Q, JSON.stringify([...q, itemId]));
  return true;
}
/** «🖋 خذ خطي من أوراقي»: كل الأوراق اللي صححها بإيده بهذا الموضوع وبعدها ما انقرت */
export async function queueExam(exam: number) {
  let n = 0;
  for (const it of await find("sched_items", { exam_id: exam, status: "done" })) {
    if (!(await find("paper_ink", { item_id: it.id })).length) continue;
    if (await queueHarvest(it.id)) n++;
  }
  return n;
}
export const harvestWaiting = async () => (await queue()).length;

/** الخطوط القريبة من بعض تصير علامة وحدة (كلمة، ✓، ملاحظة) */
function clusters(strokes: Stroke[], page: number): Box[] {
  const boxes: Box[] = strokes.filter((s) => s.p.length >= 4).map((s) => {
    const xs = s.p.filter((_, i) => i % 2 === 0), ys = s.p.filter((_, i) => i % 2 === 1);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), strokes: [s], page };
  });
  const near = (a: Box, b: Box) => a.x0 - 0.035 <= b.x1 && b.x0 - 0.035 <= a.x1 && a.y0 - 0.02 <= b.y1 && b.y0 - 0.02 <= a.y1;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (!near(boxes[i], boxes[j])) continue;
      const a = boxes[i], b = boxes[j];
      boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), strokes: [...a.strokes, ...b.strokes], page };
      boxes.splice(j, 1);
      merged = true;
      break;
    }
  }
  // نقطة صغيرة لو خط واحد قصير ما يعتبر علامة
  return boxes.filter((b) => (b.x1 - b.x0) * PW + (b.y1 - b.y0) * PH > 18);
}
/** العلامة بمربع لحالها: النقاط بمقاس المربع (مثل ما يكتب بـ «✍️ خط إيدي») */
function shapeOf(b: Box) {
  const bw = Math.max(0.004, b.x1 - b.x0) * PW, bh = Math.max(0.004, b.y1 - b.y0) * PH;
  const k = Math.min(400 / bw, 300 / bh, 6), pad = 20;
  const w = Math.round(Math.max(100, Math.min(1500, bw * k + 2 * pad))), h = Math.round(Math.max(100, Math.min(1500, bh * k + 2 * pad)));
  const s = b.strokes.map((st) => {
    const a: number[] = [];
    for (let i = 0; i + 1 < st.p.length; i += 2) a.push(Math.round((st.p[i] - b.x0) * PW * k + pad), Math.round((st.p[i + 1] - b.y0) * PH * k + pad));
    return a;
  });
  return { w, h, s, c: b.strokes[0]?.c };
}
function png(sh: { w: number; h: number; s: number[][] }) {
  const cv = createCanvas(sh.w, sh.h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sh.w, sh.h);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const st of sh.s) { ctx.beginPath(); for (let i = 0; i + 1 < st.length; i += 2) (i ? ctx.lineTo(st[i], st[i + 1]) : ctx.moveTo(st[i], st[i + 1])); ctx.stroke(); }
  return cv.toBuffer("image/png").toString("base64");
}

const PAGE_READ = `This is one page of a math teacher's pen marking on a student's paper (Iraqi 6th grade, Arabic): only his pen strokes are drawn, the student's writing is not shown.
Find every separate mark he made and give its kind, its text, and its box (x0, y0, x1, y1) on a 0–1000 scale of the page width (x, left to right) and height (y, top to bottom). Boxes must not include a neighbouring mark.
- "tick": a check mark ✓ (any style)
- "cross": a cross or a loop-cross mark for wrong (often like an α / ∝ loop)
- "ask": a question mark ؟
- "praise": a praise word (ممتاز، أحسنت، عاشت إيدك...)
- "note": a written note to the student (Arabic words, maybe with math): one note = one sentence or one idea; write its text exactly as written, math in phone style (x², 3/x²)
- "other": a number, a score, a short dash, an underline, an arrow, a circle around something, a scribble, or anything unreadable
Return {"items":[{"kind":...,"text":...,"box":[x0,y0,x1,y1]}]}.`;
const PAGE_SCHEMA = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["tick", "cross", "ask", "praise", "note", "other"] }, text: { type: "string" }, box: { type: "array", items: { type: "number" } } }, required: ["kind", "text", "box"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };
const area = (b: number[] = []) => Math.abs((Number(b[2]) - Number(b[0])) * (Number(b[3]) - Number(b[1]))) || 1e9;
const priceOf = (m: string, u: Anthropic.Usage) => { const p = m.includes("opus") ? [4, 20] : m.includes("sonnet") ? [2, 10] : [0.1, 0.5]; return (((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) * p[0] + (u.output_tokens ?? 0) * p[1]) / 1_000_000; };
/** الصفحة كاملة بخطوطه بس (أسود على أبيض) */
function pagePng(b: Box) {
  const W = 800, H = 1080;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const st of b.strokes) { ctx.beginPath(); for (let i = 0; i + 1 < st.p.length; i += 2) (i ? ctx.lineTo(st.p[i] * W, st.p[i + 1] * H) : ctx.moveTo(st.p[i] * W, st.p[i + 1] * H)); ctx.stroke(); }
  return cv.toBuffer("image/png").toString("base64");
}
const READ = `These are small pieces of a math teacher's red-pen marking on a student's paper (Iraqi 6th grade, Arabic), each cut out and numbered.
For each piece say what it is:
- "tick": a check mark ✓ (any style)
- "cross": a cross / X mark for wrong
- "ask": a question mark ؟
- "praise": a praise word (ممتاز، أحسنت، عاشت إيدك...)
- "note": a short written note to the student (Arabic words, maybe with math) — write its text exactly as written, math in phone style (x², 3/x²)
- "other": a number, a score, a line, an arrow, a circle, a scribble, or anything unreadable
Return {"items":[{"k":piece number,"kind":...,"text":...}]} for every piece.`;
const SCHEMA = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { k: { type: "integer" }, kind: { type: "string", enum: ["tick", "cross", "ask", "praise", "note", "other"] }, text: { type: "string" } }, required: ["k", "kind", "text"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };

/** صفحات الورقة بنفس ترتيب صفحة التصحيح (الحالة البسيطة: صور لكل سؤال)، حتى نعرف كل صفحة لأي سؤال */
async function pageQuestions(it: Row): Promise<(number | null)[]> {
  const answers = await find("exam_answers", { item_id: it.id }, { order: ["q", "id"] });
  if (answers.some((a) => !a.q)) return [];
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const out: (number | null)[] = [];
  for (const q of qs) { const mine = answers.filter((a) => Number(a.q) === Number(q.n)); if (mine.length) mine.forEach(() => out.push(Number(q.n))); else out.push(Number(q.n)); }
  return out;
}

type Create = (req: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
/** ورقة وحدة: يقرا علاماته، يضيفها لخط إيده بموضوعها، ويحفظ درجاته وملاحظاته مثال */
export async function harvestPaper(itemId: number, create: Create, model: string) {
  const it = await one("sched_items", { id: itemId });
  if (!it) return { added: 0 };
  const exam = Number(it.exam_id);
  const pages = await find("paper_ink", { item_id: itemId });
  // الصفحة كاملة تنرسم وتنبعث، والذكاء يحدد كل علامة بمربعها (✗ يم ملاحظة كانت تنلزگ بيها لما چنا نجمع الخطوط القريبة)
  const pick: Box[] = [];
  const items: { k: number; kind: string; text: string }[] = [];
  let usd = 0;
  for (const r of pages) {
    let j: { items?: unknown[] } = {};
    try { j = JSON.parse(String(r.ink ?? "{}")); } catch { continue; }
    const strokes = ((j.items ?? []) as Stroke[]).filter((x) => x?.t === "s" && Array.isArray(x.p) && x.p.length >= 4);
    if (!strokes.length) continue;
    const page = Number(r.page);
    const all: Box = { x0: 0, y0: 0, x1: 1, y1: 1, strokes, page };
    const img = pagePng(all);
    const m = await create({ model, max_tokens: 6000, output_config: { effort: "low", format: { type: "json_schema", schema: PAGE_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: img } }, { type: "text", text: PAGE_READ }] }] } as Anthropic.MessageCreateParamsNonStreaming);
    const u = m.usage;
    usd += priceOf(m.model, u);
    let got: { kind: string; text: string; box: number[] }[] = [];
    try { got = JSON.parse(m.content.map((b) => (b.type === "text" ? b.text : "")).join("")).items ?? []; } catch { got = []; }
    // كل خط ينحسب للمربع اللي بيه نصه، وإذا مربعين يغطوه، للأصغر
    const taken = new Set<Stroke>();
    for (const g of got.sort((a, b) => area(a.box) - area(b.box))) {
      const [bx0, by0, bx1, by1] = (g.box ?? []).map((v) => Number(v) / 1000);
      if (![bx0, by0, bx1, by1].every(Number.isFinite)) continue;
      const pad = 0.015;
      const mine = strokes.filter((st) => {
        if (taken.has(st)) return false;
        const xs = st.p.filter((_, i) => i % 2 === 0), ys = st.p.filter((_, i) => i % 2 === 1);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        return cx >= bx0 - pad && cx <= bx1 + pad && cy >= by0 - pad && cy <= by1 + pad;
      });
      if (!mine.length || pick.length >= PER_PAPER) continue;
      mine.forEach((st) => taken.add(st));
      const xs = mine.flatMap((st) => st.p.filter((_, i) => i % 2 === 0)), ys = mine.flatMap((st) => st.p.filter((_, i) => i % 2 === 1));
      pick.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), strokes: mine, page });
      items.push({ k: pick.length, kind: g.kind, text: g.text });
    }
  }
  if (usd) await addSpend("pen", usd);
  const shapes = pick.map(shapeOf);
  // خط إيده بموضوعه: ✓ ✗ ؟ لحد 8 من كل وحدة، والملاحظة مرة وحدة لكل نص. المدح ما ينكتب على الورقة، فما ينضاف
  const { addInk, inkList, INK_MAX } = await import("./qusayGrade.ts");
  let added = 0;
  const notesByPage = new Map<number, string[]>();
  for (const x of items) {
    const b = pick[x.k - 1], sh = shapes[x.k - 1];
    if (!b || !sh) continue;
    const text = String(x.text ?? "").replace(/\s+/g, " ").trim();
    if (x.kind === "note" && text) notesByPage.set(b.page, [...(notesByPage.get(b.page) ?? []), text]);
    if (!["tick", "cross", "ask", "note"].includes(x.kind) || (x.kind === "note" && !text)) continue;
    const list = await inkList(exam);
    if (list.length >= INK_MAX) break;
    if (x.kind === "note" ? list.some((l) => l.kind === "note" && l.text === text.slice(0, 60)) : list.filter((l) => l.kind === x.kind).length >= 8) continue;
    try { await addInk(exam, { kind: x.kind, text, ...sh }); added++; } catch { /* علامة ما تنفع (كبيرة لو فارغة) */ }
  }
  // درجاته وملاحظاته بكل سؤال: مثال لتصحيح قصي
  const pq = await pageQuestions(it);
  const marks = new Map((await find("question_marks", { item_id: itemId })).map((m) => [Number(m.q), Number(m.mark)]));
  const qs = await find("bank_questions", { version_id: it.version_id }, { order: ["n"] });
  const ex: QgExample = {
    item: itemId, at: String(it.graded_at ?? ""),
    qs: qs.map((q) => ({ n: Number(q.n), mark: marks.has(Number(q.n)) ? marks.get(Number(q.n))! : null, max: Number(q.max_mark), notes: [...notesByPage.entries()].filter(([p]) => pq[p] === Number(q.n)).flatMap(([, l]) => l) })),
  };
  const all = (await examplesOf(exam)).filter((e) => e.item !== itemId);
  await kvSet(exKey(exam), JSON.stringify([...all, ex].slice(-EX_MAX)));
  await kvSet(doneKey(itemId), "1");
  return { added, read: items.length };
}
/** دكة: ورقتين بكل دقيقة */
export async function harvestTick(create: Create, model: string) {
  const ids = (await queue()).slice(0, 2);
  let n = 0;
  for (const id of ids) {
    try { await harvestPaper(id, create, model); n++; } catch (e) { console.error("ink harvest", id, e); }
    await kvSet(Q, JSON.stringify((await queue()).filter((x) => x !== id)));
  }
  return n;
}
/** للتصحيح: «هيچ صحح الأستاذ بنفسه» أوراق هذا الموضوع */
export function examplesText(list: QgExample[]) {
  if (!list.length) return "";
  return `

HOW QUSAY HIMSELF GRADED PAPERS OF THIS TOPIC (his own marks per question and the notes he wrote by hand; follow the same strictness and use his wording when the same situation comes up):
${list.map((e, i) => `Paper ${i + 1}: ${e.qs.map((q) => `Q${q.n} ${q.mark ?? "—"}/${q.max}${q.notes.length ? ` (he wrote: ${q.notes.map((x) => `«${x}»`).join(" ")})` : ""}`).join("; ")}`).join("\n")}`;
}
