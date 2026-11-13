"use client";
// ملازمي: الطالب يشوف ملازم فصوله، يقلب صفحاتها، ويكتب فوكها بالقلم أو يظلل. كتابته تنحفظ وحدها.
// الصفحة ترتسم على canvas، فما بيها صورة ينضغط عليها حتى تنحفظ
import { useCallback, useEffect, useRef, useState } from "react";
import { deviceId, deviceNow, haptic, platform } from "../shared";

type Book = { id: number; title: string; chapter: string; pages: number };
type Mark = { id: number; page: number; y: number; video: boolean; solution: boolean };
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
  // أزرار الفيديو يم الأسئلة: الفيديو يوصل بالبوت محمي
  const [marks, setMarks] = useState<Mark[]>([]);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { post({ action: "marks", book: book.id }).then((j) => setMarks(j.marks ?? [])).catch(() => undefined); }, [book.id]);
  const [yt, setYt] = useState("");
  async function play(m: Mark, kind: "video" | "solution") {
    haptic(); setSending(true); setMsg(kind === "solution" ? "⏳ دا يفتح فيديو الحل..." : "⏳ دا يوصلك الفيديو بالبوت...");
    try {
      const j = await post({ action: "play", book: book.id, mark: m.id, kind });
      if (j.yt) { setYt(j.yt); setMsg(""); } else setMsg(`${j.notice}. سد الملزمة وشوفه، وترجع لنفس الصفحة.`);
    }
    catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setSending(false); }
  }
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
      {msg && <div className="ntmsg" onClick={() => setMsg("")}>{msg}</div>}
      <div className="ntstage" ref={stage}>
        {!img && !err && <div className="gk-empty">جاري فتح الصفحة...</div>}
        {img && (
          <div className="ntsheet" style={{ width: w, height: h }}>
            <canvas ref={bg} style={{ width: w, height: h }} />
            <canvas ref={top} style={{ width: w, height: h, touchAction: tool === "hand" ? "auto" : "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; redraw(strokesRef.current); }} />
            {marks.filter((m) => m.page === page).map((m) => (
              <div key={m.id} className="ntmark" style={{ top: Math.max(0, m.y * h - 4) }}>
                {m.solution && <button type="button" disabled={sending} onClick={() => void play(m, "solution")}>🎬 فيديو حل السؤال</button>}
                {m.video && <button type="button" disabled={sending} onClick={() => void play(m, "video")}>▶️ فيديو توضيح السؤال</button>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ntbar ntpages">
        <button type="button" className="gk-btn" disabled={page >= book.pages} onClick={() => void go(page + 1)}>التالية ‹</button>
        <select aria-label="الصفحة" value={page} onChange={(e) => void go(Number(e.target.value))}>{Array.from({ length: book.pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} / {book.pages}</option>)}</select>
        <button type="button" className="gk-btn" disabled={page <= 1} onClick={() => void go(page - 1)}>› السابقة</button>
      </div>
      {yt && <YtPlayer id={yt} onClose={() => setYt("")} />}
    </div>
  );
}

// ---------- فيديو الحل من يوتيوب: يشتغل فوك الملزمة. أزرار اليوتيوب ما تنداس (لا رابط ولا "شوفه على يوتيوب")، والتحكم من أزرارنا
type YtP = { playVideo(): void; pauseVideo(): void; seekTo(s: number, a: boolean): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; setPlaybackRate(r: number): void; destroy(): void };
type YtNS = { Player: new (el: HTMLElement, o: object) => YtP };
let ytApi: Promise<YtNS> | null = null;
function loadYt(): Promise<YtNS> {
  const w = window as unknown as { YT?: YtNS & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytApi ??= new Promise((ok, bad) => {
    w.onYouTubeIframeAPIReady = () => ok(w.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytApi = null; bad(new Error("ما انفتح الفيديو. تأكد من النت وحاول مرة ثانية")); };
    document.head.appendChild(s);
  });
  return ytApi;
}
// السرعات اللي يقبلها يوتيوب: أبطأ لحد ربع السرعة، وأسرع لحد الضعف
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function YtPlayer({ id, onClose }: { id: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const p = useRef<YtP | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    let stop = false;
    loadYt().then((YT) => {
      if (stop || !slot.current) return;
      p.current = new YT.Player(slot.current, {
        host: "https://www.youtube-nocookie.com", videoId: id, width: "100%", height: "100%",
        playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, autoplay: 1, origin: location.origin },
        events: {
          onReady: () => { if (!stop) { setReady(true); setD(p.current!.getDuration()); p.current!.playVideo(); } },
          onStateChange: (e: { data: number }) => { if (!stop) { setOn(e.data === 1 || e.data === 3); if (e.data === 0) setT(p.current!.getDuration()); } },
          onError: () => { if (!stop) setErr("هذا الفيديو ما يشتغل هسه. بلغ الأستاذ"); },
        },
      });
    }).catch((e) => { if (!stop) setErr((e as Error).message); });
    const tick = setInterval(() => { const q = p.current; if (q?.getCurrentTime) { setT(q.getCurrentTime()); const du = q.getDuration(); if (du) setD(du); } }, 500);
    return () => { stop = true; clearInterval(tick); try { p.current?.destroy(); } catch { /* انسد */ } p.current = null; };
  }, [id]);
  const q = () => p.current;
  const toggle = () => { haptic(); const x = q(); if (!x) return; if (on) x.pauseVideo(); else x.playVideo(); };
  const jump = (s: number) => { const x = q(); if (!x) return; const n = Math.max(0, Math.min(d || 0, x.getCurrentTime() + s)); x.seekTo(n, true); setT(n); };
  const full = () => { const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined); else el.webkitRequestFullscreen?.(); };
  return (
    <div className="ntyt" ref={box} onContextMenu={(e) => e.preventDefault()}>
      <div className="ntytbar">
        <b>🎬 فيديو حل السؤال</b>
        <button type="button" className="gk-btn" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); onClose(); }}>✖ سد وارجع للملزمة</button>
      </div>
      <div className="ntytbox">
        <div className="ntytframe"><div ref={slot} /></div>
        {/* غطا شفاف: الطالب ما يگدر يدوس على أي شي من اليوتيوب. دوسة وحدة توقف أو تشغل */}
        <div className="ntytcover" onClick={toggle} />
        {err && <div className="ntytmsg">⚠️ {err}</div>}
        {!ready && !err && <div className="ntytmsg">جاري فتح الفيديو...</div>}
      </div>
      <div className="ntytctl">
        <button type="button" className="gk-ic" aria-label={on ? "وقف" : "شغل"} disabled={!ready} onClick={toggle}>{on ? "⏸" : "▶️"}</button>
        <button type="button" className="gk-ic" aria-label="ارجع 10 ثواني" disabled={!ready} onClick={() => jump(-10)}>↻10</button>
        <button type="button" className="gk-ic" aria-label="قدم 10 ثواني" disabled={!ready} onClick={() => jump(10)}>10↺</button>
        <input type="range" dir="ltr" aria-label="مكان الفيديو" min={0} max={Math.max(1, Math.floor(d))} step={1} value={Math.floor(t)} disabled={!ready} onChange={(e) => { const n = Number(e.target.value); setT(n); q()?.seekTo(n, true); }} />
        <small dir="ltr">{clock(t)} / {clock(d)}</small>
        <select aria-label="السرعة" dir="ltr" disabled={!ready} value={speed} onChange={(e) => { const n = Number(e.target.value); setSpeed(n); q()?.setPlaybackRate(n); }}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s === 1 ? "1x عادي" : `${s}x ${s < 1 ? "أبطأ" : "أسرع"}`}</option>)}
        </select>
        <button type="button" className="gk-ic" aria-label="ملء الشاشة" onClick={full}>⛶</button>
      </div>
    </div>
  );
}
