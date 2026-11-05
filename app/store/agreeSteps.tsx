"use client";
// شاشات التنبيهات داخل صفحة المتجر: موافقة، أو ترتيب كلمات الجملة
import { useState, type ReactNode } from "react";
import { haptic } from "./shared";

function shuffled(sentence: string) {
  const w = sentence.split(" ");
  do {
    for (let i = w.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [w[i], w[j]] = [w[j], w[i]];
    }
  } while (w.join(" ") === sentence);
  return w;
}

export function AgreeNotice({ step, title = "⚠️ تنبيه مهم", children, onOk, okLabel = "✅ موافق", other }: { step?: string; title?: string; children: ReactNode; onOk: () => void; okLabel?: string; other?: ReactNode }) {
  return (
    <div className="card agcard">
      <h2>{title}</h2>
      <div className="agbody">
        {step && <small className="agstep">{step}</small>}
        <p className="agtext">{children}</p>
        <button type="button" className="btn agbtn" onClick={() => { haptic(); onOk(); }}>{okLabel}</button>
        {other}
      </div>
    </div>
  );
}

export function WordOrder({ step, sentence, onDone }: { step?: string; sentence: string; onDone: () => void }) {
  const [pool, setPool] = useState(() => shuffled(sentence));
  const [picked, setPicked] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  const built = picked.map((i) => pool[i]).join(" ");
  const done = built === sentence;

  function pick(i: number) {
    haptic();
    const next = [...picked, i];
    setWrong(false);
    if (next.length === pool.length && next.map((x) => pool[x]).join(" ") !== sentence) {
      setPool(shuffled(sentence));
      setPicked([]);
      setWrong(true);
    } else setPicked(next);
  }
  return (
    <div className="card agcard">
      <h2>✍️ رتب الجملة</h2>
      <div className="agbody">
        {step && <small className="agstep">{step}</small>}
        <p className="agtext agsmall">حتى نتأكد إنك قريت الشرط، اضغط الكلمات بالترتيب حتى تطلع الجملة صحيحة:</p>
        <p className="agtext">{sentence}</p>
        <div className={"agbuilt" + (done ? " ok" : "")} aria-live="polite">{built || "اضغط أول كلمة..."}</div>
        {wrong && <div className="agwrong">⚠️ الترتيب غلط، رتبها مرة ثانية.</div>}
        {done ? <button type="button" className="btn agbtn" onClick={() => { haptic(); onDone(); }}>✅ موافق</button> : (
          <>
            <div className="agwords">
              {pool.map((w, i) => !picked.includes(i) && <button type="button" key={i} className="agword" onClick={() => pick(i)}>{w}</button>)}
            </div>
            {!!picked.length && <button type="button" className="btn ghost agbtn" onClick={() => setPicked(picked.slice(0, -1))}>↩️ امسح آخر كلمة</button>}
          </>
        )}
      </div>
    </div>
  );
}
