"use client";
// ✨ مميزات التطبيق: كل شي يسويه التطبيق، حسب الشخص. دوس القسم ينفتح، والبحث يدور بكل الأقسام
import { useState } from "react";
import { FEATURES, type FeatureSection } from "../../../lib/features.ts";
import { AdminHeader } from "../adminPage";

const hay = (s: FeatureSection) => [s.title, s.intro, ...s.blocks.flatMap((b) => [b.h, ...b.points])].join(" ");

export default function FeaturesClient() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const t = q.trim();
  const list = t ? FEATURES.filter((s) => hay(s).includes(t)) : FEATURES;
  return (
    <>
      <AdminHeader title="✨ مميزات التطبيق" />
      <div className="wrap">
        <div className="card expad">
          <div className="exhint">كل شي يسويه التطبيق، مرتب حسب الشخص: شنو يصير من الطول للطول. دوس على القسم حتى ينفتح. (خطوات «شلون أسوي» بـ«📖 دليل البوت».)</div>
          <input className="exinput adtop" placeholder="🔍 دور، مثلاً المحاسبة" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.map((s) => {
          const on = !!t || open === s.id;
          return (
            <div key={s.id} className="card ft-card">
              <button type="button" className="adchapter" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span>{s.icon} {s.title}</span><small>{on ? "▲" : "▼"}</small>
              </button>
              {on && <div className="expad">
                <div className="exhint">{s.intro}</div>
                {s.blocks.map((b) => (
                  <div key={b.h}>
                    <div className="exlabel adtop">{b.h}</div>
                    <ul className="ft-list">{b.points.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>}
            </div>
          );
        })}
        {!list.length && <div className="empty">ما لگيت شي بهالكلمة.</div>}
      </div>
      <style>{`.ft-card{border-right:5px solid #F6C94A}.ft-list{padding-inline-start:20px;margin:6px 0;line-height:1.9}.ft-list li{margin:4px 0}`}</style>
    </>
  );
}
