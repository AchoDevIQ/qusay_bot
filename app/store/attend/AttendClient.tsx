"use client";
// الحضوري: المساعد يقرا كود الطالب فينسجل حضوره وتنفتح طباعة ليبله أو ورقته. وأوراق الاستنساخ، وإعدادات كل مركز
import { useState } from "react";
import { AdminHeader, StatusBar, pageAuth, useAdminApi } from "../adminPage";
import { prepare, previewUrl, rememberScan, scanDefault } from "../photoPrep";
import { openOutside, scanQr } from "../shared";
import RescanList, { type Rescan } from "./RescanList";

type Card = { item: number; uid: number; name: string; exam: string; at: string; center: string; print: "label" | "paper"; attendedAt: string; label: string; paper: string; already: boolean; queued?: boolean; late?: boolean };
type Center = { id: number; name: string; print: "label" | "paper"; photos: boolean };
type Exam = { id: number; title: string; chapter: string; versions: { model: string; token: string }[] };
type Cam = { item: number; name: string; uid: number; exam: string; qs: number[]; have: number[]; sent: boolean };
type Data = { owner: boolean; full: boolean; cam?: Cam; centers: Center[]; exams: Exam[]; today: number; card?: Card; rescan?: Rescan[]; station?: { active: boolean; token: string } | null; early: number; notice: string };
type Call = (b: Record<string, unknown>) => Promise<Data | null>;

const printUrl = (kind: "label" | "paper", k: string) => `${location.origin}/print/${kind}?k=${encodeURIComponent(k)}`;

