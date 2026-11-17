"use client";
// 🔔 إشعارات الطلاب: إشعار مؤقت (يختفي بعد ما يقراه الطالب) أو دائمي (يبقى لحد ما تمسحه)، لكل الطلاب أو التجربة أو فئة
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import { Students } from "../visibility/VisibilityClient";

type Item = { id: number; kind: string; text: string; img: boolean; aud: string; at: string; reads: number };
type Data = { list: Item[]; notice: string; centers: { id: number; name: string }[]; genders: string[]; currs: string[]; chapters: string[] };
type Rule = { centers: number[]; gender: string; curr: string; chapters: string[]; students: number[] };
const AUD: Record<string, string> = { all: "كل الطلاب", pilot: "طلاب التجربة", some: "فئة" };

/** الصورة تصير JPG وأصغر قبل ما ترتفع */
async function toJpg(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("jpg"))), "image/jpeg", 0.85));
}

export default function AnnounceClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/announce", "🔔 إشعارات الطلاب");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"temp" | "keep">("temp");
  const [aud, setAud] = useState<"all" | "pilot" | "some">("pilot");
  const [rule, setRule] = useState<Rule>({ centers: [], gender: "", curr: "", chapters: [], students: [] });
  const [names, setNames] = useState(new Map<number, string>());
  const [photo, setPhoto] = useState<File | null>(null);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function send() {
    const fd = new FormData();
    fd.set("action", "send"); fd.set("text", text); fd.set("kind", kind); fd.set("aud", aud); fd.set("rule", JSON.stringify(rule));
    if (photo) fd.set("image", await toJpg(photo), "notice.jpg");
    if (await call(fd)) { setText(""); setPhoto(null); }
  }
  return (
    <>
      <AdminHeader title="🔔 إشعارات الطلاب" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="card">
              <h2>✍️ إشعار جديد</h2>
              <div className="form">
                <textarea rows={4} value={text} placeholder="اكتب الإشعار" onChange={(e) => setText(e.target.value)} />
                <label className="exbtn">🖼 {photo ? photo.name : "صورة (اختياري)"}
                  <input type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                </label>
                {photo && <button type="button" className="exbtn" onClick={() => setPhoto(null)}>✖ شيل الصورة</button>}
                <label>نوعه</label>
                <div className="seg">
                  <button type="button" className={kind === "temp" ? "on" : ""} onClick={() => setKind("temp")}>⏳ مؤقت</button>
                  <button type="button" className={kind === "keep" ? "on" : ""} onClick={() => setKind("keep")}>📌 دائمي</button>
                </div>
                <div className="exhint">{kind === "temp" ? "المؤقت: الطالب يفتحه ويقراه، وبعدها يختفي من عنده." : "الدائمي: يبقى عند الطالب لحد ما تمسحه من هنا."}</div>
                <label>لمن</label>
                <div className="seg">
                  {(["pilot", "all", "some"] as const).map((k) => <button type="button" key={k} className={aud === k ? "on" : ""} onClick={() => setAud(k)}>{AUD[k]}</button>)}
                </div>
                {aud === "some" && (
                  <>
                    <div className="exhint">يوصل للطالب اللي ينطبق عليه كل شي تختاره، وللطلاب اللي تضيفهم بأسمائهم.</div>
                    <label>المراكز (ما تختار شي = كل المراكز)</label>
                    <div className="chips adtabs">{data.centers.map((c) => <button type="button" key={c.id} className={rule.centers.includes(c.id) ? "on" : ""} onClick={() => setRule({ ...rule, centers: toggle(rule.centers, c.id) })}>{c.name}</button>)}</div>
                    <label>بنين أو بنات</label>
                    <div className="chips adtabs">{["", ...data.genders].map((g) => <button type="button" key={g || "all"} className={rule.gender === g ? "on" : ""} onClick={() => setRule({ ...rule, gender: g })}>{g || "الكل"}</button>)}</div>
                    <label>المنهج</label>
                    <div className="chips adtabs">{["", ...data.currs].map((c) => <button type="button" key={c || "all"} className={rule.curr === c ? "on" : ""} onClick={() => setRule({ ...rule, curr: c })}>{c || "الكل"}</button>)}</div>
                    <label>اللي شاري (ما تختار شي = الكل)</label>
                    <div className="chips adtabs">{data.chapters.map((c) => <button type="button" key={c} className={rule.chapters.includes(c) ? "on" : ""} onClick={() => setRule({ ...rule, chapters: toggle(rule.chapters, c) })}>{c}</button>)}</div>
                    <Students api="/api/announce" ids={rule.students} names={names} onChange={(students, more) => { if (more) setNames(new Map([...names, ...more])); setRule({ ...rule, students }); }} />
                  </>
                )}
                <button type="button" className="btn" disabled={busy || text.trim().length < 2} onClick={() => void send()}>{busy ? "جاري الإرسال..." : "📤 دز الإشعار"}</button>
              </div>
            </div>
            <div className="card">
              <h2>📋 الإشعارات المرسلة</h2>
              <div className="form">
                {!data.list.length && <div className="exhint">ماكو إشعارات بعد.</div>}
                {data.list.map((n) => (
                  <div key={n.id} className="card" style={{ margin: 0 }}>
                    <div className="form">
                      <div className="exhint">{n.kind === "temp" ? "⏳ مؤقت" : "📌 دائمي"} · {AUD[n.aud] ?? n.aud} · {n.at} · 👁 قراه {n.reads}</div>
                      {n.img && <img src={`/api/announce?a=1&id=${n.id}&t=${encodeURIComponent(pageAuth())}`} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />}
                      <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                      <Confirm label="🗑 امسحه من عند كل الطلاب" disabled={busy} onYes={() => void call({ action: "del", id: n.id })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}
