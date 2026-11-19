"use client";
// الدرجة بالصوت: المصحح يحچي الدرجة، تنكتب مثل ما داسها، والصفحة تقلب للسؤال اللي بعده.
// مجاني: يستعمل سماع الكلام اللي بالمتصفح نفسه (كروم أو سفاري)، بدون أي خدمة بفلوس.
// داخل تليجرام على الأندرويد ما موجود، فالزر ما يطلع وتطلع جملة تشرح ليش
import { useEffect, useRef, useState } from "react";
import { pickMark } from "../../../lib/spokenMark.ts";
import { pageAuth } from "../adminPage";
import { openOutside } from "../shared";

const ON_KEY = "gradeVoiceMark";
const LANG_KEY = "gradeVoiceLang";
const AR_KEY = "gradeVoiceAr";
const HIDE_KEY = "gradeVoiceNoteHidden";

type Alt = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alt };
type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: Result } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecCtor = new () => Rec;
const ctor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* بدون حفظ */ } };

/** الصفحة داخل تطبيق (تليگرام ومتصفحه الداخلي وغيره)، مو متصفح كروم أو سفاري:
 *  بالأندرويد علامته «wv»، وبالآيفون ماكو كلمة سفاري */
export function inAppView() {
  const ua = navigator.userAgent;
  return (/Android/i.test(ua) && /; wv\)/.test(ua)) || (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua));
}

