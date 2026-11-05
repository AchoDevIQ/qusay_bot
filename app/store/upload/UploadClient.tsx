"use client";
// رفع الفصول: تختار مجلد «للرفع» من جهازك، والصفحة ترفع اللي ناقص وتدخله للبوت. تنعاد بأمان إذا انقطع النت
import { useState } from "react";
import { AdminHeader, StatusBar, pageAuth, useAdminApi } from "../adminPage";

type Data = { ready?: boolean };
const WORKERS = 4;

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData: pageAuth() }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "صار خطأ");
  return j;
}
async function sendFile(ref: string, f: File) {
  const form = new FormData();
  form.set("initData", pageAuth());
  form.set("path", ref);
  form.set("file", f);
  for (let tries = 1; ; tries++) {
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (res.ok) return;
      const j = await res.json().catch(() => ({}));
      if (res.status < 500 || tries >= 3) throw new Error(j.error ?? "ما انرفع الملف");
    } catch (e) { if (tries >= 3) throw e; }
  }
}

export default function UploadClient() {
  const { data, error, busy } = useAdminApi<Data>("/api/upload", "📤 رفع الفصول");
  const [picked, setPicked] = useState<{ ref: string; file: File }[]>([]);
  const [line, setLine] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState("");
  const [finished, setFinished] = useState<string[]>([]);
  const slugs = [...new Set(picked.map((p) => p.ref.split("/")[0] === "answers" ? p.ref.split("/")[1] : p.ref.split("/")[0]))].filter((s) => /^ch\d+$/.test(s)).sort();

  function choose(list: FileList | null) {
    // أول جزء من المسار اسم المجلد المختار نفسه
    setPicked([...(list ?? [])].map((f) => ({ ref: (f as File & { webkitRelativePath: string }).webkitRelativePath.split("/").slice(1).join("/"), file: f })).filter((x) => x.ref));
    setFinished([]); setFailed(""); setDone(0); setTotal(0); setLine("");
  }
  async function start() {
    setRunning(true); setFailed(""); setFinished([]);
    try {
      for (const slug of slugs) {
        setLine(`${slug}: أشوف شنو الناقص...`);
        const have = new Set<string>((await post({ action: "have", slug })).names);
        const mine = picked.filter((p) => p.ref.startsWith(`${slug}/`) || p.ref.startsWith(`answers/${slug}/`));
        // ملف الفصل ينرفع كل مرة لأن تعديلاته تبقى بنفس الاسم
        const todo = mine.filter((p) => !have.has(p.ref) || p.ref.endsWith("catalog.json"));
        setTotal(todo.length); setDone(0);
        let next = 0, sent = 0;
        await Promise.all(Array.from({ length: WORKERS }, async () => {
          while (next < todo.length) {
            const p = todo[next++];
            await sendFile(p.ref, p.file);
            setDone(++sent);
            setLine(`${slug}: انرفع ${sent} من ${todo.length}`);
          }
        }));
        setLine(`${slug}: أدخل الامتحانات للبوت...`);
        const s = await post({ action: "start", slug });
        for (let from = 0; from < s.total;) {
          const r = await post({ action: "part", slug, from });
          from = r.done;
          setLine(`${s.chapter}: دخل ${from} من ${s.total} امتحان`);
        }
        setFinished((x) => [...x, s.chapter]);
      }
      setLine("✅ خلص الرفع");
    } catch (e) {
      setFailed(`${(e as Error).message}. اضغط «ابدأ الرفع» مرة ثانية، ويكمل من مكان ما وقف.`);
    } finally { setRunning(false); }
  }
  return (
    <>
      <AdminHeader title="📤 رفع الفصول" />
      <div className="wrap">
        {!data && error && <div className="card warn exerr">⚠️ {error}</div>}
        {!data && !error && <div className="empty">جاري التحميل...</div>}
        {data && (
          <div className="card">
            <h2>📤 رفع الفصول</h2>
            <div className="form">
              <ol className="adsteps">
                <li>اضغط «اختار المجلد»، واختار مجلد <b>للرفع</b>.</li>
                <li>اضغط «ابدأ الرفع»، وخلي الصفحة مفتوحة لحد ما يخلص.</li>
                <li>إذا انقطع النت، اضغطه مرة ثانية ويكمل.</li>
              </ol>
              <label className="exbtn adtop">📁 اختار المجلد
                <input type="file" hidden multiple {...({ webkitdirectory: "", directory: "" } as object)} disabled={running} onChange={(e) => choose(e.target.files)} />
              </label>
              {!!picked.length && <div className="who adnopad">{picked.length} ملف · الفصول: {slugs.join("، ") || "ما لگيت فصول بهذا المجلد"}</div>}
              <button type="button" className="btn agbtn adtop" disabled={running || busy || !slugs.length} onClick={() => void start()}>{running ? "جاري الرفع..." : "🚀 ابدأ الرفع"}</button>
              {!!total && <div className="rgtrack adtop"><div className="rgfill" style={{ width: `${(done / total) * 100}%` }} /></div>}
              {line && <div className="exhint adtop">{line}</div>}
              {failed && <div className="err">⚠️ {failed}</div>}
              {!!finished.length && <div className="fdok adtop">✅ دخلت: {finished.join("، ")}</div>}
            </div>
          </div>
        )}
      </div>
      <StatusBar busy={busy} error={data ? error : ""} />
    </>
  );
}
