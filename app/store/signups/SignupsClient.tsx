"use client";
// تسجيلات الفصول: كم طالب سجل بكل فصل بكل يوم، ومنو هم، ورسالة جماعية أو لأفراد بالكتابة أو بالصوت
import { useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import VoiceRec from "../VoiceRec";

type Student = { id: number; name: string; at: string; source: string };
type Chapter = { chapter: string; total: number; students: Student[] };
type Data = { date: string; days: string[]; chapters: Chapter[]; notice: string };
type Call = (b: Record<string, unknown> | FormData) => Promise<Data | null>;

export default function SignupsClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/signups", "📊 تسجيلات الفصول");
  const n = data?.chapters.reduce((s, c) => s + c.students.length, 0) ?? 0;
  return (
    <>
      <AdminHeader title="📊 تسجيلات الفصول" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <div className="exhint tmhint">كل طالب ينفتحله فصل من المكتب أو بكود التوصيل ينحسب بيومه. آخر كل يوم يوصلك تقرير بالبوت.</div>
            <div className="seg wrap2">
              {data.days.map((d, i) => <button type="button" key={d} className={d === data.date ? "on" : ""} disabled={busy} onClick={() => void call({ action: "list", date: d })}>{i === 0 ? "اليوم" : i === 1 ? "البارحة" : d.slice(5)}</button>)}
            </div>
            <div className="card expad"><div className="adstats adstats2">
              <div><b>{n}</b>سجلوا بهذا اليوم</div>
              <div><b>{data.chapters.filter((c) => c.students.length).length}</b>فصل</div>
            </div></div>
            {!data.chapters.length && <div className="empty">بعد ماكو تسجيلات.</div>}
            {data.chapters.map((c) => <ChapterCard key={`${c.chapter}|${data.date}`} c={c} date={data.date} busy={busy} call={call} />)}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function ChapterCard({ c, date, busy, call }: { c: Chapter; date: string; busy: boolean; call: Call }) {
  const [scope, setScope] = useState<"day" | "all" | "picked">(c.students.length ? "day" : "all");
  const [picked, setPicked] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const count = scope === "day" ? c.students.length : scope === "all" ? c.total : picked.length;
  async function send() {
    const f = new FormData();
    f.set("action", "send"); f.set("chapter", c.chapter); f.set("scope", scope); f.set("date", date); f.set("ids", picked.join(",")); f.set("text", text);
    if (voice) f.set("voice", voice, "voice");
    const r = await call(f);
    if (r) { setText(""); setVoice(null); setPicked([]); }
  }
  return (
    <div className="card">
      <h2>📘 {c.chapter}</h2>
      <div className="expad">
        <div className="adstats adstats2">
          <div><b>{c.students.length}</b>سجلوا بهذا اليوم</div>
          <div><b>{c.total}</b>كل طلاب الفصل</div>
        </div>
        {!!c.students.length && (
          <table className="extable adtop"><tbody>
            {c.students.map((s) => (
              <tr key={s.id}>
                <td>
                  {scope === "picked" && <input type="checkbox" aria-label={`حدد ${s.name}`} checked={picked.includes(s.id)} onChange={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])} />}
                  <b> {s.name}</b><small className="pdmode">#{s.id} · {s.source}</small>
                </td>
                <td className="adphone">{s.at}</td>
              </tr>
            ))}
          </tbody></table>
        )}
        <div className="exlabel adtop">📢 رسالة</div>
        <div className="seg wrap2">
          {c.students.length > 0 && <button type="button" className={scope === "day" ? "on" : ""} onClick={() => setScope("day")}>اللي سجلوا هذا اليوم ({c.students.length})</button>}
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>كل طلاب الفصل ({c.total})</button>
          {c.students.length > 0 && <button type="button" className={scope === "picked" ? "on" : ""} onClick={() => setScope("picked")}>أحددهم بنفسي</button>}
        </div>
        <textarea className="stfield adtop" rows={3} maxLength={1000} placeholder="اكتب الرسالة (أو سجل صوت، أو الاثنين)" value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
        <VoiceRec value={voice} onChange={setVoice} onRecording={setRecording} btn="exbtn" label="🎙 رسالة صوتية (اختياري)" />
        <Confirm label={`📨 دز لـ ${count} طالب`} disabled={busy || recording || !count || (!text.trim() && !voice)} onYes={() => void send()} />
      </div>
    </div>
  );
}
