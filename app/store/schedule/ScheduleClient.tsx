"use client";
// إعدادات جدول الامتحانات: كل المدد بيد الإدارة
import { Fragment, useState } from "react";
import { AdminHeader, Confirm, StatusBar, useAdminApi } from "../adminPage";
import { addDays, ampm, flattenDays, groupSlots, prettyDay, spreadVersions } from "../../../lib/scheduleRules.ts";

/** اسم اليوم تحت خانة التاريخ، لأن الخانة تبين الأرقام بس */
const DayName = ({ d }: { d: string }) => (d ? <small className="exhint">📅 {prettyDay(d)}</small> : null);

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Slot = { d: number; t: string };
type Row = { exam: number; chapter: string; title: string; date: string; inserted?: number; hols?: { id: number; from: string; reason: string }[]; versions: Record<string, number>; models: { id: number; model: string }[] };
type Data = { cronUrl: string; optionalOpen: boolean; gallery: boolean; window: number; extra: number; excWindow: number; perDay: number; gap: number; holidayStart: string; holidayDays: number; fromHour: number; toHour: number; offDays: number[]; excluded: string[]; places: { id: number; name: string }[]; center: number; slots: Slot[]; students: number; rows: Row[]; canLoad: boolean; canLoadDates: boolean; week: { i: number; name: string }[]; schedules: number; notice: string; holidays: Hol[] };
type Hol = { id: number; title: string; days: number; reason: string; places: string[]; students: number };
type Act = (b: Record<string, unknown>) => Promise<Data | null>;

export default function ScheduleClient() {
  const { data, error, busy, call } = useAdminApi<Data>("/api/schedule", "🗓 جدول الامتحانات");
  const act: Act = (b) => call({ center: data?.center ?? 0, ...b });
  return (
    <>
      <AdminHeader title="🗓 إعدادات جدول الامتحانات" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && <Place d={data} busy={busy} act={act} />}
        {data && <Form key={JSON.stringify([data.optionalOpen, data.gallery, data.window, data.extra, data.excWindow, data.perDay, data.gap, data.holidayStart, data.holidayDays, data.fromHour, data.toHour, data.offDays, data.excluded])} d={data} busy={busy} save={(b) => void act({ action: "save", ...b })} />}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} notice={data?.notice} />
    </>
  );
}

