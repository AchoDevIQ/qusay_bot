"use client";
// صفحات PDF كبيرة داخل الصفحة، لأن تليجرام ما يعرض PDF بالموبايل
import { useEffect, useRef, useState } from "react";

/** كل صفحة من PDF تصير صورة، حتى ينكتب فوكها بالقلم مثل الصور */
export async function pdfToImages(url: string, width = 1400): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
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

export default function PdfPages({ url, outside = true }: { url: string; outside?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "failed">("loading");
  useEffect(() => {
    let stop = false;
    setState("loading");
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
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
