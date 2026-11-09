"use client";
// محطة طباعة الليبل بمتصفح Bluefy: متصلة بطابعة البلوتوث، والكاميرا مفتوحة.
// أول ما يبين كود الطالب ينسجل حضوره وينطبع ليبله مباشرة
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

const SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2"];
const MM = 8;   // 8 نقاط بالملم
type Job = { id: number; name: string; b64: string };
type Card = { item: number; name: string; exam: string; print: string; at: string; already: boolean; late?: boolean; printed?: boolean };
type Reply = { job?: Job | null; card?: Card; ok?: boolean; pos?: { dx: number; dy: number } };

const why = (e: unknown) => (e as Error)?.message || String(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function StationClient() {
  const [status, setStatus] = useState("ماكو اتصال بالطابعة");
  const [ready, setReady] = useState(false);
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState("");
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<Card | null>(null);
  const [pending, setPending] = useState<Card | null>(null);
  const waiting = useRef(false);
  const [num, setNum] = useState("");
  const [pos, setPos] = useState({ dx: 0, dy: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const dev = useRef<any>(null);
  const ch = useRef<any>(null);
  const busy = useRef(false);
  const attaching = useRef(false);
  const chunk = useRef(180);
  const seen = useRef({ code: "", at: 0 });

  useEffect(() => { void api({ action: "pos" }).then((r) => { if (r.pos) setPos(r.pos); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function move(dx: number, dy: number) {
    const next = { dx: Math.max(-80, Math.min(80, pos.dx + dx)), dy: Math.max(-80, Math.min(80, pos.dy + dy)) };
    setPos(next);
    void api({ action: "pos", ...next }).catch((e) => setStatus(`⚠️ ما انحفظ الضبط: ${why(e)}`));
  }

  async function api(body: Record<string, unknown>): Promise<Reply> {
    const station = new URLSearchParams(location.search).get("k") ?? "";
    const res = await fetch("/api/attend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ station, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "صار خطأ بالسيرفر");
    return j;
  }
  /** اتصال واحد بالوكت، ويعيد المحاولة: الأندرويد أحياناً يفصل بأول لحظة بعد الاتصال */
  async function attach() {
    if (attaching.current) return;
    attaching.current = true;
    try {
      for (let n = 1; ; n++) {
        try {
          const gatt = await dev.current.gatt.connect();
          await sleep(700);
          const s = await gatt.getPrimaryService(SERVICES[0]);
          ch.current = (await s.getCharacteristics()).find((c: any) => c.properties.write) ?? null;
          if (!ch.current) throw new Error("الطابعة ما تقبل الكتابة");
          break;
        } catch (e) {
          ch.current = null;
          if (n >= 4) throw e;
          setStatus(`⏳ دا أحاول أتصل (${n + 1} من 4)...`);
          try { dev.current.gatt.disconnect(); } catch { /* مو متصلة */ }
          await sleep(1000 * n);
        }
      }
      setReady(true);
      setStatus("✅ متصلة بالطابعة");
    } finally { attaching.current = false; }
  }
  async function connect() {
    const bt = (navigator as any).bluetooth;
    if (!bt) { setStatus("⚠️ افتح هاي الصفحة بمتصفح Bluefy"); return; }
    try {
      dev.current = await bt.requestDevice({ filters: [{ namePrefix: "Thermal" }], optionalServices: SERVICES });
      dev.current.addEventListener("gattserverdisconnected", () => { ch.current = null; setReady(false); setStatus("⚠️ انقطع الاتصال، دا أرجع أتصل..."); });
      await attach();
      setCamera(true);
    } catch (e) { setStatus(`⚠️ ما انربطت: ${why(e)}`); }
  }
  async function write(job: Job) {
    const bytes = Uint8Array.from(atob(job.b64), (x) => x.charCodeAt(0));
    for (let i = 0; i < bytes.length;) {
      const part = bytes.slice(i, i + chunk.current);
      try { await (ch.current.writeValueWithResponse ? ch.current.writeValueWithResponse(part) : ch.current.writeValue(part)); }
      catch (e) {
        if (i === 0 && chunk.current > 20) { chunk.current = chunk.current === 180 ? 100 : 20; continue; }
        throw e;
      }
      i += part.length;
      await sleep(4);
    }
    setCount((n) => n + 1);
  }
  /** شغلة وحدة بالوكت: حتى ليبلين ما يتداخلون بالطابعة */
  async function once(run: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try { await run(); } catch (e) { setStatus(`⚠️ ${why(e)}`); await sleep(1200); } finally { busy.current = false; }
  }
  const handle = (code: string) => once(async () => {
    if (!ch.current) { setStatus("⚠️ اتصل بالطابعة أول"); return; }
    setStatus("⏳ دا يسجل الحضور...");
    const r = await api({ action: "scan", code });
    const c = r.card!;
    if (c.late) { setPending(c); waiting.current = true; setStatus(`⏰ ${c.name}: جاي بغير وقته`); return; }
    setLast(c);
    if (r.job) {
      setStatus(`🖨 دا يطبع: ${c.name}`);
      await write(r.job);
      await api({ action: "printed", id: c.item });
      setStatus(`✅ انطبع: ${c.name}`);
    } else setStatus(c.printed ? `⚠️ ${c.name}: مطبوع له ليبل` : c.already ? `⚠️ ${c.name}: كان مسجل حضوره` : `✅ انسجل ${c.name}. مركزه يطبع ورقة كاملة`);
  });
  /** قرار الجاي بغير وقته: بعدها الكاميرا ترجع تقرا */
  const decide = (allow: boolean) => once(async () => {
    const c = pending;
    if (!c) return;
    if (!allow) {
      await api({ action: "rejectLate", item: c.item });
      setPending(null); waiting.current = false;
      setStatus(`❌ انرفض: ${c.name}`);
      return;
    }
    if (!ch.current) { setStatus("⚠️ اتصل بالطابعة أول"); return; }
    const r = await api({ action: "except", item: c.item });
    setPending(null); waiting.current = false;
    setLast(r.card!);
    if (r.job) { setStatus(`🖨 دا يطبع: ${c.name}`); await write(r.job); await api({ action: "printed", id: c.item }); setStatus(`✅ انطبع: ${c.name}`); }
    else setStatus(`✅ انسجل ${c.name} باستثناء`);
  });
  const reprint = (item: number) => once(async () => {
    if (!ch.current) { setStatus("⚠️ اتصل بالطابعة أول"); return; }
    const r = await api({ action: "reprint", item });
    if (r.job) { setStatus(`🖨 دا يطبع: ${r.job.name}`); await write(r.job); setStatus(`✅ انطبع: ${r.job.name}`); }
  });
  const testLabel = () => once(async () => {
    if (!ch.current) { setStatus("⚠️ اتصل بالطابعة أول"); return; }
    const r = await api({ action: "test" });
    if (r.job) { setStatus("🖨 دا يطبع ليبل تجربة"); await write(r.job); setStatus("✅ انطبع ليبل التجربة"); }
  });

  // الليبلات اللي تنرسل من صفحة الحضوري بتليگرام
  useEffect(() => {
    const t = setInterval(() => void once(async () => {
      if (!ch.current && dev.current && !attaching.current) await attach();
      if (!ch.current) return;
      const r = await api({ action: "next" });
      if (!r.job) return;
      setStatus(`🖨 دا يطبع: ${r.job.name}`);
      await write(r.job);
      await api({ action: "done", id: r.job.id });
      setStatus(`✅ انطبع: ${r.job.name}`);
    }), 3000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** كود صحيح لطالب: ينطبع فوراً أول مرة. نفس الكود ما ينقرا مرة ثانية خلال 8 ثواني */
  function found(raw: string) {
    if (!raw.startsWith("QS:") || waiting.current) return;
    const now = Date.now();
    if (seen.current.code === raw && now - seen.current.at < 8000) return;
    seen.current = { code: raw, at: now };
    void handle(raw);
  }
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null, timer: ReturnType<typeof setInterval> | null = null, off = false;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (off) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setCamErr("");
        timer = setInterval(() => {
          if (busy.current || !v.videoWidth) return;
          const s = Math.min(1, 800 / v.videoWidth);
          canvas.width = v.videoWidth * s; canvas.height = v.videoHeight * s;
          const g = canvas.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(v, 0, 0, canvas.width, canvas.height);
          const d = g.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(d.data, d.width, d.height, { inversionAttempts: "dontInvert" });
          if (r?.data) found(r.data);
        }, 250);
      } catch (e) { setCamErr(why(e)); setCamera(false); }
    })();
    return () => { off = true; if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  /** إذا Bluefy ما فتح الكاميرا الحية: تصور الكود صورة */
  async function photo(f: File | undefined) {
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const im = new Image();
      await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = url; });
      const s = Math.min(1, 1200 / im.width);
      const canvas = document.createElement("canvas");
      canvas.width = im.width * s; canvas.height = im.height * s;
      const g = canvas.getContext("2d")!;
      g.drawImage(im, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const d = g.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(d.data, d.width, d.height);
      if (r?.data?.startsWith("QS:")) { seen.current = { code: "", at: 0 }; found(r.data); }
      else setStatus("⚠️ ما انقرا الكود. قرب الكاميرا وصور مرة ثانية");
    } catch (e) { setStatus(`⚠️ ${why(e)}`); }
  }
  const mm = (dots: number) => dots / MM;
  return (
    <div className="wrap">
      <div className="card expad">
        <div className="exlabel">🖨 محطة طباعة الليبل</div>
        <div className="exhint atok" style={{ fontSize: 17 }}>{status}</div>
        {!ready && <button type="button" className="btn agbtn adtop" onClick={() => void connect()}>🔌 اتصل بالطابعة</button>}
        {count > 0 && <div className="exhint">انطبع: <b>{count}</b></div>}
      </div>
      {ready && (
        <div className="card expad">
          <div className="exlabel">📷 وجه الكاميرا على كود الطالب</div>
          {camera ? <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 12, background: "#000" }} /> : <button type="button" className="btn agbtn adtop" onClick={() => setCamera(true)}>📷 افتح الكاميرا</button>}
          {camErr && <div className="exhint exbad">⚠️ الكاميرا الحية ما انفتحت: {camErr}</div>}
          <label className="exbtn adtop">📸 صور الكود صورة<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void photo(f); }} /></label>
          <div className="atrow adtop">
            <input className="exinput" inputMode="numeric" dir="ltr" aria-label="رقم الطالب" placeholder="رقم الطالب" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} />
            <button type="button" className="exbtn" disabled={!num} onClick={() => { void handle(num); setNum(""); }}>سجل واطبع</button>
          </div>
          {pending && (
            <div className="atcard">
              <b>{pending.name}</b>
              <div className="exhint exbad">⏰ جاي بغير وقته. موعده: <span dir="ltr">{pending.at}</span></div>
              <div className="exhint">{pending.exam}</div>
              <div className="atrow adtop">
                <button type="button" className="btn" onClick={() => void decide(true)}>🔓 استثناء</button>
                <button type="button" className="exbtn" onClick={() => void decide(false)}>❌ رفض</button>
              </div>
            </div>
          )}
          {last && !pending && (
            <div className="atcard">
              <b>{last.name}</b>
              {last.printed && <div className="exhint exbad">⚠️ هذا الطالب مطبوع له ليبل</div>}
              <div className="exhint">{last.exam}</div>
              <button type="button" className="exbtn adtop" onClick={() => void reprint(last.item)}>🏷 اطبع ليبل مرة ثانية</button>
            </div>
          )}
        </div>
      )}
      {ready && (
        <details className="card cpch">
          <summary><b>📐 ضبط مكان الطباعة</b> <small className="pdmode">يمين {mm(pos.dx)} ملم · جوة {mm(pos.dy)} ملم</small></summary>
          <div className="expad">
            <div className="exhint">إذا الليبل زاحف، حركه بالأزرار، كل دوسة 1 ملم، وبعدها اطبع تجربة. الضبط ينحفظ ويبقى لكل الطلاب والأيام لحد ما تغيره.</div>
            <div className="atrow adtop">
              <button type="button" className="exbtn" onClick={() => move(-MM, 0)}>⬅️ يسار</button>
              <button type="button" className="exbtn" onClick={() => move(MM, 0)}>➡️ يمين</button>
              <button type="button" className="exbtn" onClick={() => move(0, -MM)}>⬆️ فوك</button>
              <button type="button" className="exbtn" onClick={() => move(0, MM)}>⬇️ جوة</button>
            </div>
            <button type="button" className="btn agbtn adtop" onClick={() => void testLabel()}>🧪 اطبع ليبل تجربة</button>
          </div>
        </details>
      )}
    </div>
  );
}