export default function AttendClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/attend", "🎫 الحضوري");
  return (
    <>
      <AdminHeader title="🎫 الحضوري" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <>
            <RescanList list={data.rescan} />
            {data.full && <Attend data={data} busy={busy} call={call} />}
            {data.station && <Station station={data.station} />}
            <CamUp data={data} busy={busy} call={call} />
            {data.full && <div className="card expad">
              <div className="exlabel">📤 أوراق السكانر</div>
              <div className="exhint">بعد الامتحان حط كل الأوراق بالسكانر، وارفع الصور كلها مرة وحدة. البوت يقرا الأكواد ويوزعها على الطلاب، وتروح للمصححين.</div>
              <a className="btn agbtn adtop" style={{ textDecoration: "none", display: "block", textAlign: "center" }} href={`/store/scanup${location.search}`}>📤 رفع أوراق السكانر</a>
            </div>}
            {data.full && <Copies exams={data.exams} />}
            {data.owner && <Early key={data.early} early={data.early} busy={busy} call={call} />}
            {data.owner && <Centers centers={data.centers} busy={busy} call={call} />}
          </>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Attend({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [num, setNum] = useState("");
  const c = data.card;
  async function go(code: string) {
    const r = await call({ action: "scan", code });
    afterAttend(r);
    if (r) setNum("");
  }
  // الطباعة تنفتح وحدها حسب المركز، حتى المساعد ما يدوس شي
  function afterAttend(r: Data | null) {
    if (r?.card && !r.card.already && !r.card.queued && !r.card.late) openOutside(printUrl(r.card.print, r.card.print === "label" ? r.card.label : r.card.paper));
  }
  function camera() {
    const ok = scanQr("وجه الكاميرا على كود الطالب", (t) => { void go(t); return true; });
    if (!ok) alert("الكاميرا تشتغل بس من داخل تليجرام بالتلفون. اكتب رقم الطالب بدالها.");
  }
  return (
    <div className="card expad">
      <div className="exlabel">📷 تسجيل حضور</div>
      <div className="exhint">اليوم انسجل {data.today} حضور. اقرا كود الطالب من تلفونه، أو اكتب رقمه.</div>
      <button type="button" className="btn agbtn adtop" disabled={busy} onClick={camera}>📷 اقرا كود الطالب</button>
      <div className="atrow">
        <input className="exinput" inputMode="numeric" dir="ltr" aria-label="رقم الطالب" placeholder="رقم الطالب" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className="exbtn" disabled={busy || !num} onClick={() => void go(num)}>سجل</button>
      </div>
      {c?.late && (
        <div className="atcard">
          <b>{c.name}</b> <span dir="ltr">#{c.uid}</span>
          <div className="exhint exbad">⏰ جاي بغير وقته. موعده: <span dir="ltr">{c.at}</span></div>
          <div className="exhint">{c.exam} · {c.center}</div>
          <div className="atrow">
            <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "except", item: c.item }).then(afterAttend)}>🔓 استثناء</button>
            <button type="button" className="exbtn" disabled={busy} onClick={() => void call({ action: "rejectLate", item: c.item })}>❌ رفض</button>
          </div>
        </div>
      )}
      {c && !c.late && (
        <div className="atcard">
          <b>{c.name}</b> <span dir="ltr">#{c.uid}</span>
          <div className={c.already ? "exhint" : "exhint atok"}>{c.already ? `⚠️ كان مسجل حضوره من ${c.attendedAt.slice(11, 16)}` : "✅ انسجل حضوره"}</div>
          <div className="exhint">{c.exam} · {c.center} · {c.at.slice(11, 16)}</div>
          {c.queued && <div className="exhint atok">🖨 الليبل انرسل لمحطة الطباعة</div>}
          <div className="atrow">
            <button type="button" className={c.print === "label" ? "btn" : "exbtn"} disabled={busy} onClick={() => { if (data.station?.active) void call({ action: "queue", item: c.item }); else openOutside(printUrl("label", c.label)); }}>🏷 اطبع الليبل</button>
            <button type="button" className={c.print === "paper" ? "btn" : "exbtn"} onClick={() => openOutside(printUrl("paper", c.paper))}>📄 اطبع ورقته كاملة</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** طابعة الليبل بالبلوتوث: رابط المحطة ينفتح بمتصفح Bluefy ويبقى مفتوح */
function Station({ station }: { station: { active: boolean; token: string } }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/store/station?k=${encodeURIComponent(station.token)}`;
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); alert(link); } }
  return (
    <div className="card expad">
      <div className="exlabel">🖨 طابعة الليبل بالبلوتوث</div>
      <div className="exhint">{station.active ? "✅ المحطة شغالة: الليبلات تروح للطابعة وحدها." : "انسخ الرابط، وافتحه بمتصفح Bluefy، ودوس «اتصل بالطابعة». بعدها الكاميرا تنفتح، وكل كود طالب تشوفه ينسجل حضوره وينطبع ليبله. الرابط يشتغل أسبوع."}</div>
      <button type="button" className="btn agbtn adtop" onClick={() => void copy()}>{copied ? "✅ انتسخ الرابط" : "📋 انسخ رابط المحطة"}</button>
    </div>
  );
}

/** ماكو سكانر: المساعد يصور ورقة الطالب بكاميرته سؤال سؤال، وتروح للتصحيح */
function CamUp({ data, busy, call }: { data: Data; busy: boolean; call: Call }) {
  const [num, setNum] = useState("");
  const [q, setQ] = useState(0);
  const [draft, setDraft] = useState<{ file: File; url: string; turns: number } | null>(null);
  const [scan, setScan] = useState(scanDefault);
  const [up, setUp] = useState(false);
  const [err, setErr] = useState("");
  const [have, setHave] = useState<number[]>([]);
  const c = data.cam;
  async function find(code: string) {
    const r = await call({ action: "cam", code });
    if (r?.cam) { setHave(r.cam.have); setQ(r.cam.qs[0] ?? 0); setDraft(null); setNum(""); }
  }
  function camera() {
    const ok = scanQr("وجه الكاميرا على كود الطالب", (t) => { void find(t); return true; });
    if (!ok) alert("الكاميرا تشتغل بس من داخل تليجرام بالتلفون. اكتب رقم الطالب بدالها.");
  }
  async function pick(f: File | undefined) { if (f) setDraft({ file: f, url: await previewUrl(f, scan), turns: 0 }); }
  async function toggleScan() { const on = !scan; setScan(on); rememberScan(on); if (draft) setDraft({ ...draft, url: await previewUrl(draft.file, on) }); }
  async function send() {
    if (!draft || !c) return;
    setUp(true); setErr("");
    try {
      const fd = new FormData();
      fd.set("initData", pageAuth()); fd.set("item", String(c.item)); fd.set("q", String(q));
      fd.set("file", await prepare(draft.file, draft.turns, scan), "page.jpg");
      const res = await fetch("/api/attend/scan", { method: "POST", body: fd });
      if (!res.ok) { setErr((await res.json()).error ?? "ما انرفعت، حاول مرة ثانية"); return; }
      setHave([...have, q]); setDraft(null);
      const next = c.qs.find((n) => n > q && !have.includes(n));
      if (next) setQ(next);
    } catch { setErr("ماكو اتصال، حاول مرة ثانية"); } finally { setUp(false); }
  }
  const count = (n: number) => have.filter((x) => x === n).length;
  return (
    <div className="card expad">
      <div className="exlabel">📷 تصوير ورقة طالب</div>
      <div className="exhint">إذا ماكو سكانر: اقرا كود الطالب أو اكتب رقمه، وصور جواب كل سؤال. من تخلص دوس «دز للتصحيح».</div>
      <button type="button" className="btn agbtn adtop" disabled={busy || up} onClick={camera}>📷 اقرا كود الطالب</button>
      <div className="atrow">
        <input className="exinput" inputMode="numeric" dir="ltr" aria-label="رقم الطالب للتصوير" placeholder="رقم الطالب" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className="exbtn" disabled={busy || up || !num} onClick={() => void find(num)}>افتح ورقته</button>
      </div>
      {c && (
        <div className="atcard">
          <b>{c.name}</b> <span dir="ltr">#{c.uid}</span>
          <div className="exhint">{c.exam}{c.sent ? " · ✅ ورقته راحت للتصحيح" : ""}</div>
          <div className="seg wrap2 adtop">
            {c.qs.map((n) => <button type="button" key={n} className={n === q ? "on" : ""} disabled={up} onClick={() => { setQ(n); setDraft(null); }}>س{n}{count(n) ? ` ✅${count(n) > 1 ? count(n) : ""}` : ""}</button>)}
          </div>
          {draft ? (
            <div className="adtop">
              <img className="eximg" src={draft.url} alt={`جواب السؤال ${q}`} style={{ transform: `rotate(${draft.turns * 90}deg)` }} />
              <div className="atrow">
                <button type="button" className="exbtn" disabled={up} onClick={() => setDraft({ ...draft, turns: (draft.turns + 1) % 4 })}>🔄 دور</button>
                <button type="button" className={scan ? "btn" : "exbtn"} disabled={up} onClick={() => void toggleScan()}>📄 سكانر {scan ? "✓" : ""}</button>
                <button type="button" className="exbtn" disabled={up} onClick={() => setDraft(null)}>إلغاء</button>
                <button type="button" className="btn" disabled={up} onClick={() => void send()}>{up ? "جاري الرفع..." : `✅ ارفع للسؤال ${q}`}</button>
              </div>
            </div>
          ) : (
            <div className="atrow">
              <label className="btn">📷 صور السؤال {q}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} /></label>
              <label className="exbtn">🖼 من الجهاز<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} /></label>
            </div>
          )}
          {err && <div className="err">⚠️ {err}</div>}
          <button type="button" className="btn agbtn adtop" disabled={busy || up || !have.length || !!draft} onClick={() => void call({ action: "finish", items: [c.item] })}>📨 دز للتصحيح ({have.length} صورة)</button>
        </div>
      )}
    </div>
  );
}

/** أوراق للاستنساخ: نسخة الامتحان بدون اسم، وعلى أول صفحة مكان الليبل */
function Copies({ exams }: { exams: Exam[] }) {
  const [id, setId] = useState(0);
  const e = exams.find((x) => x.id === id);
  return (
    <div className="card expad">
      <div className="exlabel">🖨 أوراق امتحان للاستنساخ</div>
      <div className="exhint">للمراكز اللي تشتغل بالليبل: اطبع النسخة واستنسخها. كل سؤال بصفحة، وعلى كل صفحة كود، والليبل ينلزگ على أول صفحة.</div>
      <select className="exinput adtop" aria-label="الامتحان" value={id} onChange={(x) => setId(Number(x.target.value))}>
        <option value={0}>اختار الامتحان</option>
        {exams.map((x) => <option key={x.id} value={x.id}>{x.chapter} · {x.title}</option>)}
      </select>
      {e && <div className="atrow">{e.versions.map((v) => <button type="button" key={v.model} className="exbtn" onClick={() => openOutside(printUrl("paper", v.token))}>📄 نسخة {v.model}</button>)}</div>}
    </div>
  );
}

/** الطالب يعتبر جاي بوقته من كم دقيقة قبل موعده */
function Early({ early, busy, call }: { early: number; busy: boolean; call: Call }) {
  const [n, setN] = useState(String(early));
  return (
    <div className="card expad">
      <div className="exlabel">⏰ وقت حضور الطالب</div>
      <div className="exhint">الطالب يعتبر جاي بوقته من هذا العدد من الدقايق قبل موعده، لحد انتهاء وقت الدخول بإعدادات الجدول. غير هذا يطلع زر استثناء أو رفض.</div>
      <div className="atrow adtop">
        <input className="exinput" type="number" min={0} max={600} aria-label="الدقايق قبل الموعد" value={n} onChange={(e) => setN(e.target.value)} />
        <button type="button" className="exbtn" disabled={busy || n === String(early)} onClick={() => void call({ action: "saveEarly", minutes: Number(n) })}>💾 حفظ</button>
      </div>
    </div>
  );
}

function Centers({ centers, busy, call }: { centers: Center[]; busy: boolean; call: Call }) {
  return (
    <div className="card expad">
      <div className="exlabel">⚙️ المراكز</div>
      <div className="exhint">لكل مركز: بعد الحضور ينطبع ليبل تلزقه على الورقة المستنسخة، لو تنطبع ورقة الامتحان كاملة باسم الطالب. وتگدر تخلي طلابه يصورون أجوبتهم من تلفوناتهم.</div>
      {centers.map((c) => (
        <div key={c.id} className="cpexam">
          <b>{c.name}</b>
          <div className="seg wrap2 adtop">
            <button type="button" className={c.print === "label" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveCenter", center: c.id, print: "label", photos: c.photos })}>🏷 ليبل</button>
            <button type="button" className={c.print === "paper" ? "on" : ""} disabled={busy} onClick={() => void call({ action: "saveCenter", center: c.id, print: "paper", photos: c.photos })}>📄 ورقة كاملة باسمه</button>
          </div>
          <label className="exhint adtop"><input type="checkbox" checked={c.photos} disabled={busy} onChange={(x) => void call({ action: "saveCenter", center: c.id, print: c.print, photos: x.target.checked })} /> الطلاب يگدرون يصورون أجوبتهم من التلفون</label>
        </div>
      ))}
    </div>
  );
}
