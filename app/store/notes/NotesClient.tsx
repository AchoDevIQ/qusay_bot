"use client";
// ملازمي: الطالب يشوف ملازم فصوله، يقلب صفحاتها، ويكتب فوكها بالقلم أو يظلل. كتابته تنحفظ وحدها.
// الصفحة ترتسم على canvas، فما بيها صورة ينضغط عليها حتى تنحفظ
import { useCallback, useEffect, useRef, useState } from "react";
import { deviceId, deviceNow, haptic, platform } from "../shared";
import { COLORS } from "../grade/pens";

type Book = { id: number; title: string; chapter: string; pages: number; kind?: string; saved?: number };
type Mark = { id: number; page: number; y: number; video: boolean; solution: boolean };
type Stroke = { c: string; w: number; h?: 1; p: number[] };
type Tool = "hand" | "pen" | "mark" | "ruler" | "erase" | "note";
/** ملاحظة لاصقة على الصفحة: مكانها (من 0 لـ 1) ونصها */
type Ink = { p: number[]; c?: string };
type Note = { x: number; y: number; t: string; s?: Ink[]; c?: string; b?: string };
// ألوان ورقة الملاحظة وأرضياتها: الطالب يختار
const NOTE_COLORS: [string, string][] = [["y", "أصفر"], ["p", "وردي"], ["g", "أخضر"], ["b", "أزرق"], ["o", "برتقالي"], ["w", "أبيض"]];
const NOTE_BGS: [string, string, string][] = [["plain", "▫️", "سادة"], ["lines", "☰", "مسطّرة"], ["grid", "▦", "مربعات"], ["dots", "⁘", "نقاط"]];
const NOTE_INKS = ["#1e3a8a", "#111111", "#e53935", "#1f9d55", "#8e24aa"];

// كل ألوان صفحة التصحيح، للقلم وللتظليل (التظليل نفس اللون بس شفاف)، ويا 🎨 أي لون ثاني
const PENS = COLORS;
const MARKS = ["#ffe600", ...COLORS.filter((c) => c !== "#ffffff")];
const ZOOMS = [1, 1.5, 2, 3];
const token = () => new URLSearchParams(location.search).get("t") ?? "";

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
  if (open) return <Reader book={open} onClose={(saved) => { setBooks((l) => l?.map((b) => (b.id === open.id ? { ...b, saved } : b)) ?? l); setOpen(null); }} />;
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
                <button type="button" key={b.id} className="exbtn" onClick={() => { haptic(); void post({ action: "open", book: b.id }).catch(() => undefined); setOpen(b); }}>{b.kind === "rasid" ? "📝" : "📘"} {b.title} <small>({b.pages} صفحة{b.saved ? ` · 🔖 وصلت ص${b.saved}` : ""})</small></button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// الملزمة صفحات ورا بعض مثل ملف PDF: الطالب يسحب للأسفل ويقلب، ويكتب برقم الصفحة حتى يروح لها.
// بس الصفحات القريبة من اللي يشوفها تنرسم (الباقي مربع فارغ بنفس الحجم)، حتى الموبايل ما يثقل والسيرفر ما ينضغط
const GAP = 10;
const SIDE = 44;
const NEAR = 2;
type SheetApi = { flush: (keepalive?: boolean) => Promise<void>; restore: (s: Stroke[]) => void };

