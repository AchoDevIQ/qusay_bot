"use client";
// امتحاناتي: الطالب يرتب جدوله مرة وحدة، وبعدها يشوف مواعيده
import { WordOrder } from "../agreeSteps";
import PhotoPick from "../PhotoPick";
import AiCompare, { type AiQ } from "./AiCompare";
import PdfPages from "../PdfPages";
import { Fragment, useEffect, useState } from "react";
import { addDays, ampm, prettyAt, prettyDay } from "../../../lib/scheduleRules.ts";
import { DateInput, deviceId, deviceNow, haptic, openOutside, platform } from "../shared";
import QRCode from "qrcode";
import { prepare, previewUrl, rememberScan, scanDefault } from "../photoPrep";
import PenPage, { hasPenDraft, type PenHead } from "./PenPage";

type Item = { id: number; exam?: number; skippable?: boolean; optional?: boolean; total?: number | null; title: string; chapter: string; minutes: number; lectures?: string[]; at: string; exc?: string | null; retake?: boolean; state: "locked" | "open" | "missed" | "done" | "center" | "past" | "notbought" };
type PlacePreview = { items: { title: string; at: string; locked: boolean }[]; waiting: number };
type Preview = { items: { title: string; at: string }[]; days: number; maxPerDay: number; perWeek: number };
type Info = {
  viewOnly?: boolean; appLink: string; attendCode: string; inPerson: boolean; place: string; mode: string | null; needsChoice: boolean; repick: boolean; optional: { exam: number; title: string; chapter: string; minutes: number }[]; picks: Record<string, string> | null; late: { title: string; at: string }[]; days: { d: number; name: string; times: { t: string; label: string }[] }[]; placePreview?: PlacePreview;
  name: string; remaining: number; needsBuild: boolean; schedule: { start: string; end: string; weekdays: number[]; hour: number; times: Record<string, string[]> | null; hol?: { from: string; to: string } | null } | null; items: Item[]; holidays: Hol[]; midHol?: { from: string; to: string; reason: string } | null; gap: number;
  today: string; minStart: string; window: number; perDay: number; week: { i: number; name: string }[]; hours: number[]; offDays?: number[]; holiday: { start: string; days: number } | null; holReq?: { from: string; to: string; at: string } | null;
  preview?: Preview; notice?: string; error?: string; cp?: { key: string; image: string; text: string } | null; stop?: { image: string; bubble?: string }; comp?: Comp | null; lectureFiles?: string[]; inExam?: boolean; lateText: string; closedText: string; room?: Room; obj?: Obj; paper?: Paper;
};
type Hol = { id: number; ids: number[]; from: string; to: string; title: string; reason: string; cancel: boolean; kept?: boolean };
type ObjState = { status: "open" | "accepted" | "rejected"; text: string; voice: boolean; old: number; mark: number | null; reason: string };
type Paper = { ai: AiQ[]; solutions: string | null; id: number; title: string; chapter: string; submitted: string; graded: string; total: number | null; marks: { n: number; max: number; mark: number | null; skip?: boolean }[]; objections: { open: number; ok: number; no: number }; pages: string[]; gradedPages: boolean; questions: string[] };
type Obj = { id: number; title: string; total: number; questions: { n: number; max: number; mark: number; skip?: boolean; obj: ObjState | null }[] };
/** «أجب عن K أسئلة فقط»: تنبيه فوك الأسئلة، ويصير أحمر إذا جاوب أكثر */
function AnswerOnlyNote({ k, n, done }: { k: number; n: number; done: number }) {
  return (
    <div className={"expad exhint" + (done > k ? " exbad" : "")}>
      ✂️ <b>جاوب عن {k} أسئلة بس من {n}.</b> {done > k ? `جاوبت ${done}: تنحسب أول ${k} بالترتيب، والباقي ما ينحسب. احذف جواب السؤال اللي ما تريده.` : `جاوبت ${done} من ${k}.`}
    </div>
  );
}
type Room = { id: number; sid: number; title: string; oath: string; sworn: boolean; gallery: boolean; model: string; closeAt: string; now: string; minutes: number; extra: number; pages: string[]; questions: { n: number; max: number; img: string | null; text: string | null; answers: { id: number; file: string }[] }[]; head: PenHead; answerOnly?: number };
const STATE: Record<Item["state"], string> = { locked: "🔒 مقفول لحد وقته", open: "🟢 بدا هسه", missed: "⛔ فات وقته", done: "✅ مخلص", center: "🏫 بالمركز", past: "انتهى موعده", notbought: "🔒 ما مشتري" };

