"use client";
// تسجيل الطالب الجديد من التطبيق بطريقة البوت: نفس خطوات تسجيل البوت، والرقم اللي دخل بيه ثابت.
// بالآخر يشوف رمزه السري، و«ادخل للتطبيق» يدز الرقم والرمز للتطبيق حتى يدخله وحده
import { useEffect, useState } from "react";
import RegFlow, { type AppMode, type RegData } from "../reg/RegFlow";

type Bridge = { postMessage: (s: string) => void };

export default function AppRegClient() {
  const [D, setD] = useState<(RegData & { districts: string[] }) | null>(null);
  const [err, setErr] = useState("");
  const q = typeof window === "undefined" ? null : new URLSearchParams(location.search);
  const phone = q?.get("phone") ?? "", env = q?.get("env") ?? "prod";

  async function api<T>(body: Record<string, unknown>): Promise<T> {
    const action = body.action === "regInfo" ? "info" : body.action;
    let res: Response;
    try { res = await fetch("/api/appreg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action, phone, env }) }); }
    catch { throw new Error("ماكو اتصال، حاول مرة ثانية"); }
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "صار خطأ، حاول مرة ثانية");
    return j as T;
  }
  useEffect(() => { api<RegData & { districts: string[] }>({ action: "info" }).then(setD).catch((e: Error) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (d: { password: string }) => {
    const b = (window as unknown as { QApp?: Bridge }).QApp;
    if (b) b.postMessage(JSON.stringify({ phone, password: d.password }));
  };
  if (err) return <div className="rg"><div className="rgbody"><div className="rgcard rgbad">⚠️ {err}</div></div></div>;
  if (!D) return <div className="rg"><div className="rgbody rgcenter"><div className="rgspin" /></div></div>;
  const app: AppMode = { api, phone, districts: D.districts, onFinish: finish };
  return <RegFlow D={D} app={app} />;
}
