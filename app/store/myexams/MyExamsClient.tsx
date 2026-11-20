"use client";
// امتحاناتي: الطالب يرتب جدوله مرة وحدة، وبعدها يشوف مواعيده
import PhotoPick from "../PhotoPick";
import AiCompare, { type AiQ } from "./AiCompare";
import PdfPages from "../PdfPages";
import { Fragment, useEffect, useRef, useState } from "react";
import { addDays, ampm, prettyAt, prettyDay } from "../../../lib/scheduleRules.ts";
import BasicsCard, { type Basics } from "../BasicsCard";
import { DateInput, deviceId, deviceNow, haptic, openOutside, platform, platformNow } from "../shared";
import QRCode from "qrcode";
import { prepare, previewUrl, rememberScan, scanDefault } from "../photoPrep";
import PenPage, { hasPenDraft, type PenHead } from "./PenPage";
import { donePicking, pickingNow } from "../picking";

type Item = { id: number; status?: string; exam?: number; skippable?: boolean; optional?: boolean; total?: number | null; title: string; chapter: string; minutes: number; lectures?: string[]; at: string; exc?: string | null; retake?: boolean; ipad?: boolean; catchup?: boolean; state: "locked" | "open" | "missed" | "done" | "center" | "past" | "notbought" };
type PlacePreview = { items: { title: string; at: string; locked: boolean }[]; waiting: number };
type Preview = { items: { title: string; at: string; skip?: boolean }[]; days: number; maxPerDay: number; perWeek: number };
type Info = {
  slowOk?: boolean; basics?: Basics | null; viewOnly?: boolean; appLink: string; attendCode: string; ipad?: boolean | null; inPerson: boolean; place: string; mode: string | null; needsChoice: boolean; repick: boolean; optional: { exam: number; title: string; chapter: string; minutes: number }[]; picks: Record<string, string> | null; late: { title: string; at: string }[]; catchup?: boolean; catchHours?: number[];
  catchPlan?: CatchPlan | null; guardWait?: { pending: number[]; old: boolean; travel: string } | null; days: { d: number; name: string; times: { t: string; label: string; full?: boolean }[] }[]; placePreview?: PlacePreview;
  name: string; remaining: number; canDrop?: { exam: number; title: string }[]; toPlan?: { exam: number; title: string; chapter: string; skip: boolean }[]; perWeekMax?: number; pace?: Pace; needsBuild: boolean; schedule: { start: string; end: string; weekdays: number[]; hour: number; times: Record<string, string[]> | null; hol?: { from: string; to: string } | null } | null; items: Item[]; holidays: Hol[]; midHol?: { from: string; to: string; reason: string } | null; gap: number;
  today: string; minStart: string; window: number; perDay: number; week: { i: number; name: string }[]; hours: number[]; offDays?: number[]; holiday: { start: string; days: number } | null; holReq?: { from: string; to: string; at: string } | null;
  preview?: Preview; notice?: string; error?: string; cp?: { key: string; image: string; text: string } | null; stop?: { image: string; bubble?: string }; comp?: Comp | null; lectureFiles?: string[]; inExam?: boolean; lateText: string; closedText: string; room?: Room; obj?: Obj; paper?: Paper;
};
type Hol = { id: number; ids: number[]; from: string; to: string; title: string; reason: string; cancel: boolean; kept?: boolean };
type ObjState = { status: "open" | "accepted" | "rejected"; text: string; voice: boolean; old: number; mark: number | null; reason: string };
type Paper = { ai: AiQ[]; solutions: string | null; id: number; title: string; chapter: string; submitted: string; graded: string; total: number | null; marks: { n: number; max: number; mark: number | null; skip?: boolean }[]; objections: { open: number; ok: number; no: number }; pages: string[]; gradedPages: boolean; questions: string[] };
type Obj = { id: number; title: string; total: number; questions: { n: number; max: number; mark: number; skip?: boolean; obj: ObjState | null }[] };
/** «أجب عن K أسئلة فقط»: تنبيه فوك الأسئلة، ويصير أحمر إذا جاوب أكثر */
/** القسم قبل الأسئلة: كلمات الجملة مربعات مخربطة، والطالب يدوسها بالترتيب. الكلمة اللي مو بمكانها ما تنقبل */
function TileOath({ sentence, busy, onDone }: { sentence: string; busy: boolean; onDone: (text: string) => void }) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const [pool] = useState(() => { const a = words.map((w, i) => ({ w, i })); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; });
  const [picked, setPicked] = useState<number[]>([]);
  const [wrong, setWrong] = useState("");
  const done = picked.length === words.length;
  function pick(i: number) {
    // كلمة مكررة (مثل اسم الأب والجد) أي وحدة منهن تنقبل
    if (pool[i].w !== words[picked.length]) { haptic(); setWrong(pool[i].w); return; }
    haptic(); setWrong(""); setPicked([...picked, i]);
  }
  return (
    <div className="card agcard">
      <h2>🤲 القسم قبل الأسئلة</h2>
      <div className="agbody">
        <p className="agtext agsmall">الأسئلة تنفتح بعد ما ترتب جملة القسم. اقراها، ودوس الكلمات بالترتيب:</p>
        <div className="agtext">{sentence}</div>
        <div className={"agbuilt" + (done ? " ok" : "")} aria-live="polite">{picked.length ? picked.map((i) => pool[i].w).join(" ") : "دوس أول كلمة…"}</div>
        {wrong && <div className="agwrong">❌ «{wrong}» مو بمكانها، شوف الجملة ودوس الكلمة اللي بعدها</div>}
        {done ? <div className="agbuilt ok">✅ رتبتها صح</div> : (
          <>
            <div className="agwords">{pool.map((p, i) => !picked.includes(i) && <button type="button" key={i} className="agword" onClick={() => pick(i)}>{p.w}</button>)}</div>
            {!!picked.length && <button type="button" className="btn ghost agbtn" onClick={() => { setWrong(""); setPicked(picked.slice(0, -1)); }}>↩️ امسح آخر كلمة</button>}
          </>
        )}
        <button type="button" className="btn agbtn" disabled={!done || busy} onClick={() => { haptic(); onDone(picked.map((i) => pool[i].w).join(" ")); }}>{done ? "📖 افتح الأسئلة" : "رتب الجملة كاملة أول"}</button>
      </div>
    </div>
  );
}
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
  // الآيباد: الشاشة عريضة (أصغر جهة 600 أو أكثر)، والتلفون ضيق. امتحان المركز بالآيباد ما ينفتح من التلفون
  async function enter(item: number) { const r = await call({ action: "openExam", item, tablet: isTablet() }); if (r?.room) setRoom(r.room); }
  // الحضوري بالآيباد: يوم امتحانه الصفحة تسأل كل شوية، ومن يسجلون حضوره تنفتح أسئلته وحدها (مرة وحدة لكل امتحان)
  const autoIn = useRef(new Set<number>());
  const today = info?.today ?? "";
  const waitingToday = !room && !!info?.items.some((i) => i.ipad && i.state === "center" && String(i.at).startsWith(today));
  useEffect(() => {
    if (!waitingToday) return;
    const t = setInterval(() => { void call({ action: "info" }); }, 8000);
    return () => clearInterval(t);
  }, [waitingToday]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!info || room) return;
    const it = info.items.find((i) => i.ipad && i.state === "open" && !autoIn.current.has(i.id));
    if (it) { autoIn.current.add(it.id); void enter(it.id); }
  }, [info, room]); // eslint-disable-line react-hooks/exhaustive-deps
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
        {/* صاحب البوت فاتح صفحة طالب تجربة: يعرف وين هو وشنو يدوس */}
        {fromOwner && info && !info.viewOnly && (
          <div className="card warn locked">🧪 هذي صفحة «📝 امتحاناتي» مال <b>{info.name}</b>، مثل ما يشوفها هو.{" "}
            {info.needsChoice ? "انزل لـ «🗓 شلون تمتحن؟» ودوس «👤 بدون الطلاب (جدول خاص)»."
              : info.needsBuild ? "رتب جدوله من «🗓 رتب جدول امتحاناتك» اللي تحت."
              : !info.items.length ? "ما عنده امتحانات. ارجع للطلاب واعطيه فصل بـ «📚 اعطيه الفصل وافتح جدوله»."
              : "جدوله مرتب. تحت كل امتحان: ✅ خليه و🗑 احذفه (إذا يمكن حذفه)، و🕐 غير الوقت. حتى ترتبه من جديد ارجع ودوس «📚 اعطيه الفصل وافتح جدوله» مرة ثانية."}
          </div>
        )}
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
        {info?.basics && !info.viewOnly && <BasicsCard need={info.basics} busy={busy} save={(b) => void call({ action: "setBasics", ...b })} />}
        {info?.repick && !info.basics && <Picker info={info} busy={busy} call={call} />}
        {info && info.late.length > 0 && <LateAsk info={info} busy={busy} call={call} />}
        {info?.guardWait && (info.guardWait.pending.length > 0 || info.guardWait.old) && (
          <div className="card"><div className="hmlink">
            <div>✍️ <b>ولي أمرك بعده ما استلم {info.guardWait.pending.length > 1 ? `${info.guardWait.pending.length} درجات` : "درجتك"}.</b> الورقة المصححة والاعتراض ينفتحن ورا ما يدوس «✅ استلمت». {info.guardWait.old ? "ولأن مرت 3 أيام، المتجر والتصويت والمنافسة مقفولين هسه. الدراسة والامتحانات مفتوحة دايماً." : "إذا مرت 3 أيام وما استلم، المتجر والتصويت والمنافسة ينقفلن."}</div>
            {info.guardWait.travel ? <div className="exhint">✈️ القفل مأجّل لحد {info.guardWait.travel}</div> : <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "askTravel" })}>✈️ ولي أمري مسافر</button>}
          </div></div>
        )}
        {info?.needsChoice && !info.basics && <Choice info={info} busy={busy} call={call} />}
        {info && !info.basics && !info.needsChoice && info.needsBuild && info.mode === "slow" && <SlowBuild info={info} busy={busy} call={call} />}
        {info && !info.basics && !info.needsChoice && info.needsBuild && info.mode !== "slow" && <Build info={info} busy={busy} call={call} />}
        {info && info.mode !== "general" && info.mode !== "slow" && info.schedule && !info.needsBuild && <MyHoliday info={info} busy={busy} call={call} />}
        {info && info.mode === "general" && !info.repick && <MyTimes info={info} busy={busy} call={call} />}
        {info && !info.needsChoice && !info.needsBuild && !info.items.length && <div className="empty">{info.mode === "general" ? "مواعيدك لسه ما نزلت." : "ماكو امتحانات بعد لفصولك."}</div>}
        {info?.notice && <div className="card warn exerr">{info.notice}</div>}
        {info?.attendCode && <AttendCode code={info.attendCode} ipad={!!info.ipad} />}
        {info && info.ipad !== null && info.ipad !== undefined && <IpadChoice on={info.ipad} busy={busy} call={call} />}
        {info && !!info.items.length && <List info={info} busy={busy} enter={enter} paper={(id) => void openPaper(id)} file={(name) => call({ action: "lectureFile", name })} off={(ids) => call({ action: "holidayOff", holidays: ids })} cmd={call} />}
        {info?.comp && <CompCard c={info.comp} busy={busy} call={call} />}
        {info && !!info.optional.length && <Optional info={info} busy={busy} enter={enterOptional} />}
      </div>
    </>
  );
}

