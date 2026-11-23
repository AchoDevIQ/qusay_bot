"use client";
// «🔎 حلول الذكاء» (طلب الأستاذ 2026-11-23): يشوف كل سؤال علمي حله الذكاء، ويأشر ✅ صح لو يصلّحه بالفويس.
// الحل المصلّح يوصل للطالب، ويصير ببلاش لكل طالب يسأل نفس السؤال، وسبب التصليح يصير قاعدة بموضوعه
import { useEffect, useState } from "react";
import { AdminHeader, StatusBar, useAdminApi } from "../adminPage";
import { Inline } from "../myexams/AiCompare";
import VoiceText from "../qusay/VoiceText";

type Row = { id: string; at: string; uid: number; tid: number; source: string; q: string; state?: "ok" | "fixed"; name: string; topic: string };
type Open = { id: string; question: string; asked: string; photo: string; where: string; source: string; solution: string; fixed: boolean; at: string; lang: string };
type Data = { rows: Row[]; counts: { wait: number; ok: number; fixed: number }; fileToken: string; open?: Open; draft?: string; notice?: string };
const SRC: Record<string, string> = { ai: "🤖 حله الذكاء", lecture: "📘 لگاه بالمحاضرة وكتبه الذكاء", topic: "📘 لگاه بالموضوع وكتبه الذكاء" };

/** الحل سطر سطر، والرياضيات مثل الكتاب */
const Sol = ({ text }: { text: string }) => <div className="anssol">{text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, i) => <div key={i} className="tidyline"><Inline text={l} /></div>)}</div>;

export default function QaReviewClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/qareview", "🔎 حلول الذكاء");
  const [show, setShow] = useState<"wait" | "done" | "all">("wait");
  const [note, setNote] = useState("");
  const [why, setWhy] = useState("");
  const [edit, setEdit] = useState("");
  const [mode, setMode] = useState<"voice" | "hand" | null>(null);
  const o = data?.open;
  // حل جديد من «✍️ صلّحه على كلامي»: ينكتب بالمربع حتى يقراه ويعدله قبل الحفظ
  useEffect(() => { if (data?.draft) { setEdit(data.draft); setMode("hand"); } }, [data?.draft]);
  useEffect(() => { setNote(""); setWhy(""); setEdit(""); setMode(null); }, [o?.id]);
  const back = () => void call({ action: "list", show });
  const photo = (ref: string) => `/api/exams/file?ref=${encodeURIComponent(`tg:${ref}`)}&t=${encodeURIComponent(data?.fileToken ?? "")}`;
  return (
    <>
      <AdminHeader title="🔎 حلول الذكاء" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && !o && (
          <>
            <div className="exhint tmhint">
              كل سؤال علمي حله الذكاء (مو من ملزمتك ولا الراصد) يطلع هنا. افتحه وشوف الحل: إذا صح دوس ✅، وإذا بيه غلط احچي شنو الغلط بالفويس والذكاء يعيد كتابته على كلامك، لو اكتبه بإيدك.
              الحل المصلّح يوصل للطالب، وأي طالب يسأل نفس السؤال ياخذ حلك ببلاش، وسبب التصليح يمشي عليه الذكاء بحلول هذا الموضوع.
            </div>
            <div className="seg">
              <button type="button" className={show === "wait" ? "on" : ""} onClick={() => { setShow("wait"); void call({ action: "list", show: "wait" }); }}>⏳ ما شفتها ({data.counts.wait})</button>
              <button type="button" className={show === "done" ? "on" : ""} onClick={() => { setShow("done"); void call({ action: "list", show: "done" }); }}>✅ شفتها ({data.counts.ok + data.counts.fixed})</button>
              <button type="button" className={show === "all" ? "on" : ""} onClick={() => { setShow("all"); void call({ action: "list", show: "all" }); }}>الكل</button>
            </div>
            <div className="card expad">
              {!data.rows.length && <div className="empty">ماكو حلول هنا.</div>}
              {data.rows.map((r) => (
                <div key={r.id} className="aig-logrow">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b>{r.name}</b> · {r.topic} {r.state === "ok" ? "✅" : r.state === "fixed" ? "✏️ صلّحته" : ""}
                    <br /><small dir="ltr">{r.at}</small> · <small>{SRC[r.source] ?? r.source}</small>
                    <div className="exhint" style={{ margin: 0 }}><Inline text={r.q || "📷 سؤال بالصورة"} /></div>
                  </div>
                  <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "view", id: r.id, show })}>👁 افتح</button>
                </div>
              ))}
            </div>
          </>
        )}
        {data && o && (
          <>
            <button type="button" className="exbtn" onClick={back}>↩️ رجوع</button>
            <div className="card expad">
              <div className="exlabel">❓ السؤال · {o.where}</div>
              {o.photo && <img src={photo(o.photo)} alt="سؤال الطالب" style={{ width: "100%", borderRadius: 8 }} />}
              {(o.asked || o.question) && <div className="ansq"><Sol text={o.asked || o.question} /></div>}
            </div>
            <div className="card expad">
              <div className="exlabel">{o.fixed ? "✏️ حلك المصلّح (هذا اللي يشوفه الطالب)" : SRC[o.source] ?? "الحل"}</div>
              <Sol text={o.solution} />
            </div>
            <div className="card expad">
              {!mode && (
                <>
                  <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "ok", id: o.id, show }).then(back)}>✅ الحل صح</button>
                  <button type="button" className="exbtn" onClick={() => setMode("voice")}>🎤 بيه غلط: احچي شنو الغلط</button>
                  <button type="button" className="exbtn" onClick={() => { setEdit(o.solution); setMode("hand"); }}>✍️ أكتب الحل بإيدي</button>
                </>
              )}
              {mode === "voice" && (
                <div className="form">
                  <label>شنو الغلط بالحل؟ احچيه 🎤 لو اكتبه، والذكاء يعيد كتابة الحل على كلامك</label>
                  <VoiceText value={note} onChange={setNote} rows={4} maxLength={3000} />
                  <button type="button" className="btn" disabled={busy || note.trim().length < 4} onClick={() => { setWhy(note); void call({ action: "rewrite", id: o.id, note, show }); }}>✍️ صلّحه على كلامي</button>
                  <button type="button" className="exbtn" onClick={() => setMode(null)}>✖ إلغاء</button>
                </div>
              )}
              {mode === "hand" && (
                <div className="form">
                  <label>الحل اللي يوصل للطالب (المعادلات مثل الموبايل: x² ، 3/x²)</label>
                  <textarea rows={12} value={edit} onChange={(e) => setEdit(e.target.value)} dir="auto" />
                  <div className="tidyview"><div className="exhint">👁 هيچ يشوفه الطالب:</div><Sol text={edit} /></div>
                  <label>ليش؟ (اختياري: يصير قاعدة يمشي عليها الذكاء بهذا الموضوع)</label>
                  <VoiceText value={why} onChange={setWhy} rows={2} maxLength={1500} />
                  <button type="button" className="btn" disabled={busy || edit.trim().length < 10} onClick={() => void call({ action: "save", id: o.id, solution: edit, why, show }).then(back)}>💾 احفظ وابعثه للطالب</button>
                  <button type="button" className="exbtn" onClick={() => setMode(null)}>✖ إلغاء</button>
                </div>
              )}
            </div>
            <button type="button" className="exbtn" onClick={back}>↩️ رجوع</button>
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}
