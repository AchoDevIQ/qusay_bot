"use client";
// شاشة تصحيح الورقة مثل النظام القديم: كل سؤال صفحة، القلم والممحاة والكتابة وختم الصح فوك جواب الطالب،
// والدرجات بصف فوك. الرسم ينحفظ وحده لكل صفحة
import { useCallback, useEffect, useRef, useState } from "react";
import { pageAuth } from "../adminPage";
import PdfPages, { pdfByQuestion, pdfToImages } from "../PdfPages";
import { coverImage, loadImage, pageImage, type HeaderInfo } from "./compose";
import VoiceRec from "../VoiceRec";
import MessageBox from "./MessageBox";

export type Q = { n: number; max: number; image: string; answers: string[]; mark: number | null };
export type GVoice = { id?: string; name: string; ref: string };
/** شلون صحح المصحح الآلي كل سؤال: درجة كل خطوة وسببها */
export type AiQ = { n: number; score: number; max: number; review: boolean; reason: string; lines: string[]; steps: { awarded: number; possible: number; reason: string; expected: string; student: string }[] };
export type Paper = { ai?: AiQ[] | null; errors?: string[]; voices?: GVoice[]; myVoices?: GVoice[]; inPerson?: boolean; id: number; name: string; title: string; chapter: string; model: string; test: boolean; graded: string; total: number | null; answerPdf: string | null; whole: string[]; questions: Q[]; ink: Record<number, string>; slug: string; info: string; lang: "ar" | "en"; sid: number; objections?: Objection[] };
/** اعتراض الطالب على سؤال: نصه، وتسجيله إذا موجود، ودرجته قبل الاعتراض */
export type Objection = { q: number; text: string; voice: string | null; old: number };
export type Prepared = { total: number; comment: string; sticker: number; sent: number };
type Item = { t: "s"; c: string; w: number; p: number[] } | { t: "x"; c: string; x: number; y: number; s: string; z: number } | { t: "k"; x: number; y: number } | { t: "w"; x: number; y: number } | { t: "i"; id: number; x: number; y: number; w: number };
export type Sticker = { id: number; name: string; lo: number; hi: number };
type Ink = { rot: number; items: Item[] };
type Page = { src: string | null; q: number | null };
type Tool = "hand" | "pen" | "eraser" | "text" | "stamp" | "wrong" | "sticker";

const COLORS = ["#111111", "#555555", "#9e9e9e", "#ffffff", "#e53935", "#c62828", "#ff5252", "#ff7043", "#fb8c00", "#ffb300", "#fdd835", "#c0ca33",
  "#7cb342", "#1f9d55", "#00897b", "#00acc1", "#039be5", "#1e5bd8", "#3949ab", "#5e35b1", "#8e24aa", "#d81b60", "#ec407a", "#6d4c41"];
const WIDTHS = [2, 5];
const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];
const GREEN = "#1f9d55";
const RED = "#e53935";
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
function drawItems(ctx: CanvasRenderingContext2D, items: Item[], w: number, h: number, live?: Item | null, imgs?: Map<number, HTMLImageElement>, clear = true) {
  if (clear) ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const it of live ? [...items, live] : items) {
    if (it.t === "s") {
      ctx.strokeStyle = it.c; ctx.lineWidth = (it.w * w) / 800;
      ctx.beginPath();
      for (let i = 0; i < it.p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, it.p[i] * w, it.p[i + 1] * h);
      if (it.p.length === 2) ctx.lineTo(it.p[0] * w + 0.1, it.p[1] * h);
      ctx.stroke();
    } else if (it.t === "x") {
      ctx.fillStyle = it.c; ctx.font = `700 ${it.z * w}px Boahmed, Cairo, Tahoma, Arial, sans-serif`; ctx.textBaseline = "middle";
      it.s.split("\n").forEach((line, i) => ctx.fillText(line, it.x * w, it.y * h + i * it.z * w * 1.25));
    } else if (it.t === "i") {
      const im = imgs?.get(it.id);
      if (im?.complete && im.naturalWidth) { const dw = it.w * w, dh = (dw * im.naturalHeight) / im.naturalWidth; ctx.drawImage(im, it.x * w - dw / 2, it.y * h - dh / 2, dw, dh); }
    } else if (it.t === "w") {
      // ختم الخطأ: دائرة حمرة بيها ✗
      const r = 0.028 * w, x = it.x * w, y = it.y * h, a = r * 0.4;
      ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = r * 0.28; ctx.beginPath();
      ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a); ctx.moveTo(x + a, y - a); ctx.lineTo(x - a, y + a); ctx.stroke();
    } else {
      const r = 0.028 * w, x = it.x * w, y = it.y * h;
      ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = r * 0.28; ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.38); ctx.lineTo(x + r * 0.5, y - r * 0.35); ctx.stroke();
    }
  }
}