/** جدول التعويض: شنو يختار الطالب. phase2 يوم يبدي الفصل الجاي (منه يخف)، light: بدا وما بقى غير الخفيف */
type CatchPlan = { phase2: string | null; light: boolean; maxHeavy: number; maxLight: number; week: { d: number; name: string }[];
  center: { name: string; days: { d: number; name: string; times: { t: string; label: string }[] }[] } | null };
/** الآيباد: الشاشة عريضة (أصغر جهة 600 أو أكثر)، والتلفون ضيق */
const isTablet = () => { try { return Math.min(window.screen.width, window.screen.height) >= 600; } catch { return false; } };
/** «يوم بين يوم»: نفس فحص البوت، حتى يبين الغلط قبل ما يدوس */
function daysErr(days: number[], per: number) {
  if (days.length !== per) return `اختار ${per === 1 ? "يوم واحد" : `${per} أيام`}`;
  const pairs = days.filter((d) => days.includes((d + 1) % 7)).length;
  if (pairs > Math.max(0, per - 3)) return per >= 4 ? "ما يصير أكثر من يومين ورا بعض مرة وحدة" : "خلي يوم بين يوم، لا تختار يومين ورا بعض";
  return "";
}
function DaysPick({ title, max, per, setPer, days, setDays, week }: { title: string; max: number; per: number; setPer: (n: number) => void; days: number[]; setDays: (d: number[]) => void; week: { d: number; name: string }[] }) {
  const err = daysErr(days, per);
  return (
    <div className="expad">
      <b>{title}</b>
      <label>كم امتحان بالأسبوع؟</label>
      <select value={per} onChange={(e) => { setPer(Number(e.target.value)); setDays([]); }}>{Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "امتحان واحد" : n === 2 ? "امتحانين" : `${n} امتحانات`}</option>)}</select>
      <label>بيا أيام؟</label>
      <div className="exline">{week.map((w) => (
        <label key={w.d} className="chk"><input type="checkbox" checked={days.includes(w.d)} disabled={!days.includes(w.d) && days.length >= per}
          onChange={(e) => setDays(e.target.checked ? [...days, w.d] : days.filter((x) => x !== w.d))} /> {w.name}</label>
      ))}</div>
      {err && <div className="exhint exbad">{err}</div>}
    </div>
  );
}
function CatchupAsk({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const cp = info.catchPlan!;
  const hours = info.catchHours ?? [];
  const [mode, setMode] = useState<"online" | "ipad">("online");
  const [kit, setKit] = useState(false);
  const [hour, setHour] = useState(hours.includes(17) ? 17 : hours[0] ?? 17);
  const [per1, setPer1] = useState(3);
  const [days1, setDays1] = useState<number[]>([]);
  const [per2, setPer2] = useState(2);
  const [days2, setDays2] = useState<number[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const ipad = mode === "ipad" && !!cp.center;
  const week = ipad ? cp.center!.days.map((x) => ({ d: x.d, name: x.name })) : cp.week;
  const heavy = !cp.light, light = !!cp.phase2;
  const chosen = [...new Set([...(heavy ? days1 : []), ...(light ? days2 : [])])];
  const ready = (!heavy || !daysErr(days1, per1)) && (!light || !daysErr(days2, per2)) && (!ipad || (kit && chosen.every((d) => times[String(d)])));
  const pickMode = (m: "online" | "ipad") => { setMode(m); setDays1([]); setDays2([]); setTimes({}); };
  return (
    <div className="card">
      <h2>📅 جدول تعويضك</h2>
      <div className="hmlink">
        <div>هاي الامتحانات فاتتك، فنرتبلك جدول تعويض بالأيام اللي تختارها. امتحاناتك ويا جماعتك تبقى مثل ما هي، ويوم امتحانك ويا جماعتك وأيام العطل ما ينحط بيها تعويض:</div>
        <ul className="hmsteps">{info.late.map((e) => <li key={e.title}>{e.title}</li>)}</ul>
        {cp.center && (
          <div className="expad">
            <b>وين تمتحن؟</b>
            <label className="chk"><input type="radio" checked={mode === "online"} onChange={() => pickMode("online")} /> 💻 إلكتروني من البيت</label>
            <label className="chk"><input type="radio" checked={mode === "ipad"} onChange={() => pickMode("ipad")} /> 🏫 حضوري بـ{cp.center.name} بالآيباد</label>
            {ipad && <>
              <div className="exhint">بالمركز ما تنطبعلك أسئلة: تحل على آيبادك بالقلم. من يسجلون حضورك تنفتح أسئلتك بالآيباد بس، مو بالتلفون.</div>
              <label className="chk"><input type="checkbox" checked={kit} onChange={(e) => setKit(e.target.checked)} /> ✅ عندي آيباد وقلم، وإنترنت شغال وياي بالمركز</label>
            </>}
          </div>
        )}
        {heavy && <DaysPick title={cp.phase2 ? `لحد ${prettyDay(cp.phase2)} (من يبدون جماعتك الفصل الجاي)` : "أيام تعويضك"} max={cp.maxHeavy} per={per1} setPer={setPer1} days={days1} setDays={setDays1} week={week} />}
        {light && <DaysPick title={heavy ? `من ${prettyDay(cp.phase2!)}: تمشي ويا جماعتك بالفصل الجاي، والتعويض يخف` : "تعويضك ويا الفصل الجديد"} max={cp.maxLight} per={per2} setPer={setPer2} days={days2} setDays={setDays2} week={week} />}
        {ipad ? chosen.map((d) => {
          const day = cp.center!.days.find((x) => x.d === d);
          return day ? (
            <div key={d}><label>وقت يوم {day.name}</label>
              <select value={times[String(d)] ?? ""} onChange={(e) => setTimes({ ...times, [String(d)]: e.target.value })}><option value="">اختار</option>{day.times.map((t) => <option key={t.t} value={t.t}>{t.label}</option>)}</select></div>
          ) : null;
        }) : <>
          <label>الساعة اللي تناسبك</label>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>{hours.map((h) => <option key={h} value={h}>{ampm(`${String(h).padStart(2, "0")}:00`)}</option>)}</select>
        </>}
        <div className="exhint exbad">الامتحان اللي يفوتك وما تدخله ينحسب غياب وصفر، ويدخل بحساب السيطرة، ويوصل خبر لولي أمرك.</div>
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => void call({ action: "lateCatchup", mode: ipad ? "ipad" : "online", kit, hour, times, per1, days1, per2, days2 })}>📅 سويلي جدول التعويض</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void call({ action: "latePrivate" })}>👤 لا، أريد كل امتحاناتي جدول خاص بأيامي</button>
      </div>
    </div>
  );
}

