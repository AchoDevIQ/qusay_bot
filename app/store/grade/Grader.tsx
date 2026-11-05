"use client";
// شاشة تصحيح الورقة مثل النظام القديم: كل سؤال صفحة، القلم والممحاة والكتابة وختم الصح فوك جواب الطالب،
// والدرجات بصف فوك. الرسم ينحفظ وحده لكل صفحة
import { useCallback, useEffect, useRef, useState } from "react";
import { pageAuth } from "../adminPage";
import PdfPages, { pdfByQuestion, pdfToImages } from "../PdfPages";

export type Q = { n: number; max: number; image: string; answers: string[]; mark: number | null };
export type Paper = { id: number; name: string; title: string; chapter: string; model: string; test: boolean; graded: string; total: number | null; answerPdf: string | null; whole: string[]; questions: Q[]; ink: Record<number, string> };
type Item = { t: "s"; c: string; w: number; p: number[] } | { t: "x"; c: string; x: number; y: number; s: string; z: number } | { t: "k"; x: number; y: number } | { t: "i"; id: number; x: number; y: number; w: number };
export type Sticker = { id: number; name: string; lo: number; hi: number };
type Ink = { rot: number; items: Item[] };
type Page = { src: string | null; q: number | null };
type Tool = "hand" | "pen" | "eraser" | "text" | "stamp" | "sticker";

const COLORS = ["#111111", "#555555", "#9e9e9e", "#ffffff", "#e53935", "#c62828", "#ff5252", "#ff7043", "#fb8c00", "#ffb300", "#fdd835", "#c0ca33",
  "#7cb342", "#1f9d55", "#00897b", "#00acc1", "#039be5", "#1e5bd8", "#3949ab", "#5e35b1", "#8e24aa", "#d81b60", "#ec407a", "#6d4c41"];
const WIDTHS = [2, 5];
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];
const GREEN = "#1f9d55";
const isPdf = (f: string) => /\.pdf$/i.test(f);
const parseInk = (s: string | undefined): Ink => { try { const j = JSON.parse(s || ""); return { rot: Number(j.rot) || 0, items: Array.isArray(j.items) ? j.items : [] }; } catch { return { rot: 0, items: [] }; } };

/** صفحات الورقة بالترتيب: الورقة الكاملة أول، بعدها جواب كل سؤال. السؤال اللي ما بي جواب يبقى صفحة فارغة حتى تنطي درجته */
async function buildPages(paper: Paper, url: (r: string) => string): Promise<Page[]> {
  const out: Page[] = [];
  const add = async (f: string, q: number | null) => {
    if (isPdf(f) && q === null) {
      // ورقة كاملة (مثل أوراق التجربة): تنقسم صفحة لكل سؤال، حتى الدرجة تقلب للسؤال اللي بعده
      const parts = await pdfByQuestion(url(f)).catch(() => []);
      const known = new Set(paper.questions.map((x) => x.n));
      // إذا لگينا كل الأسئلة بالملف ينقسم، وإذا لا يبقى صفحات كاملة واختيار السؤال من فوك
      if (paper.questions.every((x) => parts.some((y) => y.q === x.n)) && parts.every((y) => known.has(y.q))) {
        for (const x of paper.questions) {
          const mine = parts.filter((y) => y.q === x.n);
          if (mine.length) mine.forEach((y) => out.push({ src: y.src, q: x.n }));
          else out.push({ src: null, q: x.n });
        }
        return;
      }
    }
    if (isPdf(f)) for (const src of await pdfToImages(url(f))) out.push({ src, q });
    else out.push({ src: url(f), q });
  };
  for (const f of paper.whole) await add(f, null);
  if (paper.questions.some((q) => q.answers.length) || !paper.whole.length) {
    for (const q of paper.questions) {
      if (q.answers.length) for (const f of q.answers) await add(f, q.n);
      else out.push({ src: null, q: q.n });
    }
  }
  return out;
}

