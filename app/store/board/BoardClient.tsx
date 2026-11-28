"use client";
// 📝 سبورة قصي العميري (طلبه 2026-11-25، BOARD_SPEC.md): نفس سبورة الويندوز، بالتطبيق، عند الأستاذ وعند الطالب بنفس الخيارات.
// الكف يمسح (التماس أكبر من الحد)، والقلم بالآيباد يكتب واليد ما تكتب وهو نازل. كل الكتابة والأزرار بالعربي
import { enDigits } from "../../../lib/board/spokenNum.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Splash, { Outro } from "./Splash";
import { plot } from "../../../lib/board/plot.ts";
import { BOXES, STAMPS, makeBox, makeCover, makeStamp, type BoxKind } from "./makers";
import { SLOGAN, CURVES, GRIDS, NOTEBOOK, curveOf, type Grid, BOARDS, DEFAULT_BOARD, DEFAULT_FRAME, ERASERS, FRAMES, H, HEADS, QUICK, SHAPES, SOLIDS, WIDTHS, cleanLesson, emptyLesson, eraseAlong, headOf, hitItem, hlWidth, inRect, areaOf, isLight, isPalm, itemBox, moved, palette, scaled, shapeStrokes, unionBox, type Box, type InkStroke, type Item, type Lesson } from "../../../lib/board/engine.ts";
import { pageToken } from "../adminPage";
import { deviceId, deviceNow, platformNow } from "../shared";
import { pdfClient } from "../pdfClient";
import { VideoBox } from "../notes/NotesClient";
import { drawFoot, drawItem, drawPage, framePreview, headPreview, paintFrame, textLines } from "./boardDraw";
import { IC } from "./icons";

type Tool = "pen" | "hl" | "eraser" | "shape" | "move";
type Step = { add: Item[]; remove: Item[] };
type Contact = { place?: { t: string; s: number }; mode: "ink" | "erase" | "shape" | "ignore" | "select" | "drag" | "resize" | "place"; stroke?: InkStroke; start: [number, number]; last: [number, number]; size: number; pen: boolean; anchor?: [number, number] };
type Meta = { id: string; title: string; at: string; pages: number; chapter?: number; topic?: string; lecture?: number; lt?: string; app?: string };
const whereOf = (m: Meta) => [`الفصل ${ORD[m.chapter ?? 0]}`, m.topic, m.lt || (m.lecture ? `المحاضرة ${m.lecture}` : "")].filter(Boolean).join(" · ");
// محاضرات تطبيق قصي (الشرح ينزل بملحقاتها)
type AppLec = { id: string; title: string; track: "arabic" | "english"; draft: boolean };
type AppTopic = { id: string; name: string; lectures: AppLec[] };
type AppCh = { ch: number; name: string; topics: AppTopic[] };
const TRACK = { arabic: "عربي", english: "انگليزي" } as const;
type Target = { ch: number; name: string; topics: { id: number; name: string; lectures: number }[] };
type State = { teacher: boolean; name: string; lessons: Meta[]; inbox: Meta[]; sent: Meta[]; appEnv?: string; lqCount?: number };
type Pop = "" | "menu" | "colors" | "eraser" | "shapes" | "solids" | "board" | "open" | "inbox" | "settings" | "sent" | "boxes" | "plot";
type Ask = { text: string; buttons: { t: string; kind: "ok" | "bad" | "gray"; run: () => void }[]; input?: { value: string; set: (v: string) => void } } | null;

