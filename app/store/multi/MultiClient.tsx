"use client";
// أكثر من صفحة بنفس الوقت: كل صفحة تبقى مفتوحة بتبويب وتحتفظ بمكانك، وتنتقل بينها من الشريط.
// تسحب التبويب لتحت وتحطه جنب الصفحة المفتوحة، فيطلعون سوا. الإطارات ما تتحرك بالصفحة، بس مكانها يتغير، حتى ما تنعاد من الأول
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useAdminApi } from "../adminPage";
import { closePane, isStacked, maxPanes, paneFit, placePane, showTab, slotAt, slotCount, togglePane } from "./panes";

type Tile = { page: string; icon: string; title: string };
type Data = { groups: { title: string; tiles: Tile[] }[] };
type Tab = Tile & { key: number };
type Ghost = { tab: Tab; x: number; y: number; slot: number; count: number } | null;
type TgSwipes = { disableVerticalSwipes?(): void; enableVerticalSwipes?(): void; isVersionAtLeast?(v: string): boolean };
const tgSwipes = () => (window as unknown as { Telegram?: { WebApp?: TgSwipes } }).Telegram?.WebApp;
// تليجرام يسد الصفحة إذا سحبت لتحت، فيتطفى هذا طول ما إنت بهاي الصفحة
const swipes = (on: boolean) => {
  try { const w = tgSwipes(); if (w?.isVersionAtLeast?.("7.7")) { if (on) w.enableVerticalSwipes?.(); else w.disableVerticalSwipes?.(); } } catch { /* نسخة تليجرام قديمة */ }
};

// أزرار A+ وA− تكبر الصفحة كلها، ومكان الإصبع يجي بدون هذا التكبير
const pageZoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("zoom")) || 1;

/** مكان القسم رقم i من n بالمساحة */
function box(i: number, n: number, stacked: boolean): CSSProperties {
  const part = `${100 / n}%`, from = `${(i * 100) / n}%`;
  return stacked ? { top: from, right: 0, width: "100%", height: part } : { top: 0, right: from, width: part, height: "100%" };
}