/** ليش الصوت ما يشتغل بهذا الجهاز، أو "" إذا يشتغل */
function whyNot(): string {
  const tgOf = (w: Window) => (w as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform ?? "";
  let plat = tgOf(window);
  try { if (!plat || plat === "unknown") plat = tgOf(window.parent); } catch { /* */ }
  // داخل تليجرام (أندرويد، آيفون، كمبيوتر): سماع الكلام ما موجود أو يخرب، حتى لو الصفحة تكول موجود
  if (["android", "android_x", "ios", "tdesktop", "macos"].includes(plat)) return "inside";
  if (inAppView()) return "inside";
  if (!ctor()) return "browser";
  return "";
}

export default function VoiceMark({ qn, max, blocked, onMark }: {
  qn: number; max: number; blocked: string; onMark: (m: number) => void;
}) {
  const [why, setWhy] = useState<string | null>(null);   // null: بعده ما فحصنا
  const [on, setOn] = useState(false);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [state, setState] = useState<"off" | "listening" | "paused">("off");
  const [heard, setHeard] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteHidden, setNoteHidden] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState("");
  /** رابط مرة وحدة لنفس الحساب، وينفتح بمتصفح التلفون (مو داخل تليگرام) */
  async function openInBrowser() {
    setOpening(true); setOpenErr("");
    try {
      const res = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: pageAuth(), action: "browserLink" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.code) { setOpenErr(j.error ?? "صار خطأ، حاول مرة ثانية"); return; }
      openOutside(`${location.origin}/store/grade?go=${encodeURIComponent(j.code)}`, true);
    } catch { setOpenErr("ماكو اتصال، حاول مرة ثانية"); } finally { setOpening(false); }
  }
  const rec = useRef<Rec | null>(null);
  const onRef = useRef(false);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fatal = useRef(false);
  // آخر سؤال ودرجته وحالته: الأحداث تجي من المتصفح بعدين، فتقرا من هنا
  const live = useRef({ qn, max, blocked, onMark, lang });
  live.current = { qn, max, blocked, onMark, lang };

  useEffect(() => {
    setWhy(whyNot());
    setLang(read(LANG_KEY) === "en" ? "en" : "ar");
    setNoteHidden(read(HIDE_KEY) === "1");
    if (read(ON_KEY) === "1" && !whyNot()) setOn(true);
    return () => stopRec();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onRef.current = on;
    if (on) { fatal.current = false; startRec(); } else { stopRec(); setState("off"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, lang]);

  // الصفحة راحت للخلفية: يوقف يسمع، ومن ترجع يرجع
  useEffect(() => {
    const vis = () => { if (document.hidden) stopRec(); else if (onRef.current && !fatal.current) { startRec(); } };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRec() {
    if (restart.current) { clearTimeout(restart.current); restart.current = null; }
    const r = rec.current; rec.current = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* */ } }
  }

  function handle(alts: string[]) {
    const { max, blocked, onMark, qn } = live.current;
    const r = pickMark(alts, max);
    if ("error" in r) { setMsg({ ok: false, text: r.kind === "unclear" ? (r.heard ? `سمعت «${r.heard}»: مو رقم، ما انحفظ شي` : r.error) : `سمعت «${r.heard}»: ${r.error}، ما انحفظ` }); return; }
    if (blocked) { setMsg({ ok: false, text: `سمعت ${r.mark}، بس ${blocked}` }); return; }
    setMsg({ ok: true, text: `✅ س${qn}: ${r.mark}` });
    onMark(r.mark);
  }

  function startRec() {
    stopRec();
    const C = ctor(); if (!C) { setWhy("browser"); setOn(false); return; }
    const r = new C();
    const ar = read(AR_KEY) ?? "ar-IQ";
    r.lang = live.current.lang === "en" ? "en-US" : ar;
    // جملة وحدة بكل مرة وبعدها يرجع يسمع: أضمن من السماع المستمر اللي يكرر الكلام بالأندرويد
    r.continuous = false; r.interimResults = true; r.maxAlternatives = 5;
    let got = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alts = Array.from({ length: res.length }, (_, j) => res[j]?.transcript ?? "").filter(Boolean);
        setHeard(alts[0] ?? "");
        if (res.isFinal && !got) { got = true; setHeard(""); handle(alts); }
      }
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "language-not-supported" && r.lang === "ar-IQ") { write(AR_KEY, "ar-SA"); return; }
      if (e.error === "not-allowed") { fatal.current = true; setMsg({ ok: false, text: "ما عندي إذن المايك. اسمح للصفحة تستعمل المايك من إعدادات المتصفح، وبعدها دوس 🎤" }); }
      else if (e.error === "service-not-allowed") { fatal.current = true; setWhy("service"); setOn(false); write(ON_KEY, "0"); }
      else if (e.error === "audio-capture") { fatal.current = true; setMsg({ ok: false, text: "ما لگيت مايك يشتغل. سد أي برنامج ثاني يستعمل المايك ودوس 🎤" }); }
      else if (e.error === "network") setMsg({ ok: false, text: "📶 سماع الكلام يحتاج نت بهذا الجهاز. تأكد من النت" });
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      if (!onRef.current || document.hidden) return;
      if (fatal.current) { setState("paused"); return; }
      // يبقى يسمع على كل التصحيح (كل الأسئلة وكل الأوراق) لحد ما المصحح يطفيه
      restart.current = setTimeout(() => { if (onRef.current) startRec(); }, 250);
    };
    rec.current = r;
    try { r.start(); setState("listening"); } catch { setState("paused"); }
  }

  function toggle() {
    if (on && state === "paused") { fatal.current = false; setMsg(null); startRec(); return; }
    const v = !on; setOn(v); write(ON_KEY, v ? "1" : "0"); setMsg(null); setHeard("");
  }
  function switchLang() { const v = lang === "ar" ? "en" : "ar"; setLang(v); write(LANG_KEY, v); setMsg(null); }

  if (why === null) return null;
  if (why) {
    if (noteHidden) return null;
    return (
      <>
        <button type="button" className="gk-vm-why" onClick={() => setNoteOpen(true)}>{why === "inside" ? "🎤 الدرجة بالصوت: افتحها بالمتصفح" : "🎤 الدرجة بالصوت؟"}</button>
        {noteOpen && (
          <div className="gk-modal" onClick={() => setNoteOpen(false)}>
            <div className="gk-dialog" onClick={(e) => e.stopPropagation()}>
              <b>🎤 الدرجة بالصوت ما تشتغل هنا</b>
              <div style={{ whiteSpace: "pre-line" }}>{why === "inside"
                ? "إنت فاتح التصحيح من داخل تطبيق (مثل تليجرام)، وهذا ما بي سماع الكلام. افتح صفحة التصحيح بمتصفح كروم (بالأندرويد) أو سفاري (بالآيفون والآيباد) وراح يطلع زر 🎤."
                : why === "service"
                  ? "الجهاز رافض سماع الكلام. بالآيفون والآيباد جرب هذني بالترتيب:\n١. الإعدادات ← عام ← لوحة المفاتيح ← شغّل «تفعيل الإملاء».\n٢. الإعدادات ← سيري ← شغّل سيري.\n٣. لازم تنفتح بسفاري نفسه، مو داخل تليگرام: إذا فوك الصفحة اكو «تم»، هي داخل تليگرام. بتليگرام: الإعدادات ← البيانات والتخزين ← «فتح الروابط في» (أو «المتصفح») ← اختار سفاري، وارجع دوس الزر الأخضر.\nوبالأندرويد افتحها بكروم."
                  : "هذا المتصفح ما بي سماع الكلام. افتح صفحة التصحيح بمتصفح كروم (بالأندرويد) أو سفاري (بالآيفون والآيباد) وراح يطلع زر 🎤."}</div>
              {why === "inside" && <div className="gk-lbl">الزر الأخضر يفتح نفس صفحة التصحيح بكروم أو سفاري وإنت داخل بحسابك، بدون رمز. الرابط يشتغل مرة وحدة ولمدة دقيقتين. هناك افتح الورقة ودوس «🎤 بالصوت».</div>}
              {openErr && <div className="gk-err">⚠️ {openErr}</div>}
              <div className="gk-lbl">الدوس على الدرجات يبقى يشتغل مثل قبل.</div>
              <div className="gk-tools">
                {why === "inside" && <button type="button" className="gk-finish" disabled={opening} onClick={() => void openInBrowser()}>{opening ? "جاري التجهيز..." : "🌐 افتحها بمتصفح التلفون حتى يشتغل الصوت"}</button>}
                <button type="button" className="gk-btn" onClick={() => setNoteOpen(false)}>تمام</button>
                <button type="button" className="gk-btn" onClick={() => { write(HIDE_KEY, "1"); setNoteHidden(true); setNoteOpen(false); }}>لا تطلع هالزر بعد</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
  const listening = on && state === "listening";
  return (
    <>
      <button type="button" className={"gk-vm" + (on ? " on" : "") + (listening ? " live" : "")} title="الدرجة بالصوت: إحچي الدرجة وتنكتب وتقلب للسؤال اللي بعده" onClick={toggle}>
        🎤 {!on ? "بالصوت" : state === "paused" ? "دوس حتى يسمع" : "يسمع"}
      </button>
      {on && (
        <div className="gk-vmbar">
          <span className="gk-vmtext">
            {heard ? <>🎧 {heard}</> : msg ? <span className={msg.ok ? "gk-vmok" : "gk-vmerr"}>{msg.text}</span>
              : state === "paused" ? "وقف السماع. دوس 🎤 حتى يرجع" : `🎧 شغال على كل التصحيح. إحچي درجة س${qn} (من 0 إلى ${max})، والحچي اللي مو رقم ما ينحسب`}
          </span>
          <button type="button" className="gk-btn" onClick={switchLang}>{lang === "ar" ? "الكلام: عربي" : "الكلام: إنكليزي"}</button>
          <button type="button" className="gk-btn" onClick={() => { setOn(false); write(ON_KEY, "0"); }}>⏹ إطفاء الصوت</button>
        </div>
      )}
    </>
  );
}
