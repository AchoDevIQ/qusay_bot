"use client";
// أوراق السكانر: المساعد يختار كل الصور (أو ملفات PDF) مرة وحدة. الصفحة تقرا الأكواد المطبوعة:
// الليبل أو ورقة الطالب تعرّف الطالب، وكود الصفحة يعرّف السؤال، والصفحات اللي وراه إله لحد الطالب الجاي.
// الصفحات البيضاء تنشال، والمشاكل تطلع بقائمة. بعدها كل صفحة تنرفع لطالبها، والأوراق تروح للتصحيح
import jsQR from "jsqr";
import { useEffect, useState } from "react";
import RescanList, { type Rescan } from "../attend/RescanList";
import { AdminHeader, pageAuth } from "../adminPage";
import { assignPages, type PageItem } from "./assign";
import { pdfClient } from "../pdfClient";

type Src = { file: File; page: number };           // page = رقم صفحة الـ PDF، أو 0 للصورة
type Hit = { src: Src; flip: boolean; item: number; q: number; seq: number; qs?: number[]; label: string };
type Item = PageItem;
type Plan = { hits: Hit[]; items: Map<number, Item>; problems: string[]; blank: number };

const DETECT_W = 1300, UPLOAD_W = 1600;

const docs = new WeakMap<File, ReturnType<typeof openPdf>>();
const pdfDoc = (file: File) => { let d = docs.get(file); if (!d) { d = openPdf(file); docs.set(file, d); } return d; };
async function openPdf(file: File) {
  const pdfjs = await pdfClient();
  return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
}
/** الصفحة على كانفس بعرض معين، ومقلوبة إذا انحطت بالسكانر بالمقلوب */
async function draw(src: Src, width: number, flip = false) {
  const c = document.createElement("canvas");
  if (src.page) {
    const page = await (await pdfDoc(src.file)).getPage(src.page);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v1.width, rotation: flip ? 180 : 0 });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    return c;
  }
  const img = await createImageBitmap(src.file);
  const s = Math.min(1, width / img.width);
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  if (flip) { ctx.translate(c.width, c.height); ctx.rotate(Math.PI); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
/** كل الأكواد بالصفحة: يقرا واحد، يبيضه، ويدور على الثاني */
function codesOf(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: "dontInvert" });
    if (!r) break;
    out.push(r.data);
    const xs = [r.location.topLeftCorner.x, r.location.topRightCorner.x, r.location.bottomLeftCorner.x, r.location.bottomRightCorner.x];
    const ys = [r.location.topLeftCorner.y, r.location.topRightCorner.y, r.location.bottomLeftCorner.y, r.location.bottomRightCorner.y];
    const pad = 12;
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2);
  }
  return out;
}
/** صفحة بيضاء: الوجه الثاني من الورقة إذا السكانر صور الوجهين */
function isBlank(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  // حواف الصفحة ما تنحسب: السكانر يرسم خط أسود على حافة الورقة، ونقط الغبار تبقى بالأطراف
  const mx = Math.round(c.width * 0.05), my = Math.round(c.height * 0.05);
  const d = ctx.getImageData(mx, my, c.width - 2 * mx, c.height - 2 * my).data;
  let dark = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 16) { n++; if (d[i] + d[i + 1] + d[i + 2] < 300) dark++; }
  return dark / n < 0.0008;
}
async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/attend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, initData: pageAuth() }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "صار خطأ");
  return j;
}

