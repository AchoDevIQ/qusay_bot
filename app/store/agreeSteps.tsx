"use client";
// شاشات التنبيهات داخل صفحة المتجر: موافقة، أو «املأ الفراغات» بالجملة
import { useState, type ReactNode } from "react";
import FillBlanks from "./FillBlanks";
import { haptic } from "./shared";

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

/** «املأ الفراغات»: الجملة كاملة قدامه وبيها كم فراغ، يختار لكل فراغ الكلمة الصحيحة (اسمها القديم WordOrder بقى حتى ما تتغير الصفحات) */
export function WordOrder({ step, sentence, onDone, title = "✍️ كمل الجملة", intro = "حتى بعدين لا تقول أنا عبرت الشرط بدون ما أقرأ: اقرا الجملة، ودوس كل فراغ «؟؟؟» واختار الكلمة الصحيحة:", okLabel = "✅ موافق" }: { step?: string; sentence: string; onDone: () => void; title?: string; intro?: string; okLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="card agcard">
      <h2>{title}</h2>
      <div className="agbody">
        {step && <small className="agstep">{step}</small>}
        <p className="agtext agsmall">{intro}</p>
        <div className="agtext"><FillBlanks text={sentence} onDone={setDone} /></div>
        <button type="button" className="btn agbtn" disabled={!done} onClick={() => { haptic(); onDone(); }}>{done ? okLabel : "كمل الفراغات أول"}</button>
      </div>
    </div>
  );
}