/** اشترى متأخر وبعض مواعيد مجموعته فاتت */
function LateAsk({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  // الفصل صار تعويضي: جدول تعويض بالأيام اللي يختارها، وما يبقى خيار «تنحسب فايتة»
  if (info.catchup && info.catchPlan) return <CatchupAsk info={info} busy={busy} call={call} />;
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
              {d.times.map((x) => <button type="button" key={x.t} disabled={x.full && picks[String(d.d)] !== x.t} className={picks[String(d.d)] === x.t ? "on" : ""} onClick={() => { haptic(); setSeen(null); setPicks({ ...picks, [String(d.d)]: x.t }); }}>{x.label}{x.full ? " · مكتمل" : ""}</button>)}
            </div>
          </div>
        ))}
        {!seen && <button type="button" className="btn agbtn adtop" disabled={busy || !ready} onClick={async () => { const r = await call({ action: "placePreview", picks }); if (r?.placePreview) setSeen(r.placePreview); }}>شوف جدولي</button>}
        {seen && (
          <>
            {seen.items.length ? <table className="extable adtop"><tbody>{seen.items.map((i) => <tr key={i.title + i.at} className={i.locked ? "mxlocked" : ""}><td>{i.locked ? "🔒 " : ""}{i.title}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table> : <div className="hint adtop">المواعيد لسه ما نزلت.</div>}
            {seen.waiting > 0 && !!seen.items.length && <div className="hint adtop">و{seen.waiting} امتحان موعده ينزل بعدين.</div>}
            <div className="rgalert adtop">بعد التثبيت تگدر تغير وقت أي يوم بنفسك، إذا بيه مكان، وبشرط امتحانك الجاي بذاك اليوم بعده أكثر من 24 ساعة.</div>
            <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void call({ action: "joinPlace", picks })}>✅ ثبت أوقاتي</button>
          </>
        )}
      </div>
    </div>
  );
}

/** أول مرة: ويا الطلاب بمواعيد المكان، لو جدول خاص */
function Choice({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const [way, setWay] = useState<"" | "general" | "private" | "slow">(info.days.length || info.slowOk ? "" : "private");
  if (way === "slow") {
    return (
      <>
        <button type="button" className="exbtn adtop" onClick={() => setWay("")}>⬅️ رجوع</button>
        <SlowBuild info={info} busy={busy} call={call} />
      </>
    );
  }
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
        {!!info.days.length && <button type="button" className="btn" onClick={() => { haptic(); setWay("general"); }}>👥 تريد تمشي ويا الطلاب (جدول عام)</button>}
        {!!info.days.length && <div className="hint">أيام ثابتة ويا الطلاب، وتختار الوقت اللي يناسبك بكل يوم.</div>}
        <button type="button" className="btn ghost" onClick={() => { haptic(); setWay("private"); }}>👤 تريد تمشي وحدك (جدول خاص)</button>
        <div className="hint">إنت ترتب امتحاناتك: كم امتحان بالأسبوع، وأيامك ووقت كل يوم، وتحذف الامتحانات اللي مو إجبارية.</div>
        {info.slowOk && <button type="button" className="btn ghost" onClick={() => { haptic(); setWay("slow"); }}>🐢 جدول بطيء (لطلاب الخامس)</button>}
        {info.slowOk && <div className="hint">إنت تحط تاريخ ووقت كل امتحان بإيدك، على راحتك.</div>}
      </div>
    </div>
  );
}

