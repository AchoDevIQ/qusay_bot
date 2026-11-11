"use client";
// تسجيل الطالب الجديد خطوة خطوة: الشروط وترتيب كلماتها، معلوماته، وبعدها كلمة المرور
import { useEffect, useRef, useState, type ReactNode } from "react";
import FillBlanks from "../FillBlanks";
import { CURR_OPTS, Err, type Errs, PhoneInput, SIDE_OPTS, Seg, cleanPhone, closeApp, haptic, nameOk, phoneErr, scrollToFirst } from "../shared";

type Area = [number, string, string, [number, string, string?][]];
export type RegData = { g: string[]; m: string[]; a: Area[]; tk?: string };
type Term = { id: number; text: string };
type Info = { terms: Term[]; rev: string; registered: boolean };
type Done = { password: string; url?: string; close?: boolean };

const GRADE_OPTS = [{ v: "السادس العلمي", label: "السادس العلمي" }, { v: "الخامس العلمي", label: "الخامس العلمي" }];
const GENDER_OPTS = [{ v: "بنين", label: "👦 بنين" }, { v: "بنات", label: "👧 بنات" }];
const EXAM_OPTS = [{ v: "حضوري", label: "🏫 حضوري" }, { v: "إلكتروني", label: "💻 إلكتروني" }];
// تاريخ الميلاد: قوائم بسيطة، والسنين من 10 لـ 30 سنة للوراء
const DAYS_31 = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const MONTHS_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const YEARS = Array.from({ length: 21 }, (_, i) => String(new Date().getFullYear() - 10 - i));
const validDate = (y: string, m: string, d: string) => { const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))); return t.getUTCMonth() === Number(m) - 1 && t.getUTCDate() === Number(d); };
const NAME_PARTS = [
  { key: "n1", label: "الاسم الأول", hint: "عبد الله" }, { key: "n2", label: "اسم الأب", hint: "مصطفى" },
  { key: "n3", label: "اسم الجد", hint: "علي" }, { key: "n4", label: "الاسم الرابع", hint: "احمد" },
];

async function homeCall<T>(token: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
  } catch { throw new Error("ماكو اتصال، حاول مرة ثانية"); }
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
  return j;
}

function Top({ title, step, total }: { title: string; step: number; total: number }) {
  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1>قصي العميري</h1>
        <p>التسجيل</p>
      </header>
      <div className="rgtop">
        <div className="rgtopline"><b>{title}</b><span dir="ltr">{step} / {total}</span></div>
        <div className="rgtrack"><div className="rgfill" style={{ width: `${(step / total) * 100}%` }} /></div>
      </div>
    </>
  );
}
function Foot({ children }: { children: ReactNode }) {
  return <div className="rgfoot"><div className="rgfootin">{children}</div></div>;
}

