"use client";
// ✏️ القلم والمساحة على أوراق «مراجعة تصحيح الذكاء» بمكانها (طلبه 2026-11-27): كل الطلاب يبقون قدامه مثل ملف PDF،
// وفوك كل سؤال قلم ومساحة ظاهرين، و«⋯ المزيد» يطلع الألوان والختوم بنفس المكان. ماكو نافذة تنفتح ولا رجوع.
// الكتابة نفسها مال شاشة التصحيح (نفس رقم الصفحة ونفس الشكل)، فتوصل للطالب بنفس صور الورقة المصححة،
// وكلشي بصمت: الطالب ما يوصله شي إلا من «📤 دز للطلاب»
import { useEffect, useMemo, useRef, useState } from "react";
import { pageAuth } from "../adminPage";
import { drawItems, parseInk, type Ink, type Item, type Paper as GPaper, type Prepared } from "../grade/Grader";
import { coverImage, loadImage, pageImage, type HeaderInfo } from "../grade/compose";
import { saveJob, sendJob, type SendJob } from "../grade/reliable";
import { COLORS } from "../grade/pens";

export type InkTool = "pen" | "eraser" | "ok" | "wrong";
export type PenSet = { tool: InkTool | null; color: string; width: number };
/** ترتيب صفحات الورقة مثل شاشة التصحيح، والكتابة المحفوظة على كل صفحة */
export type PaperPages = { whole: string[]; qs: { n: number; answers: string[]; answered: boolean | null }[]; answerOnly: number; ink: Record<string, string> };

const PEN_KEY = "gradePen";
export const QUICK = ["#e53935", "#1e5bd8", "#1f9d55", "#111111", "#fb8c00", "#8e24aa"];
export const PEN_WIDTHS = [2, 5];
const isImg = (f: string) => /\.(jpe?g|png|webp)$/i.test(f);
export function loadPen(): PenSet {
  try { const j = JSON.parse(localStorage.getItem(PEN_KEY) ?? "{}"); return { tool: null, color: /^#[0-9a-f]{6}$/i.test(j.c) && j.c.toLowerCase() !== "#ffffff" ? j.c : "#e53935", width: PEN_WIDTHS.includes(j.w) ? j.w : 2 }; } catch { return { tool: null, color: "#e53935", width: 2 }; }
}
export function keepPen(p: PenSet) { try { localStorage.setItem(PEN_KEY, JSON.stringify({ c: p.color, w: p.width })); } catch { /* */ } }

/** رقم كل صفحة صورة (نفس buildPages بشاشة التصحيح). null: الورقة بيها PDF أو ورقة كاملة، فالقلم هنا ما يشتغل عليها */
export function pageOrder(pg: PaperPages | undefined): (string | null)[] | null {
  if (!pg || pg.whole.length) return null;
  const out: (string | null)[] = [];
  const seen = new Set<string>();
  for (const q of pg.qs) {
    if (q.answers.length) {
      for (const f of q.answers) {
        if (!isImg(f)) return null;
        if (seen.has(f)) continue; // نفس الصورة لأكثر من سؤال: صفحة وحدة
        seen.add(f); out.push(f);
      }
    } else if (!(pg.answerOnly && q.answered === false)) out.push(null);
  }
  return out;
}

async function gradeCall<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: pageAuth(), ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "ماكو اتصال");
  return j as T;
}

