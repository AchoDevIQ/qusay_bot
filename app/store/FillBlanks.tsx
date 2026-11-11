"use client";
// «املأ الفراغات»: الجملة كاملة قدامه، وكل فراغ يدوسه ويختار الكلمة الصحيحة من 3. الغلط ما ينحط، ويقرا الجملة مرة ثانية
import { useEffect, useState } from "react";
import { makeBlanks, type Blank, type Part } from "../../lib/fillBlanks.ts";
import { haptic } from "./shared";

export default function FillBlanks({ text, filled = false, onDone }: { text: string; filled?: boolean; onDone: (done: boolean) => void }) {
  // الفراغات تنختار بالجهاز بعد ما تنفتح الصفحة (عشوائية، فكل مرة غير)
  const [parts, setParts] = useState<Part[] | null>(null);
  const [got, setGot] = useState<Record<number, string>>({});
  const [active, setActive] = useState<number | null>(null);
  const [wrong, setWrong] = useState("");
  useEffect(() => {
    const p = filled ? [text] : makeBlanks(text);
    setParts(p); setGot({}); setWrong("");
    const blanks = p.filter((x): x is Blank => typeof x !== "string");
    setActive(blanks[0]?.i ?? null);
    onDone(!blanks.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, filled]);
  if (!parts) return <div className="fbtext">{text}</div>;
  const blanks = parts.filter((x): x is Blank => typeof x !== "string");
  const cur = blanks.find((b) => b.i === active) ?? null;
  function pick(b: Blank, w: string) {
    haptic();
    if (w !== b.answer) { setWrong(`⚠️ «${w}» مو صحيحة. اقرا الجملة من أولها مرة ثانية.`); return; }
    const next = { ...got, [b.i]: w };
    setGot(next); setWrong("");
    const left = blanks.find((x) => !next[x.i]);
    setActive(left?.i ?? null);
    onDone(!left);
  }
  return (
    <div className="fb">
      <div className="fbtext">
        {parts.map((p, k) => (typeof p === "string" ? <span key={k}>{p}</span> : (
          <span key={k}>{p.pre}<button type="button" className={"fbblank" + (got[p.i] ? " ok" : "") + (active === p.i ? " on" : "")}
            onClick={() => { haptic(); setActive(p.i); setWrong(""); }}>{got[p.i] ?? "؟؟؟"}</button>{p.post}</span>
        )))}
      </div>
      {cur && (
        <div className="fbpick">
          <small>اختار الكلمة اللي تنحط بالفراغ المضوي:</small>
          <div className="fbopts">{cur.options.map((w) => <button type="button" key={w} className="fbopt" onClick={() => pick(cur, w)}>{w}</button>)}</div>
        </div>
      )}
      {wrong && <div className="rgwrong">{wrong}</div>}
      {!!blanks.length && !cur && <div className="fbdone">✅ كملت الجملة</div>}
    </div>
  );
}
