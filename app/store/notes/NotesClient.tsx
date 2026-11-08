"use client";
// ملازمي: الطالب يشوف ملازم فصوله، يقلب صفحاتها، ويكتب فوكها بالقلم أو يظلل. كتابته تنحفظ وحدها.
// الصفحة ترتسم على canvas، فما بيها صورة ينضغط عليها حتى تنحفظ
import { useCallback, useEffect, useRef, useState } from "react";
import { deviceId, deviceNow, haptic, platform } from "../shared";

type Book = { id: number; title: string; chapter: string; pages: number };
type Stroke = { c: string; w: number; h?: 1; p: number[] };
type Tool = "hand" | "pen" | "mark" | "erase";

const PENS = ["#111111", "#1e5bd8", "#e53935", "#1f9d55"];
const MARKS = ["#ffe600", "#7dff6b", "#ff9de2"];
const ZOOMS = [1, 1.5, 2, 3];
const token = () => new URLSearchParams(location.search).get("t") ?? "";
const lastKey = (id: number) => `noteLast${id}`;

async function post(body: Record<string, unknown>, keepalive = false) {
  const res = await fetch("/api/notes", { method: "POST", keepalive, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token(), device: await deviceId(), pf: await platform(), ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
  return j;
}

function draw(ctx: CanvasRenderingContext2D, list: Stroke[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of list) {
    ctx.globalAlpha = s.h ? 0.38 : 1;
    ctx.strokeStyle = s.c; ctx.lineWidth = (s.w * w) / 800;
    ctx.beginPath();
    for (let i = 0; i < s.p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.p[i] * w, s.p[i + 1] * h);
    if (s.p.length === 2) ctx.lineTo(s.p[0] * w + 0.1, s.p[1] * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export default function NotesClient() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Book | null>(null);
  useEffect(() => { post({ action: "list" }).then((j) => setBooks(j.books)).catch((e) => setError((e as Error).message)); }, []);
  // الشاشة كلها للملزمة، والضغط المطول ما يطلع قائمة حفظ
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", stop);
    return () => document.removeEventListener("contextmenu", stop);
  }, []);
  if (open) return <Reader book={open} onClose={() => setOpen(null)} />;
  const chapters = [...new Set((books ?? []).map((b) => b.chapter))];
  return (
    <>
      <header><img src="/logo.png" alt="" /><h1>قصي العميري</h1><p>📘 ملازمي</p></header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!books && !error && <div className="empty">جاري التحميل...</div>}
        {books && !books.length && <div className="empty">ماكو ملازم لفصولك بعد.</div>}
        {chapters.map((c) => (
          <div className="card" key={c}>
            <h2>{c}</h2>
            <div className="ntlist">
              {books!.filter((b) => b.chapter === c).map((b) => (
                <button type="button" key={b.id} className="exbtn" onClick={() => { haptic(); void post({ action: "open", book: b.id }).catch(() => undefined); setOpen(b); }}>📘 {b.title} <small>({b.pages} صفحة)</small></button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const [page, setPage] = useState(() => { try { const n = Number(localStorage.getItem(lastKey(book.id))); return n >= 1 && n <= book.pages ? n : 1; } catch { return 1; } });
  const [tool, setTool] = useState<Tool>("hand");
  const [pen, setPen] = useState(PENS[1]);
  const [mark, setMark] = useState(MARKS[0]);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(true);
  const [boxW, setBoxW] = useState(360);
  const stage = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes); strokesRef.current = strokes;
  const undo = useRef<Stroke[][]>([]);
  const dirty = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async (keepalive = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = dirty.current;
    if (p === null) return;
    dirty.current = null;
    try { await post({ action: "save", book: book.id, page: p, ink: JSON.stringify({ items: strokesRef.current }) }, keepalive); setSaved(true); setErr(""); }
    catch (e) { dirty.current = p; setErr((e as Error).message); }
  }, [book.id]);

  const src = useCallback((n: number) => `/api/notes/page?t=${encodeURIComponent(token())}&book=${book.id}&page=${n}&pf=${encodeURIComponent((window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "")}&d=${encodeURIComponent(deviceNow())}`, [book.id]);
  useEffect(() => {
    let stop = false;
    setImg(null); setStrokes([]); setErr(""); undo.current = [];
    try { localStorage.setItem(lastKey(book.id), String(page)); } catch { /* بدون حفظ */ }
    const im = new Image();
    im.onload = () => { if (!stop) setImg(im); };
    im.onerror = () => { if (!stop) setErr("ما انفتحت هاي الصفحة. حاول مرة ثانية"); };
    im.src = src(page);
    post({ action: "ink", book: book.id, page }).then((j) => { if (!stop && j.ink) { try { setStrokes(JSON.parse(j.ink).items ?? []); } catch { /* بدون كتابة */ } } }).catch((e) => { if (!stop) setErr((e as Error).message); });
    // الصفحة الجاية تتجهز حتى التقليب يصير أسرع
    if (page < book.pages) new Image().src = src(page + 1);
    stage.current?.scrollTo({ top: 0 });
    return () => { stop = true; };
  }, [page, book.id, book.pages, src]);

  useEffect(() => {
    const save = () => { if (document.visibilityState === "hidden") void flush(true); };
    document.addEventListener("visibilitychange", save);
    return () => { document.removeEventListener("visibilitychange", save); void flush(true); };
  }, [flush]);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const w = Math.round(boxW * zoom), h = img ? Math.round((w * img.height) / img.width) : 0;
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  useEffect(() => {
    const c = bg.current; if (!c || !img) return;
    c.width = w * dpr; c.height = h * dpr;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  }, [img, w, h, dpr]);
  const redraw = useCallback((list: Stroke[]) => {
    const c = top.current; if (!c) return;
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, live.current ? [...list, live.current] : list, w, h);
  }, [w, h, dpr]);
  useEffect(() => { const c = top.current; if (c && img) { c.width = w * dpr; c.height = h * dpr; redraw(strokes); } }, [img, w, h, dpr, strokes, redraw]);

  function change(next: Stroke[]) {
    undo.current.push(strokesRef.current);
    strokesRef.current = next;
    setStrokes(next); setSaved(false);
    dirty.current = page;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }
  function back() { const u = undo.current.pop(); if (!u) return; strokesRef.current = u; setStrokes(u); setSaved(false); dirty.current = page; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 1000); }
  async function go(n: number) { if (n < 1 || n > book.pages || n === page) return; await flush(); setPage(n); }
  const pt = (e: React.PointerEvent) => { const r = top.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)] as const; };
  function erase(x: number, y: number) {
    const next = strokesRef.current.filter((s) => !s.p.some((_, i) => i % 2 === 0 && Math.hypot(s.p[i] - x, s.p[i + 1] - y) < 0.025));
    if (next.length !== strokesRef.current.length) change(next);
  }
  function down(e: React.PointerEvent) {
    if (tool === "hand") return;
    e.preventDefault(); top.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "erase") { erase(x, y); return; }
    live.current = tool === "mark" ? { c: mark, w: 22, h: 1, p: [x, y] } : { c: pen, w: 2.5, p: [x, y] };
    redraw(strokesRef.current);
  }
  function move(e: React.PointerEvent) {
    if (tool === "hand" || !(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "erase") { erase(x, y); return; }
    if (live.current) { live.current.p.push(x, y); redraw(strokesRef.current); }
  }
  function up() { const s = live.current; if (s) { live.current = null; change([...strokesRef.current, s]); } }
  const pick = (t: Tool, icon: string, tip: string) => <button type="button" title={tip} aria-label={tip} className={"gk-ic" + (tool === t ? " on" : "")} onClick={() => setTool(t)}>{icon}</button>;

  return (
    <div className="nt">
      <div className="ntbar">
        <button type="button" className="gk-btn" onClick={async () => { await flush(); onClose(); }}>⬅️ رجوع</button>
        <b className="nttitle">{book.title}</b>
        <small className={saved ? "ntok" : "ntwait"}>{err ? "⚠️" : saved ? "✅ محفوظ" : "⏳ يحفظ"}</small>
      </div>
      <div className="ntbar">
        {pick("hand", "👆", "تحريك الصفحة")}{pick("pen", "✏️", "قلم")}{pick("mark", "🖍️", "تظليل")}{pick("erase", "🧽", "ممحاة")}
        <button type="button" className="gk-ic" title="تراجع" aria-label="تراجع" onClick={back}>↶</button>
        <span className="ntgap" />
        <button type="button" className="gk-ic" aria-label="تصغير" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[ZOOMS.indexOf(zoom) - 1])}>－</button>
        <button type="button" className="gk-ic" aria-label="تكبير" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[ZOOMS.indexOf(zoom) + 1])}>＋</button>
      </div>
      {(tool === "pen" || tool === "mark") && (
        <div className="ntbar ntcolors">
          {(tool === "pen" ? PENS : MARKS).map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + ((tool === "pen" ? pen : mark) === c ? " on" : "")} style={{ background: c }} onClick={() => (tool === "pen" ? setPen(c) : setMark(c))} />)}
        </div>
      )}
      {err && <div className="ntbad">⚠️ {err}</div>}
      <div className="ntstage" ref={stage}>
        {!img && !err && <div className="gk-empty">جاري فتح الصفحة...</div>}
        {img && (
          <div className="ntsheet" style={{ width: w, height: h }}>
            <canvas ref={bg} style={{ width: w, height: h }} />
            <canvas ref={top} style={{ width: w, height: h, touchAction: tool === "hand" ? "auto" : "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; redraw(strokesRef.current); }} />
          </div>
        )}
      </div>
      <div className="ntbar ntpages">
        <button type="button" className="gk-btn" disabled={page >= book.pages} onClick={() => void go(page + 1)}>التالية ‹</button>
        <select aria-label="الصفحة" value={page} onChange={(e) => void go(Number(e.target.value))}>{Array.from({ length: book.pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} / {book.pages}</option>)}</select>
        <button type="button" className="gk-btn" disabled={page <= 1} onClick={() => void go(page - 1)}>› السابقة</button>
      </div>
    </div>
  );
}
