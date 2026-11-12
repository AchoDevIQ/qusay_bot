"use client";
// ✏️ الكتابة بالقلم على الآيباد: صفحة وحدة بكل الشاشة (مثل صفحة التصحيح)، وفوكها أرقام الأسئلة 1 2 3… وأسهم ‹ ›.
// يدوس رقم السؤال تنفتح ورقته: هدر بسطر واحد (الفصل والموضوع، اسمه، النسخة ورقمه)، السؤال بدون درجته، وسطور يكتب عليها.
// الأدوات: القلم (ألوانه وسماكته نفس المصحح)، المسطرة (خط مستقيم)، الممحاة، والرجوع.
// رقم السؤال أحمر لحد ما يدوس «✅ تم» بورقته، وبعدها يصير أخضر (أو إذا جوابه واصل من قبل).
// كتابة كل سؤال تنحفظ بالجهاز أول بأول. «📤 أرسل الأجوبة» يدز كل الأوراق الخضر اللي تغيرت مرة وحدة (كل ورقة صورة جواب سؤالها،
// مثل الكاميرا بالضبط، والجديدة تبدل القديمة)، وبعدها يسأله يسلّم الامتحان. يگدر يعدل ويرجع يرسل لحد ما يسلم.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadImage, W, type HeaderInfo } from "../grade/compose";
import { drawPaper, H } from "./penPaper";
import { COLORS, WIDTHS } from "../grade/pens";
import { haptic } from "../shared";

