// خطوات قسم من الدليل: تنعرض بصفحة الدليل وبصفحة تست التطبيق
import type { GuideSection } from "../../../lib/guide.ts";

export default function GuideBody({ s }: { s: GuideSection }) {
  return (
    <>
      <div className="exhint">{s.intro}</div>
      <div className="tsperm">🔑 الصلاحية: {s.perm}</div>
      {s.blocks.map((b, i) => (
        <div key={i}>
          {b.h && <div className="exlabel adtop">{b.h}</div>}
          {b.steps && <ol style={{ paddingInlineStart: 22, margin: "6px 0" }}>{b.steps.map((x, j) => <li key={j} style={{ margin: "5px 0" }}>{x}</li>)}</ol>}
          {b.notes?.map((x, j) => <div key={j} className="exhint">💡 {x}</div>)}
        </div>
      ))}
    </>
  );
}
