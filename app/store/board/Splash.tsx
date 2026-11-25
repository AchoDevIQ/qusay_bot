"use client";
// 🎬 دخولية السبورة (طلبه 2026-11-25): «كأنما اللوگو مالتي يتجمع ويفتح».
// قطع اللوگو تطير من كل صوب وتتجمع، لمعة ذهبية تعبر عليه، يطلع اسمه وشعاره، وبعدها الشاشة تنفتح بابين على السبورة.
// دوسة وحدة تعبرها. واللي مطفي الحركة بجهازه تطلعله بسيطة.
import { useEffect, useRef, useState } from "react";

const N = 6; // 6×6 قطع
// عشوائي ثابت (نفس القطع كل مرة، وما يختلف بين السيرفر والجهاز)
const rnd = (i: number, k: number) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
const TILES = Array.from({ length: N * N }, (_, i) => {
  const a = rnd(i, 1) * Math.PI * 2, d = 55 + rnd(i, 2) * 45;
  // أرقام مدوّرة: السيرفر والجهاز يطلعون نفس الشي بالضبط
  return { r: Math.floor(i / N), c: i % N, x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d), rot: Math.round((rnd(i, 3) - 0.5) * 540), delay: Math.round(rnd(i, 4) * 45) / 100 };
});
const OPEN_AT = 2900, DONE_AT = 3600;