function Reader({ book, onClose }: { book: Book; onClose: (saved: number) => void }) {
  const [page, setPage] = useState(1);
  const [bookmark] = useState(book.saved && book.saved <= book.pages ? book.saved : 0);
  const [tool, setTool] = useState<Tool>("hand");
  const [pen, setPen] = useState(PENS[1]);
  const [mark, setMark] = useState(MARKS[0]);
  const [zoom, setZoom] = useState(1);
  const [ratio, setRatio] = useState(1.414);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(0);
  const [boxW, setBoxW] = useState(360);
  const [find, setFind] = useState("");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [yt, setYt] = useState("");
  const [clip, setClip] = useState("");
  const [clipMark, setClipMark] = useState<Mark | null>(null);
  // 📝 الراصد: رقم الصفحة اللي مفتوح حلها النموذجي (0 = يشوف حله هو)
  const [sol, setSol] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const sheets = useRef(new Map<number, SheetApi>());
  const undo = useRef<{ n: number; prev: Stroke[] }[]>([]);
  useEffect(() => { post({ action: "marks", book: book.id }).then((j) => setMarks(j.marks ?? [])).catch(() => undefined); }, [book.id]);

  async function play(m: Mark, kind: "video" | "solution" | "chat") {
    haptic(); setSending(true); setMsg("⏳ دا يفتح الفيديو...");
    try {
      const j = await post({ action: "play", book: book.id, mark: m.id, kind });
      if (j.yt) { setYt(j.yt); setMsg(""); }
      else if (j.clip) { setClipMark(m); setClip(`/api/notes/video?t=${encodeURIComponent(token())}&book=${book.id}&mark=${m.id}&pf=${encodeURIComponent(tgPlatform())}&d=${encodeURIComponent(deviceNow())}`); setMsg(""); }
      else setMsg(`${j.notice}. سد الملزمة وشوفه، وترجع لنفس الصفحة.`);
    }
    catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setSending(false); }
  }

  // 🔖 الصفحة اللي وصلها تنحفظ وحدها: من يوگف على صفحة (غير الأولى) ثلث ثواني، أو من يطلع. فحتى لو سد البوت كله تبقى
  const lastSaved = useRef(bookmark);
  const saveSpot = useCallback((n: number, keepalive = false) => {
    if (n <= 1 || n === lastSaved.current) return;
    lastSaved.current = n;
    void post({ action: "bookmark", book: book.id, page: n }, keepalive).catch(() => { lastSaved.current = 0; });
  }, [book.id]);
  const pageRef = useRef(page); pageRef.current = page;
  useEffect(() => { const t = setTimeout(() => saveSpot(page), 3000); return () => clearTimeout(t); }, [page, saveSpot]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") saveSpot(pageRef.current, true); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [saveSpot]);
  const flushAll = useCallback(async (keepalive = false) => { await Promise.all([...sheets.current.values()].map((s) => s.flush(keepalive))); }, []);
  useEffect(() => {
    const save = () => { if (document.visibilityState === "hidden") void flushAll(true); };
    document.addEventListener("visibilitychange", save);
    return () => { document.removeEventListener("visibilitychange", save); void flushAll(true); };
  }, [flushAll]);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // أزرار الفيديو بشريط يسار الصفحة، برا الورقة، حتى ما تغطي شي من السؤال
  const side = marks.length ? SIDE : 0;
  const w = Math.round((boxW - side) * zoom), h = Math.round(w * ratio), step = h + GAP;
  // الصفحة اللي قدامه: اللي تغطي ثلث الشاشة من فوك. تتحدث من يوگف السحب، فالسحب السريع ما يحمل كل الصفحات اللي يمر عليها
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onScroll() {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = stage.current; if (!el) return;
      setPage(Math.min(book.pages, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / step) + 1)));
    }, 180);
  }
  function go(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > book.pages) { setMsg(`⚠️ اكتب رقم صفحة من 1 لحد ${book.pages}`); return; }
    haptic(); setMsg("");
    stage.current?.scrollTo({ top: (n - 1) * step });
    setPage(n);
  }
  // التكبير يبقيه على نفس الصفحة
  const zoomTo = (z: number) => { const n = page; setZoom(z); requestAnimationFrame(() => { const nw = Math.round((boxW - side) * z); stage.current?.scrollTo({ top: (n - 1) * (Math.round(nw * ratio) + GAP) }); }); };
  function back() {
    const u = undo.current.pop(); if (!u) return;
    sheets.current.get(u.n)?.restore(u.prev);
    if (!sheets.current.has(u.n)) go(u.n);
  }
  const pick = (t: Tool, icon: string, tip: string) => <button type="button" title={tip} aria-label={tip} className={"gk-ic" + (tool === t ? " on" : "")} onClick={() => setTool(t)}>{icon}</button>;
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);

  return (
    <div className="nt">
      <div className="ntbar">
        <button type="button" className="gk-btn" onClick={async () => { await flushAll(); saveSpot(page); onClose(page > 1 ? page : bookmark); }}>⬅️ رجوع</button>
        <b className="nttitle">{book.title}</b>
        <small className={pending ? "ntwait" : "ntok"}>{err ? "⚠️" : pending ? "⏳ يحفظ" : "✅ محفوظ"}</small>
      </div>
      <div className="ntbar nttools">
        {pick("hand", "👆", "تحريك الصفحة")}{pick("pen", "✏️", "قلم")}{pick("ruler", "📏", "مسطرة: خط مستقيم")}{pick("mark", "🖍️", "تظليل")}{pick("erase", "🧽", "ممحاة")}{pick("note", "📝", "ملاحظة")}
        <button type="button" className="gk-ic" title="تراجع" aria-label="تراجع" onClick={back}>↶</button>
        <span className="ntgap" />
        <button type="button" className="gk-ic" aria-label="تصغير" disabled={zoom === ZOOMS[0]} onClick={() => zoomTo(ZOOMS[ZOOMS.indexOf(zoom) - 1])}>－</button>
        <button type="button" className="gk-ic" aria-label="تكبير" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => zoomTo(ZOOMS[ZOOMS.indexOf(zoom) + 1])}>＋</button>
      </div>
      {(tool === "pen" || tool === "ruler" || tool === "mark") && (
        <div className="ntbar ntcolors">
          {(tool !== "mark" ? PENS : MARKS).map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + ((tool !== "mark" ? pen : mark) === c ? " on" : "")} style={{ background: c }} onClick={() => (tool !== "mark" ? setPen(c) : setMark(c))} />)}
          {/* 🎨 أي لون يريده */}
          <label className={"gk-dot ntanycolor" + (!(tool !== "mark" ? PENS : MARKS).includes(tool !== "mark" ? pen : mark) ? " on" : "")} title="لون ثاني" aria-label="اختار أي لون" style={{ background: !(tool !== "mark" ? PENS : MARKS).includes(tool !== "mark" ? pen : mark) ? (tool !== "mark" ? pen : mark) : undefined }}>
            <input type="color" value={tool !== "mark" ? pen : mark} onChange={(e) => (tool !== "mark" ? setPen(e.target.value) : setMark(e.target.value))} />
          </label>
        </div>
      )}
      {tool === "note" && <div className="ntbar ntcolors ntnotehint">📝 دوس على المكان اللي تريد بيه الملاحظة</div>}
      <form className="ntbar ntfind" onSubmit={(e) => { e.preventDefault(); go(Number(find)); (document.activeElement as HTMLElement | null)?.blur(); }}>
        <span>صفحة <b>{page}</b> من {book.pages}</span>
        <span className="ntgap" />
        <input inputMode="numeric" aria-label="رقم الصفحة" placeholder="رقم الصفحة" value={find} onChange={(e) => setFind(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <button type="submit" className="gk-btn" disabled={!find}>🔍 روح</button>
      </form>
      {book.kind === "rasid" && (
        <div className="ntbar ntrasid">
          <button type="button" className={"gk-btn" + (sol ? "" : " on")} onClick={() => setSol(0)}>📝 حلي</button>
          <button type="button" className={"gk-btn" + (sol ? " on" : "")} onClick={() => { haptic(); setSol(page); }}>📘 الحل النموذجي</button>
        </div>
      )}
      {!!sol && (
        <div className="ntsol">
          <div className="ntbar ntrasid">
            <button type="button" className="gk-btn" onClick={() => setSol(0)}>📝 حلي</button>
            <button type="button" className="gk-btn on">📘 الحل النموذجي · صفحة {sol}</button>
          </div>
          <img src={pageSrc(book.id, sol) + "&sol=1"} alt="الحل النموذجي" />
        </div>
      )}
      {err && <div className="ntbad">⚠️ {err}</div>}
      {bookmark > 1 && page === 1 && <button type="button" className="ntbookmark" onClick={() => go(bookmark)}>🔖 آخر مرة وصلت لصفحة {bookmark}. دوس هنا حتى تروح لها</button>}
      {msg && <div className="ntmsg" onClick={() => setMsg("")}>{msg}</div>}
      <div className="ntstage" ref={stage} onScroll={onScroll}>
        <div className="ntscroll" style={{ width: w + side, height: book.pages * step - GAP }}>
          {Array.from({ length: book.pages }, (_, i) => i + 1).filter((n) => Math.abs(n - page) <= NEAR).map((n) => (
            <Sheet key={n} n={n} book={book} top={(n - 1) * step} side={side} w={w} h={h} dpr={dpr} tool={tool} color={tool === "mark" ? mark : pen}
              marks={marks.filter((m) => m.page === n)} sending={sending} play={play} onRatio={setRatio} onErr={setErr}
              onPending={(d) => setPending((x) => Math.max(0, x + d))} onUndo={(prev) => { undo.current.push({ n, prev }); if (undo.current.length > 200) undo.current.shift(); }}
              onPlaced={() => setTool("hand")} register={(api) => { if (api) sheets.current.set(n, api); else sheets.current.delete(n); }} />
          ))}
          {Array.from({ length: book.pages }, (_, i) => i + 1).filter((n) => Math.abs(n - page) > NEAR && Math.abs(n - page) <= 40).map((n) => (
            <div key={`p${n}`} className="ntholder" style={{ top: (n - 1) * step, left: side, width: w, height: h }}>{n}</div>
          ))}
        </div>
      </div>
      {yt && <VideoBox title="🎬 فيديو حل السؤال" yt={yt} onClose={() => setYt("")} onFail={(code) => void post({ action: "videoError", book: book.id, kind: "solution", code }).catch(() => undefined)} />}
      {clip && <VideoBox title="▶️ فيديو توضيح السؤال" src={clip} onClose={() => setClip("")} onChat={clipMark ? () => { setClip(""); void play(clipMark, "chat"); } : undefined} onFail={(code) => void post({ action: "videoError", book: book.id, kind: "video", code }).catch(() => undefined)} />}
    </div>
  );
}

