"use client";
import { useState } from "react";
import {
  AR_NAME_ERR, CURR_OPTS, Err, type Errs, PhoneInput, SIDE_OPTS, Seg, cleanName, cleanPhone, nameOk, phoneErr, scrollToFirst, sendToBot, useBotData,
} from "../shared";
import RegFlow, { type RegData } from "./RegFlow";

type Area = [number, string, string, [number, string][]];
type Data = {
  g: string[]; m: string[]; a: Area[]; adm?: number;
  p?: { n?: string; cu?: string; gr?: string; g?: string; s?: string; a?: string; p1?: string; p2?: string; e?: string; c?: number };
  x?: { gr?: string; e?: string; c?: string };
  tk?: string;
};
const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس العلمي" }, { v: "الخامس العلمي", label: "الخامس العلمي" }];
const EXAM_OPTS = [{ v: "حضوري", label: "🏫 حضوري" }, { v: "إلكتروني", label: "💻 إلكتروني" }];

export default function RegClient() {
  const D = useBotData<Data>({ g: [], m: [], a: [] });
  if (!D) return null;
  // الرمز يوصل بس للطالب الجديد. تعديل المعلومات وفورمة الإدارة تبقى مثل ما هي
  return D.tk ? <RegFlow D={D as RegData} /> : <Reg D={D} />;
}