const stickerUrl = (id: number) => `/api/sticker?id=${id}`;
function drawItems(ctx: CanvasRenderingContext2D, items: Item[], w: number, h: number, live?: Item | null, imgs?: Map<number, HTMLImageElement>) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const it of live ? [...items, live] : items) {
    if (it.t === "s") {
      ctx.strokeStyle = it.c; ctx.lineWidth = (it.w * w) / 800;
      ctx.beginPath();
      for (let i = 0; i < it.p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, it.p[i] * w, it.p[i + 1] * h);
      if (it.p.length === 2) ctx.lineTo(it.p[0] * w + 0.1, it.p[1] * h);
      ctx.stroke();
    } else if (it.t === "x") {
      ctx.fillStyle = it.c; ctx.font = `700 ${it.z * w}px Tahoma, Arial, sans-serif`; ctx.textBaseline = "middle";
      it.s.split("\n").forEach((line, i) => ctx.fillText(line, it.x * w, it.y * h + i * it.z * w * 1.25));
    } else if (it.t === "i") {
      const im = imgs?.get(it.id);
      if (im?.complete && im.naturalWidth) { const dw = it.w * w, dh = (dw * im.naturalHeight) / im.naturalWidth; ctx.drawImage(im, it.x * w - dw / 2, it.y * h - dh / 2, dw, dh); }
    } else {
      const r = 0.028 * w, x = it.x * w, y = it.y * h;
      ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = r * 0.28; ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.38); ctx.lineTo(x + r * 0.5, y - r * 0.35); ctx.stroke();
    }
  }
}

/** صفحة وحدة: الصورة جوة والرسم فوكها */
function Sheet({ page, ink, zoom, tool, color, width, sticker, onAdd, onErase, onTap }: {
  page: Page; ink: Ink; zoom: number; tool: Tool; color: string; width: number; sticker: number;
  onAdd: (it: Item) => void; onErase: (x: number, y: number) => void; onTap: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [boxW, setBoxW] = useState(800);
  const live = useRef<Item | null>(null);
  const imgs = useRef(new Map<number, HTMLImageElement>());
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    for (const it of ink.items) if (it.t === "i" && !imgs.current.has(it.id)) {
      const im = new Image(); im.onload = () => setLoaded((n) => n + 1); im.src = stickerUrl(it.id); imgs.current.set(it.id, im);
    }
  }, [ink.items]);
  useEffect(() => {
    setImg(null); setFailed(false);
    if (!page.src) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setFailed(true);
    im.src = page.src;
  }, [page.src]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const side = ink.rot % 180 !== 0;
  const iw = img ? (side ? img.height : img.width) : 1, ih = img ? (side ? img.width : img.height) : 1;
  const w = Math.round(Math.min(boxW, 1100) * zoom), h = Math.round((w * ih) / iw);
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  useEffect(() => {
    const c = bg.current; if (!c || !img) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate((ink.rot * Math.PI) / 180);
    const dw = side ? h : w, dh = side ? w : h;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
  }, [img, w, h, ink.rot, side, dpr]);
  const redraw = useCallback(() => {
    const c = top.current; if (!c) return;
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawItems(ctx, ink.items, w, h, live.current, imgs.current);
  }, [ink.items, w, h, dpr, loaded]);
  useEffect(() => { const c = top.current; if (c) { c.width = w * dpr; c.height = h * dpr; } redraw(); }, [w, h, dpr, redraw]);
  const pt = (e: React.PointerEvent) => { const r = top.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const; };
  function down(e: React.PointerEvent) {
    if (tool === "hand") return;
    e.preventDefault(); top.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "pen") { live.current = { t: "s", c: color, w: width, p: [x, y] }; redraw(); }
    if (tool === "eraser") onErase(x, y);
  }
  function move(e: React.PointerEvent) {
    if (tool === "hand" || !(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "pen" && live.current?.t === "s") { live.current.p.push(+x.toFixed(4), +y.toFixed(4)); redraw(); }
    if (tool === "eraser") onErase(x, y);
  }
  function up(e: React.PointerEvent) {
    if (tool === "hand") return;
    const [x, y] = pt(e);
    if (tool === "pen" && live.current) { const s = live.current; live.current = null; onAdd(s); }
    if (tool === "stamp") onAdd({ t: "k", x, y });
    if (tool === "sticker" && sticker) onAdd({ t: "i", id: sticker, x, y, w: 0.22 });
    if (tool === "text") onTap(x, y);
  }
  return (
    <div ref={box} className="gk-page">
      {!page.src && <div className="gk-empty">⚠️ الطالب ما دز جواب لهذا السؤال.<br />تكدر تنطيه درجة من فوك.</div>}
      {page.src && !img && !failed && <div className="gk-empty">جاري تحميل الورقة...</div>}
      {failed && <div className="gk-empty">⚠️ ما انفتحت هذي الصورة.</div>}
      {img && (
        <div className="gk-sheet" style={{ width: w, height: h }}>
          <canvas ref={bg} style={{ width: w, height: h }} />
          <canvas ref={top} style={{ width: w, height: h, touchAction: tool === "hand" ? "auto" : "none", cursor: tool === "hand" ? "default" : "crosshair" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; redraw(); }} />
        </div>
      )}
    </div>
  );
}