export default function ScanUpClient() {
  const [srcs, setSrcs] = useState<Src[]>([]);
  const [step, setStep] = useState<"pick" | "read" | "check" | "send" | "done">("pick");
  const [prog, setProg] = useState([0, 0]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [rescan, setRescan] = useState<Rescan[]>([]);
  // قائمة الأوراق اللي لازم تنرفع من جديد، وتتحدث بعد كل رفع
  const loadRescan = () => post({ action: "list" }).then((r) => setRescan(r.rescan ?? [])).catch(() => undefined);
  useEffect(() => { void loadRescan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(list: FileList | null) {
    setError("");
    const fs = [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out: Src[] = [];
    for (const f of fs) {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        try { const doc = await pdfDoc(f); for (let p = 1; p <= doc.numPages; p++) out.push({ file: f, page: p }); } catch { setError(`ما انفتح ${f.name}`); }
      } else if (f.type.startsWith("image/")) out.push({ file: f, page: 0 });
    }
    setSrcs(out); setPlan(null); setStep("pick");
  }

  async function read() {
    setStep("read"); setError("");
    const hits: Hit[] = [], problems: string[] = [];
    let cur = 0, lastQ = 0, blank = 0;
    const seq = new Map<number, number>();   // رقم صفحة كل طالب بعد ليبله
    const add = (src: Src, flip: boolean, label: string) => { const n = (seq.get(cur) ?? 0) + 1; seq.set(cur, n); hits.push({ src, flip, item: cur, q: lastQ, seq: n, label }); };
    for (let i = 0; i < srcs.length; i++) {
      setProg([i + 1, srcs.length]);
      const src = srcs[i], label = src.page ? `${src.file.name} ص${src.page}` : src.file.name;
      try {
        let flip = false, codes = codesOf(await draw(src, DETECT_W));
        const empty = !codes.length && isBlank(await draw(src, 400));
        if (!codes.length && !empty) { const k = codesOf(await draw(src, DETECT_W, true)); if (k.length) { flip = true; codes = k; } }
        if (!codes.length) {
          if (empty) { blank++; continue; }
          // صفحة بيها كتابة بدون كود: تكملة جواب الصفحة اللي قبلها
          if (cur) add(src, flip, label);
          else problems.push(`${label}: ما بيها كود، وما معروف لمن`);
          continue;
        }
        const qi = codes.map((t) => /^QI:(\d+)$/.exec(t)).find(Boolean);
        const qp = codes.map((t) => /^QP:(\d+):(\d+)$/.exec(t)).find(Boolean);
        const qv = codes.map((t) => /^QV:(\d+):(\d+)$/.exec(t)).find(Boolean);
        if (qp) { cur = Number(qp[1]); lastQ = Number(qp[2]); }
        else {
          if (qi) { cur = Number(qi[1]); lastQ = 0; }
          else if (qv && Number(qv[2]) === 1) { cur = 0; problems.push(`${label}: أول صفحة بدون ليبل`); }
          if (qv) lastQ = Number(qv[2]);
        }
        if (!cur) { problems.push(`${label}: ما معروف لمن`); continue; }
        add(src, flip, label);
      } catch { problems.push(`${label}: ما انقرت`); }
    }
    try {
      const ids = [...new Set(hits.map((h) => h.item))];
      const r = await post({ action: "items", items: ids });
      const items = new Map<number, Item>((r.items as Item[]).map((x) => [x.id, x]));
      const r2 = assignPages(hits, items);
      setPlan({ hits: r2.good, items, problems: [...problems, ...r2.problems], blank }); setStep("check");
    } catch (e) { setError(e instanceof Error ? e.message : "صار خطأ"); setStep("pick"); }
  }

  async function send() {
    if (!plan) return;
    setStep("send"); setError("");
    const fails: string[] = [];
    for (let i = 0; i < plan.hits.length; i++) {
      setProg([i + 1, plan.hits.length]);
      const h = plan.hits[i];
      try {
        const c = await draw(h.src, UPLOAD_W, h.flip);
        const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("jpg"))), "image/jpeg", 0.82));
        const fd = new FormData();
        fd.set("initData", pageAuth()); fd.set("item", String(h.item)); fd.set("q", String(h.q)); if (h.qs) fd.set("qs", h.qs.join(",")); fd.set("file", blob, "page.jpg");
        const res = await fetch("/api/attend/scan", { method: "POST", body: fd });
        if (!res.ok) fails.push(`${h.label}: ${(await res.json()).error ?? "ما انرفعت"}`);
      } catch { fails.push(`${h.label}: ما انرفعت`); }
    }
    try {
      const r = await post({ action: "finish", items: [...new Set(plan.hits.map((h) => h.item))] });
      setResult([r.notice, ...fails].join("\n"));
    } catch (e) { setResult([e instanceof Error ? e.message : "صار خطأ", ...fails].join("\n")); }
    setStep("done");
    void loadRescan();
  }

  const students = plan ? [...plan.items.values()].filter((x) => x.ok) : [];
  return (
    <>
      <AdminHeader title="📤 أوراق السكانر" />
      <div className="wrap">
        <RescanList list={rescan} />
        {/* تيليجرام بالحاسبة أحياناً ما يفتح نافذة اختيار الملفات: تسحب الملف من الفولدر وتذبه هنا */}
        <div className="card expad" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (step !== "read" && step !== "send") void pick(e.dataTransfer.files); }}>
          <div className="exlabel">1. اختار صور السكانر</div>
          <div className="exhint">كل الصور مرة وحدة، أو ملف PDF. المهم أوراق كل طالب تكون ورا بعض، والليبل على أول صفحة. الترتيب بين الطلاب ما يهم.</div>
          <div className="exhint">بالحاسبة: إذا الزر ما فتح الملفات، اسحب الملف من الفولدر وذبه على هذا المربع.</div>
          <label className="exbtn adtop">🖼 {srcs.length ? `${srcs.length} صفحة` : "اختار الصور"}
            <input type="file" hidden multiple accept="image/*,application/pdf" disabled={step === "read" || step === "send"} onChange={(e) => void pick(e.target.files)} />
          </label>
          {!!srcs.length && step === "pick" && <button type="button" className="btn agbtn adtop" onClick={() => void read()}>🔎 اقرا الأكواد</button>}
          {(step === "read" || step === "send") && (
            <>
              <div className="exhint adtop">{step === "read" ? "جاري قراءة الأكواد" : "جاري الرفع"}: {prog[0]} من {prog[1]}. لا تسد الصفحة.</div>
              <div className="atbar"><i style={{ width: `${(100 * prog[0]) / Math.max(1, prog[1])}%` }} /></div>
            </>
          )}
          {error && <div className="exhint exbad adtop">⚠️ {error}</div>}
        </div>
        {plan && step !== "pick" && (
          <div className="card expad">
            <div className="exlabel">2. شنو لگيت</div>
            <div className="exhint">{students.length} طالب، {plan.hits.length} صفحة{plan.blank ? `، و${plan.blank} صفحة بيضاء انشالت` : ""}.</div>
            <div className="atlog">{students.map((s) => <div key={s.id}>✅ {s.name}: {plan.hits.filter((h) => h.item === s.id).length} صفحة</div>)}</div>
            {!!plan.problems.length && (
              <>
                <div className="exlabel adtop">⚠️ تحتاج تشوفها ({plan.problems.length})</div>
                <div className="atlog">{plan.problems.map((p, i) => <div key={i}>{p}</div>)}</div>
                <div className="exhint">الباقي ينرفع عادي. هذني صلحهن وارفعهن بعدين بروحهن.</div>
              </>
            )}
            {step === "check" && <button type="button" className="btn agbtn adtop" disabled={!plan.hits.length} onClick={() => void send()}>📤 ارفع {plan.hits.length} صفحة ودزها للتصحيح</button>}
          </div>
        )}
        {step === "done" && <div className="card expad"><div className="exlabel">✅ خلص</div><div className="atlog" style={{ whiteSpace: "pre-line" }}>{result}</div></div>}
      </div>
    </>
  );
}
