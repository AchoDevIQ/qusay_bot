"use client";
// «✍️ خط إيدي»: الأستاذ يكتب بقلم الآيباد على ورقة بيضة ✓ و✗ والمدح والملاحظات، يشوفها شلون تطلع على ورقة الطالب،
// وبعدين يرفعها. التصحيح الأحمر يرسمها بخطه هو بدل الخط. عام لكل المواضيع (exam=0)، وخاص لكل موضوع (طلبه 2026-11-21)
import { useEffect, useRef, useState } from "react";
import { InkSvg, inkPath, type InkShape } from "../myexams/AiCompare";
import VoiceText from "./VoiceText";

type Kind = "tick" | "cross" | "praise" | "note";
export type InkItem = InkShape & { id: number; kind: Kind; text: string };
type Call = (b: Record<string, unknown>) => Promise<{ inkOf?: { exam: number; items: InkItem[] } } | null>;

const RED = "#d40000";
/** مربع الكتابة: ✓ و✗ مربع، والكلام عريض. السطر 120 (نفس سطر الورقة)، وخط الكتابة على 240 */
const BOX: Record<Kind, { w: number; h: number }> = { tick: { w: 480, h: 360 }, cross: { w: 480, h: 360 }, praise: { w: 1000, h: 360 }, note: { w: 1000, h: 360 } };
const LINE = 240;
/** كم وحدة نقترح يكتب من كل نوع (أكثر من وحدة حتى ما تتكرر نفس الشكل بكل الأوراق) */
const KINDS: { k: Kind; t: string; want: number; how: string }[] = [
  { k: "tick", t: "✓ علامة الصح", want: 5, how: "اكتب ✓ بس، مثل ما تأشر على دفتر الطالب. ارفعها، وبعدين اكتبها مرة ثانية. 5 مرات، كل مرة لحالها." },
  { k: "cross", t: "✗ علامة الغلط", want: 5, how: "اكتب ✗ بس. 5 مرات، كل مرة لحالها." },
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
  async function upload(s: number[][]) {
    const b = BOX[adding!.kind];
    const d = await call({ action: "inkAdd", exam, item: { kind: adding!.kind, text: adding!.text, w: b.w, h: b.h, s } });
    if (got(d)) { setWriting(false); setDone(adding!.kind === "tick" ? "✓" : adding!.kind === "cross" ? "✗" : adding!.text); }
  }
  async function del(id: number) {
    if (!confirm("تمسح هاي من خطك؟")) return;
    got(await call({ action: "inkDel", exam, id }));
  }
  if (!items) return <div className="exhint">جاري التحميل...</div>;
  const count = (k: Kind) => items.filter((x) => x.kind === k).length;

  // الكتابة: ورقة بيضة، وبعدها «👁 شوف شلون تطلع»، وبعدها «📤 ارفع»
  if (adding && writing) return <Pad kind={adding.kind} label={adding.kind === "tick" ? "✓" : adding.kind === "cross" ? "✗" : adding.text} busy={busy} onCancel={() => setWriting(false)} onUpload={upload} />;
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

/** ورقة بيضة للقلم: يكتب، يرجع خط، يمسح الكل، و«👁 شوف» يطلعها على ورقة طالب بحجمها الحقيقي قبل الرفع */
function Pad({ kind, label, busy, onCancel, onUpload }: { kind: Kind; label: string; busy: boolean; onCancel: () => void; onUpload: (s: number[][]) => void }) {
  const { w, h } = BOX[kind];
  const cv = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [look, setLook] = useState(false);
  const live = useRef<number[] | null>(null);
  const penSeen = useRef(false);
  const all = () => (live.current ? [...strokes, live.current] : strokes);
  function draw(list = all()) {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    // سطور الورقة: خفيفة، حتى يكتب بحجم سطر الدفتر
    ctx.strokeStyle = "#c9d6ee"; ctx.lineWidth = 2;
    for (const y of [LINE - 120, LINE]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = RED; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const p of list) { ctx.beginPath(); const path = new Path2D(inkPath(p)); ctx.stroke(path); }
  }
  useEffect(() => { draw(); }); // كل تغيير يعيد الرسم
  const pt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * w), Math.round((e.clientY - r.top) / r.height * h)]; };
  /** إذا كتب بقلم الآيباد مرة، لمس الكف ما يكتب */
  const skip = (e: React.PointerEvent) => { if (e.pointerType === "pen") penSeen.current = true; return e.pointerType === "touch" && penSeen.current; };
  function down(e: React.PointerEvent) {
    if (skip(e)) return;
    e.preventDefault(); cv.current!.setPointerCapture(e.pointerId);
    live.current = pt(e); draw();
  }
  function move(e: React.PointerEvent) {
    if (skip(e) || !live.current || !(e.buttons & 1)) return;
    const [x, y] = pt(e), p = live.current;
    // نقطة جديدة بس إذا تحرك القلم شوية (أخف بالحفظ، ونفس الشكل)
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 3) { p.push(x, y); draw(); }
  }
  function up() { const p = live.current; if (p) { live.current = null; setStrokes((l) => [...l, p]); } }

  if (look) {
    const sh = { w, h, s: strokes };
    return (
      <div className="inkbox">
        <div className="exlabel">👁 هيچ تطلع «{label}» على ورقة الطالب</div>
        <div className="inkpaper">
          <div className="inkstu">z = 2(cos 23π/12 + i sin 23π/12)</div>
          <span className="inkon"><InkSvg sh={sh} color={RED} /></span>
          <div className="inkstu">= 2(0.96 − 0.25 i)</div>
        </div>
        <div className="exhint">بحجمها الحقيقي على ورقة بالتلفون. إذا عاجبتك ارفعها، وإذا لا ارجع وعدلها.</div>
        <div className="aig-logrow">
          <button type="button" className="btn" disabled={busy} onClick={() => onUpload(strokes)}>📤 ارفع</button>
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
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current = null; draw(); }} />
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