const ICON: Record<Tool, string> = { hand: "👆", pen: "🖊️", eraser: "🧽", text: "T", stamp: "✅", sticker: "🖼" };
const TIP: Record<Tool, string> = { hand: "تحريك", pen: "القلم", eraser: "الممحاة", text: "كتابة", stamp: "ختم صح", sticker: "ملصق" };

const SHOWQ_KEY = "gradeShowQuestion";
export default function Grader({ paper, url, busy, act, onClose, onSkip, onSave, today, left: papersLeft, errors, stickers }: {
  paper: Paper; url: (r: string) => string; busy: boolean; errors: string[]; stickers: Sticker[];
  act: (b: Record<string, unknown>) => Promise<{ paper?: Paper | null } | null>;
  onClose: () => void; onSkip: () => void; onSave: (inkSaved: Promise<void>) => void; today: number; left: number;
}) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [at, setAt] = useState(0);
  const [inks, setInks] = useState<Record<number, Ink>>(() => Object.fromEntries(Object.entries(paper.ink ?? {}).map(([k, v]) => [Number(k), parseInk(v)])));
  const [marks, setMarks] = useState<Record<number, number | null>>(() => Object.fromEntries(paper.questions.map((q) => [q.n, q.mark])));
  const [qSel, setQSel] = useState(paper.questions.find((q) => q.mark === null)?.n ?? paper.questions[0]?.n ?? 0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[3]);
  const [width, setWidth] = useState(WIDTHS[0]);
  const [penBox, setPenBox] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [overlay, setOverlay] = useState<"" | "model" | "question">("");
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [keepErr, setKeepErr] = useState(false);
  const [showQ, setShowQ] = useState(true);
  const [sticker, setSticker] = useState(0);
  const [stickerBox, setStickerBox] = useState(false);
  useEffect(() => { try { if (localStorage.getItem(SHOWQ_KEY) === "0") setShowQ(false); } catch { /* بدون حفظ */ } }, []);
  function toggleQ() { const v = !showQ; setShowQ(v); try { localStorage.setItem(SHOWQ_KEY, v ? "1" : "0"); } catch { /* بدون حفظ */ } }
  const undo = useRef<Record<number, Item[][]>>({});
  const redo = useRef<Record<number, Item[][]>>({});
  const dirty = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inksRef = useRef(inks); inksRef.current = inks;
  const locked = !!paper.graded;
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    buildPages(paper, url).then((p) => {
      if (stop) return;
      setPages(p);
      const first = p.findIndex((x) => x.q !== null && marks[x.q] === null);
      if (first > 0) setAt(first);
    }).catch(() => { if (!stop) setPages([]); });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const list = [...dirty.current]; dirty.current.clear();
    for (const page of list) {
      try {
        const res = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: pageAuth(), action: "ink", id: paper.id, page, ink: JSON.stringify(inksRef.current[page] ?? { rot: 0, items: [] }) }) });
        if (!res.ok) { dirty.current.add(page); setSaveErr((await res.json().catch(() => ({}))).error ?? "ما انحفظ الرسم"); } else setSaveErr("");
      } catch { dirty.current.add(page); setSaveErr("ما انحفظ الرسم، تأكد من النت"); }
    }
  }, [paper.id]);
  useEffect(() => () => { void flush(); }, [flush]);

  const ink = inks[at] ?? { rot: 0, items: [] };
  function change(next: Ink, keep = true) {
    if (locked) return;
    if (keep) { (undo.current[at] ??= []).push(ink.items); redo.current[at] = []; }
    setInks((x) => ({ ...x, [at]: next }));
    dirty.current.add(at);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  }
  const addItem = (it: Item) => change({ ...ink, items: [...ink.items, it] });
  function erase(x: number, y: number) {
    const r = 0.025;
    const near = (px: number, py: number) => Math.hypot(px - x, py - y) < r;
    const items = ink.items.filter((it) => it.t === "s" ? !it.p.some((_, i) => i % 2 === 0 && near(it.p[i], it.p[i + 1])) : !near(it.x, it.y));
    if (items.length !== ink.items.length) change({ ...ink, items });
  }
  function back() { const u = undo.current[at]; if (!u?.length) return; (redo.current[at] ??= []).push(ink.items); change({ ...ink, items: u.pop()! }, false); }
  function forward() { const r = redo.current[at]; if (!r?.length) return; (undo.current[at] ??= []).push(ink.items); change({ ...ink, items: r.pop()! }, false); }
  function rotate() {
    // تدوير الصفحة ربع لفة، والرسم يلف وياها
    const turn = (x: number, y: number) => [+(1 - y).toFixed(4), x];
    const items = ink.items.map((it): Item => it.t === "s" ? { ...it, p: it.p.flatMap((_, i) => i % 2 ? [] : turn(it.p[i], it.p[i + 1])) } : { ...it, x: turn(it.x, it.y)[0], y: turn(it.x, it.y)[1] });
    change({ rot: (ink.rot + 90) % 360, items });
  }
  function go(i: number) {
    if (!pages || i < 0 || i >= pages.length) return;
    void flush(); setAt(i); setPenBox(false);
    stage.current?.scrollTo({ top: 0 });
  }
  const page = pages?.[at];
  const curQ = page?.q ?? qSel;
  const q = paper.questions.find((x) => x.n === curQ);
  const total = Object.values(marks).reduce<number>((s, m) => s + (m ?? 0), 0);
  const missing = paper.questions.filter((x) => marks[x.n] === null || marks[x.n] === undefined).length;
  async function press(m: number) {
    if (!q || locked) return;
    const r = await act({ action: "mark", id: paper.id, q: q.n, mark: m });
    if (!r) return;
    setMarks((x) => ({ ...x, [q.n]: m }));
    // ينتقل وحده للسؤال اللي بعده
    const nextQ = paper.questions[paper.questions.findIndex((x) => x.n === q.n) + 1];
    if (!nextQ) return;
    if (page?.q !== null && pages) { const i = pages.findIndex((p) => p.q === nextQ.n); if (i >= 0) go(i); }
    else setQSel(nextQ.n);
  }
  function pickTool(t: Tool) {
    if (t === "sticker") { setStickerBox(true); setPenBox(false); return; }
    if (t === "pen" && tool === "pen") setPenBox(!penBox); else { setTool(t); setPenBox(false); }
  }
  function addText(value = text) {
    const v = value.trim();
    if (textAt && v) addItem({ t: "x", c: color, x: textAt.x, y: textAt.y, s: v, z: 0.032 });
    if (v && keepErr && !errors.includes(v)) void act({ action: "saveError", text: v });
    setTextAt(null); setText(""); setKeepErr(false);
  }
  /** حفظ الورقة: لازم كل الأسئلة عدها درجة. بعدها تنفتح الورقة الجاية مباشرة، والحفظ يكمل بالخلفية */
  function save() {
    const miss = paper.questions.find((x) => marks[x.n] === null || marks[x.n] === undefined);
    if (miss) {
      setSaveErr(`باقي درجة السؤال ${miss.n}`);
      const i = pages?.findIndex((p) => p.q === miss.n) ?? -1;
      if (i >= 0) go(i); else setQSel(miss.n);
      return;
    }
    onSave(flush());
  }
  return (
    <div className="gk">
      <div className="gk-row gk-head">
        <b className="gk-name">{paper.name}{paper.test ? " (تجربة)" : ""}</b>
        <div className="gk-tools">
          <button type="button" className={"gk-btn" + (showQ ? " on" : "")} onClick={toggleQ}>📋 {showQ ? "إخفاء السؤال" : "إظهار السؤال"}</button>
          <button type="button" className="gk-btn" onClick={() => setOverlay("model")}>📄 الجواب النموذجي</button>
          {!locked && <button type="button" className="gk-ic" title="تراجع" onClick={back}>↶</button>}
          {!locked && <button type="button" className="gk-ic" title="إعادة" onClick={forward}>↷</button>}
        </div>
      </div>
      <div className="gk-row gk-info">
        <button type="button" className="gk-skip" onClick={async () => { await flush(); onClose(); }}>⬅️ القائمة</button>
        <span>الامتحان: {paper.title} · النسخة: {paper.model}</span>
        <span>صححت: <b>{today}</b> | متبقي: <b>{papersLeft}</b>{saveErr && <span className="gk-err"> · ⚠️ {saveErr}</span>}</span>
        {!locked && <button type="button" className="gk-skip" disabled={busy} onClick={async () => { await flush(); onSkip(); }}>⏭ تخطي الورقة</button>}
      </div>
      <div className="gk-row gk-bar">
        <div className="gk-tools">
          <button type="button" className="gk-ic" title="تدوير" disabled={locked} onClick={rotate}>⟳</button>
          <button type="button" className="gk-ic" title="تكبير" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>＋</button>
          <span className="gk-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" className="gk-ic" title="تصغير" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>－</button>
        </div>
        <div className="gk-tools">
          <button type="button" className="gk-ic" disabled={at === 0} onClick={() => go(at - 1)}>›</button>
          <span className="gk-pg">{at + 1}{pages ? ` / ${pages.length}` : ""}</span>
          <button type="button" className="gk-ic" disabled={!pages || at >= pages.length - 1} onClick={() => go(at + 1)}>‹</button>
        </div>
        {!locked && <button type="button" className="gk-clear" onClick={() => ink.items.length && change({ ...ink, items: [] })}>🗑 مسح الصفحة</button>}
        {!locked && <div className="gk-tools gk-pens">
          {(["sticker", "stamp", "text", "eraser", "pen", "hand"] as Tool[]).map((t) => (
            <button type="button" key={t} title={TIP[t]} className={"gk-ic" + (tool === t ? " on" : "")} onClick={() => pickTool(t)}>
              {t === "pen" ? <span style={{ color }}>{ICON[t]}</span> : t === "sticker" && sticker ? <img className="gk-stic" src={stickerUrl(sticker)} alt="" /> : ICON[t]}
            </button>
          ))}
          {penBox && (
            <div className="gk-penbox">
              <div className="gk-lbl">خيارات القلم</div>
              <div className="gk-colors">{COLORS.map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
              <label className="gk-custom">🎨 لون ثاني <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
              <div className="gk-tools">{WIDTHS.map((w) => <button type="button" key={w} className={"gk-w" + (width === w ? " on" : "")} onClick={() => setWidth(w)}><span style={{ height: w }} /></button>)}</div>
              <button type="button" className="gk-btn" onClick={() => setPenBox(false)}>تم</button>
            </div>
          )}
        </div>}
      </div>
      {q && (
        <div className="gk-row gk-marks">
          {page?.q === null && <div className="gk-qs">{paper.questions.map((x) => <button type="button" key={x.n} className={x.n === curQ ? "on" : ""} onClick={() => setQSel(x.n)}>س{x.n}{marks[x.n] !== null && marks[x.n] !== undefined ? ` · ${marks[x.n]}` : ""}</button>)}</div>}
          <span className="gk-q">س{q.n}<small> من {q.max}</small></span>
          <div className="gk-nums">
            {Array.from({ length: q.max + 1 }, (_, m) => m).map((m) => (
              <button type="button" key={m} className={marks[q.n] === m ? "on" : ""} disabled={busy || locked} onClick={() => void press(m)}>{m}</button>
            ))}
          </div>
          <span className="gk-total">{total} / 100</span>
          {!locked && <button type="button" className="gk-save" disabled={busy} onClick={save}>💾 حفظ{missing ? ` (باقي ${missing})` : ""}</button>}
        </div>
      )}
      <div className="gk-stage" ref={stage}>
        {!pages && <div className="gk-empty">جاري تجهيز الورقة...</div>}
        {pages && !pages.length && <div className="gk-empty">⚠️ ماكو صفحات بهذي الورقة.</div>}
        {page && showQ && q && <div className="gk-qtop"><span>السؤال {q.n}</span><img src={url(q.image)} alt={`السؤال ${q.n}`} /></div>}
        {page && <Sheet key={at + ":" + page.src} page={page} ink={ink} zoom={zoom} tool={locked ? "hand" : tool} color={color} width={width} sticker={sticker} onAdd={addItem} onErase={erase} onTap={(x, y) => { setTextAt({ x, y }); setText(""); }} />}
      </div>
      {textAt && (
        <div className="gk-modal" onClick={() => setTextAt(null)}>
          <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
            <b>إضافة تعليق نصي</b>
            <textarea autoFocus rows={3} value={text} placeholder="اكتب التعليق..." onChange={(e) => setText(e.target.value)} />
            <label className="gk-keep"><input type="checkbox" checked={keepErr} onChange={(e) => setKeepErr(e.target.checked)} /> حفظ في الأخطاء الشائعة</label>
            {!!errors.length && (
              <div className="gk-errs">
                <div className="gk-lbl">الأخطاء الشائعة: اضغط واحد حتى ينكتب</div>
                {errors.map((e) => (
                  <span key={e} className="gk-errchip">
                    <button type="button" onClick={() => addText(e)}>{e}</button>
                    <button type="button" aria-label="حذف" className="gk-x" onClick={() => void act({ action: "delError", text: e })}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="gk-tools"><button type="button" className="gk-finish" onClick={() => addText()}>إضافة</button><button type="button" className="gk-btn" onClick={() => setTextAt(null)}>إلغاء</button></div>
          </div>
        </div>
      )}
      {stickerBox && (
        <div className="gk-modal" onClick={() => setStickerBox(false)}>
          <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
            <b>اختار ملصق</b>
            {!stickers.length && <div>ماكو ملصقات بعد. صاحب البوت يرفعها من «مكتبة الملصقات».</div>}
            <div className="gk-stgrid">
              {stickers.map((s) => (
                <button type="button" key={s.id} className={sticker === s.id ? "on" : ""} onClick={() => { setSticker(s.id); setTool("sticker"); setStickerBox(false); }}>
                  <img src={stickerUrl(s.id)} alt={s.name} /><span>{s.name}</span>
                </button>
              ))}
            </div>
            <button type="button" className="gk-btn" onClick={() => setStickerBox(false)}>إلغاء</button>
          </div>
        </div>
      )}
      {overlay && (
        <div className="gk-over">
          <div className="gk-row gk-head"><button type="button" className="gk-btn" onClick={() => setOverlay("")}>⬅️ رجوع للورقة</button><b>{overlay === "model" ? "📄 الجواب النموذجي" : `📋 السؤال ${q?.n ?? ""}`}</b></div>
          <div className="gk-stage">
            {overlay === "model" && (paper.answerPdf ? <PdfPages url={url(paper.answerPdf)} outside={false} /> : <div className="gk-empty">ماكو جواب نموذجي مرفوع لهذي النسخة.</div>)}
            {overlay === "question" && q && <img className="gk-qimg" src={url(q.image)} alt={`السؤال ${q.n}`} />}
          </div>
        </div>
      )}
    </div>
  );
}