const BAR = 74;                       // ارتفاع شريط الأدوات (بكسل الشاشة)
const PAL = palette();
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
const SET_KEY = "qboard_settings", DRAFT_KEY = "qboard_draft";
// المسودة لأي شرح تعود (رقمه واسمه)، حتى من يرجع تنفتح نفس الشاشة اللي طلع منها ويبقى الحفظ على نفس الشرح
const META_KEY = "qboard_draft_meta";
// آخر شرح محفوظ اشتغل عليه: من يرجع للسبورة ينفتح وحده (طلبه 2026-11-26: «ألقى صفحة فارغة»)
const LAST_KEY = "qboard_last";
const rememberLast = (id: string) => { try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); } catch { /* */ } };
/** wm / grid / foot: لمساته الشخصية، تنحفظ ويا الشرح ويشوفها الطالب */
type Settings = { board: string; frame: string; head: string; palm: number; eraser: number; width: number; wm?: boolean; grid?: string; foot?: boolean };
const tablet = () => typeof window !== "undefined" && Math.max(window.screen.width, window.screen.height) < 1400;
const loadSettings = (): Settings => {
  const d: Settings = { board: DEFAULT_BOARD, frame: DEFAULT_FRAME, head: "nb-charcoal", palm: tablet() ? 70 : 200, eraser: 80, width: 5 };
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
const bgUrl = (ref: string) => {
  // «q:ملزمة:صفحة» = صفحة سؤال من «📚 ملازمي» (حلّي): تنقرا حية، فإذا بدّل الأستاذ الملزمة تتبدل هنا
  const q = /^q:(\d+):(\d+)$/.exec(ref);
  if (q) return `/api/notes/page?t=${encodeURIComponent(pageToken())}&book=${q[1]}&page=${q[2]}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}`;
  return `/api/board/file?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(pageToken())}`;
};
/** ورقة A4 طولية (حلّي): العرض ثابت، والارتفاع نفس السبورة */
const PAPER_W = Math.round(H / Math.SQRT2);
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
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const [lessonId, setLessonId] = useState("");
  // آخر رقم شرح وحالة الحفظ: الإرسال بعد «احفظ» يقراهم من هنا، لأن نافذته انفتحت قبل الحفظ (كانت تشوف القديم وتگول «احفظ أول» من جديد)
  const lessonIdRef = useRef(""); lessonIdRef.current = lessonId;
  const [title, setTitle] = useState("");
  // ---------- الأدوات
  const [tool, setTool] = useState<Tool>("pen");
  const [shape, setShape] = useState("line");
  const [color, setColor] = useState("#FFFFFF");
  const [set, setSet] = useState<Settings>(() => ({ board: DEFAULT_BOARD, frame: DEFAULT_FRAME, head: "nb-charcoal", palm: 200, eraser: 80, width: 5 }));
  const [pop, setPop] = useState<Pop>("");
  // «−» ينزل شريط الأدوات جوه ويخلي السبورة كلها، ويبقى لسان صغير تدوسه ويصعد (طلبه 2026-11-27، مثل البرامج)
  const [barDown, setBarDown] = useState(false);
  const [popAt, setPopAt] = useState(0);
  const [ask, setAsk] = useState<Ask>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  // 🔄 تحديث جديد: النافذة المفتوحة من مدة تبقى على النسخة القديمة لحد ما تتحدث، فتنبهه (كتابته تبقى، لأنها مسودة بالجهاز)
  const [newVer, setNewVer] = useState(false);
  // 🗕 صغّر السبورة كلها لشريط المهام (طلبه 2026-11-27): بس بنافذة «السبورة بنافذة لحالها» باللابتوب (?win=1)،
  // اللي وياها مساعد صغير محلي (127.0.0.1) يصغّر النافذة، لأن الصفحة نفسها ما يسمحلها المتصفح تصغّر نفسها
  const MIN_URL = "http://127.0.0.1:47123";
  const [canMin, setCanMin] = useState(false);
  useEffect(() => {
    let w = new URLSearchParams(location.search).get("win") === "1";
    try { if (w) sessionStorage.setItem("qb_win", "1"); else w = sessionStorage.getItem("qb_win") === "1"; } catch { /* */ }
    if (w) void fetch(`${MIN_URL}/ping`, { cache: "no-store" }).then((r) => setCanMin(r.ok)).catch(() => setCanMin(false));
  }, []);
  const minimize = () => { void fetch(`${MIN_URL}/min`, { cache: "no-store" }).catch(() => say("ما گدرت أصغرها: سد السبورة وافتحها من أيقونة «السبورة بنافذة لحالها»")); };
  useEffect(() => {
    let first = "";
    const check = () => { void fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j: { v?: string }) => { const v = String(j?.v ?? ""); if (!v) return; if (!first) first = v; else if (v !== first) setNewVer(true); }).catch(() => { /* */ }); };
    check();
    const t = window.setInterval(check, 3 * 60_000);
    const vis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const [splash, setSplash] = useState(true);
  const [st, setSt] = useState<State | null>(null);
  const [lastTouch, setLastTouch] = useState("-");
  const [mic, setMic] = useState(false);
  const pendingText = useRef<{ t: string; s: number } | null>(null);
  // ✋ التحريك: اللي مختاره هسه، ومربع الاختيار وهو يسحب، والنسخ المتحركة قبل ما ينزل إصبعه
  const sel = useRef<Item[]>([]);
  const [selN, setSelN] = useState(0);
  const band = useRef<Box | null>(null);
  const ghost = useRef<Item[] | null>(null);
  const setSel = (l: Item[]) => { sel.current = l; setSelN(l.length); };
  const [placing, setPlacing] = useState(false);
  const toolRef = useRef({ tool, shape, color, set });
  toolRef.current = { tool, shape, color, set };

  const page = () => lesson.current.pages[pageIx.current];
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3200); };
  const markDirty = () => setDirty(true);
  /** حلّي: ورقة A4 وأسئلة المحاضرة، والحل ينحفظ وحده إله بس */
  const paper = useRef(false);
  const [solve, setSolve] = useState<{ id: string; title: string } | null>(null);

  // ---------- الرسم
  const bgOf = useCallback((ref?: string | null) => {
    if (!ref) return null;
    let im = imgs.current.get(ref);
    if (!im) {
      im = new Image();
      im.onload = () => redrawInk();
      // صفحة سؤال ما انفتحت (قفل الامتحان، أوقاته، جهاز ثاني): نگله ليش
      if (ref.startsWith("q:")) im.onerror = () => { void fetch(bgUrl(ref)).then((r) => r.text()).then((t) => say(t.length < 200 ? t : "السؤال ما انفتح")).catch(() => say("السؤال ما انفتح، تأكد من النت")); };
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
    if (x) paintFrame(x, geo.current.W, lesson.current.board, lesson.current.frame, logo.current, lesson.current.head, lesson.current);
  }, []);
  const redrawInk = useCallback(() => {
    const x = ctxOf(inkC.current);
    if (!x) return;
    x.clearRect(0, 0, geo.current.W, H);
    drawPage(x, geo.current.W, lesson.current.frame, page().items, bgOf(page().bg), bgOf);
    if (lesson.current.foot) drawFoot(x, geo.current.W, lesson.current.frame, lesson.current.board, pageIx.current + 1, lesson.current.pages.length, titleNow.current);
  }, [bgOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const titleNow = useRef("");
  const inkQueued = useRef(false);
  const queueInk = () => { if (inkQueued.current) return; inkQueued.current = true; requestAnimationFrame(() => { inkQueued.current = false; redrawInk(); }); };
  const eraserMark = useRef<{ x: number; y: number; s: number } | null>(null);
  /** قطعة كحلية بإطار ذهبي ولوگو قصي عليها: المساحة، وتحت الإصبع وقت التحريك */
  const logoBlock = (x: CanvasRenderingContext2D, cx: number, cy: number, s: number) => {
    x.save();
    x.fillStyle = "rgba(20,31,51,0.82)"; x.strokeStyle = "#F6C94A"; x.lineWidth = 3;
    x.beginPath(); x.roundRect(cx - s / 2, cy - s / 2, s, s, Math.min(14, s / 6)); x.fill(); x.stroke();
    const lg = logo.current;
    if (lg && lg.naturalWidth) {
      const W0 = lg.naturalWidth, H0 = lg.naturalHeight, sw = W0 * 0.57, sh = H0 * 0.62;
      const k = (s * 0.84) / Math.max(sw, sh);
      x.drawImage(lg, W0 * 0.225, H0 * 0.225, sw, sh, cx - (sw * k) / 2, cy - (sh * k) / 2, sw * k, sh * k);
    }
    x.restore();
  };
  /** كتابة المايك من الدوسة والسحب: السحب يحدد عرضها، والدوسة بس تمشي لطرف السبورة */
  const placedText = (c: Contact): Extract<Item, { k: "text" }> => {
    const x = ctxOf(liveC.current)!;
    const pt = c.place!, [x0, y0] = c.start, x1 = c.last[0];
    const A = areaOf(lesson.current.frame, geo.current.W);
    const ar = /[\u0600-\u06FF]/.test(pt.t);
    const drag = Math.abs(x1 - x0) >= 40;
    const left = drag ? Math.min(x0, x1) : x0, right = drag ? Math.max(x0, x1) : x0;
    const ww = drag ? right - left : ar ? undefined : Math.max(200, A.x + A.w - 20 - x0);
    const lay = textLines(x, pt.t, pt.s, right, ww);
    // العربي يبدي من اليمين، والإنگليزي من اليسار
    const ax = ar ? right : left + lay.w;
    return { k: "text", c: toolRef.current.color, s: pt.s, x: ax, y: y0, t: pt.t, bw: lay.w, bh: lay.h, ...(ww ? { ww } : {}) };
  };
  const liveQueued = useRef(false);
  const redrawLive = () => {
    if (liveQueued.current) return;
    liveQueued.current = true;
    requestAnimationFrame(() => {
      liveQueued.current = false;
      const x = ctxOf(liveC.current);
      if (!x) return;
      x.clearRect(0, 0, geo.current.W, H);
      const A = areaOf(lesson.current.frame, geo.current.W);
      x.save(); x.beginPath(); x.rect(A.x, A.y, A.w, A.h); x.clip();
      for (const c of contacts.current.values()) if (c.stroke) drawItem(x, c.stroke);
      for (const c of contacts.current.values()) if (c.mode === "shape") for (const s of shapeStrokes(toolRef.current.shape, c.start, c.last, toolRef.current.color, toolRef.current.set.width)) drawItem(x, s);
      if (ghost.current) for (const it of ghost.current) drawItem(x, it, bgOf);
      // حدود كتابة المايك وهو يسحب: مربع متقطع والكتابة جواه، حتى يشوف وين تنلف
      for (const c of contacts.current.values()) if (c.mode === "place" && c.place) {
        const it = placedText(c);
        const bw = it.ww ?? it.bw, left = /[\u0600-\u06FF]/.test(it.t) ? it.x - bw : it.x - it.bw;
        x.save(); x.globalAlpha = 0.85; drawItem(x, it); x.restore();
        x.save(); x.strokeStyle = "#F6C94A"; x.lineWidth = 3; x.setLineDash([12, 8]);
        x.strokeRect(left - 8, it.y - 8, bw + 16, it.bh + 16); x.restore();
      }
      const sb = ghost.current ? unionBox(ghost.current) : unionBox(sel.current);
      if (sb) {
        x.save(); x.strokeStyle = "#F6C94A"; x.lineWidth = 3; x.setLineDash([14, 10]);
        x.strokeRect(sb.x0 - 8, sb.y0 - 8, sb.x1 - sb.x0 + 16, sb.y1 - sb.y0 + 16);
        x.setLineDash([]); x.fillStyle = "#F6C94A";
        for (const [cx, cy] of [[sb.x0 - 8, sb.y0 - 8], [sb.x1 + 8, sb.y0 - 8], [sb.x0 - 8, sb.y1 + 8], [sb.x1 + 8, sb.y1 + 8]]) { x.beginPath(); x.arc(cx, cy, 13, 0, Math.PI * 2); x.fill(); }
        x.restore();
      }
      const bd = band.current;
      if (bd) { x.save(); x.strokeStyle = "rgba(246,201,74,.9)"; x.fillStyle = "rgba(246,201,74,.12)"; x.lineWidth = 2; x.setLineDash([10, 8]); x.fillRect(Math.min(bd.x0, bd.x1), Math.min(bd.y0, bd.y1), Math.abs(bd.x1 - bd.x0), Math.abs(bd.y1 - bd.y0)); x.strokeRect(Math.min(bd.x0, bd.x1), Math.min(bd.y0, bd.y1), Math.abs(bd.x1 - bd.x0), Math.abs(bd.y1 - bd.y0)); x.restore(); }
      // ✋ التحريك: اللوگو تحت الإصبع كأنه هو اللي يسحب الشي
      for (const c of contacts.current.values()) if (c.mode === "drag" || c.mode === "resize") logoBlock(x, c.last[0], c.last[1], 64);
      const m = eraserMark.current;
      if (m) {
        // المساحة بشكل لوگو قصي: قطعة كحلية بإطار ذهبي واللوگو عليها (نفس مكان المسح بالضبط)
        logoBlock(x, m.x, m.y, m.s);
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
    if (paper.current) {
      // ورقة A4 بالنص، والباقي طاولة
      const scale = Math.min(cssH / H, cssW / PAPER_W), cw = PAPER_W * scale, ch = H * scale;
      geo.current = { cssW: cw, cssH: ch, scale, W: PAPER_W, dpr };
      for (const c of [frameC.current, inkC.current, liveC.current]) if (c) {
        c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
        Object.assign(c.style, { width: `${cw}px`, height: `${ch}px`, left: `${(cssW - cw) / 2}px`, top: `${(cssH - ch) / 2}px`, right: "auto", bottom: "auto" });
      }
      setW(PAPER_W);
      redrawFrame(); redrawInk(); redrawLive();
      return;
    }
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
      else if (it.k === "img") { it.x = it.x * s + dx; it.y = it.y * s + dy; it.w *= s; it.h *= s; }
      else { it.w *= s; for (let i = 0; i < it.p.length; i += 2) { it.p[i] = it.p[i] * s + dx; it.p[i + 1] = it.p[i + 1] * s + dy; } }
    }
    l.w = Wn;
  }

  // ---------- البداية
  useEffect(() => {
    const s = loadSettings();
    setSet(s);
    lesson.current.board = s.board; lesson.current.frame = s.frame; lesson.current.head = s.head;
    applyLook(lesson.current, s);
    setColor(isLight(s.board) ? "#000000" : "#FFFFFF");
    const im = new Image(); im.onload = () => { logo.current = im; redrawFrame(); }; im.src = "/app-logo.png";
    // خط التطبيق: السبورة تنرسم من جديد أول ما يوصل، حتى الاسم والكتابة تطلع بخطنا مو بالخط الرسمي
    void Promise.allSettled([document.fonts.load("700 40px QAppAr", "قصي العميري"), document.fonts.load("400 40px QAppAr", "اب"), document.fonts.load("700 40px QAppEn", "Ab1")]).then(() => { redrawFrame(); redrawInk(); });
    // مسودة ما انحفظت (التطبيق انسد فجأة)
    let hadDraft = false;
    try { const d = cleanLesson(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null")); if (d && d.pages.some((p) => p.items.length || p.bg)) { lesson.current = d; undo.current = d.pages.map(() => []); redo.current = d.pages.map(() => []); setDirty(true); hadDraft = true; const m = JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); if (m?.id) { setLessonId(String(m.id)); setTitle(String(m.title ?? "")); } } } catch { /* */ }
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    // حجم السبورة تغير (تدوير التابلت، ملء الشاشة): نعيد القياس
    const ro = typeof ResizeObserver !== "undefined" && wrap.current ? new ResizeObserver(() => layout()) : null;
    if (ro && wrap.current) ro.observe(wrap.current);
    const t = 0;
    void api({ action: "state" }).then((r: State) => {
      setSt(r);
      const q = new URLSearchParams(location.search);
      const inbox = q.get("inbox"), att = q.get("att");
      if (inbox) void openInbox(inbox);
      else if (att) void openAtt(att);
      else if (q.get("solve")) void openSolve(q.get("solve")!);
      else if (!hadDraft) {
        // ماكو مسودة: آخر شرح حفظه أو فتحه ينفتح وحده، مو صفحة فاضية
        let last = ""; try { last = localStorage.getItem(LAST_KEY) ?? ""; } catch { /* */ }
        const m = last ? r.lessons?.find((x) => x.id === last) : null;
        if (m) void api({ action: "get", id: m.id }).then((g: { lesson: unknown }) => { const l = cleanLesson(g.lesson); if (l) loadLesson(l, m.id, m.title); }).catch(() => rememberLast(""));
      }
    }).catch((e) => say(new URLSearchParams(location.search).get("att") && !new URLSearchParams(location.search).get("t") ? "حدّث التطبيق حتى ينفتح شرح السبورة جوه التطبيق" : `صار خطأ: ${(e as Error).message}`));
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); window.clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // الإعدادات تنحفظ بالجهاز
  useEffect(() => { try { localStorage.setItem(SET_KEY, JSON.stringify(set)); } catch { /* */ } }, [set]);
  // مسودة بالجهاز كل شوية (إذا انسد التطبيق ما يروح الشرح)
  useEffect(() => {
    if (!dirty) return;
    // حلّي ينحفظ بالسيرفر وحده، مو مسودة السبورة
    if (solve) {
      const t = window.setTimeout(() => {
        void api({ action: "solvePut", lec: solve.id, lesson: lesson.current }).then(() => setDirty(false)).catch((e) => say(`ما انحفظ حلك: ${(e as Error).message}`));
      }, 1500);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(keepDraft, 1500);
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
  const doUndo = () => { if (contacts.current.size) return; setSel([]); const s = undo.current[pageIx.current].pop(); if (!s) return; apply(s.remove, s.add); redo.current[pageIx.current].push(s); };
  const doRedo = () => { if (contacts.current.size) return; setSel([]); const s = redo.current[pageIx.current].pop(); if (!s) return; apply(s.add, s.remove); undo.current[pageIx.current].push(s); };
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
    // نص المايك: يدوس ويسحب، ويشوف حدود الكتابة وهو يسحب (طلبه 2026-11-28)، ومن يرفع تنحط. دوسة بس: العربي من الدوسة لليسار، والإنگليزي لليمين
    if (pendingText.current && !force && !palm) {
      c.mode = "place"; c.place = pendingText.current;
      redrawLive();
      return;
    }
    if (force || t === "eraser" || palm) { startErase(c, p, palm); return; }
    if (t === "move") { startMove(c, p); return; }
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
    if (c.mode === "place") { c.last = toBoard(e); redrawLive(); return; }
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const pts: [number, number][] = events.length ? events.map((ev) => { const r = liveC.current!.getBoundingClientRect(); return [(ev.clientX - r.left) / geo.current.scale, (ev.clientY - r.top) / geo.current.scale] as [number, number]; }) : [toBoard(e)];
    // كف نازل شوية شوية: يبدي صغير ويكبر. الخط اللي بداه ينشال ويصير ممحاة
    if (c.mode !== "erase" && !c.pen && e.pointerType === "touch" && isPalm(sw, sh, toolRef.current.set.palm)) {
      startErase(c, pts[pts.length - 1], true);
      c.last = pts[pts.length - 1];
      return;
    }
    if (c.mode === "select" || c.mode === "drag" || c.mode === "resize") { const p = pts[pts.length - 1]; c.last = p; moveTo(c, p); redrawLive(); return; }
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
    if (c.mode === "place" && c.place) {
      const it = placedText(c);
      pendingText.current = null; setPlacing(false);
      page().items.push(it); noteAdd(it);
    } else if (c.mode === "select" || c.mode === "drag" || c.mode === "resize") endMove(c);
    else if (c.stroke) {
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

  // ---------- ✋ التحريك: دوسة على كتابة أو صورة تختارها، أو اسحب مربع حوالين أكثر من شي. بعدها اسحبها لمكان ثاني، أو كبّرها من الزاوية
  const near = (b: Box, p: [number, number], pad: number) => p[0] >= b.x0 - pad && p[0] <= b.x1 + pad && p[1] >= b.y0 - pad && p[1] <= b.y1 + pad;
  const startMove = (c: Contact, p: [number, number]) => {
    const sb = unionBox(sel.current);
    if (sb) {
      const corners: [number, number, number, number][] = [[sb.x0 - 8, sb.y0 - 8, sb.x1, sb.y1], [sb.x1 + 8, sb.y0 - 8, sb.x0, sb.y1], [sb.x0 - 8, sb.y1 + 8, sb.x1, sb.y0], [sb.x1 + 8, sb.y1 + 8, sb.x0, sb.y0]];
      const hit = corners.find(([cx, cy]) => Math.hypot(p[0] - cx, p[1] - cy) < 34);
      if (hit) { c.mode = "resize"; c.anchor = [hit[2], hit[3]]; lift(); return; }
      if (near(sb, p, 12)) { c.mode = "drag"; lift(); return; }
    }
    const it = hitItem(page().items, p[0], p[1]);
    if (it) { setSel([it]); c.mode = "drag"; lift(); return; }
    setSel([]); c.mode = "select"; band.current = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; redrawLive();
  };
  /** المختار يطلع من الصفحة وقت السحب (يترسم متحرك فوك)، ويرجع بمكانه الجديد من ينزل الإصبع */
  const lift = () => { ghost.current = sel.current; page().items = page().items.filter((x) => !sel.current.includes(x)); redrawInk(); redrawLive(); };
  const moveTo = (c: Contact, p: [number, number]) => {
    if (c.mode === "select") { band.current = { x0: c.start[0], y0: c.start[1], x1: p[0], y1: p[1] }; return; }
    if (c.mode === "drag") { const dx = p[0] - c.start[0], dy = p[1] - c.start[1]; ghost.current = sel.current.map((it) => moved(it, dx, dy)); return; }
    if (c.mode === "resize" && c.anchor) {
      const d0 = Math.hypot(c.start[0] - c.anchor[0], c.start[1] - c.anchor[1]) || 1, d1 = Math.hypot(p[0] - c.anchor[0], p[1] - c.anchor[1]);
      const k = Math.max(0.1, Math.min(10, d1 / d0));
      ghost.current = sel.current.map((it) => scaled(it, c.anchor![0], c.anchor![1], k));
    }
  };
  const endMove = (c: Contact) => {
    if (c.mode === "select") {
      const b = band.current; band.current = null;
      if (b) setSel(inRect(page().items, b));
      return;
    }
    const now = ghost.current ?? sel.current; ghost.current = null;
    const changed = Math.hypot(c.last[0] - c.start[0], c.last[1] - c.start[1]) > 2;
    if (!changed) { page().items.push(...sel.current); return; }
    page().items.push(...now);
    for (const x of sel.current) noteRemove(x);
    for (const x of now) noteAdd(x);
    setSel(now);
  };
  // ✏️ تعديل كتابة انحطت (طلبه 2026-11-27: «أريدها قابلة للتعديل»): نفس مربع المايك بكتابتها، و«💾 احفظ التعديل» يبدلها بمكانها
  const [editIt, setEditIt] = useState<Extract<Item, { k: "text" }> | null>(null);
  const saveEdit = (old: Extract<Item, { k: "text" }>, t: string, s: number) => {
    const x = ctxOf(liveC.current)!;
    const lay = textLines(x, t, s, old.x);
    const nu: Item = { ...old, t, s, bw: lay.w, bh: lay.h };
    const items = page().items, k = items.indexOf(old);
    if (k < 0) return;
    items[k] = nu;
    pending.current = { add: [nu], remove: [old] };
    commit(); setSel([nu]); redrawInk(); redrawLive();
  };
  const deleteSel = () => {
    if (!sel.current.length) return;
    pending.current = { add: [], remove: [...sel.current] };
    page().items = page().items.filter((x) => !sel.current.includes(x));
    setSel([]); commit(); redrawInk(); redrawLive();
  };
  const pickTool = (t: Tool) => { setTool(t); if (t !== "move") { setSel([]); redrawLive(); } setPop(""); };

  // ---------- الصفحات
  const goTo = (i: number) => {
    if (i < 0 || i >= lesson.current.pages.length || contacts.current.size) return;
    setSel([]);
    pageIx.current = i; sync(); redrawInk(); redrawLive();
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
    setLessonId(id); setTitle(t); setDirty(false); if (id) rememberLast(id);
    setSet((s) => ({ ...s, board: l.board, frame: l.frame, head: headOf(l.head), wm: !!l.wm, grid: l.grid ?? "", foot: !!l.foot }));
    setSel([]);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
    sync(); redrawFrame(); redrawInk();
  };
  /** قبل ما يروح الشرح المفتوح: تريد تحفظه؟ */
  const guard = (then: () => void) => {
    if (solve && dirty) { setBusy("جاري حفظ حلك..."); void api({ action: "solvePut", lec: solve.id, lesson: lesson.current }).then(() => { setDirty(false); then(); }).catch((e) => say(`ما انحفظ حلك: ${(e as Error).message}`)).finally(() => setBusy("")); return; }
    if (!dirty || isBlank()) { then(); return; }
    setAsk({ text: "تريد تحفظ الشرح قبل؟", buttons: [
      { t: "احفظ", kind: "ok", run: () => saveDialog(then) },
      { t: "لا تحفظ", kind: "bad", run: () => { setAsk(null); then(); } },
      { t: "رجوع", kind: "gray", run: () => setAsk(null) },
    ] });
  };
  const newLesson = () => guard(() => { rememberLast(""); loadLesson(applyLook({ ...emptyLesson(geo.current.W, set.board, set.frame), head: set.head }, set), "", ""); });

  // ---------- الحفظ والفتح
  async function save(name: string, after?: () => void) {
    setBusy("جاري الحفظ...");
    try {
      const l = { ...lesson.current, title: name };
      // الخلفيات اللي بعدها بالجهاز بس (blob/data) لازم ترتفع أول
      const local = (r?: string | null) => !!r && (r.startsWith("blob:") || r.startsWith("data:"));
      const up = async (r: string) => { const b = await (await fetch(r)).blob(); const ref = await upload(b); imgs.current.set(ref, imgs.current.get(r)!); return ref; };
      for (const pg of l.pages) {
        if (local(pg.bg)) pg.bg = await up(pg.bg!);
        for (const it of pg.items) if (it.k === "img" && local(it.r)) it.r = await up(it.r);
      }
      const r = await api({ action: "save", id: lessonId, title: name, lesson: l });
      setLessonId(r.id); setTitle(name); setSt(r); setDirty(false);
      lessonIdRef.current = r.id; dirtyRef.current = false; rememberLast(r.id);
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
  // 📎 من ملحقات المحاضرة بالتطبيق: نفس شروحات الأستاذ، نسخته هو
  async function openSolve(id: string) {
    setPop(""); setBusy("جاري فتح الأسئلة...");
    try {
      await deviceId();
      const r = await api({ action: "solveGet", lec: id });
      const qs = r.lec.items as { book: number; page: number }[];
      const ref = (q: { book: number; page: number }) => `q:${q.book}:${q.page}`;
      let l = r.lesson ? cleanLesson(r.lesson) : null;
      if (!l) l = { v: 1, w: PAPER_W, board: "#FFFFFF", frame: "none", head: "none", pages: qs.map((q) => ({ items: [], bg: ref(q) })) };
      else {
        // سؤال جديد انضاف للملزمة: ينضاف آخر الحل
        const have = new Set(l.pages.map((p) => p.bg));
        for (const q of qs) if (!have.has(ref(q))) l.pages.push({ items: [], bg: ref(q) });
        l.w = PAPER_W; l.frame = "none"; l.head = "none";
      }
      paper.current = true;
      setSolve({ id, title: `${r.lec.topic} · ${r.lec.title}` });
      layout();
      loadLesson(l, "", `حلّي · ${r.lec.title}`);
      setColor("#000000");
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  async function openAtt(id: string) {
    setPop(""); setBusy("جاري فتح الشرح...");
    try {
      const r = await api({ action: "att", id });
      const l = cleanLesson(r.lesson)!;
      loadLesson(l, "", r.title ?? l.title ?? "شرح الأستاذ");
      setDirty(!st?.teacher);
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  const unsend = (m: Meta) => setAsk({ text: `تسحب «${m.title}»؟ ينشال من شروحات الطلاب${m.app ? " ومن ملحقات المحاضرة بالتطبيق" : ""}. اللي حفظوه بسبوراتهم يبقى إلهم.`, buttons: [
    { t: "اسحبه", kind: "bad", run: () => { setAsk(null); setBusy("لحظة..."); void api({ action: "unsend", id: m.id }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); } },
    { t: "رجوع", kind: "gray", run: () => setAsk(null) },
  ] });
  const lqRun = (action: string) => { setBusy("لحظة، يمر على كل المحاضرات..."); void api({ action }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); };
  const setAppMode = (env: string) => { setBusy("لحظة..."); void api({ action: "appmode", env }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); };
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
      const target = areaOf(lesson.current.frame, geo.current.W).h * geo.current.scale * geo.current.dpr * 1.5;
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
      await placeCanvas(c, 0.6, await canvasBlob(c));
    } catch (e) { say(`صار خطأ: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  /** الصورة تنحط بنص السبورة كشي يتحرك ويكبر ويصغر (أداة «تحريك»). frac: كم تاخذ من العرض. at: مكانها (فوك البطن مثلاً) */
  async function placeCanvas(c: HTMLCanvasElement, frac: number, blob?: Blob, at?: "top") {
    const b = blob ?? await new Promise<Blob>((ok, bad) => c.toBlob((x) => (x ? ok(x) : bad(new Error("ما گدرت أسوي الصورة"))), "image/png"));
    const r = URL.createObjectURL(b);
    const A = areaOf(lesson.current.frame, geo.current.W), aw = A.w, ah = A.h;
    const k2 = Math.min(aw * frac / c.width, ah * 0.6 / c.height);
    const top = A.y + (headOf(lesson.current.head) !== "none" ? 96 : 24);
    const it: Item = { k: "img", r, w: c.width * k2, h: c.height * k2, x: A.x + (aw - c.width * k2) / 2, y: at === "top" ? top : A.y + (ah - c.height * k2) / 2 };
    page().items.push(it);
    pending.current = { add: [it], remove: [] }; commit();
    setTool("move"); setSel([it]);
    redrawInk(); redrawLive();
  }
  // ---------- 📈 رسم دالة: المحاور والتدريج بلون الكتابة، والمنحني بلون القلم، كلها خطوط تتحرك وتنمسح
  const [plotEq, setPlotEq] = useState("x^2-4x+3");
  const [plotFrom, setPlotFrom] = useState("-5");
  const [plotTo, setPlotTo] = useState("5");
  const [plotY, setPlotY] = useState(["", ""]);
  const doPlot = () => {
    try {
      const A = areaOf(lesson.current.frame, geo.current.W);
      const w = Math.min(A.w * 0.55, 1000), h = Math.min(A.h * 0.62, 620);
      const box = { x: A.x + (A.w - w) / 2, y: A.y + (A.h - h) / 2 + 20, w, h };
      const num = (v: string) => Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[−–]/g, "-"));
      const yr = plotY[0].trim() && plotY[1].trim() ? [num(plotY[0]), num(plotY[1])] as [number, number] : undefined;
      const out = plot(plotEq, num(plotFrom), num(plotTo), box, set.width, yr);
      const axisC = isLight(lesson.current.board) ? "#141F33" : "#FFFFFF";
      const curveC = color.toUpperCase() === axisC ? "#F6C94A" : color;
      const x = ctxOf(liveC.current)!;
      const items: Item[] = [
        ...out.strokes.map((st): Item => ({ k: "ink", c: st.axis ? axisC : curveC, w: st.w, p: st.p, fit: 0 })),
        ...out.labels.map((lb): Item => { const lay = textLines(x, lb.t, lb.s, lb.x + 400); return { k: "text", c: axisC, s: lb.s, x: lb.x + lay.w, y: lb.y, t: lb.t, bw: lay.w, bh: lay.h }; }),
      ];
      page().items.push(...items);
      pending.current = { add: items, remove: [] }; commit();
      setPop(""); setTool("move"); setSel(items);
      redrawInk(); redrawLive();
    } catch (e) { say(`📈 ${(e as Error).message}`); }
  };
  // ---------- 📦 الصناديق والأختام وصفحة الغلاف
  const [boxText, setBoxText] = useState("");
  useEffect(() => { titleNow.current = title; redrawInk(); }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  const addBox = (k: BoxKind) => { setPop(""); void placeCanvas(makeBox(k, boxText.trim(), isLight(lesson.current.board)), k === "title" ? 0.8 : 0.78, undefined, k === "title" ? "top" : undefined).catch((e) => say(`صار خطأ: ${(e as Error).message}`)); };
  const addStamp = (id: string) => { setPop(""); void placeCanvas(makeStamp(id), 0.22).catch((e) => say(`صار خطأ: ${(e as Error).message}`)); };
  const addCover = () => {
    setPop("");
    const t = title || boxText.trim() || "شرح جديد";
    const c = makeCover(t, new Date().toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" }), logo.current, isLight(lesson.current.board));
    addPage(null, 0);
    void placeCanvas(c, 0.72).then(() => say("📄 انضافت صفحة الغلاف أول صفحة")).catch((e) => say(`صار خطأ: ${(e as Error).message}`));
  };
  // ---------- ✨ اللمسات الشخصية: تنحفظ بالشرح وبالإعدادات (الشرح الجديد ياخذها)
  const setLook = (p: Partial<Pick<Settings, "wm" | "grid" | "foot">>) => {
    setSet((s) => { const n = { ...s, ...p }; applyLook(lesson.current, n); return n; });
    applyLook(lesson.current, { ...set, ...p });
    markDirty(); redrawFrame(); redrawInk();
  };

  // ---------- الطباعة: كل الصفحات بإطارها وخلفيتها
  async function printAll() {
    setBusy("جاري تحضير الطباعة...");
    try {
      const Wn = geo.current.W, k = 1.25;
      const urls: string[] = [];
      for (const pg of lesson.current.pages) {
        const c = document.createElement("canvas"); c.width = Math.round(Wn * k); c.height = Math.round(H * k);
        const x = c.getContext("2d")!; x.scale(k, k);
        paintFrame(x, Wn, lesson.current.board, lesson.current.frame, logo.current, lesson.current.head, lesson.current);
        for (const it of pg.items) if (it.k === "img") { const im = bgOf(it.r); if (im && !im.complete) await new Promise((r) => { im.onload = r; im.onerror = r; }); }
        const bg = bgOf(pg.bg);
        if (bg && !bg.complete) await new Promise((r) => { bg.onload = r; bg.onerror = r; });
        drawPage(x, Wn, lesson.current.frame, pg.items, bg, bgOf);
        if (lesson.current.foot) drawFoot(x, Wn, lesson.current.frame, lesson.current.board, lesson.current.pages.indexOf(pg) + 1, lesson.current.pages.length, title);
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
    if (!lessonIdRef.current || dirtyRef.current) { setAsk({ text: "احفظ الشرح أول حتى تدزه", buttons: [{ t: "احفظ", kind: "ok", run: () => saveDialog(() => window.setTimeout(sendDialog, 50)) }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] }); return; }
    // الفصل ← الموضوع ← المحاضرة، وبعدها يگله العدد ويسأله تريد تدزه؟
    setBusy("لحظة...");
    void api({ action: "targets" }).then((r: { chapters: Target[]; app?: string }) => {
      setBusy("");
      if (r.app) { appChapters(r.chapters as unknown as AppCh[], r.app); return; }
      const chs = r.chapters.length ? r.chapters : [1, 2, 3, 4, 5].map((ch) => ({ ch, name: "", topics: [] }));
      setAsk({ text: "بأي فصل ينزل الشرح؟", buttons: [
        ...chs.map((c) => ({ t: `الفصل ${ORD[c.ch]}`, kind: "gray" as const, run: () => pickTopic(c) })),
        { t: "رجوع", kind: "gray", run: () => setAsk(null) },
      ] });
    }).catch((e) => { setBusy(""); say(`صار خطأ: ${(e as Error).message}`); });
  };
  const pickTopic = (c: Target) => {
    if (!c.topics.length) { void confirmSend(c.ch, null, 0); return; }
    setAsk({ text: `الفصل ${ORD[c.ch]}: بأي موضوع؟`, buttons: [
      ...c.topics.map((t) => ({ t: t.name, kind: "gray" as const, run: () => pickLecture(c, t) })),
      { t: "بدون موضوع", kind: "gray", run: () => void confirmSend(c.ch, null, 0) },
      { t: "رجوع", kind: "gray", run: () => sendDialog() },
    ] });
  };
  const pickLecture = (c: Target, t: Target["topics"][number]) => {
    if (t.lectures <= 0) { void confirmSend(c.ch, t, 0); return; }
    setAsk({ text: `${t.name}: ويا أي محاضرة؟`, buttons: [
      ...Array.from({ length: t.lectures }, (_, k) => ({ t: `المحاضرة ${k + 1}`, kind: "gray" as const, run: () => void confirmSend(c.ch, t, k + 1) })),
      { t: "كل الموضوع", kind: "gray", run: () => void confirmSend(c.ch, t, 0) },
      { t: "رجوع", kind: "gray", run: () => pickTopic(c) },
    ] });
  };
  // ---------- محاضرات التطبيق: الفصل ← الموضوع ← عربي/انگليزي ← المحاضرة، والشرح ينزل بملحقاتها
  const appChapters = (chs: AppCh[], env: string) => {
    const test = env === "staging" ? " (داتا التجربة)" : "";
    if (!chs.length) { say("ما لگينا محاضرات بالتطبيق"); return; }
    setAsk({ text: `بملحقات أي محاضرة بالتطبيق${test}؟ أول اختار الفصل`, buttons: [
      ...chs.map((c) => ({ t: `الفصل ${ORD[c.ch]}${c.name ? `: ${c.name}` : ""}`, kind: "gray" as const, run: () => appTopic(chs, env, c) })),
      { t: "رجوع", kind: "gray", run: () => setAsk(null) },
    ] });
  };
  const appTopic = (chs: AppCh[], env: string, c: AppCh) => {
    if (!c.topics.length) { say(`الفصل ${ORD[c.ch]} ما بيه محاضرات بالتطبيق بعد`); return; }
    setAsk({ text: `الفصل ${ORD[c.ch]}: بأي موضوع؟`, buttons: [
      ...c.topics.map((t) => ({ t: t.name, kind: "gray" as const, run: () => appTrack(chs, env, c, t) })),
      { t: "رجوع", kind: "gray", run: () => appChapters(chs, env) },
    ] });
  };
  const appTrack = (chs: AppCh[], env: string, c: AppCh, t: AppTopic) => {
    const tracks = (["arabic", "english"] as const).filter((k) => t.lectures.some((l) => l.track === k));
    if (tracks.length === 1) { appLecture(chs, env, c, t, tracks[0]); return; }
    setAsk({ text: `${t.name}: الشرح لمحاضرات العربي، لو الانگليزي، لو الاثنين؟`, buttons: [
      ...tracks.map((k) => ({ t: TRACK[k], kind: "gray" as const, run: () => appLecture(chs, env, c, t, k) })),
      { t: "الاثنين (عربي وانگليزي)", kind: "gray" as const, run: () => appLecture(chs, env, c, t, "arabic", true) },
      { t: "رجوع", kind: "gray", run: () => appTopic(chs, env, c) },
    ] });
  };
  // both (طلبه 2026-11-26): يختار المحاضرة مرة وحدة، والانگليزي بنفس رقمها بنفس الموضوع ينختار وحده
  // (مراجعة ويا مراجعة). إذا ما لگاها، يسأله عن الانگليزي مثل قبل
  const lecNo = (l: AppLec) => `${/مراجع|review/i.test(l.title) ? "r" : ""}${(l.title.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+/) ?? [""])[0]}`;
  const pairOf = (t: AppTopic, ar: AppLec) => { const no = lecNo(ar); return no ? t.lectures.find((l) => l.track === "english" && lecNo(l) === no) ?? null : null; };
  const appLecture = (chs: AppCh[], env: string, c: AppCh, t: AppTopic, k: "arabic" | "english", both = false, first?: AppLec) => {
    setAsk({ text: `${t.name}${both && k === "arabic" ? " (عربي وانگليزي)" : ` (${TRACK[k]})`}: ويا أي محاضرة؟${both ? (k === "arabic" ? " (ينزل بنفسها بالانگليزي هم)" : ` (ما لگيت نفسها بالانگليزي، اختارها. العربي: ${first?.title})`) : ""}`, buttons: [
      ...t.lectures.filter((l) => l.track === k).map((l) => ({ t: `${l.title}${l.draft ? " (مسودة)" : ""}`, kind: "gray" as const, run: () => {
        if (both && k === "arabic") { const en = pairOf(t, l); if (en) void confirmApp(c.ch, t, [l, en], env); else appLecture(chs, env, c, t, "english", true, l); }
        else void confirmApp(c.ch, t, first ? [first, l] : [l], env);
      } })),
      { t: "رجوع", kind: "gray", run: () => appTrack(chs, env, c, t) },
    ] });
  };
  async function confirmApp(ch: number, t: AppTopic, ls: AppLec[], env: string) {
    setAsk(null); setBusy("لحظة...");
    try {
      const { count } = await api({ action: "count", chapter: ch });
      setBusy("");
      const where = `الفصل ${ORD[ch]} · ${t.name} · ${ls.map((l) => `${l.title} (${TRACK[l.track]})`).join(" و ")}`;
      void count;
      setAsk({ text: `تريد أدز «${title}»؟ ينزل بملحقات «${where}» بالتطبيق${env === "staging" ? " (داتا التجربة)" : ""}. الطلاب يلگوه جوه المحاضرة، بلا رسالة.`, buttons: [
        { t: "إي، دزه", kind: "ok", run: () => { setAsk(null); setBusy("جاري الإرسال..."); void api({ action: "send", id: lessonIdRef.current, appLecture: ls.map((l) => l.id) }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); } },
        { t: "لا", kind: "bad", run: () => setAsk(null) },
      ] });
    } catch (e) { setBusy(""); say(`صار خطأ: ${(e as Error).message}`); }
  }
  async function confirmSend(ch: number, t: Target["topics"][number] | null, lec: number) {
    setAsk(null); setBusy("لحظة...");
    try {
      const { count } = await api({ action: "count", chapter: ch });
      setBusy("");
      if (!count) { say(`ماكو طلاب اشتروا محاضرات الفصل ${ORD[ch]}`); return; }
      const where = [`الفصل ${ORD[ch]}`, t?.name, lec ? `المحاضرة ${lec}` : ""].filter(Boolean).join(" · ");
      setAsk({ text: `تريد أدز «${title}» (${where}) لـ ${count} طالب اشتروا محاضرات الفصل ${ORD[ch]}؟`, buttons: [
        { t: "إي، دزه", kind: "ok", run: () => { setAsk(null); setBusy("جاري الإرسال..."); void api({ action: "send", id: lessonIdRef.current, chapter: ch, topic: t?.id ?? 0, lecture: lec }).then((r) => { setSt(r); say(r.notice); }).catch((e) => say(`صار خطأ: ${(e as Error).message}`)).finally(() => setBusy("")); } },
        { t: "لا", kind: "bad", run: () => setAsk(null) },
      ] });
    } catch (e) { setBusy(""); say(`صار خطأ: ${(e as Error).message}`); }
  }

  // ---------- المايك
  const [outro, setOutro] = useState(false);
  const exit = () => guard(() => { setPop(""); setOutro(true); });
  // الطلوع ما يمسح اللي قدامه (طلبه 2026-11-27: «تطلع لي الشاشة اللي طلعت منها، بآخر إعدادات اخترتها»):
  // اللي بالشاشة يبقى مسودة بالجهاز، ومن يرجع ينفتح نفسه. «شرح جديد» أو فتح شرح ثاني يبدله
  const doExit = () => { if (dirty && !solve) keepDraft(); setDirty(false); if (history.length > 1) history.back(); else window.close(); window.setTimeout(() => setOutro(false), 1500); };
  // «−»: الأدوات تنزل وشريط المتصفح (اللي بيه الرابط) يختفي هم، حتى الطلاب ما يشوفون الرابط بالشاشة أو بالتصوير (طلبه 2026-11-27).
  // ما يطلّع من ملء الشاشة أبداً (قبل جان «−» يطلّع منها فيبين الرابط). بنافذة السبورة لحالها (أيقونة اللابتوب) ماكو رابط أصلاً،
  // فما تصير ملء الشاشة حتى يبقى زر تصغير الويندوز «−» فوگ ظاهر

  const hideBrowser = () => { try { if (!document.fullscreenElement && window.locationbar?.visible !== false) void document.documentElement.requestFullscreen?.().catch(() => { /* الآيباد */ }); } catch { /* */ } };
  const fullScreen = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } catch { /* */ } };

  function keepDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(lesson.current)); localStorage.setItem(META_KEY, JSON.stringify({ id: lessonId, title })); } catch { /* كبير، يبقى بس بالسيرفر */ } }
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
  const headOn = (id: string) => (id.startsWith("cv-") ? set.head.startsWith(id.replace(/-[a-z]+$/, "-")) : set.head === id);
  const pickHead = (id: string) => setHead(id.startsWith("cv-") ? id.replace(/-[a-z]+$/, `-${curveOf(set.head)?.col.id.slice(3) ?? "navy"}`) : id);
  const pickCurveColor = (col: string) => setHead(`cv-${curveOf(set.head)?.shape ?? CURVES[0].id}-${col}`);
  const setHead = (h: string) => { lesson.current.head = h; setSet((s) => ({ ...s, head: h })); markDirty(); redrawFrame(); };
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
  const [heads, setHeads] = useState<Record<string, string>>({});
  useEffect(() => {
    if (pop !== "board") return;
    if (!Object.keys(previews).length) setPreviews(Object.fromEntries(frames.map((f) => [f.id, framePreview(f.id)])));
    setHeads(Object.fromEntries(HEADS.map((h) => [h.id, headPreview(h.id, logo.current, set.board)])));
  }, [pop, set.board]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qb" dir="rtl" onContextMenu={(e) => e.preventDefault()}>
      <style>{CSS}</style>
      <div className="qb-area" ref={wrap}>
        <canvas ref={frameC} className="qb-c" />
        <canvas ref={inkC} className="qb-c" />
        <canvas ref={liveC} className="qb-c qb-live" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp} />
        {placing && <div className="qb-hint">دوس بالمكان اللي تريد تبدي منه، واسحب لليسار لو لليمين: يطلع مربع بحدود الكتابة، ومن ترفع إصبعك تنحط</div>}
        {newVer && <button type="button" className="qb-upd" onClick={() => { if (!solve) keepDraft(); location.reload(); }}>🔄 أكو تحديث جديد للسبورة. دوس هنا حتى يتحدث (كتابتك تبقى)</button>}
        {tool === "move" && !selN && <div className="qb-hint">دوس على كتابة أو صورة، أو اسحب مربع حوالين اللي تريد تحركه. الكتابة تگدر تعدلها بـ«✏️ عدّل الكتابة»</div>}
        {tool === "move" && selN > 0 && <div className="qb-selbar">
          <span>اسحبه لمكان ثاني، أو كبّره من الدوائر الذهبية</span>
          {selN === 1 && sel.current[0]?.k === "text" && <button type="button" onClick={() => { const it = sel.current[0]; if (it?.k === "text") { setEditIt(it); setMic(true); } }}>✏️ عدّل الكتابة</button>}
          <button type="button" className="bad" onClick={deleteSel}>🗑 احذف</button>
          <button type="button" onClick={() => { setSel([]); redrawLive(); }}>✖ خلص</button>
        </div>}
      </div>

      {barDown && <button type="button" className="qb-tab" aria-label="طلع الأدوات" onClick={() => setBarDown(false)}>⌃ الأدوات</button>}
      <div className="qb-bar" style={barDown ? { display: "none" } : undefined}>
        <div className="qb-grp">
          <Btn id="menu" icon={IC.menu} t="القائمة" on={pop === "menu"} run={(el) => open("menu", el)} />
          <Btn icon={IC.pdf} t="فتح PDF" run={() => pdfInput.current?.click()} />
          <span className="qb-sep" />
          <Btn icon={IC.pen} t="قلم" on={tool === "pen"} run={() => pickTool("pen")} />
          <Btn icon={IC.hl} t="تظليل" on={tool === "hl"} run={() => pickTool("hl")} />
          <Btn id="eraser" icon={<span className="qb-logo-ic"><img src="/app-logo.png" alt="" /></span>} t="ممحاة" on={tool === "eraser"} run={(el) => { pickTool("eraser"); open("eraser", el); }} />
          <Btn icon={IC.hand} t="تحريك" on={tool === "move"} run={() => pickTool("move")} />
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
          {canMin && <Btn icon={<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 9v6M9 12l3 3 3-3" /></svg>} t="صغّر السبورة" run={minimize} />}
          <Btn icon={IC.min} t="نزّل الأدوات" run={() => { setPop(""); setBarDown(true); hideBrowser(); }} />
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
            <button type="button" onClick={() => setPop("boxes")}>📦 صناديق جاهزة وأختام</button>
            <button type="button" onClick={addCover}>📄 صفحة غلاف للشرح</button>
            <button type="button" onClick={() => { setPop(""); void printAll(); }}>طباعة / حفظ كـ PDF</button>
            {lesson.current.pages[pageIx.current]?.bg && <button type="button" onClick={() => { setPop(""); setAsk({ text: "تشيل صفحة الملف (الخلفية) من هاي الصفحة؟ كتابتك تبقى", buttons: [{ t: "شيلها", kind: "bad", run: () => { setAsk(null); page().bg = null; markDirty(); redrawInk(); } }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] }); }}>شيل الخلفية من هاي الصفحة</button>}
            <button type="button" onClick={() => { setPop(""); setAsk({ text: "تحذف هاي الصفحة؟", buttons: [{ t: "احذف", kind: "bad", run: () => { setAsk(null); deletePage(); } }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] }); }}>حذف هاي الصفحة</button>
            {st?.teacher && <button type="button" className="gold" onClick={sendDialog}>📤 إرسال للطلاب</button>}
            {st?.teacher && <button type="button" onClick={() => setPop("sent")}>📋 الشروح اللي دزيتها{st.sent.length ? ` (${st.sent.length})` : ""}</button>}
            {st && !st.teacher && <button type="button" className="gold" onClick={() => setPop("inbox")}>📥 شروحات الأستاذ{st.inbox.length ? ` (${st.inbox.length})` : ""}</button>}
            <button type="button" onClick={() => setPop("settings")}>إعدادات الكف والممحاة</button>
            <button type="button" onClick={() => { setPop(""); fullScreen(); }}>ملء الشاشة / نافذة</button>
          </div>}
          {pop === "colors" && <><div className="qb-ptitle">اختار لون القلم</div><div className="qb-pal">{PAL.map((c, i) => <button key={i} type="button" aria-label="لون" className={color.toUpperCase() === c ? "on" : ""} style={{ background: c }} onClick={() => pickColor(c)} />)}</div></>}
          {pop === "eraser" && <><div className="qb-ptitle">حجم الممحاة</div><div className="qb-row">{ERASERS.map((x) => <button key={x.n} type="button" className={`qb-chip${set.eraser === x.n ? " on" : ""}`} onClick={() => { setSet((s) => ({ ...s, eraser: x.n })); setPop(""); }}><i style={{ width: x.n / 4, height: x.n / 4 }} />{x.t}</button>)}</div></>}
          {pop === "shapes" && <button type="button" className="qb-chip gold" onClick={() => setPop("plot")}>📈 رسم دالة (تكتب المعادلة وترسمها)</button>}
          {pop === "plot" && <div className="qb-list">
            <div className="qb-ptitle">📈 رسم دالة</div>
            <input className="qb-in" dir="ltr" value={plotEq} onChange={(e) => setPlotEq(e.target.value)} placeholder="y = x^2 - 4x + 3" />
            <div className="qb-row qb-wrap"><span className="qb-note">x من</span><input className="qb-in qb-num" dir="ltr" inputMode="decimal" value={plotFrom} onChange={(e) => setPlotFrom(e.target.value)} /><span className="qb-note">إلى</span><input className="qb-in qb-num" dir="ltr" inputMode="decimal" value={plotTo} onChange={(e) => setPlotTo(e.target.value)} /></div>
            <div className="qb-row qb-wrap"><span className="qb-note">y من</span><input className="qb-in qb-num" dir="ltr" inputMode="decimal" placeholder="وحده" value={plotY[0]} onChange={(e) => setPlotY([e.target.value, plotY[1]])} /><span className="qb-note">إلى</span><input className="qb-in qb-num" dir="ltr" inputMode="decimal" placeholder="وحده" value={plotY[1]} onChange={(e) => setPlotY([plotY[0], e.target.value])} /></div>
            <div className="qb-row qb-wrap">{["x^2-4x+3", "x^3-3x", "sin(x)", "1/x", "sqrt(x)", "|x-1|", "2^x", "ln(x)"].map((q) => <button key={q} type="button" className="qb-chip" dir="ltr" onClick={() => setPlotEq(q)}>{q}</button>)}</div>
            <button type="button" className="qb-chip gold" onClick={doPlot}>ارسمها</button>
            <div className="qb-note">الرسمة تنحط بنص السبورة ومختارة: اسحبها وكبّرها، والمنحني بلون قلمك. ^ للأس، sqrt للجذر، |…| للمطلقة، pi للـ π.</div>
          </div>}
          {(pop === "shapes" || pop === "solids") && <div className="qb-row qb-wrap">{(pop === "shapes" ? SHAPES : SOLIDS).map((x) => <button key={x.id} type="button" className={`qb-chip${tool === "shape" && shape === x.id ? " on" : ""}`} onClick={() => { setShape(x.id); pickTool("shape"); }}><ShapeIcon id={x.id} />{x.t}</button>)}</div>}
          {pop === "board" && <div className="qb-boardpick">
            <div className="qb-ptitle">لون السبورة</div>
            <div className="qb-row qb-wrap">{BOARDS.map((b) => <button key={b.c} type="button" aria-label={b.t} title={b.t} className={`qb-sw${set.board.toUpperCase() === b.c ? " on" : ""}`} style={{ background: b.c }} onClick={() => setBoard(b.c)} />)}
              <label className="qb-sw qb-custom" title="لون ثاني">🎨<input type="color" value={set.board} onChange={(e) => setBoard(e.target.value.toUpperCase())} /></label></div>
            <div className="qb-ptitle">الهيدر (اسمك واللوگو فوك)</div>
            <div className="qb-heads">{HEADS.map((h) => <button key={h.id} type="button" className={headOn(h.id) ? "on" : ""} onClick={() => pickHead(h.id)}>{heads[h.id] ? <img src={heads[h.id]} alt="" /> : <span className="qb-noprev" />}<span>{h.t}</span></button>)}</div>
            <div className="qb-ptitle">🌙 لون الهيدر المقوس</div>
            <div className="qb-row qb-wrap">{NOTEBOOK.map((n) => <button key={n.id} type="button" title={n.t} aria-label={n.t} className={`qb-sw${curveOf(set.head)?.col.id === n.id ? " on" : ""}`} style={{ background: `linear-gradient(${n.bg2},${n.bg})` }} onClick={() => pickCurveColor(n.id.slice(3))} />)}</div>
            <div className="qb-ptitle">✨ لمسات شخصية</div>
            <div className="qb-row qb-wrap">
              <button type="button" className={`qb-chip${set.wm ? " on" : ""}`} onClick={() => setLook({ wm: !set.wm })}>لوگوك خفيف بالخلفية</button>
              <button type="button" className={`qb-chip${set.foot ? " on" : ""}`} onClick={() => setLook({ foot: !set.foot })}>سطر تحت الصفحة</button>
            </div>
            <div className="qb-row qb-wrap"><span className="qb-note">الورق:</span>{GRIDS.map((g) => <button key={g.id} type="button" className={`qb-chip${(set.grid ?? "") === g.id ? " on" : ""}`} onClick={() => setLook({ grid: g.id })}>{g.t}</button>)}</div>
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
            {st?.inbox.map((m) => <div key={m.id} className="qb-li"><button type="button" onClick={() => guard(() => void openInbox(m.id))}><b>{m.title}</b><small>{whereOf(m)} · {m.pages} صفحة · {m.at}</small></button></div>)}
          </div>}
          {pop === "sent" && <div className="qb-list">
            <div className="qb-ptitle">📎 ينزل الشرح بملحقات محاضرات التطبيق؟</div>
            <div className="qb-row">{[["", "لا، رسالة بس"], ["staging", "تجربة"], ["prod", "إي، بالتطبيق"]].map(([v, t]) => <button key={v} type="button" className={`qb-chip${(st?.appEnv ?? "") === v ? " on" : ""}`} onClick={() => setAppMode(v)}>{t}</button>)}</div>
            <div className="qb-note">«تجربة» تنزل بداتا تجربة التطبيق بس (حساب طالب التجربة)، و«إي، بالتطبيق» تنزل للطلاب الحقيقيين جوه المحاضرة ← الملحقات.</div>
            {st?.appEnv && <>
              <div className="qb-ptitle">📘✍️ أسئلة المحاضرات بالملحقات</div>
              <div className="qb-row qb-wrap">
                <button type="button" className="qb-chip gold" onClick={() => lqRun("lqSync")}>حط «📘 الملزمة» و«✍️ حلّي» بكل محاضرة إلها أسئلة</button>
                {!!st.lqCount && <button type="button" className="qb-chip" onClick={() => setAsk({ text: `تشيل الزرين من ${st.lqCount} محاضرة؟ حلول الطلاب تبقى محفوظة.`, buttons: [{ t: "شيلهن", kind: "bad", run: () => { setAsk(null); lqRun("lqClear"); } }, { t: "رجوع", kind: "gray", run: () => setAsk(null) }] })}>🗑 شيلهن ({st.lqCount})</button>}
              </div>
              <div className="qb-note">الأسئلة من «📚 ملازمي» (الوزاري والإثرائي)، كل محاضرة أسئلتها حسب فهرس الملزمة. إذا بدلت ملزمة تتبدل وحدها. المحاضرات الجديدة: دوس الزر مرة ثانية.</div>
            </>}
            <div className="qb-ptitle">📋 الشروح اللي دزيتها</div>
            {!st?.sent.length && <div className="qb-empty">بعدك ما دزيت شرح</div>}
            {st?.sent.map((m) => <div key={m.id} className="qb-li"><button type="button" onClick={() => guard(() => void openAtt(m.id))}><b>{m.title}{m.app ? " 📎" : ""}</b><small>{whereOf(m)}{m.app === "staging" ? " · تجربة" : ""} · {m.at}</small></button><button type="button" className="qb-x" aria-label="اسحبه" onClick={() => unsend(m)}>🗑</button></div>)}
          </div>}
          {pop === "boxes" && <div className="qb-list">
            <div className="qb-ptitle">📦 صناديق من دفترك</div>
            <input className="qb-in" value={boxText} onChange={(e) => setBoxText(e.target.value)} placeholder="عنوان المحاضرة (للشريط)، مثلاً: المحاضرة 1 · المشتقة" />
            <div className="qb-row qb-wrap">{BOXES.map((b) => <button key={b.id} type="button" className="qb-chip" onClick={() => addBox(b.id)}>{b.t}</button>)}</div>
            <div className="qb-ptitle">🔖 أختام</div>
            <div className="qb-row qb-wrap">{STAMPS.map((x) => <button key={x.id} type="button" className="qb-chip" style={{ color: x.c, borderColor: x.c }} onClick={() => addStamp(x.id)}>{x.t}</button>)}</div>
            <div className="qb-note">الصندوق ينحط بنص السبورة ومختار: اسحبه وكبّره من الزوايا، واكتب جواه بالقلم.</div>
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

      {mic && <MicPanel teacher={!!st?.teacher} init={editIt ? { t: editIt.t, s: editIt.s } : undefined} onCancel={() => { setMic(false); setEditIt(null); }} onPlace={(t, s) => {
        setMic(false);
        const ed = editIt; setEditIt(null);
        if (!t.trim()) return;
        if (ed) { saveEdit(ed, t.trim(), s); return; }
        pendingText.current = { t: t.trim(), s }; setPlacing(true);
      }} />}
      {ask && <div className="qb-modal"><div className="qb-dlg">
        <div className="qb-dtext">{ask.text}</div>
        {ask.input && <AskInput init={ask.input.value} set={ask.input.set} />}
        <div className="qb-dbtns">{ask.buttons.map((b) => <button key={b.t} type="button" className={b.kind} onClick={b.run}>{b.t}</button>)}</div>
      </div></div>}
      {busy && <div className="qb-modal"><div className="qb-dlg"><div className="qb-dtext">{busy}</div></div></div>}
      {toast && <div className="qb-toast">{toast}</div>}
      {splash && <Splash slogan={SLOGAN} onDone={() => setSplash(false)} />}
      {outro && <Outro onDone={doExit} />}
      {/* ✍️ سبورة الحل: فيديو الحل والتوضيح مال السؤال اللي قدامه (طلبه 2026-11-27) */}
      {solve && <SolveVids bg={lesson.current.pages[pageInfo.i]?.bg ?? ""} />}
      <span hidden>{W}</span>
    </div>
  );
}

/** 🎬 أزرار فيديو حل السؤال وتوضيحه بسبورة الحل: نفس أزرار الملزمة، للسؤال اللي بالصفحة هسه */
type VMark = { id: number; page: number; video: boolean; solution: boolean; q?: string };
const marksCache = new Map<number, Promise<VMark[]>>();
async function notesCall(body: Record<string, unknown>) {
  const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: pageToken(), device: await deviceId(), pf: platformNow(), ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
  return j;
}
function SolveVids({ bg }: { bg: string }) {
  const m = /^q:(\d+):(\d+)$/.exec(bg);
  const book = m ? Number(m[1]) : 0, page = m ? Number(m[2]) : 0;
  const [ms, setMs] = useState<VMark[]>([]);
  const [vid, setVid] = useState<{ title: string; yt?: string; src?: string; kind: string } | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!book) { setMs([]); return; }
    if (!marksCache.has(book)) marksCache.set(book, notesCall({ action: "marks", book }).then((j) => (j.marks ?? []) as VMark[]).catch(() => []));
    let on = true;
    void marksCache.get(book)!.then((all) => { if (on) setMs(all.filter((x) => x.page === page && (x.solution || x.video))); });
    return () => { on = false; };
  }, [book, page]);
  async function play(x: VMark, kind: "video" | "solution") {
    setMsg("⏳ دا يفتح الفيديو...");
    try {
      const j = await notesCall({ action: "play", book, mark: x.id, kind });
      if (j.yt) { setVid({ title: "🎬 فيديو حل السؤال", yt: j.yt, kind }); setMsg(""); }
      else if (j.clip) { setVid({ title: "▶️ فيديو توضيح السؤال", src: `/api/notes/video?t=${encodeURIComponent(pageToken())}&book=${book}&mark=${x.id}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}`, kind }); setMsg(""); }
      else setMsg(j.notice ?? "");
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); }
  }
  if (!ms.length && !vid && !msg) return null;
  return (
    <>
      {ms.length > 0 && <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 30, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: "70vw" }}>
        {ms.map((x) => <span key={x.id} style={{ display: "contents" }}>
          {x.solution && <button type="button" onClick={() => void play(x, "solution")} style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: 0, background: "#141F33", color: "#F6C94A", font: "inherit", fontWeight: 800 }}>🎬 فيديو الحل{ms.length > 1 && x.q ? ` ${x.q}` : ""}</button>}
          {x.video && <button type="button" onClick={() => void play(x, "video")} style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: 0, background: "#141F33", color: "#F6C94A", font: "inherit", fontWeight: 800 }}>▶️ توضيح{ms.length > 1 && x.q ? ` ${x.q}` : ""}</button>}
        </span>)}
      </div>}
      {msg && <div className="qb-toast">{msg}</div>}
      {vid && <VideoBox title={vid.title} yt={vid.yt} src={vid.src} back="✖ سد وارجع للحل" onClose={() => setVid(null)} onFail={(code) => void notesCall({ action: "videoError", book, kind: vid.kind, code }).catch(() => undefined)} />}
    </>
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
// المايك (طلبه 2026-11-27): كل لغة بسطرها. يگول «إنگليزي» أو «عربي» (أو يدوس الزر): تتبدل اللغة وينزل سطر.
// الكلمة نفسها ما تنكتب. وبالسبورة الإنگليزي يسار والعربي يمين
const norm = (t: string) => t.trim().toLowerCase().replace(/[.,!?؟،:;"'«»]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ");
function langCmd(t: string): "ar-IQ" | "en-US" | null {
  const n = norm(t);
  if (/^(ال)?ا?ن[جكگق]ل[ي]?ز[ي]?(ه|ة)?$|^(english|inglizi|ingilizi|engilizi)$/.test(n)) return "en-US";
  if (/^(ال)?عربي(ه|ة)?$|^(arabic|arabi|araby|arabee|arab|in arabic|arabic please|arabic language)$/.test(n)) return "ar-IQ";
  return null;
}
function MicPanel({ onCancel, onPlace, teacher, init }: { onCancel: () => void; onPlace: (t: string, size: number) => void; teacher: boolean; init?: { t: string; s: number } }) {
  const [tr, setTr] = useState("");
  const [text, setText] = useState(init?.t ?? "");
  const [size, setSize] = useState(init?.s ?? 56);
  const [lang, setLang] = useState<"ar-IQ" | "en-US">("ar-IQ");
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const rec = useRef<SR | null>(null);
  const done = useRef(init?.t ?? ""); // الكلام اللي خلص وانكتب
  const want = useRef(false);
  const langNow = useRef<"ar-IQ" | "en-US">("ar-IQ");
  // الكلام ينضاف بمكان المؤشر اللي واگف عليه بالمربع (طلبه 2026-11-27: «يضيفها وين واگف»)، وإذا ما داس بالمربع ينضاف بالآخر
  const caret = useRef<number | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const join = (c: string, t: string, at: number | null) => {
    const k = at === null ? c.length : Math.min(Math.max(at, 0), c.length);
    const pre = c.slice(0, k), post = c.slice(k);
    const a = !pre || /\s$/.test(pre) ? "" : " ", b = post && !/^\s/.test(post) ? " " : "";
    return { text: pre + a + t + b + post, end: (pre + a + t).length };
  };
  const add = (t: string) => { const r = join(done.current, t, caret.current); done.current = r.text; if (caret.current !== null) caret.current = r.end; };
  const make = (lg: string) => {
    const C = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!C) { setErr("هذا الجهاز ما يدعم تحويل الكلام لكتابة. جرب متصفح كروم"); return null; }
    const r: SR = new C();
    r.lang = lg; r.continuous = true; r.interimResults = true;
    r.onresult = (e: any) => {
      if (rec.current !== r) return;
      let tmp = "";
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const t = enDigits(String(e.results[i][0].transcript ?? "").trim());
        if (!t) continue;
        if (e.results[i].isFinal) {
          const cmd = langCmd(t);
          if (cmd) { if (cmd !== langNow.current) { switchLang(cmd); return; } continue; }
          add(t);
        } else tmp += (tmp ? " " : "") + t;
      }
      setText(tmp ? join(done.current, tmp, caret.current).text : done.current);
    };
    r.onerror = (e: any) => { if (e?.error === "not-allowed") setErr("لازم تسمح للمايك"); };
    r.onend = () => { if (want.current && rec.current === r) { try { r.start(); } catch { /* */ } } else if (rec.current === r) setOn(false); };
    return r;
  };
  const start = (lg = langNow.current) => {
    setErr("");
    const r = make(lg);
    if (!r) return;
    rec.current = r; want.current = true;
    try { r.start(); setOn(true); } catch {
      // المايك اللي قبله بعده يسكت: محاولة ثانية بعد نص ثانية
      window.setTimeout(() => { if (rec.current !== r) return; try { r.start(); setOn(true); } catch { setErr("المايك ما اشتغل. دوس «🎤 ابدأ الكلام» مرة ثانية"); } }, 500);
    }
  };
  const stop = () => { want.current = false; const r = rec.current; rec.current = null; try { r?.stop(); } catch { /* */ } setOn(false); };
  // تغيير اللغة: الكلام اللي انكتب يبقى، ينزل سطر، والسماع يبدي من جديد باللغة الثانية
  const switchLang = (lg: "ar-IQ" | "en-US") => {
    if (lg === langNow.current) return;
    langNow.current = lg; setLang(lg);
    // ينزل سطر: بالآخر، أو بمكان المؤشر إذا واگف بنص الكلام
    if (done.current.trim()) {
      if (caret.current === null) done.current = done.current.trimEnd() + "\n";
      else {
        const k = caret.current, pre = done.current.slice(0, k).trimEnd(), post = done.current.slice(k).trimStart();
        done.current = post ? `${pre}\n\n${post}` : `${pre}\n`;
        caret.current = pre.length + 1;
      }
    }
    setText(done.current);
    // (طلبه 2026-11-28: «من أحولها عربي ما تكتب عربي») المايك الجديد ما يبدي إلا بعد ما يسكت القديم تماماً،
    // لأن كروم يرفض مايك ثاني والأول بعده شغال، فچان يبقى ساكت. وإذا ما رد، يبدي وحده بعد ثانية
    if (want.current) {
      const r = rec.current; rec.current = null;
      let started = false;
      const go = () => { if (started || !want.current || langNow.current !== lg) return; started = true; start(lg); };
      if (r) { r.onresult = null; r.onerror = null; r.onend = () => window.setTimeout(go, 80); try { r.stop(); } catch { go(); } }
      else go();
      window.setTimeout(go, 1200);
    }
  };
  useEffect(() => () => { want.current = false; try { rec.current?.stop(); } catch { /* */ } }, []);
  // المؤشر يبقى ورا آخر كلمة انضافت، حتى الكلام الجاي يكمل من نفس المكان
  useEffect(() => { const el = box.current; if (el && caret.current !== null && document.activeElement === el) { try { el.setSelectionRange(caret.current, caret.current); } catch { /* */ } } }, [text]);
  return (
    <div className="qb-modal"><div className="qb-dlg qb-mic">
      <div className="qb-ptitle">احچي وتنكتب</div>
      <div className="qb-row">
        <button type="button" className={`qb-chip${lang === "ar-IQ" ? " on" : ""}`} onClick={() => switchLang("ar-IQ")}>عربي</button>
        <button type="button" className={`qb-chip${lang === "en-US" ? " on" : ""}`} onClick={() => switchLang("en-US")}>إنگليزي</button>
      </div>
      <div className="qb-note">گول «إنگليزي» أو «عربي» (أو دوس الزر): تتبدل اللغة وينزل سطر. بالسبورة الإنگليزي يسار والعربي يمين.</div>
      <textarea ref={box} onSelect={(e) => { caret.current = e.currentTarget.selectionStart; }} onClick={(e) => { caret.current = e.currentTarget.selectionStart; }} onKeyUp={(e) => { caret.current = e.currentTarget.selectionStart; }} dir="auto" style={{ unicodeBidi: "plaintext", textAlign: "start" }} value={text} onChange={(e) => { const v = e.target.value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))); setText(v); done.current = v; }} rows={4} />
      {err && <div className="qb-note bad">⚠️ {err}</div>}
      <div className="qb-row"><span>حجم الكتابة:</span>{[[36, "صغير"], [56, "وسط"], [84, "كبير"]].map(([n, t]) => <button key={n} type="button" className={`qb-chip${size === n ? " on" : ""}`} onClick={() => setSize(Number(n))}>{t}</button>)}</div>
      <div className="qb-dbtns">
        {on ? <button type="button" className="bad" onClick={stop}>⏹ وگّف</button> : <button type="button" className="bad" onClick={() => start()}>🎤 ابدأ الكلام</button>}
        {/* 🌐 كل سطر وتحته ترجمته بعبارات المنهج: الإنگليزي يطلع تحته عربي، والعربي تحته إنگليزي */}
        {teacher && <button type="button" className="gray" disabled={!text.trim() || !!tr} onClick={async () => {
          stop(); setTr("⏳ يترجم..."); setErr("");
          try { const r = await api({ action: "translate", text }); setText(r.text); done.current = r.text; setTr(""); } catch (e) { setTr(""); setErr((e as Error).message); }
        }}>{tr || "🌐 ترجم"}</button>}
        <button type="button" className="ok" disabled={!text.trim()} onClick={() => { stop(); onPlace(text, size); }}>{init ? "💾 احفظ التعديل" : "اكتبها على السبورة"}</button>
        <button type="button" className="gray" onClick={() => { stop(); onCancel(); }}>إلغاء</button>
      </div>
    </div></div>
  );
}

const CSS = `
.ptools{display:none!important}
.qb{position:fixed;inset:0;z-index:30;background:#0d1320;display:flex;flex-direction:column;user-select:none;-webkit-user-select:none;font-family:QAppEn,QAppAr,Cairo,Tahoma,Arial,sans-serif;touch-action:none;overscroll-behavior:none}
.qb-area{position:relative;flex:1;min-height:0;overflow:hidden}
.qb-c{position:absolute;inset:0;width:100%;height:100%;display:block}
.qb-live{touch-action:none;cursor:crosshair}
.qb-hint{position:absolute;top:56px;left:50%;transform:translateX(-50%);background:#1F2738;color:#F6C94A;padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.27);font-size:18px;pointer-events:none}
.qb-bar{height:${BAR}px;flex:none;background:#1B2333;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:0 6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.qb-grp{display:flex;align-items:center;gap:2px;flex:none}
.qb-upd{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:6;border:0;border-radius:12px;background:#F6C94A;color:#141F33;font:inherit;font-weight:800;font-size:15px;padding:8px 16px;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:calc(100% - 32px)}
.qb-tab{position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:25;border:0;border-radius:14px 14px 0 0;background:#1B2333;color:#F6C94A;font:inherit;font-weight:800;font-size:15px;padding:6px 22px 8px;min-height:40px;box-shadow:0 -2px 10px rgba(0,0,0,.35);opacity:.9}
.qb-btn{width:58px;height:66px;flex:none;border:0;border-radius:10px;background:transparent;color:#dfe5f0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0;cursor:pointer}
.qb-btn:disabled{opacity:.35}
.qb-btn.on{background:#2c3850;color:#F6C94A;box-shadow:inset 0 0 0 2px #F6C94A}
.qb-ic{display:flex;height:28px;align-items:center}
.qb-logo-ic{width:30px;height:28px;overflow:hidden;display:flex;align-items:center;justify-content:center}.qb-logo-ic img{width:50px;height:50px;flex:none;margin-top:4px}
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
.qb-in.qb-num{width:110px;margin:0 6px}
.qb-in{width:min(520px,calc(100vw - 48px));min-height:48px;border-radius:10px;border:1px solid rgba(255,255,255,.3);background:#1B2333;color:#fff;font:inherit;font-size:16px;padding:8px 12px;margin:4px 0 8px}
.qb-chip{min-height:54px;border:1px solid rgba(255,255,255,.27);border-radius:12px;background:#283247;color:#fff;font-size:15px;padding:6px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer}
.qb-chip i{display:block;border:2px solid #fff;border-radius:6px}
.qb-chip.on,.qb-frames button.on,.qb-sw.on,.qb-pal button.on{box-shadow:0 0 0 3px #F6C94A;border-color:#F6C94A}
.qb-pal{display:grid;grid-template-columns:repeat(14,32px);gap:5px}
.qb-pal button{width:32px;height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.2);padding:0;cursor:pointer}
.qb-sw{width:46px;height:36px;border-radius:9px;border:2px solid rgba(255,255,255,.35);cursor:pointer}
.qb-custom{position:relative;display:inline-flex;align-items:center;justify-content:center;font-size:20px;background:conic-gradient(#e33,#fd3,#3c6,#39f,#a3f,#e33)}
.qb-custom input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.qb-frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;width:min(560px,calc(100vw - 48px))}
.qb-frames button{background:#283247;border:1px solid rgba(255,255,255,.2);border-radius:10px;color:#fff;padding:6px;display:flex;flex-direction:column;gap:4px;align-items:stretch;font-size:14px;cursor:pointer}
.qb-frames img,.qb-noprev{width:100%;height:24px;border-radius:4px;display:block;object-fit:cover}
.qb-menu{display:flex;flex-direction:column;min-width:260px}
.qb-heads{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;width:min(560px,calc(100vw - 48px));margin-bottom:6px}
.qb-heads button{background:#283247;border:1px solid rgba(255,255,255,.2);border-radius:10px;color:#fff;padding:6px;display:flex;flex-direction:column;gap:4px;align-items:stretch;font-size:14px;cursor:pointer}
.qb-heads img{width:100%;height:auto;border-radius:4px;display:block}
.qb-heads button.on{box-shadow:0 0 0 3px #F6C94A;border-color:#F6C94A}
.qb-selbar{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:#1F2738;border:1px solid #F6C94A;border-radius:14px;padding:8px 12px;color:#fff;font-size:15px;z-index:5}
.qb-selbar button{min-height:44px;border:0;border-radius:10px;background:#4a5468;color:#fff;font-size:16px;font-weight:700;padding:0 14px;cursor:pointer}
.qb-selbar button.bad{background:#d23b3b}
.qb-selbar span{white-space:nowrap}
@media (max-width:700px){.qb-selbar span{display:none}.qb-selbar button{min-height:36px;font-size:14px}}
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
.qb button,.qb input,.qb textarea{font-family:inherit}
.qb-mic{width:min(720px,calc(100vw - 32px))}
.qb-mic textarea{font-size:24px;min-height:140px;resize:vertical}
.qb-toast{position:fixed;top:56px;left:50%;transform:translateX(-50%);background:#1F2738;color:#fff;border:1px solid #F6C94A;padding:12px 20px;border-radius:12px;font-size:17px;z-index:50;max-width:calc(100vw - 32px)}
.qb-splash{position:fixed;inset:0;background:#141B2B;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:60}
.qb-splash img{width:min(220px,38vh);height:min(220px,38vh);object-fit:contain}
.qb-splash b{color:#F6C94A;font-size:min(56px,9vh)}
.qb-splash span{color:#aab3c5;font-size:min(22px,4vh)}
@media (max-width:900px){.qb-btn{width:52px}.qb-t{font-size:11px}.qb-pal{grid-template-columns:repeat(14,24px)}.qb-pal button{width:24px;height:24px}}
`;

/** يحط لمساته الشخصية (من الإعدادات) على الشرح */
function applyLook(l: Lesson, s: { wm?: boolean; grid?: string; foot?: boolean }): Lesson {
  if (s.wm) l.wm = 1; else delete l.wm;
  if (s.foot) l.foot = 1; else delete l.foot;
  if (s.grid === "sq" || s.grid === "dots" || s.grid === "lines") l.grid = s.grid as Grid; else delete l.grid;
  return l;
}