export default function Splash({ onDone, slogan }: { onDone: () => void; slogan: string }) {
  const [open, setOpen] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    const a = window.setTimeout(() => setOpen(true), OPEN_AT);
    const b = window.setTimeout(() => finish(), DONE_AT);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };
  const skip = () => { if (open) return; setOpen(true); window.setTimeout(finish, 700); };
  return (
    <div className={`qs${open ? " open" : ""}`} onPointerDown={skip} aria-label="قصي العميري">
      <div className="qs-door l" /><div className="qs-door r" />
      <div className="qs-in">
        <div className="qs-logo">
          <div className="qs-ring" />
          {TILES.map((t, i) => (
            <i key={i} style={{
              ["--x" as string]: `${t.x}vmax`, ["--y" as string]: `${t.y}vmax`, ["--rot" as string]: `${t.rot}deg`, ["--d" as string]: `${t.delay}s`,
              backgroundPosition: `${t.c * 20}% ${t.r * 20}%`,
            }} />
          ))}
          <div className="qs-shine" />
        </div>
        <b className="qs-name">قصي العميري</b>
        <span className="qs-slogan">{slogan}</span>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.qs{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer}
.qs-door{position:absolute;top:0;bottom:0;width:50.5%;background:radial-gradient(120% 90% at 100% 50%,#1E2A44 0%,#141B2B 55%,#0D1220 100%);transition:transform .7s cubic-bezier(.7,0,.25,1)}
.qs-door.l{left:0;border-right:2px solid rgba(246,201,74,.0)}
.qs-door.r{right:0;transform:scaleX(-1)}
.qs.open .qs-door.l{transform:translateX(-101%)}
.qs.open .qs-door.r{transform:scaleX(-1) translateX(-101%)}
.qs-door::after{content:"";position:absolute;top:0;bottom:0;right:0;width:3px;background:linear-gradient(#0000,#F6C94A 30%,#FFE9A8 50%,#F6C94A 70%,#0000);opacity:0;transition:opacity .15s}
.qs.open .qs-door::after{opacity:1}
.qs-in{position:relative;display:flex;flex-direction:column;align-items:center;gap:min(14px,2vh);transition:transform .7s cubic-bezier(.7,0,.25,1),opacity .5s}
.qs.open .qs-in{transform:scale(1.35);opacity:0}
.qs-logo{direction:ltr;position:relative;width:min(300px,46vh);height:min(300px,46vh);display:grid;grid-template-columns:repeat(${N},1fr);grid-template-rows:repeat(${N},1fr)}
.qs-logo i{display:block;background-image:url(/app-logo.png);background-size:${N * 100}% ${N * 100}%;opacity:0;
  animation:qsFly 1.15s cubic-bezier(.2,.8,.25,1) var(--d) forwards}
@keyframes qsFly{0%{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--rot)) scale(.25);filter:blur(6px)}35%{opacity:1}100%{opacity:1;transform:none;filter:none}}
.qs-shine{position:absolute;inset:0;pointer-events:none;-webkit-mask:url(/app-logo.png) center/100% 100% no-repeat;mask:url(/app-logo.png) center/100% 100% no-repeat;
  background:linear-gradient(105deg,#0000 35%,rgba(255,250,225,.95) 50%,#0000 65%) no-repeat;background-size:250% 100%;background-position:150% 0;animation:qsShine .9s ease-in-out 1.65s forwards}
@keyframes qsShine{to{background-position:-50% 0}}
.qs-ring{position:absolute;left:50%;top:50%;width:62%;height:62%;margin:-31% 0 0 -31%;border-radius:50%;border:3px solid #F6C94A;opacity:0;animation:qsRing 1.1s ease-out 1.55s forwards}
@keyframes qsRing{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(1.9)}}
.qs-name{color:#F6C94A;font-size:min(56px,8.5vh,11vw);font-weight:800;opacity:0;transform:translateY(18px);animation:qsUp .6s ease-out 1.9s forwards;text-shadow:0 0 24px rgba(246,201,74,.35)}
.qs-slogan{color:#C9D1E0;font-size:min(22px,3.6vh,4.6vw);text-align:center;padding:0 16px;opacity:0;transform:translateY(14px);animation:qsUp .6s ease-out 2.2s forwards}
@keyframes qsUp{to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  .qs-logo i{animation:none;opacity:1}.qs-shine,.qs-ring{display:none}
  .qs-name,.qs-slogan{animation:none;opacity:1;transform:none}
  .qs-door,.qs-in{transition:opacity .4s}.qs.open .qs-door{opacity:0}
}
`;

// 🎬 الختامية: عكس الدخولية. البابين يتسكرون على السبورة واللوگو مجمّع، وبعدها قطعه تتفرق وتطلع
export function Outro({ onDone }: { onDone: () => void }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const a = window.setTimeout(() => setGo(true), 750);
    const b = window.setTimeout(onDone, 1750);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`qs qo${go ? " go" : ""}`} onPointerDown={onDone}>
      <div className="qs-door l" /><div className="qs-door r" />
      <div className="qs-in">
        <div className="qs-logo">
          {TILES.map((t, i) => (
            <i key={i} style={{ ["--x" as string]: `${t.x}vmax`, ["--y" as string]: `${t.y}vmax`, ["--rot" as string]: `${t.rot}deg`, ["--d" as string]: `${t.delay / 2}s`, backgroundPosition: `${t.c * 20}% ${t.r * 20}%` }} />
          ))}
        </div>
        <b className="qs-name">قصي العميري</b>
      </div>
      <style>{CSS + OUT}</style>
    </div>
  );
}
const OUT = `
.qo .qs-door.l{animation:qoL .6s cubic-bezier(.7,0,.25,1) both}
.qo .qs-door.r{animation:qoR .6s cubic-bezier(.7,0,.25,1) both}
@keyframes qoL{from{transform:translateX(-101%)}to{transform:none}}
@keyframes qoR{from{transform:scaleX(-1) translateX(-101%)}to{transform:scaleX(-1)}}
.qo .qs-in{opacity:0;animation:qoIn .3s .45s forwards}
@keyframes qoIn{to{opacity:1}}
.qo .qs-logo i{opacity:1;animation:none}
.qo.go .qs-logo i{animation:qoOut .8s cubic-bezier(.6,0,.8,.4) var(--d) forwards}
@keyframes qoOut{to{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--rot)) scale(.25);filter:blur(6px)}}
.qo .qs-name{opacity:1;transform:none;animation:none;transition:opacity .5s}
.qo.go .qs-name{opacity:0}
@media (prefers-reduced-motion: reduce){.qo .qs-door,.qo .qs-in,.qo.go .qs-logo i{animation:none;opacity:1}}
`;