/** 🐢 الجدول البطيء (طلاب الخامس): يحط تاريخ ووقت كل امتحان بإيده، بالترتيب */
function slowTimes(info: Info, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const wd = (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
  return info.inPerson ? (info.days.find((x) => x.d === wd)?.times.filter((x) => !x.full).map((x) => x.t) ?? []) : info.hours.map((h) => `${String(h).padStart(2, "0")}:00`);
}
function SlowBuild({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const list = info.toPlan ?? [];
  const [at, setAt] = useState<Record<number, { d: string; t: string }>>({});
  const [every, setEvery] = useState("7");
  const [from, setFrom] = useState("");
  const set = (e: number, x: Partial<{ d: string; t: string }>) => setAt((o) => ({ ...o, [e]: { ...(o[e] ?? { d: "", t: "" }), ...x } }));
  // يملي الكل: امتحان كل كم يوم من تاريخ يختاره، وبعدها يغير اللي يريده
  const fill = () => {
    if (!from) return;
    const out: Record<number, { d: string; t: string }> = {};
    list.forEach((x, i) => { const d = addDays(from, i * Number(every)); out[x.exam] = { d, t: slowTimes(info, d)[0] ?? "" }; });
    setAt(out);
  };
  const ready = list.every((x) => at[x.exam]?.d && at[x.exam]?.t);
  return (
    <div className="card">
      <h2>🐢 جدولك البطيء</h2>
      <div className="form">
        <div className="hint">حط تاريخ ووقت كل امتحان بإيدك. لازم بالترتيب، من باچر وطالع، ومو بيوم عطلة.</div>
        <div className="exline">
          <span>املأها: امتحان كل</span>
          <select value={every} onChange={(e) => setEvery(e.target.value)}>{["3", "5", "7", "10", "14"].map((n) => <option key={n} value={n}>{n} أيام</option>)}</select>
          <span>من</span>
          <DateInput label="أول امتحان" min={info.minStart} value={from} onChange={setFrom} />
          <button type="button" className="exbtn" disabled={!from} onClick={fill}>📅 املأ</button>
        </div>
        <table className="extable adtop"><tbody>
          {list.map((x) => {
            const v = at[x.exam] ?? { d: "", t: "" }, times = slowTimes(info, v.d);
            return (
              <tr key={x.exam}><td><b>{x.title}</b><small className="pdmode">{x.chapter}</small>
                <div className="exline">
                  <DateInput label={`تاريخ ${x.title}`} min={info.minStart} value={v.d} onChange={(d) => set(x.exam, { d, t: slowTimes(info, d).includes(v.t) ? v.t : "" })} />
                  <select aria-label={`وقت ${x.title}`} value={v.t} disabled={!v.d} onChange={(e) => set(x.exam, { t: e.target.value })}>
                    <option value="">{v.d && !times.length ? "ماكو وقت بهذا اليوم" : "الوقت"}</option>
                    {times.map((t) => <option key={t} value={t}>{ampm(t)}</option>)}
                  </select>
                </div>
              </td></tr>
            );
          })}
        </tbody></table>
        <button type="button" className="btn agbtn adtop" disabled={busy || !ready} onClick={() => void call({ action: "slowSave", items: list.map((x) => ({ exam: x.exam, at: `${at[x.exam].d} ${at[x.exam].t}` })) })}>✅ ثبت جدولي</button>
        <div className="hint">بعد التثبيت تگدر تغير موعد أي امتحان، قبل 24 ساعة منه.</div>
      </div>
    </div>
  );
}
/** يغير تاريخ ووقت امتحان من جدوله البطيء، قبل 24 ساعة منه */
function SlowMove({ info, item, busy, cmd }: { info: Info; item: Item; busy: boolean; cmd: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState("");
  const [t, setT] = useState("");
  if (!open) return <button type="button" className="exbtn adtop" onClick={() => setOpen(true)}>📅 غير الموعد</button>;
  const times = slowTimes(info, d);
  return (
    <div className="hint adtop">الموعد الجديد:
      <div className="exline">
        <DateInput label="التاريخ الجديد" min={info.minStart} value={d} onChange={(x) => { setD(x); setT(""); }} />
        <select aria-label="الوقت الجديد" value={t} disabled={!d} onChange={(e) => setT(e.target.value)}>
          <option value="">الوقت</option>
          {times.map((x) => <option key={x} value={x}>{ampm(x)}</option>)}
        </select>
      </div>
      <div className="exline">
        <button type="button" className="exbtn" disabled={busy || !d || !t} onClick={() => void cmd({ action: "slowMove", item: item.id, at: `${d} ${t}` }).then((r) => { if (r) { setOpen(false); setD(""); setT(""); } })}>💾 احفظ</button>
        <button type="button" className="exbtn" onClick={() => setOpen(false)}>رجوع</button>
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

type Pace = { n: number; nAll: number; chapters: string[]; later: string[]; options: { k: number; end: string; all: string | null }[] };
const countWord = (k: number) => (k === 1 ? "امتحان واحد" : k === 2 ? "امتحانين" : k <= 10 ? `${k} امتحانات` : `${k} امتحان`);

/** الجدول الخاص بأربع خطوات: تاريخ البداية، جدوله كامل (ويحذف اللي مو إجباري)، كم امتحان بالأسبوع، الأيام والأوقات */
function Build({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const old = info.schedule;
  // الحضوري: أيام مركزه وأوقاته بس. الإلكتروني: أي يوم، ومن ساعات الإدارة
  const center = info.inPerson;
  const allowed = center ? info.days.map((d) => d.d) : info.week.map((w) => w.i).filter((d) => !(info.offDays ?? []).includes(d));
  const nameOf = (d: number) => info.week.find((w) => w.i === d)?.name ?? "";
  const hours = info.hours.map((h) => `${String(h).padStart(2, "0")}:00`);
  const slotsOf = (d: number) => (center ? info.days.find((x) => x.d === d)?.times.map((x) => x.t) ?? [] : hours);
  const slotsPerDay = Math.max(1, Math.min(info.perDay, 3));
  const [step, setStep] = useState(1);
  const [start, setStart] = useState(info.minStart);
  // الامتحانات اللي «يمكن حذفه» وحذفها من هسه
  const [drop, setDrop] = useState<number[]>([]);
  const [pace, setPace] = useState<Pace | null>(null);
  // كم امتحان بالأسبوع
  const [k, setK] = useState(0);
  const [days, setDays] = useState<number[]>((old?.weekdays ?? []).filter((d) => allowed.includes(d)));
  // كل يوم إله وقته: الطالب يگدر يمتحن الأحد ب8 والثلاثاء ب4
  const [perDay, setPerDayTimes] = useState<Record<string, string[]>>(() => old?.times ?? (old ? Object.fromEntries((old.weekdays ?? []).map((d) => [String(d), [`${String(old.hour).padStart(2, "0")}:00`]])) : {}));
  const [shown, setShown] = useState<Preview | null>(null);
  // عطلته: تبدي بعطلة نصف السنة مال الإدارة (أو اللي اختارها قبل)، ويغيرها أو يحذفها
  const adminHol = info.holiday ? { from: info.holiday.start, to: addDays(info.holiday.start, info.holiday.days - 1) } : { from: "", to: "" };
  const [holFrom, setHolFrom] = useState(old?.hol ? old.hol.from : adminHol.from);
  const [holTo, setHolTo] = useState(old?.hol ? old.hol.to : adminHol.to);
  const timesOf = (d: number) => (perDay[String(d)] ?? []).filter(Boolean);
  const ordered = [...days].sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  const times = Object.fromEntries(days.map((d) => [String(d), timesOf(d)]));
  const total = days.reduce((t, d) => t + timesOf(d).length, 0);
  const form = { start, weekdays: days, times, holFrom, holTo, drop, pack: true };
  // تغيير البداية أو العطلة أو الحذف يغير حساب «شوكت تخلص»، فينحسب من جديد
  const base = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPace(null); setShown(null); };
  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setShown(null); };
  const holOk = (!holFrom && !holTo) || (!!holFrom && !!holTo && holTo >= holFrom);
  const list = info.toPlan ?? [];
  const left = list.filter((x) => !drop.includes(x.exam)).length;
  const chosen = pace?.options.find((o) => o.k === k);
  async function toPace() {
    const r = await call({ action: "pace", start, holFrom, holTo, drop });
    if (!r?.pace) return;
    setPace(r.pace);
    // اللي كان مرتب جدوله قبل يبقى على عدده إذا بعده من الاختيارات
    if (!r.pace.options.some((o) => o.k === k)) setK(r.pace.options.some((o) => o.k === total) ? total : 0);
    setStep(3);
  }
  // اختيار وقت الامتحان رقم n يمسح اللي بعده إذا صار قبله
  const pick = (l: string[], n: number, t: string) => { const out = l.slice(0, n); if (t) out[n] = t; return out; };
  const Picks = ({ list: l, options, set }: { list: string[]; options: string[]; set: (l: string[]) => void }) => (
    <>
      {Array.from({ length: slotsPerDay }, (_, n) => n).filter((n) => n === 0 || (l[n - 1] && options.some((t) => t > l[n - 1]))).map((n) => (
        <div key={n}>
          <label>{n === 0 ? "وقت الامتحان" : `وقت امتحان ${["", "ثاني", "ثالث"][n]} بنفس اليوم (إذا تريد)`}</label>
          <select value={l[n] ?? ""} onChange={(e) => change(set)(pick(l, n, e.target.value))}>
            <option value="">{n === 0 ? "اختار الوقت" : "ما أريد"}</option>
            {options.filter((t) => n === 0 || t > l[n - 1]).map((t) => <option key={t} value={t}>{ampm(t)}</option>)}
          </select>
        </div>
      ))}
    </>
  );
  const Back = ({ to }: { to: number }) => <button type="button" className="exbtn" onClick={() => { haptic(); setShown(null); setStep(to); }}>⬅️ رجوع</button>;
  return (
    <div className="card">
      <h2>🗓 {old ? "رتب جدولك من جديد" : "رتب جدول امتحاناتك"}</h2>
      <div className="form">
        <div className="pcsteps">{[1, 2, 3, 4].map((n) => <span key={n} className={n === step ? "on" : n < step ? "done" : ""}>{n}</span>)}</div>

        {step === 1 && (
          <>
            <div className="warn locked"><b>الخطوة 1: شوكت تبدي؟</b>{old && <> اشتريت فصل جديد، فنرتب امتحاناتك الباقية من جديد.</>}</div>
            <label>تبدي من تاريخ</label>
            <DateInput label="تبدي من تاريخ" min={info.minStart} value={start} onChange={base(setStart)} />
            <label>🏖 عطلتك: من</label>
            <DateInput label="عطلتك من" value={holFrom} placeholder="بدون عطلة" onChange={base(setHolFrom)} />
            <label>إلى</label>
            <DateInput label="عطلتك إلى" min={holFrom} value={holTo} placeholder="بدون عطلة" onChange={base(setHolTo)} />
            {holFrom && holTo && holTo < holFrom && <div className="hint exbad">«إلى» لازم يكون بعد «من».</div>}
            {(!!holFrom || !!holTo) && (!holFrom || !holTo) && <div className="hint exbad">اختار «من» و«إلى» هم.</div>}
            <div className="hint">{holFrom && holTo ? "أيام عطلتك ما بيها امتحانات. " : "ما عندك عطلة: الامتحانات تمشي بدون توقف. "}
              {(holFrom || holTo)
                ? <button type="button" className="exbtn" onClick={() => { base(setHolFrom)(""); setHolTo(""); }}>بدون عطلة</button>
                : info.holiday ? <button type="button" className="exbtn" onClick={() => { base(setHolFrom)(adminHol.from); setHolTo(adminHol.to); }}>رجّع عطلة نصف السنة</button> : null}
            </div>
            <button type="button" className="btn agbtn adtop" disabled={!start || !holOk} onClick={() => { haptic(); setStep(2); }}>التالي: شوف جدولك كامل</button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="warn locked"><b>الخطوة 2: هذا جدولك كامل.</b> عندك <b>{countWord(left)}</b>.{list.some((x) => x.skip) && <> الامتحان المكتوب جنبه «مو إجباري» تگدر تحذفه من جدولك.</>}</div>
            <table className="extable"><tbody>
              {list.map((x, n) => {
                const gone = drop.includes(x.exam);
                return (
                  <Fragment key={x.exam}>
                    {(n === 0 || list[n - 1].chapter !== x.chapter) && <tr className="lcrow"><td colSpan={2}><b>📚 {x.chapter}</b></td></tr>}
                    <tr className={gone ? "mxlocked" : ""}>
                      <td>{gone ? <s>{x.title}</s> : x.title}{x.skip && <span className="pctag">{gone ? "🗑 محذوف" : "مو إجباري"}</span>}</td>
                      <td className="p">{x.skip && (gone
                        ? <button type="button" className="exbtn" onClick={() => base(setDrop)(drop.filter((y) => y !== x.exam))}>↩️ رجعه</button>
                        : <button type="button" className="exbtn" onClick={() => base(setDrop)([...new Set([...drop, x.exam])])}>🗑 احذفه</button>)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody></table>
            <div className="atrow adtop">
              <Back to={1} />
              <button type="button" className="btn agbtn" disabled={busy || !left} onClick={() => void toPace()}>{busy ? "جاري الحساب..." : "التالي: كم امتحان بالأسبوع؟"}</button>
            </div>
          </>
        )}

        {step === 3 && pace && (
          <>
            <div className="warn locked"><b>الخطوة 3: كم امتحان تريد بالأسبوع؟</b> كل اختيار مكتوب جواه شوكت تخلص.</div>
            {!pace.options.length && <div className="hint exbad">ماكو أيام تكفي للامتحانات. راجع الإدارة.</div>}
            {pace.options.map((o) => (
              <button type="button" key={o.k} className={`pcopt ${k === o.k ? "on" : ""}`} onClick={() => { haptic(); change(setK)(o.k); }}>
                <b>{k === o.k ? "✅ " : ""}{countWord(o.k)} بالأسبوع</b>
                <span>تخلص {pace.chapters.join(" و")} تقريباً يوم <b>{prettyDay(o.end)}</b></span>
                {o.all && <span>وإذا كملت هيج واشتريت {pace.later.join(" و")}، تخلص المنهج كله تقريباً يوم <b>{prettyDay(o.all)}</b></span>}
              </button>
            ))}
            <div className="atrow adtop">
              <Back to={2} />
              <button type="button" className="btn agbtn" disabled={!chosen} onClick={() => { haptic(); setStep(4); }}>التالي: الأيام والأوقات</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="warn locked"><b>الخطوة 4: اختار أيامك ووقت كل يوم.</b> اخترت {countWord(k)} بالأسبوع، فلازم تختار <b>{k}</b> أوقات بالأسبوع. اخترت <b>{total}</b> من <b>{k}</b>.{info.perDay > 1 && <> تگدر تخلي امتحانين بنفس اليوم.</>}</div>
            <label>أيام الامتحان بالأسبوع{center ? " (أيام مركزك)" : ""}</label>
            <div className="seg wrap2">
              {allowed.map((d) => (
                <button type="button" key={d} className={days.includes(d) ? "on" : ""} onClick={() => { haptic(); change(setDays)(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]); }}>{nameOf(d)}</button>
              ))}
              {/* اليوم اللي حجبته الإدارة يطلع مطفي، حتى الطالب يعرف ليش */}
              {!center && info.week.filter((w) => (info.offDays ?? []).includes(w.i)).map((w) => <button type="button" key={w.i} disabled style={{ opacity: 0.45 }}>🚫 {w.name}</button>)}
            </div>
            {!center && !!(info.offDays ?? []).length && <div className="hint">🚫 {info.week.filter((w) => (info.offDays ?? []).includes(w.i)).map((w) => w.name).join("، ")}: لا يوجد امتحانات في هذا اليوم.</div>}
            {ordered.map((d) => (
              <div key={d} className="adsale">
                <b>📅 يوم {nameOf(d)}</b>
                <Picks list={perDay[String(d)] ?? []} options={slotsOf(d)} set={(l) => setPerDayTimes({ ...perDay, [String(d)]: l })} />
              </div>
            ))}
            {info.perDay > 1 && <div className="hint">الامتحان الثاني بنفس اليوم لازم يكون بعد نهاية الأول بـ {info.gap} دقيقة على الأقل.</div>}
            {total > k && <div className="hint exbad">اخترت {total} أوقات، وإنت تريد {countWord(k)} بالأسبوع. احذف يوم أو وقت، أو ارجع وغير العدد.</div>}
            {total < k && total > 0 && <div className="hint">باقي {k - total}: اختار يوم ثاني، أو وقت ثاني بنفس اليوم.</div>}
            {!shown && (
              <div className="atrow adtop">
                <Back to={3} />
                <button type="button" className="btn agbtn" disabled={busy || total !== k || days.some((d) => !timesOf(d).length)} onClick={async () => { const r = await call({ action: "preview", ...form }); if (r?.preview) setShown(r.preview); }}>{busy ? "جاري الحساب..." : "شوف جدولي"}</button>
              </div>
            )}
            {shown && (
              <>
                <div className="warn locked adtop">📊 {countWord(shown.items.length)}، {countWord(k)} بالأسبوع. آخر امتحان يوم <b>{prettyDay(shown.items[shown.items.length - 1].at.slice(0, 10))}</b>.</div>
                <table className="extable"><tbody>{shown.items.map((i) => <tr key={i.title + i.at}><td>{i.title}{i.skip && <span className="pctag">مو إجباري</span>}</td><td className="adphone">{prettyAt(i.at)}</td></tr>)}</tbody></table>
                <div className="rgalert adtop">⚠️ بعد التثبيت، تگدر تغير وقت أي امتحان لحد اليوم اللي قبله (🕐 غير الوقت). غير هذا يكون عن طريق الإدارة.</div>
                <div className="atrow adtop">
                  <Back to={3} />
                  <button type="button" className="btn agbtn" disabled={busy} onClick={() => void call({ action: "confirm", ...form })}>✅ ثبت جدولي</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** طالب «ويا الطلاب» يغير وقت يوم من أيامه بنفسه: كل امتحاناته الجاية بذاك اليوم تمشي على الوقت الجديد.
 *  الوقت المكتمل ما ينختار، وإذا امتحانه الجاي بذاك اليوم بعده أقل من 24 ساعة يرفض */
function MyTimes({ info, busy, call }: { info: Info; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const [day, setDay] = useState<number | null>(null);
  const [t, setT] = useState("");
  const picks = info.picks ?? {};
  if (!info.days.length || info.viewOnly) return null;
  return (
    <div className="card">
      <h2>🕐 أوقاتي</h2>
      <div className="exhint expad">تگدر تغير وقت أي يوم بنفسك، إذا بيه مكان، وبشرط امتحانك الجاي بذاك اليوم بعده أكثر من 24 ساعة.</div>
      <table className="extable"><tbody>
        {info.days.map((d) => (
          <tr key={d.d}>
            <td><b>{d.name}</b> {picks[String(d.d)] ? ampm(picks[String(d.d)]) : "—"}
              {day === d.d && (
                <div className="hint adtop">الوقت الجديد:
                  <div className="seg wrap2">
                    {d.times.filter((x) => x.t !== picks[String(d.d)]).map((x) => <button type="button" key={x.t} disabled={x.full} className={t === x.t ? "on" : ""} onClick={() => setT(x.t)}>{x.label}{x.full ? " · مكتمل" : ""}</button>)}
                  </div>
                  <div className="exline">
                    <button type="button" className="exbtn" disabled={busy || !t} onClick={() => void call({ action: "movePick", d: d.d, time: t }).then((r) => { if (r) { setDay(null); setT(""); } })}>💾 احفظ</button>
                    <button type="button" className="exbtn" onClick={() => { setDay(null); setT(""); }}>رجوع</button>
                  </div>
                </div>
              )}
            </td>
            <td className="p">{day !== d.d && d.times.length > 1 && <button type="button" className="exbtn" onClick={() => { setDay(d.d); setT(""); }}>🕐 غير</button>}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

/** طالب الجدول الخاص يغير وقت امتحان بنفس يومه، قبل 24 ساعة منه */
function MoveTime({ info, item, busy, cmd }: { info: Info; item: Item; busy: boolean; cmd: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState("");
  const day = String(item.at).slice(0, 10), cur = String(item.at).slice(11, 16);
  const wd = (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
  const options = (info.inPerson ? info.days.find((x) => x.d === wd)?.times.filter((x) => !x.full).map((x) => x.t) ?? [] : info.hours.map((h) => `${String(h).padStart(2, "0")}:00`)).filter((x) => x !== cur);
  if (!options.length) return null;
  if (!open) return <button type="button" className="exbtn adtop" onClick={() => setOpen(true)}>🕐 غير الوقت</button>;
  return (
    <div className="hint adtop">نفس اليوم ({prettyDay(day)})، بس بوقت ثاني:
      <select value={t} onChange={(e) => setT(e.target.value)}>
        <option value="">اختار الوقت</option>
        {options.map((x) => <option key={x} value={x}>{ampm(x)}</option>)}
      </select>
      <div className="exline">
        <button type="button" className="exbtn" disabled={busy || !t} onClick={() => void cmd({ action: "moveTime", item: item.id, time: t }).then((r) => { if (r) { setOpen(false); setT(""); } })}>💾 احفظ الوقت</button>
        <button type="button" className="exbtn" onClick={() => setOpen(false)}>رجوع</button>
      </div>
    </div>
  );
}

/** عطلة بالجدول. الطالب الخاص يگدر يلغيها فيتقدم جدوله */
function HolRow({ h, busy, off, keep }: { h: Hol; busy: boolean; off: (ids: number[]) => Promise<unknown>; keep: (ids: number[]) => Promise<unknown> }) {
  return (
    <tr className="lcrow mxholrow">
      <td>🏖 <b>عطلة{h.reason ? `: ${h.reason}` : ""}</b><small className="pdmode">{h.from === h.to ? prettyDay(h.from) : `من ${prettyDay(h.from)} إلى ${prettyDay(h.to)}`}{h.title ? ` · قبل ${h.title}` : ""}</small>
        {h.cancel && <div className="hint">تريد العطلة؟ 🗑 يحذفها ويصعد جدولك.</div>}
        {h.kept && <small className="pdmode">✅ خليتها</small>}
      </td>
      <td className="p">
        {h.cancel && <>
          <button type="button" className="exbtn" disabled={busy} onClick={() => void keep(h.ids)}>✅ خليها</button>
          <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void off(h.ids)}>🗑 احذفها</button>
        </>}
      </td>
    </tr>
  );
}

/** كود الحضور للطالب الحضوري: يطلعه للمساعد بالمركز، فينسجل حضوره وتنطبع ورقته */
/** الحضوري يختار يمتحن بالآيباد: الحساب كله لازم يكون على الآيباد (جهاز واحد) */
function IpadChoice({ on, busy, call }: { on: boolean; busy: boolean; call: (b: Record<string, unknown>) => Promise<Info | null> }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="card expad">
      <div className="exlabel">📱 تمتحن بالآيباد؟</div>
      {on ? (
        <>
          <div className="exhint atok">✅ إنت تمتحن بالآيباد. بالمركز ما تنطبعلك ورقة، ومن يسجلون حضورك تنفتح أسئلتك بالآيباد وحدها، وتجاوب بالقلم.</div>
          <button type="button" className="exbtn adtop" disabled={busy} onClick={() => void call({ action: "ipadExam", on: false })}>📄 رجعني أمتحن بالورقة</button>
        </>
      ) : sure ? (
        <>
          <div className="exhint exbad">⚠️ حسابك يشتغل على جهاز واحد بس. إذا تمتحن بالآيباد، لازم تفتح البوت كله من الآيباد (مو من الموبايل)، وتجيبه وياك للمركز مشحون.</div>
          <div className="exline adtop">
            <button type="button" className="btn" disabled={busy} onClick={() => void call({ action: "ipadExam", on: true })}>✅ إي، أمتحن بالآيباد</button>
            <button type="button" className="exbtn" onClick={() => setSure(false)}>رجوع</button>
          </div>
        </>
      ) : (
        <>
          <div className="exhint">إذا تجيب آيباد وياك للمركز، تگدر تجاوب بالقلم عليه بدال الورقة. الأسئلة تنفتح بس من يسجلون حضورك بالمركز.</div>
          <button type="button" className="exbtn adtop" disabled={busy} onClick={() => setSure(true)}>📱 أمتحن بالآيباد</button>
        </>
      )}
    </div>
  );
}

function AttendCode({ code, ipad = false }: { code: string; ipad?: boolean }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(code, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setSrc); }, [code]);
  return (
    <div className="card">
      <h2>🎫 كود الحضور</h2>
      <div className="expad atcode">
        {src && <img src={src} alt="كود الحضور" />}
        <div className="exhint">{ipad ? "طلّع هذا الكود للمساعد بالمركز قبل الامتحان. من ينسجل حضورك تنفتح أسئلتك بالآيباد وحدها." : "طلّع هذا الكود للمساعد بالمركز قبل الامتحان. ينسجل حضورك وتنطبع ورقتك باسمك."} سوّيله سكرين شوت حتى يكون عندك حتى بدون انترنت.</div>
      </div>
    </div>
  );
}

function List({ info, busy, enter, paper, file, off, cmd }: { info: Info; busy: boolean; enter: (id: number) => void; paper: (id: number) => void; file: (name: string) => Promise<unknown>; off: (ids: number[]) => Promise<unknown>; cmd: (b: Record<string, unknown>) => Promise<unknown> }) {
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
                <div className="hint adtop">هذا الامتحان مو إجباري. تگدر تحذفه من جدولك، فيصعد جدولك:
                  <div className="exline"><button type="button" className="exbtn" disabled={busy} onClick={() => void cmd({ action: "keepExam", item: i.id })}>✅ خليه</button><button type="button" className="exbtn" disabled={busy} onClick={() => void cmd({ action: "skipExam", item: i.id })}>🗑 احذفه</button></div>
                </div>
              )}
              {info.mode === "private" && !i.optional && i.status === "waiting" && String(i.at).slice(0, 10) > info.today && <MoveTime info={info} item={i} busy={busy} cmd={cmd} />}
              {info.mode === "slow" && !i.optional && !i.catchup && i.status === "waiting" && String(i.at).slice(0, 10) > info.today && <SlowMove info={info} item={i} busy={busy} cmd={cmd} />}
              {i.state === "done" && <button type="button" className="exbtn adtop" disabled={busy} onClick={() => paper(i.id)}>📂 ورقتي وتصحيحها</button>}
            </td>
            <td className="adphone">{prettyAt(i.at)}</td>
          </tr>
          </Fragment>
        ))}
        {holLast.map((h) => <HolRow key={h.id} h={h} busy={busy} off={off} keep={(ids) => cmd({ action: "holidayKeep", holidays: ids })} />)}
      </tbody></table>
      {!info.inPerson && <div className="expad exhint adtop">تگدر تدخل الامتحان خلال {info.window} دقيقة من موعده. الامتحان اللي يفوت وقته ما يرجع.</div>}
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

const fileUrl = (item: number, ref: string) => `/api/myexams/file?t=${encodeURIComponent(new URLSearchParams(location.search).get("t") ?? "")}&item=${item}&ref=${encodeURIComponent(ref)}&pf=${encodeURIComponent(platformNow())}&d=${encodeURIComponent(deviceNow())}`;
const minutesLeft = (closeAt: string, nowAt: string, since: number) => {
  const end = new Date(closeAt.replace(" ", "T") + ":00Z").getTime(), start = new Date(nowAt.replace(" ", "T") + ":00Z").getTime();
  return Math.ceil((end - start - (Date.now() - since)) / 60000);
};
function ExamRoom({ room, setRoom, call, leave }: { room: Room; setRoom: (r: Room) => void; call: (b: Record<string, unknown>) => Promise<Info | null>; leave: () => void }) {
  const [since] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<{ q: number; file: File; url: string; turns: number } | null>(null);
  const [scan, setScan] = useState(scanDefault);
  // صور كثيرة مرة وحدة (أو صفحات PDF): كل وحدة تطلع للمعاينة وتندز، وبعدها اللي وراها
  const [more, setMore] = useState<File[]>([]);
  async function pickPhoto(q: number, files: File[]) {
    const [f, ...rest] = files;
    setMore(rest);
    if (f) setDraft({ q, file: f, url: await previewUrl(f, scan), turns: 0 }); else setDraft(null);
    // الصورة تطلع بمربع سؤالها، فننزل لهناك حتى يشوفها بمكانها
    if (f) requestAnimationFrame(() => document.getElementById(`exq-${q}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
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
  // الآيباد (شاشة عريضة): السؤال مكتوب فوك ورقة القلم، فما نطلع صفحات الأسئلة، وورقة القلم تنفتح وحدها بعد القسم
  const [wide, setWide] = useState(false);
  useEffect(() => { setWide(window.innerWidth >= 700); }, []);
  const autoPen = useRef(false);
  useEffect(() => {
    if (!wide || !room.sworn || autoPen.current) return;
    autoPen.current = true;
    setPen(room.questions.find((q) => !q.answers.length)?.n ?? room.questions[0]?.n ?? 1);
  }, [wide, room.sworn]); // eslint-disable-line react-hooks/exhaustive-deps
  useLeaveWatch(room.id, room.sworn && !closed);
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
  // زر التسليم بس بعد ما يجاوب كل الأسئلة (أو K بـ«أجب عن K»)، حتى ما يدوسه بالغلط بنص الامتحان
  const answered = room.questions.filter((q) => q.answers.length).length;
  const need = room.answerOnly ? Math.min(room.answerOnly, room.questions.length) : room.questions.length;
  if (closed) {
    return (
      <div className="wrap"><div className="card warn exerr">{total ? "انتهى الوقت، وأجوبتك اللي دزيتها انحفظت." : "⛔ انتهى وقت الامتحان المحدد، وأعطيناك وقت إضافي، ولم ترسل الإجابة."}</div>
        <button type="button" className="btn agbtn" onClick={leave}>رجوع لامتحاناتي</button></div>
    );
  }
  // ✏️ الكتابة بالقلم: صفحة وحدة لكل الأسئلة، تنفتح على السؤال اللي داسه
  if (pen !== null && room.sworn) {
    return (
      <>
        {error && <div className="wrap"><div className="err">⚠️ {error}</div></div>}
        <PenPage item={room.id} sid={room.sid} model={room.model} head={room.head} start={pen} busy={busy} left={left} answered={answered} need={need}
          questions={room.questions.map((q) => ({ n: q.n, img: q.img ? fileUrl(room.id, q.img) : null, done: q.answers.length > 0 }))}
          timer={<b className={"pen-time" + (left <= 10 ? " low" : "")} role="timer">⏳ {Math.max(0, left)} دقيقة</b>}
          onSend={async (list) => { for (const x of list) if (!await upload(x.n, x.file)) return false; return true; }}
          onSubmit={async () => { setBusy(true); const r = await call({ action: "submitExam", item: room.id }); setBusy(false); if (r) leave(); }}
          onClose={() => setPen(null)} />
      </>
    );
  }
  return (
    <div className="wrap">
      <ExamTimer left={left} minutes={room.minutes} extra={room.extra} />
      <div className="card"><h2>📝 {room.title}</h2></div>
      {/* طلب الأستاذ 2026-11-17: أول ما ينفتح الامتحان نبلغه إن الطلعة من الصفحة تنحسب غش */}
      <div className="card"><div className="exhint exbad">⚠️ ما يصير تطلع من صفحة الامتحان لأي صفحة أو تطبيق ثاني (غير الكاميرا والاستوديو لصور جوابك). ما دام إنت بالامتحان، أي طلعة من الصفحة تنحسب محاولة غش عليك، ويوصل خبر بوقتها لأستاذك ولولي أمرك وللمراقب.</div></div>
      {/* رقم الطالب فوك كل صفحة: إذا أحد صورها ونشرها نعرف منو */}
      {!room.sworn ? (
        <TileOath key={room.id} sentence={room.oath} busy={busy}
          onDone={async (text) => { setBusy(true); const r = await call({ action: "oath", item: room.id, text }); setBusy(false); if (r?.room) setRoom(r.room); }} />
      ) : (
      <>
      {!wide && room.pages.map((p) => <div key={p} className="exidwrap"><span className="exid">🆔 {room.sid}</span><img className="eximg" src={fileUrl(room.id, p)} alt="أسئلة الامتحان" /></div>)}
      <div className="card"><h2>📷 صور جواب كل سؤال</h2>
        {!!room.answerOnly && <AnswerOnlyNote k={room.answerOnly} n={room.questions.length} done={room.questions.filter((q) => q.answers.length).length} />}
        <div className="expad">
          <button type="button" className="btn agbtn" disabled={busy} onClick={() => setPen(room.questions.find((q) => !q.answers.length)?.n ?? room.questions[0]?.n ?? 1)}>✏️ جاوب بالقلم على الآيباد (كل الأسئلة)</button>
          <div className="exhint">تنفتح ورقة لكل سؤال، وفوگ أرقام الأسئلة. كل ما تخلص ورقة دوس «✅ تم» ويصير رقمها أخضر، وبالأخير «📤 أرسل الأجوبة» مرة وحدة.</div>
        </div>
        <div className="form">
          {/* كل سؤال بمربع وحده: عنوانه فوك، وصوره وأزراره جوه بس، وبين سؤال وسؤال خط فاصل.
              حتى الطالب يعرف الصورة لأي سؤال راحت */}
          {room.questions.map((q, qi) => (
            <Fragment key={q.n}>
              {qi > 0 && <div className="exqsep" aria-hidden="true" />}
              <section id={`exq-${q.n}`} className={"exqblk" + (q.answers.length ? " done" : "") + (draft?.q === q.n ? " now" : "")}>
                <div className="exqtitle"><b>السؤال {q.n}</b><span>{q.answers.length ? `✅ ${q.answers.length === 1 ? "صورة وحدة" : `${q.answers.length} صور`}` : "بعده ما جاوبته"}</span></div>
                <div className="exqin">
                  {q.answers.map((a, ai) => (
                    <div key={a.id}><div className="exqtag">📷 صورة {ai + 1} · السؤال {q.n}</div><img className="eximg" src={fileUrl(room.id, a.file)} alt={`جواب ${q.n}`} /><button type="button" className="exbtn" disabled={busy} onClick={async () => { setBusy(true); const r = await call({ action: "delAnswer", item: room.id, answer: a.id }); if (r?.room) setRoom(r.room); setBusy(false); }}>🗑 احذف هاي الصورة</button></div>
                  ))}
                  {draft?.q === q.n ? (
                    <div>
                      <div className="exqtag now">📌 هاي الصورة الجديدة راح تنحفظ لـ «السؤال {q.n}»</div>
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
                      <div className="exhint">✅ جوابك انحفظ. تگدر تغيره لحد ما تسلم الامتحان: {hasPenDraft(room.id, q.n) ? "دوس «✏️ عدل كتابتك»، أو احذف الصورة وجاوب من جديد" : "احذف الصورة وصور غيرها"}.</div>
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
              </section>
            </Fragment>
          ))}
          {error && <div className="err">⚠️ {error}</div>}
          {answered >= need
            ? <SubmitExam busy={busy} onYes={async () => { setBusy(true); const r = await call({ action: "submitExam", item: room.id }); setBusy(false); if (r) leave(); }} />
            : <div className="exhint adtop">📤 زر «سلّم الامتحان» يطلع بعد ما تجاوب {room.answerOnly ? `${need} أسئلة` : "كل الأسئلة"}. باقي {need - answered}. إذا ما تعرف سؤال، ورقتك تتسلم وحدها من يخلص الوقت.</div>}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

/** زر التسليم: دستين حتى ما ينداس بالغلط */
function SubmitExam({ busy, onYes }: { busy: boolean; onYes: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask
    ? <div className="exline adtop"><button type="button" className="btn agbtn" disabled={busy} onClick={onYes}>✅ إي، سلّم الامتحان</button><button type="button" className="exbtn" onClick={() => setAsk(false)}>لا، رجوع</button></div>
    : <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => setAsk(true)}>📤 سلّم الامتحان</button>;
}

type TgEvents = { onEvent?(e: string, f: () => void): void; offEvent?(e: string, f: () => void): void };
/**
 * الطالب طلع من صفحة الامتحان وهو يمتحن (تطبيق ثاني، أو صغّر التليجرام): خبر للسيرفر، والسيرفر يبلغه ويبلغ الأستاذ وولي أمره.
 * الكاميرا وقائمة الصور ما تنحسب خروج. الرجوع ينكتب ويا المدة
 */
function useLeaveWatch(item: number, on: boolean) {
  useEffect(() => {
    if (!on) return;
    let away = 0, dev = "", pf = "";
    void deviceId().then((d) => { dev = d; }).catch(() => undefined);
    void platform().then((p) => { pf = p; }).catch(() => undefined);
    const token = new URLSearchParams(location.search).get("t") ?? "";
    const tell = (phase: "left" | "back", secs = 0) => {
      try {
        void fetch("/api/myexams", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "examLeft", item, phase, secs, device: dev, pf }) }).catch(() => undefined);
      } catch { /* بدون اتصال */ }
    };
    const gone = () => { if (away || pickingNow()) return; away = Date.now(); tell("left"); };
    const back = () => {
      setTimeout(donePicking, 1500);
      if (!away) return;
      const secs = Math.round((Date.now() - away) / 1000); away = 0; tell("back", secs);
    };
    const vis = () => (document.visibilityState === "hidden" ? gone() : back());
    document.addEventListener("visibilitychange", vis);
    const w = (window as unknown as { Telegram?: { WebApp?: TgEvents } }).Telegram?.WebApp;
    try { w?.onEvent?.("deactivated", gone); w?.onEvent?.("activated", back); } catch { /* نسخة قديمة */ }
    return () => {
      document.removeEventListener("visibilitychange", vis);
      try { w?.offEvent?.("deactivated", gone); w?.offEvent?.("activated", back); } catch { /* نسخة قديمة */ }
    };
  }, [item, on]);
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