function Reg({ D }: { D: Data }) {
  const ADM = D.adm || 0;
  const P = D.p;
  const examLocked = !ADM && !!D.x?.e;
  const gradeLocked = !ADM && !!D.x?.gr;
  const modeOf = (g: string) => (ADM ? "both" : D.m[D.g.indexOf(g)] || "online");
  const fixedExam = (g: string) => { const m = modeOf(g); return m === "online" ? "إلكتروني" : m === "in" ? "حضوري" : ""; };
  const adminArea = ADM && P?.e === "حضوري" && P.c ? D.a.find((a) => a[3].some((c) => c[0] === P.c)) : undefined;

  const [name, setName] = useState(P?.n ?? "");
  const [curr, setCurr] = useState(P?.cu ?? "");
  const [grade, setGrade] = useState(gradeLocked ? D.x!.gr! : P?.gr ?? "");
  const [gov, setGov] = useState(P?.g ?? "");
  const [side, setSide] = useState(P?.s ?? "");
  const [area, setArea] = useState(P?.a ?? "");
  const [ph1, setPh1] = useState(P?.p1 ?? "");
  const [ph2, setPh2] = useState(P?.p2 ?? "");
  const [exam, setExam] = useState(() => (examLocked || !P?.g ? "" : fixedExam(P.g) || (ADM ? P.e ?? "" : "")));
  const [carea, setCarea] = useState(adminArea ? adminArea[0] : 0);
  const [center, setCenter] = useState(adminArea ? P!.c! : 0);
  const [errs, setErrs] = useState<Errs>({});
  const clearErr = (k: string) => setErrs((e) => ({ ...e, [k]: "" }));

  const mode = modeOf(gov);
  const inGov = D.a.filter((x) => x[1] === gov);
  const areas = inGov.length ? inGov : D.a;
  const centers = D.a.find((x) => x[0] === carea)?.[3] ?? [];

  function onGov(g: string) {
    setGov(g);
    clearErr("gov");
    if (g !== "بغداد") setSide("");
    if (examLocked) return;
    setExam(fixedExam(g));
    setCarea(0);
    setCenter(0);
  }
  function save() {
    const e: Errs = {};
    const n = cleanName(name);
    if (!nameOk(n)) e.name = AR_NAME_ERR;
    if (!curr) e.curr = "اختر المنهج";
    if (!grade) e.grade = "اختر صفك بالمدرسة";
    if (!gov) e.gov = "اختر المحافظة";
    if (gov === "بغداد" && !side) e.side = "اختر الرصافة أو الكرخ";
    if (area.trim().length < 3) e.area = "اكتب العنوان بالتفصيل";
    const p1 = cleanPhone(ph1), p2 = cleanPhone(ph2);
    const a = phoneErr(p1), b = phoneErr(p2);
    if (a) e.ph1 = a;
    if (b) e.ph2 = b; else if (p1 === p2) e.ph2 = "الرقم الثاني لازم يختلف عن الأول";
    if (!examLocked && gov) {
      if (!exam) e.exam = "اختر نوع الامتحان";
      else if (exam === "حضوري" && D.a.length) {
        if (!carea) e.carea = "اختر منطقة المركز";
        else if (!center) e.center = "اختر المركز الامتحاني";
      }
    }
    setErrs(e);
    if (scrollToFirst(e)) return;
    sendToBot({ k: "reg", n, cu: curr, gr: grade, g: gov, s: side, a: area.trim(), p1, p2, adm: ADM,
      e: examLocked ? "" : exam, c: !examLocked && exam === "حضوري" ? center : 0 });
  }

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>{ADM ? "تعديل معلومات طالب · الإدارة" : P ? "تعديل معلوماتك" : "التسجيل · مرة وحدة بس"}</p>
      </header>

      <div className="wrap">
        <div className="card">
          <h2>👤 معلومات الطالب</h2>
          <div className="form">
            <label>الاسم الرباعي</label>
            <input placeholder="بالعربي، مثال: علي حسن محمد كاظم" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <Err id="name" errs={errs} />

            <label>المنهج</label>
            <Seg options={CURR_OPTS} value={curr} onPick={(v) => { setCurr(v); clearErr("curr"); }} />
            <Err id="curr" errs={errs} />

            <label>إنت هذه السنة طالب بالمدرسة بأي صف؟</label>
            {gradeLocked ? (
              <div className="lock">🎓 صفك بالمدرسة: <b>{D.x!.gr}</b> 🔒<small>لتغييره تواصل ويا قصي العميري.</small></div>
            ) : (
              <>
                <div className="hint">اختار صفك الحقيقي بالمدرسة، حتى لو تدرس ويانا مادة السادس.</div>
                <Seg options={GRADE_OPTS} value={grade} onPick={(v) => { setGrade(v); clearErr("grade"); }} />
                <Err id="grade" errs={errs} />
              </>
            )}
          </div>
        </div>

        <div className="card">
          <h2>📍 السكن والهاتف</h2>
          <div className="form">
            <label>المحافظة</label>
            <select value={gov} onChange={(e) => onGov(e.target.value)}>
              <option value="">اختر المحافظة</option>
              {D.g.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <Err id="gov" errs={errs} />

            <div className={gov === "بغداد" ? "" : "hide"}>
              <label>الجانب</label>
              <Seg options={SIDE_OPTS} value={side} onPick={(v) => { setSide(v); clearErr("side"); }} />
              <Err id="side" errs={errs} />
            </div>

            <label>العنوان بالتفصيل</label>
            <input placeholder="المنطقة، المحلة، أقرب نقطة دالة" autoComplete="off" value={area} onChange={(e) => setArea(e.target.value)} />
            <Err id="area" errs={errs} />

            <label>رقم الهاتف الأول (بالأرقام الإنجليزية)</label>
            <PhoneInput id="ph1" value={ph1} onChange={setPh1} errs={errs} setErrs={setErrs} />

            <label>رقم الهاتف الثاني (بالأرقام الإنجليزية)</label>
            <PhoneInput id="ph2" value={ph2} onChange={setPh2} errs={errs} setErrs={setErrs} />
          </div>
        </div>

        <div className={"card" + (examLocked || gov ? "" : " hide")}>
          <h2>📝 الامتحانات</h2>
          <div className="form">
            {examLocked ? (
              <div className="lock">
                {D.x!.e === "حضوري" ? "🏫" : "💻"} نوع الامتحان: <b>{D.x!.e}</b> 🔒
                {D.x!.c && <><br />🏫 المركز: <b>{D.x!.c}</b></>}
                <small>لتغييرهم تواصل ويا قصي العميري.</small>
              </div>
            ) : (
              <>
                {mode === "both" ? (
                  <div>
                    <label>نوع الامتحان</label>
                    <Seg options={EXAM_OPTS} value={exam} onPick={(v) => { setExam(v); clearErr("exam"); }} />
                    <Err id="exam" errs={errs} />
                  </div>
                ) : (
                  <div className="lock">{mode === "online" ? <>💻 امتحاناتك: <b>إلكترونية</b></> : <>🏫 امتحاناتك: <b>حضورية</b></>}</div>
                )}
                {exam === "حضوري" && (
                  <div>
                    <label>منطقة المركز الامتحاني</label>
                    <Seg wrap value={String(carea)} options={areas.map((a) => ({ v: String(a[0]), label: `📍 ${a[2]}${a[1] !== gov ? ` (${a[1]})` : ""}` }))}
                      onPick={(v) => { setCarea(Number(v)); setCenter(0); clearErr("carea"); }} />
                    <Err id="carea" errs={errs} />
                    {!!carea && (
                      <div>
                        <label>المركز الامتحاني</label>
                        <Seg wrap value={String(center)} options={centers.map((c) => ({ v: String(c[0]), label: `🏫 ${c[1]}` }))}
                          onPick={(v) => { setCenter(Number(v)); clearErr("center"); }} />
                        <Err id="center" errs={errs} />
                      </div>
                    )}
                  </div>
                )}
                {!ADM && <div className="note" style={{ margin: "14px 0 0" }}>⚠️ بعد الحفظ <b>ما تگدر تغير معلوماتك</b> إلا عن طريق الإدارة، فاكتبها صح.</div>}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bar"><div className="in">
        <div className="sum"><small>راجع معلوماتك قبل الحفظ</small></div>
        <button type="button" className="btn" onClick={save}>✅ حفظ معلوماتي</button>
      </div></div>
    </>
  );
}