export default function RegFlow({ D }: { D: RegData }) {
  const token = D.tk!;
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [step, setStep] = useState(-1);   // التعريف، بعدها الشروط، وبعدها المعلومات والدراسة
  const [agreed, setAgreed] = useState<number[]>([]);
  const [making, setMaking] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [carea, setCarea] = useState(0);
  const [center, setCenter] = useState(0);
  const [errs, setErrs] = useState<Errs>({});
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrs((e) => ({ ...e, [k]: "" })); };

  useEffect(() => {
    homeCall<Info>(token, { action: "regInfo" }).then(setInfo).catch((e: Error) => setLoadErr(e.message));
  }, [token]);

  const page = (n: number) => { setStep(n); window.scrollTo(0, 0); };
  const gov = f.gov ?? "";
  const mode = D.m[D.g.indexOf(gov)] || "online";
  const exam = mode === "online" ? "إلكتروني" : mode === "in" ? "حضوري" : f.exam ?? "";
  // المعاهد اللي بس بنين أو بس بنات ما تطلع للثاني
  const fits = (c: [number, string, string?]) => !c[2] || c[2] === f.sx;
  const allAreas = D.a.filter((x) => x[3].some(fits));
  const inGov = allAreas.filter((x) => x[1] === gov);
  const areas = inGov.length ? inGov : allAreas;
  const centers = (D.a.find((x) => x[0] === carea)?.[3] ?? []).filter(fits);

  if (loadErr) return <div className="rg"><Top title="التسجيل" step={1} total={1} /><div className="rgbody"><div className="rgcard rgbad">⚠️ {loadErr}</div></div></div>;
  if (!info) return <div className="rg"><Top title="التسجيل" step={1} total={1} /><div className="rgbody rgcenter"><div className="rgspin" /></div></div>;
  if (info.registered && !done) return <div className="rg"><Top title="التسجيل" step={1} total={1} /><div className="rgbody"><div className="rgcard">🔒 معلوماتك محفوظة. لتغيير أي معلومة تواصل ويا قصي العميري.</div></div></div>;

  const T = info.terms.length;
  if (done) return <Success done={done} />;
  if (making) {
    return (
      <div className="rg">
        <Top title="إنشاء الحساب" step={3} total={3} />
        <div className="rgbody rgcenter"><div className="rgspin" /><p>جارٍ تجهيز حسابك...</p></div>
      </div>
    );
  }
  if (step < 0) {
    return (
      <div className="rg">
        <Top title="التسجيل" step={1} total={1} />
        <div className="rgbody">
          <div className="rgalert">⚠️ بعد الحفظ ما تگدر تغير معلوماتك إلا عن طريق الإدارة، فاكتبها صح.</div>
        </div>
        <Foot><button type="button" className="rgbtn" onClick={() => page(0)}>ابدأ التسجيل</button></Foot>
      </div>
    );
  }
  if (step < T) {
    const term = info.terms[step];
    return (
      <TermStep key={term.id} term={term} n={step + 1} total={T} last={step === T - 1} agreed={agreed.includes(term.id)}
        onBack={() => page(step - 1)}
        onOk={() => { setAgreed((a) => (a.includes(term.id) ? a : [...a, term.id])); page(step + 1); }} />
    );
  }

  function checkPersonal() {
    const e: Errs = {};
    for (const p of NAME_PARTS) if (!nameOk([f[p.key] ?? "x", "ا", "ا", "ا"].join(" ").trim())) e[p.key] = "اكتب هذا الاسم بالحروف العربية فقط";
    for (const p of NAME_PARTS) if (!(f[p.key] ?? "").trim()) e[p.key] = `اكتب ${p.label}`;
    if (!f.sx) e.sx = "اختار بنين لو بنات";
    if (!f.bd || !f.bm || !f.by) e.birth = "اختار تاريخ ميلادك: اليوم والشهر والسنة";
    else if (!validDate(f.by, f.bm, f.bd)) e.birth = "هذا التاريخ ما موجود، تأكد من اليوم";
    const p1 = cleanPhone(f.p1 ?? ""), p2 = cleanPhone(f.p2 ?? "");
    const a = phoneErr(p1), b = phoneErr(p2);
    if (a) e.p1 = a;
    if (b) e.p2 = b; else if (p1 === p2) e.p2 = "رقم ولي الأمر لازم يختلف عن رقمك";
    if (!gov) e.gov = "اختر المحافظة";
    if (gov === "بغداد" && !f.side) e.side = "اختر الرصافة أو الكرخ";
    if ((f.area ?? "").trim().length < 3) e.area = "اكتب العنوان بالتفصيل";
    setErrs(e);
    if (!scrollToFirst(e)) page(T + 1);
  }
  async function submit() {
    const e: Errs = {};
    if (!f.curr) e.curr = "اختر المنهج";
    if (!f.grade) e.grade = "اختر صفك بالمدرسة";
    if (!exam) e.exam = "اختر نوع الامتحان";
    else if (exam === "حضوري" && allAreas.length) {
      if (!carea) e.carea = "اختر منطقة المركز";
      else if (!center) e.center = "اختر المركز الامتحاني";
    }
    setErrs(e);
    if (scrollToFirst(e)) return;
    setSendErr("");
    setMaking(true);
    window.scrollTo(0, 0);
    const n = NAME_PARTS.map((p) => (f[p.key] ?? "").trim().replace(/\s+/g, " ")).join(" ");
    const form = { n, cu: f.curr, gr: f.grade, g: gov, s: gov === "بغداد" ? f.side : "", a: (f.area ?? "").trim(), p1: cleanPhone(f.p1 ?? ""), p2: cleanPhone(f.p2 ?? ""), e: exam, c: exam === "حضوري" ? center : 0, sx: f.sx, b: `${f.by}-${f.bm}-${f.bd}` };
    try { setDone(await homeCall<Done>(token, { action: "register", rev: info!.rev, form })); }
    catch (err) { setSendErr((err as Error).message); }
    setMaking(false);
  }

  if (step === T) {
    return (
      <div className="rg">
        <Top title="البيانات الأساسية" step={1} total={3} />
        <div className="rgbody rgform">
          <h2 className="rgh">معلوماتك الشخصية</h2>
          <p className="rgsub">مثال: عبد الله مصطفى علي احمد — ضع كل جزء في خانته دون تكرار</p>
          <div className="rgcard">
            {NAME_PARTS.map((p) => (
              <div key={p.key} className="rgrow">
                <label>{p.label} <i>*</i></label>
                <input placeholder={p.hint} autoComplete="off" value={f[p.key] ?? ""} onChange={(e) => set(p.key, e.target.value)} />
                <Err id={p.key} errs={errs} />
              </div>
            ))}
          </div>
          <div className="rgcard">
            <label>بنين لو بنات؟ <i>*</i></label>
            <Seg options={GENDER_OPTS} value={f.sx ?? ""} onPick={(v) => { set("sx", v); setCarea(0); setCenter(0); }} />
            <Err id="sx" errs={errs} />
          </div>
          <div className="rgcard" id="birth">
            <label>تاريخ ميلادك <i>*</i></label>
            <div className="rgbirth">
              <select aria-label="اليوم" value={f.bd ?? ""} onChange={(e) => set("bd", e.target.value)}><option value="">اليوم</option>{DAYS_31.map((d) => <option key={d} value={d}>{Number(d)}</option>)}</select>
              <select aria-label="الشهر" value={f.bm ?? ""} onChange={(e) => set("bm", e.target.value)}><option value="">الشهر</option>{MONTHS_AR.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{i + 1} - {m}</option>)}</select>
              <select aria-label="السنة" value={f.by ?? ""} onChange={(e) => set("by", e.target.value)}><option value="">السنة</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <Err id="birth" errs={errs} />
          </div>
          <div className="rgcard">
            <label>رقم هاتفك <i>*</i></label>
            <PhoneInput id="p1" value={f.p1 ?? ""} onChange={(v) => set("p1", v)} errs={errs} setErrs={setErrs} />
            <label>رقم هاتف ولي الأمر <i>*</i></label>
            <PhoneInput id="p2" value={f.p2 ?? ""} onChange={(v) => set("p2", v)} errs={errs} setErrs={setErrs} />
          </div>
          <div className="rgcard">
            <label>المحافظة <i>*</i></label>
            <select value={gov} onChange={(e) => { setF((x) => ({ ...x, gov: e.target.value, side: "", exam: "" })); setCarea(0); setCenter(0); setErrs((r) => ({ ...r, gov: "" })); }}>
              <option value="">اختر محافظتك</option>
              {D.g.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <Err id="gov" errs={errs} />
            {gov === "بغداد" && (
              <>
                <label>الجانب <i>*</i></label>
                <Seg options={SIDE_OPTS} value={f.side ?? ""} onPick={(v) => set("side", v)} />
                <Err id="side" errs={errs} />
              </>
            )}
            <label>العنوان التفصيلي <i>*</i></label>
            <input placeholder="المنطقة، المحلة، أقرب نقطة دالة" autoComplete="off" value={f.area ?? ""} onChange={(e) => set("area", e.target.value)} />
            <Err id="area" errs={errs} />
          </div>
        </div>
        <Foot>
          <button type="button" className="rgbtn" onClick={checkPersonal}>متابعة</button>
          {T > 0 && <button type="button" className="rgback" onClick={() => page(T - 1)}>رجوع</button>}
        </Foot>
      </div>
    );
  }

  return (
    <div className="rg">
      <Top title="الدراسة والامتحانات" step={2} total={3} />
      <div className="rgbody rgform">
        <h2 className="rgh">دراستك</h2>
        {sendErr && <div className="rgcard rgbad">⚠️ {sendErr}</div>}
        <div className="rgcard">
          <label>المنهج <i>*</i></label>
          <Seg options={CURR_OPTS} value={f.curr ?? ""} onPick={(v) => set("curr", v)} />
          <Err id="curr" errs={errs} />
          <label>إنت هسه بالسادس، لو ناجح للخامس؟ <i>*</i></label>
          <p className="rgsub">صفك الحقيقي بالمدرسة هذه السنة، حتى لو تدرس ويانا مادة السادس.</p>
          <Seg options={GRADE_OPTS} value={f.grade ?? ""} onPick={(v) => set("grade", v)} />
          <Err id="grade" errs={errs} />
        </div>
        <div className="rgcard">
          {mode === "both" ? (
            <>
              <label>نوع الامتحان <i>*</i></label>
              <Seg options={EXAM_OPTS} value={exam} onPick={(v) => { set("exam", v); setCarea(0); setCenter(0); }} />
              <Err id="exam" errs={errs} />
            </>
          ) : <div className="rgnote">{mode === "online" ? "💻 امتحاناتك: إلكترونية" : "🏫 امتحاناتك: حضورية"}</div>}
          {exam === "حضوري" && allAreas.length > 0 && (
            <>
              <label>منطقة المركز الامتحاني <i>*</i></label>
              <Seg wrap value={String(carea)} options={areas.map((a) => ({ v: String(a[0]), label: `📍 ${a[2]}${a[1] !== gov ? ` (${a[1]})` : ""}` }))}
                onPick={(v) => { setCarea(Number(v)); setCenter(0); setErrs((r) => ({ ...r, carea: "" })); }} />
              <Err id="carea" errs={errs} />
              {!!carea && (
                <>
                  <label>المركز الامتحاني <i>*</i></label>
                  <Seg wrap value={String(center)} options={centers.map((c) => ({ v: String(c[0]), label: `🏫 ${c[1]}` }))}
                    onPick={(v) => { setCenter(Number(v)); setErrs((r) => ({ ...r, center: "" })); }} />
                  <Err id="center" errs={errs} />
                </>
              )}
            </>
          )}
        </div>
        <div className="rgnote">⚠️ بعد إنشاء الحساب ما تگدر تغير معلوماتك إلا عن طريق الإدارة، فاكتبها صح.</div>
      </div>
      <Foot>
        <button type="button" className="rgbtn" onClick={() => void submit()}>إنشاء الحساب</button>
        <button type="button" className="rgback" onClick={() => page(T)}>رجوع</button>
      </Foot>
    </div>
  );
}