/** صفحة وحدة: الصورة جوة والرسم فوكها */
function Sheet({ page, ink, zoom, tool, color, width, sticker, fitH, locked, onAdd, onErase, onTap, onMove }: {
  page: Page; ink: Ink; zoom: number; tool: Tool; color: string; width: number; sticker: number; fitH: number; locked: boolean;
  onAdd: (it: Item) => void; onErase: (x: number, y: number) => void; onTap: (x: number, y: number) => void; onMove: (i: number, x: number, y: number) => void;
}) {
  const drag = useRef<{ i: number; dx: number; dy: number } | { pan: true; x: number; y: number } | null>(null);
  const [moving, setMoving] = useState<{ i: number; x: number; y: number } | null>(null);
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
  // 100% يعني الورقة كلها تبين بالشاشة بدون نزول، والتكبير فوكها
  const fit = Math.min(boxW, fitH > 120 ? (fitH * iw) / ih : boxW);
  const w = Math.round(fit * zoom), h = Math.round((w * ih) / iw);
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
    // العنصر اللي يتحرك يبين بمكانه الجديد
    const items = moving ? ink.items.map((it, i) => (i === moving.i && it.t !== "s" ? { ...it, x: moving.x, y: moving.y } : it)) : ink.items;
    drawItems(ctx, items, w, h, live.current, imgs.current);
  }, [ink.items, w, h, dpr, loaded, moving]);
  useEffect(() => { const c = top.current; if (c) { c.width = w * dpr; c.height = h * dpr; } redraw(); }, [w, h, dpr, redraw]);
  const pt = (e: React.PointerEvent) => { const r = top.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const; };
  /** أقرب كتابة أو ختم أو ملصق للمكان اللي انداس */
  function hit(x: number, y: number) {
    let best = -1, bestD = 0.05;
    ink.items.forEach((it, i) => {
      if (it.t === "s") return;
      // الكتابة العربية تنكتب من نقطتها لليسار، فنقيس لنصها تقريباً
      const lines = it.t === "x" ? it.s.split(/\r?\n/) : [];
      const len = it.t === "x" ? Math.max(...lines.map((l) => l.length)) * it.z * 0.55 : 0;
      const cx = it.t === "x" ? it.x - len / 2 : it.x;
      const d = Math.hypot(cx - x, it.y - y);
      const onText = it.t === "x" && y >= it.y - it.z && y <= it.y + it.z * (lines.length + 0.2) && x >= it.x - len - 0.02 && x <= it.x + 0.02;
      if (d < bestD || onText) { best = i; bestD = Math.min(d, bestD); }
    });
    return best;
  }
  function down(e: React.PointerEvent) {
    e.preventDefault(); top.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    // التحريك بالإيد، وأداة التعليق هم تسحب التعليق المكتوب مباشرة بدون ما تروح للإيد
    if (tool === "hand" || tool === "text") {
      const i = locked ? -1 : hit(x, y);
      if (i >= 0 && (tool === "hand" || ink.items[i].t === "x")) { const it = ink.items[i] as { x: number; y: number }; drag.current = { i, dx: x - it.x, dy: y - it.y }; setMoving({ i, x: it.x, y: it.y }); return; }
      if (tool === "hand") { drag.current = { pan: true, x: e.clientX, y: e.clientY }; return; }
    }
    if (tool === "pen") { live.current = { t: "s", c: color, w: width, p: [x, y] }; redraw(); }
    if (tool === "eraser") onErase(x, y);
  }
  function move(e: React.PointerEvent) {
    if (drag.current || tool === "hand") {
      const d = drag.current; if (!d) return;
      if ("pan" in d) {
        // ماكو شي تحت الإصبع: الصفحة نفسها تتحرك
        const st = box.current?.parentElement; if (st) st.scrollBy(d.x - e.clientX, d.y - e.clientY);
        drag.current = { pan: true, x: e.clientX, y: e.clientY };
      } else { const [x, y] = pt(e); setMoving({ i: d.i, x: Math.min(1, Math.max(0, x - d.dx)), y: Math.min(1, Math.max(0, y - d.dy)) }); }
      return;
    }
    if (!(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "pen" && live.current?.t === "s") { live.current.p.push(+x.toFixed(4), +y.toFixed(4)); redraw(); }
    if (tool === "eraser") onErase(x, y);
  }
  function up(e: React.PointerEvent) {
    if (drag.current || tool === "hand") {
      if (moving) onMove(moving.i, +moving.x.toFixed(4), +moving.y.toFixed(4));
      drag.current = null; setMoving(null);
      return;
    }
    const [x, y] = pt(e);
    if (tool === "pen" && live.current) { const s = live.current; live.current = null; onAdd(s); }
    if (tool === "stamp") onAdd({ t: "k", x, y });
    if (tool === "wrong") onAdd({ t: "w", x, y });
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
          <canvas ref={top} style={{ width: w, height: h, touchAction: "none", cursor: tool === "hand" ? (moving ? "grabbing" : "grab") : "crosshair" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; drag.current = null; setMoving(null); redraw(); }} />
        </div>
      )}
    </div>
  );
}

