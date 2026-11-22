"use client";
// «✍️ خط إيدي»: الأستاذ يكتب بقلم الآيباد على ورقة بيضة ✓ و✗ والمدح والملاحظات، يشوفها شلون تطلع على ورقة الطالب،
// وبعدين يرفعها. التصحيح الأحمر يرسمها بخطه هو بدل الخط. عام لكل المواضيع (exam=0)، وخاص لكل موضوع (طلبه 2026-11-21)
import { useEffect, useRef, useState } from "react";
import { INK_COLORS, InkSvg, inkPath, type InkShape } from "../myexams/AiCompare";
import VoiceText from "./VoiceText";

type Kind = "tick" | "cross" | "praise" | "note" | "ask";
export type InkItem = InkShape & { id: number; kind: Kind; text: string };
type Call = (b: Record<string, unknown>) => Promise<{ inkOf?: { exam: number; items: InkItem[] } } | null>;

const RED = "#d40000";
/** مربع الكتابة: ✓ و✗ مربع، والكلام عريض. السطر 120 (نفس سطر الورقة)، وخط الكتابة على 240 */
const BOX: Record<Kind, { w: number; h: number }> = { tick: { w: 480, h: 360 }, cross: { w: 480, h: 360 }, ask: { w: 480, h: 360 }, praise: { w: 1000, h: 360 }, note: { w: 1000, h: 360 } };
const LINE = 240;
/** كم وحدة نقترح يكتب من كل نوع (أكثر من وحدة حتى ما تتكرر نفس الشكل بكل الأوراق) */
const KINDS: { k: Kind; t: string; want: number; how: string }[] = [
  { k: "tick", t: "✓ علامة الصح", want: 5, how: "اكتب ✓ بس، مثل ما تأشر على دفتر الطالب. ارفعها، وبعدين اكتبها مرة ثانية. 5 مرات، كل مرة لحالها." },
  { k: "cross", t: "✗ علامة الغلط", want: 5, how: "اكتب ✗ بس. 5 مرات، كل مرة لحالها." },
  { k: "ask", t: "؟ الحل ناقص", want: 3, how: "اكتب «؟» بس. تنحط تحت آخر جواب الطالب لمن يكون حله ناقص (ما كمل، ما رسم، ما كتب الجدول)، ويمها شنو ناقص. 3 مرات، كل مرة لحالها." },
  { k: "praise", t: "🌟 المدح", want: 9, how: "تنكتب بآخر السؤال اللي الطالب جابه كامل. اقتراحي: «أحسنت» 3 مرات، «ممتاز» 3، «عاشت إيدك» 3. وتگدر تضيف أي مدح تحبه." },
  { k: "note", t: "📝 ملاحظات", want: 0, how: "الملاحظات اللي تتكرر عندك هواية، مثل: «نسيت تعوض»، «الإشارة غلط»، «راجع القانون»، «ناقص». كل وحدة مرة وحدة تكفي. الذكاء من يكتب ملاحظة بنفس معناها، يحط خطك بدلها. والملاحظة اللي ما إلها خط تنكتب بالرقعة." },
];
const PRAISE = ["أحسنت", "ممتاز", "عاشت إيدك", "بطل", "رائع"];