function TermStep({ term, n, total, last, agreed, onBack, onOk }: { term: Term; n: number; total: number; last: boolean; agreed: boolean; onBack?: () => void; onOk: () => void }) {
  // «املأ الفراغات»: الشرط كامل قدامه، وكم كلمة منه فراغ يختارلها الكلمة الصحيحة. هيچ يقراه كله
  const [done, setDone] = useState(agreed);
  return (
    <div className="rg">
      <Top title="الشروط والأحكام" step={n} total={total} />
      <div className="rgbody">
        <div className="rgcard rgterm">
          {!agreed && <div className="rgask">حتى بعدين لا تقول أنا عبرت الشرط بدون ما أقرأ: اقرا الشرط، ودوس كل فراغ «؟؟؟» واختار الكلمة الصحيحة.</div>}
          <FillBlanks text={term.text} filled={agreed} onDone={setDone} />
        </div>
      </div>
      <Foot>
        <button type="button" className="rgbtn" disabled={!done} onClick={() => { haptic(); onOk(); }}>{!done ? "كمل الفراغات أول" : last ? "أوافق وأنهي" : "أوافق ومتابعة"}</button>
        {onBack && <button type="button" className="rgback" onClick={onBack}>رجوع</button>}
      </Foot>
    </div>
  );
}

function Success({ done }: { done: Done }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(done.password); }
    catch {
      // بعض نسخ تليجرام تمنع الحافظة الحديثة
      const t = document.createElement("textarea");
      t.value = done.password;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    haptic();
    setCopied(true);
  }
  return (
    <div className="rg">
      <Top title="تم إنشاء الحساب" step={3} total={3} />
      <div className="rgbody rgcenter">
        <div className="rgcheck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg></div>
        <h2 className="rgdone">تم إنشاء حسابك بنجاح!</h2>
        <div className="rgcard rgpass">
          <small>كلمة المرور:</small>
          <b dir="ltr">{done.password}</b>
          <button type="button" className="rgcopy" onClick={() => void copy()}>{copied ? "✅ تم النسخ" : "📋 نسخ"}</button>
        </div>
        <div className="rgalert">⚠️ احفظ كلمة المرور هذه في مكان آمن، لأنها لن تظهر مجدداً. تحتاجها حتى تدخل للتطبيق وتشاهد المحاضرات.</div>
      </div>
      <Foot>
        <button type="button" className="rgbtn" onClick={() => { if (done.url) location.href = done.url; else closeApp(); }}>متابعة</button>
      </Foot>
    </div>
  );
}
