// مكتبة الـ PDF بالسيرفر. ملف العامل مالها (pdf.worker) ينحدد بمكانه بالضبط،
// حتى ما يضيع إذا الموقع انبنى وانحزم (هذا اللي جان يطلع «صار خطأ» برفع الملزمة)
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let ready: Promise<Pdfjs> | null = null;
export function pdfjsLib(): Promise<Pdfjs> {
  ready ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    try {
      const req = createRequire(path.join(process.cwd(), "package.json"));
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
    } catch { /* يبقى على مكانه الأصلي */ }
    return pdfjs;
  })();
  return ready;
}