/** ورقة طالب وحدة: الكتابة على كل صفحة تنحفظ وحدها، وبعد ما يوگف شوية تتركب صور الورقة المصححة بصمت */
export function usePaperInk(id: number, name: string, pg: PaperPages | undefined, file: (ref: string) => string, onSaved: () => void) {
  const order = useMemo(() => pageOrder(pg), [pg]);
  const index = useMemo(() => new Map((order ?? []).map((f, i) => [f, i] as const).filter(([f]) => f !== null) as [string, number][]), [order]);
  const [inks, setInks] = useState<Record<number, Ink>>(() => Object.fromEntries(Object.entries(pg?.ink ?? {}).map(([k, v]) => [Number(k), parseInk(v)])));
  const inksRef = useRef(inks); inksRef.current = inks;
  const [state, setState] = useState<"" | "saving" | "err">("");
  const [err, setErr] = useState("");
  const opened = useRef<Promise<GPaper> | null>(null);
  const dirty = useRef(new Set<number>());
  const ver = useRef(0);
  const tSave = useRef(0), tCompose = useRef(0);
  const undo = useRef<Record<number, Item[][]>>({});
  // التعديل ينفتح بصمت بأول كتابة (حتى الكتابة تنحفظ)، مرة وحدة للورقة
  const open = () => (opened.current ??= gradeCall<{ paper: GPaper }>({ action: "openEdit", id, quiet: true }).then((j) => j.paper).catch((e) => { opened.current = null; throw e; }));
  const fail = (e: unknown) => { setState("err"); setErr((e as Error).message || "ما انحفظ"); };
  async function flush() {
    const list = [...dirty.current]; dirty.current.clear();
    if (!list.length) return;
    await open();
    for (const i of list) await gradeCall({ action: "ink", id, page: i, ink: JSON.stringify(inksRef.current[i] ?? { rot: 0, items: [] }) });
  }
  async function compose() {
    const v = ver.current;
    try {
      await flush();
      const paper = await open();
      const prep = await gradeCall<Prepared>({ action: "prepare", id });
      const photos = await composePhotos(paper, order ?? [], inksRef.current, prep, file);
      const job: SendJob = { key: `${id}`, id, name, action: "finish", comment: prep.sent, photos, at: Date.now() };
      await saveJob(job);
      const r = await sendJob(job, pageAuth);
      if (!r.ok) throw new Error(r.error ?? "");
      if (v === ver.current) { setState(""); setErr(""); onSaved(); }
    } catch (e) { fail(e); }
  }
  function change(i: number, next: Ink, keepUndo = true) {
    if (keepUndo) (undo.current[i] ??= []).push((inksRef.current[i] ?? { rot: 0, items: [] }).items);
    inksRef.current = { ...inksRef.current, [i]: next };
    setInks(inksRef.current);
    dirty.current.add(i); ver.current++;
    setState("saving"); setErr("");
    window.clearTimeout(tSave.current); tSave.current = window.setTimeout(() => { void flush().catch(fail); }, 600);
    // صور الورقة تتركب بعد ما يوگف 4 ثواني (مو بكل خط)
    window.clearTimeout(tCompose.current); tCompose.current = window.setTimeout(() => void compose(), 4000);
  }
  function back(i: number) {
    const u = undo.current[i];
    if (!u?.length) return;
    change(i, { ...(inksRef.current[i] ?? { rot: 0, items: [] }), items: u.pop()! }, false);
  }
  useEffect(() => () => { window.clearTimeout(tSave.current); }, []);
  return { order, index, inks, change, back, canBack: (i: number) => !!undo.current[i]?.length, state, err, retry: () => void compose() };
}

/** صور الورقة المصححة مثل شاشة التصحيح: الغلاف، وكل صفحة بكتابتها */
async function composePhotos(paper: GPaper, order: (string | null)[], inks: Record<number, Ink>, prep: Prepared, file: (ref: string) => string): Promise<Blob[]> {
  try { await Promise.all(["600", "700", "800", "900"].map((w) => document.fonts.load(`${w} 40px Cairo`, "اب Ab گ 1"))); await document.fonts.load("40px QAppAr", "اب"); await document.fonts.load("40px QAppEn", "Ab 1"); await document.fonts.ready; } catch { /* بدون خطوط */ }
  const info: HeaderInfo = { slug: paper.slug, chapter: paper.chapter, title: paper.title, info: paper.info, model: paper.model, name: paper.name, total: prep.total, lang: paper.lang, sid: paper.sid };
  const logo = await loadImage("/logo.png");
  const out = [await coverImage(info, prep.comment, prep.sticker ? await loadImage(`/api/sticker?id=${prep.sticker}`) : null, logo)];
  const imgs = new Map<number, HTMLImageElement>();
  for (const ink of Object.values(inks)) for (const it of ink.items) if (it.t === "i" && !imgs.has(it.id)) { const im = await loadImage(`/api/sticker?id=${it.id}`); if (im) imgs.set(it.id, im); }
  for (const [i, f] of order.entries()) {
    if (!f) continue;
    const im = await loadImage(file(f));
    if (!im) continue;
    const ink = inks[i] ?? { rot: 0, items: [] };
    out.push(await pageImage(info, im, ink.rot, (ctx, w, h) => drawItems(ctx, ink.items, w, h, null, imgs, false), logo));
  }
  return out;
}

// القلم (Apple Pencil) يكتب دائماً وهو مختار، والإصبع ينزل ويصعد بالصفحة. الجهاز اللي ما بيه قلم: الإصبع يكتب من يختار القلم
let penSeen = false;

