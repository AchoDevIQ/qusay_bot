"use client";
// الصفحة الرئيسية للوحة التحكم: تطلع الأقسام اللي عند الشخص صلاحيتها
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Tile = { page: string; icon: string; title: string; note?: string; hot?: boolean };
type Data = { groups: { title: string; tiles: Tile[] }[]; closed?: boolean; owner?: boolean; asGrader?: boolean };
type Size = "small" | "mid" | "big";

const SIZES: { key: Size; label: string }[] = [{ key: "small", label: "صغير" }, { key: "mid", label: "وسط" }, { key: "big", label: "كبير" }];
const SIZE_KEY = "adminTileSize";

export default function AdminHomeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/admin", "⚙️ لوحة التحكم");
  // الحجم يبقى محفوظ على نفس الجهاز، وإذا ما انحفظ تبقى الصفحة شغالة بالوسط
  const [size, setSize] = useState<Size>("mid");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIZE_KEY);
      if (SIZES.some((s) => s.key === saved)) setSize(saved as Size);
    } catch { /* المتصفح مانع الحفظ */ }
  }, []);
  function pick(next: Size) {
    setSize(next);
    try { localStorage.setItem(SIZE_KEY, next); } catch { /* المتصفح مانع الحفظ */ }
  }
  const search = typeof location === "undefined" ? "" : location.search;
  async function asStudent() {
    if (await call({ action: "asStudent" })) (window as unknown as { Telegram?: { WebApp?: { close?: () => void } } }).Telegram?.WebApp?.close?.();
  }
  return (
    <>
      <AdminHeader title="⚙️ لوحة التحكم" home />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data?.closed && <div className="empty">👁 صرت تشوف البوت مثل الطالب. سكر هاي الصفحة.</div>}
        {data?.asGrader && (
          <div className="card warn exerr">✍️ هسه تشوف لوحة التحكم مثل مساعد عنده التصحيح بس.
            <button type="button" className="exbtn adstudent" disabled={busy} onClick={() => void call({ action: "endGrader" })}>↩️ إنهاء التجربة كمصحح</button>
          </div>
        )}
        {data && !data.closed && (
          <div className="adsizes" role="group" aria-label="حجم المربعات">
            {SIZES.map((s) => (
              <button key={s.key} type="button" className={"adsize" + (size === s.key ? " on" : "")} aria-pressed={size === s.key} onClick={() => pick(s.key)}>{s.label}</button>
            ))}
          </div>
        )}
        {data && !data.closed && <Link className="exbtn" href={`/store/multi${search}`} style={{ textDecoration: "none", display: "block", textAlign: "center", marginBottom: 10 }}>🗂 فتح أكثر من صفحة</Link>}
        {data?.groups.map((g) => (
          <section key={g.title}>
            <div className="adgroup">{g.title}</div>
            <div className={"adtiles " + size}>
              {g.tiles.map((t) => (
                <Link key={t.page} href={`/store/${t.page}`} className={"adtile" + (t.hot ? " hot" : "")}>
                  <span className="adicon">{t.icon}</span>
                  <b>{t.title}</b>
                  {t.note && <small>{t.note}</small>}
                </Link>
              ))}
            </div>
          </section>
        ))}
        {data?.owner && <button type="button" className="exbtn adstudent" disabled={busy} onClick={() => void call({ action: "asGrader" })}>✍️ شوف كمساعد مصحح</button>}
        {data && !data.closed && <button type="button" className="exbtn adstudent" disabled={busy} onClick={() => void asStudent()}>👁 شوف البوت كطالب</button>}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