function Form({ d, busy, save }: { d: Data; busy: boolean; save: (b: Record<string, unknown>) => void }) {
  const [window, setWindow] = useState(String(d.window));
  const [extra, setExtra] = useState(String(d.extra));
  const [excWindow, setExcWindow] = useState(String(d.excWindow));
  const [optionalOpen, setOptionalOpen] = useState(d.optionalOpen);
  const [gallery, setGallery] = useState(d.gallery);
  const [perDay, setPerDay] = useState(String(d.perDay));
  const [gap, setGap] = useState(String(d.gap));
  const [holidayStart, setHolidayStart] = useState(d.holidayStart);
  // العطلة من تاريخ إلى تاريخ، والبوت يحسب الأيام
  const [holidayEnd, setHolidayEnd] = useState(d.holidayStart && d.holidayDays > 0 ? addDays(d.holidayStart, d.holidayDays - 1) : "");
  const holidayDays = holidayStart && holidayEnd >= holidayStart ? Math.round((Date.parse(holidayEnd) - Date.parse(holidayStart)) / 86400000) + 1 : 0;
  const [offDays, setOffDays] = useState<number[]>(d.offDays ?? []);
  const [fromHour, setFromHour] = useState(d.fromHour);
  const [toHour, setToHour] = useState(d.toHour);
  return (
    <div className="card">
      <h2>🗓 الجداول المثبتة: {d.schedules}</h2>
      <div className="form">
        <label>وقت الدخول بعد بداية الامتحان (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={window} onChange={(e) => setWindow(e.target.value)} />
        <label>وقت إضافي للطالب الإلكتروني فوق وقت الامتحان (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <label>وقت الدخول بعد ما تفتح امتحان باستثناء (دقيقة)</label>
        <input className="ltr" inputMode="numeric" value={excWindow} onChange={(e) => setExcWindow(e.target.value)} />
        <label className="adcheck adflat"><input type="checkbox" checked={optionalOpen} onChange={(e) => setOptionalOpen(e.target.checked)} /><span>الامتحانات الاختيارية مفتوحة للطلاب</span></label>
        <label className="adcheck adflat"><input type="checkbox" checked={gallery} onChange={(e) => setGallery(e.target.checked)} /><span>🖼 الطالب يگدر يختار صورة جوابه من الاستوديو (إذا مطفي: الكاميرا بس)</span></label>
        <label>أكثر عدد امتحانات باليوم بالجدول الخاص</label>
        <input className="ltr" inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        <label>أقل فاصل بين امتحانين بنفس اليوم بالجدول الخاص (دقيقة)</label>
        <div className="exhint">الطالب الخاص يختار وقت الامتحان الثاني بنفسه، بس ما يگدر يحطه أقرب من نهاية الأول وهذا الفاصل.</div>
        <input className="ltr" inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value)} />
        <label>عطلة نصف السنة: من</label>
        <input type="date" className="ltr" value={holidayStart} onChange={(e) => setHolidayStart(e.target.value)} />
        <DayName d={holidayStart} />
        <label>إلى</label>
        <input type="date" className="ltr" min={holidayStart} value={holidayEnd} onChange={(e) => setHolidayEnd(e.target.value)} />
        <DayName d={holidayEnd} />
        {holidayStart && holidayEnd && holidayEnd < holidayStart && <div className="exbad">«إلى» لازم يكون بعد «من».</div>}
        {holidayDays > 0 && <div className="exhint">العطلة {holidayDays} يوم.</div>}
        <label>أيام ما يمتحن بيها الطالب الخاص الإلكتروني</label>
        <div className="chips adflat">
          {d.week.map((w) => <button type="button" key={w.i} className={offDays.includes(w.i) ? "on" : ""} onClick={() => setOffDays(offDays.includes(w.i) ? offDays.filter((x) => x !== w.i) : [...offDays, w.i])}>{offDays.includes(w.i) ? "🚫 " : ""}{w.name}</button>)}
        </div>
        <div className="exhint">اليوم اللي تأشره ما يطلع للطالب الخاص الإلكتروني أبداً لمن يرتب جدوله. الحضوري يمشي على أيام مركزه.</div>
        <label>الطالب الخاص الإلكتروني يمتحن من الساعة</label>
        <select aria-label="أول ساعة" value={fromHour} onChange={(e) => setFromHour(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{ampm(hh(h))}</option>)}</select>
        <label>إلى الساعة</label>
        <select aria-label="آخر ساعة" value={toHour} onChange={(e) => setToHour(Number(e.target.value))}>{HOURS.filter((h) => h >= fromHour).map((h) => <option key={h} value={h}>{ampm(hh(h))}</option>)}</select>
        <div className="exhint">هاي الساعات بس تطلعله يختار منها وقت امتحانه. الطالب الخاص الحضوري يختار من أوقات مركزه، وطلاب «ويا الطلاب» من أوقات مكانهم.</div>
        <div className="exhint">⚠️ إذا غيرت العطلة أو الأيام المستثناة، جداول الطلاب تنعاد من باجر، وكل طالب يوصله الخبر.</div>
        {d.cronUrl && <CronBox url={d.cronUrl} />}
        <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => save({ window, extra, excWindow, optionalOpen, gallery, perDay, gap, holidayStart, holidayDays, offDays, fromHour, toHour: Math.max(fromHour, toHour) })}>حفظ</button>
      </div>
    </div>
  );
}

function CronBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="exfoot">
      <div className="exlabel">⏰ المؤقت</div>
      <div className="exhint">يصحي البوت كل دقيقة حتى يدز: رسالة «بدأ الامتحان»، وحساب السيطرة، ورسالة «وصلتك أوراق» للمصحح، وتقرير الحضور لمدير المركز.</div>
      <ol className="adsteps">
        <li>انسخ الرابط من الزر جوة. هذا الرابط سري، لا تدزه لأحد.</li>
        <li>افتح موقع <code>cron-job.org</code> وسوي حساب مجاني.</li>
        <li>اضغط <code>CREATE CRONJOB</code>، وحط الرابط، واختار كل دقيقة، واحفظ.</li>
      </ol>
      <button type="button" className="exbtn" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? "✅ انتسخ" : "📋 انسخ الرابط"}</button>
    </div>
  );
}

