"use client";
// امتحاناتي: الطالب يرتب جدوله مرة وحدة، وبعدها يشوف مواعيده
import { Fragment, useEffect, useState } from "react";
import { prettyAt } from "../../../lib/scheduleRules.ts";
import { deviceId, haptic, openOutside } from "../shared";
import QRCode from "qrcode";
import VoiceRec from "../VoiceRec";
import { prepare, previewUrl, rememberScan, scanDefault } from "../photoPrep";

type Item = { id: number; optional?: boolean; total?: number | null; title: string; chapter: string; minutes: number; lectures?: string[]; at: string; exc?: string | null; retake?: boolean; state: "locked" | "open" | "missed" | "done" | "center" | "past" | "notbought" };
type PlacePreview = { items: { title: string; at: string; locked: boolean }[]; waiting: number };
type Preview = { items: { title: string; at: string }[]; days: number; maxPerDay: number; perWeek: number };
type Info = {
  appLink: string; attendCode: string; inPerson: boolean; place: string; mode: string | null; needsChoice: boolean; repick: boolean; optional: { exam: number; title: string; chapter: string; minutes: number }[]; picks: Record<string, string> | null; late: { title: string; at: string }[]; days: { d: number; name: string; times: { t: string; label: string }[] }[]; placePreview?: PlacePreview;
  name: string; remaining: number; needsBuild: boolean; schedule: { start: string; end: string; weekdays: number[]; hour: number } | null; items: Item[];
  today: string; minStart: string; window: number; perDay: number; week: { i: number; name: string }[]; hours: number[]; holiday: { start: string; days: number } | null;
  preview?: Preview; notice?: string; error?: string; lateText: string; closedText: string; room?: Room; obj?: Obj;
};
type ObjState = { status: "open" | "accepted" | "rejected"; text: string; voice: boolean; old: number; mark: number | null; reason: string };
type Obj = { id: number; title: string; total: number; questions: { n: number; max: number; mark: number; obj: ObjState | null }[] };
type Room = { id: number; sid: number; title: string; model: string; closeAt: string; now: string; minutes: number; extra: number; pages: string[]; questions: { n: number; answers: { id: number; file: string }[] }[] };
const STATE: Record<Item["state"], string> = { locked: "🔒 مقفول لحد وقته", open: "🟢 بدا هسه", missed: "⛔ فات وقته", done: "✅ مخلص", center: "🏫 بالمركز", past: "انتهى موعده", notbought: "🔒 ما مشتري" };
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function MyExamsClient() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(location.search).get("t") ?? "";
      const res = await fetch("/api/myexams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body, device: await deviceId() }) });
      const j: Info = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ، حاول مرة ثانية"); return null; }
      setInfo(j);
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  const [room, setRoom] = useState<Room | null>(null);
  const [obj, setObj] = useState<Obj | null>(null);
  async function openObj(item: number) { const r = await call({ action: "objInfo", item }); if (r?.obj) setObj(r.obj); }
  useEffect(() => {
    // زر «اعتراض على الدرجة» بالبوت يفتح الصفحة على الامتحان مباشرة
    const o = Number(new URLSearchParams(location.search).get("obj"));
    void (o ? openObj(o).then(() => undefined) : call({ action: "info" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function enterOptional(exam: number) { const r = await call({ action: "openOptional", exam }); if (r?.room) setRoom(r.room); }
  async function enter(item: number) { const r = await call({ action: "openExam", item }); if (r?.room) setRoom(r.room); }
  if (obj) return <Objection obj={obj} setObj={setObj} leave={() => { setObj(null); void call({ action: "info" }); }} />;
  if (room) return <ExamRoom room={room} setRoom={setRoom} call={call} leave={() => { setRoom(null); void call({ action: "info" }); }} />;

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>📝 امتحاناتي</p>
      </header>
      <div className="wrap">
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        {!info && !error && <div className="empty">جاري التحميل...</div>}
        {info?.repick && <Picker info={info} busy={busy} call={call} />}
        {info && info.late.length > 0 && <LateAsk info={info} busy={busy} call={call} />}
        {info?.needsChoice && <Choice info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && info.needsBuild && <Build info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && !info.needsBuild && !info.items.length && <div className="empty">{info.mode === "general" ? "مواعيدك لسه ما نزلت." : "ماكو امتحانات بعد لفصولك."}</div>}
        {info?.notice && <div className="card warn exerr">{info.notice}</div>}
        {info?.attendCode && <AttendCode code={info.attendCode} />}
        {info && !!info.items.length && <List info={info} busy={busy} enter={enter} object={(id) => void openObj(id)} ask={(item, reason) => call({ action: "askException", item, reason })} />}
        {info && !!info.optional.length && <Optional info={info} busy={busy} enter={enterOptional} />}
      </div>
    </>
  );
}

/** اشترى متأخر وبعض مواعيد مجموعته فاتت */
function LateAsk({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  return (
    <div className="card">
      <h2>⏰ بعض الامتحانات فات موعدها</h2>
      <div className="hmlink">
        <div>هاي الامتحانات فات موعدها ويا مجموعتك:</div>
        <ul className="hmsteps">{info.late.map((e) => <li key={e.title}>{e.title} <small>{prettyAt(e.at)}</small></li>)}</ul>
        <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "latePrivate" })}>👤 أحولها لجدول خاص بأيامي</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "lateKeep" })}>👥 أبقى ويا الطلاب، وهاي تنحسب فايتة</button>
      </div>
    </div>
  );
}