export default function MyExamsClient() {
  // صاحب البوت فتح صفحة طالب تجربة من صفحة الطلاب: زر يرجعه إلها
  const [fromOwner, setFromOwner] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); setFromOwner(q.has("owner") || q.has("view")); }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [stopPic, setStopPic] = useState("");
  const [stopWords, setStopWords] = useState("");
  const [busy, setBusy] = useState(false);
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const token = new URLSearchParams(location.search).get("t") ?? "";
      const res = await fetch("/api/myexams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body, device: await deviceId(), pf: await platform() }) });
      const j: Info = await res.json();
      if (!res.ok) { setError(j.error ?? "صار خطأ، حاول مرة ثانية"); if (res.status === 423) { setStopPic(j.stop?.image || "none"); setStopWords(j.stop?.bubble ?? ""); } return null; }
      setInfo(j);
      return j;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return null; } finally { setBusy(false); }
  }
  const [room, setRoom] = useState<Room | null>(null);
  const [obj, setObj] = useState<Obj | null>(null);
  const [firstQ, setFirstQ] = useState(0);
  async function openObj(item: number, q = 0) { const r = await call({ action: "objInfo", item }); if (r?.obj) { setFirstQ(q); setObj(r.obj); } }
  const [paper, setPaper] = useState<Paper | null>(null);
  async function openPaper(item: number) { const r = await call({ action: "paper", item }); if (r?.paper) setPaper(r.paper); }
  useEffect(() => {
    // زر «اعتراض على الدرجة» بالبوت يفتح الصفحة على الامتحان مباشرة
    const q = new URLSearchParams(location.search), o = Number(q.get("obj")), pp = Number(q.get("paper"));
    void (o ? openObj(o).then(() => undefined) : pp ? openPaper(pp).then(() => undefined) : call({ action: "info" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function enterOptional(exam: number) { const r = await call({ action: "openOptional", exam }); if (r?.room) setRoom(r.room); }
  async function enter(item: number) { const r = await call({ action: "openExam", item }); if (r?.room) setRoom(r.room); }
  if (obj) return <Objection obj={obj} first={firstQ} setObj={setObj} leave={() => { const back = paper?.id; setObj(null); void (back ? openPaper(back) : call({ action: "info" })); }} />;
  if (paper) return <PaperView paper={paper} busy={busy} error={error} object={(id, q) => void openObj(id, q)} leave={() => { setPaper(null); void call({ action: "info" }); }} />;
  if (room) return <ExamRoom room={room} setRoom={setRoom} call={call} leave={() => { setRoom(null); void call({ action: "info" }); }} />;

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>📝 امتحاناتي</p>
      </header>
      <div className="wrap">
        {fromOwner && <button type="button" className="exbtn" style={{ marginBottom: 10 }} onClick={() => history.back()}>⬅️ رجوع للطلاب</button>}
        {info?.viewOnly && <div className="card warn exerr">👁 هذا جدول <b>{info.name}</b> مثل ما يطلعله بالضبط. عرض بس، أي زر تدوسه ما يغير شي.</div>}
        {error && stopPic ? (
          <div className="card cpflash stop">
            {stopPic !== "none" && <div className="cpbubw"><img src={stopPic} alt="سيطرة" />{stopWords && <div className="cpbub">{stopWords}</div>}</div>}
            <div className="cpflashtext">🚦 {error}</div>
          </div>
        ) : error && <div className="card warn exerr">⚠️ {error}</div>}
        {info?.cp && (
          <div className="card cpflash">
            {info.cp.image ? <div className="cpbubw"><img src={info.cp.image} alt="سيطرة" /><div className="cpbub">{info.cp.text}</div></div> : <div className="cpflashtext">🚦 {info.cp.text}</div>}
            <button type="button" className="btn agbtn" disabled={busy} onClick={() => void call({ action: "cpSeen", key: info.cp!.key })}>👍 تمام</button>
          </div>
        )}
        {!info && !error && <div className="empty">جاري التحميل...</div>}
        {info?.repick && <Picker info={info} busy={busy} call={call} />}
        {info && info.late.length > 0 && <LateAsk info={info} busy={busy} call={call} />}
        {info?.needsChoice && <Choice info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && info.needsBuild && <Build info={info} busy={busy} call={call} />}
        {info && info.mode !== "general" && info.schedule && !info.needsBuild && <MyHoliday info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && !info.needsBuild && !info.items.length && <div className="empty">{info.mode === "general" ? "مواعيدك لسه ما نزلت." : "ماكو امتحانات بعد لفصولك."}</div>}
        {info?.notice && <div className="card warn exerr">{info.notice}</div>}
        {info?.attendCode && <AttendCode code={info.attendCode} />}
        {info && !!info.items.length && <List info={info} busy={busy} enter={enter} paper={(id) => void openPaper(id)} ask={(item, reason) => call({ action: "askException", item, reason })} file={(name) => call({ action: "lectureFile", name })} off={(ids) => call({ action: "holidayOff", holidays: ids })} cmd={call} />}
        {info?.comp && <CompCard c={info.comp} busy={busy} call={call} />}
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

/** عطلة الطالب الخاص: يشوفها، ويطلب يغيرها، والإدارة توافق */
function MyHoliday({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const cur = info.schedule?.hol ?? (info.holiday ? { from: info.holiday.start, to: addDays(info.holiday.start, info.holiday.days - 1) } : { from: "", to: "" });
  const [edit, setEdit] = useState(false);
  const [from, setFrom] = useState(cur.from);
  const [to, setTo] = useState(cur.to);
  const show = (h: { from: string; to: string }) => (h.from && h.to ? `من ${prettyDay(h.from)} إلى ${prettyDay(h.to)}` : "بدون عطلة");
  const ok = (!from && !to) || (!!from && !!to && to >= from);
  return (
    <div className="card">
      <h2>🏖 عطلتك</h2>
      <div className="form">
        <div className="hint">{show(cur)}</div>
        {info.holReq ? (
          <>
            <div className="warn locked">⏳ طلبت تغييرها: {show(info.holReq)}. ينتظر موافقة الإدارة.</div>
            <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void call({ action: "holRequestCancel" })}>إلغاء الطلب</button>
          </>
        ) : !edit ? (
          <button type="button" className="exbtn adtop" onClick={() => setEdit(true)}>✏️ أريد أغير عطلتي</button>
        ) : (
          <>
            <label>من</label>
            <DateInput label="عطلتي من" min={info.minStart} value={from} placeholder="بدون عطلة" onChange={setFrom} />
            <label>إلى</label>
            <DateInput label="عطلتي إلى" min={from || info.minStart} value={to} placeholder="بدون عطلة" onChange={setTo} />
            {!ok && <div className="hint exbad">اختار «من» و«إلى»، و«إلى» بعد «من».</div>}
            <div className="hint">التغيير يحتاج موافقة الإدارة، وبعدها جدولك ينعاد من باجر.</div>
            <div className="atrow">
              <button type="button" className="btn agbtn" disabled={busy || !ok} onClick={() => void call({ action: "holRequest", holFrom: from, holTo: to }).then((r) => { if (r) setEdit(false); })}>📨 أرسل الطلب</button>
              <button type="button" className="exbtn" onClick={() => { setFrom(""); setTo(""); }}>بدون عطلة</button>
              <button type="button" className="exbtn" onClick={() => setEdit(false)}>رجوع</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Build({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const old = info.schedule;
  // الحضوري: أيام مركزه وأوقاته بس. الإلكتروني: أي يوم، ومن ساعات الإدارة
  const center = info.inPerson;
  const allowed = center ? info.days.map((d) => d.d) : info.week.map((w) => w.i).filter((d) => !(info.offDays ?? []).includes(d));
  const nameOf = (d: number) => info.week.find((w) => w.i === d)?.name ?? "";
  const hours = info.hours.map((h) => `${String(h).padStart(2, "0")}:00`);
  const slotsOf = (d: number) => (center ? info.days.find((x) => x.d === d)?.times.map((x) => x.t) ?? [] : hours);
  const k = Math.max(1, Math.min(info.perDay, 3));
  const [start, setStart] = useState(info.minStart);
  const [end, setEnd] = useState(old?.end ?? "");
  const [days, setDays] = useState<number[]>((old?.weekdays ?? []).filter((d) => allowed.includes(d)));
  const [perDay, setPerDayTimes] = useState<Record<string, string[]>>(old?.times ?? {});
  const [same, setSame] = useState<string[]>(() => (old?.times ? Object.values(old.times)[0] ?? [] : old ? [`${String(old.hour).padStart(2, "0")}:00`] : []));
  const [shown, setShown] = useState<Preview | null>(null);
  // عطلته: تبدي بعطلة نصف السنة مال الإدارة (أو اللي اختارها قبل)، ويغيرها أو يشيلها
  const adminHol = info.holiday ? { from: info.holiday.start, to: addDays(info.holiday.start, info.holiday.days - 1) } : { from: "", to: "" };
  const [holFrom, setHolFrom] = useState(old?.hol ? old.hol.from : adminHol.from);
  const [holTo, setHolTo] = useState(old?.hol ? old.hol.to : adminHol.to);
  const timesOf = (d: number) => (center ? perDay[String(d)] ?? [] : same).filter(Boolean);
  const times = Object.fromEntries(days.map((d) => [String(d), timesOf(d)]));
  const form = { start, end, weekdays: days, times, holFrom, holTo };
  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setShown(null); };
  const holOk = (!holFrom && !holTo) || (!!holFrom && !!holTo && holTo >= holFrom);
  const ready = !!start && !!end && days.length > 0 && days.every((d) => timesOf(d).length > 0) && holOk;
  // اختيار وقت الامتحان رقم n يمسح اللي بعده إذا صار قبله
  const pick = (list: string[], n: number, t: string) => { const out = list.slice(0, n); if (t) out[n] = t; return out; };
  const Picks = ({ list, options, set }: { list: string[]; options: string[]; set: (l: string[]) => void }) => (
    <>
      {Array.from({ length: k }, (_, n) => n).filter((n) => n === 0 || (list[n - 1] && options.some((t) => t > list[n - 1]))).map((n) => (
        <div key={n}>
          <label>{n === 0 ? "وقت الامتحان الأول" : `وقت الامتحان ${["", "الثاني", "الثالث"][n]} (إذا صار عندك ${n === 1 ? "امتحانين" : "3 امتحانات"} بنفس اليوم)`}</label>
          <select value={list[n] ?? ""} onChange={(e) => change(set)(pick(list, n, e.target.value))}>
            <option value="">{n === 0 ? "اختار الوقت" : "ما أريد"}</option>
            {options.filter((t) => n === 0 || t > list[n - 1]).map((t) => <option key={t} value={t}>{ampm(t)}</option>)}
          </select>
        </div>
      ))}
    </>
  );
  return (
    <div className="card">
      <h2>🗓 {old ? "رتب جدولك من جديد" : "رتب جدول امتحاناتك"}</h2>
      <div className="form">
        <div className="warn locked">عندك <b>{info.remaining}</b> امتحان. {old ? "اشتريت فصل جديد، فانعاد توزيع الامتحانات الباقية." : "اختار المدة والأيام ووقت امتحانك، والبوت يوزعها."} وأكثر شي <b>{info.perDay}</b> باليوم.</div>
        <label>تبدي من تاريخ</label>
        <DateInput label="تبدي من تاريخ" min={info.minStart} value={start} onChange={change(setStart)} />
        <label>تخلص بتاريخ{old ? " (تگدر تبقيه أو تغيره)" : ""}</label>
        <DateInput label="تخلص بتاريخ" min={start} value={end} onChange={change(setEnd)} />
        <label>🏖 عطلتك: من</label>
        <DateInput label="عطلتك من" value={holFrom} placeholder="بدون عطلة" onChange={change(setHolFrom)} />
        <label>إلى</label>
        <DateInput label="عطلتك إلى" min={holFrom} value={holTo} placeholder="بدون عطلة" onChange={change(setHolTo)} />
        {holFrom && holTo && holTo < holFrom && <div className="hint exbad">«إلى» لازم يكون بعد «من».</div>}
        {(!!holFrom || !!holTo) && (!holFrom || !holTo) && <div className="hint exbad">اختار «من» و«إلى» هم.</div>}
        <div className="hint">{holFrom && holTo ? "أيام عطلتك ما بيها امتحانات. " : "ما عندك عطلة: الامتحانات تمشي بدون توقف. "}
          {(holFrom || holTo)
            ? <button type="button" className="exbtn" onClick={() => { change(setHolFrom)(""); setHolTo(""); }}>شيل العطلة</button>
            : info.holiday ? <button type="button" className="exbtn" onClick={() => { change(setHolFrom)(adminHol.from); setHolTo(adminHol.to); }}>رجّع عطلة نصف السنة</button> : null}
        </div>
        <label>أيام الامتحان بالأسبوع{center ? " (أيام مركزك)" : ""}</label>
        <div className="seg wrap2">
          {allowed.map((d) => (
            <button type="button" key={d} className={days.includes(d) ? "on" : ""} onClick={() => { haptic(); change(setDays)(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]); }}>{nameOf(d)}</button>
          ))}
          {/* اليوم اللي حجبته الإدارة يطلع مطفي، حتى الطالب يعرف ليش */}
          {!center && info.week.filter((w) => (info.offDays ?? []).includes(w.i)).map((w) => <button type="button" key={w.i} disabled style={{ opacity: 0.45 }}>🚫 {w.name}</button>)}
        </div>
        {!center && !!(info.offDays ?? []).length && <div className="hint">🚫 {info.week.filter((w) => (info.offDays ?? []).includes(w.i)).map((w) => w.name).join("، ")}: لا يوجد امتحانات في هذا اليوم.</div>}
        {center
          ? days.map((d) => (
            <div key={d} className="adsale">
              <b>📅 يوم {nameOf(d)}</b>
              <Picks list={perDay[String(d)] ?? []} options={slotsOf(d)} set={(l) => setPerDayTimes({ ...perDay, [String(d)]: l })} />
            </div>
          ))
          : <Picks list={same} options={hours} set={setSame} />}
        {info.perDay > 1 && <div className="hint">إذا اخترت وقت امتحان ثاني، ممكن يصير عندك امتحانين بنفس اليوم. لازم يكون بعد نهاية الأول بـ {info.gap} دقيقة على الأقل.</div>}
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

/** عطلة بالجدول. الطالب الخاص يگدر يلغيها فيتقدم جدوله */
function HolRow({ h, busy, off, keep }: { h: Hol; busy: boolean; off: (ids: number[]) => Promise<unknown>; keep: (ids: number[]) => Promise<unknown> }) {
  return (
    <tr className="lcrow mxholrow">
      <td>🏖 <b>عطلة{h.reason ? `: ${h.reason}` : ""}</b><small className="pdmode">{h.from === h.to ? prettyDay(h.from) : `من ${prettyDay(h.from)} إلى ${prettyDay(h.to)}`}{h.title ? ` · قبل ${h.title}` : ""}</small>
        {h.cancel && <div className="hint">تريد العطلة؟ ❌ يشيلها ويصعد جدولك.</div>}
        {h.kept && <small className="pdmode">✅ خليتها</small>}
      </td>
      <td className="p">
        {h.cancel && <>
          <button type="button" className="exbtn" disabled={busy} onClick={() => void keep(h.ids)}>✅ خليها</button>
          <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void off(h.ids)}>❌ شيلها</button>
        </>}
      </td>
    </tr>
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

function List({ info, busy, enter, paper, ask, file, off, cmd }: { info: Info; busy: boolean; enter: (id: number) => void; paper: (id: number) => void; ask: (item: number, reason: string) => Promise<unknown>; file: (name: string) => Promise<unknown>; off: (ids: number[]) => Promise<unknown>; cmd: (b: Record<string, unknown>) => Promise<unknown> }) {
  // العطلة تطلع قبل أول امتحان بعدها
  // عطلة نصف السنة سطر بين الامتحانات ويا العطل الثانية
  const hols: Hol[] = [...info.holidays, ...(info.midHol ? [{ id: 0, ids: [], title: "", cancel: false, ...info.midHol }] : [])].sort((a, b) => a.from.localeCompare(b.from));
  const holAt = (i: number) => hols.filter((h) => info.items.findIndex((x) => String(x.at).slice(0, 10) >= h.from) === i);
  const holLast = hols.filter((h) => !info.items.some((x) => String(x.at).slice(0, 10) >= h.from));
  // وين وصل الطالب: الامتحان المفتوح هسه، وإذا ماكو فالجاي. الزر فوق الجدول ينزله عليه (ويا محاضراته اللي قبله)
  const now = info.items.find((i) => i.state === "open") ?? info.items.find((i) => i.state === "locked" || i.state === "center");
  return (
    <div className="card">
      <h2>🗓 جدول امتحاناتك</h2>
      <div className="who adnopad expad adtop">{info.place} · {info.mode === "general" ? "ويا الطلاب" : "جدول خاص"}</div>
      {now && <div className="expad"><button type="button" className="btn agbtn" onClick={() => document.getElementById("mx-now")?.scrollIntoView({ behavior: "smooth", block: "start" })}>📍 وين وصلت؟</button></div>}
      <table className="extable"><tbody>
        {info.items.map((i, n) => (
          <Fragment key={i.id}>
          {holAt(n).map((h) => <HolRow key={h.id} h={h} busy={busy} off={off} keep={(ids) => cmd({ action: "holidayKeep", holidays: ids })} />)}
          {(i.lectures ?? []).map((l, k) => (
            <tr key={l} className="lcrow" id={i.id === now?.id && k === 0 ? "mx-now" : undefined}>
              <td>{i.id === now?.id && k === 0 && <span className="adentag">📍 وصلت هنا</span>}<span className="mxkind mxlec">📺 محاضرة</span>{l}<small className="pdmode">{info.appLink ? "شوفها بالتطبيق قبل الامتحان" : "ادرسها قبل الامتحان"}</small></td>
              <td className="p">
                {info.appLink && !info.inExam && <button type="button" className="exbtn" onClick={() => openOutside(info.appLink)}>▶️ افتح</button>}
                {info.lectureFiles?.includes(l) && <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void file(l)}>📄 الملف</button>}
              </td>
            </tr>
          ))}
          <tr className={`mxexamrow ${i.state === "open" ? "sel" : i.state === "notbought" ? "mxlocked" : ""}`} id={i.id === now?.id && !(i.lectures ?? []).length ? "mx-now" : undefined}>
            <td>{i.id === now?.id && !(i.lectures ?? []).length && <span className="adentag">📍 وصلت هنا</span>}<span className="mxkind mxexam">📝 امتحان</span><b>{i.optional ? "🎯 " : ""}{i.retake ? "🔁 " : ""}{i.title}</b>{i.retake && <span className="adentag">إعادة</span>}{i.total !== null && i.total !== undefined && <span className="adentag">{i.total} من 100</span>}<small className="pdmode">{i.chapter} · {i.minutes} دقيقة<br />{STATE[i.state]}</small>
              {i.state === "open" && <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => enter(i.id)}>📝 ادخل الامتحان</button>}
              {i.skippable && (
                <div className="hint adtop">تگدر تشيل هذا الامتحان من جدولك، فيصعد جدولك:
                  <div className="exline"><button type="button" className="exbtn" disabled={busy} onClick={() => void cmd({ action: "keepExam", item: i.id })}>✅ خليه</button><button type="button" className="exbtn" disabled={busy} onClick={() => void cmd({ action: "skipExam", item: i.id })}>❌ شيله</button></div>
                </div>
              )}
              {i.state === "missed" && <Excuse item={i} busy={busy} ask={ask} />}
              {i.state === "done" && <button type="button" className="exbtn adtop" disabled={busy} onClick={() => paper(i.id)}>📂 ورقتي وتصحيحها</button>}
            </td>
            <td className="adphone">{prettyAt(i.at)}</td>
          </tr>
          </Fragment>
        ))}
        {holLast.map((h) => <HolRow key={h.id} h={h} busy={busy} off={off} keep={(ids) => cmd({ action: "holidayKeep", holidays: ids })} />)}
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

/** الاعتراض: يختار السؤال اللي يشوف درجته مو صحيحة، ويكتب ليش (كتابة بس). كل سؤال مرة وحدة */
function Objection({ obj, first, setObj, leave }: { obj: Obj; first: number; setObj: (o: Obj) => void; leave: () => void }) {
  const [pick, setPick] = useState<Record<number, { text: string }>>(() => (first && obj.questions.some((q) => q.n === first && !q.obj) ? { [first]: { text: "" } } : {}));
  const rec = false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const picked = Object.entries(pick).map(([n, v]) => ({ n: Number(n), ...v }));
  const ready = picked.length > 0 && picked.every((p) => p.text.trim());
  const set = (n: number, v: { text: string } | null) => setPick((x) => { const y = { ...x }; if (v) y[n] = v; else delete y[n]; return y; });
  async function send() {
    setBusy(true); setError(""); setNotice("");
    try {
      const f = new FormData();
      f.set("token", new URLSearchParams(location.search).get("t") ?? ""); f.set("device", await deviceId()); f.set("pf", await platform());
      f.set("action", "object"); f.set("item", String(obj.id)); f.set("qs", picked.map((p) => p.n).join(","));
      for (const p of picked) f.set(`text_${p.n}`, p.text);
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
        <h1>قصي العميري</h1>
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
                  <div className="obhead"><b>السؤال {q.n}</b><span>{q.skip ? "⏭ ترك" : <>{q.obj?.status === "accepted" ? q.obj.mark : q.mark} من {q.max}</>}</span></div>
                  {q.skip ? null : q.obj ? (
                    <div className={"obstate " + q.obj.status}>{STATUS(q.obj)}{q.obj.text && <small>اعتراضك: {q.obj.text}</small>}{q.obj.voice && <small>🎙 دزيت تسجيل صوتي</small>}</div>
                  ) : mine ? (
                    <>
                      <textarea rows={3} value={mine.text} placeholder="ليش تشوف درجة هذا السؤال مو صحيحة؟" onChange={(e) => set(q.n, { ...mine, text: e.target.value })} />
                      <button type="button" className="exbtn" disabled={rec} onClick={() => set(q.n, null)}>إلغاء الاعتراض على هذا السؤال</button>
                    </>
                  ) : (
                    <button type="button" className="exbtn" onClick={() => { haptic(); set(q.n, { text: "" }); }}>✋ أعترض على هذا السؤال</button>
                  )}
                </div>
              );
            })}
            {error && <div className="err">⚠️ {error}</div>}
            {notice && <div className="card warn exerr">{notice}</div>}
            {picked.length > 0 && <button type="button" className="btn agbtn adtop" disabled={busy || rec || !ready} onClick={() => void send()}>{busy ? "جاري الإرسال..." : `📤 دز الاعتراض (${picked.length} سؤال)`}</button>}
            {picked.length > 0 && !ready && <div className="hint">لكل سؤال اخترته اكتب السبب.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

/** ملف الحلول الكامل بتقسيم الدرجات، ينفتح داخل الصفحة لأن تليجرام ما يعرض PDF بالموبايل */
function SolutionsFile({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [src] = useState(url);
  return (
    <div className="card expad">
      <button type="button" className="btn" onClick={() => { haptic(); setOpen(!open); }}>{open ? "✖️ سد ملف الحلول" : "📄 افتح ملف الحلول كاملة مع تقسيم الدرجات"}</button>
      {open && <PdfPages url={src} outside={false} />}
    </div>
  );
}

/** «📂 ورقتي وتصحيحها»: كل شي عن امتحان واحد بمكان واحد */
function PaperView({ paper, busy, error, object, leave }: { paper: Paper; busy: boolean; error: string; object: (id: number, q?: number) => void; leave: () => void }) {
  const graded = paper.total !== null;
  const o = paper.objections;
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>📂 {paper.title}</p>
      </header>
      <div className="wrap">
        <button type="button" className="exbtn" disabled={busy} onClick={leave}>⬅️ رجوع لامتحاناتي</button>
        {error && <div className="card warn exerr">⚠️ {error}</div>}
        <div className="card adtop">
          <h2>📝 {paper.title}</h2>
          <div className="who">{graded ? <>درجتك: <b>{paper.total}</b> من 100</> : "⏳ ورقتك وصلت، وبعدها ما انصححت"}</div>
          <div className="expad exhint">{paper.chapter}{paper.submitted ? ` · سلمتها ${paper.submitted.slice(0, 16)}` : ""}{paper.graded ? ` · تم التصحيح ${paper.graded.slice(0, 16)}` : ""}</div>
          {(o.open + o.ok + o.no > 0) && <div className="expad exhint">✋ اعتراضاتك: {o.open ? `${o.open} تنتظر رد · ` : ""}{o.ok ? `${o.ok} انقبلت · ` : ""}{o.no ? `${o.no} انرفضت` : ""}</div>}
        </div>
        {graded && !!paper.ai.length && <AiCompare qs={paper.ai} fileUrl={(r) => fileUrl(paper.id, r)} />}
        {/* صححها نظام التصحيح AI: صور جوابه موجودة داخل كل سؤال («📷 ورقتي»)، فما نكررها هنا. الورقة المصححة بالقلم من مصحح تبقى */}
        {!!paper.pages.length && (paper.gradedPages || !paper.ai.length) && (
          <div className="card">
            <h2>{paper.gradedPages ? "✅ ورقتك المصححة" : "📷 جوابك مثل ما دزيته"}</h2>
            {paper.pages.map((p) => <img key={p} className="eximg" src={fileUrl(paper.id, p)} alt="ورقتك" />)}
          </div>
        )}
        {graded && paper.solutions && <SolutionsFile url={fileUrl(paper.id, paper.solutions)} />}
        {graded && !!paper.marks.length && (
          <div className="card">
            <h2>✋ درجة كل سؤال</h2>
            <div className="expad exhint">شفت التصحيح وتشوف درجة سؤال مو صحيحة؟ دوس «اعترض» جنبه واكتب ليش.</div>
            <table className="extable"><tbody>
              {paper.marks.map((m) => (
                <tr key={m.n}><td>السؤال {m.n}<small className="pdmode">{m.skip ? "⏭ ترك" : <><b>{m.mark ?? "—"}</b> من {m.max}</>}</small></td>
                  <td className="p">{!m.skip && <button type="button" className="exbtn" disabled={busy} onClick={() => object(paper.id, m.n)}>✋ اعترض</button>}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
        {!!paper.questions.length && (
          <div className="card">
            <h2>📄 أسئلة الامتحان</h2>
            {paper.questions.map((p) => <img key={p} className="eximg" src={fileUrl(paper.id, p)} alt="أسئلة الامتحان" />)}
          </div>
        )}
      </div>
    </>
  );
}

const fileUrl = (item: number, ref: string) => `/api/myexams/file?t=${encodeURIComponent(new URLSearchParams(location.search).get("t") ?? "")}&item=${item}&ref=${encodeURIComponent(ref)}&pf=${encodeURIComponent((window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "")}&d=${encodeURIComponent(deviceNow())}`;
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
  // صور كثيرة مرة وحدة (أو صفحات PDF): كل وحدة تطلع للمعاينة وتندز، وبعدها اللي وراها
  const [more, setMore] = useState<File[]>([]);
  async function pickPhoto(q: number, files: File[]) {
    const [f, ...rest] = files;
    setMore(rest);
    if (f) setDraft({ q, file: f, url: await previewUrl(f, scan), turns: 0 }); else setDraft(null);
  }
  async function toggleScan() { const on = !scan; setScan(on); rememberScan(on); if (draft) setDraft({ ...draft, url: await previewUrl(draft.file, on) }); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 5000); return () => clearInterval(t); }, []);
  const left = minutesLeft(room.closeAt, room.now, since);
  useEffect(() => { if (left <= 0) setClosed(true); }, [left, tick]);
  // ✏️ اكتب بالقلم: رقم السؤال المفتوح بورقة الكتابة
  const [pen, setPen] = useState<number | null>(null);
  /** يدز صورة جواب سؤال (من الكاميرا أو من ورقة القلم). الجديدة تبدل القديمة */
  async function upload(q: number, file: Blob) {
    setBusy(true); setError("");
    try {
      const f = new FormData();
      f.set("token", new URLSearchParams(location.search).get("t") ?? ""); f.set("device", await deviceId()); f.set("pf", await platform());
      f.set("item", String(room.id)); f.set("q", String(q));
      f.set("file", file, "answer.jpg");
      const res = await fetch("/api/myexams", { method: "POST", body: f });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "ما وصلت الصورة، حاول مرة ثانية"); if (res.status === 403) setClosed(true); return false; }
      setRoom(j.room);
      return true;
    } catch { setError("ماكو اتصال، حاول مرة ثانية"); return false; } finally { setBusy(false); }
  }
  async function send() {
    if (!draft) return;
    if (!await upload(draft.q, await prepare(draft.file, draft.turns, scan))) return;
    if (more.length) await pickPhoto(draft.q, more); else setDraft(null);
  }
  const total = room.questions.reduce((n, q) => n + q.answers.length, 0);
  if (closed) {
    return (
      <div className="wrap"><div className="card warn exerr">{total ? "انتهى الوقت، وأجوبتك اللي دزيتها انحفظت." : "⛔ انتهى وقت الامتحان المحدد، وأعطيناك وقت إضافي، ولم ترسل الإجابة."}</div>
        <button type="button" className="btn agbtn" onClick={leave}>رجوع لامتحاناتي</button></div>
    );
  }
  const penQ = pen === null ? null : room.questions.find((x) => x.n === pen) ?? null;
  if (penQ && room.sworn) {
    return (
      <>
        {error && <div className="wrap"><div className="err">⚠️ {error}</div></div>}
        <ExamTimer flat left={left} minutes={room.minutes} extra={room.extra} />
        <PenPage item={room.id} sid={room.sid} model={room.model} head={room.head} q={penQ} imgUrl={penQ.img ? fileUrl(room.id, penQ.img) : null} busy={busy}
          onSave={async (f) => { const ok = await upload(penQ.n, f); if (ok) { setPen(null); setOpen(penQ.n); } return ok; }} onClose={() => setPen(null)} />
      </>
    );
  }
  return (
    <div className="wrap">
      <ExamTimer left={left} minutes={room.minutes} extra={room.extra} />
      <div className="card"><h2>📝 {room.title}</h2></div>
      {/* رقم الطالب فوك كل صفحة: إذا أحد صورها ونشرها نعرف منو */}
      {!room.sworn ? (
        <WordOrder key={room.id} title="🤲 القسم قبل الأسئلة" intro="الأسئلة تنفتح بعد ما تكمل جملة القسم: اقراها، ودوس كل فراغ «؟؟؟» واختار الكلمة الصحيحة:" okLabel="📖 افتح الأسئلة" sentence={room.oath}
          onDone={async () => { setBusy(true); const r = await call({ action: "oath", item: room.id }); setBusy(false); if (r?.room) setRoom(r.room); }} />
      ) : (
      <>
      {room.pages.map((p) => <div key={p} className="exidwrap"><span className="exid">🆔 {room.sid}</span><img className="eximg" src={fileUrl(room.id, p)} alt="أسئلة الامتحان" /></div>)}
      <div className="card"><h2>📷 صور جواب كل سؤال</h2>
        {!!room.answerOnly && <AnswerOnlyNote k={room.answerOnly} n={room.questions.length} done={room.questions.filter((q) => q.answers.length).length} />}
        <div className="form">
          {room.questions.map((q) => (
            <div key={q.n}>
              <button type="button" className={"exqhead" + (open === q.n ? " on" : "")} onClick={() => setOpen(q.n)}><span>السؤال {q.n}</span><span>{q.answers.length ? "✅ مدزوزة" : "ما مدزوز"}</span></button>
              {open === q.n && (
                <div className="exqbody">
                  {q.answers.map((a) => (
                    <div key={a.id}><img className="eximg" src={fileUrl(room.id, a.file)} alt={`جواب ${q.n}`} /><button type="button" className="exbtn" disabled={busy} onClick={async () => { setBusy(true); const r = await call({ action: "delAnswer", item: room.id, answer: a.id }); if (r?.room) setRoom(r.room); setBusy(false); }}>🗑 احذف هاي الصورة</button></div>
                  ))}
                  {draft?.q === q.n ? (
                    <div>
                      {more.length > 0 && <div className="exhint">باقي {more.length} صورة وراها</div>}
                      <div className="exhint exbad">⚠️ لازم الصورة عدلة مو مگلوبة، عداها الورقة ما تتصحح.</div>
                      <img className="eximg mxdraft" src={draft.url} alt="معاينة" style={{ transform: `rotate(${draft.turns * 90}deg)` }} />
                      <div className="exline">
                        <button type="button" className="exbtn" onClick={() => setDraft({ ...draft, turns: (draft.turns + 1) % 4 })}>🔄 دور الصورة</button>
                        <button type="button" className={scan ? "btn" : "exbtn"} onClick={() => void toggleScan()}>📄 سكانر {scan ? "✓" : ""}</button>
                        <button type="button" className="exbtn" onClick={() => void pickPhoto(draft.q, more)}>{more.length ? "تخطّى هاي الصورة" : "إلغاء"}</button>
                        <PhotoPick gallery={room.gallery} label="بدّل الصورة" onFiles={(fs) => void pickPhoto(draft.q, fs)} />
                        <button type="button" className="btn" disabled={busy} onClick={() => void send()}>{busy ? "جاري الإرسال..." : "✅ تم"}</button>
                      </div>
                    </div>
                  ) : q.answers.length ? (
                    <>
                      <div className="exhint">صورة وحدة لكل سؤال. إذا تريد تبدلها، احذفها وصور غيرها{hasPenDraft(room.id, q.n) ? "، أو عدل كتابتك" : ""}.</div>
                      {hasPenDraft(room.id, q.n) && <button type="button" className="exbtn" disabled={busy} onClick={() => setPen(q.n)}>✏️ عدل كتابتك</button>}
                    </>
                  ) : (
                    <>
                      <div className="exhint">جاوب بالكاميرا (تصور ورقتك)، أو اكتب بالقلم على الشاشة إذا عندك آيباد.</div>
                      <div className="exline">
                        <PhotoPick gallery={room.gallery} label={`السؤال ${q.n}`} onFiles={(fs) => void pickPhoto(q.n, fs)} />
                        <button type="button" className="exbtn" disabled={busy} onClick={() => setPen(q.n)}>✏️ اكتب بالقلم</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {error && <div className="err">⚠️ {error}</div>}
          <button type="button" className="btn agbtn adtop" disabled={busy || !total} onClick={async () => { setBusy(true); const r = await call({ action: "submitExam", item: room.id }); setBusy(false); if (r) leave(); }}>✅ سلم الامتحان</button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

/** عداد الامتحان: ثابت فوك الصفحة، ينزل دقيقة دقيقة بدون صوت. يبدي من وقت الامتحان + الوقت الإضافي */
function ExamTimer({ left, minutes, extra, flat = false }: { left: number; minutes: number; extra: number; flat?: boolean }) {
  const n = Math.max(0, left);
  return (
    <div className={"extimer" + (n <= 10 ? " low" : "") + (flat ? " flat" : "")} role="timer" aria-live="off">
      <b>⏳ {n}</b><span>دقيقة باقية</span>
      <small>الامتحان {minutes} دقيقة + {extra} دقيقة للتصوير والإرسال</small>
    </div>
  );
}

type CompMember = { id: number; name: string; avg: number | null; exams: number; rank: number };
type Comp = {
  group: { name: string; status: string; count: number; need: number; link: string; owner: boolean; members: CompMember[] } | null;
  center: { name: string; avg: number | null; rank: number | null; total: number } | null; myAvg: number | null; kind: string;
};
/** المنافسة: مجموعته وترتيبهم، أو يسوي مجموعة أو يفوت لوحدة بالكود. وترتيبه بمركزه إذا من أول 100 */
function CompCard({ c, busy, call }: { c: Comp; busy: boolean; call: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sure, setSure] = useState(false);
  const g = c.group;
  const share = (link: string) => openOutside(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`تعال ويانا بمجموعة المنافسة «${g?.name ?? ""}» 🏆`)}`);
  return (
    <div className="card">
      <h2>🏆 المنافسة</h2>
      <div className="expad">
        {c.center && (
          <div className="atcard">
            <b>🏫 {c.center.name}</b>
            {c.center.rank ? <div className="exhint atok">ترتيبك بالمركز: <b>{c.center.rank}</b> من {c.center.total} · معدلك {c.center.avg}</div>
              : <div className="exhint">معدلك {c.center.avg ?? "—"}. ترتيبك يبين من تصير من أول 100 بالمركز 💪</div>}
          </div>
        )}
        {!g && (
          <>
            <div className="exhint adtop">سوي مجموعة ويا أصدقائك ({c.kind})، وتتنافسون بالمعدل. من تصيرون {5} أو أكثر يروح طلبكم للإدارة.</div>
            <div className="exadd adtop">
              <input className="exinput" maxLength={30} placeholder="اسم المجموعة، مثلاً المجد" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="button" className="exbtn" disabled={busy || name.trim().length < 3} onClick={() => void call({ action: "compCreate", name })}>➕ سوي</button>
            </div>
            <div className="exadd adtop">
              <input className="exinput" dir="ltr" maxLength={8} placeholder="كود مجموعة صديقك" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <button type="button" className="exbtn" disabled={busy || code.length !== 8} onClick={() => void call({ action: "compJoin", code })}>👥 فوت</button>
            </div>
          </>
        )}
        {g && (
          <>
            <div className="exlabel adtop">👥 مجموعة «{g.name}» <small className="pdmode">الكود: <span dir="ltr">{g.link.split("grp_")[1]}</span></small></div>
            {g.status === "approved" ? (
              <table className="extable"><tbody>
                {g.members.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.rank <= 3 && m.avg !== null ? ["🥇", "🥈", "🥉"][m.rank - 1] : `${m.rank}.`} {m.name}</b><small className="pdmode">{m.exams ? `${m.exams} امتحان` : "بعده ما امتحن"}</small></td>
                    <td className="p"><b>{m.avg ?? "—"}</b></td>
                  </tr>
                ))}
              </tbody></table>
            ) : (
              <>
                <div className="exhint">{g.status === "pending" ? "⏳ صرتوا " + g.count + "، وطلبكم عند الإدارة. ننتظر الموافقة." : `بيها ${g.count} من ${g.need}. دز الرابط لأصدقائك، ومن يصيرون ${g.need} يروح طلبكم للإدارة.`}</div>
                <div className="exhint">{g.members.map((m) => m.name).join("، ")}</div>
              </>
            )}
            <div className="exline adtop">
              <button type="button" className="btn" onClick={() => share(g.link)}>📤 دز الرابط لأصدقائك</button>
              {!sure ? <button type="button" className="exbtn" onClick={() => setSure(true)}>🚪 اطلع من المجموعة</button>
                : <button type="button" className="exbtn exbad" disabled={busy} onClick={() => void call({ action: "compLeave" })}>متأكد؟ اطلع</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
