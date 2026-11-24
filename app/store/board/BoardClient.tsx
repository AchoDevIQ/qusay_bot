"use client";
// 📝 سبورة قصي العميري (طلبه 2026-11-25، BOARD_SPEC.md): نفس سبورة الويندوز، بالتطبيق، عند الأستاذ وعند الطالب بنفس الخيارات.
// الكف يمسح (التماس أكبر من الحد)، والقلم بالآيباد يكتب واليد ما تكتب وهو نازل. كل الكتابة والأزرار بالعربي
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOARDS, DEFAULT_BOARD, DEFAULT_FRAME, ERASERS, FRAMES, H, QUICK, SHAPES, SOLIDS, WIDTHS, cleanLesson, emptyLesson, eraseAlong, hlWidth, insetOf, isLight, isPalm, palette, shapeStrokes, type InkStroke, type Item, type Lesson } from "../../../lib/board/engine.ts";
import { pageToken } from "../adminPage";
import { pdfClient } from "../pdfClient";
import { drawItem, drawPage, framePreview, paintFrame, textLines } from "./boardDraw";
import { IC } from "./icons";

type Tool = "pen" | "hl" | "eraser" | "shape";
type Step = { add: Item[]; remove: Item[] };
type Contact = { mode: "ink" | "erase" | "shape" | "ignore"; stroke?: InkStroke; start: [number, number]; last: [number, number]; size: number; pen: boolean };
type Meta = { id: string; title: string; at: string; pages: number; chapter?: number };
type State = { teacher: boolean; name: string; lessons: Meta[]; inbox: Meta[]; sent: Meta[] };
type Pop = "" | "menu" | "colors" | "eraser" | "shapes" | "solids" | "board" | "open" | "inbox" | "settings";
type Ask = { text: string; buttons: { t: string; kind: "ok" | "bad" | "gray"; run: () => void }[]; input?: { value: string; set: (v: string) => void } } | null;

const BAR = 74;                       // ارتفاع شريط الأدوات (بكسل الشاشة)
const PAL = palette();
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
const SET_KEY = "qboard_settings", DRAFT_KEY = "qboard_draft";
type Settings = { board: string; frame: string; palm: number; eraser: number; width: number };
const tablet = () => typeof window !== "undefined" && Math.max(window.screen.width, window.screen.height) < 1400;
const loadSettings = (): Settings => {
  const d: Settings = { board: DEFAULT_BOARD, frame: DEFAULT_FRAME, palm: tablet() ? 70 : 200, eraser: 80, width: 5 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SET_KEY) ?? "{}") }; } catch { return d; }
};

async function api(body: Record<string, unknown>) {
  const res = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: pageToken(), ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "صار خطأ");
  return j;
}
async function upload(blob: Blob): Promise<string> {
  const f = new FormData();
  f.set("t", pageToken()); f.set("file", blob, "bg.jpg");
  const res = await fetch("/api/board", { method: "POST", body: f });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "ما انرفعت الصورة");
  return String(j.ref);
}
const bgUrl = (ref: string) => `/api/board/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(pageToken())}`;
const canvasBlob = (c: HTMLCanvasElement, q = 0.86) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("ما گدرت أسوي الصورة"))), "image/jpeg", q));

