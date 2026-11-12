"use client";
// صفحات PDF كبيرة داخل الصفحة، لأن تليجرام ما يعرض PDF بالموبايل
import { useEffect, useRef, useState } from "react";
import { pdfClient } from "./pdfClient";

/** كل صفحة من PDF تصير صورة، حتى ينكتب فوكها بالقلم مثل الصور */
export async function pdfToImages(url: string, width = 1400): Promise<string[]> {
  const pdfjs = await pdfClient();
  const doc = await pdfjs.getDocument({ url, disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (blob) out.push(URL.createObjectURL(blob));
  }
  return out;
}

/** يقص ملف الحلول سؤال سؤال حسب علامات «س1، س2...» بيمين الصفحة. اللي قبل أول علامة بالصفحة تكملة للسؤال اللي قبله */
export async function pdfByQuestion(url: string, width = 1400): Promise<{ q: number; src: string }[]> {
  const pdfjs = await pdfClient();
  const doc = await pdfjs.getDocument({ url, disableFontFace: true }).promise;
  const out: { q: number; src: string }[] = [];
  let last = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const items = (await page.getTextContent()).items as { str: string; transform: number[]; height: number }[];
    const seen = items.filter((t) => t.str.includes("س")).map((t) => viewport.convertToViewportPoint(t.transform[4], t.transform[5]));
    const labels: { q: number; y: number }[] = [];
    for (const t of items) {
      const m = /^\s*س?\s*(\d{1,2})\s*س?\s*$/.exec(t.str);
      if (!m || t.transform[4] < base.width * 0.75) continue;
      const [x, y] = viewport.convertToViewportPoint(t.transform[4], t.transform[5]);
      const own = t.str.includes("س");
      if (!own && !seen.some(([sx, sy]) => Math.abs(sx - x) < 60 && Math.abs(sy - y) < 40)) continue;
      const top = y - (t.height || 16) * (width / base.width) - 18;
      if (!labels.some((l) => l.q === Number(m[1]))) labels.push({ q: Number(m[1]), y: Math.max(0, top) });
    }
    labels.sort((a, b) => a.y - b.y);
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const cut = async (q: number, y0: number, y1: number) => {
      if (y1 - y0 < 60) return;
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = Math.round(y1 - y0);
      c.getContext("2d")!.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
      if (blob) out.push({ q, src: URL.createObjectURL(blob) });
    };
    if (last && (labels[0]?.y ?? canvas.height) > canvas.height * 0.18) await cut(last, canvas.height * 0.1, labels[0]?.y ?? canvas.height * 0.95);
    for (let k = 0; k < labels.length; k++) {
      await cut(labels[k].q, labels[k].y, labels[k + 1]?.y ?? canvas.height * 0.95);
      last = labels[k].q;
    }
  }
  return out;
}

export default function PdfPages({ url, outside = true }: { url: string; outside?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "failed">("loading");
  useEffect(() => {
    let stop = false;
    setState("loading");
    void (async () => {
      try {
        const pdfjs = await pdfClient();
        const doc = await pdfjs.getDocument({ url, disableFontFace: true }).promise;
        box.current?.replaceChildren();
        for (let i = 1; i <= doc.numPages && !stop; i++) {
          const page = await doc.getPage(i);
          const width = box.current?.clientWidth || 800;
          const scale = (width * Math.max(window.devicePixelRatio || 1, 2)) / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "eximg";
          box.current?.append(canvas);
          await page.render({ canvas, viewport }).promise;
        }
        if (!stop) setState("done");
      } catch (e) { console.error(e); if (!stop) setState("failed"); }
    })();
    return () => { stop = true; };
  }, [url]);
  return (
    <div>
      {state === "loading" && <div className="exempty">جاري فتح الملف...</div>}
      {state === "failed" && <div className="exbad">ما انفتح الملف هنا.</div>}
      <div ref={box} />
      {outside && <div className="exline"><a className="exbtn" href={url} target="_blank" rel="noreferrer">📄 فتح الملف خارج الصفحة</a></div>}
    </div>
  );
}