export type PenHead = { slug: string; chapter: string; title: string; info: string; name: string; lang: string };
export type PenQ = { n: number; img: string | null; done: boolean };
type Stroke = { c: string; w: number; p: number[] };
type Tool = "pen" | "ruler" | "eraser";
const SCALE = 1.5;              // الورقة تنرسم أوضح من حجم الشاشة، حتى الصورة تطلع حادة
const PX: Record<number, number> = { 2: 4, 5: 9 };   // سماكة القلم بالورقة
const draftKey = (item: number, q: number) => `penDraft:${item}:${q}`;
const dirtyKey = (item: number, q: number) => `penDirty:${item}:${q}`;
const doneKey = (item: number, q: number) => `penDone:${item}:${q}`;
/** داس «✅ تم» على هذي الورقة */
const isDone = (item: number, q: number) => { try { return localStorage.getItem(doneKey(item, q)) === "1"; } catch { return false; } };
const setDoneMark = (item: number, q: number, on: boolean) => { try { if (on) localStorage.setItem(doneKey(item, q), "1"); else localStorage.removeItem(doneKey(item, q)); } catch { /* بدون حفظ */ } };
const readDraft = (item: number, q: number): Stroke[] => { try { const j = JSON.parse(localStorage.getItem(draftKey(item, q)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };
const keepDraft = (item: number, q: number, s: Stroke[]) => { try { localStorage.setItem(draftKey(item, q), JSON.stringify(s)); } catch { /* بدون حفظ */ } };
/** كتب بهذي الورقة بعد آخر إرسال */
const isDirty = (item: number, q: number) => { try { return localStorage.getItem(dirtyKey(item, q)) === "1"; } catch { return false; } };
const setDirty = (item: number, q: number, on: boolean) => { try { if (on) localStorage.setItem(dirtyKey(item, q), "1"); else localStorage.removeItem(dirtyKey(item, q)); } catch { /* بدون حفظ */ } };
export const hasPenDraft = (item: number, q: number) => readDraft(item, q).length > 0;

function drawStrokes(ctx: CanvasRenderingContext2D, list: Stroke[]) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of list) {
    ctx.strokeStyle = s.c; ctx.lineWidth = PX[s.w] ?? s.w;
    ctx.beginPath();
    if (s.p.length === 2) { ctx.arc(s.p[0], s.p[1], (PX[s.w] ?? s.w) / 2, 0, Math.PI * 2); ctx.fillStyle = s.c; ctx.fill(); continue; }
    ctx.moveTo(s.p[0], s.p[1]);
    // خط ناعم: منتصف كل نقطتين
    for (let i = 2; i < s.p.length - 2; i += 2) ctx.quadraticCurveTo(s.p[i], s.p[i + 1], (s.p[i] + s.p[i + 2]) / 2, (s.p[i + 1] + s.p[i + 3]) / 2);
    ctx.lineTo(s.p[s.p.length - 2], s.p[s.p.length - 1]);
    ctx.stroke();
  }
}

async function fontsReady() {
  try { await Promise.all([document.fonts.load(`700 40px QAppAr`, "اب"), document.fonts.load(`700 40px QAppEn`, "Ab1")]); await document.fonts.ready; } catch { /* بدون خطوط */ }
}
/** ورقة سؤال كاملة (الورقة + الكتابة) كصورة جواب */
async function sheetFile(info: HeaderInfo, n: number, imgUrl: string | null, strokes: Stroke[]) {
  await fontsReady();
  const img = imgUrl ? await loadImage(imgUrl) : null;
  const c = document.createElement("canvas"); c.width = W * SCALE; c.height = H * SCALE;
  const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawPaper(ctx, info, n, img); drawStrokes(ctx, strokes);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
  return blob ? new File([blob], `pen_q${n}.jpg`, { type: "image/jpeg" }) : null;
}

type FullApp = { isVersionAtLeast?(v: string): boolean; requestFullscreen?(): void; isFullscreen?: boolean };
/** الورقة تاخذ كل الشاشة، وملء الشاشة بالتليجرام إذا يدعمه (مثل صفحة التصحيح) */
function useFull() {
  useEffect(() => {
    document.body.classList.add("penfull");
    const w = (window as unknown as { Telegram?: { WebApp?: FullApp } }).Telegram?.WebApp;
    try { if (w?.isVersionAtLeast?.("8.0") && !w.isFullscreen) w.requestFullscreen?.(); } catch { /* نسخة قديمة */ }
    return () => { document.body.classList.remove("penfull"); };
  }, []);
}

export default function PenPage({ item, sid, model, head, questions, start, busy, timer, left, answered, need, onSend, onSubmit, onClose }: {
  item: number; sid: number; model: string; head: PenHead; questions: PenQ[]; start: number; busy: boolean; timer?: ReactNode; left: number;
  answered: number; need: number;
  onSend: (list: { n: number; file: File }[]) => Promise<boolean>; onSubmit: () => void; onClose: () => void;
}) {
  useFull();
  const bg = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(() => (questions.some((q) => q.n === start) ? start : questions[0]?.n ?? 1));
  const [strokes, setStrokes] = useState<Stroke[]>(() => readDraft(item, cur));
  // أرقام الأسئلة اللي كتب بيها وبعد ما أرسلها
  const [dirty, setDirtySet] = useState<Set<number>>(() => new Set(questions.filter((q) => isDirty(item, q.n)).map((q) => q.n)));
  // داس «✅ تم» عليها (خضرة)
  const [doneSet, setDoneSet] = useState<Set<number>>(() => new Set(questions.filter((q) => isDone(item, q.n)).map((q) => q.n)));
  const green = (n: number) => doneSet.has(n) || !!questions.find((x) => x.n === n)?.done;
  const [ask, setAsk] = useState(false);
  const live = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  /** الإصبع بعد ما انكتب بالقلم: ما يرسم، يحرك الورقة لفوك ولجوة */
  const drag = useRef<number | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [width, setWidth] = useState(2);
  const [penBox, setPenBox] = useState(false);
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState(0.5);
  const [sure, setSure] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<null | { count: number }>(null);
  const [msg, setMsg] = useState("");
  const info: HeaderInfo = { slug: head.slug, chapter: head.chapter, title: head.title, info: head.info, model, name: head.name, total: 0, lang: head.lang === "en" ? "en" : "ar", sid };
  const q = questions.find((x) => x.n === cur) ?? questions[0];
  const idx = questions.findIndex((x) => x.n === cur);

  // الورقة تدخل كلها بالشاشة تحت شريط الأدوات، بدون تحريك
  useEffect(() => {
    const size = () => {
      const top = bar.current?.getBoundingClientRect().bottom ?? 120;
      // حجم الصفحة (A+ / A−) يكبّر كلشي: الورقة تنحسب بدونه حتى تبقى داخل الشاشة
      const z = Number((document.documentElement.style as unknown as { zoom: string }).zoom) || 1;
      // الشاشة العريضة (الآيباد): الورقة بعرض الشاشة كله، وتنزل لجوة بالإصبع. الموبايل: الورقة كلها بالشاشة
      const wFit = (window.innerWidth - 12) / z / W, hFit = (window.innerHeight - top - 10) / z / H;
      setFit(Math.max(0.2, window.innerWidth >= 700 ? wFit : Math.min(wFit, hFit)));
    };
    size(); const t = setTimeout(size, 400);
    window.addEventListener("resize", size);
    return () => { clearTimeout(t); window.removeEventListener("resize", size); };
  }, []);
  // ورقة السؤال المفتوح: تنرسم من جديد كل ما يتبدل السؤال
  useEffect(() => {
    let off = false;
    setReady(false);
    (async () => {
      await fontsReady();
      const img = q?.img ? await loadImage(q.img) : null;
      if (off || !bg.current) return;
      const c = bg.current; c.width = W * SCALE; c.height = H * SCALE;
      const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawPaper(ctx, info, cur, img);
      setReady(true);
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, q?.img]);
  const redraw = useCallback(() => {
    const c = ink.current; if (!c) return;
    if (c.width !== W * SCALE) { c.width = W * SCALE; c.height = H * SCALE; }
    const ctx = c.getContext("2d")!; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); ctx.clearRect(0, 0, W, H);
    drawStrokes(ctx, live.current ? [...strokes, live.current] : strokes);
  }, [strokes]);
  useEffect(() => { redraw(); keepDraft(item, cur, strokes); }, [strokes, redraw, item, cur]);

  /** كل تغيير بالكتابة: ينحفظ بالجهاز، والسؤال ينحسب «كتبت بعد ما أرسلت» */
  function change(next: Stroke[] | ((old: Stroke[]) => Stroke[])) {
    setStrokes(next);
    if (Array.isArray(next) && !next.length && doneSet.has(cur)) { setDoneMark(item, cur, false); const d = new Set(doneSet); d.delete(cur); setDoneSet(d); }
    setDirty(item, cur, true);
    setDirtySet((d) => (d.has(cur) ? d : new Set(d).add(cur)));
    setMsg("");
  }
  /** «✅ تم»: رقم السؤال يصير أخضر، وتنفتح أول ورقة بعدها حمرة */
  function markDone() {
    if (!strokes.length) { setMsg("اكتب جوابك بهذي الورقة أول، وبعدها دوس ✅ تم."); return; }
    haptic(); setDoneMark(item, cur, true);
    const next = new Set(doneSet).add(cur); setDoneSet(next);
    const red = questions.filter((x) => !next.has(x.n) && !x.done);
    const after = red.find((x) => x.n > cur) ?? red[0];
    if (after) go(after.n); else setMsg("✅ كل الأسئلة خضر. دوس «📤 أرسل الأجوبة».");
  }
  function go(n: number) {
    if (n === cur || !questions.some((x) => x.n === n)) return;
    haptic(); live.current = null; setSure(false); setPenBox(false);
    setCur(n); setStrokes(readDraft(item, n));
  }

  const pt = (e: React.PointerEvent) => { const r = ink.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width * W).toFixed(1), +((e.clientY - r.top) / r.height * H).toFixed(1)] as const; };
  /** إذا انكتب بقلم الآيباد مرة، لمس الكف ما يرسم */
  const skip = (e: React.PointerEvent) => { if (e.pointerType === "pen") penSeen.current = true; return e.pointerType === "touch" && penSeen.current; };
  function erase(x: number, y: number) {
    const r = 22;
    const near = (s: Stroke) => {
      for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < r) return true;
      // خط المسطرة: نقطتين بس، فالممحاة تمسحه إذا قربت من أي مكان عليه
      if (s.p.length === 4) {
        const [ax, ay, bx, by] = s.p, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        if (Math.hypot(ax + k * dx - x, ay + k * dy - y) < r) return true;
      }
      return false;
    };
    const keep = strokes.filter((s) => !near(s));
    if (keep.length !== strokes.length) change(keep);
  }
  function down(e: React.PointerEvent) {
    if (skip(e)) { drag.current = e.clientY; return; }
    if (sending) return;
    e.preventDefault(); ink.current!.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    live.current = { c: color, w: width, p: tool === "ruler" ? [x, y, x, y] : [x, y] }; redraw();
  }
  function move(e: React.PointerEvent) {
    if (skip(e)) { if (drag.current !== null) { window.scrollBy(0, drag.current - e.clientY); drag.current = e.clientY; } return; }
    if (!(e.buttons & 1)) return;
    const [x, y] = pt(e);
    if (tool === "eraser") { erase(x, y); return; }
    if (!live.current) return;
    // المسطرة: من نقطة البداية لمكان القلم هسه، خط مستقيم
    if (tool === "ruler") { live.current.p[2] = x; live.current.p[3] = y; } else live.current.p.push(x, y);
    redraw();
  }
  function up() {
    if (!live.current) return;
    const s = live.current; live.current = null;
    // دسة بالمسطرة بدون سحب: نقطة
    if (s.p.length === 4 && Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) < 3) s.p = s.p.slice(0, 2);
    change((old) => [...old, s]);
  }
  /** «📤 أرسل الأجوبة»: كل ورقة كتب بيها بعد آخر إرسال تنرسل، مرة وحدة */
  async function sendAll(sure = false) {
    haptic(); setMsg("");
    const red = questions.filter((x) => !green(x.n));
    if (red.length && !sure) { setAsk(true); return; }
    setAsk(false);
    const list = questions.filter((x) => doneSet.has(x.n) && (dirty.has(x.n) || !x.done) && readDraft(item, x.n).length);
    if (!list.length) { setMsg(answered ? "ما أكو شي جديد بعد آخر إرسال." : "اكتب جوابك ودوس ✅ تم بكل ورقة، وبعدها أرسل."); if (answered) setSent({ count: 0 }); return; }
    setSending(true);
    try {
      const files: { n: number; file: File }[] = [];
      for (const x of list) {
        const f = await sheetFile(info, x.n, x.img, readDraft(item, x.n));
        if (!f) { setMsg(`ما گدرت أجهز ورقة السؤال ${x.n}، حاول مرة ثانية`); return; }
        files.push({ n: x.n, file: f });
      }
      if (!await onSend(files)) return;
      for (const x of list) setDirty(item, x.n, false);
      setDirtySet(new Set());
      setSent({ count: files.length });
    } finally { setSending(false); }
  }
  const pick = (t: Tool) => { if (t !== "eraser" && tool === t) setPenBox(!penBox); else setPenBox(false); setTool(t); };
  const missing = questions.filter((x) => !x.done).map((x) => x.n);
  return (
    <div className="pen-wrap">
      <div className="pen-bar" ref={bar}>
        <div className="pen-row">
          {timer}
          <button type="button" className="gk-ic" title="السؤال اللي قبله" disabled={idx <= 0} onClick={() => go(questions[idx - 1]?.n)}>›</button>
          <div className="pen-nums">
            {questions.map((x) => (
              <button type="button" key={x.n} className={"pen-num" + (x.n === cur ? " on" : "") + (green(x.n) ? " ok" : " no")}
                title={green(x.n) ? "خلصته ✅" : "بعده ما خلصته"} onClick={() => go(x.n)}>{x.n}</button>
            ))}
          </div>
          <button type="button" className="gk-ic" title="السؤال اللي بعده" disabled={idx >= questions.length - 1} onClick={() => go(questions[idx + 1]?.n)}>‹</button>
        </div>
        <div className="pen-row">
          <button type="button" className={"gk-ic" + (tool === "pen" ? " on" : "")} title="القلم" onClick={() => pick("pen")}><span style={{ color }}>🖊️</span></button>
          <button type="button" className={"gk-ic" + (tool === "ruler" ? " on" : "")} title="المسطرة: خط مستقيم" onClick={() => pick("ruler")}>📏</button>
          <button type="button" className={"gk-ic" + (tool === "eraser" ? " on" : "")} title="الممحاة" onClick={() => pick("eraser")}>🧽</button>
          <button type="button" className="gk-ic" title="رجوع" disabled={!strokes.length} onClick={() => change(strokes.slice(0, -1))}>↶</button>
          {sure
            ? <button type="button" className="gk-clear on" onClick={() => { change([]); setSure(false); }}>⚠️ متأكد؟</button>
            : <button type="button" className="gk-clear" disabled={!strokes.length} onClick={() => setSure(true)}>🗑 امسح الورقة</button>}
          <button type="button" className={"pen-tm" + (doneSet.has(cur) ? " on" : "")} disabled={sending} onClick={markDone}>✅ تم</button>
          <button type="button" className="btn pen-save" disabled={busy || sending} onClick={() => void sendAll()}>{sending || busy ? "جاري الإرسال..." : "📤 أرسل الأجوبة"}</button>
          <button type="button" className="exbtn pen-back" disabled={busy || sending} onClick={onClose}>↩️ رجوع</button>
        </div>
        {penBox && (
          <div className="gk-penbox">
            <div className="gk-lbl">{tool === "ruler" ? "خيارات المسطرة" : "خيارات القلم"}</div>
            <div className="gk-colors">{COLORS.filter((c) => c !== "#ffffff").map((c) => <button type="button" key={c} aria-label="لون" className={"gk-dot" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
            <label className="gk-custom">🎨 لون ثاني <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <div className="gk-tools">{WIDTHS.map((w) => <button type="button" key={w} className={"gk-w" + (width === w ? " on" : "")} onClick={() => setWidth(w)}><span style={{ height: w }} /></button>)}</div>
            <button type="button" className="gk-btn" onClick={() => setPenBox(false)}>تم</button>
          </div>
        )}
        {/* التنبيهات تطلع فوك الورقة بدون ما تدفعها لجوه */}
        <div className="pen-float">
        {left <= 3 && left > 0 && <div className="pen-msg bad">⚠️ باقي {left} {left === 1 ? "دقيقة" : "دقايق"}: دوس «📤 أرسل الأجوبة» هسه، حتى ما تضيع كتابتك.</div>}
        {msg && <div className="pen-msg">{msg}</div>}
        {ask && (
          <div className="pen-msg bad">
            🔴 باقي أسئلة حمر ما دسيت عليها «✅ تم»: {questions.filter((x) => !green(x.n)).map((x) => x.n).join("، ")}.
            <div className="exline"><button type="button" className="exbtn" onClick={() => void sendAll(true)}>📤 أرسل الخضر هسه</button><button type="button" className="exbtn" onClick={() => setAsk(false)}>رجوع أكمّل</button></div>
          </div>
        )}
        </div>
      </div>
      <div className="pen-sheet" style={{ width: W * fit, height: H * fit }}>
        {!ready && <div className="gk-empty">جاري تجهيز الورقة...</div>}
        <canvas ref={bg} style={{ width: W * fit, height: H * fit }} />
        <canvas ref={ink} style={{ width: W * fit, height: H * fit, touchAction: "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={(e) => { if (e.pointerType === "touch") drag.current = null; up(); }} onPointerCancel={() => { drag.current = null; live.current = null; redraw(); }} />
      </div>
      {sent && (
        <div className="pen-done" role="dialog">
          <div className="card agcard">
            <div className="agbody">
              {sent.count > 0 && <p className="agtext">✅ انرسلت {sent.count === 1 ? "ورقة وحدة" : sent.count === 2 ? "ورقتين" : `${sent.count} أوراق`}</p>}
              {answered >= need ? (
                <>
                  <p className="agtext agsmall">جاوبت {answered} من {questions.length}. تسلّم الامتحان هسه؟ بعد التسليم ما تگدر تغير.</p>
                  <button type="button" className="btn agbtn" disabled={busy} onClick={() => { haptic(); onSubmit(); }}>✅ إي، سلّم الامتحان</button>
                  <button type="button" className="exbtn" onClick={() => setSent(null)}>لا، أرجع أكتب</button>
                </>
              ) : (
                <>
                  <p className="agtext agsmall">باقي أسئلة ما جاوبتها: {missing.join("، ")}. التسليم يطلع بعد ما تجاوب {need === questions.length ? "كلها" : `${need} أسئلة`}.</p>
                  <button type="button" className="btn agbtn" onClick={() => { setSent(null); if (missing[0]) go(missing[0]); }}>✏️ كمّل الكتابة</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
