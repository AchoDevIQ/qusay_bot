"use client";
// شاشة تصحيح الورقة مثل النظام القديم: كل سؤال صفحة، القلم والممحاة والكتابة وختم الصح فوك جواب الطالب،
// والدرجات بصف فوك. الرسم ينحفظ وحده لكل صفحة
import { useCallback, useEffect, useRef, useState } from "react";
import { pageAuth } from "../adminPage";
import PdfPages, { pdfToImages } from "../PdfPages";

export type Q = { n: number; max: number; image: string; answers: string[]; mark: number | null };
export type Paper = { id: number; name: string; title: string; chapter: string; model: string; test: boolean; graded: string; total: number | null; answerPdf: string | null; whole: string[]; questions: Q[]; ink: Record<number, string> };
type Item = { t: "s"; c: string; w: number; p: number[] } | { t: "x"; c: string; x: number; y: number; s: string; z: number } | { t: "k"; x: number; y: number };
type Ink = { rot: number; items: Item[] };
type Page = { src: string | null; q: number | null };
type Tool = "hand" | "pen" | "eraser" | "text" | "stamp";

const COLORS = ["#111111", "#1f9d55", "#1e5bd8", "#e53935"];
const WIDTHS = [2, 5];
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];
const GREEN = "#1f9d55";
const isPdf = (f: string) => /\.pdf$/i.test(f);
const parseInk = (s: string | undefined): Ink => { try { const j = JSON.parse(s || ""); return { rot: Number(j.rot) || 0, items: Array.isArray(j.items) ? j.items : [] }; } catch { return { rot: 0, items: [] }; } };

/** صفحات الورقة بالترتيب: الورقة الكاملة أول، بعدها جواب كل سؤال. السؤال اللي ما بي جواب يبقى صفحة فارغة حتى تنطي درجته */
async function buildPages(paper: Paper, url: (r: string) => string): Promise<Page[]> {
  const out: Page[] = [];
  const add = async (f: string, q: number | null) => {
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

function drawItems(ctx: CanvasRenderingContext2D, items: Item[], w: number, h: number, live?: Item | null) {
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
    } else {
      const r = 0.028 * w, x = it.x * w, y = it.y * h;
      ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = r * 0.28; ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.38); ctx.lineTo(x + r * 0.5, y - r * 0.35); ctx.stroke();
    }
  }
}

/** صفحة وحدة: الصورة جوة والرسم فوكها */
function Sheet({ page, ink, zoom, tool, color, width, onAdd, onErase, onTap }: {
  page: Page; ink: Ink; zoom: number; tool: Tool; color: string; width: number;
  onAdd: (it: Item) => void; onErase: (x: number, y: number) => void; onTap: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [boxW, setBoxW] = useState(800);
  const live = useRef<Item | null>(null);
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
    drawItems(ctx, ink.items, w, h, live.current);
  }, [ink.items, w, h, dpr]);
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

const ICON: Record<Tool, string> = { hand: "👆", pen: "🖊️", eraser: "🧽", text: "T", stamp: "✅" };
const TIP: Record<Tool, string> = { hand: "تحريك", pen: "القلم", eraser: "الممحاة", text: "كتابة", stamp: "ختم صح" };

