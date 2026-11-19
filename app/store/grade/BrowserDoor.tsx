"use client";
// صفحة التصحيح انفتحت من «🌐 افتحها بمتصفح التلفون»: الرابط بيه رمز يشتغل مرة وحدة.
// نبدله بجلسة لنفس الحساب، ونشيله من الرابط، وبعدها تطلع صفحة التصحيح عادي
import { useEffect, useState, type ReactNode } from "react";
import { setPageToken } from "../adminPage";
import { inAppView } from "./VoiceMark";

// مرة وحدة بس حتى لو الصفحة انرسمت مرتين
type Got = { t?: string; error?: string };
let once: Promise<Got> | null = null;
const exchange = (code: string) => once ??= fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "browserOpen", code }) })
  .then(async (r): Promise<Got> => { const j = await r.json().catch(() => ({})); return r.ok && j.t ? { t: String(j.t) } : { error: String(j.error ?? "صار خطأ") }; })
  .catch((): Got => ({ error: "ماكو اتصال، تأكد من النت وارجع دوس الزر بتليگرام مرة ثانية" }));

export default function BrowserDoor({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"check" | "ok" | "inside" | { error: string }>("check");
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("go");
    if (!code) { setState("ok"); return; }
    // انفتح بمتصفح تليگرام الداخلي: الصوت ما يشتغل هنا، فما نصرف الرمز حتى ينفتح نفس الرابط بكروم
    if (inAppView()) { setState("inside"); return; }
    void exchange(code).then((r) => {
      if (!r.t) { setState({ error: r.error ?? "" }); return; }
      // المتصفح ما يحفظ (تبويب خاص): الجلسة تبقى بالرابط نفسه
      history.replaceState(null, "", setPageToken(r.t) ? "/store/grade" : `/store/grade?t=${encodeURIComponent(r.t)}`);
      setState("ok");
    });
  }, []);
  if (state === "ok") return <>{children}</>;
  return (
    <div className="admin" style={{ padding: 16, lineHeight: 1.9 }}>
      {state === "check" && <p>جاري الدخول...</p>}
      {state === "inside" && <p>⚠️ الصفحة انفتحت داخل تليگرام، والدرجة بالصوت ما تشتغل هنا.<br />دوس <b>⋮</b> فوك واختار <b>«فتح بالمتصفح»</b> (كروم)، خلال دقيقتين.</p>}
      {typeof state === "object" && <p>⚠️ {state.error}</p>}
    </div>
  );
}
