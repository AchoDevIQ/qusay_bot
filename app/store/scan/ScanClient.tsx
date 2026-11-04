"use client";
import { useEffect, useRef, useState } from "react";
import { scanQr, sendToBot } from "../shared";

const HINT = "وجه الكاميرا على الكود المطبوع بوصل طلبك";

export default function ScanClient() {
  const [failed, setFailed] = useState(false);
  const opened = useRef(false);

  function open() {
    const ok = scanQr(HINT, (text) => {
      if (!text.trim().toUpperCase().startsWith("QM-")) return false; // كود ثاني: تبقى الكاميرا مفتوحة
      sendToBot({ k: "scan", code: text.trim() });
      return true;
    });
    setFailed(!ok);
    return ok;
  }
  // سكربت تليجرام يتحمل بعد الصفحة، فننتظره شوية ونفتح الكاميرا لوحدها
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      if (opened.current || ++tries > 15) { clearInterval(t); return; }
      if ((window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp) opened.current = open();
    }, 200);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header>
        <img src="/logo.png" alt="" />
        <h1 className="plain">QMath</h1>
        <p>🔓 فتح الامتحانات</p>
      </header>
      <div className="wrap">
        <div className="card">
          <h2>📷 امسح الكود</h2>
          <div className="form">
            <div className="lock">{HINT}.</div>
            {failed && (
              <div className="note" style={{ margin: "14px 0 0" }}>
                ⚠️ الكاميرا ما تشتغل بهذا الجهاز، أو نسخة تليجرام قديمة. سكر هاي الصفحة واكتب الرمز المطبوع تحت الكود بمحادثة البوت.
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="bar"><div className="in">
        <div className="sum"><small>إذا ما انفتحت الكاميرا</small></div>
        <button type="button" className="btn" onClick={open}>📷 افتح الكاميرا</button>
      </div></div>
    </>
  );
}
