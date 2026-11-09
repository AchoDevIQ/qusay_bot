"use client";
// أكثر من صفحة بنفس الوقت: كل صفحة تبقى مفتوحة بتبويب وتحتفظ بمكانك، وتنتقل بينها من الشريط
import Link from "next/link";
import { useState } from "react";
import { useAdminApi } from "../adminPage";

type Tile = { page: string; icon: string; title: string };
type Data = { groups: { title: string; tiles: Tile[] }[] };
type Tab = Tile & { key: number };

export default function MultiClient() {
  const { data, error } = useAdminApi<Data>("/api/admin", "⚙️ لوحة التحكم");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [on, setOn] = useState(0);
  const [picking, setPicking] = useState(true);
  const [next, setNext] = useState(1);
  function open(t: Tile) {
    const key = next;
    setNext(key + 1);
    setTabs([...tabs, { ...t, key }]);
    setOn(key);
    setPicking(false);
  }
  function close(key: number) {
    const left = tabs.filter((t) => t.key !== key);
    setTabs(left);
    if (on === key) { setOn(left[left.length - 1]?.key ?? 0); if (!left.length) setPicking(true); }
  }
  const src = (page: string) => `/store/${page}${typeof location === "undefined" ? "" : location.search}`;
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--ink, #0f1a2e)" }}>
      <div style={{ flex: "none", display: "flex", gap: 6, padding: 6, overflowX: "auto" }}>
        <Link className="exbtn" href={`/store/admin${typeof location === "undefined" ? "" : location.search}`} style={{ textDecoration: "none", flex: "none" }}>⬅️</Link>
        <button type="button" className={picking ? "btn" : "exbtn"} style={{ flex: "none", width: "auto" }} onClick={() => setPicking(true)}>➕ صفحة</button>
        {tabs.map((t) => (
          <span key={t.key} style={{ flex: "none", display: "flex" }}>
            <button type="button" className={!picking && on === t.key ? "btn" : "exbtn"} style={{ width: "auto" }} onClick={() => { setOn(t.key); setPicking(false); }}>{t.icon} {t.title}</button>
            <button type="button" className="exbtn" aria-label={`سكر ${t.title}`} style={{ width: "auto" }} onClick={() => close(t.key)}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ flex: "1 1 0", minHeight: 0, position: "relative" }}>
        {tabs.map((t) => <iframe key={t.key} title={t.title} src={src(t.page)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#fff", display: !picking && on === t.key ? "block" : "none" }} />)}
        {picking && (
          <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>
            <div className="wrap">
              {error && <div className="card warn exerr">⚠️ {error}</div>}
              {!data && !error && <div className="empty">جاري التحميل...</div>}
              <div className="exhint">اختار الصفحة اللي تريد تفتحها. الصفحات المفتوحة تبقى بالشريط فوك.</div>
              {data?.groups.map((g) => (
                <div className="card expad" key={g.title}>
                  <div className="exlabel">{g.title}</div>
                  <div className="exline adtop">{g.tiles.map((t) => <button type="button" key={t.page + t.title} className="exbtn" onClick={() => open(t)}>{t.icon} {t.title}</button>)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