function Place({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  return (
    <div className="card">
      <h2>👥 الجدول العام (ويا الطلاب)</h2>
      <div className="form">
        {d.canLoad && <button type="button" className="btn agbtn" disabled={busy} onClick={() => void act({ action: "loadPlaces" })}>📥 أدخل أوقات الأماكن والعطلة</button>}
        {d.canLoadDates && <Confirm label="📥 أدخل تواريخ كل الامتحانات" disabled={busy || d.canLoad} onYes={() => void act({ action: "loadOldDates" })} />}
        <label>المكان</label>
        <select value={d.center} disabled={busy} onChange={(e) => void act({ action: "list", center: Number(e.target.value) })}>
          {d.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="exhint">{d.students} طالب ويا الطلاب بهذا المكان. كل طالب يختار وقت لكل يوم بكيفه.</div>
        <Slots key={`${d.center}|${JSON.stringify(d.slots)}`} d={d} busy={busy} act={act} />
        <Dates key={`${d.center}|${JSON.stringify(d.rows)}|${JSON.stringify(d.slots)}`} d={d} busy={busy} act={act} />
        <Holidays d={d} busy={busy} act={act} />
      </div>
    </div>
  );
}

function Slots({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  const [days, setDays] = useState(() => groupSlots(d.slots, d.week.map((w) => w.i)));
  const nameOf = (i: number) => d.week.find((w) => w.i === i)?.name ?? "";
  const free = d.week.filter((w) => !days.some((x) => x.d === w.i));
  const setTimes = (day: number, times: string[]) => setDays(days.map((x) => (x.d === day ? { ...x, times } : x)));
  // اليوم الجديد ياخذ نفس أوقات آخر يوم، وتگدر تغيرها
  const addDay = (day: number) => {
    const order = d.week.map((w) => w.i);
    const times = days.at(-1)?.times ?? ["16:00"];
    setDays([...days, { d: day, times: [...times] }].sort((x, y) => order.indexOf(x.d) - order.indexOf(y.d)));
  };
  return (
    <div className="exfoot">
      <div className="exlabel">⏰ الأيام وأوقاتها</div>
      <div className="exhint">كل هذا جدول واحد لهذا المكان. ضيف الأيام، وتحت كل يوم ضيف أوقاته. الطالب يختار وقت واحد لكل يوم.</div>
      {days.map((x) => (
        <div className="adsale" key={x.d}>
          <div className="exline">
            <b style={{ flex: 1 }}>📅 {nameOf(x.d)}</b>
            <button type="button" className="exbtn" aria-label={`احذف ${nameOf(x.d)}`} onClick={() => setDays(days.filter((y) => y.d !== x.d))}>🗑 احذف اليوم</button>
          </div>
          {x.times.map((t, i) => (
            <div className="exadd" key={i} style={{ flexWrap: "nowrap", alignItems: "center" }}>
              <input type="time" className="ltr" style={{ flex: 1, minWidth: 0 }} aria-label={`وقت ${nameOf(x.d)}`} value={t} onChange={(e) => setTimes(x.d, x.times.map((y, j) => (j === i ? e.target.value : y)))} />
              <button type="button" className="exbtn" aria-label="احذف الوقت" style={{ flex: "none", width: "auto" }} onClick={() => setTimes(x.d, x.times.filter((_, j) => j !== i))}>🗑</button>
            </div>
          ))}
          <button type="button" className="exbtn" onClick={() => setTimes(x.d, [...x.times, x.times.at(-1) ?? "16:00"])}>➕ وقت لهذا اليوم</button>
        </div>
      ))}
      {!days.length && <div className="exhint">بعد ما مضيف أي يوم.</div>}
      <div className="exline adtop">
        {!!free.length && (
          <select aria-label="ضيف يوم" value="" onChange={(e) => { if (e.target.value) addDay(Number(e.target.value)); }}>
            <option value="">➕ ضيف يوم</option>
            {free.map((w) => <option key={w.i} value={w.i}>{w.name}</option>)}
          </select>
        )}
        <button type="button" className="btn" style={{ width: "auto" }} disabled={busy} onClick={() => void act({ action: "saveSlots", slots: flattenDays(days) })}>💾 حفظ الأوقات</button>
      </div>
    </div>
  );
}

function Dates({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  const [rows, setRows] = useState(d.rows);
  const [start, setStart] = useState("");
  const [scope, setScope] = useState<"place" | "all">("place");
  // دسة وحدة: يوم هذا الامتحان يصير فراغ، وهو واللي بعده يزحفون ليوم الامتحان الجاي
  const holiday = (exam: number) => void act({ action: "holidayAdd", exam, days: 1, scope });
  const chapters = [...new Set(rows.map((r) => r.chapter))];
  const set = (exam: number, o: Partial<Row>) => setRows(rows.map((r) => (r.exam === exam ? { ...r, ...o } : r)));
  const timesOf = (date: string) => { if (!date) return []; const w = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7; return d.slots.filter((x) => x.d === w).map((x) => x.t).sort(); };
  // كل امتحان بالفصل ياخذ نسخة غير بكل وقت، ويبدي من نسخة عشوائية حتى ما يتعلمون إن أول وقت دائماً A
  const spread = (chapter: string) => setRows(rows.map((r) => {
    if (r.chapter !== chapter || !r.models.length) return r;
    const ids = r.models.map((m) => m.id);
    return { ...r, versions: { ...r.versions, ...spreadVersions(timesOf(r.date), ids, Math.floor(Math.random() * ids.length)) } };
  }));
  return (
    <div className="exfoot">
      <div className="exlabel">🗓 وزع امتحانات الكتاب بالترتيب من تاريخ</div>
      <div className="exadd">
        <input type="date" className="ltr" aria-label="تاريخ البداية" value={start} onChange={(e) => setStart(e.target.value)} />
        <Confirm label="🗓 وزعها" disabled={busy || !start} onYes={() => void act({ action: "fillDates", start })} />
      </div>
      <DayName d={start} />
      <div className="exhint">كل يوم من أيام المكان ياخذ امتحان، وتتخطى العطلة. بعدها تگدر تغير أي تاريخ.</div>
      <div className="exlabel adtop">🏖 العطلة</div>
      <div className="exhint">دوس «🏖 عطلة قبله» جنب أي امتحان: يومه يصير فراغ، وهو وكل اللي بعده يزحفون ليوم الامتحان الجاي. والفراغ يطلع سطر، وجنبه «🏖 عطلة قبله» إذا تريد فراغ ثاني، و«↩️ شيل» حتى ترجع. احفظ تعديلات التواريخ قبل.</div>
      <div className="seg wrap2">
        <button type="button" className={scope === "place" ? "on" : ""} onClick={() => setScope("place")}>📍 العطلة لهذا المكان بس</button>
        <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>🌍 لكل الأماكن</button>
      </div>
      {scope === "all" && <div className="exhint">بكل مكان العطلة تصير قبل نفس الامتحان، حسب تاريخه بذاك المكان.</div>}
      <div className="exlabel adtop">📄 النسخة بكل وقت</div>
      <div className="exhint">جنب كل امتحان تطلع أوقات يومه، وتختار لكل وقت نسخته. الاختيار يخص هذا الامتحان بس، فطلاب الوقت الأول ما يگدرون يوصلون الأسئلة للي بعدهم. ما ينحفظ إلا تدوس «حفظ المواعيد والنسخ».</div>
      {chapters.map((c) => (
        <div key={c}>
          <div className="adgroup">{c}</div>
          <button type="button" className="exbtn" disabled={busy} onClick={() => spread(c)}>🎲 نسخة غير بكل وقت لكل امتحانات {c}</button>
          {rows.filter((r) => r.chapter === c).map((r) => {
            const times = timesOf(r.date);
            return (
              <Fragment key={r.exam}>
              {(r.hols ?? []).map((h) => (
                <div className="adexamrow" key={h.id} style={{ background: "rgba(249,196,69,.08)" }}>
                  <b>🏖 فراغ · {prettyDay(h.from)}</b> <small className="pdmode">قبل {r.title}</small>
                  <HolReason key={h.reason} id={h.id} reason={h.reason} busy={busy} act={act} />
                  <div className="exline adtop">
                    <button type="button" className="exbtn" disabled={busy} onClick={() => holiday(r.exam)}>🏖 عطلة قبله</button>
                    <Confirm label="↩️ شيل" disabled={busy} onYes={() => void act({ action: "holidayDel", id: h.id })} />
                  </div>
                </div>
              ))}
              <div className="adexamrow">
                <b>{r.title}</b>
                <div className="adexamcells">
                  <div><input type="date" className="ltr" aria-label={`تاريخ ${r.title}`} value={r.date} onChange={(e) => set(r.exam, { date: e.target.value })} /><DayName d={r.date} /></div>
                  {times.map((t) => (
                    <label className="adtimev" key={t}><small>⏰ {ampm(t)}</small>
                      <select aria-label={`نسخة ${r.title} الساعة ${t}`} value={r.versions[t] ?? 0} onChange={(e) => set(r.exam, { versions: { ...r.versions, [t]: Number(e.target.value) } })}>
                        <option value={0}>أول نسخة جاهزة</option>
                        {r.models.map((m) => <option key={m.id} value={m.id}>نسخة {m.model}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                {!r.date && <small className="exhint">حط تاريخه حتى تطلع أوقاته وتختار نسخها.</small>}
                {r.date && (
                  <div className="exline adtop">
                    <button type="button" className="exbtn" disabled={busy} onClick={() => holiday(r.exam)}>🏖 عطلة قبله</button>
                    <AddBefore exam={r.exam} free={rows.filter((x) => !x.date && x.exam !== r.exam)} busy={busy} add={(id) => void act({ action: "insertExam", exam: r.exam, add: id, scope })} />
                    {!!r.inserted && <Confirm label="↩️ شيله من الجدول" disabled={busy} onYes={() => void act({ action: "holidayDel", id: r.inserted })} />}
                  </div>
                )}
                {r.date && !times.length && <small className="exbad">هذا اليوم ما إله أوقات بـ ⏰ الأيام وأوقاتها.</small>}
              </div>
              </Fragment>
            );
          })}
        </div>
      ))}
      <button type="button" className="btn agbtn adtop" disabled={busy} onClick={() => void act({ action: "saveDates", rows: rows.map((r) => ({ exam: r.exam, date: r.date, versions: r.versions })) })}>حفظ المواعيد والنسخ</button>
    </div>
  );
}

/** العطل اللي انحطت، وتگدر تشيلها فترجع المواعيد */
function Holidays({ d, busy, act }: { d: Data; busy: boolean; act: Act }) {
  if (!d.holidays.length) return null;
  return (
    <div className="exfoot">
      <div className="exlabel">🏖 العطل</div>
      <div className="exhint">إذا شلت عطلة، العطل اللي زدتها بعدها لنفس الامتحان تنشال وياها.</div>
      {d.holidays.map((h) => (
        <div key={h.id} className="adsale">
          <div><b>قبل {h.title}</b>{h.reason ? ` · ${h.reason}` : ""}</div>
          <small className="pdmode">{h.places.join("، ")}{h.students ? ` · ${h.students} جدول خاص` : ""}</small>
          <Confirm label="↩️ شيل العطلة" disabled={busy} onYes={() => void act({ action: "holidayDel", id: h.id })} />
        </div>
      ))}
    </div>
  );
}

/** ليش هاي العطلة: تكتبه وتحفظه، ويطلع للطلاب بجدولهم */
function HolReason({ id, reason, busy, act }: { id: number; reason: string; busy: boolean; act: Act }) {
  const [text, setText] = useState(reason);
  return (
    <div className="exadd adtop" style={{ flexWrap: "nowrap", alignItems: "center" }}>
      <input aria-label="سبب العطلة" placeholder="ليش هاي العطلة؟ مثلاً راحة قبل الفاينل" value={text} style={{ flex: 1, minWidth: 0 }} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="exbtn" style={{ flex: "none", width: "auto" }} disabled={busy || text.trim() === reason} onClick={() => void act({ action: "holidayReason", id, reason: text })}>💾</button>
    </div>
  );
}

/** ➕ امتحان قبله: امتحان من البنك ما إله موعد ياخذ يوم هذا الامتحان، وهو واللي بعده يزحفون */
function AddBefore({ exam, free, busy, add }: { exam: number; free: Row[]; busy: boolean; add: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="exbtn" disabled={busy} onClick={() => setOpen(true)}>➕ امتحان قبله</button>;
  if (!free.length) return <small className="exhint">ماكو امتحان بالبنك بلا موعد. ضيفه أول من 📝 الامتحانات ← افتح امتحان ← ➕ امتحان قبله. <button type="button" className="exbtn" onClick={() => setOpen(false)}>تمام</button></small>;
  return (
    <select aria-label={`امتحان قبل ${exam}`} value="" disabled={busy} onChange={(e) => { if (e.target.value) { setOpen(false); add(Number(e.target.value)); } }}>
      <option value="">اختار الامتحان اللي تضيفه</option>
      {free.map((x) => <option key={x.exam} value={x.exam}>{x.chapter}: {x.title}</option>)}
    </select>
  );
}