export default function MultiClient() {
  const { data, error } = useAdminApi<Data>("/api/admin", "⚙️ لوحة التحكم");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [panes, setPanes] = useState<number[]>([]);
  const [on, setOn] = useState(0);
  const [picking, setPicking] = useState(true);
  const [next, setNext] = useState(1);
  const [width, setWidth] = useState(1000);
  const [zoom, setZoom] = useState(1);
  const [ghost, setGhost] = useState<Ghost>(null);
  const area = useRef<HTMLDivElement>(null);
  const press = useRef<{ tab: Tab; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const size = () => { setWidth(window.innerWidth); setZoom(pageZoom()); };
    size();
    window.addEventListener("resize", size);
    // أزرار A+ وA− تغير تكبير الصفحة
    const watch = new MutationObserver(size);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => { window.removeEventListener("resize", size); watch.disconnect(); swipes(true); };
  }, []);

  const stacked = isStacked(width), max = maxPanes(width);
  const shown = panes.slice(0, max);
  const fit = paneFit(stacked ? width : width / Math.max(1, shown.length), zoom);

  function open(t: Tile) {
    const key = next;
    setNext(key + 1);
    setTabs([...tabs, { ...t, key }]);
    setPanes(showTab(panes, key, on));
    setOn(key);
    setPicking(false);
  }
  function close(key: number) {
    const left = tabs.filter((t) => t.key !== key);
    const after = closePane(panes, key, left.map((t) => t.key));
    setTabs(left);
    setPanes(after);
    if (on === key) setOn(after[after.length - 1] ?? 0);
    if (!left.length) setPicking(true);
  }
  function tap(key: number) {
    if (dragged.current) { dragged.current = false; return; }
    setPanes(showTab(shown, key, on));
    setOn(key);
    setPicking(false);
  }
  function side(key: number) {
    setPanes(togglePane(shown, key, max));
    setOn(key);
    setPicking(false);
  }

  /** وين ينحط التبويب إذا تركته هنا. null: الإصبع برا مساحة الصفحات */
  function target(key: number, x: number, y: number) {
    const r = area.current?.getBoundingClientRect();
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const count = slotCount(shown, key, max);
    return { slot: slotAt(stacked ? (y - r.top) / r.height : (r.right - x) / r.width, count), count };
  }
  function down(e: ReactPointerEvent<HTMLButtonElement>, tab: Tab) {
    press.current = { tab, x: e.clientX, y: e.clientY, moved: false };
    dragged.current = false;
    swipes(false);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* المتصفح ما يدعمها */ }
  }
  function move(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    if (!p) return;
    const dy = e.clientY - p.y, dx = e.clientX - p.x;
    // السحب لليمين واليسار يبقى يحرك الشريط، والسحب لتحت هو اللي ياخذ التبويب
    if (!p.moved) { if (dy > 12 && dy > Math.abs(dx)) p.moved = true; else return; }
    const t = target(p.tab.key, e.clientX, e.clientY);
    setGhost({ tab: p.tab, x: e.clientX, y: e.clientY, slot: t?.slot ?? -1, count: t?.count ?? 0 });
  }
  function up(e: ReactPointerEvent<HTMLButtonElement>) {
    const p = press.current;
    press.current = null;
    setGhost(null);
    if (!p?.moved) return;
    dragged.current = true;
    const t = target(p.tab.key, e.clientX, e.clientY);
    if (!t) return;
    setPanes(placePane(shown, p.tab.key, t.slot, max));
    setOn(p.tab.key);
    setPicking(false);
  }
  function cancel() { press.current = null; setGhost(null); }

  const src = (page: string) => `/store/${page}${typeof location === "undefined" ? "" : location.search}`;
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--ink, #0f1a2e)" }}>
      <div style={{ flex: "none", display: "flex", gap: 6, padding: 6, overflowX: "auto" }}>
        <Link className="exbtn" href={`/store/admin${typeof location === "undefined" ? "" : location.search}`} style={{ textDecoration: "none", flex: "none" }}>⬅️</Link>
        <button type="button" className={picking ? "btn" : "exbtn"} style={{ flex: "none", width: "auto" }} onClick={() => setPicking(true)}>➕ صفحة</button>
        {tabs.map((t) => (
          <span key={t.key} style={{ flex: "none", display: "flex" }}>
            <button type="button" className={!picking && shown.includes(t.key) ? "btn" : "exbtn"} style={{ width: "auto", touchAction: "pan-x", userSelect: "none", WebkitUserSelect: "none" }}
              onPointerDown={(e) => down(e, t)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onClick={() => tap(t.key)}>{t.icon} {t.title}</button>
            {tabs.length > 1 && <button type="button" className={shown.includes(t.key) && shown.length > 1 ? "btn" : "exbtn"} aria-label={`حط ${t.title} جنب الصفحة`} title="جنب الصفحة" style={{ width: "auto" }} onClick={() => side(t.key)}>◫</button>}
            <button type="button" className="exbtn" aria-label={`سكر ${t.title}`} style={{ width: "auto" }} onClick={() => close(t.key)}>✕</button>
          </span>
        ))}
      </div>
      <div ref={area} style={{ flex: "1 1 0", minHeight: 0, position: "relative" }}>
        {tabs.map((t) => {
          const i = shown.indexOf(t.key);
          const seen = !picking && i >= 0;
          const edge = seen && i > 0 ? (stacked ? { borderTop: "2px solid var(--gold, #F9C445)" } : { borderRight: "2px solid var(--gold, #F9C445)" }) : {};
          return <iframe key={t.key} title={t.title} src={src(t.page)} style={{ position: "absolute", boxSizing: "border-box", border: 0, background: "#fff", display: seen ? "block" : "none", ...(seen ? { ...box(i, shown.length, stacked), zoom: fit } : {}), ...edge }} />;
        })}
        {picking && (
          <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>
            <div className="wrap">
              {error && <div className="card warn exerr">⚠️ {error}</div>}
              {!data && !error && <div className="empty">جاري التحميل...</div>}
              <div className="exhint">اختار الصفحة اللي تريد تفتحها. الصفحات المفتوحة تبقى بالشريط فوك. حتى تطلع صفحتين جنب بعض: اسحب التبويب من الشريط لتحت وحطه جنب الصفحة، أو دوس ◫ جنب اسمه.</div>
              {data?.groups.map((g) => (
                <div className="card expad" key={g.title}>
                  <div className="exlabel">{g.title}</div>
                  <div className="exline adtop">{g.tiles.map((t) => <button type="button" key={t.page + t.title} className="exbtn" onClick={() => open(t)}>{t.icon} {t.title}</button>)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {ghost && <div style={{ position: "absolute", inset: 0, background: "rgba(16,25,41,.35)", pointerEvents: "none" }} />}
        {ghost && ghost.slot >= 0 && <div style={{ position: "absolute", boxSizing: "border-box", border: "3px dashed var(--gold, #F9C445)", background: "rgba(249,196,69,.18)", pointerEvents: "none", ...box(ghost.slot, ghost.count, stacked) }} />}
      </div>
      {ghost && <div className="btn" style={{ position: "fixed", left: ghost.x / pageZoom(), top: ghost.y / pageZoom(), transform: "translate(-50%,-50%)", width: "auto", pointerEvents: "none", zIndex: 10, whiteSpace: "nowrap" }}>{ghost.tab.icon} {ghost.tab.title}</div>}
    </div>
  );
}