export default function InkBook({ exam, call, busy }: { exam: number; call: Call; busy: boolean }) {
  const [items, setItems] = useState<InkItem[] | null>(null);
  const [adding, setAdding] = useState<{ kind: Kind; text: string } | null>(null);
  const [writing, setWriting] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => { void call({ action: "inkList", exam }).then((d) => { if (d?.inkOf?.exam === exam) setItems(d.inkOf.items); }); }, [exam]); // eslint-disable-line react-hooks/exhaustive-deps
  const got = (d: Awaited<ReturnType<Call>>) => { if (d?.inkOf?.exam === exam) { setItems(d.inkOf.items); return true; } return false; };
  async function upload(s: number[][], c: string, wd: 1 | 2 | 3) {
    const b = BOX[adding!.kind];
    const d = await call({ action: "inkAdd", exam, item: { kind: adding!.kind, text: adding!.text, w: b.w, h: b.h, s, c, wd } });
    if (got(d)) { setWriting(false); setDone(adding!.kind === "tick" ? "✓" : adding!.kind === "cross" ? "✗" : adding!.kind === "ask" ? "؟" : adding!.text); }
  }
  async function del(id: number) {
    if (!confirm("تمسح هاي من خطك؟")) return;
    got(await call({ action: "inkDel", exam, id }));
  }
  if (!items) return <div className="exhint">جاري التحميل...</div>;
  const count = (k: Kind) => items.filter((x) => x.kind === k).length;

  // الكتابة: ورقة بيضة، وبعدها «👁 شوف شلون تطلع»، وبعدها «📤 ارفع»
  if (adding && writing) return <Pad kind={adding.kind} label={adding.kind === "tick" ? "✓" : adding.kind === "cross" ? "✗" : adding.kind === "ask" ? "؟" : adding.text} busy={busy} onCancel={() => setWriting(false)} onUpload={upload} />;
  if (adding) {
    const k = KINDS.find((x) => x.k === adding.kind)!;
    const needText = adding.kind === "praise" || adding.kind === "note";
    return (
      <div className="inkbox">
        <div className="exlabel">{k.t}</div>
        {done && <div className="fdok">✅ انرفعت «{done}». تگدر تكتبها مرة ثانية (شكل ثاني)، لو ترجع.</div>}
        <div className="exhint">{k.how}</div>
        {needText && <>
          <div className="exhint">{adding.kind === "praise" ? "شنو المدح اللي راح تكتبه؟" : "شنو الملاحظة اللي راح تكتبها؟ اكتبها هنا بالضبط مثل ما راح تكتبها بالقلم، حتى الذكاء يعرف معناها."}</div>
          {adding.kind === "praise" && <div className="seg">{PRAISE.map((p) => <button key={p} type="button" className={adding.text === p ? "on" : ""} onClick={() => setAdding({ ...adding, text: p })}>{p}</button>)}</div>}
          <VoiceText value={adding.text} onChange={(v) => setAdding({ ...adding, text: v.replace(/\n/g, " ").slice(0, 60) })} rows={1} maxLength={60} />
        </>}
        <div className="aig-logrow">
          <button type="button" className="btn" disabled={needText && !adding.text.trim()} onClick={() => { setDone(""); setWriting(true); }}>✍️ {done ? "اكتبها مرة ثانية" : "اكتب بالقلم"}</button>
          <button type="button" className="btn ghost" onClick={() => { setAdding(null); setDone(""); }}>↩️ رجوع</button>
        </div>
      </div>
    );
  }
  return (
    <div className="inkbox">
      <div className="exhint">
        {exam ? "خطك الخاص بهذا الموضوع: ينضاف فوك خطك العام، ويطلع بس بأوراق هذا الموضوع (مثلاً ملاحظات تخص قانون هذا الموضوع)." : "خطك لكل المواضيع."}
        {" "}افتح هاي الصفحة بالآيباد واكتب بالقلم. كل شي تكتبه تشوف شلون يطلع على ورقة الطالب قبل ما ترفعه. ما يكلف فلوس.
      </div>
      {KINDS.map((k) => {
        const mine = items.filter((x) => x.kind === k.k);
        return (
          <div key={k.k} className="inkkind">
            <div className="aig-logrow">
              <b>{k.t}</b>
              {!exam && k.want > 0 && <small className={count(k.k) >= k.want ? "fdok" : ""}>{count(k.k)} من {k.want}</small>}
              <button type="button" className="exbtn" disabled={busy} onClick={() => { setDone(""); setAdding({ kind: k.k, text: k.k === "praise" ? "أحسنت" : "" }); }}>➕ أضف</button>
            </div>
            {mine.length > 0 && (
              <div className="inklist">
                {mine.map((x) => (
                  <div key={x.id} className="inkitem">
                    <span className="inkpic"><InkSvg sh={x} k={0.35} color={RED} /></span>
                    {(x.kind === "praise" || x.kind === "note") && <small>{x.text}</small>}
                    <button type="button" className="exbtn" disabled={busy} onClick={() => void del(x.id)} aria-label="امسح">🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** سمك الخط بمربع الكتابة (نفس نسبته على ورقة الطالب) */
const PAD_W: Record<1 | 2 | 3, number> = { 1: 4.5, 2: 7, 3: 11 };
const SIZES: { wd: 1 | 2 | 3; t: string }[] = [{ wd: 1, t: "رفيع" }, { wd: 2, t: "وسط" }, { wd: 3, t: "ثخين" }];
/** آخر لون وسمك اختارهم يبقون للمرة الجاية (بهذا الجهاز) */
const PEN_KEY = "qgInkPen";
function savedPen(): { c: string; wd: 1 | 2 | 3 } {
  try {
    const j = JSON.parse(localStorage.getItem(PEN_KEY) ?? "{}");
    return { c: INK_COLORS.some((x) => x.c === j.c) ? j.c : RED, wd: [1, 2, 3].includes(j.wd) ? j.wd : 2 };
  } catch { return { c: RED, wd: 2 }; }
}
type TgSwipe = { Telegram?: { WebApp?: { disableVerticalSwipes?: () => void; enableVerticalSwipes?: () => void } } };
/** داخل تليگرام: سحبة القلم لتحت چانت تسد الصفحة وتقطع الخط. توگف وهو يكتب */
function tgSwipes(on: boolean) {
  const wins: Window[] = [window];
  try { if (window.parent !== window) wins.push(window.parent); } catch { /* */ }
  for (const w of wins) {
    try { const a = (w as unknown as TgSwipe).Telegram?.WebApp; (on ? a?.enableVerticalSwipes : a?.disableVerticalSwipes)?.call(a); } catch { /* */ }
  }
}

/** ورقة بيضة للقلم: يكتب، يرجع خط، يمسح الكل، و«👁 شوف» يطلعها على ورقة طالب بحجمها الحقيقي قبل الرفع.
 *  القلم ناعم وما يقطع (طلب الأستاذ 2026-11-22): كل نقاط القلم (حتى اللي بين إطارين)، يرسم بس القطعة الجديدة،
 *  وإذا الجهاز قطع اللمسة يبقى الخط مو ينمسح. ويختار اللون والسمك */
function Pad({ kind, label, busy, onCancel, onUpload }: { kind: Kind; label: string; busy: boolean; onCancel: () => void; onUpload: (s: number[][], c: string, wd: 1 | 2 | 3) => void }) {
  const { w, h } = BOX[kind];
  const cv = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [look, setLook] = useState(false);
  const [pen, setPen] = useState(savedPen);
  const live = useRef<number[] | null>(null);
  const penSeen = useRef(false);
  const choose = (p: { c: string; wd: 1 | 2 | 3 }) => { setPen(p); try { localStorage.setItem(PEN_KEY, JSON.stringify(p)); } catch { /* */ } };
  function ctxPen() {
    const ctx = cv.current!.getContext("2d")!;
    ctx.strokeStyle = pen.c; ctx.lineWidth = PAD_W[pen.wd]; ctx.lineCap = "round"; ctx.lineJoin = "round";
    return ctx;
  }
  function draw() {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    // سطور الورقة: خفيفة، حتى يكتب بحجم سطر الدفتر
    ctx.strokeStyle = "#c9d6ee"; ctx.lineWidth = 2;
    for (const y of [LINE - 120, LINE]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctxPen();
    for (const p of live.current ? [...strokes, live.current] : strokes) ctx.stroke(new Path2D(inkPath(p)));
  }
  useEffect(() => { draw(); }); // الخطوط أو اللون أو السمك تغيرت: يعيد الرسم كله
  useEffect(() => {
    tgSwipes(false);
    // سفاري الآيباد: اللمسة على المربع ما تحرك الصفحة أبداً
    const c = cv.current, stop = (e: TouchEvent) => e.preventDefault();
    c?.addEventListener("touchstart", stop, { passive: false });
    c?.addEventListener("touchmove", stop, { passive: false });
    return () => { tgSwipes(true); c?.removeEventListener("touchstart", stop); c?.removeEventListener("touchmove", stop); };
  }, [look]);
  const pt = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * w * 10) / 10, Math.round((e.clientY - r.top) / r.height * h * 10) / 10]; };
  /** إذا كتب بقلم الآيباد مرة، لمس الكف ما يكتب */
  const skip = (e: React.PointerEvent) => { if (e.pointerType === "pen") penSeen.current = true; return e.pointerType === "touch" && penSeen.current; };
  function down(e: React.PointerEvent) {
    if (skip(e)) return;
    e.preventDefault();
    try { cv.current!.setPointerCapture(e.pointerId); } catch { /* */ }
    live.current = pt(e);
    const ctx = ctxPen(), [x, y] = live.current;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y); ctx.stroke();
  }
  function move(e: React.PointerEvent) {
    if (skip(e) || !live.current) return;
    const p = live.current, ctx = ctxPen();
    // قلم الآيباد يعطي نقاط أكثر من إطارات الشاشة: ناخذها كلها حتى الخط ما يطلع مكسر
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      const [x, y] = pt(ev), lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 1.5) continue;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
      p.push(x, y);
    }
  }
  /** نهاية الخط. وإذا الجهاز قطع اللمسة (cancel)، الخط يبقى مثل ما انكتب */
  function up() { const p = live.current; if (p) { live.current = null; setStrokes((l) => [...l, p.map((v) => Math.round(v))]); } }

  if (look) {
    const sh = { w, h, s: strokes, c: pen.c, wd: pen.wd };
    return (
      <div className="inkbox">
        <div className="exlabel">👁 هيچ تطلع «{label}» على ورقة الطالب</div>
        <div className="inkpaper">
          <div className="inkstu">z = 2(cos 23π/12 + i sin 23π/12)</div>
          <span className="inkon"><InkSvg sh={sh} /></span>
          <div className="inkstu">= 2(0.96 − 0.25 i)</div>
        </div>
        <div className="exhint">بحجمها الحقيقي على ورقة بالتلفون. إذا عاجبتك ارفعها، وإذا لا ارجع وعدلها.</div>
        <div className="aig-logrow">
          <button type="button" className="btn" disabled={busy} onClick={() => onUpload(strokes, pen.c, pen.wd)}>📤 ارفع</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setLook(false)}>✏️ ارجع عدّل</button>
        </div>
      </div>
    );
  }
  return (
    <div className="inkbox">
      <div className="exlabel">✍️ اكتب «{label}» بالقلم</div>
      <div className="exhint">اكتبها على السطر بحجمها الطبيعي، مثل ما تكتبها على دفتر الطالب. ما يهم وين بالمربع: تنقص على قدها وحدها.</div>
      <canvas ref={cv} width={w} height={h} className="inkpad" style={{ aspectRatio: `${w} / ${h}`, maxWidth: kind === "tick" || kind === "cross" ? 340 : 700 }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
      <div className="exhint">اللون:</div>
      <div className="inkcolors">
        {INK_COLORS.map((x) => <button key={x.c} type="button" className={pen.c === x.c ? "on" : ""} style={{ background: x.c }} onClick={() => choose({ ...pen, c: x.c })} aria-label={x.t} title={x.t} />)}
      </div>
      <div className="exhint">سمك الخط:</div>
      <div className="seg">
        {SIZES.map((x) => <button key={x.wd} type="button" className={pen.wd === x.wd ? "on" : ""} onClick={() => choose({ ...pen, wd: x.wd })}>
          <svg width="44" height="14" aria-hidden><line x1="6" y1="7" x2="38" y2="7" stroke={pen.c} strokeWidth={PAD_W[x.wd] / 2.2} strokeLinecap="round" /></svg> {x.t}
        </button>)}
      </div>
      <div className="aig-logrow">
        <button type="button" className="exbtn" disabled={!strokes.length} onClick={() => setStrokes(strokes.slice(0, -1))}>↩️ رجّع خط</button>
        <button type="button" className="exbtn" disabled={!strokes.length} onClick={() => setStrokes([])}>🗑 امسح الكل</button>
      </div>
      <div className="aig-logrow">
        <button type="button" className="btn" disabled={!strokes.length} onClick={() => setLook(true)}>👁 شوف شلون تطلع</button>
        <button type="button" className="btn ghost" onClick={onCancel}>↩️ رجوع</button>
      </div>
    </div>
  );
}