export default function BoardClient() {
  // ---------- القياس: الارتفاع 1080 وحدة، والعرض حسب الشاشة
  const wrap = useRef<HTMLDivElement>(null);
  const frameC = useRef<HTMLCanvasElement>(null), inkC = useRef<HTMLCanvasElement>(null), liveC = useRef<HTMLCanvasElement>(null);
  const geo = useRef({ cssW: 0, cssH: 0, scale: 1, W: 1920, dpr: 1 });
  const [W, setW] = useState(1920);
  // ---------- الدرس
  const lesson = useRef<Lesson>(emptyLesson(1920));
  const pageIx = useRef(0);
  const undo = useRef<Step[][]>([[]]), redo = useRef<Step[][]>([[]]);
  const pending = useRef<Step | null>(null);
  const contacts = useRef(new Map<number, Contact>());
  const penDown = useRef(0);
  const imgs = useRef(new Map<string, HTMLImageElement>());
  const logo = useRef<HTMLImageElement | null>(null);
  const [pageInfo, setPageInfo] = useState({ i: 0, n: 1 });
  const [dirty, setDirty] = useState(false);
  const [lessonId, setLessonId] = useState("");
  const [title, setTitle] = useState("");
  // ---------- الأدوات
  const [tool, setTool] = useState<Tool>("pen");
  const [shape, setShape] = useState("line");
  const [color, setColor] = useState("#FFFFFF");
  const [set, setSet] = useState<Settings>(() => ({ board: DEFAULT_BOARD, frame: DEFAULT_FRAME, palm: 200, eraser: 80, width: 5 }));
  const [pop, setPop] = useState<Pop>("");
  const [popAt, setPopAt] = useState(0);
  const [ask, setAsk] = useState<Ask>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [splash, setSplash] = useState(true);
  const [st, setSt] = useState<State | null>(null);
  const [lastTouch, setLastTouch] = useState("-");
  const [mic, setMic] = useState(false);
  const pendingText = useRef<{ t: string; s: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const toolRef = useRef({ tool, shape, color, set });
  toolRef.current = { tool, shape, color, set };

  const page = () => lesson.current.pages[pageIx.current];
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3200); };
  const markDirty = () => setDirty(true);

  // ---------- الرسم
  const bgOf = useCallback((ref?: string | null) => {
    if (!ref) return null;
    let im = imgs.current.get(ref);
    if (!im) {
      im = new Image();
      im.onload = () => redrawInk();
      im.src = ref.startsWith("data:") || ref.startsWith("blob:") ? ref : bgUrl(ref);
      imgs.current.set(ref, im);
    }
    return im;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ctxOf = (c: HTMLCanvasElement | null) => {
    if (!c) return null;
    const x = c.getContext("2d")!;
    const g = geo.current;
    x.setTransform(g.dpr * g.scale, 0, 0, g.dpr * g.scale, 0, 0);
    return x;
  };
  const redrawFrame = useCallback(() => {
    const x = ctxOf(frameC.current);
    if (x) paintFrame(x, geo.current.W, lesson.current.board, lesson.current.frame, logo.current);
  }, []);
  const redrawInk = useCallback(() => {
    const x = ctxOf(inkC.current);
    if (!x) return;
    x.clearRect(0, 0, geo.current.W, H);
    drawPage(x, geo.current.W, lesson.current.frame, page().items, bgOf(page().bg));
  }, [bgOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const inkQueued = useRef(false);
  const queueInk = () => { if (inkQueued.current) return; inkQueued.current = true; requestAnimationFrame(() => { inkQueued.current = false; redrawInk(); }); };
  const eraserMark = useRef<{ x: number; y: number; s: number } | null>(null);
  const liveQueued = useRef(false);
  const redrawLive = () => {
    if (liveQueued.current) return;
    liveQueued.current = true;
    requestAnimationFrame(() => {
      liveQueued.current = false;
      const x = ctxOf(liveC.current);
      if (!x) return;
      x.clearRect(0, 0, geo.current.W, H);
      const F = insetOf(lesson.current.frame);
      x.save(); x.beginPath(); x.rect(F, F, geo.current.W - 2 * F, H - 2 * F); x.clip();
      for (const c of contacts.current.values()) if (c.stroke) drawItem(x, c.stroke);
      for (const c of contacts.current.values()) if (c.mode === "shape") for (const s of shapeStrokes(toolRef.current.shape, c.start, c.last, toolRef.current.color, toolRef.current.set.width)) drawItem(x, s);
      const m = eraserMark.current;
      if (m) {
        x.fillStyle = "rgba(255,255,255,0.24)"; x.strokeStyle = "rgba(255,255,255,0.86)"; x.lineWidth = 3;
        x.beginPath(); x.roundRect(m.x - m.s / 2, m.y - m.s / 2, m.s, m.s, 12); x.fill(); x.stroke();
      }
      x.restore();
    });
  };

  // ---------- القياس من جديد لما الشاشة تتغير
  const layout = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const cssW = el.clientWidth, cssH = el.clientHeight;
    // الصفحة بعدها ما انرسمت: نعيد بالإطار الجاي
    if (cssW < 50 || cssH < 50) { requestAnimationFrame(() => layout()); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = cssH / H, Wn = Math.round(cssW / scale);
    geo.current = { cssW, cssH, scale, W: Wn, dpr };
    for (const c of [frameC.current, inkC.current, liveC.current]) if (c) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    if (lesson.current.w !== Wn) fitLesson(lesson.current, Wn);
    setW(Wn);
    redrawFrame(); redrawInk(); redrawLive();
  }, [redrawFrame, redrawInk]); // eslint-disable-line react-hooks/exhaustive-deps

  /** درس مسوّى على شاشة بعرض ثاني: الكتابة تتصغر وتتوسط حتى تبين كلها */
  function fitLesson(l: Lesson, Wn: number) {
    if (l.w === Wn) return;
    const s = Math.min(1, Wn / l.w), dx = (Wn - l.w * s) / 2, dy = (H - H * s) / 2;
    for (const pg of l.pages) for (const it of pg.items) {
      if (it.k === "text") { it.x = it.x * s + dx; it.y = it.y * s + dy; it.s *= s; it.bw *= s; it.bh *= s; }
      else { it.w *= s; for (let i = 0; i < it.p.length; i += 2) { it.p[i] = it.p[i] * s + dx; it.p[i + 1] = it.p[i + 1] * s + dy; } }
    }
    l.w = Wn;
  }

  // ---------- البداية
  useEffect(() => {
    const s = loadSettings();
    setSet(s);
    lesson.current.board = s.board; lesson.current.frame = s.frame;
    setColor(isLight(s.board) ? "#000000" : "#FFFFFF");
    const im = new Image(); im.onload = () => { logo.current = im; redrawFrame(); }; im.src = "/app-logo.png";
    // مسودة ما انحفظت (التطبيق انسد فجأة)
    try { const d = cleanLesson(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null")); if (d && d.pages.some((p) => p.items.length || p.bg)) { lesson.current = d; undo.current = d.pages.map(() => []); redo.current = d.pages.map(() => []); setDirty(true); } } catch { /* */ }
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    // حجم السبورة تغير (تدوير التابلت، ملء الشاشة): نعيد القياس
    const ro = typeof ResizeObserver !== "undefined" && wrap.current ? new ResizeObserver(() => layout()) : null;
    if (ro && wrap.current) ro.observe(wrap.current);
    const t = window.setTimeout(() => setSplash(false), 1700);
    void api({ action: "state" }).then((r: State) => {
      setSt(r);
      const inbox = new URLSearchParams(location.search).get("inbox");
      if (inbox) void openInbox(inbox);
    }).catch((e) => say(`صار خطأ: ${(e as Error).message}`));
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); window.clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // الإعدادات تنحفظ بالجهاز
  useEffect(() => { try { localStorage.setItem(SET_KEY, JSON.stringify(set)); } catch { /* */ } }, [set]);
  // مسودة بالجهاز كل شوية (إذا انسد التطبيق ما يروح الشرح)
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(lesson.current)); } catch { /* كبير، يبقى بس بالسيرفر */ } }, 1500);
    return () => window.clearTimeout(t);
  });
  const sync = () => { setPageInfo({ i: pageIx.current, n: lesson.current.pages.length }); };

  // ---------- التراجع: كل حركة (لحد ما ترتفع آخر إصبع) خطوة وحدة
  const stepOf = () => (pending.current ??= { add: [], remove: [] });
  const noteAdd = (it: Item) => stepOf().add.push(it);
  const noteRemove = (it: Item) => { const s = stepOf(); const k = s.add.indexOf(it); if (k >= 0) s.add.splice(k, 1); else s.remove.push(it); };
  const commit = () => {
    const s = pending.current;
    pending.current = null;
    if (!s || (!s.add.length && !s.remove.length)) return;
    undo.current[pageIx.current].push(s);
    redo.current[pageIx.current] = [];
    markDirty();
  };
  const apply = (add: Item[], remove: Item[]) => {
    const items = page().items.filter((x) => !remove.includes(x));
    items.push(...add.filter((x) => !items.includes(x)));
    page().items = items;
    markDirty(); redrawInk();
  };
  const doUndo = () => { if (contacts.current.size) return; const s = undo.current[pageIx.current].pop(); if (!s) return; apply(s.remove, s.add); redo.current[pageIx.current].push(s); };
  const doRedo = () => { if (contacts.current.size) return; const s = redo.current[pageIx.current].pop(); if (!s) return; apply(s.add, s.remove); undo.current[pageIx.current].push(s); };
  const clearAll = () => {
    if (!page().items.length) return;
    pending.current = { add: [], remove: [...page().items] };
    page().items = [];
    commit(); redrawInk();
  };

  // ---------- اللمس والقلم والماوس
  const toBoard = (e: React.PointerEvent): [number, number] => {
    const r = liveC.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / geo.current.scale, (e.clientY - r.top) / geo.current.scale];
  };
  const sizeOf = (e: React.PointerEvent) => [Math.max(e.width || 1, 1) / geo.current.scale, Math.max(e.height || 1, 1) / geo.current.scale];
  const startErase = (c: Contact, p: [number, number], palm: boolean) => {
    c.mode = "erase"; c.stroke = undefined;
    c.size = palm ? toolRef.current.set.eraser * 2 : toolRef.current.set.eraser;
    eraseAt(c, p, p);
  };
  const eraseAt = (c: Contact, a: [number, number], b: [number, number]) => {
    const r = eraseAlong(page().items, a, b, c.size);
    if (r.removed.length) { page().items = r.items; for (const x of r.removed) noteRemove(x); for (const x of r.added) noteAdd(x); queueInk(); }
    eraserMark.current = { x: b[0], y: b[1], s: c.size };
    redrawLive();
  };
  const onDown = (e: React.PointerEvent) => {
    if (pop) { setPop(""); return; }
    const pen = e.pointerType === "pen";
    // القلم نازل: اليد اللي على الشاشة ما تكتب
    if (e.pointerType === "touch" && penDown.current > 0) return;
    try { liveC.current!.setPointerCapture(e.pointerId); } catch { /* */ }
    if (pen) penDown.current++;
    const p = toBoard(e), [sw, sh] = sizeOf(e);
    const { tool: t, color: col, set: s } = toolRef.current;
    const palm = !pen && e.pointerType === "touch" && isPalm(sw, sh, s.palm);
    const force = e.button === 2 || e.button === 5 || (e.buttons & 32) === 32;
    const c: Contact = { mode: "ink", start: p, last: p, size: 0, pen };
    contacts.current.set(e.pointerId, c);
    track(sw, sh, true);
    // نص المايك: الدوسة الجاية تحطه (فوك يمين = بداية السطر العربي)
    if (pendingText.current && !force && !palm) {
      const x = ctxOf(liveC.current)!;
      const pt = pendingText.current; pendingText.current = null; setPlacing(false);
      const lay = textLines(x, pt.t, pt.s, p[0]);
      const it: Item = { k: "text", c: col, s: pt.s, x: p[0], y: p[1], t: pt.t, bw: lay.w, bh: lay.h };
      page().items.push(it); noteAdd(it); c.mode = "ignore"; redrawInk();
      return;
    }
    if (force || t === "eraser" || palm) { startErase(c, p, palm); return; }
    if (t === "shape") { c.mode = "shape"; return; }
    c.stroke = { k: t === "hl" ? "hl" : "ink", c: col, w: t === "hl" ? hlWidth(s.width) : s.width, p: [p[0], p[1]] };
    redrawLive();
  };
  const maxT = useRef([0, 0]);
  const track = (w: number, h: number, reset = false) => { if (reset) maxT.current = [0, 0]; maxT.current = [Math.max(maxT.current[0], w), Math.max(maxT.current[1], h)]; };
  const onMove = (e: React.PointerEvent) => {
    const c = contacts.current.get(e.pointerId);
    if (!c) return;
    const [sw, sh] = sizeOf(e);
    track(sw, sh);
    if (c.mode === "ignore") return;
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const pts: [number, number][] = events.length ? events.map((ev) => { const r = liveC.current!.getBoundingClientRect(); return [(ev.clientX - r.left) / geo.current.scale, (ev.clientY - r.top) / geo.current.scale] as [number, number]; }) : [toBoard(e)];
    // كف نازل شوية شوية: يبدي صغير ويكبر. الخط اللي بداه ينشال ويصير ممحاة
    if (c.mode !== "erase" && !c.pen && e.pointerType === "touch" && isPalm(sw, sh, toolRef.current.set.palm)) {
      startErase(c, pts[pts.length - 1], true);
      c.last = pts[pts.length - 1];
      return;
    }
    for (const p of pts) {
      if (c.mode === "erase") eraseAt(c, c.last, p);
      else if (c.stroke) { if (Math.hypot(p[0] - c.last[0], p[1] - c.last[1]) < 0.8) continue; c.stroke.p.push(p[0], p[1]); }
      c.last = p;
    }
    redrawLive();
  };
  const onUp = (e: React.PointerEvent) => {
    const c = contacts.current.get(e.pointerId);
    if (e.pointerType === "pen" && penDown.current > 0) penDown.current--;
    if (!c) return;
    contacts.current.delete(e.pointerId);
    setLastTouch(`${Math.round(maxT.current[0])} × ${Math.round(maxT.current[1])}`);
    if (c.stroke) {
      if (c.stroke.p.length === 2) c.stroke.p.push(c.stroke.p[0] + 0.5, c.stroke.p[1] + 0.5);
      page().items.push(c.stroke); noteAdd(c.stroke);
    } else if (c.mode === "shape") {
      const { shape: k, color: col, set: s } = toolRef.current;
      for (const x of shapeStrokes(k, c.start, c.last, col, s.width)) { page().items.push(x); noteAdd(x); }
    }
    if (![...contacts.current.values()].some((x) => x.mode === "erase")) eraserMark.current = null;
    if (!contacts.current.size) commit();
    redrawInk(); redrawLive();
  };

  // ---------- الصفحات
  const goTo = (i: number) => {
    if (i < 0 || i >= lesson.current.pages.length || contacts.current.size) return;
    pageIx.current = i; sync(); redrawInk();
  };
  const addPage = (bg: string | null = null, at = pageIx.current + 1) => {
    lesson.current.pages.splice(at, 0, { items: [], bg });
    undo.current.splice(at, 0, []); redo.current.splice(at, 0, []);
    markDirty(); pageIx.current = at; sync(); redrawInk();
  };
  const deletePage = () => {
    const l = lesson.current;
    if (l.pages.length === 1) { l.pages[0] = { items: [] }; undo.current = [[]]; redo.current = [[]]; }
    else { l.pages.splice(pageIx.current, 1); undo.current.splice(pageIx.current, 1); redo.current.splice(pageIx.current, 1); pageIx.current = Math.min(pageIx.current, l.pages.length - 1); }
    markDirty(); sync(); redrawInk();
  };
  const isBlank = () => lesson.current.pages.length === 1 && !lesson.current.pages[0].items.length && !lesson.current.pages[0].bg;
  const loadLesson = (l: Lesson, id: string, t: string) => {
    fitLesson(l, geo.current.W);
    lesson.current = l; pageIx.current = 0;
    undo.current = l.pages.map(() => []); redo.current = l.pages.map(() => []);
    setLessonId(id); setTitle(t); setDirty(false);
    setSet((s) => ({ ...s, board: l.board, frame: l.frame }));
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
    sync(); redrawFrame(); redrawInk();
  };
  /** قبل ما يروح الشرح المفتوح: تريد تحفظه؟ */
  const guard = (then: () => void) => {
    if (!dirty || isBlank()) { then(); return; }
    setAsk({ text: "تريد تحفظ الشرح قبل؟", buttons: [
      { t: "احفظ", kind: "ok", run: () => saveDialog(then) },
      { t: "لا تحفظ", kind: "bad", run: () => { setAsk(null); then(); } },
      { t: "رجوع", kind: "gray", run: () => setAsk(null) },
    ] });
  };
  const newLesson = () => guard(() => loadLesson(emptyLesson(geo.current.W, set.board, set.frame), "", ""));

  // ---------- الحفظ والفتح
  async function save(name: string, after?: () => void) {
    setBusy("جاري الحفظ...");
    try {
      const l = { ...lesson.current, title: name };
      // الخلفيات اللي بعدها بالجهاز بس (blob/data) لازم ترتفع أول
      for (const pg of l.pages) if (pg.bg && (pg.bg.startsWith("blob:") || pg.bg.startsWith("data:"))) { const b = await (await fetch(pg.bg)).blob(); const ref = await upload(b); imgs.current.set(ref, imgs.current.get(pg.bg)!); pg.bg = ref; }
      const r = await api({ action: "save", id: lessonId, title: name, lesson: l });
      setLessonId(r.id); setTitle(name); setSt(r); setDirty(false);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
      say(r.notice ?? "✅ انحفظ");
      after?.();
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  const saveDialog = (after?: () => void) => {
    let v = title;
    setAsk({ text: "اسم الشرح", input: { value: v, set: (x) => { v = x; } }, buttons: [
      { t: "احفظ", kind: "ok", run: () => { setAsk(null); void save(v.trim() || title || "شرح", after); } },
      { t: "رجوع", kind: "gray", run: () => setAsk(null) },
    ] });
  };
  async function openSaved(id: string) {
    setPop(""); setBusy("جاري فتح الملف...");
    try { const r = await api({ action: "get", id }); const m = st?.lessons.find((x) => x.id === id); loadLesson(cleanLesson(r.lesson)!, id, m?.title ?? ""); } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  async function openInbox(id: string) {
    setPop(""); setBusy("جاري فتح الملف...");
    try {
      const r = await api({ action: "inbox", id });
      const l = cleanLesson(r.lesson)!;
      // نسخة الطالب: شرح جديد إله، وشرح الأستاذ ما يتغير
      loadLesson(l, "", l.title ?? "شرح الأستاذ");
      setDirty(true);
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  const delSaved = (m: Meta) => setAsk({ text: `تحذف «${m.title}»؟`, buttons: [
    { t: "احذف", kind: "bad", run: () => { setAsk(null); void api({ action: "del", id: m.id }).then((r) => { setSt(r); if (m.id === lessonId) setLessonId(""); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)); } },
    { t: "رجوع", kind: "gray", run: () => setAsk(null) },
  ] });

  // ---------- PDF والصور
  const pdfInput = useRef<HTMLInputElement>(null), imgInput = useRef<HTMLInputElement>(null);
  async function openPdf(file: File) {
    setBusy("جاري فتح الملف...");
    try {
      const pdfjs = await pdfClient();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
      const F = insetOf(lesson.current.frame);
      const target = (H - 2 * F) * geo.current.scale * geo.current.dpr * 1.5;
      let first = isBlank();
      for (let i = 1; i <= doc.numPages; i++) {
        setBusy(`جاري فتح الملف... ${i} من ${doc.numPages}`);
        const pg = await doc.getPage(i);
        const v1 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: Math.min(4, target / v1.height) });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvas: c, viewport: vp }).promise;
        const url = URL.createObjectURL(await canvasBlob(c));
        if (first) { page().bg = url; first = false; markDirty(); }
        else addPage(url, lesson.current.pages.length);
      }
      if (lesson.current.pages.length) goTo(lesson.current.pages.length - doc.numPages >= 0 ? Math.max(0, lesson.current.pages.length - doc.numPages) : 0);
      redrawInk();
    } catch (e) { say(`ما گدرت أفتح ملف الـ PDF: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  async function insertImage(file: File) {
    setBusy("جاري فتح الملف...");
    try {
      const im = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("الصورة ما تنفتح")); i.src = URL.createObjectURL(file); });
      const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      page().bg = URL.createObjectURL(await canvasBlob(c));
      markDirty(); redrawInk();
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }

  // ---------- الطباعة: كل الصفحات بإطارها وخلفيتها
  async function printAll() {
    setBusy("جاري تحضير الطباعة...");
    try {
      const Wn = geo.current.W, k = 1.25;
      const urls: string[] = [];
      for (const pg of lesson.current.pages) {
        const c = document.createElement("canvas"); c.width = Math.round(Wn * k); c.height = Math.round(H * k);
        const x = c.getContext("2d")!; x.scale(k, k);
        paintFrame(x, Wn, lesson.current.board, lesson.current.frame, logo.current);
        const bg = bgOf(pg.bg);
        if (bg && !bg.complete) await new Promise((r) => { bg.onload = r; bg.onerror = r; });
        drawPage(x, Wn, lesson.current.frame, pg.items, bg);
        urls.push(c.toDataURL("image/jpeg", 0.9));
      }
      const w = window.open("", "_blank");
      if (!w) { say("المتصفح منع نافذة الطباعة"); return; }
      w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${title || "شرح"}</title><style>@page{size:landscape;margin:0}body{margin:0}img{width:100%;display:block;page-break-after:always}</style></head><body>${urls.map((u) => `<img src="${u}">`).join("")}<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
      w.document.close();
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }

  // ---------- إرسال للطلاب (الأستاذ): يختار الفصل، ويسأله تريد تدزه؟
  const sendDialog = () => {
    setPop("");
    if (!lessonId || dirty) { setAsk({ text: "احفظ الشرح أول حتى تدزه", buttons: [{ t: "احفظ", kind: "ok", run: () => saveDialog(() => window.setTimeout(sendDialog, 50)) }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] }); return; }
    setAsk({ text: "لطلاب محاضرات أي فصل؟", buttons: [
      ...[1, 2, 3, 4, 5].map((ch) => ({ t: `الفصل ${ORD[ch]}`, kind: "gray" as const, run: () => void confirmSend(ch) })),
      { t: "رجوع", kind: "gray", run: () => setAsk(null) },
    ] });
  };
  async function confirmSend(ch: number) {
    setAsk(null); setBusy("لحظة...");
    try {
      const { count } = await api({ action: "count", chapter: ch });
      setBusy("");
      if (!count) { say(`ماكو طلاب اشتروا محاضرات الفصل ${ORD[ch]}`); return; }
      setAsk({ text: `تريد أدز «${title}» لـ ${count} طالب اشتروا محاضرات الفصل ${ORD[ch]}؟`, buttons: [
        { t: "إي، دزه", kind: "ok", run: () => { setAsk(null); setBusy("جاري الإرسال..."); void api({ action: "send", id: lessonId, chapter: ch }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); } },
        { t: "لا", kind: "bad", run: () => setAsk(null) },
      ] });
    } catch (e) { setBusy(""); say(`صار خطأ: ${(e as Error).message}`); }
  }

  // ---------- المايك
  const exit = () => guard(() => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } setDirty(false); if (history.length > 1) history.back(); else window.close(); });
  const fullScreen = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } catch { /* */ } };

  // ---------- الكيبورد
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (ask || mic || (e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const c = e.ctrlKey || e.metaKey;
      if (c && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      else if (c && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
      else if (c && e.key.toLowerCase() === "s") { e.preventDefault(); saveDialog(); }
      else if (c && e.key.toLowerCase() === "o") { e.preventDefault(); setPop("open"); }
      else if (e.key === "ArrowLeft" || e.key === "PageDown") goTo(pageIx.current + 1);
      else if (e.key === "ArrowRight" || e.key === "PageUp") goTo(pageIx.current - 1);
      else if (e.key === "F11") { e.preventDefault(); fullScreen(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // ---------- تغيير لون السبورة والإطار
  const setBoard = (c: string) => {
    lesson.current.board = c; setSet((s) => ({ ...s, board: c })); markDirty();
    // القلم الأبيض على سبورة بيضة يصير أسود، والعكس
    if (isLight(c) && color.toUpperCase() === "#FFFFFF") setColor("#000000");
    if (!isLight(c) && color.toUpperCase() === "#000000") setColor("#FFFFFF");
    redrawFrame();
  };
  const setFrame = (f: string) => { lesson.current.frame = f; setSet((s) => ({ ...s, frame: f })); markDirty(); redrawFrame(); redrawInk(); };
  const pickColor = (c: string) => { setColor(c); if (tool === "eraser" || tool === "shape") setTool("pen"); setPop(""); };
  const open = (p: Pop, el: HTMLElement) => { const r = el.getBoundingClientRect(); setPopAt(Math.max(8, Math.min(window.innerWidth - 8, r.left + r.width / 2))); setPop((x) => (x === p ? "" : p)); };

  const Btn = ({ id, icon, t, on, run, dis }: { id?: Pop; icon: React.ReactNode; t: string; on?: boolean; run: (el: HTMLElement) => void; dis?: boolean }) => (
    <button type="button" className={`qb-btn${on ? " on" : ""}`} disabled={dis} data-pop={id} onClick={(e) => run(e.currentTarget)}>
      <span className="qb-ic">{icon}</span><span className="qb-t">{t}</span>
    </button>
  );
  // القائمة تطلع فوك زرها، بس ما تطلع برا الشاشة
  const popEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = popEl.current;
    if (!el) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, popAt - w / 2))}px`;
  });
  const frames = FRAMES;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => { if (pop === "board" && !Object.keys(previews).length) setPreviews(Object.fromEntries(frames.map((f) => [f.id, framePreview(f.id)]))); }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qb" dir="rtl" onContextMenu={(e) => e.preventDefault()}>
      <style>{CSS}</style>
      <div className="qb-area" ref={wrap}>
        <canvas ref={frameC} className="qb-c" />
        <canvas ref={inkC} className="qb-c" />
        <canvas ref={liveC} className="qb-c qb-live" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp} />
        {placing && <div className="qb-hint">دوس على السبورة بالمكان اللي تريد تبدي منه الكتابة</div>}
      </div>

      <div className="qb-bar">
        <div className="qb-grp">
          <Btn id="menu" icon={IC.menu} t="القائمة" on={pop === "menu"} run={(el) => open("menu", el)} />
          <Btn icon={IC.pdf} t="فتح PDF" run={() => pdfInput.current?.click()} />
          <span className="qb-sep" />
          <Btn icon={IC.pen} t="قلم" on={tool === "pen"} run={() => { setTool("pen"); setPop(""); }} />
          <Btn icon={IC.hl} t="تظليل" on={tool === "hl"} run={() => { setTool("hl"); setPop(""); }} />
          <Btn id="eraser" icon={IC.eraser} t="ممحاة" on={tool === "eraser"} run={(el) => { setTool("eraser"); open("eraser", el); }} />
          <Btn id="shapes" icon={IC.shapes} t="أشكال" on={tool === "shape" && SHAPES.some((s) => s.id === shape)} run={(el) => open("shapes", el)} />
          <Btn id="solids" icon={IC.solids} t="مجسمات" on={tool === "shape" && SOLIDS.some((s) => s.id === shape)} run={(el) => open("solids", el)} />
          <Btn id="board" icon={IC.board} t="السبورة" on={pop === "board"} run={(el) => open("board", el)} />
          <Btn icon={IC.mic} t="مايك" on={mic} run={() => { setPop(""); setMic(true); }} />
          <span className="qb-sep" />
          {QUICK.map((c) => <button key={c} type="button" aria-label="لون" className={`qb-dot${color.toUpperCase() === c ? " on" : ""}`} style={{ background: c }} onClick={() => pickColor(c)} />)}
          <Btn id="colors" icon={<span className="qb-cur" style={{ background: color }} />} t="ألوان" on={pop === "colors"} run={(el) => open("colors", el)} />
          <span className="qb-sep" />
          {WIDTHS.map((w) => <button key={w} type="button" aria-label="حجم الكتابة" className={`qb-w${set.width === w ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, width: w }))}><i style={{ width: w * 2 + 4, height: w * 2 + 4 }} /></button>)}
        </div>
        <div className="qb-grp">
          <Btn icon={IC.undo} t="تراجع" run={doUndo} />
          <Btn icon={IC.redo} t="إعادة" run={doRedo} />
          <Btn icon={IC.clear} t="مسح الكل" run={clearAll} />
          <span className="qb-sep" />
          <Btn icon={IC.add} t="صفحة" run={() => addPage()} />
          <Btn icon={IC.prev} t="السابقة" dis={pageInfo.i === 0} run={() => goTo(pageIx.current - 1)} />
          <span className="qb-pg">{pageInfo.i + 1} / {pageInfo.n}</span>
          <Btn icon={IC.next} t="التالية" dis={pageInfo.i >= pageInfo.n - 1} run={() => goTo(pageIx.current + 1)} />
          <span className="qb-sep" />
          <Btn icon={IC.min} t="تصغير" run={fullScreen} />
          <Btn icon={IC.close} t="خروج" run={exit} />
        </div>
      </div>

      {pop && (
        <div className="qb-pop" ref={popEl} style={{ left: popAt }} onPointerDown={(e) => e.stopPropagation()}>
          {pop === "menu" && <div className="qb-menu">
            <div className="qb-mhead"><img src="/app-logo.png" alt="" /><div><b>قصي العميري</b><small>{st?.teacher ? "نسخة خاصة" : st?.name ? `سبورة ${st.name}` : ""}</small></div></div>
            <button type="button" onClick={() => { setPop(""); newLesson(); }}>شرح جديد</button>
            <button type="button" onClick={() => setPop("open")}>فتح شرح محفوظ</button>
            <button type="button" onClick={() => { setPop(""); saveDialog(); }}>حفظ الشرح</button>
            <button type="button" onClick={() => { setPop(""); pdfInput.current?.click(); }}>فتح ملف PDF</button>
            <button type="button" onClick={() => { setPop(""); imgInput.current?.click(); }}>إدراج صورة</button>
            <button type="button" onClick={() => { setPop(""); void printAll(); }}>طباعة / حفظ كـ PDF</button>
            <button type="button" onClick={() => { setPop(""); setAsk({ text: "تحذف هاي الصفحة؟", buttons: [{ t: "احذف", kind: "bad", run: () => { setAsk(null); deletePage(); } }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] }); }}>حذف هاي الصفحة</button>
            {st?.teacher && <button type="button" className="gold" onClick={sendDialog}>📤 إرسال للطلاب</button>}
            {st && !st.teacher && <button type="button" className="gold" onClick={() => setPop("inbox")}>📥 شروحات الأستاذ{st.inbox.length ? ` (${st.inbox.length})` : ""}</button>}
            <button type="button" onClick={() => setPop("settings")}>إعدادات الكف والممحاة</button>
            <button type="button" onClick={() => { setPop(""); fullScreen(); }}>ملء الشاشة / نافذة</button>
          </div>}
          {pop === "colors" && <><div className="qb-ptitle">اختار لون القلم</div><div className="qb-pal">{PAL.map((c, i) => <button key={i} type="button" aria-label="لون" className={color.toUpperCase() === c ? "on" : ""} style={{ background: c }} onClick={() => pickColor(c)} />)}</div></>}
          {pop === "eraser" && <><div className="qb-ptitle">حجم الممحاة</div><div className="qb-row">{ERASERS.map((x) => <button key={x.n} type="button" className={`qb-chip${set.eraser === x.n ? " on" : ""}`} onClick={() => { setSet((s) => ({ ...s, eraser: x.n })); setPop(""); }}><i style={{ width: x.n / 4, height: x.n / 4 }} />{x.t}</button>)}</div></>}
          {(pop === "shapes" || pop === "solids") && <div className="qb-row qb-wrap">{(pop === "shapes" ? SHAPES : SOLIDS).map((x) => <button key={x.id} type="button" className={`qb-chip${tool === "shape" && shape === x.id ? " on" : ""}`} onClick={() => { setShape(x.id); setTool("shape"); setPop(""); }}><ShapeIcon id={x.id} />{x.t}</button>)}</div>}
          {pop === "board" && <div className="qb-boardpick">
            <div className="qb-ptitle">لون السبورة</div>
            <div className="qb-row qb-wrap">{BOARDS.map((b) => <button key={b.c} type="button" aria-label={b.t} className={`qb-sw${set.board === b.c ? " on" : ""}`} style={{ background: b.c }} onClick={() => setBoard(b.c)} />)}</div>
            <div className="qb-ptitle">الإطار</div>
            <div className="qb-frames">{frames.map((f) => <button key={f.id} type="button" className={set.frame === f.id ? "on" : ""} onClick={() => setFrame(f.id)}>{previews[f.id] ? <img src={previews[f.id]} alt="" /> : <span className="qb-noprev" />}<span>{f.t}</span></button>)}</div>
          </div>}
          {pop === "open" && <div className="qb-list">
            <div className="qb-ptitle">فتح شرح محفوظ</div>
            {!st?.lessons.length && <div className="qb-empty">ماكو شروح محفوظة بعد</div>}
            {st?.lessons.map((m) => <div key={m.id} className="qb-li"><button type="button" onClick={() => guard(() => void openSaved(m.id))}><b>{m.title}</b><small>{m.at} · {m.pages} صفحة</small></button><button type="button" className="qb-x" aria-label="احذف" onClick={() => delSaved(m)}>🗑</button></div>)}
          </div>}
          {pop === "inbox" && <div className="qb-list">
            <div className="qb-ptitle">📥 شروحات الأستاذ</div>
            {!st?.inbox.length && <div className="qb-empty">بعد ما وصلك شرح</div>}
            {st?.inbox.map((m) => <div key={m.id} className="qb-li"><button type="button" onClick={() => guard(() => void openInbox(m.id))}><b>{m.title}</b><small>{m.at} · الفصل {ORD[m.chapter ?? 0]} · {m.pages} صفحة</small></button></div>)}
          </div>}
          {pop === "settings" && <div className="qb-set">
            <div className="qb-ptitle">إعدادات الكف والممحاة</div>
            <div className="qb-note">اللمسة اللي أكبر من هذا الحد تنحسب كف وتمسح. إذا الإصبع يمسح بالغلط كبّر الرقم، وإذا الكف يكتب بدل ما يمسح صغّره.</div>
            <label>حساسية الكف: <b>{set.palm}</b></label>
            <input type="range" min={30} max={600} step={10} value={set.palm} onChange={(e) => setSet((s) => ({ ...s, palm: Number(e.target.value) }))} />
            <div className="qb-note">آخر لمسة: <b dir="ltr">{lastTouch}</b> (حط كفك على السبورة وشوف رقمها)</div>
            <div className="qb-ptitle">حجم الممحاة</div>
            <div className="qb-row">{ERASERS.map((x) => <button key={x.n} type="button" className={`qb-chip${set.eraser === x.n ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, eraser: x.n }))}>{x.t}</button>)}</div>
          </div>}
        </div>
      )}

      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openPdf(f); }} />
      <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void insertImage(f); }} />

      {mic && <MicPanel onCancel={() => setMic(false)} onPlace={(t, s) => { setMic(false); if (!t.trim()) return; pendingText.current = { t: t.trim(), s }; setPlacing(true); }} />}
      {ask && <div className="qb-modal"><div className="qb-dlg">
        <div className="qb-dtext">{ask.text}</div>
        {ask.input && <AskInput init={ask.input.value} set={ask.input.set} />}
        <div className="qb-dbtns">{ask.buttons.map((b) => <button key={b.t} type="button" className={b.kind} onClick={b.run}>{b.t}</button>)}</div>
      </div></div>}
      {busy && <div className="qb-modal"><div className="qb-dlg"><div className="qb-dtext">{busy}</div></div></div>}
      {toast && <div className="qb-toast">{toast}</div>}
      {splash && <div className="qb-splash" onPointerDown={() => setSplash(false)}><img src="/app-logo.png" alt="" /><b>قصي العميري</b><span>نسخة خاصة</span></div>}
      <span hidden>{W}</span>
    </div>
  );
}