const tgPlatform = () => (window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "";
const pageSrc = (book: number, n: number) => `/api/notes/page?t=${encodeURIComponent(token())}&book=${book}&page=${n}&pf=${encodeURIComponent(tgPlatform())}&d=${encodeURIComponent(deviceNow())}`;

/** صفحة وحدة: صورتها، كتابة الطالب فوكها (تنحفظ وحدها)، وأزرار الفيديو يم أسئلتها */
function Sheet({ n, book, top, side, w, h, dpr, tool, color, marks, sending, play, onRatio, onErr, onPending, onUndo, onPlaced, register }: {
  n: number; book: Book; top: number; side: number; w: number; h: number; dpr: number; tool: Tool; color: string; marks: Mark[]; sending: boolean;
  play: (m: Mark, kind: "video" | "solution") => void; onRatio: (r: number) => void; onErr: (e: string) => void;
  onPending: (d: number) => void; onUndo: (prev: Stroke[]) => void; onPlaced: () => void; register: (api: SheetApi | null) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [bad, setBad] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const bg = useRef<HTMLCanvasElement>(null);
  const topC = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes); strokesRef.current = strokes;
  const [notes, setNotes] = useState<Note[]>([]);
  const notesRef = useRef(notes); notesRef.current = notes;
  const [editing, setEditing] = useState(-1);
  const drag = useRef<{ i: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef({ onPending, onErr }); cb.current = { onPending, onErr };

  const flush = useCallback(async (keepalive = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    dirty.current = false;
    try { await post({ action: "save", book: book.id, page: n, ink: JSON.stringify({ items: strokesRef.current, notes: notesRef.current }) }, keepalive); cb.current.onPending(-1); cb.current.onErr(""); }
    catch (e) { dirty.current = true; cb.current.onErr((e as Error).message); }
  }, [book.id, n]);
  function touch() {
    if (!dirty.current) { dirty.current = true; onPending(1); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }
  function change(next: Stroke[], record = true) {
    if (record) onUndo(strokesRef.current);
    strokesRef.current = next; setStrokes(next);
    touch();
  }
  function setNote(i: number, nt: Note | null) {
    const next = nt ? notesRef.current.map((x, k) => (k === i ? nt : x)) : notesRef.current.filter((_, k) => k !== i);
    notesRef.current = next; setNotes(next); touch();
  }
  const changeRef = useRef(change); changeRef.current = change;
  useEffect(() => {
    register({ flush, restore: (s) => changeRef.current(s, false) });
    return () => { register(null); void flush(true); };
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let stop = false;
    const im = new Image();
    im.onload = () => { if (!stop) { setImg(im); if (im.width) onRatio(im.height / im.width); } };
    im.onerror = () => { if (!stop) setBad(true); };
    im.src = pageSrc(book.id, n);
    post({ action: "ink", book: book.id, page: n }).then((j) => { if (!stop && j.ink) { try { const d = JSON.parse(j.ink); const s = d.items ?? []; strokesRef.current = s; setStrokes(s); const ns = Array.isArray(d.notes) ? d.notes : []; notesRef.current = ns; setNotes(ns); } catch { /* بدون كتابة */ } } }).catch(() => undefined);
    return () => { stop = true; };
  }, [book.id, n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = bg.current; if (!c || !img) return;
    c.width = w * dpr; c.height = h * dpr;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  }, [img, w, h, dpr]);
  const redraw = useCallback((list: Stroke[]) => {
    const c = topC.current; if (!c) return;
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, live.current ? [...list, live.current] : list, w, h);
  }, [w, h, dpr]);
  useEffect(() => { const c = topC.current; if (c && img) { c.width = w * dpr; c.height = h * dpr; redraw(strokes); } }, [img, w, h, dpr, strokes, redraw]);

  const pt = (e: React.PointerEvent) => { const r = topC.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)] as const; };
  function erase(x: number, y: number) {
    const next = strokesRef.current.filter((s) => !s.p.some((_, i) => i % 2 === 0 && Math.hypot(s.p[i] - x, s.p[i + 1] - y) < 0.025));
    if (next.length !== strokesRef.current.length) change(next);
  }
  function down(e: React.PointerEvent) {
    if (tool === "hand") return;
    e.preventDefault(); topC.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "erase") { erase(x, y); return; }
    if (tool === "note") {
      // ملاحظة جديدة بمكان الدوسة، وتنفتح للكتابة. بعدها الأداة ترجع لليد حتى يگدر يسحب الملزمة
      const next: Note[] = [...notesRef.current, { x: Math.min(x, 0.6), y: Math.min(y, 0.92), t: "", c: "y", b: "plain" }];
      notesRef.current = next; setNotes(next); setEditing(next.length - 1); onPlaced();
      return;
    }
    // 📏 المسطرة: خط مستقيم من مكان الدوسة لمكان الرفع، بلون القلم
    live.current = tool === "mark" ? { c: color, w: 22, h: 1, p: [x, y] } : tool === "ruler" ? { c: color, w: 2.5, p: [x, y, x, y] } : { c: color, w: 2.5, p: [x, y] };
    redraw(strokesRef.current);
  }
  function move(e: React.PointerEvent) {
    if (tool === "hand" || !(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "erase") { erase(x, y); return; }
    if (live.current && tool === "ruler") { live.current.p.splice(2, 2, x, y); redraw(strokesRef.current); return; }
    if (live.current) { live.current.p.push(x, y); redraw(strokesRef.current); }
  }
  function up() { const s = live.current; if (s) { live.current = null; change([...strokesRef.current, s]); } }

  return (
    <div className="ntsheet" style={{ top, width: w + side, height: h }}>
      <div className="ntpaper" style={{ left: side, width: w, height: h }}>
      {!img && <div className="ntholder ntin">{bad ? "ما انفتحت هاي الصفحة. ارجعلها بعد شوية" : `جاري فتح الصفحة ${n}...`}</div>}
      {img && <canvas ref={bg} style={{ width: w, height: h }} />}
      {img && <canvas ref={topC} style={{ width: w, height: h, touchAction: tool === "hand" ? "auto" : "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; redraw(strokesRef.current); }} />}
      {/* 📝 الملاحظات: تنسحب من أي مكان بيها، ودوسة وحدة تفتحها للتعديل */}
      {img && notes.map((nt, i) => (
        <div key={i} className={`ntnote nt-c-${nt.c ?? "y"} nt-b-${nt.b ?? "plain"}`} style={{ left: `${nt.x * 100}%`, top: `${nt.y * 100}%`, fontSize: Math.max(11, Math.round(w / 30)), width: nt.s?.length ? "40%" : undefined }}
          onPointerDown={(e) => { e.stopPropagation(); drag.current = { i, sx: e.clientX, sy: e.clientY, x: nt.x, y: nt.y, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* السحب يكمل بدونه */ } }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d || d.i !== i) return;
            if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
            d.moved = true;
            const x = Math.max(0, Math.min(0.9, d.x + (e.clientX - d.sx) / w)), y = Math.max(0, Math.min(0.96, d.y + (e.clientY - d.sy) / h));
            const next = notesRef.current.map((q, k) => (k === i ? { ...q, x, y } : q)); notesRef.current = next; setNotes(next);
          }}
          onPointerUp={() => { const d = drag.current; drag.current = null; if (!d) return; if (d.moved) touch(); else setEditing(i); }}
          onPointerCancel={() => { if (drag.current?.moved) touch(); drag.current = null; }}>
          <span className="ntnotemove" aria-hidden>✥</span>
          {nt.t && <div className="ntnotetext" dir="auto">{nt.t}</div>}
          {(nt.s?.length ?? 0) > 0 && <NoteInk strokes={nt.s!} />}
        </div>
      ))}
      {editing >= 0 && notes[editing] && (
        <NoteEditor note={notes[editing]}
          onSave={(nt) => { setNote(editing, nt.t.trim() || nt.s?.length ? nt : null); setEditing(-1); }}
          onDelete={() => { setNote(editing, null); setEditing(-1); }} />
      )}
      <span className="ntno">{n}</span>
      </div>
      {img && marks.map((m) => (
        <div key={m.id} className="ntmark" style={{ top: Math.max(0, m.y * h - 4), width: side }}>
          {m.solution && <button type="button" aria-label="فيديو حل السؤال" disabled={sending} onClick={() => play(m, "solution")}>🎬<small>الحل</small></button>}
          {m.video && <button type="button" aria-label="فيديو توضيح السؤال" disabled={sending} onClick={() => play(m, "video")}>▶️<small>شرح</small></button>}
        </div>
      ))}
    </div>
  );
}

/** كتابة بالقلم جوّا الملاحظة: النقاط من 0 لـ 1 داخل مربع الملاحظة، فتبين نفسها بأي حجم */
function NoteInk({ strokes, onChange, color = NOTE_INKS[0] }: { strokes: Ink[]; onChange?: (s: Ink[]) => void; color?: string }) {
  const c = useRef<HTMLCanvasElement>(null);
  const live = useRef<number[] | null>(null);
  const paint = useCallback(() => {
    const el = c.current; if (!el) return;
    const r = el.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width) { requestAnimationFrame(() => { if (c.current?.getBoundingClientRect().width) paint(); }); return; }
    el.width = r.width * dpr; el.height = r.height * dpr;
    const g = el.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    g.lineWidth = Math.max(1.5, r.width / 110); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of live.current ? [...strokes, { p: live.current, c: color }] : strokes) {
      g.strokeStyle = s.c ?? NOTE_INKS[0];
      g.beginPath();
      for (let k = 0; k < s.p.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, s.p[k] * r.width, s.p[k + 1] * r.height);
      if (s.p.length === 2) g.lineTo(s.p[0] * r.width + 0.5, s.p[1] * r.height);
      g.stroke();
    }
  }, [strokes, color]);
  useEffect(() => { paint(); }, [paint]);
  const at = (e: React.PointerEvent) => { const r = c.current!.getBoundingClientRect(); return [+Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)).toFixed(3), +Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)).toFixed(3)]; };
  if (!onChange) return <canvas ref={c} className="ntnoteink" style={{ aspectRatio: "5 / 3", pointerEvents: "none" }} />;
  return (
    <canvas ref={c} className="ntnoteink ntnotepad" style={{ aspectRatio: "5 / 3" }}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); live.current = at(e); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* يكمل */ } paint(); }}
      onPointerMove={(e) => { if (!live.current) return; live.current.push(...at(e)); paint(); }}
      onPointerUp={() => { const p = live.current; live.current = null; if (p && strokes.length < 150) onChange([...strokes, { p, c: color }]); else paint(); }}
      onPointerCancel={() => { live.current = null; paint(); }} />
  );
}

