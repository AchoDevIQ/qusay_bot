"use client";
// مراحل الفصول: تاريخ بداية كل فصل، وبعد كم يوم يصير اللي يشتري تعويضي، وبعد كم يوم يصير إلكتروني فقط.
// والمفتاح اليدوي «إلكتروني فقط» يبقى مثل قبل
import { useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { DateInput } from "../shared";

type Stage = { start: string; makeup: number | null; online: number | null };
type Ch = { label: string; on: boolean; stage: Stage | null; now: "normal" | "makeup" | "online" | "" };
type Data = { chapters: Ch[]; notice?: string };
const NOW: Record<string, string> = { normal: "🟢 هسه: عادي، اللي يشتري يمشي ويا جماعته", makeup: "🟡 هسه: تعويضي، اللي يشتري ياخذ جدول مكثف إلكتروني وبعدين يرجع لمركزه", online: "🔴 هسه: إلكتروني فقط، المتجر يطلع أسعار الإلكتروني بس" };

export default function OnlineClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/online", "💻 فصول إلكترونية فقط");
  return (
    <>
      <AdminHeader title="💻 مراحل الفصول: التعويض والإلكتروني فقط" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <div className="card">
            <h2>شلون تشتغل</h2>
            <div className="expad exhint">لكل فصل اكتب يوم بدايته ومدتين بالأيام من البداية:<br />• <b>ورا أيام التعويض</b>: اللي يشتري يصير تعويضي. نسويله جدول مكثف إلكتروني للي فاته، وبعدين يرجع يمتحن ويا جماعته (الحضوري بمركزه).<br />• <b>ورا أيام الإلكتروني فقط</b>: اللي يشتري ما يلحق حضوري. المتجر يطلع لطالب الحضوري أسعار الإلكتروني بس، ويا تنبيه.<br />الفصل يتعرف من اسم المنتج، مثل «الفصل الأول».</div>
          </div>
        )}
        {data && !data.chapters.length && <div className="empty">ماكو منتجات باسمها فصل، مثل «الفصل الأول».</div>}
        {data?.chapters.map((c) => <Chapter key={c.label + JSON.stringify(c.stage)} c={c} busy={busy} call={call} />)}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Chapter({ c, busy, call }: { c: Ch; busy: boolean; call: (b: Record<string, unknown>) => Promise<Data | null> }) {
  const [start, setStart] = useState(c.stage?.start ?? "");
  const [makeup, setMakeup] = useState(c.stage?.makeup == null ? "" : String(c.stage.makeup));
  const [online, setOnline] = useState(c.stage?.online == null ? "" : String(c.stage.online));
  return (
    <div className="card">
      <h2>{c.label}</h2>
      <div className="form">
        {c.now && <div className="exhint">{NOW[c.now]}</div>}
        <label>يوم بداية الفصل</label>
        <DateInput value={start} onChange={setStart} />
        <div className="adtwo">
          <div><label>تعويضي ورا (يوم)</label><input inputMode="numeric" value={makeup} placeholder="مثلاً 5" onChange={(e) => setMakeup(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label>إلكتروني فقط ورا (يوم)</label><input inputMode="numeric" value={online} placeholder="مثلاً 10" onChange={(e) => setOnline(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <button type="button" className="btn" disabled={busy || !start} onClick={() => void call({ action: "stage", label: c.label, start, makeup, online })}>💾 احفظ مواعيد {c.label}</button>
        {c.stage && <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "stage", label: c.label, clear: true })}>🗑 شيل المواعيد</button>}
        <label className="adcheck adtop">
          <input type="checkbox" checked={c.on} disabled={busy} onChange={() => void call({ action: "toggle", label: c.label })} />
          <span>💻 إلكتروني فقط هسه، بيدي (بدون ما أنتظر الأيام)</span>
        </label>
      </div>
    </div>
  );
}
