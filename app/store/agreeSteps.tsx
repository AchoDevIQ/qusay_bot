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

export function WordOrder({ step, sentence, onDone, title = "✍️ رتب الجملة", intro = "حتى بعدين لا تقول أنا عبرت الشرط بدون ما أقرأ، اضغط الكلمات بالترتيب:", okLabel = "✅ موافق" }: { step?: string; sentence: string; onDone: () => void; title?: string; intro?: string; okLabel?: string }) {
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
      <h2>{title}</h2>
      <div className="agbody">
        {step && <small className="agstep">{step}</small>}
        <p className="agtext agsmall">{intro}</p>
        <p className="agtext">{sentence}</p>
        {/* الكلمات اللي اختارها: كل وحدة يدوسها تنمسح وترجع للكلمات جوة */}
        <div className={"agbuilt" + (done ? " ok" : "")} aria-live="polite">
          {!picked.length ? "اضغط أول كلمة..." : done ? built : picked.map((i, k) => (
            <button type="button" key={k} className="agchip" aria-label={`امسح ${pool[i]}`} onClick={() => { haptic(); setPicked(picked.filter((_, j) => j !== k)); }}>{pool[i]} <span>✕</span></button>
          ))}
        </div>
        {!done && !!picked.length && (
          <div className="agfix">
            <small>اخترت كلمة غلط؟ دوس عليها فوك حتى تنمسح.</small>
            <button type="button" className="exbtn" onClick={() => { haptic(); setPicked(picked.slice(0, -1)); }}>⌫ امسح آخر كلمة</button>
            <button type="button" className="exbtn" onClick={() => { haptic(); setPicked([]); }}>🗑 امسح الكل</button>
          </div>
        )}
        {wrong && <div className="agwrong">⚠️ الترتيب غلط، رتبها مرة ثانية.</div>}
        {done ? <button type="button" className="btn agbtn" onClick={() => { haptic(); onDone(); }}>{okLabel}</button> : (
          <>
            <div className="agwords">
              {pool.map((w, i) => !picked.includes(i) && <button type="button" key={i} className="agword" onClick={() => pick(i)}>{w}</button>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