/** نافذة الملاحظة: يكتب بالكيبورد أو بالقلم، ويختار لون الورقة وأرضيتها */
function NoteEditor({ note, onSave, onDelete }: { note: Note; onSave: (n: Note) => void; onDelete: () => void }) {
  const [d, setD] = useState<Note>(note);
  const [mode, setMode] = useState<"kb" | "pen">(note.s?.length && !note.t ? "pen" : "kb");
  const [ink, setInk] = useState(NOTE_INKS[0]);
  const look = `nt-c-${d.c ?? "y"} nt-b-${d.b ?? "plain"}`;
  return (
    <div className="ntask" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ntaskbox nteditor">
        <b>📝 ملاحظتك</b>
        <span className="ntnotemode">
          <button type="button" className={mode === "kb" ? "on" : ""} onClick={() => setMode("kb")}>⌨️ كيبورد</button>
          <button type="button" className={mode === "pen" ? "on" : ""} onClick={() => setMode("pen")}>✏️ قلم</button>
        </span>
        {mode === "kb" ? (
          <>
            <textarea className={`ntedittext ${look}`} autoFocus dir="auto" maxLength={300} rows={4} value={d.t} placeholder="اكتب ملاحظتك..." onChange={(e) => setD({ ...d, t: e.target.value })} />
            {(d.s?.length ?? 0) > 0 && <div className={`nteditpad ${look}`}><NoteInk strokes={d.s!} /></div>}
          </>
        ) : (
          <>
            {d.t && <div className={`ntnotetext nteditpad ${look}`} dir="auto">{d.t}</div>}
            <div className={`nteditpad ${look}`}><NoteInk strokes={d.s ?? []} color={ink} onChange={(s) => setD({ ...d, s })} /></div>
            <span className="ntnoterow">
              {NOTE_INKS.map((c) => <button type="button" key={c} aria-label="لون القلم" className={"ntswatch" + (ink === c ? " on" : "")} style={{ background: c }} onClick={() => setInk(c)} />)}
              <button type="button" className="ntmini" disabled={!d.s?.length} onClick={() => setD({ ...d, s: (d.s ?? []).slice(0, -1) })}>↶ تراجع</button>
            </span>
          </>
        )}
        <small>لون الورقة</small>
        <span className="ntnoterow">
          {NOTE_COLORS.map(([k, name]) => <button type="button" key={k} title={name} aria-label={name} className={`ntswatch nt-c-${k}` + ((d.c ?? "y") === k ? " on" : "")} onClick={() => setD({ ...d, c: k })} />)}
        </span>
        <small>الأرضية</small>
        <span className="ntnoterow">
          {NOTE_BGS.map(([k, icon, name]) => <button type="button" key={k} title={name} className={`ntbgpick nt-c-${d.c ?? "y"} nt-b-${k}` + ((d.b ?? "plain") === k ? " on" : "")} onClick={() => setD({ ...d, b: k })}>{icon}<small>{name}</small></button>)}
        </span>
        <span className="ntnotebtns">
          <button type="button" className="ntsave" onClick={() => onSave(d)}>✓ احفظ</button>
          <button type="button" onClick={onDelete}>🗑 امسحها</button>
        </span>
      </div>
    </div>
  );
}