function AskInput({ init, set }: { init: string; set: (v: string) => void }) {
  const [v, setV] = useState(init);
  return <input className="qb-in" autoFocus value={v} onChange={(e) => { setV(e.target.value); set(e.target.value); }} placeholder="مثلاً: القطوع المكافئة 1" />;
}

/** رسمة صغيرة لكل شكل بالقائمة */
function ShapeIcon({ id }: { id: string }) {
  const s = shapeStrokes(id, [6, 6], [42, 42], "#fff", 2);
  return <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden>{s.map((x, i) => <polyline key={i} points={x.p.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>;
}

// ---------- 🎤 المايك: احچي وتنكتب (عربي أو إنگليزي)
type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
function MicPanel({ onCancel, onPlace }: { onCancel: () => void; onPlace: (t: string, size: number) => void }) {
  const [text, setText] = useState("");
  const [size, setSize] = useState(56);
  const [lang, setLang] = useState<"ar-IQ" | "en-US">("ar-IQ");
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const rec = useRef<SR | null>(null);
  const base = useRef("");
  const want = useRef(false);
  const make = (lg: string) => {
    const C = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!C) { setErr("هذا الجهاز ما يدعم تحويل الكلام لكتابة. جرب متصفح كروم"); return null; }
    const r: SR = new C();
    r.lang = lg; r.continuous = true; r.interimResults = true;
    r.onresult = (e: any) => {
      let fin = "", tmp = "";
      for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else tmp += t; }
      setText((base.current ? base.current + " " : "") + (fin + tmp).trim());
      if (fin) { /* يبقى بالنص */ }
    };
    r.onerror = (e: any) => { if (e?.error === "not-allowed") setErr("لازم تسمح للمايك"); };
    r.onend = () => { if (want.current) { try { r.start(); } catch { /* */ } } else setOn(false); };
    return r;
  };
  const start = (lg = lang) => {
    setErr("");
    const r = make(lg);
    if (!r) return;
    base.current = text.trim();
    rec.current = r; want.current = true;
    try { r.start(); setOn(true); } catch { setErr("المايك ما اشتغل"); }
  };
  const stop = () => { want.current = false; try { rec.current?.stop(); } catch { /* */ } setOn(false); };
  // تغيير اللغة: الكلام اللي انكتب يبقى، والسماع يبدي من جديد
  const switchLang = (lg: "ar-IQ" | "en-US") => { setLang(lg); if (on) { want.current = false; try { rec.current?.stop(); } catch { /* */ } window.setTimeout(() => start(lg), 250); } };
  useEffect(() => () => { want.current = false; try { rec.current?.stop(); } catch { /* */ } }, []);
  return (
    <div className="qb-modal"><div className="qb-dlg qb-mic">
      <div className="qb-ptitle">احچي وتنكتب</div>
      <div className="qb-row">
        <button type="button" className={`qb-chip${lang === "ar-IQ" ? " on" : ""}`} onClick={() => switchLang("ar-IQ")}>عربي</button>
        <button type="button" className={`qb-chip${lang === "en-US" ? " on" : ""}`} onClick={() => switchLang("en-US")}>إنگليزي</button>
      </div>
      <textarea dir={lang === "en-US" ? "auto" : "rtl"} value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      {err && <div className="qb-note bad">⚠️ {err}</div>}
      <div className="qb-row"><span>حجم الكتابة:</span>{[[36, "صغير"], [56, "وسط"], [84, "كبير"]].map(([n, t]) => <button key={n} type="button" className={`qb-chip${size === n ? " on" : ""}`} onClick={() => setSize(Number(n))}>{t}</button>)}</div>
      <div className="qb-dbtns">
        {on ? <button type="button" className="bad" onClick={stop}>⏹ وگّف</button> : <button type="button" className="bad" onClick={() => start()}>🎤 ابدأ الكلام</button>}
        <button type="button" className="ok" disabled={!text.trim()} onClick={() => { stop(); onPlace(text, size); }}>اكتبها على السبورة</button>
        <button type="button" className="gray" onClick={() => { stop(); onCancel(); }}>إلغاء</button>
      </div>
    </div></div>
  );
}

const CSS = `
.ptools{display:none!important}
.qb{position:fixed;inset:0;z-index:30;background:#0d1320;display:flex;flex-direction:column;user-select:none;-webkit-user-select:none;font-family:${"Tahoma, 'Segoe UI', Arial, sans-serif"};touch-action:none;overscroll-behavior:none}
.qb-area{position:relative;flex:1;min-height:0;overflow:hidden}
.qb-c{position:absolute;inset:0;width:100%;height:100%;display:block}
.qb-live{touch-action:none;cursor:crosshair}
.qb-hint{position:absolute;top:56px;left:50%;transform:translateX(-50%);background:#1F2738;color:#F6C94A;padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.27);font-size:18px;pointer-events:none}
.qb-bar{height:${BAR}px;flex:none;background:#1B2333;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:0 6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.qb-grp{display:flex;align-items:center;gap:2px;flex:none}
.qb-btn{width:58px;height:66px;flex:none;border:0;border-radius:10px;background:transparent;color:#dfe5f0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0;cursor:pointer}
.qb-btn:disabled{opacity:.35}
.qb-btn.on{background:#2c3850;color:#F6C94A;box-shadow:inset 0 0 0 2px #F6C94A}
.qb-ic{display:flex;height:28px;align-items:center}
.qb-t{font-size:12px;white-space:nowrap}
.qb-sep{width:1px;height:46px;background:rgba(255,255,255,.18);margin:0 4px;flex:none}
.qb-dot{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.35);margin:0 3px;flex:none;cursor:pointer;padding:0}
.qb-dot.on{box-shadow:0 0 0 3px #F6C94A}
.qb-cur{width:24px;height:24px;border-radius:50%;border:2px solid #fff;display:block}
.qb-w{width:44px;height:52px;border:0;border-radius:10px;background:transparent;display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer}
.qb-w i{background:#dfe5f0;border-radius:50%;display:block}
.qb-w.on{background:#2c3850;box-shadow:inset 0 0 0 2px #F6C94A}
.qb-pg{color:#fff;font-size:15px;min-width:56px;text-align:center;direction:ltr;flex:none}
.qb-pop{position:fixed;bottom:${BAR + 8}px;background:#1F2738;border:1px solid rgba(255,255,255,.27);border-radius:12px;padding:12px;color:#fff;z-index:20;max-width:calc(100vw - 16px);max-height:calc(100vh - ${BAR + 24}px);overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.qb-ptitle{font-size:15px;color:#F6C94A;margin:2px 2px 8px;font-weight:700}
.qb-row{display:flex;gap:8px;align-items:center}
.qb-wrap{flex-wrap:wrap;max-width:560px}
.qb-chip{min-height:54px;border:1px solid rgba(255,255,255,.27);border-radius:12px;background:#283247;color:#fff;font-size:15px;padding:6px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer}
.qb-chip i{display:block;border:2px solid #fff;border-radius:6px}
.qb-chip.on,.qb-frames button.on,.qb-sw.on,.qb-pal button.on{box-shadow:0 0 0 3px #F6C94A;border-color:#F6C94A}
.qb-pal{display:grid;grid-template-columns:repeat(14,32px);gap:5px}
.qb-pal button{width:32px;height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.2);padding:0;cursor:pointer}
.qb-sw{width:64px;height:48px;border-radius:10px;border:2px solid rgba(255,255,255,.35);cursor:pointer}
.qb-frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;width:min(560px,calc(100vw - 48px))}
.qb-frames button{background:#283247;border:1px solid rgba(255,255,255,.2);border-radius:10px;color:#fff;padding:6px;display:flex;flex-direction:column;gap:4px;align-items:stretch;font-size:14px;cursor:pointer}
.qb-frames img,.qb-noprev{width:100%;height:24px;border-radius:4px;display:block;object-fit:cover}
.qb-menu{display:flex;flex-direction:column;min-width:260px}
.qb-menu button{background:transparent;border:0;color:#fff;text-align:right;font-size:17px;padding:12px 14px;border-radius:8px;cursor:pointer}
.qb-menu button:hover{background:#283247}
.qb-menu button.gold{color:#F6C94A;font-weight:700}
.qb-mhead{display:flex;gap:10px;align-items:center;padding:4px 8px 10px;border-bottom:1px solid rgba(255,255,255,.15);margin-bottom:6px}
.qb-mhead img{width:44px;height:44px}
.qb-mhead b{color:#F6C94A;font-size:18px;display:block}
.qb-mhead small{color:#aab3c5}
.qb-list{min-width:300px;max-width:520px}
.qb-li{display:flex;gap:6px;margin-bottom:6px}
.qb-li button{flex:1;background:#283247;border:1px solid rgba(255,255,255,.18);border-radius:10px;color:#fff;text-align:right;padding:10px 12px;display:flex;flex-direction:column;gap:2px;cursor:pointer}
.qb-li small{color:#aab3c5}
.qb-li .qb-x{flex:none;width:54px;align-items:center;justify-content:center}
.qb-empty{color:#aab3c5;padding:8px}
.qb-set{width:min(440px,calc(100vw - 48px))}
.qb-set input[type=range]{width:100%;margin:8px 0 12px;accent-color:#F6C94A}
.qb-note{color:#c9d1e0;font-size:14px;line-height:1.6;margin-bottom:8px}
.qb-note.bad{color:#ff8a80}
.qb-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:40}
.qb-dlg{background:#1F2738;border:1px solid rgba(255,255,255,.27);border-radius:16px;padding:22px;color:#fff;min-width:min(420px,calc(100vw - 32px));max-width:calc(100vw - 32px);display:flex;flex-direction:column;gap:14px}
.qb-dtext{font-size:20px;line-height:1.6;text-align:center}
.qb-dbtns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.qb-dbtns button{min-width:110px;min-height:54px;border:0;border-radius:12px;font-size:18px;font-weight:700;color:#fff;cursor:pointer;padding:0 16px}
.qb-dbtns .ok{background:#2e9d57}.qb-dbtns .bad{background:#d23b3b}.qb-dbtns .gray{background:#4a5468}
.qb-dbtns button:disabled{opacity:.4}
.qb-in,.qb-mic textarea{width:100%;box-sizing:border-box;background:#0f1522;color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:12px;font-size:20px;font-family:inherit}
.qb-mic{width:min(720px,calc(100vw - 32px))}
.qb-mic textarea{font-size:24px;min-height:140px;resize:vertical}
.qb-toast{position:fixed;top:56px;left:50%;transform:translateX(-50%);background:#1F2738;color:#fff;border:1px solid #F6C94A;padding:12px 20px;border-radius:12px;font-size:17px;z-index:50;max-width:calc(100vw - 32px)}
.qb-splash{position:fixed;inset:0;background:#141B2B;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:60}
.qb-splash img{width:220px;height:220px;object-fit:contain}
.qb-splash b{color:#F6C94A;font-size:56px}
.qb-splash span{color:#aab3c5;font-size:22px}
@media (max-width:900px){.qb-btn{width:52px}.qb-t{font-size:11px}.qb-pal{grid-template-columns:repeat(14,24px)}.qb-pal button{width:24px;height:24px}}
`;