/** طبقة الكتابة فوك صفحة وحدة */
export function InkLayer({ ink: given, pen, onChange: report, rotated }: { ink: Ink; pen: PenSet; onChange: (next: Ink) => void; rotated: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  // آخر كتابة (حتى المساحة وهي تمشي ما ترجع شي انمسح قبل ما الصفحة تتحدث)
  const cur = useRef(given); cur.current = given;
  const ink = cur.current;
  const onChange = (next: Ink) => { cur.current = next; report(next); };
  const live = useRef<Item | null>(null);
  const drawing = useRef<number | null>(null);
  const [, bump] = useState(0);
  const paint = () => {
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d"); if (!ctx) return;
    drawItems(ctx, cur.current.items, w, h, live.current);
  };
  useEffect(() => {
    paint();
    const c = cv.current; if (!c) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(c);
    return () => ro.disconnect();
  });
  const on = !!pen.tool && !rotated;
  const at = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as const; };
  // المساحة تشيل الخط إذا مرت على أي مكان بيه (مو بس نقاطه): المسافة لكل قطعة من الخط
  const erase = (x: number, y: number, items: Item[]) => {
    const R = 0.03;
    const seg = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      return Math.hypot(ax + t * dx - x, ay + t * dy - y) < R;
    };
    const hit = (p: number[]) => (p.length === 2 ? seg(p[0], p[1], p[0], p[1]) : p.some((_, i) => i % 2 === 0 && i + 3 < p.length && seg(p[i], p[i + 1], p[i + 2], p[i + 3])));
    return items.filter((it) => (it.t === "s" ? !hit(it.p) : Math.hypot(it.x - x, it.y - y) >= R));
  };
  const down = (e: React.PointerEvent) => {
    if (!on) return;
    if (e.pointerType === "pen") { if (!penSeen) { penSeen = true; bump((n) => n + 1); } }
    else if (e.pointerType === "touch" && penSeen) return; // إصبع بجهاز بيه قلم: يمرر الصفحة
    e.preventDefault();
    const [x, y] = at(e);
    if (pen.tool === "ok" || pen.tool === "wrong") { onChange({ ...cur.current, items: [...cur.current.items, { t: pen.tool === "ok" ? "k" : "w", x, y }] }); return; }
    cv.current?.setPointerCapture(e.pointerId);
    drawing.current = e.pointerId;
    if (pen.tool === "eraser") { const items = erase(x, y, cur.current.items); if (items.length !== cur.current.items.length) onChange({ ...cur.current, items }); return; }
    live.current = { t: "s", c: pen.color, w: pen.width, p: [+x.toFixed(4), +y.toFixed(4)] };
    paint();
  };
  const move = (e: React.PointerEvent) => {
    if (drawing.current !== e.pointerId) return;
    const [x, y] = at(e);
    if (pen.tool === "eraser") { const items = erase(x, y, cur.current.items); if (items.length !== cur.current.items.length) onChange({ ...cur.current, items }); return; }
    const s = live.current; if (!s || s.t !== "s") return;
    s.p.push(+x.toFixed(4), +y.toFixed(4));
    paint();
  };
  const up = (e: React.PointerEvent) => {
    if (drawing.current !== e.pointerId) return;
    drawing.current = null;
    const s = live.current; live.current = null;
    if (s) onChange({ ...cur.current, items: [...cur.current.items, s] });
  };
  return <canvas ref={cv} className={"arv-ink" + (on ? " on" : "")} style={{ pointerEvents: on ? "auto" : "none", touchAction: on && !penSeen ? "none" : "pan-y" }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />;
}

/** فوك كل سؤال: قلم ومساحة ظاهرين، و«⋯ المزيد» يطلع الباقي بنفس المكان */
export function InkBar({ pen, setPen, more, setMore, canBack, onBack, extra }: { pen: PenSet; setPen: (p: PenSet) => void; more: boolean; setMore: (v: boolean) => void; canBack: boolean; onBack: () => void; extra: React.ReactNode }) {
  const pick = (t: InkTool) => setPen({ ...pen, tool: pen.tool === t ? null : t });
  return (
    <>
      <div className="arv-inkbar">
        <button type="button" className={pen.tool === "pen" ? "on" : ""} onClick={() => pick("pen")}><span className="arv-dot" style={{ background: pen.color }} />✏️ قلم</button>
        <button type="button" className={pen.tool === "eraser" ? "on" : ""} onClick={() => pick("eraser")}>🧽 مساحة</button>
        <button type="button" disabled={!canBack} onClick={onBack} aria-label="تراجع">↶</button>
        <button type="button" className={more ? "on" : ""} onClick={() => setMore(!more)}>⋯ المزيد</button>
      </div>
      {more && <div className="arv-more">
        <div className="arv-colors">{[...QUICK, ...COLORS.filter((c) => !QUICK.includes(c) && c !== "#ffffff")].map((c) => <button type="button" key={c} aria-label="لون" className={pen.color === c ? "on" : ""} style={{ background: c }} onClick={() => { const p = { ...pen, color: c, tool: pen.tool === "eraser" || !pen.tool ? "pen" as const : pen.tool }; setPen(p); keepPen(p); }} />)}</div>
        <div className="arv-inkbar">
          {PEN_WIDTHS.map((w) => <button type="button" key={w} className={pen.width === w ? "on" : ""} onClick={() => { const p = { ...pen, width: w }; setPen(p); keepPen(p); }}>{w === 2 ? "خط رفيع" : "خط عريض"}</button>)}
          <button type="button" className={pen.tool === "ok" ? "on" : ""} onClick={() => pick("ok")}>✅ ختم صح</button>
          <button type="button" className={pen.tool === "wrong" ? "on" : ""} onClick={() => pick("wrong")}>❌ ختم غلط</button>
        </div>
        {extra}
      </div>}
    </>
  );
}