// ---------- الفيديو يشتغل فوك الملزمة: فيديو الحل من يوتيوب (أزراره ما تنداس، فلا رابط ولا "شوفه على يوتيوب")، والفيديو التوضيحي من البوت. التحكم من أزرارنا
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

/** يشغل جوّا الملزمة: فيديو الحل من يوتيوب (yt) أو الفيديو التوضيحي من البوت (src)، بنفس الأزرار */
type Ctl = { play(): void; pause(): void; seek(s: number): void; time(): number; dur(): number; rate(r: number): void };
function VideoBox({ title, yt, src, onClose, onFail, onChat }: { title: string; yt?: string; src?: string; onClose: () => void; onFail: (code: string) => void; onChat?: () => void }) {
  // إذا ما اشتغل: رمز الخطأ يطلع للطالب وينكتب بسجل البوت، حتى نعرف السبب
  const fail = (code: string) => { setErr(`هذا الفيديو ما يشتغل هسه (رمز ${code}). بلغ الأستاذ`); onFail(code); };
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const c = useRef<Ctl | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    let stop = false;
    let yp: YtP | null = null;
    if (yt) {
      loadYt().then((YT) => {
        if (stop || !slot.current) return;
        yp = new YT.Player(slot.current, {
          host: "https://www.youtube-nocookie.com", videoId: yt, width: "100%", height: "100%",
          playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, autoplay: 1, origin: location.origin },
          events: {
            onReady: () => {
              if (stop || !yp) return;
              const x = yp;
              c.current = { play: () => x.playVideo(), pause: () => x.pauseVideo(), seek: (s) => x.seekTo(s, true), time: () => x.getCurrentTime(), dur: () => x.getDuration(), rate: (r) => x.setPlaybackRate(r) };
              setReady(true); setD(x.getDuration()); x.playVideo();
            },
            onStateChange: (e: { data: number }) => { if (!stop) { setOn(e.data === 1 || e.data === 3); if (e.data === 0 && yp) setT(yp.getDuration()); } },
            onError: (e: { data: number }) => { if (!stop) fail(`yt${e.data}`); },
          },
        });
      }).catch((e) => { if (!stop) setErr((e as Error).message); });
    } else if (vid.current) {
      const v = vid.current;
      c.current = { play: () => void v.play().catch(() => undefined), pause: () => v.pause(), seek: (s) => { v.currentTime = s; }, time: () => v.currentTime, dur: () => (Number.isFinite(v.duration) ? v.duration : 0), rate: (r) => { v.playbackRate = r; } };
    }
    const tick = setInterval(() => { const x = c.current; if (x) { setT(x.time()); const du = x.dur(); if (du) setD(du); } }, 500);
    return () => { stop = true; clearInterval(tick); try { yp?.destroy(); } catch { /* انسد */ } c.current = null; };
  }, [yt, src]);
  const toggle = () => { haptic(); const x = c.current; if (!x || !ready) return; if (on) x.pause(); else x.play(); };
  const jump = (s: number) => { const x = c.current; if (!x) return; const n = Math.max(0, Math.min(d || 0, x.time() + s)); x.seek(n); setT(n); };
  const full = () => { const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined); else el.webkitRequestFullscreen?.(); };
  return (
    <div className="ntyt" ref={box} onContextMenu={(e) => e.preventDefault()}>
      <div className="ntytbar">
        <b>{title}</b>
        <button type="button" className="gk-btn" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); onClose(); }}>✖ سد وارجع للملزمة</button>
      </div>
      <div className="ntytbox">
        {yt && <div className="ntytframe"><div ref={slot} /></div>}
        {src && (
          <video ref={vid} className="ntytvideo" src={src} autoPlay playsInline disablePictureInPicture controlsList="nodownload noplaybackrate noremoteplayback"
            onLoadedMetadata={(e) => { setReady(true); setD(e.currentTarget.duration || 0); e.currentTarget.playbackRate = speed; }}
            onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => setOn(false)}
            onError={(e) => { const er = e.currentTarget.error; fail(`v${er?.code ?? 0}${er?.message ? ` ${er.message.slice(0, 60)}` : ""}`); }} />
        )}
        {/* غطا شفاف: ما يگدر يدوس على الفيديو نفسه (لا رابط ولا حفظ). دوسة وحدة توقف أو تشغل */}
        <div className="ntytcover" onClick={toggle} />
        {err && <div className="ntytmsg">⚠️ {err}{onChat && <><br /><button type="button" className="btn ntytchat" onClick={onChat}>📩 دزه إلي بالمحادثة</button></>}</div>}
        {!ready && !err && <div className="ntytmsg">جاري فتح الفيديو...</div>}
      </div>
      <div className="ntytctl">
        <button type="button" className="gk-ic" aria-label={on ? "وقف" : "شغل"} disabled={!ready} onClick={toggle}>{on ? "⏸" : "▶️"}</button>
        <button type="button" className="gk-ic" aria-label="ارجع 10 ثواني" disabled={!ready} onClick={() => jump(-10)}>↻10</button>
        <button type="button" className="gk-ic" aria-label="قدم 10 ثواني" disabled={!ready} onClick={() => jump(10)}>10↺</button>
        <input type="range" dir="ltr" aria-label="مكان الفيديو" min={0} max={Math.max(1, Math.floor(d))} step={1} value={Math.floor(t)} disabled={!ready} onChange={(e) => { const n = Number(e.target.value); setT(n); c.current?.seek(n); }} />
        <small dir="ltr">{clock(t)} / {clock(d)}</small>
        <select aria-label="السرعة" dir="ltr" disabled={!ready} value={speed} onChange={(e) => { const n = Number(e.target.value); setSpeed(n); c.current?.rate(n); }}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s === 1 ? "1x عادي" : `${s}x ${s < 1 ? "أبطأ" : "أسرع"}`}</option>)}
        </select>
        <button type="button" className="gk-ic" aria-label="ملء الشاشة" onClick={full}>⛶</button>
      </div>
    </div>
  );
}