export default function Grader({ paper, url, busy, act, onClose, onSkip, onFinish, today, left: papersLeft }: {
  paper: Paper; url: (r: string) => string; busy: boolean;
  act: (b: Record<string, unknown>) => Promise<{ paper?: Paper | null } | null>;
  onClose: () => void; onSkip: () => void; onFinish: () => void; today: number; left: number;
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
  const [askFinish, setAskFinish] = useState(false);
  const [saveErr, setSaveErr] = useState("");
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
  function pickTool(t: Tool) { if (t === "pen" && tool === "pen") setPenBox(!penBox); else { setTool(t); setPenBox(false); } }
  function addText() {
    if (textAt && text.trim()) addItem({ t: "x", c: color, x: textAt.x, y: textAt.y, s: text.trim(), z: 0.032 });
    setTextAt(null); setText("");
  }
  return (
    <div className="gk">
      <div className="gk-row gk-head">
        <button type="button" className="gk-ic" aria-label="سد" onClick={async () => { await flush(); onClose(); }}>✕</button>
        <b className="gk-name">{paper.name}{paper.test ? " (تجربة)" : ""}</b>
        <div className="gk-tools">
          <button type="button" className="gk-ic" title="السؤال" onClick={() => setOverlay("question")}>📋</button>
          <button type="button" className="gk-ic" title="الجواب النموذجي" onClick={() => setOverlay("model")}>📄</button>
          {!locked && <button type="button" className="gk-btn" disabled={busy} onClick={async () => { await flush(); onSkip(); }}>⏭ تخطي</button>}
          {!locked && <button type="button" className="gk-btn" onClick={() => ink.items.length && change({ ...ink, items: [] })}>🗑 إعادة مسح</button>}
          {!locked && <button type="button" className="gk-ic" title="تراجع" onClick={back}>↶</button>}
          {!locked && <button type="button" className="gk-ic" title="إعادة" onClick={forward}>↷</button>}
          {!locked && <button type="button" className="gk-btn" onClick={() => void flush()}>💾 حفظ</button>}
        </div>
      </div>
      <div className="gk-row gk-info">
        <span>الامتحان: {paper.title} · النسخة: {paper.model}</span>
        <span>صححت: <b>{today}</b> | متبقي: <b>{papersLeft}</b>{saveErr && <span className="gk-err"> · ⚠️ {saveErr}</span>}</span>
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
        {!locked && <div className="gk-tools gk-pens">
          {(["stamp", "text", "eraser", "pen", "hand"] as Tool[]).map((t) => (
            <button type="button" key={t} title={TIP[t]} className={"gk-ic" + (tool === t ? " on" : "")} onClick={() => pickTool(t)}>
              {t === "pen" ? <span style={{ color }}>{ICON[t]}</span> : ICON[t]}
            </button>
          ))}
          {penBox && (
            <div className="gk-penbox">
              <div className="gk-lbl">خيارات القلم</div>
              <div className="gk-tools">{COLORS.map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
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
          {!locked && <button type="button" className="gk-finish" disabled={busy || missing > 0} onClick={() => setAskFinish(true)}>{missing ? `باقي ${missing}` : "✅ خلصت"}</button>}
        </div>
      )}
      <div className="gk-stage" ref={stage}>
        {!pages && <div className="gk-empty">جاري تجهيز الورقة...</div>}
        {pages && !pages.length && <div className="gk-empty">⚠️ ماكو صفحات بهذي الورقة.</div>}
        {page && <Sheet key={at + ":" + page.src} page={page} ink={ink} zoom={zoom} tool={locked ? "hand" : tool} color={color} width={width} onAdd={addItem} onErase={erase} onTap={(x, y) => { setTextAt({ x, y }); setText(""); }} />}
      </div>
      {textAt && (
        <div className="gk-modal" onClick={() => setTextAt(null)}>
          <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
            <b>إضافة تعليق نصي</b>
            <textarea autoFocus rows={3} value={text} placeholder="اكتب التعليق..." onChange={(e) => setText(e.target.value)} />
            <div className="gk-tools"><button type="button" className="gk-finish" onClick={addText}>إضافة</button><button type="button" className="gk-btn" onClick={() => setTextAt(null)}>إلغاء</button></div>
          </div>
        </div>
      )}
      {askFinish && (
        <div className="gk-modal" onClick={() => setAskFinish(false)}>
          <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
            <b>تخلص الورقة؟</b>
            <div>المجموع <b>{total}</b> من 100{paper.test ? "" : "، وتوصل للطالب وولي أمره"}.</div>
            <div className="gk-tools"><button type="button" className="gk-finish" disabled={busy} onClick={async () => { await flush(); setAskFinish(false); onFinish(); }}>إي، خلصت</button><button type="button" className="gk-btn" onClick={() => setAskFinish(false)}>لا</button></div>
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