/** صورة السؤال بدون البياض اللي حواليها، حتى تاخذ أقل مساحة */
function TrimmedImage({ src, alt }: { src: string; alt: string }) {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext("2d")!; ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          if (d[i + 3] > 20 && (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) { setOut(src); return; }
        const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
        const t = document.createElement("canvas");
        t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
        t.getContext("2d")!.drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
        setOut(t.toDataURL("image/png"));
      } catch { setOut(src); }
    };
    im.onerror = () => setOut(src);
    im.src = src;
  }, [src]);
  return out ? <img src={out} alt={alt} /> : <span className="gk-qwait">...</span>;
}

const ICON: Record<Tool, string> = { hand: "👆", pen: "🖊️", eraser: "🧽", text: "💬", stamp: "✅", wrong: "❌", sticker: "🖼" };
const TIP: Record<Tool, string> = { hand: "تحريك: اسحب الكتابة أو الختم أو الملصق لمكان ثاني، أو اسحب الصفحة", pen: "القلم", eraser: "الممحاة", text: "تعليق: كتابة أو فويس. والتعليق المكتوب تسحبه وتحركه بنفس الأداة", stamp: "ختم صح", wrong: "ختم خطأ", sticker: "ملصق" };

const SHOWQ_KEY = "gradeShowQuestion";
const PEN_KEY = "gradePen";
export default function Grader({ paper, url, busy, act, onClose, onSkip, onSave, onDecide, onRescan, today, left: papersLeft, stickers }: {
  paper: Paper; url: (r: string) => string; busy: boolean; stickers: Sticker[];
  act: (b: Record<string, unknown>) => Promise<{ paper?: Paper | null; errors?: string[] } | null>;
  onClose: () => void; onSkip: () => void; onRescan: () => void; onSave: (inkSaved: Promise<void>, compose: (p: Prepared) => Promise<Blob[]>) => void; today: number; left: number;
  onDecide: (inkSaved: Promise<void>, compose: (p: Prepared) => Promise<Blob[]>, rejects: Record<number, string>, accepted: number) => void;
}) {
  // ورقة عليها اعتراض: تنفتح من جديد، تتغير بس درجة السؤال المعترض عليه، والتغيير يعني قبول
  const objs = paper.objections ?? [];
  const objMode = objs.length > 0;
  const objOf = (n: number) => objs.find((o) => o.q === n);
  const [rejects, setRejects] = useState<Record<number, string>>({});
  const [pages, setPages] = useState<Page[] | null>(null);
  const [at, setAt] = useState(0);
  const [inks, setInks] = useState<Record<number, Ink>>(() => Object.fromEntries(Object.entries(paper.ink ?? {}).map(([k, v]) => [Number(k), parseInk(v)])));
  const [marks, setMarks] = useState<Record<number, number | null>>(() => Object.fromEntries(paper.questions.map((q) => [q.n, q.mark])));
  const [qSel, setQSel] = useState(objs[0]?.q ?? paper.questions.find((q) => q.mark === null)?.n ?? paper.questions[0]?.n ?? 0);
  const [tool, setTool] = useState<Tool>("pen");
  // لون القلم وسمكه يبقون نفسهم بكل الصفحات والأوراق، لحد ما المصحح يبدلهم
  const [color, setColorState] = useState("#e53935");
  const [width, setWidthState] = useState(WIDTHS[0]);
  useEffect(() => {
    try { const j = JSON.parse(localStorage.getItem(PEN_KEY) ?? "{}"); if (/^#[0-9a-f]{6}$/i.test(j.c) && j.c.toLowerCase() !== "#ffffff") setColorState(j.c); if (WIDTHS.includes(j.w)) setWidthState(j.w); } catch { /* بدون حفظ */ }
  }, []);
  const keepPen = (c: string, w: number) => { try { localStorage.setItem(PEN_KEY, JSON.stringify({ c, w })); } catch { /* بدون حفظ */ } };
  const setColor = (c: string) => { setColorState(c); keepPen(c, width); };
  const setWidth = (w: number) => { setWidthState(w); keepPen(color, w); };
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
  const [msgBox, setMsgBox] = useState(false);
  const [msgDone, setMsgDone] = useState("");
  const [rescanAsk, setRescanAsk] = useState(false);
  // الأخطاء الشائعة مال هذا الامتحان: يشوفها كل مصحح يصححه، وما تطلع بامتحان ثاني
  const [errors, setErrors] = useState<string[]>(paper.errors ?? []);
  // التعليق الصوتي: الفويسات المحفوظة مال هذا الامتحان، والفويسات اللي انضافت لهذي الورقة (توصل للطالب ويا ورقته)
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [voices, setVoices] = useState<GVoice[]>(paper.voices ?? []);
  const [myVoices, setMyVoices] = useState<GVoice[]>(paper.myVoices ?? []);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [recOn, setRecOn] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceErr, setVoiceErr] = useState("");
  async function voicePost(body: BodyInit, json: boolean) {
    setVoiceBusy(true); setVoiceErr("");
    try {
      const res = await fetch("/api/grade", { method: "POST", ...(json ? { headers: { "Content-Type": "application/json" } } : {}), body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setVoiceErr(j.error ?? "صار خطأ"); return null; }
      setVoices(j.voices ?? []); setMyVoices(j.myVoices ?? []);
      return j as { myVoices: GVoice[] };
    } catch { setVoiceErr("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setVoiceBusy(false); }
  }
  const voiceJson = (b: Record<string, unknown>) => voicePost(JSON.stringify({ initData: pageAuth(), id: paper.id, ...b }), true);
  /** علامة 🎙 برقم الفويس بالمكان اللي انداس، حتى الطالب يعرف الفويس على أي شي */
  function markVoice(n: number) {
    if (textAt) addItem({ t: "x", c: color, x: textAt.x, y: textAt.y, s: `🎙${n}`, z: 0.032 });
    setTextAt(null); setVoiceBlob(null); setVoiceName(""); setKeepErr(false);
  }
  async function addVoice() {
    if (!voiceBlob) { setVoiceErr("سجل الفويس أول"); return; }
    if (keepErr && !voiceName.trim()) { setVoiceErr("اكتب اسم قصير للفويس حتى يبين بالأخطاء الشائعة"); return; }
    const fd = new FormData();
    fd.set("initData", pageAuth()); fd.set("action", "voice"); fd.set("id", String(paper.id));
    fd.set("name", voiceName.trim()); fd.set("keep", keepErr ? "1" : "0"); fd.set("voice", voiceBlob, "voice");
    const r = await voicePost(fd, false);
    if (r) markVoice(r.myVoices.length);
  }
  async function useSaved(id: string) { const r = await voiceJson({ action: "voiceUse", vid: id }); if (r) markVoice(r.myVoices.length); }
  const playing = useRef<HTMLAudioElement | null>(null);
  function play(ref: string) { playing.current?.pause(); const a = new Audio(url(ref)); playing.current = a; void a.play().catch(() => setVoiceErr("ما اشتغل الصوت")); }
  const errAct = async (b: Record<string, unknown>) => { const r = await act({ ...b, id: paper.id }); if (r?.errors) setErrors(r.errors); };
  useEffect(() => { try { if (localStorage.getItem(SHOWQ_KEY) === "0") setShowQ(false); } catch { /* بدون حفظ */ } }, []);
  function toggleQ() { const v = !showQ; setShowQ(v); try { localStorage.setItem(SHOWQ_KEY, v ? "1" : "0"); } catch { /* بدون حفظ */ } }
  const undo = useRef<Record<number, Item[][]>>({});
  const redo = useRef<Record<number, Item[][]>>({});
  const dirty = useRef(new Set<number>());
  const pendingMarks = useRef(new Set<Promise<void>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inksRef = useRef(inks); inksRef.current = inks;
  const locked = !!paper.graded && !objMode;
  const stage = useRef<HTMLDivElement>(null);
  const qtop = useRef<HTMLDivElement>(null);
  const [fitH, setFitH] = useState(0);
  useEffect(() => {
    const measure = () => { const st = stage.current; if (st) setFitH(st.clientHeight - (qtop.current?.offsetHeight ?? 0) - 34); };
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    if (qtop.current) ro.observe(qtop.current);
    measure();
    return () => ro.disconnect();
  });

  useEffect(() => {
    let stop = false;
    buildPages(paper, url).then((p) => {
      if (stop) return;
      setPages(p);
      const first = objMode ? p.findIndex((x) => x.q === objs[0].q) : p.findIndex((x) => x.q !== null && marks[x.q] === null);
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
  const moveItem = (i: number, x: number, y: number) => change({ ...ink, items: ink.items.map((it, j) => (j === i && it.t !== "s" ? { ...it, x, y } : it)) });
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
  const changedObj = (o: Objection) => marks[o.q] !== null && marks[o.q] !== undefined && marks[o.q] !== o.old;
  const undecided = objs.filter((o) => !changedObj(o) && rejects[o.q] === undefined);
  const accepted = objs.filter(changedObj).length;
  function goQ(n: number) { const i = pages?.findIndex((p) => p.q === n) ?? -1; if (i >= 0) go(i); else setQSel(n); }
  async function press(m: number) {
    if (!q || locked) return;
    if (objMode && !objOf(q.n)) return;
    const n = q.n, old = marks[n] ?? null;
    if (objMode) setRejects((x) => { const y = { ...x }; delete y[n]; return y; });
    // الدرجة تصير خضرة فوراً، وتبقى شوية حتى المصحح يشوفها، وبعدها ينتقل للسؤال اللي بعده
    setMarks((x) => ({ ...x, [n]: m }));
    setSaveErr("");
    const sent = fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: pageAuth(), action: "mark", id: paper.id, q: n, mark: m }) })
      .then(async (res) => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? ""); })
      .catch((e) => { setMarks((x) => ({ ...x, [n]: old })); setSaveErr(`ما انحفظت درجة السؤال ${n}${(e as Error).message ? `: ${(e as Error).message}` : ""}`); });
    pendingMarks.current.add(sent);
    void sent.finally(() => pendingMarks.current.delete(sent));
    if (objMode) return;
    await new Promise((r) => setTimeout(r, 450));
    const nextQ = paper.questions[paper.questions.findIndex((x) => x.n === n) + 1];
    if (!nextQ || (q && q.n !== n)) return;
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
    if (v && keepErr && !errors.includes(v)) void errAct({ action: "saveError", text: v });
    setTextAt(null); setText(""); setKeepErr(false);
  }
  /** صور الورقة المصححة اللي توصل للطالب: غلاف، وبعده كل صفحة بتصحيحها */
  async function composeAll(prep: Prepared): Promise<Blob[]> {
    try { await Promise.all(["600", "700", "800", "900"].map((w) => document.fonts.load(`${w} 40px Cairo`, "اب Ab گ 1"))); await document.fonts.load("40px Boahmed", "اب"); await document.fonts.ready; } catch { /* بدون خطوط */ }
    const info: HeaderInfo = { slug: paper.slug, chapter: paper.chapter, title: paper.title, info: paper.info, model: paper.model, name: paper.name, total: prep.total, lang: paper.lang, sid: paper.sid };
    const logo = await loadImage("/logo.png");
    const out = [await coverImage(info, prep.comment, prep.sticker ? await loadImage(stickerUrl(prep.sticker)) : null, logo)];
    const all = inksRef.current;
    const imgs = new Map<number, HTMLImageElement>();
    for (const ink of Object.values(all)) for (const it of ink.items) if (it.t === "i" && !imgs.has(it.id)) { const im = await loadImage(stickerUrl(it.id)); if (im) imgs.set(it.id, im); }
    for (const [i, pg] of (pages ?? []).entries()) {
      if (!pg.src) continue;
      const im = await loadImage(pg.src);
      if (!im) continue;
      const ink = all[i] ?? { rot: 0, items: [] };
      out.push(await pageImage(info, im, ink.rot, (ctx, w, h) => drawItems(ctx, ink.items, w, h, null, imgs, false), logo));
    }
    return out;
  }
  /** رد الاعتراض: كل اعتراض لازم أما تتغير درجته (ينقبل) أو ينضغط رفض */
  function decide() {
    if (undecided.length) { setSaveErr(`غير الدرجة أو ارفض اعتراض السؤال ${undecided[0].q}`); goQ(undecided[0].q); return; }
    onDecide(Promise.all([flush(), ...pendingMarks.current]).then(() => undefined), composeAll, rejects, accepted);
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
    onSave(Promise.all([flush(), ...pendingMarks.current]).then(() => undefined), composeAll);
  }
  return (
    <div className="gk">
      <div className="gk-row gk-head">
        <b className="gk-name">{paper.name}{paper.test ? " (تجربة)" : ""}</b>
        <div className="gk-tools">
          <button type="button" className={"gk-btn" + (showQ ? " on" : "")} onClick={toggleQ}>📋 {showQ ? "إخفاء السؤال" : "إظهار السؤال"}</button>
          <button type="button" className="gk-btn" onClick={() => setOverlay("model")}>📄 الجواب النموذجي</button>
          <button type="button" className="gk-btn" onClick={() => setMsgBox(true)}>📩 رسالة للطالب</button>
          {!locked && <button type="button" className="gk-ic" title="تراجع" onClick={back}>↶</button>}
          {!locked && <button type="button" className="gk-ic" title="إعادة" onClick={forward}>↷</button>}
        </div>
      </div>
      <div className="gk-row gk-info">
        <button type="button" className="gk-skip" onClick={async () => { await flush(); onClose(); }}>⬅️ القائمة</button>
        <span>الامتحان: {paper.title} · النسخة: {paper.model}</span>
        <span>صححت: <b>{today}</b> | متبقي: <b>{papersLeft}</b>{saveErr && <span className="gk-err"> · ⚠️ {saveErr}</span>}</span>
        {!locked && !objMode && <button type="button" className="gk-skip" disabled={busy} onClick={async () => { await flush(); onSkip(); }}>⏭ تخطي الورقة</button>}
        {objMode && <b className="gk-objtag">✋ اعتراض</b>}
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
        {!locked && !objMode && (rescanAsk
          ? <button type="button" className="gk-clear gk-rescan on" disabled={busy} onClick={async () => { setRescanAsk(false); await flush(); onRescan(); }}>⚠️ متأكد؟ اضغط مرة ثانية</button>
          : <button type="button" className="gk-clear gk-rescan" title={paper.inPerson ? "السكنر ما انقرا زين أو الصفحات فارغة: تنمسح كل صفحات الطالب بهذا الامتحان، وتوصل رسالة للي رفعها بالسكنر حتى يعيد رفعها" : "الصور ما واضحة أو فارغة: تنمسح كل صفحات الطالب بهذا الامتحان، وينفتح إله الامتحان حتى يعيد رفعها"} onClick={() => setRescanAsk(true)}>🗑 امسح أوراق الطالب كاملة</button>)}
        {!locked && <div className="gk-tools gk-pens">
          {(["sticker", "wrong", "stamp", "text", "eraser", "pen", "hand"] as Tool[]).map((t) => (
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
          <div className="gk-nums" style={{ ["--cols" as string]: q.max + 1 <= 16 ? q.max + 1 : Math.ceil((q.max + 1) / 2) }}>
            {Array.from({ length: q.max + 1 }, (_, m) => m).map((m) => (
              <button type="button" key={m} className={(marks[q.n] === m ? "on" : "") + (objMode && objOf(q.n)?.old === m ? " gk-was" : "")} disabled={busy || locked || (objMode && !objOf(q.n))} onClick={() => void press(m)}>{m}</button>
            ))}
          </div>
          <span className="gk-total">{total} / 100</span>
          {!locked && !objMode && <button type="button" className="gk-save" disabled={busy} onClick={save}>💾 حفظ{missing ? ` (باقي ${missing})` : ""}</button>}
          {objMode && <button type="button" className="gk-save" disabled={busy} onClick={decide}>💾 حفظ الرد{undecided.length ? ` (باقي ${undecided.length})` : ""}</button>}
        </div>
      )}
      {q && paper.ai?.find((x) => x.n === q.n) && <AiNote a={paper.ai.find((x) => x.n === q.n)!} />}
      {objMode && (
        <div className="gk-row gk-obj">
          <div className="gk-objqs">
            {objs.map((o) => (
              <button type="button" key={o.q} className={o.q === curQ ? "on" : ""} onClick={() => goQ(o.q)}>
                س{o.q} {changedObj(o) ? "✅" : rejects[o.q] !== undefined ? "❌" : "⏳"}
              </button>
            ))}
          </div>
          {q && objOf(q.n) ? (() => {
            const o = objOf(q.n)!;
            return (
              <div className="gk-objbody">
                <div><b>اعتراض الطالب على س{o.q}</b> · درجته كانت <b>{o.old}</b> من {q.max}</div>
                {o.text && <div className="gk-objtext">{o.text}</div>}
                {o.voice && <audio controls preload="none" src={url(o.voice)} />}
                {changedObj(o) ? <div className="gk-objok">✅ راح ينقبل: {o.old} ← {marks[o.q]}. ترجعه لـ {o.old} إذا غيرت رأيك.</div>
                  : rejects[o.q] !== undefined ? (
                    <div className="gk-objno">
                      <span>❌ راح ينرفض، ودرجته تبقى {o.old}</span>
                      <input value={rejects[o.q]} placeholder="سبب الرفض للطالب (اختياري)" onChange={(e) => setRejects((x) => ({ ...x, [o.q]: e.target.value }))} />
                      <button type="button" className="gk-btn" onClick={() => setRejects((x) => { const y = { ...x }; delete y[o.q]; return y; })}>تراجع عن الرفض</button>
                    </div>
                  ) : (
                    <div className="gk-objno">
                      <span>إذا الاعتراض صحيح اضغط الدرجة الجديدة فوك. وإذا لا:</span>
                      <button type="button" className="gk-rej" onClick={() => setRejects((x) => ({ ...x, [o.q]: "" }))}>❌ رفض الاعتراض</button>
                    </div>
                  )}
              </div>
            );
          })() : <div className="gk-objbody">هذا السؤال ما عليه اعتراض. اختار سؤال من فوك.</div>}
        </div>
      )}
      <div className="gk-stage" ref={stage}>
        {!pages && <div className="gk-empty">جاري تجهيز الورقة...</div>}
        {pages && !pages.length && <div className="gk-empty">⚠️ ماكو صفحات بهذي الورقة.</div>}
        {page && showQ && q && <div className="gk-qtop" ref={qtop}><b>س{q.n}</b><TrimmedImage src={url(q.image)} alt={`السؤال ${q.n}`} /></div>}
        {page && <Sheet key={at + ":" + page.src} page={page} ink={ink} zoom={zoom} tool={locked ? "hand" : tool} color={color} width={width} sticker={sticker} fitH={fitH} locked={locked} onAdd={addItem} onErase={erase} onMove={moveItem} onTap={(x, y) => { setTextAt({ x, y }); setText(""); }} />}
      </div>
      {textAt && (
        <div className="gk-modal" onClick={() => !recOn && !voiceBusy && setTextAt(null)}>
          <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
            <b>إضافة تعليق</b>
            <div className="gk-kind">
              <button type="button" className={kind === "text" ? "on" : ""} disabled={recOn} onClick={() => setKind("text")}>✍️ كتابة</button>
              <button type="button" className={kind === "voice" ? "on" : ""} onClick={() => setKind("voice")}>🎙 فويس</button>
            </div>
            {kind === "voice" ? (
              <>
                <VoiceRec value={voiceBlob} onChange={setVoiceBlob} onRecording={setRecOn} label="🎙 سجل تعليقك (أكثر شي 5 دقايق). يوصل للطالب ويا ورقته المصححة" />
                <label className="gk-keep"><input type="checkbox" checked={keepErr} onChange={(e) => setKeepErr(e.target.checked)} /> حفظ في الأخطاء الشائعة</label>
                {keepErr && <input className="gk-vname" value={voiceName} maxLength={60} placeholder="اسم قصير للفويس، مثال: خطأ بالإشارة" onChange={(e) => setVoiceName(e.target.value)} />}
                {voiceErr && <div className="gk-err">⚠️ {voiceErr}</div>}
                {!!voices.length && (
                  <div className="gk-errs">
                    <div className="gk-lbl">الأخطاء الشائعة (فويس): ▶ تسمعه، واضغط اسمه حتى ينضاف لهذي الورقة</div>
                    {voices.map((v) => (
                      <span key={v.id} className="gk-errchip">
                        <button type="button" aria-label="سماع" onClick={() => play(v.ref)}>▶</button>
                        <button type="button" disabled={voiceBusy || recOn} onClick={() => void useSaved(v.id!)}>🎙 {v.name}</button>
                        <button type="button" aria-label="حذف" className="gk-x" disabled={voiceBusy} onClick={() => void voiceJson({ action: "voiceDel", vid: v.id })}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {!!myVoices.length && (
                  <div className="gk-errs">
                    <div className="gk-lbl">فويسات هذي الورقة (إذا تشيل واحد، امسح علامته من الورقة)</div>
                    {myVoices.map((v, i) => (
                      <span key={i} className="gk-errchip">
                        <button type="button" onClick={() => play(v.ref)}>▶ 🎙{i + 1} {v.name}</button>
                        <button type="button" aria-label="حذف" className="gk-x" disabled={voiceBusy} onClick={() => void voiceJson({ action: "voiceDrop", n: i + 1 })}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="gk-tools"><button type="button" className="gk-finish" disabled={voiceBusy || recOn || !voiceBlob} onClick={() => void addVoice()}>{voiceBusy ? "جاري الحفظ..." : "إضافة الفويس"}</button><button type="button" className="gk-btn" disabled={recOn} onClick={() => setTextAt(null)}>إلغاء</button></div>
              </>
            ) : (<>
            <textarea autoFocus rows={3} value={text} placeholder="اكتب التعليق..." onChange={(e) => setText(e.target.value)} />
            <label className="gk-keep"><input type="checkbox" checked={keepErr} onChange={(e) => setKeepErr(e.target.checked)} /> حفظ في الأخطاء الشائعة</label>
            {!!errors.length && (
              <div className="gk-errs">
                <div className="gk-lbl">الأخطاء الشائعة: اضغط واحد حتى ينكتب</div>
                {errors.map((e) => (
                  <span key={e} className="gk-errchip">
                    <button type="button" onClick={() => addText(e)}>{e}</button>
                    <button type="button" aria-label="حذف" className="gk-x" onClick={() => void errAct({ action: "delError", text: e })}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="gk-tools"><button type="button" className="gk-finish" onClick={() => addText()}>إضافة</button><button type="button" className="gk-btn" onClick={() => setTextAt(null)}>إلغاء</button></div>
            </>)}
          </div>
        </div>
      )}
      {msgBox && <MessageBox paperId={paper.id} name={paper.name} onClose={(n) => { setMsgBox(false); if (n) { setMsgDone(n); setTimeout(() => setMsgDone(""), 4000); } }} />}
      {msgDone && <div className="gk-toast">{msgDone}</div>}
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
            {overlay === "model" && (paper.answerPdf ? <ModelAnswer url={url(paper.answerPdf)} q={q?.n ?? 0} /> : <div className="gk-empty">ماكو جواب نموذجي مرفوع لهذي النسخة.</div>)}
            {overlay === "question" && q && <img className="gk-qimg" src={url(q.image)} alt={`السؤال ${q.n}`} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** الجواب النموذجي: الملف كله، بس ينفتح على السؤال اللي دا يصححه */
// الجواب النموذجي يتقسم مرة وحدة لكل نسخة، وبعدها ينفتح فوراً
const modelCache = new Map<string, Promise<{ q: number; src: string }[]>>();
const cacheKey = (u: string) => u.replace(/([?&])t=[^&]*/, "$1");
function ModelAnswer({ url, q }: { url: string; q: number }) {
  const [parts, setParts] = useState<{ q: number; src: string }[] | null>(null);
  const first = useRef<HTMLImageElement>(null);
  const loaded = useRef(new Set<number>());
  const done = useRef(false);
  useEffect(() => {
    let stop = false;
    const k = cacheKey(url);
    if (!modelCache.has(k)) modelCache.set(k, pdfByQuestion(url).catch(() => []));
    modelCache.get(k)!.then((p) => { if (!stop) setParts(p); });
    return () => { stop = true; };
  }, [url]);
  if (!parts) return <div className="gk-empty">جاري فتح الجواب النموذجي...</div>;
  // إذا ما گدرنا نلگى الأسئلة بالملف، يطلع كامل مثل قبل
  if (!parts.some((p) => p.q === q)) return <PdfPages url={url} outside={false} />;
  const at = parts.findIndex((p) => p.q === q);
  // ننزل للسؤال بعد ما تتحمل الصور اللي قبله، حتى يوقف بمكانه الصحيح
  const onLoad = (i: number) => { loaded.current.add(i); if (!done.current && [...Array(at + 1).keys()].every((k) => loaded.current.has(k))) { done.current = true; first.current?.scrollIntoView({ block: "start" }); } };
  return <>{parts.map((p, i) => <img key={i} ref={i === at ? first : undefined} onLoad={() => onLoad(i)} className="gk-qimg gk-modelpart" src={p.src} alt={`حل السؤال ${p.q}`} />)}</>;
}

/** المصحح الآلي: درجة كل خطوة وسببها، حتى اللي يرد على الاعتراض يعرف ليش انطى هالدرجة */
function AiNote({ a }: { a: AiQ }) {
  const mark = (s: AiQ["steps"][number]) => (s.awarded >= s.possible ? "✅" : s.awarded > 0 ? "➗" : "❌");
  return (
    <details className="gk-row gk-ai">
      <summary>🤖 نظام التصحيح AI انطى س{a.n}: {a.score} من {a.max}{a.review ? " · كان غير متأكد" : ""}</summary>
      {a.reason && <div className="gk-aireason">{a.reason}</div>}
      <ol>{a.steps.map((s, i) => <li key={i}>{mark(s)} <b dir="ltr">{s.awarded}/{s.possible}</b> <span dir="auto">{s.reason}</span></li>)}</ol>
    </details>
  );
}
