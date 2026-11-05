"use client";
// الصفحة الرئيسية للوحة التحكم: تطلع الأقسام اللي عند الشخص صلاحيتها
import Link from "next/link";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";

type Tile = { page: string; icon: string; title: string; note?: string; hot?: boolean };
type Data = { groups: { title: string; tiles: Tile[] }[]; closed?: boolean };

export default function AdminHomeClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/admin", "⚙️ لوحة التحكم");
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
        {data?.groups.map((g) => (
          <section key={g.title}>
            <div className="adgroup">{g.title}</div>
            <div className="adtiles">
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
        {data && !data.closed && <button type="button" className="exbtn adstudent" disabled={busy} onClick={() => void asStudent()}>👁 شوف البوت كطالب</button>}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