/** وقت لكل يوم، بكيف الطالب */
function Picker({ info, busy, call, back }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null>; back?: () => void }) {
  const [picks, setPicks] = useState<Record<string, string>>(info.picks ?? {});
  const [seen, setSeen] = useState<PlacePreview | null>(null);
  const ready = info.days.every((d) => d.times.some((x) => x.t === picks[String(d.d)]));
  return (
    <div className="card">
      <h2>👥 أوقات {info.place}</h2>
      <div className="form">
        {back && <button type="button" className="exbtn" onClick={back}>⬅️ رجوع</button>}
        {info.days.map((d) => (
          <div key={d.d}>
            <label>وقتك يوم {d.name}</label>
            <div className="seg wrap2">
              {d.times.map((x) => <button type="button" key={x.t} className={picks[String(d.d)] === x.t ? "on" : ""} onClick={() => { haptic(); setSeen(null); setPicks({ ...picks, [String(d.d)]: x.t }); }}>{x.label}</button>)}
            </div>
          </div>
        ))}
        {!seen && <button type="button" className="btn agbtn adtop" disabled={busy || !ready} onClick={async () => { const r = await call({ action: "placePreview", picks }); if (r?.placePreview) setSeen(r.placePreview); }}>شوف جدولي</button>}
        {seen && (
          <>
            {seen.items.length ? <table className="extable adtop"><tbody>{seen.items.map((i) => <tr key={i.title + i.at} className={i.locked ? "mxlocked" : ""}><td>{i.locked ? "🔒 " : ""}{i.title}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table> : <div className="hint adtop">المواعيد لسه ما نزلت.</div>}
            {seen.waiting > 0 && !!seen.items.length && <div className="hint adtop">و{seen.waiting} امتحان موعده ينزل بعدين.</div>}
            <div className="rgalert adtop">⚠️ بعد التثبيت ما تتغير أوقاتك إلا عن طريق الإدارة.</div>
            <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void call({ action: "joinPlace", picks })}>✅ ثبت أوقاتي</button>
          </>
        )}
      </div>
    </div>
  );
}

/** أول مرة: ويا الطلاب بمواعيد المكان، لو جدول خاص */
function Choice({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const [way, setWay] = useState<"" | "general" | "private">(info.days.length ? "" : "private");
  if (way === "private") {
    return (
      <>
        {!!info.days.length && <button type="button" className="exbtn adtop" onClick={() => setWay("")}>⬅️ رجوع</button>}
        <Build info={info} busy={busy} call={call} />
      </>
    );
  }
  if (way === "general") return <Picker info={info} busy={busy} call={call} back={() => setWay("")} />;
  return (
    <div className="card">
      <h2>🗓 شلون تمتحن؟</h2>
      <div className="hmlink">
        <div>عندك <b>{info.remaining}</b> امتحان · {info.place}</div>
        <button type="button" className="btn" onClick={() => { haptic(); setWay("general"); }}>👥 ويا الطلاب (جدول عام)</button>
        <div className="hint">أيام ثابتة، وتختار الوقت اللي يناسبك بكل يوم.</div>
        <button type="button" className="btn ghost" onClick={() => { haptic(); setWay("private"); }}>👤 بدون الطلاب (جدول خاص)</button>
        <div className="hint">إنت تختار أيامك وساعتك.</div>
      </div>
    </div>
  );
}

function Build({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const old = info.schedule;
  const [start, setStart] = useState(info.minStart);
  const [end, setEnd] = useState(old?.end ?? "");
  const [days, setDays] = useState<number[]>(old?.weekdays ?? []);
  const [hour, setHour] = useState(old && info.hours.includes(old.hour) ? old.hour : -1);
  const [shown, setShown] = useState<Preview | null>(null);
  const form = { start, end, weekdays: days, hour };
  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setShown(null); };
  const ready = !!start && !!end && days.length > 0 && hour >= 0;
  return (
    <div className="card">
      <h2>🗓 {old ? "رتب جدولك من جديد" : "رتب جدول امتحاناتك"}</h2>
      <div className="form">
        <div className="warn locked">عندك <b>{info.remaining}</b> امتحان. {old ? "اشتريت فصل جديد، فانعاد توزيع الامتحانات الباقية." : "اختار المدة والأيام والساعة، والبوت يوزعها."} وأكثر شي <b>{info.perDay}</b> باليوم.</div>
        {info.holiday && <div className="hint">🏖 العطلة من {info.holiday.start} لمدة {info.holiday.days} يوم، ما بيها امتحانات.</div>}
        <label>تبدي من تاريخ</label>
        <input type="date" className="ltr" min={info.minStart} value={start} onChange={(e) => change(setStart)(e.target.value)} />
        <label>تخلص بتاريخ{old ? " (تگدر تبقيه أو تغيره)" : ""}</label>
        <input type="date" className="ltr" min={start} value={end} onChange={(e) => change(setEnd)(e.target.value)} />
        <label>أيام الامتحان بالأسبوع</label>
        <div className="seg wrap2">
          {info.week.map((d) => (
            <button type="button" key={d.i} className={days.includes(d.i) ? "on" : ""} onClick={() => { haptic(); change(setDays)(days.includes(d.i) ? days.filter((x) => x !== d.i) : [...days, d.i]); }}>{d.name}</button>
          ))}
        </div>
        <label>الساعة</label>
        <select value={hour} onChange={(e) => change(setHour)(Number(e.target.value))}>
          <option value={-1}>اختار الساعة</option>
          {info.hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
        {!shown && <button type="button" className="btn agbtn adtop" disabled={busy || !ready} onClick={async () => { const r = await call({ action: "preview", ...form }); if (r?.preview) setShown(r.preview); }}>{busy ? "جاري الحساب..." : "شوف جدولي"}</button>}
        {shown && (
          <>
            <div className="warn locked adtop">📊 {shown.items.length} امتحان على {shown.days} يوم، بحدود {shown.perWeek} بالأسبوع، وأكثر شي {shown.maxPerDay} باليوم.</div>
            <table className="extable"><tbody>{shown.items.map((i) => <tr key={i.title + i.at}><td>{i.title}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table>
            <div className="rgalert adtop">⚠️ بعد التثبيت ما يتغير الجدول إلا عن طريق الإدارة.</div>
            <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void call({ action: "confirm", ...form })}>✅ ثبت جدولي</button>
          </>
        )}
      </div>
    </div>
  );
}

/** كود الحضور للطالب الحضوري: يطلعه للمساعد بالمركز، فينسجل حضوره وتنطبع ورقته */
function AttendCode({ code }: { code: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(code, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setSrc); }, [code]);
  return (
    <div className="card">
      <h2>🎫 كود الحضور</h2>
      <div className="expad atcode">
        {src && <img src={src} alt="كود الحضور" />}
        <div className="exhint">طلّع هذا الكود للمساعد بالمركز قبل الامتحان. ينسجل حضورك وتنطبع ورقتك باسمك. سوّيله سكرين شوت حتى يكون عندك حتى بدون انترنت.</div>
      </div>
    </div>
  );
}

function List({ info, busy, enter, object, ask }: { info: Info; busy: boolean; enter: (id: number) => void; object: (id: number) => void; ask: (item: number, reason: string) => Promise<unknown> }) {
  return (
    <div className="card">
      <h2>🗓 جدول امتحاناتك</h2>
      <div className="who adnopad expad adtop">{info.place} · {info.mode === "general" ? "ويا الطلاب" : "جدول خاص"}</div>
      <table className="extable"><tbody>
        {info.items.map((i) => (
          <Fragment key={i.id}>
          {(i.lectures ?? []).map((l) => (
            <tr key={l} className="lcrow">
              <td>📺 {l}<small className="pdmode">{info.appLink ? "شوفها بالتطبيق قبل الامتحان" : "ادرسها قبل الامتحان"}</small></td>
              <td className="p">{info.appLink && <button type="button" className="exbtn" onClick={() => openOutside(info.appLink)}>▶️ افتح</button>}</td>
            </tr>
          ))}
          <tr className={i.state === "open" ? "sel" : i.state === "notbought" ? "mxlocked" : ""}>
            <td><b>{i.optional ? "🎯 " : ""}{i.retake ? "🔁 " : ""}{i.title}</b>{i.retake && <span className="adentag">إعادة</span>}{i.total !== null && i.total !== undefined && <span className="adentag">{i.total} من 100</span>}<small className="pdmode">{i.chapter} · {i.minutes} دقيقة<br />{STATE[i.state]}</small>
              {i.state === "open" && <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => enter(i.id)}>📝 ادخل الامتحان</button>}
              {i.state === "missed" && <Excuse item={i} busy={busy} ask={ask} />}
              {i.total !== null && i.total !== undefined && <button type="button" className="exbtn adtop" disabled={busy} onClick={() => object(i.id)}>✋ اعتراض على الدرجة</button>}
            </td>
            <td className="adphone">{prettyAt(i.at)}</td>
          </tr>
          </Fragment>
        ))}
      </tbody></table>
      {!info.inPerson && <div className="expad exhint adtop">تگدر تدخل الامتحان خلال {info.window} دقيقة من موعده. الامتحان اللي يفوت وقته ما يرجع، إلا إذا عندك عذر ووافقت عليه الإدارة.</div>}
    </div>
  );
}

/** الامتحان الفايت: الطالب يكتب عذره ويطلب فتحه، ويشوف وين وصل طلبه */
function Excuse({ item, busy, ask }: { item: Item; busy: boolean; ask: (item: number, reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  if (item.exc === "asked") return <small className="pdmode">⏳ طلبك وصل، ننتظر الموافقة</small>;
  if (item.exc === "rejected") return <small className="pdmode exbad">❌ انرفض طلبك</small>;
  if (item.exc) return null;
  if (!open) return <button type="button" className="exbtn adtop" disabled={busy} onClick={() => setOpen(true)}>📨 عندي عذر</button>;
  return (
    <div className="adtop">
      <textarea className="stfield" rows={3} maxLength={500} placeholder="اكتب عذرك هنا" value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      <button type="button" className="btn agbtn adtop" disabled={busy || why.trim().length < 3} onClick={() => void ask(item.id, why)}>📨 دز الطلب</button>
    </div>
  );
}

function Optional({ info, busy, enter }: { info: Info; busy: boolean; enter: (exam: number) => void }) {
  const [ask, setAsk] = useState(0);
  return (
    <div className="card">
      <h2>🎯 امتحانات اختيارية</h2>
      <div className="expad exhint adtop">كل امتحان ينفتح مرة وحدة بس. لمن تدخل يبدي وقته، وما يتوقف إذا طلعت.</div>
      <table className="extable"><tbody>
        {info.optional.map((o) => (
          <tr key={o.exam}>
            <td><b>{o.title}</b><small className="pdmode">{o.chapter} · {o.minutes} دقيقة</small></td>
            <td className="p">{ask === o.exam
              ? <button type="button" className="btn" disabled={busy} onClick={() => enter(o.exam)}>متأكد؟ ادخل</button>
              : <button type="button" className="exbtn" disabled={busy} onClick={() => setAsk(o.exam)}>ادخل</button>}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

/** الاعتراض: يختار السؤال اللي يشوف درجته مو صحيحة، ويكتب أو يسجل بصوته ليش. كل سؤال مرة وحدة */
function Objection({ obj, setObj, leave }: { obj: Obj; setObj: (o: Obj) => void; leave: () => void }) {
  const [pick, setPick] = useState<Record<number, { text: string; voice: Blob | null }>>({});
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const picked = Object.entries(pick).map(([n, v]) => ({ n: Number(n), ...v }));
  const ready = picked.length > 0 && picked.every((p) => p.text.trim() || p.voice);
  const set = (n: number, v: { text: string; voice: Blob | null } | null) => setPick((x) => { const y = { ...x }; if (v) y[n] = v; else delete y[n]; return y; });
  async function send() {
    setBusy(true); setError(""); setNotice("");
    try {
      const f = new FormData();
      f.set("token", new URLSearchParams(location.search).get("t") ?? ""); f.set("device", await deviceId());
      f.set("action", "object"); f.set("item", String(obj.id)); f.set("qs", picked.map((p) => p.n).join(","));
      for (const p of picked) { f.set(`text_${p.n}`, p.text); if (p.voice) f.set(`voice_${p.n}`, p.voice, "voice"); }
      const res = await fetch("/api/myexams", { method: "POST", body: f });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "ما وصل الاعتراض، حاول مرة ثانية"); return; }
      setObj(j.obj); setPick({}); setNotice(j.notice ?? "");
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); }
  }
  const STATUS = (o: ObjState) => o.status === "open" ? "⏳ اعتراضك ينتظر رد المصحح"
    : o.status === "accepted" ? `✅ انقبل اعتراضك: صارت درجته ${o.mark} بدل ${o.old}` : `❌ انرفض اعتراضك${o.reason ? `: ${o.reason}` : ""}`;
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>✋ اعتراض على الدرجة</p>
      </header>
      <div className="wrap">
        <button type="button" className="exbtn" disabled={busy || rec} onClick={leave}>⬅️ رجوع لامتحاناتي</button>
        <div className="card adtop">
          <h2>📝 {obj.title}</h2>
          <div className="who">درجتك: <b>{obj.total}</b> من 100</div>
          <div className="expad exhint">اختار السؤال اللي تشوف درجته مو صحيحة، واكتب أو سجل بصوتك ليش. كل سؤال تگدر تعترض عليه مرة وحدة، والمصحح يرد عليك بالبوت.</div>
        </div>
        <div className="card">
          <div className="form">
            {obj.questions.map((q) => {
              const mine = pick[q.n];
              return (
                <div key={q.n} className={"obq" + (mine ? " on" : "")}>
                  <div className="obhead"><b>السؤال {q.n}</b><span>{q.obj?.status === "accepted" ? q.obj.mark : q.mark} من {q.max}</span></div>
                  {q.obj ? (
                    <div className={"obstate " + q.obj.status}>{STATUS(q.obj)}{q.obj.text && <small>اعتراضك: {q.obj.text}</small>}{q.obj.voice && <small>🎙 دزيت تسجيل صوتي</small>}</div>
                  ) : mine ? (
                    <>
                      <textarea rows={3} value={mine.text} placeholder="ليش تشوف درجة هذا السؤال مو صحيحة؟" onChange={(e) => set(q.n, { ...mine, text: e.target.value })} />
                      <VoiceRec btn="exbtn" label="🎙 أو سجل اعتراضك بصوتك (أكثر شي 5 دقايق)" value={mine.voice} onRecording={setRec} onChange={(v) => setPick((x) => (x[q.n] ? { ...x, [q.n]: { ...x[q.n], voice: v } } : x))} />
                      <button type="button" className="exbtn" disabled={rec} onClick={() => set(q.n, null)}>إلغاء الاعتراض على هذا السؤال</button>
                    </>
                  ) : (
                    <button type="button" className="exbtn" onClick={() => { haptic(); set(q.n, { text: "", voice: null }); }}>✋ أعترض على هذا السؤال</button>
                  )}
                </div>
              );
            })}
            {error && <div className="err">⚠️ {error}</div>}
            {notice && <div className="card warn exerr">{notice}</div>}
            {picked.length > 0 && <button type="button" className="btn agbtn adtop" disabled={busy || rec || !ready} onClick={() => void send()}>{busy ? "جاري الإرسال..." : `📤 دز الاعتراض (${picked.length} سؤال)`}</button>}
            {picked.length > 0 && !ready && <div className="hint">لكل سؤال اخترته اكتب السبب أو سجله بصوتك.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

const fileUrl = (item: number, ref: string) => `/api/myexams/file?t=${encodeURIComponent(new URLSearchParams(location.search).get("t") ?? "")}&item=${item}&ref=${encodeURIComponent(ref)}`;
const minutesLeft = (closeAt: string, nowAt: string, since: number) => {
  const end = new Date(closeAt.replace(" ", "T") + ":00Z").getTime(), start = new Date(nowAt.replace(" ", "T") + ":00Z").getTime();
  return Math.ceil((end - start - (Date.now() - since)) / 60000);
};
function ExamRoom({ room, setRoom, call, leave }: { room: Room; setRoom: (r: Room) => void; call: (b: Record<string, unknown>) => Promise<Info | null>; leave: () => void }) {
  const [since] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(room.questions[0]?.n ?? 0);
  const [draft, setDraft] = useState<{ q: number; file: File; url: string; turns: number } | null>(null);
  const [scan, setScan] = useState(scanDefault);
  async function pickPhoto(q: number, f: File | undefined) { if (f) setDraft({ q, file: f, url: await previewUrl(f, scan), turns: 0 }); }
  async function toggleScan() { const on = !scan; setScan(on); rememberScan(on); if (draft) setDraft({ ...draft, url: await previewUrl(draft.file, on) }); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 20000); return () => clearInterval(t); }, []);
  const left = minutesLeft(room.closeAt, room.now, since);
  useEffect(() => { if (left <= 0) setClosed(true); }, [left, tick]);
  async function send() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const f = new FormData();
      f.set("token", new URLSearchParams(location.search).get("t") ?? ""); f.set("device", await deviceId());
      f.set("item", String(room.id)); f.set("q", String(draft.q));
      f.set("file", await prepare(draft.file, draft.turns, scan), "answer.jpg");
      const res = await fetch("/api/myexams", { method: "POST", body: f });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "ما وصلت الصورة، حاول مرة ثانية"); if (res.status === 403) setClosed(true); return; }
      setRoom(j.room); setDraft(null);
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); } finally { setBusy(false); }
  }
  const total = room.questions.reduce((n, q) => n + q.answers.length, 0);
  if (closed) {
    return (
      <div className="wrap"><div className="card warn exerr">{total ? "انتهى الوقت، وأجوبتك اللي دزيتها انحفظت." : "⛔ انتهى وقت الامتحان المحدد، وأعطيناك وقت إضافي، ولم ترسل الإجابة."}</div>
        <button type="button" className="btn agbtn" onClick={leave}>رجوع لامتحاناتي</button></div>
    );
  }
  return (
    <div className="wrap">
      <div className="card"><h2>📝 {room.title}</h2>
        <div className="who">⏳ باقي <b>{left}</b> دقيقة<br /><small className="hint">الوقت {room.minutes} دقيقة، وفوقه {room.extra} دقيقة حتى تصور وتدز.</small></div>
      </div>
      {/* رقم الطالب فوك كل صفحة: إذا أحد صورها ونشرها نعرف منو */}
      {room.pages.map((p) => <div key={p} className="exidwrap"><span className="exid">🆔 {room.sid}</span><img className="eximg" src={fileUrl(room.id, p)} alt="أسئلة الامتحان" /></div>)}
      <div className="card"><h2>📷 صور جواب كل سؤال</h2>
        <div className="form">
          {room.questions.map((q) => (
            <div key={q.n}>
              <button type="button" className={"exqhead" + (open === q.n ? " on" : "")} onClick={() => setOpen(q.n)}><span>السؤال {q.n}</span><span>{q.answers.length ? `✅ ${q.answers.length} صورة` : "ما مدزوز"}</span></button>
              {open === q.n && (
                <div className="exqbody">
                  {q.answers.map((a) => (
                    <div key={a.id}><img className="eximg" src={fileUrl(room.id, a.file)} alt={`جواب ${q.n}`} /><button type="button" className="exbtn" disabled={busy} onClick={async () => { setBusy(true); const r = await call({ action: "delAnswer", item: room.id, answer: a.id }); if (r?.room) setRoom(r.room); setBusy(false); }}>🗑 احذف هاي الصورة</button></div>
                  ))}
                  {draft?.q === q.n ? (
                    <div>
                      <img className="eximg mxdraft" src={draft.url} alt="معاينة" style={{ transform: `rotate(${draft.turns * 90}deg)` }} />
                      <div className="exline">
                        <button type="button" className="exbtn" onClick={() => setDraft({ ...draft, turns: (draft.turns + 1) % 4 })}>🔄 دور الصورة</button>
                        <button type="button" className={scan ? "btn" : "exbtn"} onClick={() => void toggleScan()}>📄 سكانر {scan ? "✓" : ""}</button>
                        <button type="button" className="exbtn" onClick={() => setDraft(null)}>إلغاء</button>
                        <button type="button" className="btn" disabled={busy} onClick={() => void send()}>{busy ? "جاري الإرسال..." : "✅ تم"}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="exline">
                      <label className="exbtn">📷 صور بالكاميرا<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickPhoto(q.n, f); }} /></label>
                      <label className="exbtn">🖼 من الجهاز<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickPhoto(q.n, f); }} /></label>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {error && <div className="err">⚠️ {error}</div>}
          <button type="button" className="btn agbtn adtop" disabled={busy || !total} onClick={async () => { setBusy(true); const r = await call({ action: "submitExam", item: room.id }); setBusy(false); if (r) leave(); }}>✅ سلم الامتحان</button>
        </div>
      </div>
    </div>
  );
}
